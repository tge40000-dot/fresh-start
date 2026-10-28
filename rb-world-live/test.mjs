// Usage: node --no-warnings rb-world-live/test.mjs
// rb-world-live: who can join, moves passed on, shots refereed (combat on both sides, range, fire rate, damage cap),
// kills credited, blocked players kept out of sight, the same player in two tabs.
import assert from "node:assert/strict";
const W = await import(new URL("./index.js", import.meta.url));

// --- the front door
const cfg = { world_open: "on", world_combat: "on" }, bans = new Set(), owned = new Set(), tickets = new Map(); // ticket -> [player, expires]
let dbDown = false;
const first = async (sql, a) => {
  if (dbDown) throw new Error("D1 down");
  if (sql.includes("world_accounts")) return owned.has(a[0]) ? { a: 1, g: null } : { a: null, g: null };
  if (sql.includes("DELETE FROM world_tickets")) { const t = tickets.get(a[0]); if (t && t[0] === a[1] && t[1] > a[2]) { tickets.delete(a[0]); return { ok: 1 }; } return null; }
  return sql.includes("world_bans") && bans.has(a[0]) ? { b: 1 } : null;
};
const env = {
  DB: { prepare: (sql) => ({ bind: (...a) => ({ first: () => first(sql, a) }), all: async () => ({ results: Object.entries(cfg).map(([key, value]) => ({ key, value })) }) }) },
  ROOMS: { idFromName: (n) => n, get: (n) => ({ fetch: async (req) => { const u = new URL(req.url); return new Response(JSON.stringify({ room: n, banned: u.searchParams.get("banned"), combat: u.searchParams.get("combat") })); } }) },
};
const ask = (path, h = {}) => W.default.fetch(new Request("https://live.example" + path, { headers: { Upgrade: "websocket", Origin: "https://relentlessbillionaire.com", ...h } }), env);
assert.equal((await ask("/room/rb-city-1?id=aaaaaaaa-1111")).status, 200);
assert.deepEqual(await (await ask("/room/rb-city-1?id=aaaaaaaa-1111")).json(), { room: "rb-city-1", banned: "0", combat: "1" });
assert.equal((await ask("/room/rb-city-1?id=bad")).status, 400, "player ids like the game's");
assert.equal((await ask("/room/rb-city-1?id=aaaaaaaa-1111", { Origin: "https://evil.example" })).status, 403, "only RB's own pages");
assert.equal((await W.default.fetch(new Request("https://live.example/room/rb-city-1?id=aaaaaaaa-1111"), env)).status, 426, "WebSockets only");
assert.equal((await ask("/nope")).status, 404);
assert.equal((await W.default.fetch(new Request("https://live.example/health"), env)).status, 200);
bans.add("bbbbbbbb-2222"); cfg.world_combat = "off";
assert.deepEqual(await (await ask("/room/rb-city-1?id=bbbbbbbb-2222")).json(), { room: "rb-city-1", banned: "1", combat: "0" }, "the block list and the combat switch go to the room");
cfg.world_open = "off"; assert.equal((await ask("/room/rb-city-1?id=aaaaaaaa-1111")).status, 403, "RB World switched off: nobody joins");
cfg.world_open = "on"; cfg.world_combat = "on";
// a player tied to an RB account or a device joins only with its one-use ticket
owned.add("cccccccc-3333"); const T = "d".repeat(64);
assert.equal((await ask("/room/rb-city-1?id=cccccccc-3333")).status, 401, "no ticket, no entry");
tickets.set(T, ["aaaaaaaa-1111", Date.now() + 60000]);
assert.equal((await ask("/room/rb-city-1?id=cccccccc-3333&t=" + T)).status, 401, "someone else's ticket");
tickets.set(T, ["cccccccc-3333", Date.now() - 1]);
assert.equal((await ask("/room/rb-city-1?id=cccccccc-3333&t=" + T)).status, 401, "an old ticket");
tickets.set(T, ["cccccccc-3333", Date.now() + 60000]);
assert.equal((await ask("/room/rb-city-1?id=cccccccc-3333&t=" + T)).status, 200, "its own ticket");
assert.equal((await ask("/room/rb-city-1?id=cccccccc-3333&t=" + T)).status, 401, "used once only");
dbDown = true; assert.equal((await ask("/room/rb-city-1?id=aaaaaaaa-1111")).status, 401, "can't check: wait and try again"); dbDown = false;

