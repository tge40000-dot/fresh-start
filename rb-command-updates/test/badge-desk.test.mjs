// Usage: node --no-warnings rb-command-updates/test/badge-desk.test.mjs <patched rb-command dir>
// The Badge desk against an in-memory DB: signed QR tokens (good, out of date, forged), lookups, door check-ins once
// per event, points by hand, hand-given achievements, reward requests (reject gives points and stock back), and the
// page, routes, tables and nav the patch adds.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { fakeD1 } from "../../rb-surface/test/fake-d1.mjs";

const dir = process.argv[2];
const DB = fakeD1();
DB.batch = async (stmts) => {
  DB.raw.exec("BEGIN");
  try {
    const out = [];
    for (const s of stmts) out.push(/^\s*(SELECT|WITH)\b/i.test(s.sql) || /\bRETURNING\b/i.test(s.sql) ? await s.all() : await s.run());
    DB.raw.exec("COMMIT");
    return out;
  } catch (e) { DB.raw.exec("ROLLBACK"); throw e; }
};
DB.raw.exec(`CREATE TABLE command_log (id INTEGER PRIMARY KEY, actor TEXT, action TEXT, target TEXT, detail TEXT, created_at TEXT DEFAULT (datetime('now')));
CREATE TABLE rb_events (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, starts_at TEXT NOT NULL, venue_name TEXT, status TEXT DEFAULT 'live');
INSERT INTO rb_events (title, starts_at, venue_name) VALUES ('RB Comedy Night', datetime('now', '+2 hours'), 'The Room'), ('Old show', datetime('now', '-30 days'), 'Gone');`);
const env = { DB };
const desk = await import(join(dir, "badgedesk.js"));
const who = { email: "door@rb.test" };
const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
const one = (q, ...a) => DB.raw.prepare(q).get(...a);
const rejects = (p, re) => assert.rejects(p, (e) => re.test(e.message));

// ---- off: tables are made on first use, and nothing can be given yet
let s = await desk.summary(env);
assert.equal(s.on, false); assert.equal(s.checkin, 100);
assert.deepEqual(s.events.map((e) => e.title), ["RB Comedy Night"], "upcoming RB Events for the picker");
const secret = "ab".repeat(32);
sql("INSERT INTO badge_members (id, clerk_user_id, email_norm, display_name, pass_code, pass_secret, created_at) VALUES ('m_alice', 'u_alice', 'alice@example.com', 'Alice', 'ABCDEFGHJKLM', ?, datetime('now'))", secret);
const tok = (minute, sec = secret) => `RBB1.ABCDEFGHJKLM.${minute}.${createHmac("sha256", sec).update(`RBB1.ABCDEFGHJKLM.${minute}`).digest("hex").slice(0, 24)}`;
const nowMin = Math.floor(Date.now() / 60000);
await rejects(desk.checkin(env, who, { member_id: "m_alice", event_id: 1 }), /switched off/);

// ---- tokens
assert.equal((await desk.checkToken(env, tok(nowMin))).state, "ok");
assert.equal((await desk.checkToken(env, tok(nowMin - 30))).state, "expired", "an old screenshot");
assert.equal((await desk.checkToken(env, tok(nowMin, "cd".repeat(32)))).state, "bad", "forged signature");
assert.equal((await desk.checkToken(env, "https://example.com")).state, "bad");
let r = await desk.lookup(env, { token: tok(nowMin) });
assert.equal(r.token, "ok"); assert.equal(r.member.name, "Alice"); assert.equal(r.member.code, "ABCD-EFGH-JKLM"); assert.equal(r.member.level, null);
assert.ok(!JSON.stringify(r).includes(secret), "the pass secret never leaves the server");
assert.equal((await desk.lookup(env, { q: "ALICE@" })).members[0].id, "m_alice");
assert.equal((await desk.lookup(env, { q: "abcd-efgh-jklm" })).members[0].id, "m_alice", "by pass code");
assert.equal((await desk.lookup(env, { q: "100%" })).members.length, 0, "LIKE wildcards are literal");
await rejects(desk.lookup(env, { q: "a" }), /at least 2/);

