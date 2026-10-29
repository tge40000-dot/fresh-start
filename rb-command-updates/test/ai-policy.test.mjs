// Usage: node --no-warnings rb-command-updates/test/ai-policy.test.mjs <patched rb-command dir>
// RB Command > AI limits through RB Command's own request handler: owner only, publish (and the AI Forge sync through
// Autopilot), put back, try a prompt, the log with filters and paging, the page and its script, the nav entry.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fakeD1 } from "../../rb-surface/test/fake-d1.mjs";
const dir = process.argv[2];
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
const { handle } = await import(join(dir, "index.js"));
const P = await import(join(dir, "ai_policy.js"));
const DB = fakeD1();
DB.batch = async (stmts) => Promise.all(stmts.map((s) => s.run ? s.run() : s.all()));
DB.raw.exec("CREATE TABLE site_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT); CREATE TABLE command_log (id INTEGER PRIMARY KEY, actor TEXT, action TEXT, target TEXT, detail TEXT, created_at TEXT DEFAULT (datetime('now')))");
DB.raw.exec("CREATE TABLE creative_ideas (id TEXT PRIMARY KEY, status TEXT); INSERT INTO creative_ideas VALUES ('a', 'proposed'), ('b', 'proposed'), ('c', 'ready')");
const synced = [];
let forgeVersion = null;
const AUTOPILOT = {
  aiSync: async (o) => { synced.push(o); forgeVersion = P.policyVersion(await P.loadPolicy(DB, { fresh: true })); return { ok: true, version: forgeVersion, pulled: 0 }; },
  aiForgeStatus: async () => ({ ok: true, version: forgeVersion, checked_at: new Date().toISOString() }),
};
const env = { DB, AUTOPILOT };
const ctx = { waitUntil() {}, passThroughOnException() {} };
const who = (role) => ({ email: role + "@rb.test", name: role, role });
const call = async (role, path, body) => {
  const req = new Request("https://team.relentlessbillionaire.com" + path, body === undefined ? { headers: { Accept: "application/json" } }
    : { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", "X-RB-Command": "1", Origin: "https://team.relentlessbillionaire.com" }, body: JSON.stringify(body) });
  try { const res = await handle(req, env, ctx, who(role)); const ct = res.headers.get("Content-Type") || ""; return { status: res.status, headers: res.headers, data: ct.includes("json") ? await res.json() : await res.text() }; }
  catch (e) { return { status: e.status || 500, error: e.message }; }
};

// owner only, every route
for (const role of ["manager", "editor", "support", "store"]) {
  for (const [path, body] of [["/ai"], ["/api/ai-policy"], ["/api/ai-policy/audit"], ["/api/ai-policy", { policy: {} }], ["/api/ai-policy/undo", {}], ["/api/ai-policy/check", { prompt: "x" }]]) {
    const r = await call(role, path, body);
    assert.equal(r.status, 403, `${role} ${body ? "POST" : "GET"} ${path}`);
  }
}

// first look: RB's defaults, not saved yet; the Forge's status and the approvals waiting
let r = await call("owner", "/api/ai-policy");
assert.equal(r.status, 200);
assert.equal(r.data.saved, false); assert.deepEqual(r.data.policy, P.cleanPolicy(null)); assert.equal(r.data.approvals, 2);
assert.equal(r.data.forge.ok, true); assert.equal(r.data.styles.length, 4); assert.equal(r.data.filters.length, 5);

// publish: validated, saved, logged, sent to the Forge
r = await call("owner", "/api/ai-policy", { policy: { styles: { allowed: ["photoreal"], default: "dark-luxury" } } });
assert.equal(r.status, 400); assert.match(r.error, /default style must be one of the allowed/);
r = await call("owner", "/api/ai-policy", { policy: { on: { public: false }, image: { maxSide: 1536 }, filters: { terms: ["Rival Records", "rival records", " x "] } } });
assert.equal(r.status, 200);
assert.equal(r.data.saved, true); assert.equal(r.data.policy.on.public, false); assert.equal(r.data.policy.image.maxSide, 1536);
assert.deepEqual(r.data.policy.filters.terms, ["rival records"], "words cleaned and deduplicated; one letter dropped");
assert.equal(r.data.sync.ok, true); assert.deepEqual(synced.pop(), { by: "owner@rb.test" });
assert.equal(r.data.forge.version, r.data.version, "the Forge has this version");
assert.match(r.data.summary, /paused: public/); assert.equal(r.data.updated_by, "owner@rb.test");
const logged = DB.raw.prepare("SELECT * FROM command_log WHERE target = 'ai limits'").all();
assert.equal(logged.length, 1); assert.match(logged[0].detail, /pictures up to 1536px/);
// the public tools read it from the same place
assert.equal((await P.loadPolicy(DB, { fresh: true })).on.public, false);

// a second save keeps the first for Put back
r = await call("owner", "/api/ai-policy", { policy: { ...r.data.policy, on: { public: true, forge: true, autopilot: true } } });
assert.equal(r.data.previous && r.data.previous.policy.on.public, false);
r = await call("owner", "/api/ai-policy/undo", {});
assert.equal(r.status, 200); assert.equal(r.data.policy.on.public, false, "put back");
assert.equal(synced.length, 2, "put back is sent to the Forge too");

// Autopilot not answering: saved anyway, and said so
env.AUTOPILOT = { aiSync: async () => { throw new Error("down"); }, aiForgeStatus: async () => { throw new Error("down"); } };
r = await call("owner", "/api/ai-policy", { policy: { on: { public: true, forge: true, autopilot: true } } });
assert.equal(r.status, 200); assert.equal(r.data.sync.ok, false); assert.match(r.data.sync.error, /next 10-minute run/);
assert.equal(r.data.forge.ok, false);
env.AUTOPILOT = AUTOPILOT;

// try a prompt against the draft on screen; nothing is generated
r = await call("owner", "/api/ai-policy/check", { policy: { styles: { allowed: ["dark-luxury"], default: "dark-luxury", lock: true } }, kind: "image", prompt: "rooftop" });
assert.equal(r.data.result.ok, true); assert.match(r.data.result.prompt, /dark luxury editorial/); assert.equal(r.data.aiCheck, true);
r = await call("owner", "/api/ai-policy/check", { kind: "image", prompt: "a nude statue" });
assert.equal(r.data.result.ok, false); assert.match(r.data.result.message, /sexual or nude/);
r = await call("owner", "/api/ai-policy/check", { surface: "autopilot", autonomous: true, kind: "music", prompt: "beat" });
assert.equal(r.data.result.code, "approval_required");

// the log: filters, search, paging
const policy = await P.loadPolicy(DB, { fresh: true });
for (let i = 0; i < 60; i++) await P.writeAudit(DB, policy, { at: new Date(Date.UTC(2026, 9, 28, 12, 0, i)).toISOString(), surface: i % 3 === 0 ? "forge" : "public", kind: i % 2 ? "image" : "speech", outcome: i % 5 === 0 ? "blocked" : "done", prompt: `prompt ${i}${i === 7 ? " golden gate" : ""}`, model: "@cf/black-forest-labs/flux-2-klein-9b", who: "visitor:abc" });
r = await call("owner", "/api/ai-policy/audit");
assert.equal(r.data.rows.length, 50); assert.equal(r.data.more, true); assert.equal(r.data.rows[0].prompt, "prompt 59", "newest first");
const older = await call("owner", "/api/ai-policy/audit?before=" + encodeURIComponent(r.data.rows[49].at));
assert.equal(older.data.rows.length, 10); assert.equal(older.data.more, false);
assert.equal((await call("owner", "/api/ai-policy/audit?outcome=blocked")).data.rows.length, 12);
assert.ok((await call("owner", "/api/ai-policy/audit?surface=forge&kind=image")).data.rows.every((x) => x.surface === "forge" && x.kind === "image"));
assert.deepEqual((await call("owner", "/api/ai-policy/audit?q=golden")).data.rows.map((x) => x.prompt), ["prompt 7 golden gate"]);
assert.equal((await call("owner", "/api/ai-policy/audit?q=%25")).data.rows.length, 0, "a % in the search is literal");
r = await call("owner", "/api/ai-policy");
assert.ok(r.data.stats.length === 0 || r.data.stats.every((s) => typeof s.n === "number"));

// the page: owner gets it under a strict CSP, its script parses, no inline style attributes
r = await call("owner", "/ai");
assert.equal(r.status, 200);
const csp = r.headers.get("Content-Security-Policy");
assert.match(csp, /script-src 'nonce-[^']+'/); assert.match(csp, /default-src 'none'/); assert.equal(r.headers.get("X-Frame-Options"), "DENY");
const html = r.data;
const nonce = csp.match(/'nonce-([^']+)'/)[1];
assert.equal((html.match(/<script nonce="([^"]+)">/g) || []).length, 1); assert.ok(html.includes(`<script nonce="${nonce}">`));
assert.ok(!/\sstyle="/.test(html), "no style attributes (the CSP would drop them)");
const f = join(mkdtempSync(join(tmpdir(), "rbc-ai-")), "client.js");
writeFileSync(f, html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1]);
execFileSync(process.execPath, ["--check", f]);
const ui = readFileSync(join(dir, "ui.js"), "utf8"), idx = readFileSync(join(dir, "index.js"), "utf8");
assert.equal(ui.split('if (ME.role === "owner") NAV_TOP.push(["/ai", "AI limits"]);').length - 1, 1, "nav entry once, owner only");
assert.equal(ui.split('"/ai": "Growth"').length - 1, 1);
for (const m of ['import * as aipolicy from "./aipolicy.js";', 'if (path === "/ai") {', 'if (path === "/api/ai-policy/check")']) assert.equal(idx.split(m).length - 1, 1, m);
console.log("AI limits (RB Command) ok: owner only on every route, defaults, publish with checks and the Forge sync, put back, Autopilot down, try a prompt, the log (filters, search, paging), the page under its CSP, the nav");
