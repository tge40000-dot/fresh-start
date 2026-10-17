// Usage: node --no-warnings rb-site-updates/test/ai-limit.test.mjs <patched relentless-billionaire-api script.js>
// The real Worker against an in-memory D1: the free AI endpoints stop at their limits, per visitor and site-wide.
import assert from "node:assert/strict";
import { fakeD1 } from "../../rb-surface/test/fake-d1.mjs";
const T0 = Math.floor(Date.now() / 60000) * 60000 + 1000; Date.now = () => T0; // one fixed minute, so the count never straddles two
const worker = (await import(process.argv[2])).default;
const DB = fakeD1();
DB.batch = async (stmts) => Promise.all(stmts.map((s) => s.all())); // real D1 batches return rows, RETURNING included
const kv = new Map();
const TRIVIA_STORE = { get: async (k) => kv.get(k) ?? null, put: async (k, v, o) => { if (o && o.expirationTtl < 60) throw new Error("KV TTL must be at least 60"); kv.set(k, v); } };
const wav = new Uint8Array(20000); wav.set([0x52, 0x49, 0x46, 0x46]);
let aiCalls = 0;
const AI = { run: async () => { aiCalls++; return wav; } };
const env = { DB, AI, TRIVIA_STORE };
const ctx = { waitUntil() {}, passThroughOnException() {} };
const speak = (ip, text = "Hello there.") => worker.fetch(new Request("https://media.relentlessbillionaire.com/ai/platform/speech", {
  method: "POST", headers: { "Content-Type": "application/json", Origin: "https://relentlessbillionaire.com", "CF-Connecting-IP": ip }, body: JSON.stringify({ text }) }), env, ctx);

for (let i = 0; i < 20; i++) { const r = await speak("203.0.113.5"); assert.equal(r.status, 200, "request " + (i + 1) + " is inside the per-minute allowance"); assert.equal(r.headers.get("Content-Type"), "audio/wav"); }
let r = await speak("203.0.113.5");
assert.equal(r.status, 429, "the 21st in a minute is refused");
const retry = Number(r.headers.get("Retry-After"));
assert.ok(retry >= 1 && retry <= 60, "Retry-After is within the minute");
assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://relentlessbillionaire.com", "the site can read the refusal");
assert.match(r.headers.get("Access-Control-Expose-Headers") || "", /Retry-After/, "and its Retry-After");
const body = await r.json();
assert.equal(body.error.code, "rate_limited"); assert.match(body.error.message, /Try again in \d+ seconds/);
assert.equal(aiCalls, 20, "a refused request never reaches the AI");
r = await speak("198.51.100.7");
assert.equal(r.status, 200, "another visitor isn't affected");
const rows = DB.raw.prepare("SELECT k FROM rb_ai_usage").all().map((x) => x.k);
assert.ok(rows.every((k) => !k.includes("203.0.113.5") && !k.includes("198.51.100.7")), "IPs are never stored, only a hash");
// site-wide daily cap
DB.raw.exec(`UPDATE rb_ai_usage SET n = 20000 WHERE k LIKE 'speech:all:%'`);
r = await speak("192.0.2.9");
assert.equal(r.status, 429, "the site-wide daily cap holds for a new visitor too");
assert.match((await r.json()).error.message, /whole site/);
// the database failing never takes the tools down
const broken = { ...env, DB: { prepare() { throw new Error("D1 down"); }, batch() { throw new Error("D1 down"); } } };
r = await worker.fetch(new Request("https://media.relentlessbillionaire.com/ai/platform/speech", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://relentlessbillionaire.com", "CF-Connecting-IP": "192.0.2.10" }, body: JSON.stringify({ text: "Hi." }) }), broken, ctx);
assert.equal(r.status, 200, "requests go through if D1 is unreachable");
console.log("AI limit ok: 20 a minute then 429 with Retry-After and CORS, AI not called when refused, per visitor, hashed IPs, site-wide cap, fails open");