// ---- switched on: check in once per event
sql("UPDATE badge_config SET value='on' WHERE key='enabled'");
sql("UPDATE badge_levels SET status='live', perks='Early tickets.' WHERE level_key='bronze'");
sql("UPDATE badge_levels SET status='live', perks='Guest list.', min_points=150 WHERE level_key='gold'");
s = await desk.summary(env);
assert.equal(s.on, true);
r = await desk.checkin(env, who, { member_id: "m_alice", event_id: 1, points: "" });
assert.equal(r.already, false); assert.match(r.event, /^RB Comedy Night \(\d{4}-\d{2}-\d{2}\)$/);
assert.equal(r.member.lifetime, 100); assert.equal(r.member.checkins, 1); assert.equal(r.member.level.key, "bronze"); assert.ok(r.member.earned.includes("first_night"));
r = await desk.checkin(env, who, { member_id: "m_alice", event_id: 1, points: 500 });
assert.equal(r.already, true); assert.equal(r.member.lifetime, 100, "same event: nothing more");
await rejects(desk.checkin(env, who, { member_id: "m_alice", event_label: "Pop-up", points: 5000 }), /0 to 1000/);
await rejects(desk.checkin(env, who, { member_id: "m_alice", event_label: "x" }), /Pick an event/);
await rejects(desk.checkin(env, who, { member_id: "m_alice", event_id: 99 }), /isn't in RB Events/);
r = await desk.checkin(env, who, { member_id: "m_alice", event_label: "Rooftop Pop-up", points: 60 });
assert.equal(r.member.lifetime, 160); assert.equal(r.member.level.key, "gold"); assert.equal(r.member.level.perks, "Guest list.");
assert.equal(one("SELECT count(*) n FROM command_log WHERE action='badge.checkin'").n, 2);

// ---- by hand
await rejects(desk.adjust(env, who, { member_id: "m_alice", points: 50, note: "" }), /Say why/);
await rejects(desk.adjust(env, who, { member_id: "m_alice", points: 20000, note: "too much" }), /between 1 and 10000/);
r = await desk.adjust(env, who, { member_id: "m_alice", points: -10, note: "Double scan" });
assert.equal(r.member.lifetime, 150); assert.equal(r.member.recent[0].note, "Double scan"); assert.equal(r.member.recent[0].actor, "door@rb.test");
await rejects(desk.grant(env, who, { member_id: "m_alice", key: "founding" }), /hand-given/, "draft achievements can't be given");
sql("UPDATE badge_achievements SET status='live' WHERE key='founding'");
r = await desk.grant(env, who, { member_id: "m_alice", key: "founding" });
assert.ok(r.member.earned.includes("founding"));
r = await desk.grant(env, who, { member_id: "m_alice", key: "founding", on: false });
assert.ok(!r.member.earned.includes("founding"));
await rejects(desk.grant(env, who, { member_id: "m_alice", key: "regular" }), /hand-given/, "rule-based ones are earned, not given");

// ---- reward requests (made the way /api/badge/redeem makes them)
sql("INSERT INTO badge_rewards (id, name, description, cost, quantity, remaining, status) VALUES (7, 'RB hoodie', 'One hoodie.', 100, 2, 1, 'live')");
sql("INSERT INTO badge_points (id, member_id, source, source_ref, points, created_at) VALUES ('p1', 'm_alice', 'redeem', 'redeem:r_1', -100, datetime('now'))");
sql("INSERT INTO badge_redemptions (id, member_id, reward_id, reward_name, cost, status, email, created_at) VALUES ('r_1', 'm_alice', 7, 'RB hoodie', 100, 'requested', 'alice@example.com', datetime('now'))");
let list = (await desk.redemptions(env)).redemptions;
assert.equal(list[0].display_name, "Alice");
await rejects(desk.setRedemption(env, who, { id: "r_1", status: "requested" }), /can't be set/);
list = (await desk.setRedemption(env, who, { id: "r_1", status: "rejected", notes: "Out of size" })).redemptions;
assert.equal(list[0].status, "rejected"); assert.equal(list[0].handled_by, "door@rb.test");
assert.equal(one("SELECT points FROM badge_points WHERE source_ref='refund:r_1'").points, 100, "points back");
assert.equal(one("SELECT remaining FROM badge_rewards WHERE id=7").remaining, 2, "unit back");
await rejects(desk.setRedemption(env, who, { id: "r_1", status: "fulfilled" }), /can't be set/, "rejected is final");
assert.equal(one("SELECT count(*) n FROM badge_points WHERE source='refund'").n, 1, "refunded once");
r = await desk.lookup(env, { id: "m_alice" });
assert.equal(r.member.balance, 150); assert.equal(r.member.lifetime, 150, "redeem and refund don't touch the level");

// ---- page, routes, tables, nav
const html = desk.page("n0nce", true);
for (const tag of html.match(/<(script|style)\b[^>]*>/g)) assert.match(tag, /nonce="n0nce"/);
new Function(html.match(/<script nonce="n0nce">([\s\S]*?)<\/script>/)[1]);
assert.ok(!/\sstyle=|\son[a-z]+=/i.test(html), "no inline style or handlers");
assert.ok(desk.page("n0nce", false).includes('data-edit="0"'));
assert.match(desk.csp("x"), /script-src 'nonce-x'/); assert.doesNotMatch(desk.csp("x"), /unsafe/);
const js = await desk.jsqr().text();
assert.ok(js.includes("jsQR") && js.length > 200000); new Function(js);
const once = (src, x, what) => assert.equal(src.split(x).length - 1, 1, what);
const index = readFileSync(join(dir, "index.js"), "utf8"), ui = readFileSync(join(dir, "ui.js"), "utf8"), tables = readFileSync(join(dir, "tables.js"), "utf8"), authjs = readFileSync(join(dir, "auth.js"), "utf8");
for (const x of ['if (path === "/badge-desk") {', '"/badge-desk/jsqr.js"', 'if (path === "/api/badge-desk") {', '"/api/badge-desk/lookup"', '"/api/badge-desk/checkin"', '"/api/badge-desk/adjust"', '"/api/badge-desk/grant"', '"/api/badge-desk/redemption"', '"/api/badge-desk/redemptions"', "RB Badge reward requests", "const badgeDesk = "]) once(index, x, x);
once(ui, '["/badge-desk", "Badge desk"]', "nav entry"); once(ui, '"/badge-desk": "Shows & sites"', "nav section");
for (const t of ["badge_config: {", "badge_levels: {", "badge_rewards: {", "badge_achievements: {", 'import { BADGE_SCHEMA } from "./badge_schema.js";', '"Rewards", "Badges", "Settings"]']) once(tables, t, t);
once(authjs, '"Rewards", "Badges", "CRM"', "capability");
const T = (await import(join(dir, "tables.js"))).TABLES;
const errs = {}; await T.badge_levels.check(env, { status: "live" }, errs, "update", { perks: "DRAFT: x" });
assert.match(errs.perks, /before setting it live/);
const e2 = {}; await T.badge_config.check(env, { value: "on" }, e2, "update", { key: "enabled" });
assert.equal(e2.value, undefined, "can switch on with a live level");
sql("UPDATE badge_levels SET status='draft'");
const e3 = {}; await T.badge_config.check(env, { value: "on" }, e3, "update", { key: "enabled" });
assert.match(e3.value, /at least one level live/);
const e4 = {}; await T.badge_rewards.check(env, { min_level: "platinum", quantity: 1, remaining: 2 }, e4, "update", {});
assert.match(e4.min_level, /No level/); assert.match(e4.remaining, /more than Quantity/);
console.log("badge desk ok: tokens (good, old, forged), lookup, check-in once per event, levels and perks, by hand, achievements, reward requests with refunds, page, routes, tables, nav");
