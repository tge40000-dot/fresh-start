// Usage: node --no-warnings rb-command-updates/test/health.test.mjs <patched rb-command dir>
// The weekly health report: made at most once in 6.5 days, saved for the Overview, one line in Activity.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
const dir = process.argv[2];
const health = await import(join(dir, "health.js"));
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE command_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, action TEXT, target TEXT, detail TEXT, at TEXT DEFAULT (datetime('now')))");
class Stmt { constructor(sql, a = []) { this.sql = sql; this.a = a; } bind(...a) { return new Stmt(this.sql, a); } async first() { return db.prepare(this.sql).get(...this.a) ?? null; } async all() { return { results: db.prepare(this.sql).all(...this.a) }; } async run() { const r = db.prepare(this.sql).run(...this.a); return { meta: { changes: r.changes } }; } }
const env = { CF_ANALYTICS_TOKEN: "t", DB: { prepare: (s) => new Stmt(s) } };
let calls = 0, sent = null;
const answer = { data: { viewer: { accounts: [{
  now: [{ sum: { requests: 9000, errors: 0 }, dimensions: { scriptName: "rb-radio", status: "success" } },
        { sum: { requests: 30, errors: 0 }, dimensions: { scriptName: "rb-radio", status: "clientDisconnected" } },
        { sum: { requests: 1200, errors: 3 }, dimensions: { scriptName: "rb-showcase", status: "scriptThrewException" } }],
  prev: [{ sum: { requests: 8000, errors: 19 }, dimensions: { scriptName: "artist-router" } }] }] } } };
const fetcher = async (u, init) => { calls++; sent = JSON.parse(init.body); return new Response(JSON.stringify(answer)); };
const T = Date.parse("2026-10-26T14:52:00Z");
let r = await health.weekly(env, { fetcher, now: T });
assert.equal(r.workers, 2); assert.equal(r.requests, 10230); assert.equal(r.errors, 3); assert.equal(r.prev_errors, 19); assert.equal(r.left, 30);
assert.deepEqual(r.with_errors.map((w) => w.name), ["rb-showcase"]);
assert.equal(sent.variables.m, "2026-10-19T14:52:00Z"); assert.equal(sent.variables.s, "2026-10-12T14:52:00Z");
assert.match(health.line(r), /10,230 requests across 2 Workers, 3 errors \(19 the week before\)\. Most: rb-showcase 3 of 1,200\./);
const log = db.prepare("SELECT * FROM command_log").all();
assert.equal(log.length, 1); assert.equal(log[0].action, "health.weekly");
// the next days' runs don't make another one until 6.5 days have passed
for (const d of [1, 3, 6]) assert.equal(await health.weekly(env, { fetcher, now: T + d * 864e5 }), null);
assert.equal(calls, 1);
r = await health.weekly(env, { fetcher, now: T + 7 * 864e5 }); assert.ok(r); assert.equal(calls, 2);
const saved = await health.latest(env); assert.equal(saved.errors, 3); assert.ok(saved.saved_at);
// a clean week says so
answer.data.viewer.accounts[0].now = answer.data.viewer.accounts[0].now.filter((x) => !x.sum.errors);
assert.match(health.line(await health.weekly(env, { fetcher, now: T + 14 * 864e5 })), /no errors \(19 the week before\)\./);
// without the token, nothing is asked or saved
assert.equal(await health.weekly({ DB: env.DB }, { fetcher }), null);
// a refused token throws (the daily run logs it)
await assert.rejects(health.weekly(env, { fetcher: async () => new Response(JSON.stringify({ errors: [{ message: "not authorized" }] })), now: T + 30 * 864e5 }), /not authorized/);
// the Overview and the daily run use it
const src = (await import("node:fs")).readFileSync(join(dir, "index.js"), "utf8");
assert.ok(src.includes("await weeklyHealth.weekly(env)") && src.includes('"health_weekly"'));
console.log("weekly health ok: 7 days against the 7 before, once in 6.5 days, saved for the Overview, one line in Activity");
