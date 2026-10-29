// Usage: node --no-warnings rb-site-updates/test/ai-policy-api.test.mjs <patched relentless-billionaire-api script.js>
// The real Worker against an in-memory D1 and a fake Workers AI: the operator's policy is checked before any model
// runs, its numbers drive the rate limits, styles and sizes reach the model, and every call is logged in ai_audit.
import assert from "node:assert/strict";
import { fakeD1 } from "../../rb-surface/test/fake-d1.mjs";
const worker = (await import(process.argv[2])).default;
const DB = fakeD1();
DB.batch = async (stmts) => Promise.all(stmts.map((s) => s.all()));
DB.raw.exec("CREATE TABLE site_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)");
const kv = new Map();
const TRIVIA_STORE = { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } };
const png = new Uint8Array(20000); png.set([0x89, 0x50, 0x4e, 0x47]);
const calls = [];
let guard = "safe";
const AI = { run: async (model, input) => {
  calls.push({ model, input });
  if (/llama-guard/.test(model)) return { response: guard };
  if (/flux/.test(model)) return { image: btoa(String.fromCharCode(...png.slice(0, 15000))) + "A".repeat(4000) };
  if (/melotts/.test(model)) { const w = new Uint8Array(20000); w.set([0x52, 0x49, 0x46, 0x46]); return w; }
  return { response: "ok" };
} };
const puts = [];
const MEDIA = { put: async (k) => { puts.push(k); } };
const env = { DB, AI, TRIVIA_STORE, MEDIA };
const ctx = { waitUntil() {}, passThroughOnException() {} };
const ORIGIN = "https://relentlessbillionaire.com";
const post = (path, body, ip = "203.0.113.20") => worker.fetch(new Request("https://media.relentlessbillionaire.com" + path, {
  method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN, "CF-Connecting-IP": ip }, body: JSON.stringify(body) }), env, ctx);
