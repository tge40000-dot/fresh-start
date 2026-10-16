// Usage: node --no-warnings rb-command-updates/test/scheduled.test.mjs <patched rb-command dir>
// The daily run: tops up the planner and writes crashes to Activity; a failure in one never stops the other.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
const dir = process.argv[2];
const worker = (await import(join(dir, "index.js"))).default;
assert.equal(typeof worker.scheduled, "function");
const db = new DatabaseSync(":memory:");
db.exec("CREATE TABLE command_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, action TEXT, target TEXT, detail TEXT, at TEXT DEFAULT (datetime('now')))");
class Stmt { constructor(sql, a = []) { this.sql = sql; this.a = a; } bind(...a) { return new Stmt(this.sql, a); } async first() { return db.prepare(this.sql).get(...this.a) ?? null; } async all() { return { results: db.prepare(this.sql).all(...this.a) }; } async run() { db.prepare(this.sql).run(...this.a); return { meta: {} }; } }
// No planner tables here, so the top-up fails: the crash check must still run.
const env = { CF_ANALYTICS_TOKEN: "t", DB: { prepare: (s) => new Stmt(s), batch: async () => { throw new Error("no such table: talent"); } } };
const realFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(JSON.stringify({ data: { viewer: { accounts: [{ w: [{ sum: { requests: 40, errors: 40 }, dimensions: { scriptName: "rb-email" } }, { sum: { requests: 9000, errors: 1 }, dimensions: { scriptName: "artist-router" } }] }] } } }));
const errs = []; const ce = console.error; console.error = (...a) => errs.push(a.join(" "));
const waits = [];
await worker.scheduled({ cron: "15 14 * * *" }, env, { waitUntil: (p) => waits.push(p) });
await Promise.all(waits);
console.error = ce; globalThis.fetch = realFetch;
const rows = db.prepare("SELECT * FROM command_log").all();
assert.deepEqual(rows.map((r) => [r.actor, r.action, r.target]), [["daily check", "worker.crashes", "rb-email"]]);
assert.match(rows[0].detail, /40 of 40 requests failed/);
assert.ok(errs.some((e) => /show planner/.test(e)), "the planner failure is logged, not thrown");
console.log("daily run ok: crash check still runs when the planner fails, crashes go to Activity");
