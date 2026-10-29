// Usage: node --no-warnings rb-site-updates/test/yoshcoast-ai.test.mjs <patched yoshcoastmusic worker.js>
// The paid music model at /yoshcoastmusic/api/generate: a visitor is turned away before anything is queued; a signed-in
// admin (here: the admin key) gets through; RB's built-in content filters refuse before the model.
import assert from "node:assert/strict";
import { fakeD1 } from "../../rb-surface/test/fake-d1.mjs";
const worker = (await import(process.argv[2])).default;
const DB = fakeD1();
DB.raw.exec(`CREATE TABLE tracks (id TEXT PRIMARY KEY, created_at TEXT, prompt TEXT, lyrics TEXT, mood TEXT, vocal_mode TEXT, bpm INTEGER, musical_key TEXT, status TEXT, model TEXT, audio_url TEXT, metadata TEXT, error TEXT);
  CREATE TABLE generation_events (id TEXT PRIMARY KEY, track_id TEXT, event_type TEXT, payload TEXT, created_at TEXT);
  CREATE TABLE yc_users (id TEXT PRIMARY KEY, email TEXT, display_name TEXT, role TEXT, password_hash TEXT, status TEXT, last_login_at TEXT, updated_at TEXT);
  CREATE TABLE yc_sessions (id TEXT PRIMARY KEY, token_hash TEXT, user_id TEXT, expires_at TEXT, created_at TEXT);`);
let calls = 0;
const ADMIN_KEY = "k".repeat(40);
const env = { DB, ADMIN_KEY, AI: { run: async () => { calls++; return { audio: "https://example.test/a.mp3" }; } } };
const waits = [];
const ctx = { waitUntil: (p) => waits.push(p), passThroughOnException() {} };
const gen = (body, headers = {}) => worker.fetch(new Request("https://relentlessbillionaire.com/yoshcoastmusic/api/generate", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }), env, ctx);
const tracks = () => DB.raw.prepare("SELECT * FROM tracks").all();

let r = await gen({ prompt: "Warm coastal R&B at golden hour" });
assert.equal(r.status, 401); const d = await r.json(); assert.equal(d.needsLogin, true); assert.match(d.error, /\/yoshcoastmusic\/login/);
await Promise.all(waits); assert.equal(calls, 0); assert.equal(tracks().length, 0, "nothing queued for a visitor");
r = await gen({ prompt: "Warm coastal R&B at golden hour" }, { "X-Admin-Key": ADMIN_KEY });
assert.equal(r.status, 202, await r.clone().text()); await Promise.all(waits);
assert.equal(calls, 1); assert.equal(tracks()[0].status, "complete");
r = await gen({ prompt: "A heil hitler marching song", vocalMode: "vocal" }, { "X-Admin-Key": ADMIN_KEY });
assert.equal(r.status, 400); assert.equal((await r.json()).code, "policy_blocked"); assert.equal(calls, 1);
r = await gen({ prompt: "Soft piano for a quiet night", vocalMode: "vocal", lyrics: "sieg heil" }, { "X-Admin-Key": ADMIN_KEY });
assert.equal(r.status, 400, "lyrics are read too");
console.log("yoshcoastmusic ok: visitors can't start the paid music model, the admin can, built-in filters refuse before it runs");
