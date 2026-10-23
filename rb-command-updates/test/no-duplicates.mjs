// Usage: node rb-command-updates/test/no-duplicates.mjs <patched rb-command dir>
// Every block the patches add must appear exactly once (an earlier version of the patch scripts could add one twice).
import { readFileSync } from "node:fs";
import { join } from "node:path";
const dir = process.argv[2];
const ONCE = {
  "index.js": ['import * as mediakit from', 'import * as weeklyHealth from', 'import * as worldadmin from', 'await weeklyHealth.weekly(env)', 'const week = await weeklyHealth.latest(env)', 'if (path === "/world") {', 'if (path === "/api/world-admin")', 'import * as affiliate from', 'import * as showplanner from', 'import * as analytics from', 'import * as rehost from', 'if (path === "/api/affiliate/preview")',
    'if (path === "/api/shows/suggest")', 'if (path === "/api/shows/plans")', 'if (path === "/api/analytics")', 'if (path === "/api/rehost/run")', 'await showplanner.topUp(env).catch(() => null)', 'await analytics.crashes(env).catch(() => null)', 'async function daily(env)'],
  "ui.js": ['NAV_TOP.push(["/world", "RB World"])', "function viewAffiliate()", "function viewShows(params)", "function showCalendar(", "function viewShowPlan(", "function viewAnalytics(params)", "function drawChart(", "function viewRehost()", "function postLink(",
    ".afgrid{", ".calgrid{display:grid", ".achart{", 'NAV_TOP.push(["affiliate"', 'NAV_TOP.push(["shows"', 'NAV_TOP.push(["analytics"', 'r.name === "affiliate"', 'r.name === "shows"', 'r.name === "analytics"', 'r.name === "rehost"'],
  "tables.js": ['surface: f.pick("Shows on"'],
};
const bad = [];
for (const [f, marks] of Object.entries(ONCE)) {
  const s = readFileSync(join(dir, f), "utf8");
  for (const m of marks) { const n = s.split(m).length - 1; if (n !== 1) bad.push(`${f}: ${m} appears ${n} times`); }
}
if (bad.length) { console.error(bad.join("\n")); process.exit(1); }
console.log("no duplicates: every added block appears exactly once");
