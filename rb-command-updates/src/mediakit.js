/**
 * Media kit: the public traffic numbers behind relentlessbillionaire.com/advertise.
 *
 * Saves totals only (visits, page views, each site's share, devices and top countries over the last 30 days) to D1
 * table site_stats, row "media_kit_30d". The main site reads that row and shows it to advertisers. Nothing about a
 * single visitor is saved, and headless browsers (bots and site checks) are left out, the same as on the Analytics screen.
 *
 * It's refreshed by the daily scheduled run, and whenever someone opens Analytics for 30 days across all sites.
 */
import { report } from "./analytics.js";

const KEY = "media_kit_30d";
const share = (rows, total) => rows.filter((x) => x.name || x.code).slice(0, 5).map((x) => ({ name: x.name || x.code, pct: total ? Math.round((x.views / total) * 100) : 0 }));

/** The public part of a 30-day, all-sites Analytics report, or null when the report has no numbers. */
export function snapshot(r) {
  if (!r || !r.ok || !r.connected || r.error || r.host || r.bots || r.range !== "30d" || !r.totals) return null;
  const views = r.totals.views;
  return {
    from: r.from, to: r.to, visits: r.totals.visits, views,
    sites: (r.hosts || []).slice(0, 12).map((h) => ({ host: h.host, visits: h.visits, views: h.views })),
    devices: share(r.devices || [], views),
    countries: share(r.countries || [], views),
  };
}

export async function save(env, r) {
  const snap = snapshot(r);
  if (!snap || !env.DB) return false;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS site_stats (key TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
  await env.DB.prepare("INSERT INTO site_stats (key, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at")
    .bind(KEY, JSON.stringify(snap), new Date().toISOString()).run();
  return true;
}

/** For the daily run: build the 30-day report and save it. */
export async function refresh(env, ctx) {
  const r = await report(env, ctx || { waitUntil() {} }, new URLSearchParams("range=30d"));
  return save(env, r);
}
