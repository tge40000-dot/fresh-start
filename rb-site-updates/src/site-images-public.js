/**
 * Site images on the sites (rb-public-content): the picture each site uses, as chosen in RB Command > Site images.
 *
 *   GET /api/content/site-image?site=<id>&slot=icon|apple|share|background|logo[&fallback=<url>]
 *     The chosen picture itself (same origin, so pages can use it under their CSP). Nothing chosen: the RB icon for
 *     icon and apple, the page's own share picture (fallback) or the RB icon for share, and 204 for the others.
 *   GET /api/content/site-images.css?site=<id>
 *     The background and header-logo rules for one site; empty when nothing is chosen, so pages look as before.
 * Settings and pictures are read from waitlist-db (site_settings.site_images, site_assets) and kept 60 s at the edge.
 */
import { SLOT_IDS, IMAGE_SITES, IMAGE_SITE_IDS, parseImages, pick } from "./site_images_def.js";

const SITE = "https://relentlessbillionaire.com";
const DEFAULTS = { icon: "/brand/icon.svg?v=3", apple: "/brand/apple-touch-icon.png?v=3", share: "/brand/icon-512.png?v=3" };
const OK_HOST = /(^|\.)(relentlessbillionaire\.(com|vip))$|^pub-[a-z0-9]+\.r2\.dev$/;
const TYPE = /^image\/(png|jpeg|webp|gif|avif|x-icon|vnd\.microsoft\.icon)$/;

async function state(env, ctx, origin) {
  const cache = caches.default, key = new Request(`${origin}/api/content/site-images-state?v=1`);
  const hit = await cache.match(key).catch(() => null);
  if (hit) return hit.json();
  let setting = parseImages(null), assets = {};
  try {
    const row = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'site_images'").first();
    setting = parseImages(row && row.value);
    const ids = [...new Set(SLOT_IDS.flatMap((s) => [setting[s].all, ...Object.values(setting[s].sites)]).filter((v) => v && v !== "none"))];
    if (ids.length) {
      const r = await env.DB.prepare(`SELECT id, url, type FROM site_assets WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all();
      for (const a of r.results || []) assets[a.id] = { url: a.url, type: a.type };
    }
  } catch (e) { console.error("site images read failed", e && e.message); }
  const out = { setting, assets };
  ctx.waitUntil(cache.put(key, new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json", "Cache-Control": "public, s-maxage=60" } })).catch(() => {}));
  return out;
}

function chosen(st, slot, site) {
  const id = pick(st.setting, slot, site);
  return id && st.assets[id] ? { id, ...st.assets[id] } : null;
}

export async function siteImage(request, env, ctx, url) {
  const site = String(url.searchParams.get("site") || ""), slot = String(url.searchParams.get("slot") || "");
  if (!IMAGE_SITE_IDS.includes(site) || !["icon", "apple", ...SLOT_IDS].includes(slot)) return new Response("Unknown site or slot", { status: 400 });
  const st = env.DB ? await state(env, ctx, url.origin) : { setting: parseImages(null), assets: {} };
  const a = chosen(st, slot === "apple" ? "icon" : slot, site);
  if (a) {
    const r = await fetch(a.url, { cf: { cacheTtl: 3600, cacheEverything: true } }).catch(() => null);
    const type = r && r.ok ? String(r.headers.get("Content-Type") || a.type || "").split(";")[0] : "";
    if (r && r.ok && TYPE.test(type)) {
      return new Response(r.body, { headers: { "Content-Type": type, "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff", "Access-Control-Allow-Origin": "*", "Cross-Origin-Resource-Policy": "cross-origin" } });
    }
  }
  let to = DEFAULTS[slot];
  if (slot === "share") {
    const raw = String(url.searchParams.get("fallback") || "").replace(/&amp;/g, "&").trim();
    try {
      const f = raw && new URL(raw, SITE);
      if (f && f.protocol === "https:" && OK_HOST.test(f.hostname) && f.pathname !== "/") to = f.toString();
    } catch {}
  }
  if (!to) return new Response(null, { status: 204, headers: { "Cache-Control": "public, max-age=300" } });
  return new Response(null, { status: 302, headers: { Location: new URL(to, SITE).toString(), "Cache-Control": "public, max-age=300" } });
}

export async function siteImagesCss(request, env, ctx, url) {
  const site = String(url.searchParams.get("site") || "");
  const headers = { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff", "Access-Control-Allow-Origin": "*" };
  const def = IMAGE_SITES.find((s) => s.id === site);
  if (!def) return new Response("/* unknown site */\n", { status: 400, headers });
  const st = env.DB ? await state(env, ctx, url.origin) : { setting: parseImages(null), assets: {} };
  const u = (slot, a) => `${SITE}/api/content/site-image?site=${site}&slot=${slot}&v=${a.id}`;
  let css = `/* RB site images: ${site} */\n`;
  const bg = chosen(st, "background", site);
  if (bg) css += `html body{background:linear-gradient(rgba(8,6,10,.74),rgba(8,6,10,.86)),url("${u("background", bg)}") center/cover no-repeat fixed!important;background-color:#0b0a09!important}\n`;
  const logo = chosen(st, "logo", site);
  if (logo && def.logo) css += `${def.logo}{background:url("${u("logo", logo)}") left center/contain no-repeat!important;color:transparent!important;text-shadow:none!important}${def.logo} *{opacity:0!important}\n`;
  return new Response(css, { headers });
}
