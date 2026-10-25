// rb-world-live: RB World's live rooms. One Durable Object per city room keeps a WebSocket open to every player in
// it and passes their moves on about eight times a second, so other players drive and walk smoothly instead of
// jumping every few seconds (the beat in world-worker.js still does the leaderboard, chat, lots and points).
// It also referees fights between players who've turned on 18+ combat, and keeps everyone's health itself:
//   - a shot only lands if both players have combat on and are alive, the target is in the weapon's range of where
//     the server last saw the shooter, and the shooter isn't firing faster than the weapon can;
//   - the room takes the damage off the target's health (armour soaks 70% of it first) and tells them their new
//     health; at zero they're down and the shooter gets the kill, which everyone sees in the kill feed. Health a player
//     reports can only lower theirs (hurt by a crew in a mission), apart from the slow regain to half that the game
//     allows, so a player can't shrug off hits from other players.
// Who you are: a player tied to an RB account or to a device (world_accounts / world_guests, see world-worker.js) can
// only join with a one-use ticket the game got for it a moment before (POST /api/world/ticket, which checks the
// sign-in or the device key), so nobody can join as someone else. Players from before that stay open.
// Players blocked in RB Command (world_bans) can drive, but others don't see them and they can't fight. With RB World
// switched off (world_open) nobody can join; with combat off (world_combat) no shot lands.
// Bindings: ROOMS (Durable Object namespace, class Room), DB (the shared D1 database). Nothing else.

