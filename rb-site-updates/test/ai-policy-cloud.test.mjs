// Usage: node --no-warnings rb-site-updates/test/ai-policy-cloud.test.mjs <patched rb-cloud dir>
// rb-cloud's model runs: with no DB binding they behave exactly as before (nothing checked, nothing logged); with DB
// (waitlist-db) the operator's policy is checked before the model and every call is logged.
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync, writeFileSync, copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fakeD1 } from "../../rb-surface/test/fake-d1.mjs";

// the Workers runtime pieces the module imports: cloudflare:workers and the bundled .html page
register("data:text/javascript," + encodeURIComponent(`
export async function resolve(s, c, next) { if (s === "cloudflare:workers") return { url: "rbstub:workers", shortCircuit: true }; if (s.endsWith(".html")) return { url: "rbstub:page.html", shortCircuit: true }; return next(s, c); }
export async function load(u, c, next) {
  if (u === "rbstub:workers") return { format: "module", source: "export class DurableObject { constructor(s, e) { this.ctx = s; this.env = e; } } export class WorkerEntrypoint { constructor(c, e) { this.env = e; } }", shortCircuit: true };
  if (u.endsWith(".html")) return { format: "module", source: "export default " + JSON.stringify("<html></html>"), shortCircuit: true };
  return next(u, c);
}`));
const dir = process.argv[2], tmp = mkdtempSync(join(tmpdir(), "rbcloud-"));
copyFileSync(join(dir, "ai_policy.js"), join(tmp, "ai_policy.js"));
writeFileSync(join(tmp, "index.js"), readFileSync(join(dir, "index.js"), "utf8") + "\nexport { runAiModel as __runAiModel, containerAi as __containerAi };\n");
const M = await import(pathToFileURL(join(tmp, "index.js")).href);
const P = await import(pathToFileURL(join(tmp, "ai_policy.js")).href);

let calls = 0;
const AI = { run: async (model, input) => { calls++; return model.includes("llama-3.2") ? { response: '{"text":""}' } : { response: "A verse.", text: "hello", image: btoa("x".repeat(30)) }; } };
const files = new Map();
const FILES = { put: async (k, v) => files.set(k, v), get: async () => null };
const write = (prompt, owner = "acct1") => M.__runAiModel(env, { id: "p1", model: "rb/write", owner, input: { mode: "free", prompt } }, { aiModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" });

// 1. no DB binding: as before, even a prompt the filters would stop
let env = { AI, FILES };
assert.equal((await write("a white power anthem")).text, "A verse."); assert.equal(calls, 1);

// 2. DB bound: checked and logged
const DB = fakeD1(); DB.batch = async (st) => Promise.all(st.map((s) => s.run()));
DB.raw.exec("CREATE TABLE site_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)");
env = { AI, FILES, DB };
const rows = () => DB.raw.prepare("SELECT * FROM ai_audit ORDER BY at").all();
assert.equal((await write("A verse about Vallejo")).text, "A verse."); assert.equal(calls, 2);
let r = rows().pop();
assert.equal(r.outcome, "done"); assert.equal(r.kind, "text"); assert.equal(r.who, "member:acct1"); assert.match(r.ref, /^rb-cloud rb\/write p1$/);
await assert.rejects(write("a white power anthem"), /hate symbols/i); assert.equal(calls, 2, "no model call");
assert.equal(rows().pop().outcome, "blocked");
// cover art goes through the picture filters
await assert.rejects(M.__runAiModel(env, { id: "p2", model: "rb/cover-art", owner: null, input: { prompt: "a swastika flag" } }, { aiModel: "@cf/black-forest-labs/flux-1-schnell" }), /blocked/);
assert.equal(rows().pop().who, "operator");
// paused
DB.raw.prepare("INSERT INTO site_settings (key, value) VALUES ('ai_policy', ?)").run(JSON.stringify({ on: { public: false } }));
await P.loadPolicy(DB, { fresh: true });
await assert.rejects(write("Anything"), /paused by the operator/); assert.equal(calls, 2);
DB.raw.prepare("DELETE FROM site_settings").run(); await P.loadPolicy(DB, { fresh: true });
// the audio engine's cover check is logged too
const out = await M.__containerAi(env, "artwork", new Uint8Array(10), new URLSearchParams());
assert.equal(out.text, ""); assert.equal(rows().pop().kind, "vision");
// a model error is logged as failed and still reaches the caller
const bad = { ...env, AI: { run: async () => { throw new Error("model down"); } } };
await assert.rejects(M.__runAiModel(bad, { id: "p3", model: "rb/write", input: { prompt: "A clean verse" } }, { aiModel: "m" }), /model down/);
assert.equal(rows().pop().outcome, "failed");
console.log(`AI policy (rb-cloud) ok: unchanged without a DB binding; with one, checked before the model and ${rows().length} calls logged`);
