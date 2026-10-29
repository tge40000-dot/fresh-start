// Usage: node --no-warnings rb-site-updates/test/ai-policy-forge.test.mjs <patched rb-studio dir>
// The AI Forge with a fake KV and Workers AI: its copy of the owner's policy (sent only by Autopilot) gates every
// render, sizes and lengths come down to the caps, Autopilot needs an approved idea, caps hold, and the log lists.
import assert from "node:assert/strict";
import { join } from "node:path";
const worker = (await import(join(process.argv[2], "worker.js"))).default;
const store = new Map();
const JOBS = {
  get: async (k, o) => { const v = store.get(k); if (!v) return null; return o && o.type === "json" ? JSON.parse(v.value) : v.value; },
  put: async (k, value, o = {}) => { store.set(k, { value: String(value), metadata: o.metadata ?? null }); },
  list: async ({ prefix = "", limit = 1000, cursor } = {}) => {
    const all = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
    const start = cursor ? Number(cursor) : 0, page = all.slice(start, start + limit);
    return { keys: page.map((name) => ({ name, metadata: store.get(name).metadata })), list_complete: start + limit >= all.length, cursor: String(start + limit) };
  },
};
const runs = [];
const AI = { run: async (model, input) => { runs.push({ model, input }); return /video/.test(model) || /seedance|veo/.test(model) ? { video: "data:video/mp4;base64,AAAA" } : { image: "data:image/png;base64,AAAA", response: "words", audio: "data:audio/mpeg;base64,AAAA" }; } };
const ASSETS = { put: async () => {} };
const sent = [];
const MUSIC_QUEUE = { send: async (m) => { sent.push(m); } };
const KEY = "k".repeat(40), TOKEN = "t".repeat(40);
const env = { JOBS, AI, ASSETS, MUSIC_QUEUE, ADMIN_KEY: KEY, AUTOPILOT_TOKEN: TOKEN };
let waits = [];
const ctx = { waitUntil: (p) => waits.push(p), passThroughOnException() {} };
const call = async (path, body, who = "operator") => {
  const headers = { "Content-Type": "application/json", ...(who === "operator" ? { "x-api-key": KEY } : who === "autopilot" ? { "x-rb-autopilot": TOKEN } : {}) };
  const r = await worker.fetch(new Request("https://studio.relentlessbillionaire.vip" + path, { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined }), env, ctx);
  await Promise.all(waits); waits = [];
  return r;
};
const rows = async () => (await (await call("/api/audit?after=")).json()).rows;
const last = async () => (await rows()).slice(-1)[0];

// 1. no copy yet: RB's defaults. A 4K picture comes down to 2048 on its longest side; the log has it.
let r = await call("/api/image/generate", { prompt: "Gold crown on black velvet", width: 4096, height: 2304, model: "@cf/black-forest-labs/flux-2-dev" });
assert.equal(r.status, 202);
let run = runs.pop();
assert.equal(run.input.width, 2048); assert.equal(run.input.height, 1152);
let row = await last();
assert.equal(row.outcome, "queued"); assert.equal(row.surface, "forge"); assert.equal(row.who, "operator"); assert.match(row.notes, /4096×2304 → 2048×1152/);
r = await call("/api/image/generate", { prompt: "x", imageSize: "4K", model: "google/nano-banana-pro" });
assert.equal(r.status, 202); assert.equal(runs.pop().input.image_size, "2K", "Nano Banana's 4K comes down to 2K");

// 2. Autopilot can't start a render without an approved idea; with one it can, and the log says who approved it
r = await call("/api/music/generate", { prompt: "Bay Area hyphy instrumental, 100 BPM", is_instrumental: true }, "autopilot");
assert.equal(r.status, 403); assert.match((await r.json()).error, /requires approval/);
assert.equal(sent.length, 0, "nothing queued");
r = await call("/api/music/generate", { prompt: "Bay Area hyphy instrumental, 100 BPM", is_instrumental: true, approval: { idea: "idea_1", by: "owner@rb.test" } }, "autopilot");
assert.equal(r.status, 202); assert.equal(sent.length, 1);
row = (await rows()).find((x) => x.ref === sent[0].id); assert.equal(row.outcome, "queued"); assert.match(row.who, /autopilot \(approved by owner@rb\.test\)/); assert.equal(row.ref, sent[0].id);

