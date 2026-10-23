/**
 * Weekly health: one line a week on how every RB Worker held up, so problems show before Cloudflare emails about them.
 *
 * Once a week (the daily scheduled run checks; the report is made when the last one is 6.5 days old or more) it asks
 * Workers analytics for the last 7 days and the 7 before: requests and errors for each Worker, and how many requests
 * ended early because the visitor left (not an error). It saves the report to D1 table site_stats, row
 * "health_weekly", writes one line to Activity, and the Overview shows it. Totals only, nothing about a single visitor.
 *
 * Needs CF_ANALYTICS_TOKEN (the same "Account Analytics: Read" token Analytics uses). Without it nothing is made.
 */
const KEY = "health_weekly";
const WEEK = 7 * 864e5;
const n = (v) => Number(v) || 0;
const iso = (t) => new Date(t).toISOString().replace(/\.\d+Z$/, "Z");

export const QUERY = `query($a:String!,$s:Time!,$m:Time!,$e:Time!){viewer{accounts(filter:{accountTag:$a}){
 now:workersInvocationsAdaptive(limit:1000,filter:{datetime_geq:$m,datetime_leq:$e}){sum{requests errors} dimensions{scriptName status}}
 prev:workersInvocationsAdaptive(limit:1000,filter:{datetime_geq:$s,datetime_lt:$m}){sum{requests errors} dimensions{scriptName}}
}}}`;

/** The report from Cloudflare's answer: every Worker's week, the ones with errors first. */
export function summarise(d, from, to) {
  const acc = d?.data?.viewer?.accounts?.[0];
  if (!acc || !Array.isArray(acc.now)) throw new Error(String(d?.errors?.[0]?.message || "Cloudflare analytics refused the token."));
  const by = new Map();
  for (const x of acc.now || []) {
    const name = x.dimensions.scriptName, w = by.get(name) || { name, requests: 0, errors: 0, left: 0 };
    w.requests += n(x.sum.requests); w.errors += n(x.sum.errors);
    if (x.dimensions.status === "clientDisconnected") w.left += n(x.sum.requests);
    by.set(name, w);
  }
  const prev = new Map();
  for (const x of acc.prev || []) prev.set(x.dimensions.scriptName, (prev.get(x.dimensions.scriptName) || 0) + n(x.sum.errors));
  const workers = [...by.values()].map((w) => ({ ...w, prev_errors: prev.get(w.name) || 0 })).sort((a, b) => b.errors - a.errors || b.requests - a.requests);
  const sum = (k) => workers.reduce((t, w) => t + w[k], 0);
  return { from, to, workers: workers.length, requests: sum("requests"), errors: sum("errors"), prev_errors: [...prev.values()].reduce((t, v) => t + v, 0),
    left: sum("left"), with_errors: workers.filter((w) => w.errors > 0).slice(0, 10).map(({ name, requests, errors, prev_errors }) => ({ name, requests, errors, prev_errors })) };
}

/** The line for Activity and the Overview. */
export function line(r) {
  const k = (v) => v.toLocaleString("en-US");
  const head = `${r.from.slice(0, 10)} to ${r.to.slice(0, 10)}: ${k(r.requests)} requests across ${r.workers} Workers, `;
  if (!r.errors) return head + `no errors${r.prev_errors ? ` (${k(r.prev_errors)} the week before)` : ""}.`;
  const top = r.with_errors.slice(0, 3).map((w) => `${w.name} ${k(w.errors)} of ${k(w.requests)}`).join(", ");
  return head + `${k(r.errors)} errors (${k(r.prev_errors)} the week before). Most: ${top}.`;
}

export async function latest(env) {
  try {
    const row = await env.DB.prepare("SELECT json, updated_at FROM site_stats WHERE key = ?").bind(KEY).first();
    return row ? { ...JSON.parse(row.json), saved_at: row.updated_at } : null;
  } catch { return null; }
}

/** For the daily run: make this week's report if the last one is 6.5 days old or more. Returns it, or null. */
export async function weekly(env, { fetcher = fetch, now = Date.now(), force = false } = {}) {
  if (!env.CF_ANALYTICS_TOKEN || !env.DB) return null;
  const last = await latest(env);
  if (!force && last && now - Date.parse(last.saved_at) < 6.5 * 864e5) return null;
  const r = await fetcher("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST", signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables: { a: env.CF_ACCOUNT_ID || "0a7be075f32d9d615349825b83ab8fcb", s: iso(now - 2 * WEEK), m: iso(now - WEEK), e: iso(now) } }),
  });
  const rep = summarise(await r.json(), iso(now - WEEK), iso(now));
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS site_stats (key TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
  await env.DB.prepare("INSERT INTO site_stats (key, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at")
    .bind(KEY, JSON.stringify(rep), new Date(now).toISOString()).run();
  await env.DB.prepare("INSERT INTO command_log (actor, action, target, detail) VALUES ('weekly check', 'health.weekly', 'all workers', ?)").bind(line(rep).slice(0, 900)).run().catch(() => {});
  return rep;
}
