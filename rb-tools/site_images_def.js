/**
 * Site images: which picture each RB site uses for its tab icon, its share preview, its background and its header logo.
 * Shared by RB Command (the Site images screen, which saves the choice) and rb-public-content (which serves it).
 * Copied into both by rb-tools/patch_site_images.py; edit it here.
 *
 * Stored in waitlist-db site_settings as site_images: { icon: { all, sites: { home: id, ... } }, share: {...},
 * background: {...}, logo: {...} }, each value an id from site_assets. "all" applies to every site that has no choice of
 * its own; a site set to "none" keeps its own picture even when "all" is set. Nothing set: every site looks as it does now.
 */
export const SLOTS = [
  { id: "icon", label: "Tab icon", help: "The icon in the browser tab and on phone home screens. Square, made 512 × 512.", w: 512, h: 512, fit: "cover", type: "image/png" },
  { id: "share", label: "Share preview", help: "The picture shown when a link is posted on Instagram, iMessage, Facebook or X. Made 1200 × 630.", w: 1200, h: 630, fit: "cover", type: "image/jpeg" },
  { id: "background", label: "Background", help: "A full-page picture behind the site, darkened so text stays readable. Up to 2400 px wide.", w: 2400, h: 2400, fit: "inside", type: "image/jpeg" },
  { id: "logo", label: "Header logo", help: "Replaces the logo in the site's top bar, same size and place. A wide PNG with a transparent background works best.", w: 900, h: 300, fit: "inside", type: "image/png" },
];
export const SLOT_IDS = SLOTS.map((s) => s.id);

// logo: the header element whose look is replaced (it keeps its size and link). background: false keeps the site's own.
export const IMAGE_SITES = [
  { id: "home", label: "Homepage, store, pages and the game", url: "https://relentlessbillionaire.com/", logo: "a#rb-nav-mark", background: true },
  { id: "beats", label: "Beat store", url: "https://beatstore.relentlessbillionaire.com/", logo: "nav.nav > a.logo", background: true },
  { id: "tv", label: "RB TV (icon and logo: its layout stays, and each video shares its own picture)", url: "https://relentlessbillionaire.com/tv", logo: "#side > a.brand", background: false, share: false },
  { id: "studio", label: "RB Studio (record)", url: "https://studio.relentlessbillionaire.com/", logo: "header.top > a.brand", background: true },
  { id: "mastering", label: "Mastering (/studio)", url: "https://relentlessbillionaire.com/studio/", logo: "header > span.brand", background: true },
  { id: "fund", label: "/fund", url: "https://relentlessbillionaire.com/fund", logo: "a#rb-nav-mark", background: true },
  { id: "memberships", label: "/memberships", url: "https://relentlessbillionaire.com/memberships", logo: "header.top > a.brand", background: true },
  { id: "events", label: "/events", url: "https://relentlessbillionaire.com/events", logo: "nav > a.nav-logo", background: true },
  { id: "radio", label: "RB Radio", url: "https://relentlessbillionaire.com/radio", logo: "header.top > a.brand", background: true },
  { id: "release", label: "/release", url: "https://relentlessbillionaire.com/release", logo: "header.bar a.logo", background: true },
  { id: "jobs", label: "RB Jobs", url: "https://relentlessbillionaire.com/jobs", logo: "header.top > a.brand", background: true },
  { id: "partners", label: "RB Partners", url: "https://partners.relentlessbillionaire.com/", logo: "div.wrap.topin > a.mark", background: true },
];
export const IMAGE_SITE_IDS = IMAGE_SITES.map((s) => s.id);
const ID = /^[a-z0-9]{8,40}$/;

/** The stored JSON, read leniently: unknown slots, sites and ids are dropped. */
export function parseImages(text) {
  let raw = {};
  try { raw = JSON.parse(text || "{}") || {}; } catch {}
  const out = {};
  for (const slot of SLOT_IDS) {
    const r = raw[slot] && typeof raw[slot] === "object" ? raw[slot] : {};
    const sites = {};
    for (const [k, v] of Object.entries(r.sites && typeof r.sites === "object" ? r.sites : {})) if (IMAGE_SITE_IDS.includes(k) && (v === "none" || ID.test(String(v)))) sites[k] = String(v);
    out[slot] = { all: ID.test(String(r.all || "")) ? String(r.all) : null, sites };
  }
  return out;
}

/** The asset id a site uses for a slot, or null to keep its own. */
export function pick(setting, slot, site) {
  const s = setting && setting[slot];
  const def = IMAGE_SITES.find((x) => x.id === site);
  if (!s || !def) return null;
  if ((slot === "background" && !def.background) || (slot === "logo" && !def.logo) || (slot === "share" && def.share === false)) return null;
  const own = s.sites && s.sites[site];
  if (own === "none") return null;
  return own || s.all || null;
}