// --- the room (sockets stood in for)
class Sock { constructor() { this.out = []; this.att = null; this.closed = null; } send(s) { this.out.push(JSON.parse(s)); } serializeAttachment(a) { this.att = structuredClone(a); } deserializeAttachment() { return this.att; } close(c, r) { this.closed = [c, r]; } last(t) { return [...this.out].reverse().find((m) => m.t === t); } }
const room = new W.Room({ getWebSockets: () => [], acceptWebSocket() {} }, env);
const join = (id, name, extra = {}) => { const ws = new Sock(); const p = { id, name, banned: false, fights: true, s: null, combat: false, alive: true, last: {}, lastBy: null, n: 0, win: Date.now(), hp: 100, ar: 0, hitAt: 0, armed: false, ...extra }; ws.serializeAttachment(p); room.players.set(ws, p); return ws; };
const say = (ws, m) => room.webSocketMessage(ws, JSON.stringify(m));
const A = join("aaaaaaaa-1111", "Ace"), B = join("bbbbbbbb-2222", "Bree"), X = join("xxxxxxxx-9999", "Hidden", { banned: true });
// moves go to everyone else, cleaned
await say(A, { t: "s", x: 10, z: 5, h: 1, v: 3, m: "f", w: "rifle", c: true, col: "#C9A84C", lk: "t2,j0,p1,s3,h0,c0,b1,k2", car: [8, 5, 0] });
assert.deepEqual(B.last("p"), { t: "p", id: "aaaaaaaa-1111", name: "Ace", x: 10, z: 5, h: 1, v: 3, m: "f", w: "rifle", aim: false, c: true, hp: 0, col: "#C9A84C", lk: "t2,j0,p1,s3,h0,c0,b1,k2", car: [8, 5, 0] });
assert.equal(A.last("p"), undefined, "not echoed back");
await say(A, { t: "s", x: 1e9, z: "x", h: 0, m: "boat", w: "laser", col: "red", lk: "<script>" });
assert.deepEqual([B.last("p").x, B.last("p").z, B.last("p").m, B.last("p").w, B.last("p").col, B.last("p").lk], [2e5, 0, "c", null, null, null], "numbers clamped, junk dropped");
// a blocked player: their moves go nowhere
await say(X, { t: "s", x: 1, z: 1, h: 0, m: "c" });
assert.ok(!A.out.some((m) => m.id === "xxxxxxxx-9999") && !B.out.some((m) => m.id === "xxxxxxxx-9999"), "blocked players aren't seen");
// shots: both need combat on, in range, not too fast
await say(A, { t: "s", x: 0, z: 0, h: 0, m: "f", w: "pistol", c: true });
await say(B, { t: "s", x: 0, z: 30, h: 0, m: "f", w: "pistol", c: false });
await say(A, { t: "f", to: "bbbbbbbb-2222", d: 26, w: "pistol", a: [0, 1.5, 0], b: [0, 1.4, 30] });
assert.equal(B.last("hit"), undefined, "the target has combat off: no hit");
assert.deepEqual(B.last("f"), { t: "f", from: "aaaaaaaa-1111", a: [0, 1.5, 0], b: [0, 1.4, 30], w: "pistol" }, "but everyone sees the shot");
await say(B, { t: "s", x: 0, z: 30, h: 0, m: "f", w: "pistol", c: true });
A.att.last = {}; room.players.get(A).last = {};
await say(A, { t: "f", to: "bbbbbbbb-2222", d: 9999, hd: true, w: "pistol" });
assert.deepEqual(B.last("hit"), { t: "hit", by: "aaaaaaaa-1111", name: "Ace", d: 65, hd: true, w: "pistol", hp: 35, ar: 0, from: [0, 0] }, "damage capped at a head shot's worth; the room keeps the health");
// health the player reports: higher is ignored, lower is believed
await say(B, { t: "s", x: 0, z: 30, h: 0, m: "f", c: true, hp: 100 });
assert.equal(room.players.get(B).hp, 35, "can't heal yourself by saying so");
await say(B, { t: "s", x: 0, z: 30, h: 0, m: "f", c: true, hp: 30 });
assert.equal(room.players.get(B).hp, 30, "a crew hit in a mission lowers it");
room.players.get(B).hitAt = Date.now() - 7000;
await say(B, { t: "s", x: 0, z: 30, h: 0, m: "f", c: true, hp: 80 });
assert.equal(room.players.get(B).hp, 50, "back up to half after a while without hits, no further");
const hits = () => B.out.filter((m) => m.t === "hit").length, n0 = hits();
await say(A, { t: "f", to: "bbbbbbbb-2222", d: 26, w: "pistol" });
assert.equal(hits(), n0, "faster than a pistol can fire: ignored");
room.players.get(A).last = {};
await say(B, { t: "s", x: 0, z: 200, h: 0, m: "f", c: true });
await say(A, { t: "f", to: "bbbbbbbb-2222", d: 26, w: "pistol" });
assert.equal(hits(), n0, "out of the pistol's range: no hit");
room.players.get(A).last = {};
await say(A, { t: "f", to: "bbbbbbbb-2222", d: 130, w: "sniper" });
assert.equal(hits(), n0 + 1, "a sniper reaches");
// at zero health the room calls it: the shooter gets the kill
assert.deepEqual(A.last("kill"), { t: "kill", id: "bbbbbbbb-2222", name: "Bree", by: "aaaaaaaa-1111", byName: "Ace", w: "sniper" });
assert.equal(B.last("hit").hp, 0);
const kills = A.out.filter((m) => m.t === "kill").length; await say(B, { t: "dead" });
assert.equal(A.out.filter((m) => m.t === "kill").length, kills, "saying you're down again changes nothing");
room.players.get(A).last = {};
await say(A, { t: "f", to: "bbbbbbbb-2222", d: 26, w: "sniper" });
assert.equal(hits(), n0 + 1, "no hits on someone who's down");
await say(B, { t: "s", x: 0, z: 20, h: 0, m: "f", c: true, spawn: 1 });
assert.equal(room.players.get(B).alive, true, "back after respawning"); assert.equal(room.players.get(B).hp, 100);
// armour soaks 70% of a hit and only goes down
await say(B, { t: "s", x: 0, z: 20, h: 0, m: "f", c: true, hp: 100, ar: 50 }); room.players.get(A).last = {};
await say(A, { t: "f", to: "bbbbbbbb-2222", d: 26, w: "pistol" });
assert.deepEqual([B.last("hit").hp, B.last("hit").ar], [92, 32]);
await say(B, { t: "s", x: 0, z: 20, h: 0, m: "f", c: true, hp: 92, ar: 100 });
assert.equal(room.players.get(B).ar, 32, "armour can't be topped up mid-life");
// the room switch: combat off for everyone
const C = join("cccccccc-3333", "Cam", { fights: false });
await say(C, { t: "s", x: 0, z: 5, h: 0, m: "f", c: true, w: "rifle" });
assert.equal(room.players.get(C).combat, false, "combat switched off in RB Command: can't turn it on");
// leaving
await room.webSocketClose(C);
assert.deepEqual(A.last("bye"), { t: "bye", id: "cccccccc-3333" });
// too many messages: the extra ones are dropped
const before = B.out.length; for (let i = 0; i < 60; i++) await say(A, { t: "s", x: i, z: 0, h: 0, m: "c" });
assert.ok(B.out.length - before <= 40, "40 a second at most");
console.log("rb-world-live ok: front door (origin, ids, open, bans, combat switch, one-use tickets for protected players), moves relayed and cleaned, blocked players unseen, shots checked (combat on both sides, range, fire rate, damage cap), health kept by the room (armour, regain to half, no self-healing), kills credited, respawn, leave, rate limit");
