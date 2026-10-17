/**
 * Live signal: one screen with what is running right now, built only from real data.
 *
 * - Every Cloudflare Worker that ran in the last 24 hours: requests, errors, CPU, and each scheduled job's last run.
 *   They come from Cloudflare's own analytics (CF_ANALYTICS_TOKEN, "Account Analytics: Read"), not from a list
 *   kept here, so a new Worker shows up by itself. ROLES only gives the known ones a plain name and a group.
 * - What's on RB Radio now and next (the public /radio/api/now).
 *
 * The rest of the screen (calendar, store, studio funnel) reuses /api/overview and /api/loop on the client.
 * Cached for two minutes, so opening the screen often doesn't hit Cloudflare's API each time.
 */

/** Plain names for the Workers we know. `ai` marks the ones bound to Workers AI. Unknown Workers still show, as "Other". */
export const ROLES = {
  "rb-store-payments": ["Store checkout and paid downloads", "Money"],
  "beatstore": ["Beatstore", "Money"],
  "rb-mastering-studio": ["Studio mastering and billing", "Money"],
  "rb-fund-campaign": ["/fund donations", "Money"],
  "rb-memberships": ["Memberships and booking requests", "Money"],
  "artist-router": ["Main site, store and homepage", "Sites"],
  "rb-public-content": ["Site content API", "Sites"],
  "rb-events-page": ["Events", "Sites"],
  "rb-live-events": ["Live events", "Sites"],
  "rb-release": ["Release and radio submissions", "Sites"],
  "rb-showcase": ["Showcase", "Sites"],
  "rb-partners": ["Partners", "Sites"],
  "rb-jobs": ["RB Jobs", "Sites"],
  "rb-favicon": ["Site icon", "Sites"],
  "rb-game": ["Game page", "Sites"],
  "relentless-hub": ["Game hub", "Sites", "ai"],
  "rb-radio": ["RB Radio", "Music and media"],
  "rb-radio-hub": ["Radio hub and stream", "Music and media"],
  "rb-tv": ["RB TV", "Music and media"],
  "rb-tv-redirect": ["tv. redirect", "Music and media"],
  "rb-daw": ["Recording studio", "Music and media"],
  "relentless-studio": ["Studio tools", "Music and media", "ai"],
  "rb-studio": ["Studio AI tools and donor ledger", "Music and media", "ai"],
  "rb-studio-vip-router": ["Studio (.vip)", "Music and media"],
  "rb-cloud": ["File cloud", "Music and media", "ai"],
  "beatstore-covers": ["Beat covers", "Music and media"],
  "relentless-billionaire-api": ["Media, hub and game API", "Music and media", "ai"],
  "rb-command": ["RB Command", "Operations"],
  "rb-autopilot": ["Autopilot: outreach and content", "Operations", "ai"],
  "relentless-backend": ["Outreach and mail engine", "Operations"],
  "rb-email": ["Email forwarding", "Operations"],
  "recording-studio": ["Recording storage (older)", "Operations"],
  "slank-customs": ["Slank Customs", "Partner sites"],
  "sports4all": ["Sports 4 All", "Partner sites"],
  "fuerzas-del-bay": ["Fuerzas del Bay", "Partner sites"],
  "yoshcoastmusic": ["YOSHCOAST", "Partner sites", "ai"],
  "assassin-in-the-room-signal": ["Assassin in the Room", "Partner sites"],
  "weed-relentless-billionaire": ["weed. site", "Partner sites"],
  "rb-dancer-portal": ["Dancer portal", "Partner sites"],
  "maison-atelier": ["Maison atelier", "Partner sites"],
  "maison-hero-proxy": ["Maison site", "Partner sites"],
  "maison-atelier-gate": ["Maison gate", "Partner sites"],
};
export const GROUPS = ["Money", "Sites", "Music and media", "Operations", "Partner sites", "Other"];

const ACCOUNT = "0a7be075f32d9d615349825b83ab8fcb";
const QUERY = `query($a:String!,$s:Time!,$e:Time!){viewer{accounts(filter:{accountTag:$a}){
inv:workersInvocationsAdaptive(limit:1000,filter:{datetime_geq:$s,datetime_leq:$e}){sum{requests errors}quantiles{cpuTimeP50}dimensions{scriptName}}
cron:workersInvocationsScheduled(limit:2000,filter:{datetime_geq:$s,datetime_leq:$e},orderBy:[datetime_DESC]){scriptName cron status datetime}
hours:workersInvocationsAdaptive(limit:5000,filter:{datetime_geq:$s,datetime_leq:$e}){sum{requests errors}dimensions{scriptName datetimeHour}}}}}`;

