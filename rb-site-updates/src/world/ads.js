// RB World's billboards and street posters show real sponsors' ads from RB Command (Money > Ads: live ads set to
// "Everywhere ads show" or "RB World only", with an image or a video, inside their dates). They take turns with RB's
// own on the 11 screens round RB Plaza and on the posters along the main streets (city.js); with none live, RB's own
// show as before. Every sponsor ad carries a "Sponsored" label.
// - Video ads play muted on the big screens (not with reduced motion, data saver or Low graphics); posters show the
//   image, or the advertiser and headline.
// - Counting, kept apart from the website's numbers (/api/world/ad-event, table world_ad_stats): a view when the ad is
//   on screen within range, "viewable" once it has stayed on screen for 1 second (2 for video), at most once each per
//   ad every 30 minutes for a player.
// - Drive close to one and a "Sponsored · advertiser" link appears; it opens the advertiser's page through
//   /go/ad/<id>?s=world, which counts the click.
import * as THREE from "three";

const CALM = (matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) || (navigator.connection && navigator.connection.saveData);
const GAP = 30 * 60e3;
const esc = (s) => String(s == null ? "" : s);

function canvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
function tex(c) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
function cover(g, img, W, H) { const iw = img.videoWidth || img.naturalWidth || img.width, ih = img.videoHeight || img.naturalHeight || img.height; if (!iw || !ih) return; const k = Math.max(W / iw, H / ih), w = iw * k, h = ih * k; g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h); }
function label(g, W, H, ad) {
  const pad = Math.min(W, H) * 0.025, bh = Math.min(H * 0.085, W * 0.07), room = W - pad * 4;
  let t = "SPONSORED · " + esc(ad.advertiser).toUpperCase().slice(0, 40), size = Math.round(bh * 0.65);
  // a long name: smaller type first, then cut with an ellipsis, so the label always fits (the tall posters are narrow)
  g.font = "700 " + size + "px Inter, Arial, sans-serif";
  while (g.measureText(t).width > room && size > bh * 0.42) { size--; g.font = "700 " + size + "px Inter, Arial, sans-serif"; }
  while (g.measureText(t).width > room && t.length > 14) t = t.slice(0, -2) + "…";
  const tw = g.measureText(t).width;
  g.fillStyle = "rgba(0,0,0,.72)"; g.fillRect(W - tw - pad * 3, H - bh - pad, tw + pad * 2, bh);
  g.fillStyle = "#F5E6A3"; g.textAlign = "right"; g.textBaseline = "middle"; g.fillText(t, W - pad * 2, H - bh / 2 - pad);
}
function wrap(g, text, x, y, maxW, lh, max) { const words = esc(text).split(/\s+/); let line = "", n = 0; for (const w of words) { const t = line ? line + " " + w : w; if (g.measureText(t).width > maxW && line) { g.fillText(line, x, y + n * lh); line = w; if (++n >= max) return; } else line = t; } if (line) g.fillText(line, x, y + n * lh); }
function textArt(g, W, H, ad) {
  const grd = g.createLinearGradient(0, 0, W, H); grd.addColorStop(0, "#1b1608"); grd.addColorStop(1, "#000"); g.fillStyle = grd; g.fillRect(0, 0, W, H);
  g.strokeStyle = "#C9A84C"; g.lineWidth = Math.max(4, W * 0.008); g.strokeRect(W * 0.02, H * 0.03, W * 0.96, H * 0.94);
  g.fillStyle = "#F5E6A3"; g.textAlign = "center"; g.textBaseline = "alphabetic";
  const tall = H > W, big = Math.round((tall ? W * 0.12 : H * 0.17));
  g.font = "900 " + big + "px Inter, Arial, sans-serif"; wrap(g, ad.headline || ad.advertiser, W / 2, H * (tall ? 0.32 : 0.42), W * 0.88, big * 1.1, tall ? 4 : 2);
  g.fillStyle = "#fff"; g.font = "600 " + Math.round(big * 0.42) + "px Inter, Arial, sans-serif"; wrap(g, ad.body || "", W / 2, H * (tall ? 0.7 : 0.76), W * 0.86, big * 0.5, 2);
}
// one picture for the wide screens, one for the tall posters; video ads also get a live screen texture
function art(ad, img, W, H) { const c = canvas(W, H), g = c.getContext("2d"); if (img) { g.fillStyle = "#000"; g.fillRect(0, 0, W, H); cover(g, img, W, H); } else textArt(g, W, H, ad); label(g, W, H, ad); return { c, g }; }
function loadImg(url) { return new Promise((ok) => { if (!url) return ok(null); const i = new Image(); i.crossOrigin = "anonymous"; i.decoding = "async"; i.onload = () => ok(i); i.onerror = () => ok(null); i.src = url; }); }

