// RB World's billboards and street posters show real sponsors' ads from RB Command (Money > Ads: live ads set to
// "Everywhere ads show" or "RB World only", with an image or a video, inside their dates). They take turns with RB's
// own on the 11 screens round RB Plaza and on the posters along the main streets (city.js); with none live, RB's own
// show as before. Every sponsor ad carries a "Sponsored" label.
// - Video ads play muted on the big screens (not with reduced motion, data saver or Low graphics); posters show the
//   image, or the advertiser and headline.
// - Counting, kept apart from the website's numbers (/api/world/ad-event, table world_ad_stats): a view when the ad is
//   on screen within range, "viewable" once it has stayed on screen for 1 second (2 for video), at most once each per
//   ad every 30 minutes for a player.
// - Every sponsor ad shows whole (never cropped or stretched) over a blurred copy of itself, with a bar along the
//   bottom: "SPONSORED · ADVERTISER" and its call to action. Screens keep the same brightness by day and night.
// - Drive or walk close to one and a card appears with the ad, the advertiser and a button (or O) that opens their
//   page through /go/ad/<id>?s=world, which counts the click.
import * as THREE from "three";

const CALM = (matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) || (navigator.connection && navigator.connection.saveData);
const GAP = 30 * 60e3;
const esc = (s) => String(s == null ? "" : s);

