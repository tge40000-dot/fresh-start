// Usage: node --no-warnings rb-command-updates/test/analytics.test.mjs <patched rb-command dir>
// Runs analytics.js against a fake Cloudflare GraphQL API, the /api/analytics route through RB Command's own request
// handler, and checks that the page renders and its script parses.
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const dir = process.argv[2];
const an = await import(join(dir, "analytics.js"));
const { handle } = await import(join(dir, "index.js"));
const { renderPage } = await import(join(dir, "ui.js"));

// ---------------------------------------------------------------- the query
let q = an.buildQuery({ host: "", bots: false });
assert.ok(q.includes('userAgentBrowser_neq:"ChromeHeadless"') && q.includes("requestHost_neq:$t"), "headless browsers and RB Command left out");
assert.ok(!q.includes("$h"), "no site variable unless a site is chosen");
q = an.buildQuery({ host: "shop.relentlessbillionaire.com", bots: true });
assert.ok(q.includes(",$h:String!") && q.includes("requestHost:$h") && !q.includes("ChromeHeadless"));
assert.ok(!q.includes("shop.relentlessbillionaire.com"), "the site goes in as a variable, never into the query text");

// ---------------------------------------------------------------- a Cloudflare answer
// Dates relative to today, so the test reads the same whenever it runs.
const D = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const DATA = { viewer: { accounts: [{
  now: [{ count: 681, sum: { visits: 290 } }], prev: [{ count: 700, sum: { visits: 400 } }],
  days: [{ count: 239, sum: { visits: 129 }, dimensions: { date: D(-5) } }, { count: 127, sum: { visits: 67 }, dimensions: { date: D(-4) } }],
  hours: [{ count: 13, sum: { visits: 11 }, dimensions: { datetimeHour: "2026-10-15T03:00:00Z" } }],
  hosts: [{ count: 548, sum: { visits: 192 }, dimensions: { requestHost: "relentlessbillionaire.com" } }, { count: 31, sum: { visits: 21 }, dimensions: { requestHost: "shop.relentlessbillionaire.com" } }],
  pages: [{ count: 163, sum: { visits: 46 }, dimensions: { requestHost: "relentlessbillionaire.com", requestPath: "/radio" } }],
  refs: [{ count: 356, dimensions: { refererHost: "relentlessbillionaire.com" } }, { count: 50, dimensions: { refererHost: "www.facebook.com" } }, { count: 18, dimensions: { refererHost: "partners.relentlessbillionaire.com" } }, { count: 30, dimensions: { refererHost: "l.instagram.com" } }],
  countries: [{ count: 832, dimensions: { countryName: "US" } }, { count: 2, dimensions: { countryName: "DE" } }],
  devices: [{ count: 551, dimensions: { deviceType: "mobile" } }, { count: 284, dimensions: { deviceType: "desktop" } }],
  browsers: [{ count: 517, dimensions: { userAgentBrowser: "ChromeMobile" } }], os: [{ count: 492, dimensions: { userAgentOS: "Android" } }],
  vitalsAll: [{ count: 558, quantiles: { largestContentfulPaintP75: 2096000, interactionToNextPaintP75: 232000, cumulativeLayoutShiftP75: 0.0023, firstContentfulPaintP75: 1980000 } }],
  vitals: [{ count: 27, dimensions: { requestHost: "shop.relentlessbillionaire.com" }, quantiles: { largestContentfulPaintP75: 1744000, interactionToNextPaintP75: 176000, cumulativeLayoutShiftP75: 0.273 } }],
  loads: [{ count: 30, dimensions: { requestHost: "shop.relentlessbillionaire.com" }, quantiles: { pageLoadTimeP50: 1063000, pageLoadTimeP90: 5552000 } }],
  workers: [{ sum: { requests: 35659, errors: 8, subrequests: 7145 }, quantiles: { cpuTimeP50: 797, cpuTimeP99: 20274 }, dimensions: { scriptName: "artist-router" } }, { sum: { requests: 3711, errors: 0, subrequests: 10 }, quantiles: { cpuTimeP50: 1500, cpuTimeP99: 9000 }, dimensions: { scriptName: "rb-command" } }],
  wdays: [{ sum: { requests: 15336, errors: 0 }, dimensions: { date: "2026-10-09" } }],
}] } };

const sent = [];
const fakeFetch = async (url, init) => { sent.push({ url, init, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ data: DATA, errors: null }), { headers: { "Content-Type": "application/json" } }); };
const ctx = { waitUntil() {} };
const env = { CF_ANALYTICS_TOKEN: "test-token", TEAM_ORIGIN: "https://team.relentlessbillionaire.com" };

assert.deepEqual(await an.report({}, ctx, new URLSearchParams()), { ok: true, connected: false }, "no token: says so, asks nothing");

