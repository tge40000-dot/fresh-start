// RB World live: other players move smoothly, on foot or driving, through a WebSocket to the live room
// (rb-world-live, a Cloudflare Durable Object). About eight times a second you send where you are; everyone else's
// moves come straight back. If the live room can't be reached the game carries on with the beat every few seconds
// (rb_world.js), as before.
//   - Driving players: their car (race.js draws the cars, with their paint and name).
//   - Players on foot: a person with their name over their head, walking or running, holding their weapon if they
//     have combat on; their car stays parked where they left it.
//   - Fights (combat.js, 18+ opt-in on both sides): your hits on them go to the room, which checks them; their hits
//     on you come back and you take the damage; the kill feed shows who took out whom.
import { person, pose, gun, tag, fromLook } from "./char.js";
import { model } from "./combat.js";

export const LIVE_URL = "wss://rb-world-live.tge40000.workers.dev/room/rb-city-1";
const SEND_MS = 125;

export function initLive(E, ctx, foot, combat) {
  const car = E.car, P = ctx.player, scene = ctx.scene;
  const peers = new Map(); // id -> { name, s, at, x, z, h, v, mesh, weapon }
  const out = { connected: false, peers, recent: [], fresh: (id) => { const p = peers.get(id); return !!(p && performance.now() - p.at < 3000); } };
  let ws = null, tries = 0, lastSent = "", lastAt = 0, spawn = false, hits = [], shotFx = null, lastBy = null;

  function connect() {
    if (ws || document.hidden) return;
    const url = LIVE_URL + "?id=" + encodeURIComponent(P.id) + "&name=" + encodeURIComponent(P.name || "Player");
    try { ws = new WebSocket(url); } catch (e) { ws = null; return retry(); }
    ws.onopen = () => { tries = 0; out.connected = true; lastSent = ""; };
    ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } onMessage(m); };
    ws.onclose = () => { ws = null; out.connected = false; for (const id of [...peers.keys()]) drop(id); retry(); };
    ws.onerror = () => { try { ws && ws.close(); } catch (e) {} };
  }
  function retry() { tries++; setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(tries, 5))); }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) connect(); else if (ws) { try { ws.close(1000, "hidden"); } catch (e) {} } });

  // ---------------------------------------------------------------- what others are doing
  function onMessage(m) {
    if (m.t !== "p") { out.recent.push(m.t); if (out.recent.length > 20) out.recent.shift(); } // what came in lately, for checking
    if (m.t === "hello") { for (const p of m.players || []) see(p); return; }
    if (m.t === "p") return see(m);
    if (m.t === "bye") return drop(m.id);
    if (m.t === "f") { if (combat) combat.remoteShot(m.a, m.b, m.w); return; }
    if (m.t === "hit") { if (combat && combat.on) { lastBy = m.name; if (m.hp != null) combat.remoteHit(m.hp, m.ar, m.name, m.from); else combat.hurt(m.d, m.name); } return; }
    if (m.t === "kill") {
      if (m.by && m.by === P.id) { P.kills = (P.kills || 0) + 1; P.streak = (P.streak || 0) + 1; if (combat) { combat.feed(`🎯 You took out ${m.name}`); combat.streakUp(); } }
      else if (m.id === P.id) { if (combat) combat.feed(`☠️ ${m.byName || "Someone"} took you out`); }
      else if (combat && combat.on) combat.feed(m.byName ? `${m.byName} took out ${m.name}` : `${m.name} went down`);
      const p = peers.get(m.id); if (p) p.down = performance.now();
      return;
    }
  }
  const lvl = (id) => { const g = window.RBRace && window.RBRace.ghosts && window.RBRace.ghosts.get(id); return g ? g.level : 1; }; // the level the beat last said
  function see(m) {
    if (!m || !m.id || m.id === P.id) return;
    let p = peers.get(m.id);
    if (!p) { p = { name: m.name, x: m.x, z: m.z, h: m.h, v: 0, mesh: null, weapon: null }; peers.set(m.id, p); }
    p.name = m.name || p.name; p.s = m; p.at = performance.now();
    if (m.m === "f") {
      // on foot: a person, and their car parked where they left it
      // in the clothes they picked (wardrobe.js); a new look swaps the figure
      if (p.mesh && m.lk && p.lk !== m.lk) { scene.remove(p.mesh); p.mesh = null; p.weapon = null; }
      if (!p.mesh) { p.lk = m.lk || null; p.mesh = person(m.lk ? fromLook(m.lk) : { top: m.col ? parseInt(m.col.slice(1), 16) : 0x333333 }); tag(p.mesh, p.name); scene.add(p.mesh); if (p.x == null) { p.x = m.x; p.z = m.z; } }
      if (window.RBRace && window.RBRace.see && m.car) window.RBRace.see(m.id, p.name, lvl(m.id), m.col, [m.car[0], m.car[1], m.car[2], 0], false);
      const want = m.c && m.w ? m.w : null;
      if (want !== p.weapon) { p.weapon = want; gun(p.mesh, want ? model(want) : null); }
    } else {
      if (p.mesh) { scene.remove(p.mesh); p.mesh = null; p.weapon = null; }
      if (window.RBRace && window.RBRace.see) window.RBRace.see(m.id, p.name, lvl(m.id), m.col, [m.x, m.z, m.h, m.v], false);
    }
    // a target for your shots while they're on foot with combat on
    if (combat) { if (m.m === "f") combat.remote.set(m.id, { x: p.x, z: p.z, y: 0, combat: !!m.c, alive: !(p.down && performance.now() - p.down < 3500) }); else combat.remote.delete(m.id); }
  }
  function drop(id) {
    const p = peers.get(id); if (!p) return;
    if (p.mesh) scene.remove(p.mesh);
    peers.delete(id); if (combat) combat.remote.delete(id);
  }

  // ---------------------------------------------------------------- you, to the room
  function send(o) { if (ws && ws.readyState === 1) { try { ws.send(JSON.stringify(o)); } catch (e) {} } }
  function state() {
    const f = foot && foot.on, paint = car.mesh && car.mesh.userData.paint ? "#" + car.mesh.userData.paint.color.getHexString() : null;
    const s = { t: "s", x: +car.x.toFixed(2), z: +car.z.toFixed(2), h: +car.heading.toFixed(3), v: +(car.speed || 0).toFixed(1), m: f ? "f" : "c", col: paint,
      w: combat && combat.on && f ? combat.armed : null, aim: !!(f && foot.aim), c: !!(combat && combat.on), hp: Math.round(P.health || 0), ar: Math.round(P.armor || 0),
      lk: foot && foot.look ? foot.look() : null,
      car: f && foot.parked ? [+foot.parked.x.toFixed(2), +foot.parked.z.toFixed(2), +foot.parked.h.toFixed(3)] : null };
    if (spawn) { s.spawn = 1; spawn = false; }
    return s;
  }
  if (combat) {
    combat.onRemoteHit = (id, d, hd, w) => hits.push({ to: id, d, hd, w });
    combat.onShot = (a, b, w) => { shotFx = { a: [a.x, a.y, a.z].map((v) => +v.toFixed(2)), b: [b.x, b.y, b.z].map((v) => +v.toFixed(2)), w }; };
    combat.onDeath.push(() => { send({ t: "dead" }); setTimeout(() => { spawn = true; }, 3700); });
  }
  function flush() {
    // shots this frame: one message per target (pellets added up), the first carrying the tracer for everyone
    if (!hits.length && !shotFx) return;
    const by = new Map(); for (const h of hits) { const o = by.get(h.to) || { ...h, d: 0 }; o.d += h.d; o.hd = o.hd || h.hd; by.set(h.to, o); }
    let fx = shotFx;
    if (!by.size && fx) send({ t: "f", ...fx });
    for (const h of by.values()) { send({ t: "f", to: h.to, d: h.d, hd: h.hd, w: h.w, ...(fx || { w: h.w }) }); fx = null; }
    hits = []; shotFx = null;
  }

  // ---------------------------------------------------------------- every frame
  ctx.onFrame((dt) => {
    dt = Math.min(dt, 0.1);
    const now = performance.now();
    flush();
    if (ws && ws.readyState === 1 && now - lastAt > SEND_MS) {
      const s = state(), k = JSON.stringify(s);
      if (k !== lastSent || now - lastAt > 1000) { send(s); lastSent = k; lastAt = now; }
    }
    // people on foot: ease towards where they were last seen, carried on by their speed
    for (const [id, p] of peers) {
      if (now - p.at > 15000) { drop(id); continue; }
      if (!p.mesh || !p.s) continue;
      const s = p.s, age = Math.min(0.5, (now - p.at) / 1000);
      const tx = s.x + Math.sin(s.h) * s.v * age, tz = s.z + Math.cos(s.h) * s.v * age, k = Math.min(1, dt * 10);
      p.x += (tx - p.x) * k; p.z += (tz - p.z) * k;
      let dh = s.h - p.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); p.h += dh * k;
      p.mesh.position.set(p.x, 0, p.z); p.mesh.rotation.y = p.h;
      p.mesh.userData.aiming = !!(s.aim && s.w);
      const down = p.down && now - p.down < 3500;
      pose(p.mesh, down ? "down" : Math.abs(s.v) > 5 ? "run" : Math.abs(s.v) > 0.4 ? "walk" : "idle", dt, Math.abs(s.v));
      const r = combat && combat.remote.get(id); if (r) { r.x = p.x; r.z = p.z; r.alive = !down; }
    }
  });
  connect();
  return out;
}
