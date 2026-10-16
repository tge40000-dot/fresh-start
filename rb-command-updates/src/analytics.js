/**
 * Analytics: Cloudflare's numbers for every RB site, in RB Command.
 *
 * Visitors come from Cloudflare Web Analytics (the beacon is already on the RB sites): visits, page views, sites, top
 * pages, where people come from, countries, devices, browsers, and how fast pages load for real visitors (Core Web
 * Vitals). Worker traffic comes from Workers analytics: requests, errors and CPU time for each Worker.
 *
 * Needs CF_ANALYTICS_TOKEN, a Cloudflare API token with only "Account Analytics: Read". Without it the screen explains
 * how to add one. Answers are cached for 10 minutes. RB Command's own host is left out, and so are headless browsers
 * (site checks and bots) unless asked for.
 */
const RANGES = { "1d": 1, "7d": 7, "30d": 30 };
const HOST = /^[a-z0-9][a-z0-9.-]{0,120}$/;
const n = (v) => Number(v) || 0;
const ms = (us) => (us == null ? null : Math.round(Number(us) / 1000));
const cpu = (us) => (us == null ? null : Math.round(Number(us) / 100) / 10);
/** RB's own sites, so links between them don't count as where visitors come from. */
const OWN = /(^|\.)(relentlessbillionaire\.(com|vip)|relentless-billionaire\.pages\.dev|tge40000\.workers\.dev)$/;
const iso = (t) => new Date(t).toISOString().replace(/\.\d+Z$/, "Z");

/** The GraphQL query for one report. Filters are written in, never taken from the request as text. */
export function buildQuery({ host, bots }) {
  const rum = (from, to = "datetime_leq:$e") => `{datetime_geq:${from},${to},requestHost_neq:$t${host ? ",requestHost:$h" : ""}${bots ? "" : ',userAgentBrowser_neq:"ChromeHeadless"'}}`;
  const f = rum("$s");
  return `query($a:String!,$s:Time!,$e:Time!,$ps:Time!,$t:String!${host ? ",$h:String!" : ""}){viewer{accounts(filter:{accountTag:$a}){
 now:rumPageloadEventsAdaptiveGroups(limit:1,filter:${f}){count sum{visits}}
 prev:rumPageloadEventsAdaptiveGroups(limit:1,filter:${rum("$ps", "datetime_lt:$s")}){count sum{visits}}
 days:rumPageloadEventsAdaptiveGroups(limit:100,filter:${f},orderBy:[date_ASC]){count sum{visits} dimensions{date}}
 hours:rumPageloadEventsAdaptiveGroups(limit:50,filter:${f},orderBy:[datetimeHour_ASC]){count sum{visits} dimensions{datetimeHour}}
 hosts:rumPageloadEventsAdaptiveGroups(limit:25,filter:${f},orderBy:[count_DESC]){count sum{visits} dimensions{requestHost}}
 pages:rumPageloadEventsAdaptiveGroups(limit:15,filter:${f},orderBy:[count_DESC]){count sum{visits} dimensions{requestHost requestPath}}
 refs:rumPageloadEventsAdaptiveGroups(limit:40,filter:{datetime_geq:$s,datetime_leq:$e,requestHost_neq:$t${host ? ",requestHost:$h" : ""}${bots ? "" : ',userAgentBrowser_neq:"ChromeHeadless"'},refererHost_neq:""},orderBy:[count_DESC]){count dimensions{refererHost}}
 countries:rumPageloadEventsAdaptiveGroups(limit:10,filter:${f},orderBy:[count_DESC]){count dimensions{countryName}}
 devices:rumPageloadEventsAdaptiveGroups(limit:5,filter:${f},orderBy:[count_DESC]){count dimensions{deviceType}}
 browsers:rumPageloadEventsAdaptiveGroups(limit:6,filter:${f},orderBy:[count_DESC]){count dimensions{userAgentBrowser}}
 os:rumPageloadEventsAdaptiveGroups(limit:6,filter:${f},orderBy:[count_DESC]){count dimensions{userAgentOS}}
 vitalsAll:rumWebVitalsEventsAdaptiveGroups(limit:1,filter:${f}){count quantiles{largestContentfulPaintP75 interactionToNextPaintP75 cumulativeLayoutShiftP75 firstContentfulPaintP75}}
 vitals:rumWebVitalsEventsAdaptiveGroups(limit:25,filter:${f},orderBy:[count_DESC]){count dimensions{requestHost} quantiles{largestContentfulPaintP75 interactionToNextPaintP75 cumulativeLayoutShiftP75}}
 loads:rumPerformanceEventsAdaptiveGroups(limit:25,filter:${f},orderBy:[count_DESC]){count dimensions{requestHost} quantiles{pageLoadTimeP50 pageLoadTimeP90}}
 workers:workersInvocationsAdaptive(limit:60,filter:{datetime_geq:$s,datetime_leq:$e},orderBy:[sum_requests_DESC]){sum{requests errors subrequests} quantiles{cpuTimeP50 cpuTimeP99} dimensions{scriptName}}
 wdays:workersInvocationsAdaptive(limit:100,filter:{datetime_geq:$s,datetime_leq:$e},orderBy:[date_ASC]){sum{requests errors} dimensions{date}}
}}}`;
}