// 3. only Autopilot can change the copy
const policy = (p) => call("/api/policy", { policy: p, by: "test" }, "autopilot");
r = await call("/api/policy", { policy: { on: { forge: false } } });
assert.equal(r.status, 403, "the admin key can't change the policy");
r = await policy({ video: { maxSeconds: 8 }, styles: { allowed: ["dark-luxury"], default: "dark-luxury", lock: true }, rate: { forgePerDay: { image: 3 } } });
assert.equal(r.status, 200); const v = (await r.json()).version;
r = await call("/api/policy"); let d = await r.json();
assert.equal(d.version, v); assert.equal(d.policy.video.maxSeconds, 8); assert.equal(d.by, "test");
assert.equal((await call("/api/policy", null, "nobody")).status, 401);

// 4. lengths, styles and filters from the new copy
r = await call("/api/video/generate", { prompt: "Slow push in on a gold mic", durationSec: 15, model: "bytedance/seedance-2.5" });
assert.equal(r.status, 202); run = runs.pop();
assert.equal(run.input.duration, 8, "15 s comes down to the 8 s cap"); assert.match(run.input.prompt, /dark luxury editorial look/, "the locked style is added");
r = await call("/api/video/generate", { prompt: "a beheading in the street", model: "bytedance/seedance-2.5" });
assert.equal(r.status, 400); assert.ok((await rows()).some((x) => x.outcome === "blocked" && /beheading/.test(x.prompt)));
r = await call("/api/image/generate", { prompt: "x", style: "photoreal" });
assert.equal(r.status, 400, "a style that's off is refused");

// 5. the per-day cap (counted by the Forge's own daily counter)
const today = new Date().toISOString().slice(0, 10);
store.set(`cap:image:${today}`, { value: "3", metadata: null });
r = await call("/api/image/generate", { prompt: "y" });
assert.equal(r.status, 429); assert.match((await r.json()).error, /limit of 3 image renders/);
assert.ok((await rows()).some((x) => x.outcome === "rate_limited" && x.code === "daily_cap"));

// 6. paused: nothing starts
await policy({ on: { forge: false } });
const before = runs.length;
for (const [path, body] of [["/api/image/generate", { prompt: "z" }], ["/api/tts/generate", { text: "hi" }], ["/api/ai/write", { task: "lyrics", brief: "hi" }]]) {
  r = await call(path, body);
  assert.equal(r.status, 503, path);
}
assert.equal(runs.length, before);
await policy({ on: { autopilot: false } });
r = await call("/api/image/generate", { prompt: "cover", approval: { idea: "i2", by: "o" } }, "autopilot");
assert.equal(r.status, 503, "Autopilot paused stops its Forge renders too");
r = await call("/api/image/generate", { prompt: "cover" });
assert.equal(r.status, 202, "the operator can still render");

// 7. the log lists after a cursor, oldest first, prompts trimmed to fit
const all = await rows();
assert.ok(all.length >= 10);
const mid = [...store.keys()].filter((k) => k.startsWith("audit:")).sort()[4];
d = await (await call(`/api/audit?after=${encodeURIComponent(mid)}&limit=3`)).json();
assert.equal(d.rows.length, 3); assert.equal(d.more, true); assert.ok(d.last > mid);
assert.ok(all.every((x) => !x.prompt || x.prompt.length <= 200));
assert.equal((await call("/api/audit?after=", null, "nobody")).status, 401);
console.log(`AI policy (AI Forge) ok: defaults, size caps, Autopilot approval, only Autopilot changes the copy, length cap, style lock, filters, daily cap, pause, the log (${all.length} rows)`);
