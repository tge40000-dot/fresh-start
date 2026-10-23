// Usage: node --no-warnings rb-site-updates/test/publish-queue.test.mjs <patched rb-autopilot dir>
// rb-tools/patch_publish_queue.py: a queued idea is published on the 10-minute schedule with RB Command's publish step,
// and the queue row keeps the result; an idea that isn't ready isn't published and says why.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fakeD1 } from "../../rb-surface/test/fake-d1.mjs";
const dir = process.argv[2], tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ap-"));
for (const f of fs.readdirSync(dir)) {
  if (!/\.m?js$/.test(f)) continue;
  let s = fs.readFileSync(path.join(dir, f), "utf8").replace(/from "cloudflare:workers"/g, 'from "data:text/javascript,export class WorkerEntrypoint{}"')
    .replace(/import (\w+) from "\.\/[^"]+\.(?:wasm|bin|mp3|html|txt)";/g, "const $1 = null;"); // binary and text modules aren't needed here
  fs.writeFileSync(path.join(tmp, f.replace(/\.js$/, ".mjs")), s.replace(/from "\.\/([^"]+)\.js"/g, 'from "./$1.mjs"'));
}
const W = (await import(path.join(tmp, "index.mjs"))).default;
const DB = fakeD1();
DB.raw.exec(`CREATE TABLE creative_ideas (id TEXT PRIMARY KEY, kind TEXT, status TEXT, title TEXT, jobs TEXT, media TEXT, published TEXT, published_by TEXT, published_at TEXT, updated_at TEXT);
INSERT INTO creative_ideas (id, kind, status, title) VALUES ('c_done', 'beat', 'published', 'Old Beat'), ('c_gen', 'beat', 'generating', 'Not Yet');
CREATE TABLE autopilot_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, task TEXT, trigger TEXT, started_at TEXT, finished_at TEXT, ok INTEGER, summary TEXT, result TEXT);`);
const waits = []; const ctx = { waitUntil: (p) => waits.push(p) };
// the queue table appears on the first tick; queue two ideas that mustn't publish
await W.scheduled({ cron: "*/10 * * * *", scheduledTime: Date.now() }, { DB }, ctx); await Promise.allSettled(waits.splice(0));
DB.raw.exec(`INSERT INTO creative_publish_queue (id, by) VALUES ('c_done', 'test'), ('c_gen', 'test');`);
await W.scheduled({ cron: "*/10 * * * *", scheduledTime: Date.now() }, { DB }, ctx); await Promise.allSettled(waits.splice(0));
const rows = DB.raw.prepare("SELECT id, result, done_at FROM creative_publish_queue ORDER BY id").all();
assert.equal(rows.length, 2);
assert.match(rows[0].result, /Not published: Already published/); assert.ok(rows[0].done_at);
assert.match(rows[1].result, /Not published: It isn't ready/); assert.ok(rows[1].done_at);
assert.equal(DB.raw.prepare("SELECT status FROM creative_ideas WHERE id = 'c_gen'").get().status, "generating", "nothing changed");
// done rows aren't run again
await W.scheduled({ cron: "*/10 * * * *", scheduledTime: Date.now() }, { DB }, ctx); await Promise.allSettled(waits.splice(0));
assert.equal(DB.raw.prepare("SELECT COUNT(*) AS n FROM autopilot_runs WHERE task = 'publish'").get().n, 2, "each queued idea ran once");
console.log("publish queue ok: runs on the 10-minute schedule through RB Command's publish step, keeps the result, never runs a row twice, never publishes what isn't ready");