/** Turns Cloudflare's answer into what the screen draws. */
export function shape(a, { range, host, bots, from, to }) {
  // Cloudflare reports "nothing measured" as 0 or -1; those show as no number, not as a good score.
  const pos = (v) => (v == null || !(Number(v) > 0) ? null : v);
  const vitals = (q) => (q ? { lcp: ms(pos(q.largestContentfulPaintP75)), inp: ms(pos(q.interactionToNextPaintP75)), cls: q.cumulativeLayoutShiftP75 == null || q.cumulativeLayoutShiftP75 < 0 ? null : Math.round(q.cumulativeLayoutShiftP75 * 1000) / 1000, fcp: ms(pos(q.firstContentfulPaintP75)) } : null);
  const loads = Object.fromEntries((a.loads || []).map((x) => [x.dimensions.requestHost, { p50: ms(x.quantiles.pageLoadTimeP50), p90: ms(x.quantiles.pageLoadTimeP90) }]));
  const vit = Object.fromEntries((a.vitals || []).map((x) => [x.dimensions.requestHost, { ...vitals(x.quantiles), samples: n(x.count) }]));
  const hourly = range === "1d";
  // Every hour or day in the range, so quiet ones show as zero instead of closing up the time axis.
  const got = new Map((hourly ? a.hours || [] : a.days || []).map((x) => [hourly ? x.dimensions.datetimeHour.slice(0, 13) : x.dimensions.date, x]));
  const series = [];
  const step = hourly ? 36e5 : 864e5, start = hourly ? Date.parse(from.slice(0, 13) + ":00:00Z") : Date.parse(from.slice(0, 10) + "T00:00:00Z");
  for (let t = start; t <= Date.parse(to) && series.length < 800; t += step) {
    const k = hourly ? new Date(t).toISOString().slice(0, 13) : new Date(t).toISOString().slice(0, 10), x = got.get(k);
    series.push({ t: hourly ? k + ":00:00Z" : k, views: n(x?.count), visits: n(x?.sum?.visits) });
  }
  const scripts = (a.workers || []).map((x) => ({ name: x.dimensions.scriptName, requests: n(x.sum.requests), errors: n(x.sum.errors), subrequests: n(x.sum.subrequests), cpu_p50: cpu(x.quantiles?.cpuTimeP50), cpu_p99: cpu(x.quantiles?.cpuTimeP99) }));
  const totalReq = scripts.reduce((s, x) => s + x.requests, 0), totalErr = scripts.reduce((s, x) => s + x.errors, 0);
  return {
    ok: true, connected: true, range, host, bots, from, to, hourly, generated_at: new Date().toISOString(),
    totals: { views: n(a.now?.[0]?.count), visits: n(a.now?.[0]?.sum?.visits), prev_views: n(a.prev?.[0]?.count), prev_visits: n(a.prev?.[0]?.sum?.visits) },
    series,
    hosts: (a.hosts || []).map((x) => ({ host: x.dimensions.requestHost, views: n(x.count), visits: n(x.sum?.visits), vitals: vit[x.dimensions.requestHost] || null, load: loads[x.dimensions.requestHost] || null })),
    pages: (a.pages || []).map((x) => ({ host: x.dimensions.requestHost, path: x.dimensions.requestPath, views: n(x.count), visits: n(x.sum?.visits) })),
    referrers: (a.refs || []).filter((x) => !OWN.test(x.dimensions.refererHost)).slice(0, 10).map((x) => ({ host: x.dimensions.refererHost, views: n(x.count) })),
    internal_views: (a.refs || []).filter((x) => OWN.test(x.dimensions.refererHost)).reduce((t, x) => t + n(x.count), 0),
    countries: (a.countries || []).map((x) => ({ code: x.dimensions.countryName, views: n(x.count) })),
    devices: (a.devices || []).map((x) => ({ name: x.dimensions.deviceType, views: n(x.count) })),
    browsers: (a.browsers || []).map((x) => ({ name: x.dimensions.userAgentBrowser, views: n(x.count) })),
    os: (a.os || []).map((x) => ({ name: x.dimensions.userAgentOS, views: n(x.count) })),
    vitals: { ...vitals(a.vitalsAll?.[0]?.quantiles), samples: n(a.vitalsAll?.[0]?.count) },
    workers: { requests: totalReq, errors: totalErr, scripts, series: (a.wdays || []).map((x) => ({ t: x.dimensions.date, requests: n(x.sum.requests), errors: n(x.sum.errors) })) },
  };
}

