// Usage: node --no-warnings rb-site-updates/test/ai-policy-autopilot.test.mjs <patched rb-autopilot dir> <patched rb-studio dir>
// Autopilot's model calls go through the policy and the log; approved renders carry their approval; the policy reaches
// the real (patched) AI Forge and its log comes back into ai_audit.
import assert from "node:assert/strict";
import { join } from "node:path";
import { fakeD1 } from "../../rb-surface/test/fake-d1.mjs";
const [apDir, forgeDir] = process.argv.slice(2);
const AP = await import(join(apDir, "ai_autopilot.js"));
const P = await import(join(apDir, "ai_policy.js"));
const creative = await import(join(apDir, "creative.js"));
const forge = (await import(join(forgeDir, "worker.js"))).default;

const DB = fakeD1();
DB.batch = async (stmts) => Promise.all(stmts.map((s) => s.run())); // like D1: each result says how many rows changed
DB.raw.exec("CREATE TABLE site_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)");
const setPolicy = async (p) => { DB.raw.prepare("INSERT INTO site_settings (key, value) VALUES ('ai_policy', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(p)); await P.loadPolicy(DB, { fresh: true }); };
const audit = () => DB.raw.prepare("SELECT * FROM ai_audit ORDER BY at").all();
let aiCalls = 0;
const TOKEN = "t".repeat(40);
const env = { DB, AI: { run: async () => { aiCalls++; return { response: "a draft" }; } }, FORGE_TOKEN: TOKEN };

// the real AI Forge behind fetch
const store = new Map();
const JOBS = {
  get: async (k, o) => { const v = store.get(k); if (!v) return null; return o && o.type === "json" ? JSON.parse(v.value) : v.value; },
  put: async (k, value, o = {}) => { store.set(k, { value: String(value), metadata: o.metadata ?? null }); },
  list: async ({ prefix = "" } = {}) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name, metadata: store.get(name).metadata })), list_complete: true }),
};
const forgeEnv = { JOBS, AI: { run: async () => ({ image: "data:image/png;base64,AAAA", audio: "data:audio/mpeg;base64,AAAA", video: "data:video/mp4;base64,AAAA" }) }, ASSETS: { put: async () => {} }, MUSIC_QUEUE: { send: async () => {} }, ADMIN_KEY: "k".repeat(40), AUTOPILOT_TOKEN: TOKEN };
const forgeBodies = [];
globalThis.fetch = async (input, init = {}) => {
  const req = new Request(input, init);
  if (!req.url.startsWith("https://studio.relentlessbillionaire.vip/")) throw new Error("unexpected fetch " + req.url);
  if (req.method === "POST") forgeBodies.push({ path: new URL(req.url).pathname, body: JSON.parse(await req.clone().text()) });
  const waits = [];
  const res = await forge.fetch(req, forgeEnv, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  return res;
};

// 1. drafts are logged; paused means no model call and a clear error
const out = await AP.aiRun(env, "draft", "@cf/meta/llama-3.3-70b-instruct-fp8-fast", { messages: [{ role: "system", content: "s" }, { role: "user", content: "Write a note for artist X" }] });
assert.equal(out.response, "a draft"); assert.equal(aiCalls, 1);
let row = audit().pop();
assert.equal(row.surface, "autopilot"); assert.equal(row.outcome, "done"); assert.equal(row.ref, "draft"); assert.equal(row.prompt, "Write a note for artist X"); assert.equal(row.who, "autopilot");
await setPolicy({ on: { autopilot: false } });
await assert.rejects(AP.aiRun(env, "ideas", "m", { messages: [{ role: "user", content: "x" }] }), /Autopilot AI is paused.*AI limits/);
assert.equal(aiCalls, 1, "no model call while paused");
assert.equal(audit().pop().outcome, "blocked");
// the ask() every draft uses goes through it too
const ai = await import(join(apDir, "ai.js"));
await assert.rejects(ai.ask(env, "s", "u", 50), /paused/);
await setPolicy({});

// 2. the Forge hasn't got a copy: the 10-minute check sends it; then it's quiet
let st = await AP.aiForgeStatus(env);
assert.equal(st.ok, true); assert.equal(st.version, null);
let t = await AP.aiTick(env);
assert.equal(t.pushed, true); assert.equal(t.forge, null);
st = await AP.aiForgeStatus(env);
assert.equal(st.version, P.policyVersion(P.cleanPolicy({})));
t = await AP.aiTick(env);
assert.equal(t.pushed, false, "nothing to send when the Forge is up to date");

// 3. RB Command saves → aiSync sends it at once
await setPolicy({ video: { maxSeconds: 6 }, rate: { forgePerDay: { video: 5 } } });
const s = await AP.aiSync(env, { by: "owner@rb.test" });
assert.equal(s.ok, true); assert.equal(s.version, P.policyVersion(await P.loadPolicy(DB, { fresh: true })));
const copy = JSON.parse(store.get("rb:ai-policy").value);
assert.equal(copy.policy.video.maxSeconds, 6); assert.equal(copy.by, "owner@rb.test");

// 4. an approved idea's renders carry the approval and pass; the Forge's log comes back into ai_audit
DB.raw.exec("CREATE TABLE creative_ideas (id TEXT PRIMARY KEY, kind TEXT, status TEXT, title TEXT, music_prompt TEXT, lyrics TEXT, cover_prompt TEXT, video_prompt TEXT, bpm INTEGER, song_key TEXT, jobs TEXT, media TEXT, published TEXT, error TEXT, why TEXT, approved_by TEXT, approved_at TEXT, created_at TEXT, updated_at TEXT)");
DB.raw.prepare("INSERT INTO creative_ideas (id, kind, status, title, video_prompt, cover_prompt, created_at) VALUES ('idea_v', 'video', 'proposed', 'Gold Hour', 'Slow push in on a gold microphone, night', 'Gold microphone on black', datetime('now'))").run();
const res = await creative.approve(env, "idea_v", "owner@rb.test", 10);
assert.ok(res.idea, JSON.stringify(res)); assert.equal(res.idea.status, "generating");
const renders = forgeBodies.filter((b) => /\/generate$/.test(b.path));
assert.equal(renders.length, 2);
for (const b of renders) assert.deepEqual(b.body.approval, { idea: "idea_v", by: "owner@rb.test" });
const pulled = await AP.pullForgeAudit(env);
assert.ok(pulled >= 2, "the Forge's rows arrive");
const forgeRows = audit().filter((r) => r.surface === "forge");
assert.ok(forgeRows.some((r) => r.kind === "video" && r.outcome === "queued" && /approved by owner@rb\.test/.test(r.who) && /8s → 6s/.test(r.notes)), "the video came down to the 6 s cap");
assert.equal(await AP.pullForgeAudit(env), 0, "the cursor means rows aren't copied twice");
// a row that lands behind the last one read (same millisecond, or a listing that lagged) is still collected
const late = await P.auditRow(P.cleanPolicy({}), { at: new Date(Date.now() - 60000).toISOString(), surface: "forge", kind: "image", outcome: "queued", who: "operator" });
store.set(`audit:${late.at}:${late.id}`, { value: "", metadata: late });
assert.equal(await AP.pullForgeAudit(env), 1, "picked up from the 5-minute overlap");
assert.equal(await AP.pullForgeAudit(env), 0);

// 5. with the rule on, a render without the approval is refused by the Forge
const r = await fetch("https://studio.relentlessbillionaire.vip/api/image/generate", { method: "POST", headers: { "x-rb-autopilot": TOKEN, "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "cover" }) });
assert.equal(r.status, 403);
console.log(`AI policy (Autopilot) ok: drafts through the policy and logged, pause, sync on the 10-minute check and on save, approved renders carry their approval, the Forge's log copied once (${forgeRows.length} rows)`);