let r = await an.report(env, ctx, new URLSearchParams("range=7d"), fakeFetch);
const call = sent.at(-1);
assert.equal(call.url, "https://api.cloudflare.com/client/v4/graphql");
assert.equal(call.init.headers.Authorization, "Bearer test-token");
assert.equal(call.body.variables.t, "team.relentlessbillionaire.com");
assert.equal(call.body.variables.a, "0a7be075f32d9d615349825b83ab8fcb");
assert.ok(Math.abs(Date.parse(call.body.variables.e) - Date.parse(call.body.variables.s) - 7 * 864e5) < 5000, "7 days");
assert.ok(Math.abs(Date.parse(call.body.variables.s) - Date.parse(call.body.variables.ps) - 7 * 864e5) < 5000, "compared with the 7 days before");
assert.deepEqual(r.totals, { views: 681, visits: 290, prev_views: 700, prev_visits: 400 });
assert.equal(r.hourly, false); assert.equal(r.series.length, 8, "every day in the 7 days, today included");
assert.ok(r.series.every((s, i) => i === 0 || Date.parse(s.t) - Date.parse(r.series[i - 1].t) === 864e5), "one bar per day, none skipped");
assert.equal(r.series.reduce((t, s) => t + s.visits, 0), 196, "quiet days count as zero");
assert.deepEqual(r.referrers.map((x) => x.host), ["www.facebook.com", "l.instagram.com"], "RB's own sites aren't counted as sources");
assert.equal(r.internal_views, 374);
assert.deepEqual(r.vitals, { lcp: 2096, inp: 232, cls: 0.002, fcp: 1980, samples: 558 }, "microseconds to milliseconds");
const shop = r.hosts.find((h) => h.host === "shop.relentlessbillionaire.com");
assert.equal(shop.vitals.cls, 0.273); assert.deepEqual(shop.load, { p50: 1063, p90: 5552 });
assert.equal(r.hosts[0].vitals, null, "a site without samples shows none, not zero");
assert.deepEqual(an.shape({ vitalsAll: [{ count: 3, quantiles: { largestContentfulPaintP75: 650000, interactionToNextPaintP75: 0, cumulativeLayoutShiftP75: -1, firstContentfulPaintP75: 0 } }] }, { range: "7d", from: "2026-10-09T00:00:00Z", to: "2026-10-16T00:00:00Z" }).vitals, { lcp: 650, inp: null, cls: null, fcp: null, samples: 3 }, "nothing measured isn't a score");
assert.deepEqual(r.workers.scripts[0], { name: "artist-router", requests: 35659, errors: 8, subrequests: 7145, cpu_p50: 0.8, cpu_p99: 20.3 });
assert.equal(r.workers.requests, 39370); assert.equal(r.workers.errors, 8);

r = await an.report(env, ctx, new URLSearchParams("range=1d&host=shop.relentlessbillionaire.com&bots=1"), fakeFetch);
assert.equal(r.hourly, true); assert.ok(r.series.length === 24 || r.series.length === 25, "an hour per bar"); assert.ok(r.series.every((s) => /T\d\d:00:00Z$/.test(s.t))); assert.equal(r.host, "shop.relentlessbillionaire.com"); assert.equal(r.bots, true);
assert.equal(sent.at(-1).body.variables.h, "shop.relentlessbillionaire.com");
r = await an.report(env, ctx, new URLSearchParams('range=99d&host=x"}){evil'), fakeFetch);
assert.equal(r.range, "7d", "unknown range falls back to 7 days"); assert.equal(r.host, "", "a host that isn't a host name is ignored");
assert.ok(!("h" in sent.at(-1).body.variables));

r = await an.report(env, ctx, new URLSearchParams(), async () => new Response(JSON.stringify({ data: null, errors: [{ message: "Authentication error" }] })));
assert.deepEqual(r, { ok: true, connected: true, error: "Authentication error" });
r = await an.report(env, ctx, new URLSearchParams(), async () => { throw new TypeError("network"); });
assert.match(r.error, /didn't answer/);

// ---------------------------------------------------------------- the route
const call2 = async (role, e = {}) => {
  try { const res = await handle(new Request("https://team.relentlessbillionaire.com/api/analytics?range=30d", { headers: { Accept: "application/json" } }), e, ctx, { email: "o@x", name: "O", role }); return { status: res.status, data: await res.json() }; }
  catch (err) { return { status: err.status || 500, error: err.message }; }
};
let res = await call2("owner");
assert.equal(res.status, 200); assert.deepEqual(res.data, { ok: true, connected: false });
res = await call2("support");
assert.equal(res.status, 200, "every team member can see it, like the Overview");
res = await call2("store");
assert.equal(res.status, 403, "the store-only role can't");

// ---------------------------------------------------------------- the page
const html = renderPage("N0NCE", { me: { email: "o@x", name: "O", role: "owner", caps: { groups: { Events: "edit", Content: "edit" }, label: "Owner" } }, links: {}, media: "", tables: {}, groups: ["Events"], uploads: true });
const script = html.match(/<script nonce="N0NCE">([\s\S]*?)<\/script>/);
assert.ok(script, "page has its script");
const f = join(mkdtempSync(join(tmpdir(), "rbc-")), "client.js");
writeFileSync(f, script[1]);
execFileSync(process.execPath, ["--check", f]);
assert.ok(html.includes('NAV_TOP.push(["analytics", "Analytics"])') && html.includes("function viewAnalytics(params)") && html.includes("function drawChart(box, series, hourly)"));
assert.ok(html.includes('href="#/analytics">Connect Cloudflare analytics</a>'), "the Overview tile points at the screen");
assert.ok(html.includes(".achart{"), "styles are in the stylesheet");
assert.ok(!/style="/.test(script[1].replace(/\\"/g, '"').match(/function viewAnalytics[\s\S]*?\n  }\n/)[0]), "no inline styles (the CSP blocks them)");
console.log("analytics ok: query, filters, units, sources, vitals, Workers, ranges, bad input, errors, route permissions, page script parses");
