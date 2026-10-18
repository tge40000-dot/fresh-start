// Usage: node --no-warnings rb-command-updates/test/rewards-admin.test.mjs <patched rb-command dir>
// RB Command's Rewards section (RB Collect) against an in-memory D1 that has no reward tables yet: opening a section
// creates them, the owner's edits are checked, and nothing crashes.
import assert from "node:assert/strict";
import { join } from "node:path";
import { fakeD1 } from "../../rb-surface/test/fake-d1.mjs";

const dir = process.argv[2];
const T = await import(join(dir, "tables.js"));
const auth = await import(join(dir, "auth.js"));
const { renderPage } = await import(join(dir, "ui.js"));

const DB = fakeD1();
DB.batch = async (stmts) => { const out = []; for (const s of stmts) out.push(/^\s*SELECT\b/i.test(s.sql) || /\bRETURNING\b/i.test(s.sql) ? await s.all() : await s.run()); return out; };
DB.raw.exec("CREATE TABLE command_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, action TEXT, target TEXT, detail TEXT, created_at TEXT DEFAULT (datetime('now')))");
const env = { DB };
const who = { email: "owner@example.com" };
const P = (o = {}) => new URLSearchParams(o);

assert.ok(T.GROUPS.includes("Rewards") && T.GROUPS.indexOf("Rewards") < T.GROUPS.indexOf("Settings"));
for (const k of ["reward_prizes", "reward_codes", "reward_claims", "reward_config"]) assert.equal(T.TABLES[k].group, "Rewards", k);
const cfg = T.publicConfig();
assert.ok(cfg.reward_prizes && !("ensure" in cfg.reward_prizes) && !("check" in cfg.reward_prizes), "SQL and checks stay on the server");
assert.equal(auth.capabilities("owner").groups.Rewards, "edit", "owner can edit Rewards");

// Missing tables: the first list creates them (with the seeded drafts) instead of failing.
const prizes = await T.listRows(env, "reward_prizes", P());
assert.equal(prizes.total, 4);
assert.ok(prizes.rows.every((r) => r.status === "draft" && r.quantity === 0 && r.remaining === 0), "four draft prizes, quantity 0");
assert.deepEqual(prizes.rows.map((r) => r.set_label), ["Front Row", "Camera Ready", "Studio Time", "Merch Drop"]);
assert.equal((await T.listRows(env, "reward_claims", P({ status: "requested" }))).total, 0);
assert.equal((await T.listRows(env, "reward_codes", P())).total, 0);
const conf = await T.listRows(env, "reward_config", P());
assert.equal(conf.rows[0].key, "enabled"); assert.equal(conf.rows[0].value, "off");

// Prize edits are checked.
const front = prizes.rows[0];
await assert.rejects(T.updateRow(env, who, "reward_prizes", front.id, { values: { status: "live" } }), (e) => e.status === 400 && /DRAFT/.test(e.extra.errors.description));
await assert.rejects(T.updateRow(env, who, "reward_prizes", front.id, { values: { quantity: 2, remaining: 3 } }), (e) => /more than Quantity/.test(e.extra.errors.remaining));
const ok = await T.updateRow(env, who, "reward_prizes", front.id, { values: { name: "2 tickets to the RB show on Nov 20", description: "Two general admission tickets.", quantity: 2, remaining: 2, status: "live" } });
assert.equal(ok.row.status, "live"); assert.equal(ok.row.remaining, 2);
await assert.rejects(T.createRow(env, who, "reward_prizes", { values: { name: "x" } }), (e) => e.status === 405, "sets are fixed");

// Settings are checked.
const set = (key, value) => T.updateRow(env, who, "reward_config", key, { values: { value } });
await assert.rejects(set("enabled", "yes"), (e) => /on or off/.test(e.extra.errors.value));
await assert.rejects(set("rare_odds", "1"), (e) => /2 or more/.test(e.extra.errors.value));
await assert.rejects(set("ends_at", "next friday"), (e) => /date/.test(e.extra.errors.value));
await assert.rejects(set("eligibility", " "), (e) => /can't be empty/.test(e.extra.errors.value));
await set("ends_at", "2026-12-31");
await set("enabled", " on ");
assert.equal((await T.getRow(env, "reward_config", "enabled")).row.value, "on");
DB.raw.exec("UPDATE reward_prizes SET status = 'draft'");
await set("enabled", "off");
await assert.rejects(set("enabled", "on"), (e) => /at least one prize live/.test(e.extra.errors.value), "can't switch on with no live prize");

// Codes.
await assert.rejects(T.createRow(env, who, "reward_codes", { id: "show nov", values: { plays: 3, max_uses: 10 } }), (e) => e.status === 400);
const c = await T.createRow(env, who, "reward_codes", { id: "SHOW-NOV20", values: { label: "Nov 20 show check-in", plays: 3, max_uses: 150, expires_at: "2026-11-21T02:00" } });
assert.equal(c.row.uses, 0); assert.equal(c.row.expires_at, "2026-11-21T02:00:00-08:00", "expiry stored with the Pacific offset");
await assert.rejects(T.createRow(env, who, "reward_codes", { id: "SHOW-NOV20", values: { plays: 1, max_uses: 1 } }), (e) => /already exists/.test(e.extra.errors.code));

// Claims: status and notes only.
DB.raw.exec("INSERT INTO reward_claims (id, player_id, set_key, status, email, created_at) VALUES ('c_1', 'p_1', 'front_row', 'requested', 'fan@example.com', '2026-11-20T00:00:00Z')");
await T.updateRow(env, who, "reward_claims", "c_1", { values: { status: "approved", notes: "Called, ID checked", email: "x@y.z" } });
const claim = (await T.getRow(env, "reward_claims", "c_1")).row;
assert.equal(claim.status, "approved"); assert.equal(claim.email, "fan@example.com", "email is read only");
await assert.rejects(T.createRow(env, who, "reward_claims", { values: {} }), (e) => e.status === 405);
assert.match(await (await T.exportCsv(env, "reward_claims")).text(), /fan@example\.com/);

// A fresh database: getRow and createRow also create the tables.
const env2 = { DB: fakeD1() };
env2.DB.batch = async (stmts) => { const out = []; for (const s of stmts) out.push(/^\s*SELECT\b/i.test(s.sql) ? await s.all() : await s.run()); return out; };
await assert.rejects(T.getRow(env2, "reward_claims", "c_x"), (e) => e.status === 404);
assert.equal(env2.DB.raw.prepare("SELECT count(*) n FROM reward_pieces").get().n, 12);

// The page renders with the Rewards group in the nav config.
const user = { email: "owner@example.com", role: "owner" };
const caps = auth.capabilities("owner");
const html = renderPage("abc", { me: { ...user, caps }, links: {}, media: "", tables: cfg, groups: T.GROUPS.filter((g) => caps.groups[g]), uploads: false });
assert.ok(html.includes("reward_prizes") && html.includes('"Rewards"'));
console.log("RB Command Rewards ok: group and owner access, missing tables created with draft prizes, prize/settings/code checks, claims status-only, CSV, page config");
