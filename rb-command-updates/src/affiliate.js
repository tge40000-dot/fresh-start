/**
 * Affiliate ads: paste an affiliate link and get a ready ad. RB Command reads the product page (title, description,
 * picture); the operator keeps or edits the words and picks the picture: their own upload, the page's picture (copied
 * into RB media so the ad doesn't depend on the merchant's server), or a card drawn from the words in the site colours.
 * Publishing adds a live row to the ads table, so the ad shows wherever RB shows ads (the discovery rails, and if chosen
 * the homepage spotlight or the live ticker), with views and clicks counted like any other ad. The click goes to the
 * affiliate link exactly as pasted, so the network's tracking is kept.
 */
import { HttpError } from "./tables.js";
import { PALETTES, parseSetting, themeFor, tones } from "./theme.js";

const PAGE_BYTES = 768 * 1024;
const IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };
const PLACEMENTS = ["sidebar", "spotlight", "both"];
const SURFACES = ["all", "home", "radio", "tv"];
const UA = "Mozilla/5.0 (compatible; RBCommand/1.0; +https://relentlessbillionaire.com)";

const mediaBase = (env) => (env.MEDIA_PUBLIC_URL || "https://media.relentlessbillionaire.com").replace(/\/$/, "");
const clip = (s, n) => { const t = String(s == null ? "" : s).replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t; };

/** An http(s) link to a public host, or an HttpError. */
export function cleanLink(value) {
  let u;
  try { u = new URL(String(value || "").trim()); } catch { throw new HttpError(400, "Paste the full link, starting with https://"); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new HttpError(400, "The link must start with https:// or http://");
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || host === "localhost" || /^[\d.]+$/.test(host) || host.includes(":") || /\.(local|internal|lan)$/.test(host)) {
    throw new HttpError(400, "That link doesn't point to a public website.");
  }
  if (u.username || u.password) throw new HttpError(400, "Links with a username or password can't be used.");
  return u;
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decode(s) {
  return String(s || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
    return Object.hasOwn(ENTITIES, e.toLowerCase()) ? ENTITIES[e.toLowerCase()] : m;
  });
}

/** The attributes of each <meta> and <link> tag, plus the <title>. */
export function readMeta(html) {
  const meta = {}, attrs = (tag) => {
    const out = {};
    for (const m of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) out[m[1].toLowerCase()] = decode(m[3] ?? m[4] ?? m[5] ?? "");
    return out;
  };
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0]), key = (a.property || a.name || a.itemprop || "").toLowerCase();
    if (key && a.content && !(key in meta)) meta[key] = a.content.trim();
  }
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    if ((a.rel || "").toLowerCase() === "image_src" && a.href && !("image_src" in meta)) meta.image_src = a.href;
  }
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (t) meta["<title>"] = decode(t[1]).trim();
  return meta;
}

async function readText(res, max) {
  const reader = res.body.getReader(), parts = [];
  let size = 0;
  while (size < max) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value); size += value.byteLength;
  }
  reader.cancel().catch(() => {});
  const all = new Uint8Array(Math.min(size, max)); let at = 0;
  for (const p of parts) { const take = Math.min(p.byteLength, all.length - at); all.set(p.subarray(0, take), at); at += take; if (at >= all.length) break; }
  return new TextDecoder().decode(all);
}

const brand = (host) => { const h = host.replace(/^www\./, ""), base = h.split(".").slice(-2, -1)[0] || h; return base.charAt(0).toUpperCase() + base.slice(1); };