export function initAds(E, ctx) {
  const world = E.world && E.world(), cam = E.camera;
  const out = { ads: [], near: null, counted: { imp: 0, view: 0 } };
  if (!world || !world.adPool || !world.adSpots) return out;
  const videos = [];
  const lowGfx = () => ctx.fx && ctx.fx.prefs && ctx.fx.prefs.graphics === "low";
  const cache = new Map(); // ad id -> its textures (and video), kept across reloads
  async function load() {
    let list = [];
    try { const r = await fetch("/api/world/billboards", { headers: { Accept: "application/json" } }); if (!r.ok) return; list = ((await r.json()).ads || []).slice(0, 8); } catch (e) { return; }
    const keep = new Set();
    for (const ad of list) {
      const key = ad.id + "|" + (ad.image_url || "") + "|" + (ad.video_url || "") + "|" + (ad.headline || "") + "|" + (ad.advertiser || "");
      keep.add(ad.id);
      const had = cache.get(ad.id);
      if (had && had.key === key) { had.entry.ad = had.poster.ad = ad; if (had.video) had.video.ad = ad; continue; }
      if (had) drop(had);
      const img = await loadImg(ad.image_url);
      const w = art(ad, img, 1024, 384), t = art(ad, img, 512, 768);
      const item = { key, entry: { tex: tex(w.c), ad }, poster: { tex: tex(t.c), ad }, video: null };
      if (ad.format === "video" && ad.video_url && !CALM && [...cache.values()].filter((x) => x.video).length < 2) {
        const v = document.createElement("video"); v.crossOrigin = "anonymous"; v.muted = true; v.loop = true; v.playsInline = true; v.preload = "auto"; v.src = ad.video_url;
        item.video = { v, g: w.g, c: w.c, t: item.entry.tex, ad, ok: false };
        v.addEventListener("loadeddata", () => { if (item.video) item.video.ok = true; }, { once: true });
      }
      cache.set(ad.id, item);
    }
    for (const [id, item] of cache) if (!keep.has(id)) { drop(item); cache.delete(id); }
    const items = list.map((a) => cache.get(a.id)).filter(Boolean);
    world.adPool.wide = items.map((x) => x.entry); world.adPool.tall = items.map((x) => x.poster); out.ads = list;
    videos.length = 0; for (const x of items) if (x.video) videos.push(x.video);
  }
  function drop(item) { item.entry.tex.dispose(); item.poster.tex.dispose(); if (item.video) { item.video.v.pause(); item.video.v.removeAttribute("src"); item.video.v.load(); item.video = null; } }
  // the screens showing a video ad play it (muted) while it's up; others stay paused
  let frameT = 0;
  function drawVideos(dt) {
    frameT += dt; if (frameT < 1 / 15) return; frameT = 0;
    const showing = new Set(world.adSpots.filter((s) => s.kind === "board" && s.ad).map((s) => s.ad.id));
    for (const x of videos) {
      const on = showing.has(x.ad.id) && !lowGfx() && !document.hidden;
      if (on && x.v.paused) x.v.play().catch(() => {}); else if (!on && !x.v.paused) x.v.pause();
      if (on && x.ok && x.v.readyState >= 2) { x.g.fillStyle = "#000"; x.g.fillRect(0, 0, x.c.width, x.c.height); cover(x.g, x.v, x.c.width, x.c.height); label(x.g, x.c.width, x.c.height, x.ad); x.t.needsUpdate = true; }
    }
  }
  // counting: what's actually on screen, from where the camera is
  const v3 = new THREE.Vector3(), fwd = new THREE.Vector3(), Q = [], last = {}, since = {};
  function seen(s) {
    const dx = cam.position.x - s.x, dz = cam.position.z - s.z, d = Math.hypot(dx, dz);
    if (d > s.range || d < 2) return false;
    const nx = Math.sin(s.ang), nz = Math.cos(s.ang), facing = (dx * nx + dz * nz) / d;
    if (!s.twoSided && facing < 0.15) return false;
    if (s.twoSided && Math.abs(facing) < 0.15) return false;
    v3.set(s.x, s.y, s.z).project(cam);
    return v3.z < 1 && Math.abs(v3.x) < 0.95 && Math.abs(v3.y) < 0.95;
  }
  function send(id, kind) { Q.push({ id, kind }); out.counted[kind]++; }
  function flush() {
    if (!Q.length) return;
    const body = JSON.stringify({ id: ctx.player && ctx.player.id, events: Q.splice(0, 24) });
    fetch("/api/world/ad-event", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  }
  let checkT = 0;
  function check(dt) {
    checkT += dt; if (checkT < 0.25) return; const step = checkT; checkT = 0;
    const now = Date.now(), vis = new Set();
    for (const s of world.adSpots) if (s.ad && seen(s)) vis.add(s.ad.id);
    for (const id of vis) {
      const ad = out.ads.find((a) => a.id === id); if (!ad) continue;
      const L = (last[id] ||= { imp: 0, view: 0 });
      if (now - L.imp > GAP) { L.imp = now; send(id, "imp"); }
      since[id] = (since[id] || 0) + step;
      if (since[id] >= (ad.format === "video" ? 2 : 1) && now - L.view > GAP) { L.view = now; send(id, "view"); }
    }
    for (const id of Object.keys(since)) if (!vis.has(Number(id))) since[id] = 0;
  }
  // close to a sponsor's screen or poster: a link to the advertiser
  const chip = document.createElement("a"); chip.id = "rb-adchip"; chip.target = "_blank"; chip.rel = "sponsored noopener";
  chip.style.cssText = "position:fixed;z-index:7100;left:50%;transform:translateX(-50%);bottom:calc(84px + env(safe-area-inset-bottom));display:none;max-width:min(86vw,420px);" +
    "padding:8px 14px;border-radius:999px;background:rgba(0,0,0,.82);border:1px solid rgba(201,168,76,.7);color:#F5E6A3;font:700 12px/1.25 Inter,system-ui,sans-serif;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
  document.body.appendChild(chip);
  let nearT = 0;
  function near(dt) {
    nearT += dt; if (nearT < 0.5) return; nearT = 0;
    const car = E.car; let best = null, bd = Infinity;
    for (const s of world.adSpots) { if (!s.ad || !s.ad.click) continue; const d = Math.hypot(car.x - s.x, car.z - s.z); if (d < (s.kind === "board" ? 45 : 18) && d < bd) { bd = d; best = s; } }
    const ad = best && best.ad; out.near = ad ? ad.id : null;
    if (!ad || document.body.classList.contains("rb-photo")) { chip.style.display = "none"; return; }
    chip.href = ad.click; chip.textContent = "Sponsored · " + esc(ad.advertiser) + (ad.cta ? " · " + esc(ad.cta) + " ↗" : " ↗"); chip.style.display = "block";
  }
  ctx.onFrame((dt) => { if (!out.ads.length) return; drawVideos(dt); check(dt); near(dt); });
  setInterval(flush, 5000);
  window.addEventListener("pagehide", flush);
  load(); setInterval(load, 5 * 60e3); // new or ended campaigns show within five minutes
  return out;
}