const ORIGINS = /^https:\/\/([a-z0-9-]+\.)?relentlessbillionaire\.com$/;
const ID = /^[A-Za-z0-9-]{8,64}$/;
const ROOM = /^[a-z0-9-]{1,32}$/;
const MAX_PLAYERS = 60;
// metres, and the shortest time between two shots, for each weapon (combat.js has the full specs)
export const ARMS = {
  pistol: { range: 70, gap: 0.15, dmg: 26 }, smg: { range: 50, gap: 0.05, dmg: 16 }, shotgun: { range: 30, gap: 0.6, dmg: 13 * 9 },
  rifle: { range: 140, gap: 0.07, dmg: 29 }, sniper: { range: 420, gap: 1.1, dmg: 130 }, rpg: { range: 320, gap: 1.6, dmg: 220 },
  grenade: { range: 45, gap: 1.0, dmg: 160 },
};
const SLACK = 12; // metres of lag allowed between where the server last saw someone and where they really were
const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : 0; };
const clean = (s, max) => String(s || "").replace(/[<>\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, max);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/health") return new Response("rb-world-live ok", { headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
    const m = /^\/room\/([a-z0-9-]{1,32})$/.exec(url.pathname);
    if (!m) return new Response("Not found", { status: 404 });
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    const origin = request.headers.get("Origin") || "";
    if (!ORIGINS.test(origin)) return new Response("Forbidden", { status: 403 });
    const id = url.searchParams.get("id") || "";
    if (!ID.test(id)) return new Response("Bad player id", { status: 400 });
    // a protected player needs its ticket (used up here); if that can't be checked, it waits and tries again
    let owned = false, ticketOk = false;
    try {
      const t = url.searchParams.get("t") || "";
      const r = await env.DB.prepare("SELECT (SELECT 1 FROM world_accounts WHERE player_id = ?1) AS a, (SELECT 1 FROM world_guests WHERE player_id = ?1) AS g").bind(id).first();
      owned = !!(r && (r.a || r.g));
      if (owned && /^[a-f0-9]{64}$/.test(t)) ticketOk = !!(await env.DB.prepare("DELETE FROM world_tickets WHERE ticket = ? AND player_id = ? AND expires_at > ? RETURNING 1 AS ok").bind(t, id, Date.now()).first());
    } catch (e) { owned = true; }
    if (owned && !ticketOk) return new Response("This player needs its sign-in", { status: 401 });
    // RB World's switches and the block list, from RB Command
    let open = true, combat = true, banned = false;
    try {
      const cfg = Object.fromEntries(((await env.DB.prepare("SELECT key, value FROM badge_config WHERE key IN ('world_open', 'world_combat')").all()).results || []).map((r) => [r.key, String(r.value).trim().toLowerCase()]));
      open = cfg.world_open !== "off"; combat = cfg.world_combat !== "off";
      banned = !!(await env.DB.prepare("SELECT 1 AS b FROM world_bans WHERE id = ?").bind(id).first());
    } catch (e) {}
    if (!open) return new Response("RB World is closed", { status: 403 });
    const stub = env.ROOMS.get(env.ROOMS.idFromName(m[1]));
    const fwd = new URL(request.url);
    fwd.searchParams.set("banned", banned ? "1" : "0"); fwd.searchParams.set("combat", combat ? "1" : "0");
    return stub.fetch(new Request(fwd, request));
  },
};

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env;
    this.players = new Map(); // socket -> player (rebuilt from the sockets' attachments after the room sleeps)
    for (const ws of ctx.getWebSockets()) { const p = ws.deserializeAttachment(); if (p) this.players.set(ws, p); }
  }
  async fetch(request) {
    const url = new URL(request.url);
    const id = url.searchParams.get("id"), name = clean(url.searchParams.get("name"), 20) || "Player";
    if (this.players.size >= MAX_PLAYERS) return new Response("Room full", { status: 503 });
    // the same player in another tab: the old connection goes
    for (const [ws, p] of this.players) if (p.id === id) { try { ws.close(4000, "Opened somewhere else"); } catch (e) {} this.players.delete(ws); }
    const pair = new WebSocketPair(), [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const p = { id, name, banned: url.searchParams.get("banned") === "1", fights: url.searchParams.get("combat") === "1", s: null, combat: false, alive: true, last: {}, lastBy: null, n: 0, win: Date.now(), hp: 100, ar: 0, hitAt: 0, armed: false };
    server.serializeAttachment(p); this.players.set(server, p);
    const others = [...this.players.values()].filter((o) => o !== p && o.s && !o.banned).map((o) => ({ id: o.id, name: o.name, ...o.s }));
    server.send(JSON.stringify({ t: "hello", you: id, fights: p.fights, players: others }));
    return new Response(null, { status: 101, webSocket: client });
  }
  send(ws, msg) { try { ws.send(msg); } catch (e) {} }
  everyone(msg, except) { const s = JSON.stringify(msg); for (const ws of this.players.keys()) if (ws !== except) this.send(ws, s); }
  socketOf(id) { for (const [ws, p] of this.players) if (p.id === id) return ws; return null; }
  async webSocketMessage(ws, raw) {
    const p = this.players.get(ws); if (!p) return;
    // at most 40 messages a second from anyone
    const now = Date.now(); if (now - p.win > 1000) { p.win = now; p.n = 0; } if (++p.n > 40) return;
    let m; try { m = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)); } catch (e) { return; }
    if (!m || typeof m !== "object") return;
    if (m.t === "s") {
      // where you are: in the car (m "c") or on foot (m "f"), with the car you left when you're on foot
      const s = { x: num(m.x, -5e4, 5e4), z: num(m.z, -5e4, 5e4), h: num(m.h, -50, 50), v: num(m.v, -80, 80), m: m.m === "f" ? "f" : "c",
        w: ARMS[m.w] ? m.w : null, aim: !!m.aim, c: !!m.c && p.fights && !p.banned, hp: num(m.hp, 0, 200), col: /^#[0-9a-f]{6}$/i.test(m.col || "") ? m.col : null,
        lk: typeof m.lk === "string" && /^[a-z0-9,]{1,48}$/.test(m.lk) ? m.lk : null,
        car: Array.isArray(m.car) && m.car.length === 3 ? m.car.map((v, i) => num(v, i === 2 ? -50 : -5e4, i === 2 ? 50 : 5e4)) : null };
      p.s = s; p.combat = s.c;
      if (p.alive === false && m.spawn) { p.alive = true; p.hp = 100; p.ar = Math.min(100, num(m.ar, 0, 100)); }
      else if (p.alive) {
        // what the player says: lower is believed (a crew hit them), higher only up to half after 6 s without a hit
        if (m.hp != null && Number.isFinite(Number(m.hp))) {
          const rep = num(m.hp, 0, 100);
          if (rep < p.hp) p.hp = rep; else if (p.hp < 50 && now - p.hitAt > 6000) p.hp = Math.min(50, rep);
        }
        if (m.ar != null && Number.isFinite(Number(m.ar))) { const ar = num(m.ar, 0, 100); if (!p.armed) { p.ar = ar; p.armed = true; } else if (ar < p.ar) p.ar = ar; } // armour: set once per life, then only down
      }
      ws.serializeAttachment(p);
      if (!p.banned) this.everyone({ t: "p", id: p.id, name: p.name, ...s }, ws);
      return;
    }
    if (m.t === "f") {
      // a shot: everyone sees it; if it names a target, check it could have landed and tell the target
      if (!p.s || p.banned || !p.combat || !p.alive) return;
      const w = ARMS[m.w]; if (!w) return;
      const a = Array.isArray(m.a) && m.a.length === 3 ? m.a.map((v) => num(v, -5e4, 5e4)) : null, b = Array.isArray(m.b) && m.b.length === 3 ? m.b.map((v) => num(v, -5e4, 5e4)) : null;
      if (a && b) this.everyone({ t: "f", from: p.id, a, b, w: m.w }, ws);
      if (!m.to) return;
      const last = p.last[m.w] || 0; if (now - last < w.gap * 1000 * 0.7) return; p.last[m.w] = now;
      const tws = this.socketOf(String(m.to)), t = tws && this.players.get(tws);
      if (!t || !t.s || t.banned || !t.combat || !t.alive || t.id === p.id) return;
      if (Math.hypot(t.s.x - p.s.x, t.s.z - p.s.z) > w.range + SLACK) return;
      const d = Math.round(num(m.d, 0, w.dmg * 2.5));
      if (!d) return;
      t.lastBy = { id: p.id, name: p.name, w: m.w, at: now };
      const soak = Math.min(t.ar, Math.round(d * 0.7)); t.ar -= soak; t.hp = Math.max(0, t.hp - (d - soak)); t.hitAt = now;
      this.send(tws, JSON.stringify({ t: "hit", by: p.id, name: p.name, d, hd: !!m.hd, w: m.w, hp: t.hp, ar: t.ar, from: [p.s.x, p.s.z] }));
      if (t.hp <= 0) { t.alive = false; t.armed = false; this.everyone({ t: "kill", id: t.id, name: t.name, by: p.id, byName: p.name, w: m.w }); }
      tws.serializeAttachment(t);
      return;
    }
    if (m.t === "dead") {
      // you went down: the last player who hit you in the last 10 seconds gets it
      if (!p.alive) return;
      p.alive = false; p.armed = false; p.hp = 0; ws.serializeAttachment(p);
      const by = p.lastBy && now - p.lastBy.at < 10000 ? p.lastBy : null;
      this.everyone({ t: "kill", id: p.id, name: p.name, by: by ? by.id : null, byName: by ? by.name : null, w: by ? by.w : null });
      return;
    }
  }
  async webSocketClose(ws) { this.leave(ws); }
  async webSocketError(ws) { this.leave(ws); }
  leave(ws) { const p = this.players.get(ws); if (!p) return; this.players.delete(ws); if (!p.banned) this.everyone({ t: "bye", id: p.id }); try { ws.close(1000, "bye"); } catch (e) {} }
}
