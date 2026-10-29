// Usage: node --no-warnings rb-site-updates/test/ai-policy-relentless-studio.test.mjs <patched relentless-studio script.js>
// relentless-studio's two AI helpers against an in-memory waitlist-db and a fake Workers AI: the operator's policy is
// checked before the model runs (switch, word filters), the existing caps still apply, and every call is logged.
import assert from "node:assert/strict";
import { fakeD1 } from "../../rb-surface/test/fake-d1.mjs";
const worker = (await import(process.argv[2])).default;
const P = await import(new URL("./ai_policy.js", new URL(process.argv[2], "file://")).href);
const DB = fakeD1();
DB.batch = async (stmts) => Promise.all(stmts.map((s) => s.run()));
DB.raw.exec("CREATE TABLE site_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)");
const kv = new Map();
const AI_CAPS = { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } };
let calls = 0;
const AI = { run: async (model, input) => { calls++; return { response: /arranger/.test(input.messages[0].content) ? '{"bpm":90}' : "Here's a hook." }; } };
const env = { PLATFORM_DB: DB, AI, AI_CAPS };
const ctx = { waitUntil() {}, passThroughOnException() {} };
const O = "https://studio.relentlessbillionaire.com";
const post = (path, body, ip = "203.0.113.7") => worker.fetch(new Request(O + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: O, "CF-Connecting-IP": ip }, body: JSON.stringify(body) }), env, ctx);
const chat = (text, ip) => post("/ai/studio/generate", { messages: [{ role: "system", content: "You write hooks." }, { role: "user", content: text }] }, ip);
const setPolicy = async (p) => { DB.raw.prepare("INSERT INTO site_settings (key, value) VALUES ('ai_policy', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(p)); await P.loadPolicy(DB, { fresh: true }); };
const rows = () => DB.raw.prepare("SELECT * FROM ai_audit ORDER BY at").all();

// 1. defaults: a clean prompt runs and is logged with the visitor as a hash
let r = await chat("A hook about the Bay at night");
assert.equal(r.status, 200, await r.clone().text()); assert.equal(calls, 1);
let row = rows().pop();
assert.equal(row.surface, "public"); assert.equal(row.kind, "text"); assert.equal(row.outcome, "done"); assert.match(row.model, /llama-3\.3/);
assert.equal(row.prompt, "A hook about the Bay at night"); assert.match(row.who, /^visitor:[0-9a-f]{12}$/); assert.match(row.ref, /\/ai\/studio\/generate$/);
// 2. the hate filter is on for words by default: refused before the model, logged as blocked
r = await chat("write a white power anthem");
assert.equal(r.status, 400); assert.equal((await r.json()).error.code, "policy_blocked"); assert.equal(calls, 1, "no model call");
assert.equal(rows().pop().outcome, "blocked");
// 3. the owner's own blocked word, on compose
await setPolicy({ filters: { terms: ["ghostwriter"] } });
r = await post("/ai/studio/compose", { brief: "A ghostwriter beat at 90 BPM" });
assert.equal(r.status, 400); assert.equal(calls, 1);
r = await post("/ai/studio/compose", { brief: "A boom-bap beat at 90 BPM" });
assert.notEqual(r.status, 400); assert.equal(calls, 2, "compose reaches the model");
assert.ok(rows().some((x) => x.ref.endsWith("/ai/studio/compose") && x.outcome === "blocked"));
// 4. public tools paused: 503 with the operator's words, nothing runs
await setPolicy({ on: { public: false } });
r = await chat("Anything");
assert.equal(r.status, 503); assert.match((await r.json()).error.message, /paused by the operator/); assert.equal(calls, 2);
await setPolicy({});
// 5. the Worker's own caps still apply (5 a day for a signed-out visitor) and are logged as rate limited
for (let i = 0; i < 5; i++) await chat("Hook number " + i, "198.51.100.9");
r = await chat("One more", "198.51.100.9");
assert.equal(r.status, 429); assert.equal(rows().pop().outcome, "rate_limited");
// 6. cross-site and empty requests never reach the gate or the log
const before = rows().length;
r = await worker.fetch(new Request(O + "/ai/studio/generate", { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: "{}" }), env, ctx);
assert.equal(r.status, 403); assert.equal(rows().length, before);
console.log(`AI policy (relentless-studio) ok: checked before the model, filters and pause refuse, own caps kept, ${rows().length} calls logged`);