/** What the ad can say, read from the page the link opens. Never fails on a page it can't read: the fields come back empty. */
export async function preview(env, body, fetcher = fetch) {
  const link = cleanLink(body && body.url);
  const out = { ok: true, url: link.toString(), final_url: link.toString(), domain: link.hostname.replace(/^www\./, ""), advertiser: brand(link.hostname), headline: "", body: "", image: "", cta: "Shop now", note: "" };
  let res;
  try {
    res = await fetcher(link.toString(), { redirect: "follow", headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5" }, signal: AbortSignal.timeout(8000) });
  } catch {
    out.note = "Couldn't open the link to read it. Fill in the words yourself and upload a picture or make a card.";
    return out;
  }
  try {
    const final = cleanLink(res.url || link.toString());
    out.final_url = final.toString(); out.domain = final.hostname.replace(/^www\./, ""); out.advertiser = brand(final.hostname);
  } catch { /* keep the pasted link's host */ }
  const type = String(res.headers.get("Content-Type") || "").toLowerCase();
  if (!res.ok || !/html|xml/.test(type)) {
    res.body?.cancel().catch(() => {});
    out.note = res.ok ? "The link doesn't open a web page, so there was nothing to read." : `The page answered with an error (${res.status}). Fill in the words yourself.`;
    return out;
  }
  const meta = readMeta(await readText(res, PAGE_BYTES));
  const first = (...keys) => keys.map((k) => meta[k]).find((v) => v && v.trim()) || "";
  const site = first("og:site_name", "application-name", "twitter:site").replace(/^@/, "");
  if (site) out.advertiser = clip(site, 120);
  out.headline = clip(first("og:title", "twitter:title", "<title>"), 140);
  out.body = clip(first("og:description", "twitter:description", "description"), 200);
  const img = first("og:image:secure_url", "og:image", "og:image:url", "twitter:image", "twitter:image:src", "image_src");
  if (img) { try { const u = new URL(img, out.final_url); if (u.protocol === "https:" || u.protocol === "http:") out.image = u.toString(); } catch { /* no usable picture */ } }
  if (!out.headline) out.note = "The page didn't say what it is. Write a headline yourself.";
  return out;
}

// ---------------------------------------------------------------- the card
const xml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Break text into at most `max` lines of about `width` characters; the last line ends in … when text is left over. */
export function wrap(text, width, max) {
  const words = String(text).replace(/\s+/g, " ").trim().split(" ").filter(Boolean), lines = [];
  let line = "";
  for (let i = 0; i < words.length; i++) {
    let w = words[i];
    while (w.length > width) { if (line) { lines.push(line); line = ""; } lines.push(w.slice(0, width - 1) + "-"); w = w.slice(width - 1); }
    const next = line ? line + " " + w : w;
    if (next.length <= width) { line = next; continue; }
    lines.push(line); line = w;
  }
  if (line) lines.push(line);
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  const last = kept[max - 1];
  kept[max - 1] = (last.length < width ? last : last.slice(0, width - 1).trimEnd()) + "…";
  return kept;
}

/** A square ad card (1080×1080 SVG) in the given palette: brand, headline, line of text, button, domain. */
export function cardSvg({ advertiser, headline, body, cta, domain }, paletteKey = "blackgold") {
  const p = PALETTES[paletteKey] || PALETTES.blackgold, t = tones(p);
  const head = String(headline || advertiser || "").trim();
  const [size, width] = head.length <= 28 ? [104, 15] : head.length <= 56 ? [88, 18] : [72, 23];
  const lines = wrap(head, width, 5), lh = Math.round(size * 1.12);
  const top = 300 + Math.max(0, (5 - lines.length) * lh * 0.35);
  const sub = body ? wrap(body, 44, 2) : [];
  const subTop = top + lines.length * lh + 30;
  const button = clip(cta || "Shop now", 24), bw = Math.max(260, button.length * 26 + 110);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.bg}"/><stop offset="1" stop-color="${p.mid}"/></linearGradient>`
    + `<radialGradient id="r" cx="0.85" cy="0.1" r="0.7"><stop offset="0" stop-color="${t.hot}" stop-opacity="0.28"/><stop offset="1" stop-color="${t.hot}" stop-opacity="0"/></radialGradient></defs>`
    + `<rect width="1080" height="1080" fill="url(#g)"/><rect width="1080" height="1080" fill="url(#r)"/>`
    + `<rect x="40" y="40" width="1000" height="1000" rx="36" fill="none" stroke="${t.accent}" stroke-opacity="0.35" stroke-width="3"/>`
    + `<text x="96" y="190" fill="${t.accent}" font-family="Helvetica, Arial, sans-serif" font-size="40" font-weight="700" letter-spacing="8">${xml(clip(advertiser, 28).toUpperCase())}</text>`
    + lines.map((l, i) => `<text x="96" y="${Math.round(top + i * lh)}" fill="${t.text}" font-family="Georgia, 'Times New Roman', serif" font-size="${size}" font-style="italic" font-weight="600">${xml(l)}</text>`).join("")
    + sub.map((l, i) => `<text x="96" y="${Math.round(subTop + i * 50)}" fill="${t.muted}" font-family="Helvetica, Arial, sans-serif" font-size="38">${xml(l)}</text>`).join("")
    + `<rect x="96" y="864" width="${bw}" height="104" rx="52" fill="${t.accent}"/>`
    + `<text x="${96 + bw / 2}" y="930" text-anchor="middle" fill="${p.void}" font-family="Helvetica, Arial, sans-serif" font-size="42" font-weight="700">${xml(button)} →</text>`
    + `<text x="984" y="930" text-anchor="end" fill="${t.dim}" font-family="Helvetica, Arial, sans-serif" font-size="32">${xml(clip(domain, 30))}</text>`
    + `</svg>`;
}

/** The palette the homepage uses now, for the card. */
async function homePalette(env) {
  try {
    const row = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'site_theme'").first();
    return themeFor(parseSetting(row && row.value), "home") || "blackgold";
  } catch { return "blackgold"; }
}

export async function card(env, body) {
  const d = words(body, false);
  return { ok: true, svg: cardSvg(d, await homePalette(env)) };
}

// ---------------------------------------------------------------- publishing
function words(body, strict) {
  const b = body || {}, link = strict ? cleanLink(b.url) : null;
  const domain = link ? link.hostname.replace(/^www\./, "") : clip(b.domain, 60);
  const advertiser = clip(b.advertiser, 120) || (link ? brand(link.hostname) : "");
  const headline = clip(b.headline, 140);
  if (strict && !advertiser) throw new HttpError(400, "Add the advertiser's name.");
  if (strict && !headline) throw new HttpError(400, "Add a headline.");
  return { url: link ? link.toString() : "", domain, advertiser, headline, body: clip(b.body, 600), cta: clip(b.cta, 24) || "Shop now" };
}

const month = () => new Date().toISOString().slice(0, 7);

async function store(env, bytes, type, ext, who, name) {
  if (!env.MEDIA) throw new HttpError(503, "Media storage is not connected to RB Command.");
  const key = `admin/ads/${month()}/${crypto.randomUUID()}.${ext}`;
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" }, customMetadata: { uploadedBy: who.email, originalName: name } });
  return `${mediaBase(env)}/${key}`;
}

/** Copy the page's picture into RB media. */
async function copyImage(env, who, src, fetcher) {
  let u;
  try { u = cleanLink(src); } catch { throw new HttpError(400, "The page's picture link isn't usable. Upload a picture or make a card."); }
  let res;
  try { res = await fetcher(u.toString(), { redirect: "follow", headers: { "User-Agent": UA, Accept: "image/avif,image/webp,image/*;q=0.8" }, signal: AbortSignal.timeout(10000) }); }
  catch { throw new HttpError(422, "Couldn't download the page's picture. Upload one or make a card."); }
  const type = String(res.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (!res.ok || !IMAGE_TYPES[type]) { res.body?.cancel().catch(() => {}); throw new HttpError(422, "The page's picture isn't a JPG, PNG, WebP, GIF or AVIF image. Upload one or make a card."); }
  const len = Number(res.headers.get("Content-Length") || 0);
  if (len > IMAGE_BYTES) { res.body?.cancel().catch(() => {}); throw new HttpError(422, "The page's picture is larger than 8 MB. Upload a smaller one."); }
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > IMAGE_BYTES) throw new HttpError(422, "The page's picture couldn't be used. Upload one or make a card.");
  return store(env, bytes, type, IMAGE_TYPES[type], who, u.pathname.split("/").pop() || "page picture");
}

/** Publish an affiliate ad. Returns {ok, id, ad, log_id}. */
export async function create(env, who, body, fetcher = fetch) {
  const b = body || {}, d = words(b, true);
  const placement = PLACEMENTS.includes(b.placement) ? b.placement : "sidebar";
  const surface = SURFACES.includes(b.surface) ? b.surface : "all";
  const status = b.status === "paused" ? "paused" : "live";
  let image;
  if (b.creative === "upload") {
    const base = mediaBase(env) + "/admin/ads/";
    if (typeof b.image_url !== "string" || !b.image_url.startsWith(base) || /[\s"'<>]/.test(b.image_url)) throw new HttpError(400, "Upload the picture first.");
    image = b.image_url;
  } else if (b.creative === "page") {
    image = await copyImage(env, who, b.page_image, fetcher);
  } else if (b.creative === "card") {
    image = await store(env, new TextEncoder().encode(cardSvg(d, await homePalette(env))), "image/svg+xml", "svg", who, "card.svg");
  } else {
    throw new HttpError(400, "Choose a picture: upload one, use the page's picture, or make a card.");
  }
  const res = await env.DB.prepare(
    "INSERT INTO ads (advertiser, headline, body, image_url, poster_url, click_url, placement, weight, status, format, cta, freq_cap, surface) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 'image', ?, 3, ?)",
  ).bind(d.advertiser, d.headline, d.body || null, image, image, d.url, placement, status, d.cta, surface).run();
  const id = res.meta && res.meta.last_row_id;
  const ad = await env.DB.prepare("SELECT * FROM ads WHERE id = ?").bind(id).first();
  const detail = JSON.stringify({ summary: `Ads: added ${d.advertiser} (affiliate link)`, table: "ads", id, after: ad });
  const log = await env.DB.prepare("INSERT INTO command_log (actor, action, target, detail) VALUES (?, 'row.create', ?, ?) RETURNING id").bind(who.email, `ads:${id}`, detail).first();
  return { ok: true, id, ad, log_id: log ? log.id : null };
}
