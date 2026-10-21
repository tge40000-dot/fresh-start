/**
 * Site images (team.relentlessbillionaire.com/images): pick which picture each RB site uses for its tab icon, its share
 * preview, its background and its header logo. It works like Site colours: one choice for all sites, any site can have
 * its own or keep its own picture, and the last setting can be put back.
 *
 * Pictures are uploaded through RB Command's /api/upload (folder site-images, into RB media) after the browser sizes
 * them for their slot (icon 512 × 512 PNG, share 1200 × 630 JPEG, background up to 2400 px, logo up to 900 × 300 PNG),
 * then listed in site_assets. The choice is site_settings.site_images (site_images_previous for Undo); the sites read
 * it through rb-public-content (rb-site-updates/src/site-images-public.js). Definitions: site_images_def.js.
 */
import { HttpError } from "./tables.js";
import { SLOTS, SLOT_IDS, IMAGE_SITES, IMAGE_SITE_IDS, parseImages } from "./site_images_def.js";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const mediaBase = (env) => (env.MEDIA_PUBLIC_URL || "https://media.relentlessbillionaire.com").replace(/\/$/, "");
const KEY = /^admin\/site-images\/\d{4}-\d{2}\/[0-9a-f-]{36}\.(png|jpg|jpeg|webp|gif|avif)$/;
const TABLE = "CREATE TABLE IF NOT EXISTS site_assets (id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT, url TEXT NOT NULL, r2_key TEXT, type TEXT, width INTEGER, height INTEGER, created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))";
const UPSERT = "INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')";
const log = (env, who, action, detail) => env.DB.prepare("INSERT INTO command_log (actor, action, target, detail) VALUES (?, ?, 'site images', ?)").bind(who.email, action, String(detail).slice(0, 500));
const used = (setting) => new Set(SLOT_IDS.flatMap((s) => [setting[s].all, ...Object.values(setting[s].sites)]).filter((v) => v && v !== "none"));

function label(setting, names) {
  const parts = [];
  for (const slot of SLOTS) {
    const s = setting[slot.id], bits = [];
    if (s.all) bits.push(`all sites: ${names[s.all] || s.all}`);
    for (const [site, v] of Object.entries(s.sites)) bits.push(`${IMAGE_SITES.find((x) => x.id === site).label}: ${v === "none" ? "own" : names[v] || v}`);
    if (bits.length) parts.push(`${slot.label} (${bits.join(", ")})`);
  }
  return parts.join("; ") || "every site uses its own pictures";
}

export async function get(env) {
  await env.DB.prepare(TABLE).run();
  const [rows, assets] = await Promise.all([
    env.DB.prepare("SELECT key, value, updated_at FROM site_settings WHERE key IN ('site_images', 'site_images_previous')").all(),
    env.DB.prepare("SELECT id, kind, name, url, width, height, created_at FROM site_assets ORDER BY created_at DESC LIMIT 300").all(),
  ]);
  const row = Object.fromEntries((rows.results || []).map((r) => [r.key, r]));
  const setting = parseImages(row.site_images && row.site_images.value);
  const previous = row.site_images_previous ? parseImages(row.site_images_previous.value) : null;
  const names = Object.fromEntries((assets.results || []).map((a) => [a.id, a.name || a.id]));
  return {
    ok: true, setting, updated_at: row.site_images ? row.site_images.updated_at : null, label: label(setting, names),
    previous: previous && JSON.stringify(previous) !== JSON.stringify(setting) ? { setting: previous, label: label(previous, names) } : null,
    assets: assets.results || [], slots: SLOTS, sites: IMAGE_SITES, in_use: [...used(setting)],
  };
}