/** Turns the raw analytics into one row per Worker. Pure, so the tests can feed it sample data. */
export function shape(raw, now = Date.now()) {
  const acc = raw?.data?.viewer?.accounts?.[0] || {};
  const by = {};
  const row = (name) => (by[name] ||= { name, requests: 0, errors: 0, cpu_ms: null, jobs: [], hourly: new Array(24).fill(0) });
  // One slot per hour for the last 24 hours, oldest first, so each card can draw its own traffic line.
  const hour0 = Math.floor(now / 36e5) * 36e5 - 23 * 36e5;
  for (const x of acc.inv || []) {
    const r = row(x.dimensions.scriptName);
    r.requests += x.sum.requests || 0;
    r.errors += x.sum.errors || 0;
    if (x.quantiles?.cpuTimeP50 > 0) r.cpu_ms = Math.round(x.quantiles.cpuTimeP50 / 100) / 10;
  }
  for (const h of acc.hours || []) {
    const i = Math.round((Date.parse(h.dimensions.datetimeHour) - hour0) / 36e5);
    if (i >= 0 && i < 24) row(h.dimensions.scriptName).hourly[i] += h.sum.requests || 0;
  }
  for (const c of acc.cron || []) {
    const r = row(c.scriptName);
    let j = r.jobs.find((y) => y.cron === c.cron);
    if (!j) r.jobs.push((j = { cron: c.cron, last: c.datetime, last_status: c.status, runs: 0, failed: 0 }));
    j.runs++;
    if (c.status !== "success") j.failed++;
  }
  const workers = Object.values(by).map((r) => {
    const [label, group, ai] = ROLES[r.name] || [r.name, "Other"];
    const failed = r.jobs.reduce((n, j) => n + j.failed, 0);
    const rate = r.requests ? r.errors / r.requests : 0;
    const status = (r.errors >= 5 || (r.errors >= 2 && rate >= 0.01)) ? "errors" : failed ? "job_failed" : (r.requests || r.jobs.length) ? "running" : "quiet";
    return { ...r, label, group, ai: ai === "ai", status, error_rate: Math.round(rate * 1000) / 10 };
  });
  workers.sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || b.requests - a.requests);
  const count = (s) => workers.filter((w) => w.status === s).length;
  const jobs = workers.flatMap((w) => w.jobs);
  return {
    generated_at: new Date(now).toISOString(),
    totals: {
      workers: workers.length, running: count("running"), errors: count("errors"), job_failed: count("job_failed"),
      requests: workers.reduce((n, w) => n + w.requests, 0), jobs: jobs.length,
      job_runs: jobs.reduce((n, j) => n + j.runs, 0), job_fails: jobs.reduce((n, j) => n + j.failed, 0),
    },
    workers,
  };
}

/** The radio's public now-playing, trimmed to what the screen shows. */
export function radio(d) {
  if (!d || !d.on_air) return null;
  return {
    live: d.live ? { title: d.live.title || d.live.name || "Live show", host: d.live.host || "" } : null,
    title: d.on_air.title, artist: d.on_air.artist, cover: d.on_air.cover || null,
    starts_at: d.on_air.starts_at, duration_ms: d.on_air.duration_ms,
    next: (d.next || []).slice(0, 3).map((n) => ({ title: n.title, artist: n.artist })),
    requests_open: !!d.requests_open,
  };
}

export async function signal(env, ctx, fetcher = fetch) {
  const key = new Request("https://rb-command.internal/signal-v1");
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const hit = cache && (await cache.match(key));
  if (hit) return hit.json();
  const now = Date.now(), iso = (t) => new Date(t).toISOString().replace(/\.\d+Z$/, "Z");
  const out = { ok: true, connected: !!env.CF_ANALYTICS_TOKEN, workforce: null, radio: null, errors: [] };
  const work = [];
  if (env.CF_ANALYTICS_TOKEN) work.push((async () => {
    const r = await fetcher("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { a: env.CF_ACCOUNT_ID || ACCOUNT, s: iso(now - 864e5), e: iso(now) } }),
    });
    const d = await r.json();
    if (d.errors?.length) throw new Error("Cloudflare analytics: " + d.errors[0].message);
    out.workforce = shape(d, now);
  })().catch((e) => out.errors.push(String(e.message || e))));
  work.push((async () => {
    const r = await fetcher("https://relentlessbillionaire.com/radio/api/now", { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error("RB Radio: HTTP " + r.status);
    out.radio = radio(await r.json());
  })().catch((e) => out.errors.push(String(e.message || e))));
  await Promise.all(work);
  if (cache && !out.errors.length) {
    const put = cache.put(key, new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json", "Cache-Control": "max-age=120" } }));
    if (ctx?.waitUntil) ctx.waitUntil(put); else await put;
  }
  return out;
}