function canvas(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
function tex(c) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t; }
const FILTERS = typeof CanvasRenderingContext2D !== "undefined" && "filter" in CanvasRenderingContext2D.prototype;
function dims(img) { return [img.videoWidth || img.naturalWidth || img.width, img.videoHeight || img.naturalHeight || img.height]; }
function cover(g, img, W, H) { const [iw, ih] = dims(img); if (!iw || !ih) return; const k = Math.max(W / iw, H / ih), w = iw * k, h = ih * k; g.drawImage(img, (W - w) / 2, (H - h) / 2, w, h); }
function contain(g, img, x, y, W, H) { const [iw, ih] = dims(img); if (!iw || !ih) return; const k = Math.min(W / iw, H / ih), w = iw * k, h = ih * k; g.drawImage(img, x + (W - w) / 2, y + (H - h) / 2, w, h); }
// Where the ad itself goes. Wide art is drawn at 8:3, but the screens round RB Plaza run from 2:1 to 3:1 (city.js
// crops each screen's view of it to fit, without stretching), so everything that matters stays inside a 2:1 safe
// area in the middle; the posters match their art exactly.
function safe(W, H) { if (W > H) { const h = H * 0.9, w = Math.min(W, h * 2); return { x: (W - w) / 2, y: (H - h) / 2, w, h }; } const m = W * 0.04; return { x: m, y: m, w: W - 2 * m, h: H - 2 * m }; }
function fit(g, text, maxW, size, weight) { let t = String(text || ""), s = size; g.font = `${weight} ${s}px Inter, Arial, sans-serif`; while (g.measureText(t).width > maxW && s > size * 0.55) { s--; g.font = `${weight} ${s}px Inter, Arial, sans-serif`; } while (g.measureText(t).width > maxW && t.length > 4) t = t.slice(0, -2) + "…"; return t; }
function wrap(g, text, x, y, maxW, lh, max) { const words = esc(text).split(/\s+/); let line = "", n = 0; for (const w of words) { const t = line ? line + " " + w : w; if (g.measureText(t).width > maxW && line) { g.fillText(line, x, y + n * lh); line = w; if (++n >= max) return; } else line = t; } if (line) g.fillText(line, x, y + n * lh); }
// The bar along the bottom of every sponsor ad: who it's from, and what tapping its link does.
function bar(g, S, ad) {
  if (S.h > S.w) return barTall(g, S, ad);
  const bh = S.h * 0.15, y = S.y + S.h - bh, pad = bh * 0.28;
  g.fillStyle = "rgba(0,0,0,.86)"; g.fillRect(S.x, y, S.w, bh);
  g.fillStyle = "#C9A84C"; g.fillRect(S.x, y, S.w, Math.max(2, bh * 0.05));
  const cta = (esc(ad.cta) || "Learn more").toUpperCase() + " ↗";
  g.font = `900 ${Math.round(bh * 0.38)}px Inter, Arial, sans-serif`; const cw = Math.min(S.w * 0.42, g.measureText(cta).width + pad * 2);
  g.fillStyle = "#C9A84C"; const ch = bh * 0.62, cy = y + (bh - ch) / 2; g.beginPath(); g.roundRect ? g.roundRect(S.x + S.w - cw - pad, cy, cw, ch, ch / 2) : g.rect(S.x + S.w - cw - pad, cy, cw, ch); g.fill();
  g.fillStyle = "#000"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(fit(g, cta, cw - pad, Math.round(bh * 0.38), 900), S.x + S.w - pad - cw / 2, y + bh / 2 + 1);
  g.textAlign = "left"; g.fillStyle = "#F5E6A3";
  g.fillText(fit(g, "SPONSORED · " + esc(ad.advertiser).toUpperCase().slice(0, 40), S.w - cw - pad * 3, Math.round(bh * 0.36), 800), S.x + pad, y + bh / 2 + 1);
  return bh;
}
// On a poster (narrow) the bar takes two lines: who it's from, then the call to action across the width.
function barTall(g, S, ad) {
  const bh = S.h * 0.17, y = S.y + S.h - bh, pad = S.w * 0.05;
  g.fillStyle = "rgba(0,0,0,.86)"; g.fillRect(S.x, y, S.w, bh);
  g.fillStyle = "#C9A84C"; g.fillRect(S.x, y, S.w, Math.max(2, bh * 0.035));
  g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = "#F5E6A3";
  g.fillText(fit(g, "SPONSORED · " + esc(ad.advertiser).toUpperCase().slice(0, 40), S.w - pad * 2, Math.round(bh * 0.2), 800), S.x + S.w / 2, y + bh * 0.3);
  const cta = (esc(ad.cta) || "Learn more").toUpperCase() + " ↗", ch = bh * 0.38, cw = S.w - pad * 2;
  g.fillStyle = "#C9A84C"; g.beginPath(); g.roundRect ? g.roundRect(S.x + pad, y + bh * 0.5, cw, ch, ch / 2) : g.rect(S.x + pad, y + bh * 0.5, cw, ch); g.fill();
  g.fillStyle = "#000"; g.fillText(fit(g, cta, cw - pad, Math.round(ch * 0.55), 900), S.x + S.w / 2, y + bh * 0.5 + ch / 2 + 1);
  return bh;
}
// One sponsor ad on one canvas: the whole picture (never cropped) over a blurred, darker copy of itself, colours
// lifted a little so the screens' tone mapping doesn't wash them out, and the bar. With no picture: the headline.
function paint(g, W, H, ad, img, blurBg = true) {
  const S = safe(W, H);
  g.save();
  if (img) {
    if (blurBg && FILTERS) { g.filter = "blur(" + Math.round(W / 60) + "px) brightness(0.42) saturate(1.2)"; cover(g, img, W, H); g.filter = "none"; }
    else { g.fillStyle = "#000"; g.fillRect(0, 0, W, H); if (blurBg) { cover(g, img, W, H); g.fillStyle = "rgba(0,0,0,.64)"; g.fillRect(0, 0, W, H); } }
  } else { const grd = g.createLinearGradient(0, 0, W, H); grd.addColorStop(0, "#1b1608"); grd.addColorStop(1, "#000"); g.fillStyle = grd; g.fillRect(0, 0, W, H); }
  g.restore();
  const bh = S.h * (S.w > S.h ? 0.15 : 0.17), I = { x: S.x, y: S.y, w: S.w, h: S.h - bh };
  if (img) { g.save(); if (FILTERS) g.filter = "saturate(1.3) contrast(1.06)"; contain(g, img, I.x, I.y, I.w, I.h); g.restore(); }
  else {
    g.strokeStyle = "#C9A84C"; g.lineWidth = Math.max(4, W * 0.006); g.strokeRect(I.x + 6, I.y + 6, I.w - 12, I.h - 12);
    const tall = H > W, big = Math.round(tall ? I.w * 0.13 : I.h * 0.24);
    g.fillStyle = "#F5E6A3"; g.textAlign = "center"; g.textBaseline = "alphabetic"; g.font = `900 ${big}px Inter, Arial, sans-serif`;
    wrap(g, ad.headline || ad.advertiser, I.x + I.w / 2, I.y + I.h * (tall ? 0.3 : 0.42), I.w * 0.88, big * 1.08, tall ? 4 : 2);
    g.fillStyle = "#fff"; g.font = `600 ${Math.round(big * 0.42)}px Inter, Arial, sans-serif`; wrap(g, ad.body || "", I.x + I.w / 2, I.y + I.h * (tall ? 0.74 : 0.8), I.w * 0.86, big * 0.52, 2);
  }
  bar(g, S, ad);
}
// one picture for the wide screens, one for the tall posters; video ads also get a live screen texture
function art(ad, img, W, H) { const c = canvas(W, H), g = c.getContext("2d"); paint(g, W, H, ad, img); return { c, g, avg: average(c) }; }
// the art's average colour: the light a screen throws on the street at night
function average(c) { try { const s = canvas(8, 8), g = s.getContext("2d"); g.drawImage(c, 0, 0, 8, 8); const d = g.getImageData(0, 0, 8, 8).data; let r = 0, gg = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; } const n = d.length / 4; return new THREE.Color(r / n / 255, gg / n / 255, b / n / 255); } catch (e) { return new THREE.Color(0.8, 0.7, 0.5); } }
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
      const hi = !lowGfx() && !(ctx.fx && ctx.fx.tier && ctx.fx.tier() === "medium"), [WW, WH, TW, TH] = hi ? [1536, 576, 768, 1152] : [1024, 384, 512, 768];
      const w = art(ad, img, WW, WH), t = art(ad, img, TW, TH);
      const item = { key, entry: { tex: tex(w.c), ad }, poster: { tex: tex(t.c), ad }, video: null };
      item.entry.tex.userData.avg = w.avg; item.poster.tex.userData.avg = t.avg;
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
    const close = world.adSpots.some((s) => s.kind === "board" && s.ad && s.ad.format === "video" && Math.hypot(E.car.x - s.x, E.car.z - s.z) < 70);
    frameT += dt; if (frameT < 1 / (close ? 24 : 12)) return; frameT = 0;
    const showing = new Set(world.adSpots.filter((s) => s.kind === "board" && s.ad).map((s) => s.ad.id));
    for (const x of videos) {
      const on = showing.has(x.ad.id) && !lowGfx() && !document.hidden;
      if (on && x.v.paused) x.v.play().catch(() => {}); else if (!on && !x.v.paused) x.v.pause();
      if (on && x.ok && x.v.readyState >= 2) { paint(x.g, x.c.width, x.c.height, x.ad, x.v, false); x.t.needsUpdate = true; }
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
  // close to a sponsor's screen or poster: a card with the ad, who it's from and a button to their page (or O)
  const st = document.createElement("style");
  st.textContent = `#rb-adchip{position:fixed;z-index:7100;left:50%;transform:translateX(-50%);bottom:calc(84px + env(safe-area-inset-bottom));display:none;align-items:center;gap:12px;width:min(92vw,440px);padding:10px 12px;border-radius:16px;background:rgba(6,6,6,.92);border:1px solid rgba(201,168,76,.75);box-shadow:0 8px 30px rgba(0,0,0,.5);color:#fff;font:600 12px/1.3 Inter,system-ui,sans-serif;text-decoration:none}
#rb-adchip img{width:88px;height:56px;object-fit:cover;border-radius:10px;background:#111;flex:none}#rb-adchip .t{flex:1;min-width:0}#rb-adchip small{display:block;color:#C9A84C;font:800 10px/1.2 Inter,sans-serif;letter-spacing:1.5px}#rb-adchip b{display:block;font:800 14px/1.25 Inter,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#rb-adchip span.h{display:block;color:rgba(255,255,255,.7);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#rb-adchip .go{flex:none;background:linear-gradient(135deg,#8a6a1c,#C9A84C);color:#000;border-radius:10px;padding:9px 12px;font:900 11px/1 Inter,sans-serif;letter-spacing:1px}#rb-adchip kbd{border:1px solid rgba(0,0,0,.4);border-radius:4px;padding:0 4px;margin-left:4px;font:800 10px Inter,sans-serif}
body.rb-touch #rb-adchip kbd{display:none}body:has(.overlay[style*="flex"]) #rb-adchip,body:has(#rb-phone.open) #rb-adchip,body.rb-photo #rb-adchip{display:none!important}`;
  document.head.appendChild(st);
  const chip = document.createElement("a"); chip.id = "rb-adchip"; chip.target = "_blank"; chip.rel = "sponsored noopener";
  chip.innerHTML = '<img alt=""><div class="t"><small>SPONSORED</small><b></b><span class="h"></span></div><span class="go"></span>';
  document.body.appendChild(chip);
  let nearT = 0, shown = null;
  function near(dt) {
    nearT += dt; if (nearT < 0.4) return; nearT = 0;
    const car = E.car; let best = null, bd = Infinity;
    for (const s of world.adSpots) { if (!s.ad || !s.ad.click) continue; const d = Math.hypot(car.x - s.x, car.z - s.z); if (d < (s.kind === "board" ? 45 : 18) && d < bd) { bd = d; best = s; } }
    const ad = best && best.ad; out.near = ad ? ad.id : null;
    if (!ad) { chip.style.display = "none"; shown = null; return; }
    if (shown !== ad.id) {
      shown = ad.id; chip.href = ad.click;
      const im = chip.querySelector("img"); im.style.display = ad.image_url ? "" : "none"; if (ad.image_url) im.src = ad.image_url;
      chip.querySelector("b").textContent = esc(ad.advertiser); chip.querySelector("span.h").textContent = esc(ad.headline || "");
      chip.querySelector(".go").innerHTML = ""; chip.querySelector(".go").append(document.createTextNode((esc(ad.cta) || "Visit") + " ↗")); const k = document.createElement("kbd"); k.textContent = "O"; chip.querySelector(".go").append(k);
      chip.setAttribute("aria-label", "Sponsored: " + esc(ad.advertiser) + ". Opens their page.");
    }
    chip.style.display = "flex";
  }
  window.addEventListener("keydown", (e) => { if (e.code === "KeyO" && !e.repeat && out.near && chip.style.display === "flex" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "")) { if (document.pointerLockElement) document.exitPointerLock(); window.open(chip.href, "_blank", "noopener"); } });
  // Screens stay just as bright by day and by night (the picture's exposure changes; the screens make up for it),
  // and at night the nearest two throw their colour on the street.
  const spill = [0, 1].map(() => { const l = new THREE.PointLight(0xffffff, 0, 28, 1.6); ctx.scene.add(l); return l; });
  let lightT = 0;
  function screens(dt) {
    const ex = (ctx.renderer && ctx.renderer.toneMappingExposure) || 0.6;
    const m = Math.max(1.2, Math.min(1.9, 1.0 / ex));
    for (const s of world.adSpots) { const mat = s.mesh && s.mesh.material; if (mat && mat.color) mat.color.setScalar(s.kind === "board" ? m : m * 0.85); }
    lightT -= dt; if (lightT > 0) return; lightT = 0.5;
    const night = E.night ? E.night() : 0, lit = night > 0.3 && !lowGfx();
    const near2 = lit ? world.adSpots.filter((s) => s.kind === "board").map((s) => [s, Math.hypot(E.car.x - s.x, E.car.z - s.z)]).filter((x) => x[1] < 140).sort((a, b) => a[1] - b[1]).slice(0, 2) : [];
    spill.forEach((l, i) => {
      const it = near2[i]; if (!it) { l.intensity = 0; return; }
      const s = it[0], map = s.mesh.material.map, avg = (map && map.userData && map.userData.avg) || new THREE.Color(0.9, 0.75, 0.45);
      l.color.copy(avg).multiplyScalar(1.4); l.intensity = 90 * night;
      l.position.set(s.x + Math.sin(s.ang) * 6, Math.max(2, s.y - s.h * 0.4), s.z + Math.cos(s.ang) * 6);
    });
  }
  ctx.onFrame((dt) => { screens(dt); if (!out.ads.length) return; drawVideos(dt); check(dt); near(dt); });
  setInterval(flush, 5000);
  window.addEventListener("pagehide", flush);
  load(); setInterval(load, 5 * 60e3); // new or ended campaigns show within five minutes
  return out;
}
