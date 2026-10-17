// Usage: node --no-warnings rb-command-updates/test/signal.test.mjs <patched rb-command dir>
// Checks the Live signal data shaping, the /api/signal route, and that the screen's script parses.
import assert from "node:assert/strict";
import { join } from "node:path";
const dir = process.argv[2];
const sg = await import(join(dir, "signal.js"));
const { handle } = await import(join(dir, "index.js"));

const now = Date.parse("2026-10-17T18:00:00Z");
const raw = { data: { viewer: { accounts: [{
  inv: [
    { sum: { requests: 4000, errors: 2 }, quantiles: { cpuTimeP50: 900 }, dimensions: { scriptName: "artist-router" } },
    { sum: { requests: 100, errors: 9 }, quantiles: { cpuTimeP50: 1500 }, dimensions: { scriptName: "rb-store-payments" } },
    { sum: { requests: 3, errors: 0 }, quantiles: { cpuTimeP50: 0 }, dimensions: { scriptName: "brand-new-worker" } },
  ],
  cron: [
    { scriptName: "rb-autopilot", cron: "*/10 * * * *", status: "success", datetime: "2026-10-17T17:50:00Z" },
    { scriptName: "rb-autopilot", cron: "*/10 * * * *", status: "exceededCpu", datetime: "2026-10-17T17:40:00Z" },
    { scriptName: "rb-command", cron: "52 14 * * *", status: "success", datetime: "2026-10-17T14:52:00Z" },
  ],
}] } } };
const s = sg.shape(raw, now);
const by = Object.fromEntries(s.workers.map((w) => [w.name, w]));
assert.equal(by["artist-router"].status, "running", "2 errors in 4,000 is fine");
assert.equal(by["rb-store-payments"].status, "errors", "9 errors flags it");
assert.equal(by["rb-store-payments"].group, "Money");
assert.equal(by["rb-autopilot"].status, "job_failed");
assert.equal(by["rb-autopilot"].ai, true);
assert.deepEqual(by["rb-autopilot"].jobs[0], { cron: "*/10 * * * *", last: "2026-10-17T17:50:00Z", last_status: "success", runs: 2, failed: 1 });
assert.equal(by["brand-new-worker"].group, "Other", "an unknown Worker still shows");
assert.equal(by["brand-new-worker"].cpu_ms, null);
assert.equal(s.workers[0].group, "Money", "Money first");
assert.deepEqual(s.totals, { workers: 5, running: 3, errors: 1, job_failed: 1, requests: 4103, jobs: 2, job_runs: 3, job_fails: 1 });
assert.equal(sg.radio({ on_air: null }), null);
assert.equal(sg.radio({ on_air: { title: "T", artist: "A", starts_at: 1, duration_ms: 2 }, next: [{ title: "N", artist: "B", audio_url: "x" }] }).next[0].audio_url, undefined, "only what the screen needs");

// The route: real handler, fake Cloudflare and radio.
const fetcher = async (url) => String(url).includes("graphql") ? new Response(JSON.stringify(raw)) : new Response(JSON.stringify({ on_air: { title: "Song", artist: "Me" }, next: [] }));
const out = await sg.signal({ CF_ANALYTICS_TOKEN: "t" }, { waitUntil() {} }, fetcher);
assert.equal(out.connected, true); assert.equal(out.radio.title, "Song"); assert.equal(out.workforce.totals.workers, 5);
const none = await sg.signal({}, { waitUntil() {} }, fetcher);
assert.equal(none.connected, false); assert.equal(none.workforce, null);

const call = async (role) => { try { const r = await handle(new Request("https://team.relentlessbillionaire.com/api/signal"), {}, { waitUntil() {} }, { email: "x@example.com", role }); return r.status; } catch (e) { return e.status || 500; } };
assert.equal(await call("owner"), 200);
const { ROLES } = await import(join(dir, "auth.js"));
const limitedRole = Object.keys(ROLES).find((k) => ROLES[k].limited);
if (limitedRole) assert.equal(await call(limitedRole), 403, "store staff can't open it");

// The screen's script parses (CLIENT is built with String.raw, so a stray quote would only show up here).
const { renderPage } = await import(join(dir, "ui.js"));
const html = renderPage("N0NCE", { me: { email: "o@x", name: "O", role: "owner", caps: { groups: { Events: "edit", Content: "edit" }, label: "Owner" } }, links: {}, media: "", tables: {}, groups: ["Events"], uploads: true });
const js = [...html.matchAll(/<script nonce="N0NCE">([\s\S]*?)<\/script>/g)].map((x) => x[1]).join("\n;\n");
assert.ok(js.includes("function viewSignal()") && js.includes('["signal", "Live signal"]'));
const { writeFileSync, mkdtempSync } = await import("node:fs"); const { tmpdir } = await import("node:os"); const { execFileSync } = await import("node:child_process");
const f = join(mkdtempSync(join(tmpdir(), "sig-")), "page.js"); writeFileSync(f, js); execFileSync(process.execPath, ["--check", f]);
console.log("signal ok: shaping, statuses, jobs, roles, route and screen");