const policy = async (p) => {
  DB.raw.prepare("INSERT INTO site_settings (key, value) VALUES ('ai_policy', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(p));
  const P = await import(new URL("./ai_policy.js", new URL(process.argv[2], "file://")).href);
  await P.loadPolicy(DB, { fresh: true }); // what a new instance would read (each instance keeps it 30 s)
};
const audit = () => DB.raw.prepare("SELECT * FROM ai_audit ORDER BY at").all();
const lastRow = () => audit().slice(-1)[0];

// 1. no policy saved: RB's defaults. A clean picture is made, sized 1024 square, and logged.
let r = await post("/ai/platform/image", { prompt: "Luxury night skyline over the Bay, gold lights" });
assert.equal(r.status, 200);
let d = await r.json();
assert.deepEqual(d.size, [1024, 1024]); assert.equal(d.style, null);
const flux = calls.filter((c) => /flux/.test(c.model)).pop();
assert.ok(flux, "FLUX ran");
let row = lastRow();
assert.equal(row.outcome, "done"); assert.equal(row.surface, "public"); assert.equal(row.kind, "image");
assert.match(row.model, /flux/); assert.match(row.ref, /^ai\/generated\//); assert.match(row.who, /^visitor:[0-9a-f]{12}$/);
assert.equal(row.prompt, "Luxury night skyline over the Bay, gold lights"); assert.match(row.prompt_hash, /^[0-9a-f]{32}$/);
assert.ok(calls.some((c) => /llama-guard/.test(c.model)), "the AI check read the picture prompt (on by default)");
assert.ok(!JSON.stringify(audit()).includes("203.0.113.20"), "the IP is never stored");

// 2. a filtered prompt never reaches the image model, and says why
const before = calls.filter((c) => /flux/.test(c.model)).length;
r = await post("/ai/platform/image", { prompt: "a nude model on a yacht" });
assert.equal(r.status, 400); d = await r.json();
assert.equal(d.error.code, "policy_blocked"); assert.match(d.error.message, /sexual or nude/);
assert.equal(calls.filter((c) => /flux/.test(c.model)).length, before, "blocked before the model");
row = lastRow(); assert.equal(row.outcome, "blocked"); assert.equal(row.code, "blocked");

// 3. the AI check stops what the word lists miss
guard = "unsafe\nS1";
r = await post("/ai/platform/image", { prompt: "something the lists don't know" });
assert.equal(r.status, 400); assert.match((await r.json()).error.message, /AI safety check/);
row = lastRow(); assert.equal(row.code, "ai_check"); assert.match(row.notes, /s1/);
guard = "safe";

// 4. style lock and a wide shape: the style text is added, the size follows the shape and the cap
await policy({ styles: { allowed: ["dark-luxury", "cinematic-night"], default: "cinematic-night", lock: true }, image: { maxSide: 1024 } });
r = await post("/ai/platform/image", { prompt: "rooftop party", aspect: "16:9" });
assert.equal(r.status, 200); d = await r.json();
assert.equal(d.style, "cinematic-night"); assert.deepEqual(d.size, [1024, 584]);
const sent = calls.filter((c) => /flux/.test(c.model)).pop();
const form = await new Response(sent.input.multipart.body, { headers: { "Content-Type": sent.input.multipart.contentType } }).formData();
assert.match(form.get("prompt"), /^rooftop party\. cinematic night look: /, "the style reached the model");
assert.equal(form.get("width"), "1024"); assert.equal(form.get("height"), "584");
row = lastRow(); assert.equal(row.style, "cinematic-night"); assert.match(row.notes, /default style/); assert.match(row.notes, /1344×768 → 1024×584/);
r = await post("/ai/platform/image", { prompt: "rooftop party", style: "photoreal" });
assert.equal(r.status, 400); assert.match((await r.json()).error.message, /Photoreal style is switched off/);

// 5. the switch: public tools paused → 503 before any model, for every feature; logged
await policy({ on: { public: false } });
const n = calls.length;
for (const [path, body] of [["/ai/platform/image", { prompt: "x" }], ["/ai/platform/speech", { text: "hi" }], ["/ai/platform/text", { prompt: "hi" }]]) {
  r = await post(path, body);
  assert.equal(r.status, 503, path); assert.equal((await r.json()).error.code, "policy_paused");
}
assert.equal(calls.length, n, "nothing ran while paused");
assert.equal(lastRow().code, "paused");

// 6. rate limits come from the policy
await policy({ rate: { public: { speech: { minute: 2, hour: 10, day: 10, all: 100 } } }, filters: { words: ["hate"] } });
for (let i = 0; i < 2; i++) assert.equal((await post("/ai/platform/speech", { text: "Line " + i }, "198.51.100.40")).status, 200);
r = await post("/ai/platform/speech", { text: "Line 3" }, "198.51.100.40");
assert.equal(r.status, 429, "the policy's 2 a minute holds");
assert.equal(lastRow().outcome, "rate_limited");

// 7. words filters apply to voice and writing; a blocked word of the operator's too
r = await post("/ai/platform/speech", { text: "heil hitler" }, "198.51.100.41");
assert.equal(r.status, 400);
await policy({ filters: { words: [], terms: ["rival records"] } });
r = await post("/ai/platform/text", { prompt: "Write a diss about Rival Records" }, "198.51.100.42");
assert.equal(r.status, 400); assert.match((await r.json()).error.message, /word the operator has blocked/);
r = await post("/ai/platform/text", { prompt: "Write a toast for my crew" }, "198.51.100.42");
assert.equal(r.status, 200);
// sexual content with a minor is refused even with every filter off
r = await post("/ai/platform/text", { prompt: "a sexy story about a 15 year old" }, "198.51.100.42");
assert.equal(r.status, 400); assert.match((await r.json()).error.message, /can't be made on RB/);

// 8. prompts kept or not
await policy({ audit: { keepPrompts: false } });
await post("/ai/platform/text", { prompt: "Write a toast for my crew" }, "198.51.100.43");
row = lastRow(); assert.equal(row.prompt, null); assert.match(row.prompt_hash, /^[0-9a-f]{32}$/);

// 9. the studio helpers: checked and logged, members by id
await policy({});
const studio = (path, body) => worker.fetch(new Request("https://media.relentlessbillionaire.com" + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://studio.relentlessbillionaire.com", "CF-Connecting-IP": "192.0.2.50" }, body: JSON.stringify(body) }), env, ctx);
DB.raw.exec("CREATE TABLE IF NOT EXISTS feature_controls (flag_key TEXT, enabled INTEGER)");
r = await studio("/ai/studio/generate", { messages: [{ role: "user", content: "Write a hook about the Bay" }] });
assert.equal(r.status, 200);
row = lastRow(); assert.equal(row.kind, "text"); assert.equal(row.outcome, "done"); assert.match(row.model, /llama/);
r = await studio("/ai/studio/vocal", { text: "heil hitler" });
assert.equal(r.status, 400); assert.equal(lastRow().outcome, "blocked");

// 10. health and OPTIONS aren't logged
const count = audit().length;
await worker.fetch(new Request("https://media.relentlessbillionaire.com/ai/platform/health", { headers: { Origin: ORIGIN } }), env, ctx);
await worker.fetch(new Request("https://media.relentlessbillionaire.com/ai/platform/image", { method: "OPTIONS", headers: { Origin: ORIGIN } }), env, ctx);
assert.equal(audit().length, count);
console.log(`AI policy (public tools) ok: defaults, filters before the model, AI check, style lock and shapes, pause, policy rate limits, words and blocked terms, the floor, prompts kept or not, studio helpers, ${audit().length} calls logged`);