/** The report for a range (1d, 7d or 30d), optionally one site, optionally counting headless browsers. */
export async function report(env, ctx, params, fetcher = fetch) {
  if (!env.CF_ANALYTICS_TOKEN) return { ok: true, connected: false };
  const range = RANGES[params.get("range")] ? params.get("range") : "7d";
  const host = HOST.test(params.get("host") || "") ? params.get("host").toLowerCase() : "";
  const bots = params.get("bots") === "1";
  const key = new Request(`https://rb-command.internal/analytics/v1?range=${range}&host=${encodeURIComponent(host)}&bots=${bots ? 1 : 0}`);
  const cache = globalThis.caches?.default;
  const hit = cache && (await cache.match(key));
  if (hit) return hit.json();
  const days = RANGES[range], now = Date.now();
  const vars = { range, host, bots, from: iso(now - days * 864e5), to: iso(now) };
  const team = new URL(env.TEAM_ORIGIN || "https://team.relentlessbillionaire.com").host;
  let d;
  try {
    const r = await fetcher("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST", signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: buildQuery({ host, bots }), variables: { a: env.CF_ACCOUNT_ID || "0a7be075f32d9d615349825b83ab8fcb", s: vars.from, e: vars.to, ps: iso(now - 2 * days * 864e5), t: team, ...(host ? { h: host } : {}) } }),
    });
    d = await r.json();
  } catch {
    return { ok: true, connected: true, error: "Cloudflare analytics didn't answer. Try again in a minute." };
  }
  if (d.errors?.length || !d.data) return { ok: true, connected: true, error: String(d.errors?.[0]?.message || "Cloudflare analytics refused the token.").slice(0, 240) };
  const out = shape(d.data.viewer.accounts[0] || {}, vars);
  if (cache) ctx.waitUntil(cache.put(key, new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json", "Cache-Control": "max-age=600" } })));
  return out;
}
