/**
 * Site images on the sites (rb-public-content): the picture each site uses, as chosen in RB Command > Site images.
 *
 *   GET /api/content/site-image?site=<id>&slot=icon|apple|share|background|logo[&fallback=<url>]
 *     The chosen picture itself (same origin, so pages can use it under their CSP). Nothing chosen: the RB icon for
 *     icon and apple, the page's own share picture (fallback) or the RB icon for share, and 204 for the others.
 *   GET /api/content/site-images.css?site=<id>
 *     The site tabs, the RB luxe layer (motion and loading states, see LUXE_CSS) and the background and header-logo
 *     rules for one site; background and logo are empty when nothing is chosen, so pages look as before.
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

// The row of RB site tabs (rb-tools/patch_tabs.py puts <nav class="rbtabs" hidden> in every user site's pages).
// Shown and styled only here, so a page that can't load this stylesheet keeps it hidden. Strong selectors and
// !important so each site's own nav and link styles don't restyle it; it sits in the page flow above the site's header.
const TABS_CSS = 'nav.rbtabs.rbtabs[hidden]{display:flex!important}' +
  'nav.rbtabs.rbtabs{position:relative!important;z-index:2147483000;display:flex;gap:0;margin:0!important;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:none;' +
  'background:#0a0908!important;border-bottom:1px solid rgba(212,175,55,.28);padding:0 6px!important;box-sizing:border-box;width:100%;max-width:100vw;min-width:0;align-self:stretch;grid-column:1/-1;-webkit-overflow-scrolling:touch}' +
  'nav.rbtabs.rbtabs::-webkit-scrollbar{display:none}' +
  'nav.rbtabs.rbtabs a{flex:0 0 auto!important;display:block!important;color:#cfc6b8!important;text-decoration:none!important;padding:11px 12px 10px!important;margin:0!important;' +
  'font:600 12.5px/1.1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif!important;letter-spacing:.02em!important;text-transform:none!important;border:0!important;border-bottom:2px solid transparent!important;background:none!important;white-space:nowrap!important;opacity:1!important}' +
  'nav.rbtabs.rbtabs a:hover,nav.rbtabs.rbtabs a:focus-visible{color:#f2d98a!important}' +
  'nav.rbtabs.rbtabs a[aria-current]{color:#f0c75a!important;border-bottom-color:#e2b649!important}\n';

// ---------------------------------------------------------------- RB luxe layer (motion and loading states, 28 Oct 2026)
// Every user site already loads this stylesheet, so this is where the shared motion lives: no script, no new request,
// nothing for a page's CSP to block. Colours are the --lux-* tokens from theme.css (rb-tools/luxe_tokens.js), with the
// locked Dark Luxury values as fallbacks, so a site with no theme chosen still gets the house gold.
//   .rb-skel     a refined gold skeleton for loading states (a slow sheen; still with reduced motion)
//   .rb-shimmer  a gold light sweep across a button on hover/focus
//   per site     scroll reveals (CSS scroll-driven animations, only where the browser has them) and the gold lift and
//                sweep on that site's primary buttons. Reveals use fill "backwards" only: once in view the element is
//                exactly as the site styles it, and a browser without scroll timelines simply shows everything.
// Everything that moves sits inside prefers-reduced-motion: no-preference. RB Radio and its hub get only the shared
// classes (never touched while a show may be live), tools get no scroll reveals (a control panel shouldn't fade in).
const LUX = (name, fallback) => `var(--lux-${name},${fallback})`;
const GOLD = LUX("gold", "#D4AF37"), HI = LUX("gold-highlight", "#F5E6C8");
const LUXE_CSS = "/* RB luxe layer */\n" +
  `.rb-skel{display:block;min-height:.9em;border-radius:8px;border:1px solid ${LUX("line", "#2A261C")};background-color:${LUX("bg-elevated", "#0C0A10")};` +
  `background-image:linear-gradient(100deg,transparent 0 35%,color-mix(in srgb,${GOLD} 14%,transparent) 46%,color-mix(in srgb,${HI} 20%,transparent) 50%,color-mix(in srgb,${GOLD} 14%,transparent) 54%,transparent 65% 100%);` +
  "background-size:260% 100%;background-repeat:no-repeat;background-position:110% 0;color:transparent!important;user-select:none}\n" +
  ".rb-skel+.rb-skel{margin-top:.55em}.rb-skel.w60{width:60%}.rb-skel.w40{width:40%}.rb-skel.tall{min-height:2.6em}.rb-skel.round{border-radius:999px}\n" +
  // words kept for screen readers next to a skeleton (and shown as before if this sheet can't load)
  ".rb-sr{position:absolute!important;width:1px!important;height:1px!important;overflow:hidden!important;clip-path:inset(50%)!important;white-space:nowrap!important;margin:-1px!important;padding:0!important;border:0!important}\n" +
  ".shop-empty[aria-busy=true]{width:100%;max-width:560px;margin-inline:auto}.shop-empty[aria-busy=true]>.rb-skel{margin-inline:auto}.rbs-empty[aria-busy=true]>.rb-skel.tall{min-height:2.4em}\n" +
  ".rb-shimmer{position:relative;overflow:hidden;isolation:isolate}\n" +
  ".rb-shimmer::after{content:\"\";position:absolute;inset:-1px;pointer-events:none;border-radius:inherit;" +
  `background-image:linear-gradient(105deg,transparent 30%,color-mix(in srgb,${HI} 55%,transparent) 48%,color-mix(in srgb,#FFFFFF 35%,transparent) 50%,transparent 70%);translate:-130% 0;opacity:0}\n` +
  "@keyframes rb-skel{from{background-position:110% 0}to{background-position:-10% 0}}\n" +
  "@keyframes rb-rise{from{opacity:0;translate:0 22px}}\n" +
  "@keyframes rb-sweep{from{translate:-130% 0;opacity:1}to{translate:130% 0;opacity:1}}\n" +
  "@media (prefers-reduced-motion:no-preference){" +
  ".rb-skel{animation:rb-skel 1.8s cubic-bezier(.45,0,.25,1) infinite}" +
  ".rb-shimmer:hover::after,.rb-shimmer:focus-visible::after{animation:rb-sweep .85s cubic-bezier(.2,.7,.2,1)}" +
  "}\n";

