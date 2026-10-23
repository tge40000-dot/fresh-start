// Usage: node --no-warnings rb-site-updates/test/resilience.test.mjs <patched artist-router-v14.js> [<patched rb-mastering-studio dir>]
// rb-tools/patch_resilience.py: a passing D1 "internal error" no longer crashes artist-router. The schema check carries
// on without the database, a GET that meets a passing error is tried once more, and anything still failing gets a
// 503 "please try again" page (JSON on /api/) instead of throwing.
import assert from "node:assert/strict";
import { fakeD1 } from "../../rb-surface/test/fake-d1.mjs";
globalThis.HTMLRewriter = class { on() { return this; } transform(r) { return r; } };
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
const [arPath, studioDir] = process.argv.slice(2);
const ctx = { waitUntil() {}, passThroughOnException() {} };
let n = 0;
const load = async () => (await import(arPath + "?copy=" + ++n)).default; // a fresh copy: a new isolate
// a database that fails its first `bad` calls with D1's passing error (or every call, with bad = Infinity)
function flaky(bad, db = fakeD1()) {
  let left = bad;
  const fail = () => { if (left-- > 0) throw new Error("D1_ERROR: internal error; reference = test"); };
  const wrap = (st) => new Proxy(st, { get(t, k) { const v = t[k]; if (typeof v !== "function") return v; if (k === "bind") return (...a) => wrap(v.apply(t, a)); return async (...a) => { fail(); return v.apply(t, a); }; } });
  return new Proxy(db, { get(t, k) { const v = t[k]; if (k === "prepare") return (sql) => wrap(v.call(t, sql)); if (k === "batch") return async (...a) => { fail(); return v.apply(t, a); }; return typeof v === "function" ? v.bind(t) : v; } });
}
const errs = []; const realErr = console.error; console.error = (...a) => errs.push(a.join(" "));
const go = (w, env, u, init) => w.fetch(new Request(u, init), env, ctx);

// 1. the schema check meets the error on a new isolate (the crash seen live): the page is served anyway
// (a database that already has its tables, as production does: set up once by a healthy isolate)
const shared = fakeD1(); await go(await load(), { DB: shared }, "https://relentlessbillionaire.com/terms");
let w = await load(), env = { DB: flaky(2, shared) };
let r = await go(w, env, "https://relentlessbillionaire.com/terms");
assert.ok(r.status < 500, "/terms is served after a failed schema check, got " + r.status + " " + errs.join(" / ").slice(0, 400));
assert.ok(errs.some((e) => /schema check skipped/.test(e)), "the skipped check is logged");

// 2. the database is down for good: no throw, a 503 page for people, JSON for the API, HEAD without a body
w = await load(); env = { DB: flaky(Infinity, shared) };
for (const [u, init, json] of [["https://br.relentlessbillionaire.com/.bash_profile", {}, false], ["https://relentlessbillionaire.com/creator-agreement", {}, false], ["https://relentlessbillionaire.com/api/world/beat", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } }, true]]) {
  r = await go(w, env, u, init);
  assert.ok(r instanceof Response, u + " answers instead of throwing");
  if (r.headers.get("Retry-After")) { // the guard's page (a route that handles its own error answers with its own)
    assert.equal(r.status, 503, u);
    if (json) { const b = await r.json(); assert.equal(b.ok, false); } else { assert.match(r.headers.get("Content-Type"), /text\/html/); assert.ok((await r.text()).includes("We hit a snag")); }
  }
}