async function write(env, who, setting, action) {
  const before = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'site_images'").first();
  const ids = [...used(setting)];
  const known = ids.length ? (await env.DB.prepare(`SELECT id, kind, name FROM site_assets WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all()).results || [] : [];
  const byId = Object.fromEntries(known.map((a) => [a.id, a]));
  for (const slot of SLOT_IDS) for (const v of [setting[slot].all, ...Object.values(setting[slot].sites)]) {
    if (!v || v === "none") continue;
    if (!byId[v]) throw new HttpError(400, "One of the chosen pictures isn't in the library any more. Reload and pick again.");
    if (byId[v].kind !== slot) throw new HttpError(400, `"${byId[v].name}" was made for another slot. Upload it again for ${SLOTS.find((s) => s.id === slot).label}.`);
  }
  const names = Object.fromEntries(known.map((a) => [a.id, a.name || a.id]));
  await env.DB.batch([
    env.DB.prepare(UPSERT).bind("site_images_previous", before ? before.value : "{}"),
    env.DB.prepare(UPSERT).bind("site_images", JSON.stringify(setting)),
    log(env, who, action, label(setting, names)),
  ]);
  return { ok: true, setting, label: label(setting, names) };
}

/** Saves the whole choice. Unknown sites and slots are dropped; every picture must be in the library, for its slot. */
export async function save(env, who, body) {
  await env.DB.prepare(TABLE).run();
  return write(env, who, parseImages(JSON.stringify(body && body.setting)), "images.save");
}

export async function undo(env, who) {
  const prev = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'site_images_previous'").first();
  if (!prev) throw new HttpError(400, "There is no earlier setting to put back.");
  return write(env, who, parseImages(prev.value), "images.undo");
}

/** Lists a picture /api/upload just stored in RB media. */
export async function addAsset(env, who, body) {
  await env.DB.prepare(TABLE).run();
  const kind = String(body.kind || ""), key = String(body.key || ""), url = String(body.url || "");
  if (!SLOT_IDS.includes(kind)) throw new HttpError(400, "Pick what the picture is for.");
  if (!KEY.test(key) || url !== `${mediaBase(env)}/${key}`) throw new HttpError(400, "That upload isn't one of RB Command's site pictures.");
  const n = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
  const name = String(body.name || "").replace(/\s+/g, " ").trim().slice(0, 80) || "Picture";
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 20);
  const type = /\.png$/.test(key) ? "image/png" : /\.webp$/.test(key) ? "image/webp" : /\.gif$/.test(key) ? "image/gif" : /\.avif$/.test(key) ? "image/avif" : "image/jpeg";
  await env.DB.batch([
    env.DB.prepare("INSERT INTO site_assets (id, kind, name, url, r2_key, type, width, height, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, kind, name, url, key, type, n(body.width, 10000), n(body.height, 10000), who.email),
    log(env, who, "images.upload", `${SLOTS.find((s) => s.id === kind).label}: ${name}`),
  ]);
  return { ok: true, asset: { id, kind, name, url, width: n(body.width, 10000), height: n(body.height, 10000) } };
}

/** Removes a picture from the library and RB media, unless a site still uses it (or the setting Undo would restore). */
export async function removeAsset(env, who, body) {
  const id = String(body.id || "");
  const a = await env.DB.prepare("SELECT id, name, r2_key FROM site_assets WHERE id = ?").bind(id).first();
  if (!a) throw new HttpError(404, "That picture is already gone.");
  const rows = (await env.DB.prepare("SELECT value FROM site_settings WHERE key IN ('site_images', 'site_images_previous')").all()).results || [];
  if (rows.some((r) => used(parseImages(r.value)).has(id))) throw new HttpError(409, "A site still uses that picture (or Undo would bring it back). Pick another first.");
  if (env.MEDIA && a.r2_key && KEY.test(a.r2_key)) await env.MEDIA.delete(a.r2_key);
  await env.DB.batch([env.DB.prepare("DELETE FROM site_assets WHERE id = ?").bind(id), log(env, who, "images.delete", a.name || id)]);
  return { ok: true };
}

// ---------------------------------------------------------------- page

export function csp(nonce) {
  return ["default-src 'none'", `script-src 'nonce-${nonce}'`, `style-src 'nonce-${nonce}'`, "font-src https://fonts.gstatic.com",
    "img-src 'self' https: data: blob:", "connect-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"].join("; ");
}

const STYLE = `
@font-face{font-family:"RB Cinzel";src:url(https://fonts.gstatic.com/s/cinzel/v26/8vIJ7ww63mVu7gt79mT7.woff2) format("woff2");font-weight:400 900;font-display:swap}
@font-face{font-family:"RB Cormorant";src:url(https://fonts.gstatic.com/s/cormorantgaramond/v21/co3bmX5slCNuHLi8bLeY9MK7whWMhyjYqXtK.woff2) format("woff2");font-weight:300 700;font-display:swap}
:root{--bg:#07060A;--panel:#100E0B;--line:#2A251C;--line2:#3B3426;--gold:#C9A227;--gold2:#E9CF83;--text:#EFE8D8;--muted:#9C9380;--bad:#E0674A;--ok:#7CC48A;
  --caps:"RB Cinzel",Cinzel,"Times New Roman",serif;--serif:"RB Cormorant","Cormorant Garamond",Georgia,serif;--sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
*{box-sizing:border-box}html{color-scheme:dark}
body{margin:0;min-height:100vh;background:radial-gradient(1200px 600px at 70% -10%,rgba(201,162,39,.10),transparent 60%),var(--bg);color:var(--text);font:15px/1.5 var(--sans)}
a{color:var(--gold2)}
.top{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 28px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.brand{font:600 12px/1 var(--caps);letter-spacing:.32em;color:var(--gold)}.brand b{display:block;margin-top:6px;font:400 11px/1 var(--sans);letter-spacing:.08em;color:var(--muted)}
.back{color:var(--muted);text-decoration:none;font-size:13px;border:1px solid var(--line2);padding:8px 14px;border-radius:999px}
main{max-width:1180px;margin:0 auto;padding:22px 28px 80px}@media (max-width:700px){main,.top{padding-left:16px;padding-right:16px}}
h1{margin:0;font:500 clamp(30px,5vw,44px)/1.05 var(--serif)}.lead{color:var(--muted);max-width:720px;margin:8px 0 0}
.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:22px 0 14px}.tabs button{border:1px solid var(--line2);background:transparent;color:var(--text);padding:9px 16px;border-radius:999px;font:600 13px/1 var(--sans);cursor:pointer}
.tabs button[aria-selected=true]{border-color:var(--gold);color:#111;background:linear-gradient(135deg,#F2D98A,#C9A227)}
.card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px;margin-bottom:14px}
.card h2{margin:0 0 6px;font:600 12px/1 var(--caps);letter-spacing:.24em;color:var(--gold)}.muted{color:var(--muted);font-size:13px}
.lib{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-top:12px}
.tile{border:1px solid var(--line2);border-radius:12px;overflow:hidden;background:#0B0A08;display:flex;flex-direction:column}
.tile .pic{aspect-ratio:var(--ar,1);background:#000 center/contain no-repeat}.tile .pic.checker{background-color:#222;background-image:linear-gradient(45deg,#2c2c2c 25%,transparent 25%,transparent 75%,#2c2c2c 75%),linear-gradient(45deg,#2c2c2c 25%,transparent 25%,transparent 75%,#2c2c2c 75%);background-size:16px 16px;background-position:0 0,8px 8px}
.tile .pic img{width:100%;height:100%;object-fit:contain;display:block}
.tile .meta{padding:8px;font-size:12px;display:flex;justify-content:space-between;gap:6px;align-items:center}.tile .meta span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.x{appearance:none;border:0;background:transparent;color:var(--muted);cursor:pointer;font-size:16px;line-height:1;padding:2px 4px}.x:hover{color:var(--bad)}
.pick{display:inline-block;border:1px dashed var(--line2);border-radius:12px;padding:12px 16px;color:var(--gold2);cursor:pointer;font-size:13px}.pick input{display:none}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.mt{margin-top:12px}
table{width:100%;border-collapse:collapse;font-size:14px}td,th{padding:9px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:middle}th{color:var(--muted);font-weight:500;font-size:12px}
td.site a{font-size:12px;margin-left:6px}td.thumb{width:72px}td.thumb div{width:64px;height:40px;border-radius:6px;background:#000 center/contain no-repeat;border:1px solid var(--line2)}
select{width:100%;min-width:0;max-width:340px;padding:9px 10px;border-radius:10px;border:1px solid var(--line2);background:#0B0A08;color:var(--text);font:inherit}
.btn{appearance:none;border:1px solid var(--gold);background:transparent;color:var(--gold2);border-radius:999px;padding:10px 16px;font:600 13px/1 var(--sans);cursor:pointer}
.btn.primary{background:linear-gradient(135deg,#F2D98A,#C9A227);color:#111;border-color:transparent}.btn:disabled{opacity:.5;cursor:default}
.bar{position:sticky;bottom:0;background:rgba(7,6,10,.94);border-top:1px solid var(--line);padding:12px 0;margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.msg{font-size:13px}.msg.bad{color:var(--bad)}.msg.ok{color:var(--ok)}
@media (max-width:700px){td.thumb{display:none}th:nth-child(2){display:none}}
`;

export function page(nonce, canEdit) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Site images · RB Command</title><style nonce="${nonce}">${STYLE}</style></head><body>
<header class="top"><div class="brand">RB COMMAND<b>Site images</b></div><a class="back" href="/">← Back to RB Command</a></header>
<main>
<h1>Pick the picture, site by site.</h1>
<p class="lead">Upload pictures, then choose one for every site or a different one per site, like Site colours. Each site can also keep its own. Changes reach the sites within about a minute.</p>
<div class="tabs" role="tablist" id="tabs"></div>
<section class="card"><h2 id="slot-title"></h2><p class="muted" id="slot-help"></p>
  ${canEdit ? '<div class="row mt"><label class="pick">Upload pictures for this slot<input id="file" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" multiple></label><span class="muted" id="up-msg"></span></div>' : ""}
  <div class="lib" id="lib"></div></section>
<section class="card"><h2>Which site gets which</h2>
  <table><thead><tr><th>Site</th><th></th><th>Picture</th></tr></thead><tbody id="sites"></tbody></table></section>
<div class="bar">${canEdit ? '<button class="btn primary" id="save" type="button" disabled>Publish to the sites</button><button class="btn" id="undo" type="button" hidden>Put back the last setting</button>' : '<span class="muted">You can look but not change this.</span>'}
  <span class="msg" id="msg" role="status" aria-live="polite"></span></div>
</main>
<script nonce="${nonce}">${CLIENT}</script></body></html>`;
}

const CLIENT = String.raw`(function(){
var $ = function(id){ return document.getElementById(id); };
var D = null, S = null, SLOT = "icon", dirty = false;
function api(path, body){
  return fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json", "X-RB-Command": "1" }, body: JSON.stringify(body), credentials: "same-origin" } : { credentials: "same-origin" })
    .then(function(r){ return r.json().then(function(d){ if (!r.ok || d.ok === false) throw new Error(d.error || ("Error " + r.status)); return d; }); });
}
function say(t, kind){ var m = $("msg"); m.textContent = t || ""; m.className = "msg" + (kind ? " " + kind : ""); }
function el(tag, attrs, kids){ var e = document.createElement(tag); for (var k in attrs || {}) { if (k === "text") e.textContent = attrs[k]; else if (k === "style") e.style.cssText = attrs[k]; else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), attrs[k]); else e.setAttribute(k, attrs[k]); } (kids || []).forEach(function(c){ if (c) e.appendChild(c); }); return e; }
function slotDef(){ return D.slots.filter(function(s){ return s.id === SLOT; })[0]; }
function assets(){ return D.assets.filter(function(a){ return a.kind === SLOT; }); }
function byId(id){ return D.assets.filter(function(a){ return a.id === id; })[0]; }
function canHave(site){ return !(SLOT === "background" && !site.background) && !(SLOT === "logo" && !site.logo) && !(SLOT === "share" && site.share === false); }
function setDirty(v){ dirty = v; var b = $("save"); if (b) b.disabled = !v; }
function render(){
  var tabs = $("tabs"); tabs.innerHTML = "";
  D.slots.forEach(function(s){ tabs.appendChild(el("button", { type: "button", role: "tab", "aria-selected": String(s.id === SLOT), text: s.label, onclick: function(){ SLOT = s.id; render(); } })); });
  var def = slotDef(); $("slot-title").textContent = def.label; $("slot-help").textContent = def.help;
  var lib = $("lib"); lib.innerHTML = ""; var list = assets();
  if (!list.length) lib.appendChild(el("p", { class: "muted", text: "No pictures for this slot yet." }));
  list.forEach(function(a){
    var pic = el("div", { class: "pic" + (SLOT === "logo" || SLOT === "icon" ? " checker" : ""), style: "--ar:" + (a.width && a.height ? a.width / a.height : 1) }, [el("img", { src: a.url, alt: a.name, loading: "lazy" })]);
    var del = $("save") ? el("button", { class: "x", type: "button", title: "Delete this picture", "aria-label": "Delete " + a.name, text: "×", onclick: function(){ if (!confirm("Delete " + a.name + "?")) return; api("/api/site-images/asset/delete", { id: a.id }).then(load).catch(function(e){ say(e.message, "bad"); }); } }) : null;
    lib.appendChild(el("div", { class: "tile" }, [pic, el("div", { class: "meta" }, [el("span", { text: a.name + (D.in_use.indexOf(a.id) >= 0 ? " · in use" : "") }), del])]));
  });
  var tb = $("sites"); tb.innerHTML = "";
  function options(sel, includeSame){
    var s = el("select", {});
    if (includeSame) { s.appendChild(el("option", { value: "", text: "Same as all sites" })); s.appendChild(el("option", { value: "none", text: "Keep its own" })); }
    else s.appendChild(el("option", { value: "", text: "Each site keeps its own" }));
    list.forEach(function(a){ s.appendChild(el("option", { value: a.id, text: a.name })); });
    s.value = sel || ""; if (s.value !== (sel || "")) s.value = "";
    if (!$("save")) s.disabled = true;
    return s;
  }
  function thumb(id){ var a = byId(id); var d = el("div", {}); if (a) d.style.backgroundImage = 'url("' + a.url + '")'; return el("td", { class: "thumb" }, [d]); }
  var allSel = options(S[SLOT].all, false);
  allSel.addEventListener("change", function(){ S[SLOT].all = allSel.value || null; setDirty(true); render(); });
  tb.appendChild(el("tr", {}, [el("td", { class: "site" }, [el("strong", { text: "All sites" })]), thumb(S[SLOT].all), el("td", {}, [allSel])]));
  D.sites.forEach(function(site){
    var cell;
    if (!canHave(site)) cell = el("td", { class: "muted", text: site.id === "tv" ? (SLOT === "share" ? "Each video shares its own picture" : "Keeps its own (RB TV's layout stays)") : "This site has no spot for it" });
    else {
      var s = options(S[SLOT].sites[site.id], true);
      s.addEventListener("change", function(){ if (s.value) S[SLOT].sites[site.id] = s.value; else delete S[SLOT].sites[site.id]; setDirty(true); render(); });
      cell = el("td", {}, [s]);
    }
    var own = S[SLOT].sites[site.id], eff = !canHave(site) || own === "none" ? null : own || S[SLOT].all;
    tb.appendChild(el("tr", {}, [el("td", { class: "site" }, [document.createTextNode(site.label), el("a", { href: site.url, target: "_blank", rel: "noopener", text: "open ↗" })]), thumb(eff), cell]));
  });
  var u = $("undo"); if (u) { u.hidden = !D.previous; u.title = D.previous ? "Back to: " + D.previous.label : ""; }
}
function load(){
  return api("/api/site-images").then(function(d){ D = d; S = JSON.parse(JSON.stringify(d.setting)); setDirty(false); render(); say(d.updated_at ? "Now: " + d.label : ""); });
}
// Sizes a picture for its slot in the browser: cover-crop to the exact size, or fit inside the box.
function prepare(file, def){
  return new Promise(function(res, rej){
    var img = new Image(); img.onload = function(){
      var iw = img.naturalWidth, ih = img.naturalHeight, w, h, sx = 0, sy = 0, sw = iw, sh = ih;
      if (def.fit === "cover") { w = def.w; h = def.h; var sc = Math.max(w / iw, h / ih); sw = w / sc; sh = h / sc; sx = (iw - sw) / 2; sy = (ih - sh) / 2; }
      else { var k = Math.min(1, def.w / iw, def.h / ih); w = Math.round(iw * k); h = Math.round(ih * k); }
      var c = document.createElement("canvas"); c.width = w; c.height = h; var x = c.getContext("2d");
      if (def.type === "image/jpeg") { x.fillStyle = "#000"; x.fillRect(0, 0, w, h); }
      x.imageSmoothingQuality = "high"; x.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
      c.toBlob(function(b){ b ? res({ blob: b, w: w, h: h }) : rej(new Error("Couldn't read that picture.")); }, def.type, .9);
      URL.revokeObjectURL(img.src);
    };
    img.onerror = function(){ rej(new Error(file.name + " isn't a picture this browser can open.")); };
    img.src = URL.createObjectURL(file);
  });
}
function upload(files){
  var def = slotDef(), m = $("up-msg"), queue = [].slice.call(files), done = 0;
  function next(){
    if (!queue.length) { m.textContent = done ? done + " uploaded." : ""; return load(); }
    var f = queue.shift(), name = f.name.replace(/\.[^.]+$/, "").slice(0, 80);
    m.textContent = "Uploading " + f.name + "…";
    return prepare(f, def).then(function(p){
      return fetch("/api/upload?folder=site-images&name=" + encodeURIComponent(name), { method: "POST", headers: { "Content-Type": def.type, "X-RB-Command": "1" }, body: p.blob, credentials: "same-origin" })
        .then(function(r){ return r.json().then(function(d){ if (!r.ok || !d.ok) throw new Error(d.error || "Upload failed"); return d; }); })
        .then(function(u){ return api("/api/site-images/asset", { kind: def.id, key: u.key, url: u.url, name: name, width: p.w, height: p.h }); })
        .then(function(){ done++; });
    }).catch(function(e){ say(e.message, "bad"); }).then(next);
  }
  next();
}
if ($("file")) $("file").addEventListener("change", function(){ if (this.files.length) upload(this.files); this.value = ""; });
if ($("save")) $("save").addEventListener("click", function(){ var b = this; b.disabled = true; say("Publishing…"); api("/api/site-images", { setting: S }).then(function(){ return load(); }).then(function(){ say("Published. The sites show it within about a minute.", "ok"); }).catch(function(e){ b.disabled = false; say(e.message, "bad"); }); });
if ($("undo")) $("undo").addEventListener("click", function(){ if (!confirm("Put back: " + (D.previous ? D.previous.label : "the last setting") + "?")) return; api("/api/site-images/undo", {}).then(load).then(function(){ say("Put back.", "ok"); }).catch(function(e){ say(e.message, "bad"); }); });
window.addEventListener("beforeunload", function(e){ if (dirty) { e.preventDefault(); e.returnValue = ""; } });
load().catch(function(e){ say(e.message, "bad"); });
})();`;