/** Per site: what rises in on scroll, the primary buttons that get the gold lift and sweep, and cards that lift on hover. */
const LUXE_SITES = {
  home: { reveal: ".rb-home .rb-sec,.rb-home .rb-stats", cta: ".rb-home .rb-btn" },
  tv: { reveal: "main .shelf", cta: ".btn.gold" },
  // /events already fades its sections in (.fade-in, its own script), so it gets the card lift instead of reveals
  events: { reveal: "", cta: ".btn-gold", lift: ".venue-card" },
  memberships: { reveal: ".cards>.card,.set-head,.cmp-wrap", cta: ".btn:not(.ghost)" },
  mastering: { reveal: "", cta: "button.go" },
  studio: { reveal: "", cta: "header.top .btn.gold" },
};
export const LUXE_SITE_IDS = Object.keys(LUXE_SITES);

/** The luxe layer for one site id ("" for the sites that only get the shared classes). */
export function luxeCss(site) {
  const s = Object.hasOwn(LUXE_SITES, site) ? LUXE_SITES[site] : null;
  let css = LUXE_CSS;
  if (!s) return css;
  if (s.cta) {
    const c = s.cta.split(",").map((x) => x.trim());
    const all = (suffix) => c.map((x) => x + suffix).join(",");
    css += `${all("")}{position:relative;overflow:hidden;isolation:isolate}` +
      `${all("::after")}{content:"";position:absolute;inset:-1px;pointer-events:none;border-radius:inherit;` +
      `background-image:linear-gradient(105deg,transparent 30%,color-mix(in srgb,${HI} 55%,transparent) 48%,color-mix(in srgb,#FFFFFF 35%,transparent) 50%,transparent 70%);translate:-130% 0;opacity:0}\n` +
      "@media (prefers-reduced-motion:no-preference){" +
      `${all("")}{transition:translate .28s cubic-bezier(.2,.7,.2,1),transform .28s,filter .28s ease,background-color .2s,color .2s,border-color .2s,box-shadow .2s,opacity .2s}` +
      `${all(":focus-visible::after")}{animation:rb-sweep .85s cubic-bezier(.2,.7,.2,1)}` +
      // hover only where there is a real pointer, so a tapped button on a phone doesn't stay lifted
      "@media (hover:hover){" +
      `${all(":hover:not(:disabled)")}{translate:0 -1px;filter:brightness(1.06) drop-shadow(0 8px 18px color-mix(in srgb,${GOLD} 32%,transparent))}` +
      `${all(":active:not(:disabled)")}{translate:0 0}` +
      `${all(":hover:not(:disabled)::after")}{animation:rb-sweep .85s cubic-bezier(.2,.7,.2,1)}` +
      "}}\n";
  }
  if (s.lift) {
    css += "@media (prefers-reduced-motion:no-preference){" +
      `${s.lift}{transition:translate .35s cubic-bezier(.2,.7,.2,1),transform .3s,filter .35s ease,border-color .3s,box-shadow .25s,opacity .25s}` +
      `@media (hover:hover){${s.lift.split(",").map((x) => x.trim() + ":hover").join(",")}{translate:0 -3px;filter:drop-shadow(0 14px 26px color-mix(in srgb,${GOLD} 18%,transparent))}}` +
      "}\n";
  }
  if (s.reveal) {
    css += "@supports (animation-timeline:view()){@media (prefers-reduced-motion:no-preference){" +
      `${s.reveal}{animation:rb-rise linear backwards;animation-duration:auto;animation-timeline:view();animation-range:entry 0% entry 70%}` +
      "}}\n";
  }
  return css;
}

export async function siteImagesCss(request, env, ctx, url) {
  const site = String(url.searchParams.get("site") || "");
  const headers = { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff", "Access-Control-Allow-Origin": "*" };
  const def = IMAGE_SITES.find((s) => s.id === site);
  if (!def) return new Response("/* unknown site */\n", { status: 400, headers });
  const st = env.DB ? await state(env, ctx, url.origin) : { setting: parseImages(null), assets: {} };
  const u = (slot, a) => `${SITE}/api/content/site-image?site=${site}&slot=${slot}&v=${a.id}`;
  let css = `/* RB site images: ${site} */\n` + TABS_CSS + luxeCss(site);
  const bg = chosen(st, "background", site);
  if (bg) css += `html body{background:linear-gradient(rgba(8,6,10,.74),rgba(8,6,10,.86)),url("${u("background", bg)}") center/cover no-repeat fixed!important;background-color:#0b0a09!important}\n`;
  const logo = chosen(st, "logo", site);
  if (logo && def.logo) css += `${def.logo}{background:url("${u("logo", logo)}") left center/contain no-repeat!important;color:transparent!important;text-shadow:none!important}${def.logo} *{opacity:0!important}\n`;
  return new Response(css, { headers });
}