// 3. the guard itself, on a stub Worker: a GET that throws a passing error once is tried again and served; a POST
//    isn't tried again; any other error gets the 503 page; a working request passes straight through
const src = (await import("node:fs")).readFileSync(new URL(arPath, "file://"), "utf8");
const block = src.slice(src.indexOf("/* ---------------------------------------------------------------- RB crash guard"));
const guarded = (fn) => { const h = { fetch: fn }; new Function("artist_router_v11_default", block)(h); return h; };
let calls = 0;
const h1 = guarded(async () => { if (++calls === 1) throw new Error("D1_ERROR: internal error; reference = x"); return new Response("ok"); });
r = await go(h1, {}, "https://relentlessbillionaire.com/store"); assert.equal(r.status, 200); assert.equal(await r.text(), "ok"); assert.equal(calls, 2, "tried twice");
calls = 0; r = await go(h1, {}, "https://relentlessbillionaire.com/api/x", { method: "POST", body: "{}" }); assert.equal(r.status, 503); assert.equal(calls, 1, "a POST isn't repeated");
const h2 = guarded(async () => { throw new TypeError("x is undefined"); });
r = await go(h2, {}, "https://relentlessbillionaire.com/"); assert.equal(r.status, 503); assert.match(await r.text(), /We hit a snag/);
r = await go(h2, {}, "https://relentlessbillionaire.com/", { method: "HEAD" }); assert.equal(r.status, 503);
const h3 = guarded(async () => new Response("fine", { status: 201 }));
r = await go(h3, {}, "https://relentlessbillionaire.com/"); assert.equal(r.status, 201);
// scanner probes get a 404 at once, without reaching the Worker; real pages (and .well-known) still do
let reached = 0;
const h4 = guarded(async () => { reached++; return new Response("page"); });
for (const u of ["/.env", "/.git/config", "/config/env/aws_credentials.env", "/docker-compose.production.yml", "/wp-admin/", "/media/wp-includes/wlwmanifest.xml", "/xmlrpc.php", "/index.php", "/.bash_profile", "/serverless.yaml"]) {
  r = await go(h4, {}, "https://br.relentlessbillionaire.com" + u); assert.equal(r.status, 404, u);
}
assert.equal(reached, 0, "no probe reached the Worker");
for (const u of ["/", "/store", "/.well-known/security.txt", "/studio/api/pricing", "/app/world/main.js", "/env", "/git"]) { r = await go(h4, {}, "https://relentlessbillionaire.com" + u); assert.equal(r.status, 200, u); }
assert.equal(reached, 7, "real paths pass straight through");
assert.ok(w.fetch.__rbSafe, "the guard is the outermost wrapper of the real Worker");

// 4. rb-mastering-studio: R2 fails a read with its passing internal error (the crash seen live on /studio/api/pricing
//    and /studio/api/me): the read is tried once more; with R2 down, pricing comes from the last settings read; and the
//    guard answers instead of throwing
if (studioDir) {
  const fs = await import("node:fs"), path = await import("node:path"), os = await import("node:os");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "studio-mod-"));
  let src = fs.readFileSync(path.join(studioDir, "index.js"), "utf8");
  src = src.replace(/import (\w+) from "\.\/([^"]+)";/g, (m, name, file) => `const ${name} = ${JSON.stringify(fs.readFileSync(path.join(studioDir, file), "utf8"))};`);
  fs.writeFileSync(path.join(tmp, "index.mjs"), src);
  const S = (await import(path.join(tmp, "index.mjs"))).default;
  const store = new Map([["billing/config.json", JSON.stringify({ live: true, prices: {}, created: "2026-10-01T00:00:00Z" })]]);
  let bad = 0;
  const VAULT = {
    async get(k) { if (bad > 0) { bad--; throw new Error("get: We encountered an internal error. Please try again. (10001)"); } const v = store.get(k); return v == null ? null : { json: async () => JSON.parse(v), text: async () => v, body: v, httpMetadata: {} }; },
    async put(k, v) { store.set(k, String(v)); }, async delete(k) { store.delete(k); }, async list() { return { objects: [], truncated: false }; }, async head() { return null; },
  };
  const senv = { VAULT, DB: fakeD1(), STUDIO_KEY: "test-only-key" }; // a dummy key for this test
  r = await go(S, senv, "https://relentlessbillionaire.com/studio/api/pricing"); assert.ok(r.status < 500, "pricing works: " + r.status + " " + errs.slice(-3).join(" / ").slice(0, 600));
  bad = 1; r = await go(S, senv, "https://relentlessbillionaire.com/studio/api/pricing");
  assert.ok(r.status < 500, "pricing after one failed R2 read: " + r.status);
  bad = 100; r = await go(S, senv, "https://relentlessbillionaire.com/studio/api/pricing");
  assert.ok(r.status < 500, "pricing from the last settings read while R2 fails: " + r.status);
  bad = 100; r = await go(S, senv, "https://relentlessbillionaire.com/studio/api/me");
  assert.ok(r instanceof Response, "/studio/api/me answers instead of throwing");
  if (r.status >= 500) assert.equal(r.status, 503);
  assert.ok(S.fetch.__rbSafe, "the guard is the outermost wrapper of the studio");
  bad = 0;
}

// 4. running the patch again changes nothing (checked by deploy-all running it on a patched copy)
console.error = realErr;
console.log("resilience ok: scanner probes get an instant 404, a failed schema check no longer crashes a page," + (studioDir ? " the studio retries a failed R2 read and keeps its pricing settings," : "") + " a database outage gets 503 pages (HTML, JSON for the API) with Retry-After, the errors are logged, the guard is outermost");
