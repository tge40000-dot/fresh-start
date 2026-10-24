// Usage: node --no-warnings rb-command-updates/test/world-admin.test.mjs <patched rb-command dir>
// RB World's controls in RB Command (/world): switches, the radio, players, moderation, lots and races.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const dir = process.argv[2];
const W = await import(join(dir, "worldadmin.js"));
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE command_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, action TEXT, target TEXT, detail TEXT, at TEXT DEFAULT (datetime('now')))");
for (const q of readFileSync(new URL("../../rb-site-updates/src/badge/schema.sql", import.meta.url), "utf8").split(/;\s*\n/).map((x) => x.trim()).filter(Boolean)) db.exec(q);
class Stmt { constructor(sql, a = []) { this.sql = sql; this.a = a; } bind(...a) { return new Stmt(this.sql, a); } async first() { return db.prepare(this.sql).get(...this.a) ?? null; }
  async all() { return { results: db.prepare(this.sql).all(...this.a) }; } async run() { const r = db.prepare(this.sql).run(...this.a); return { meta: { changes: r.changes } }; } }
const env = { DB: { prepare: (s) => new Stmt(s), batch: async (list) => { const out = []; db.exec("BEGIN"); try { for (const s of list) out.push(await s.run()); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return out; } } };
const who = { email: "owner@example.com" };
const iso = (ago) => new Date(Date.now() - ago).toISOString();
db.prepare("INSERT INTO world_players (id, name, clerk_user_id, net_worth, tokens, kills, deaths, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("p_alice1", "Alice", "u_a", 9000, 40, 3, 1, iso(30e3));
db.prepare("INSERT INTO world_players (id, name, net_worth, seen_at) VALUES (?, ?, ?, ?)").run("p_bob123", "Bob", 500, iso(5 * 3600e3));
db.prepare("INSERT INTO world_players (id, name, net_worth, seen_at) VALUES (?, ?, ?, ?)").run("p_old123", "Old", 99999, iso(40 * 864e5));
db.prepare("INSERT INTO world_chat (player_id, name, text, created_at) VALUES (?, ?, ?, ?)").run("p_bob123", "Bob", "spam spam", iso(60e3));
db.prepare("INSERT INTO world_chat (player_id, name, text, created_at) VALUES (?, ?, ?, ?)").run("p_alice1", "Alice", "gg", iso(30e3));
db.prepare("INSERT INTO world_lots (lot, owner_id, owner_name, business, level, title, updated_at) VALUES (4, 'p_alice1', 'Alice', 'club', 2, 'Gold Room', ?)").run(iso(0));
db.prepare("INSERT INTO world_races (id, track, host_id, host_name, solo, start_at, ends_at, created_at) VALUES ('race_1', 'downtown', 'p_alice1', 'Alice', 0, ?, ?, ?)").run(Date.now() - 60e3, Date.now() + 60e3, iso(60e3));
db.prepare("INSERT INTO world_race_entries (race_id, player_id, name, finish_ms) VALUES ('race_1', 'p_alice1', 'Alice', 51234), ('race_1', 'p_bob123', 'Bob', NULL)").run();
db.prepare("INSERT INTO world_race_best (k, track, player_id, name, ms, race_id, at) VALUES ('downtown:p_alice1', 'downtown', 'p_alice1', 'Alice', 51234, 'race_1', ?)").run(iso(0));
const radio = async () => new Response(JSON.stringify({ live: null, on_air: { title: "Midnight Wave", artist: "Relentless Billionaire", starts_at: Date.now() - 1000, duration_ms: 120000 } }));
// 1. the summary
let d = await W.summary(env, radio);
assert.deepEqual([d.players.total, d.players.online, d.players.day, d.players.week], [3, 1, 2, 2]);
assert.deepEqual(d.players.top.map((p) => p.name), ["Alice", "Bob"], "the last 30 days, richest first");
assert.equal(d.players.top[0].account, true);
assert.equal(d.settings.open, true); assert.equal(d.settings.radio, true); assert.equal(d.settings.notice, ""); assert.equal(d.settings.points.block, 5);
assert.deepEqual(d.radio, { live: false, title: "Midnight Wave", artist: "Relentless Billionaire", ends_at: d.radio.ends_at });
assert.equal(d.lots.owned, 1); assert.equal(d.lots.total, 32); assert.equal(d.races[0].racers, 2); assert.equal(d.races[0].finished, 1); assert.equal(d.bests[0].ms, 51234);
assert.equal((await W.summary(env, async () => new Response(JSON.stringify({ live: { title: "Comedy Night", host: "RB" } })))).radio.title, "Comedy Night");
assert.equal((await W.summary(env, async () => { throw new Error("down"); })).radio, null, "radio unreachable: shown as such, the page still loads");
// 1b. the billboards: live sponsor ads for Everywhere or RB World, inside their dates; views from the game
assert.deepEqual(d.billboards, { live: [], stats: [] }, "no ads table yet: the page still loads");
db.exec("CREATE TABLE ads (id INTEGER PRIMARY KEY, advertiser TEXT, headline TEXT, image_url TEXT, video_url TEXT, format TEXT, status TEXT, surface TEXT, weight INTEGER, starts_at TEXT, ends_at TEXT)");
db.exec("INSERT INTO ads (id, advertiser, headline, image_url, video_url, format, status, surface, weight, ends_at) VALUES (1, 'Acme', 'Big sale', 'https://x/a.jpg', NULL, 'image', 'live', 'all', 1, NULL), (2, 'Vid Co', 'Watch', NULL, 'https://x/v.mp4', 'video', 'live', 'world', 5, '2099-01-01'), (3, 'Radio Only', 'r', 'https://x/r.jpg', NULL, 'image', 'live', 'radio', 9, NULL), (4, 'Paused', 'p', 'https://x/p.jpg', NULL, 'image', 'paused', 'all', 9, NULL), (5, 'Ended', 'e', 'https://x/e.jpg', NULL, 'image', 'live', 'world', 9, '2020-01-01')");
db.exec(`INSERT INTO world_ad_stats (ad_id, day, impressions, viewable) VALUES (1, '${iso(864e5).slice(0, 10)}', 7, 5), (1, '${iso(0).slice(0, 10)}', 3, 2), (2, '${iso(0).slice(0, 10)}', 4, 1), (1, '${iso(60 * 864e5).slice(0, 10)}', 99, 99)`);
d = await W.summary(env, radio);
assert.deepEqual(d.billboards.live.map((a) => [a.advertiser, a.surface, a.video, a.image]), [["Vid Co", "world", true, false], ["Acme", "all", false, true]], "highest weight first; radio-only, paused and ended ads left out");
assert.deepEqual(d.billboards.stats.map((a) => [a.advertiser, a.views, a.viewable]), [["Acme", 10, 7], ["Vid Co", 4, 1]], "the last 30 days only");
// 2. switches: validated, saved to the rows the game reads, logged
let r = await W.saveSettings(env, who, { open: false, radio: false, notice: "  Comedy night\n Friday  ", points: { block: 10, minutes: 15, daily: 60 } });
assert.equal(r.changed.length, 6, JSON.stringify(r.changed));
const cfg = Object.fromEntries(db.prepare("SELECT key, value FROM badge_config WHERE key LIKE 'world_%'").all().map((x) => [x.key, x.value]));
assert.deepEqual([cfg.world_open, cfg.world_radio, cfg.world_notice, cfg.world_points_block, cfg.world_block_minutes, cfg.world_points_daily], ["off", "off", "Comedy night Friday", "10", "15", "60"]);
assert.deepEqual((await W.saveSettings(env, who, { open: false, radio: false })).changed, [], "no change, nothing written");
await assert.rejects(W.saveSettings(env, who, { points: { minutes: 0 } }), /1 to 1440/);
await assert.rejects(W.saveSettings(env, who, { points: { block: 2.5 } }), /whole number/);
assert.equal((await W.saveSettings(env, who, { notice: "x".repeat(500) })).changed.length, 1); assert.equal(db.prepare("SELECT value FROM badge_config WHERE key='world_notice'").get().value.length, 200);
await W.saveSettings(env, who, { open: true, radio: true });
// 3. moderation
await W.block(env, who, { id: "p_bob123", reason: "spam", delete_chat: true });
d = await W.summary(env, radio);
assert.equal(d.bans.length, 1); assert.equal(d.bans[0].name, "Bob"); assert.equal(d.players.top.find((p) => p.name === "Bob").blocked, true);
assert.deepEqual(d.chat.map((m) => m.text), ["gg"], "their chat deleted");
await assert.rejects(W.block(env, who, { id: "bad id!" }), /Pick a player/);
await W.unblock(env, who, { id: "p_bob123" }); assert.equal((await W.summary(env, radio)).bans.length, 0);
await assert.rejects(W.unblock(env, who, { id: "p_bob123" }), /isn't blocked/);
const msg = db.prepare("SELECT n FROM world_chat WHERE text = 'gg'").get().n;
await W.deleteChat(env, who, { n: msg }); await assert.rejects(W.deleteChat(env, who, { n: msg }), /already gone/);
// 4. lots
await W.releaseLot(env, who, { lot: 4 }); assert.equal((await W.summary(env, radio)).lots.owned, 0); await assert.rejects(W.releaseLot(env, who, { lot: 4 }), /Nobody owns/);
// 5. every change is logged
const acts = db.prepare("SELECT action FROM command_log").all().map((x) => x.action);
for (const a of ["world.settings", "world.block", "world.unblock", "world.chat_delete", "world.lot_release"]) assert.ok(acts.includes(a), a);
// 6. the page: strict CSP, buttons only for edit, the script parses
const p = W.page("n0nce", true), ro = W.page("n0nce", false);
assert.ok(p.includes('<script nonce="n0nce">') && W.csp("n0nce").includes("script-src 'nonce-n0nce'") && !W.csp("n0nce").includes("unsafe-inline"));
assert.ok(ro.includes("changing things needs Badges edit") && ro.includes("var EDIT = false"));
new Function(p.match(/<script nonce="n0nce">([\s\S]*?)<\/script>/)[1]);
// 7. wired in: routes, permissions, nav
const idx = readFileSync(join(dir, "index.js"), "utf8"), ui = readFileSync(join(dir, "ui.js"), "utf8");
assert.ok(idx.includes('if (path === "/world") {\n      needs(user, "Badges", "view");') && idx.includes('if (path === "/api/world-admin") { needs(user, "Badges", "view");'));
for (const a of ["settings", "chat-delete", "block", "unblock", "lot-release"]) assert.ok(idx.includes(`if (path === "/api/world-admin/${a}") { needs(user, "Badges", "edit");`), a);
assert.ok(ui.includes('NAV_TOP.push(["/world", "RB World"])'));
// an ad can be set to show in RB World only: in the Ads table and in the ad maker, and the server keeps it
const tables = readFileSync(join(dir, "tables.js"), "utf8"), aff = readFileSync(join(dir, "affiliate.js"), "utf8");
assert.ok(tables.includes('["all", "home", "radio", "tv", "world"]') && tables.includes('world: "RB World only (billboards and posters)"') && !tables.includes("don't show ads yet"));
assert.equal((tables.match(/surface: f\.pick\("Shows on"/g) || []).length, 1, "one Shows on field");
assert.ok(ui.includes('<option value="world">RB World only (billboards and posters)</option>') && !ui.includes("don\\'t show ads yet"));
assert.ok(aff.includes('const SURFACES = ["all", "home", "radio", "tv", "world"];'));
console.log("world admin ok: switches (validated, logged), car radio now playing, players, chat delete, block/unblock, lot release, races, billboards and their views, RB World only ads, page and routes");
