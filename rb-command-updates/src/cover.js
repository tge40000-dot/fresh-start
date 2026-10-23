/**
 * Cover maker (team.relentlessbillionaire.com/cover): the stills that go with a video from the video creator.
 *
 * One photo and a title make three images at once, in the video creator's four looks (Noir Gold, Pulse, Vinyl,
 * Editorial): a YouTube thumbnail (1280×720, JPEG under YouTube's 2 MB limit), a square cover (1080, or 3000 for
 * streaming services) and a Story / Reel cover (1080×1920). Everything is drawn in the browser; nothing is uploaded.
 * The photo can come from this device or from RB's catalog (song and beat covers, AI Forge covers), read through the
 * video creator's same-origin /api/video/media so the canvas can be saved.
 * Text stays out of each platform's covered corners: YouTube's timestamp (bottom right) and the Story bars (top and
 * bottom 14%).
 */
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function csp(nonce) {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    "font-src https://fonts.gstatic.com",
    "img-src 'self' https: data: blob:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const STYLE = `
@font-face{font-family:"RB Cinzel";src:url(https://fonts.gstatic.com/s/cinzel/v26/8vIJ7ww63mVu7gt79mT7.woff2) format("woff2");font-weight:400 900;font-display:swap}
@font-face{font-family:"RB Cormorant";src:url(https://fonts.gstatic.com/s/cormorantgaramond/v21/co3bmX5slCNuHLi8bLeY9MK7whWMhyjYqXtK.woff2) format("woff2");font-weight:300 700;font-display:swap}
:root{--bg:#07060A;--panel:#100E0B;--line:#2A251C;--line2:#3B3426;--gold:#C9A227;--gold2:#E9CF83;--text:#EFE8D8;--muted:#9C9380;--bad:#E0674A;
  --caps:"RB Cinzel",Cinzel,"Times New Roman",serif;--serif:"RB Cormorant","Cormorant Garamond",Georgia,serif;--sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
*{box-sizing:border-box}html{color-scheme:dark}
body{margin:0;min-height:100vh;background:radial-gradient(1200px 600px at 70% -10%,rgba(201,162,39,.10),transparent 60%),var(--bg);color:var(--text);font:15px/1.5 var(--sans)}
a{color:var(--gold2)}
.top{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 28px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.brand{font:600 12px/1 var(--caps);letter-spacing:.32em;color:var(--gold)}.brand b{display:block;margin-top:6px;font:400 11px/1 var(--sans);letter-spacing:.08em;color:var(--muted)}
.top-links{display:flex;gap:8px;flex-wrap:wrap}.back{color:var(--muted);text-decoration:none;font-size:13px;border:1px solid var(--line2);padding:8px 14px;border-radius:999px}
.hero{padding:28px 28px 8px}.hero h1{margin:0;font:500 clamp(30px,5vw,46px)/1.05 var(--serif)}.hero p{margin:8px 0 0;color:var(--muted);max-width:640px}
.studio{display:grid;grid-template-columns:minmax(0,360px) minmax(0,1fr);gap:22px;padding:18px 28px 60px}
@media (max-width:900px){.studio{grid-template-columns:minmax(0,1fr);padding:14px 16px 48px}.top,.hero{padding-left:16px;padding-right:16px}}
.card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px;margin-bottom:14px}
.card h2{margin:0 0 10px;font:600 12px/1 var(--caps);letter-spacing:.24em;color:var(--gold)}
label.f{display:block;font-size:12px;color:var(--muted);margin:10px 0 4px}
input[type=text],select{width:100%;min-width:0;padding:10px 12px;border-radius:10px;border:1px solid var(--line2);background:#0B0A08;color:var(--text);font:inherit}
input[type=range]{width:100%;accent-color:var(--gold)}
.pick{display:block;border:1px dashed var(--line2);border-radius:12px;padding:14px;text-align:center;color:var(--muted);cursor:pointer;font-size:13px}.pick input{display:none}
.looks{display:grid;grid-template-columns:1fr 1fr;gap:8px}.looks button{text-align:left;padding:10px;border-radius:12px;border:1px solid var(--line2);background:#0B0A08;color:var(--text);cursor:pointer;font:inherit}
.looks button b{display:block;font:600 12px/1.2 var(--caps);letter-spacing:.12em;color:var(--gold2)}.looks button span{font-size:12px;color:var(--muted)}
.looks button[aria-pressed=true]{border-color:var(--gold);box-shadow:0 0 0 1px var(--gold) inset}
.muted{color:var(--muted);font-size:13px}.mt{margin-top:10px}
.outs{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:16px;align-items:start}
.out{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:12px}
.out h3{margin:0 0 8px;font:600 11px/1 var(--caps);letter-spacing:.2em;color:var(--gold2)}.out h3 span{color:var(--muted);font:400 11px/1 var(--sans);letter-spacing:0;margin-left:6px}
.out canvas{display:block;width:100%;height:auto;border-radius:8px;background:#000;cursor:crosshair}
.out .row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.btn{appearance:none;border:1px solid var(--gold);background:transparent;color:var(--gold2);border-radius:999px;padding:8px 14px;font:600 13px/1 var(--sans);cursor:pointer}
.btn.primary{background:linear-gradient(135deg,#F2D98A,#C9A227);color:#111;border-color:transparent}
.btn:disabled{opacity:.5;cursor:default}
.empty{color:var(--muted);text-align:center;padding:40px 10px;border:1px dashed var(--line2);border-radius:16px}
.msg{min-height:1.2em;font-size:13px;margin-top:8px}.msg.bad{color:var(--bad)}
`;

const LOOKS = [["noir", "Noir Gold", "Deep shadow, gold frame, serif title."], ["pulse", "Pulse", "Hard contrast, gold slash, big caps."], ["vinyl", "Vinyl", "Your photo on a gold record."], ["editorial", "Editorial", "Magazine panel, big serif type."]];

export function page(nonce) {
  const looks = LOOKS.map(([k, n, d], i) => `<button type="button" data-look="${k}" aria-pressed="${i === 0}"><b>${esc(n)}</b><span>${esc(d)}</span></button>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Cover maker · RB Command</title><style nonce="${nonce}">${STYLE}</style></head><body>
<header class="top"><div class="brand">RB COMMAND<b>Cover maker</b></div><span class="top-links"><a class="back" href="/video">Video creator</a><a class="back" href="/">← Back to RB Command</a></span></header>
<section class="hero"><h1>The cover that sells the click.</h1><p>One photo and a title make the YouTube thumbnail, the square cover and the Story cover, in the same looks as the video creator. Made on this device; nothing is uploaded.</p></section>
<main class="studio">
<div class="controls">
  <section class="card"><h2>The photo</h2>
    <label class="pick">Drop a photo here, or tap to choose<input id="file" type="file" accept="image/*"></label>
    <label class="f" for="lib">Or a cover from RB's catalog</label>
    <select id="lib"><option value="">Loading the catalog…</option></select>
    <p class="muted mt">Tap any preview on the part that must stay in frame, like a face.</p>
    <label class="f" for="bright">Photo brightness</label><input id="bright" type="range" min="40" max="130" value="100">
  </section>
  <section class="card"><h2>The words</h2>
    <label class="f" for="title">Title</label><input id="title" type="text" maxlength="60" placeholder="Song or video title">
    <label class="f" for="sub">Artist or subtitle</label><input id="sub" type="text" maxlength="60" placeholder="Artist name">
    <label class="f" for="tag">Badge (optional)</label><input id="tag" type="text" maxlength="24" placeholder="OUT NOW · NEW VIDEO · LIVE FRIDAY">
    <label class="f"><input id="mark" type="checkbox" checked> RB mark in the corner</label>
  </section>
  <section class="card"><h2>The look</h2><div class="looks" id="looks">${looks}</div></section>
</div>
<div>
  <div class="empty" id="empty">Add a photo to see your covers.</div>
  <div class="outs" id="outs" hidden></div>
  <p class="msg" id="msg" role="status" aria-live="polite"></p>
</div>
</main>
<script nonce="${nonce}">${CLIENT}</script></body></html>`;
}

const CLIENT = String.raw`(function(){
var $ = function(id){ return document.getElementById(id); };
var FORMATS = [
  { key: "yt", label: "YouTube thumbnail", note: "1280 × 720", w: 1280, h: 720, type: "image/jpeg", safe: { l: .06, r: .06, t: .08, b: .10, avoidBR: [.2, .16] } },
  { key: "sq", label: "Square cover", note: "1080 × 1080", w: 1080, h: 1080, type: "image/png", big: 3000, safe: { l: .07, r: .07, t: .07, b: .07 } },
  { key: "story", label: "Story / Reel cover", note: "1080 × 1920", w: 1080, h: 1920, type: "image/jpeg", safe: { l: .08, r: .08, t: .14, b: .2 } }
];
var S = { img: null, fx: .5, fy: .5, look: "noir", bright: 100, name: "cover" };
var GOLD = ["#F6E3A0", "#E2B649", "#A8761A"];
function gold(ctx, x0, y0, x1, y1){ var g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, GOLD[0]); g.addColorStop(.5, GOLD[1]); g.addColorStop(1, GOLD[2]); return g; }
function say(t, bad){ var m = $("msg"); m.textContent = t || ""; m.className = "msg" + (bad ? " bad" : ""); }
function val(id){ return ($(id).value || "").trim(); }

// The photo, cropped to fill a box around the chosen focus point.
function photo(ctx, x, y, w, h, filter){
  var im = S.img, iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height;
  var sc = Math.max(w / iw, h / ih), sw = w / sc, sh = h / sc;
  var sx = Math.min(Math.max(S.fx * iw - sw / 2, 0), iw - sw), sy = Math.min(Math.max(S.fy * ih - sh / 2, 0), ih - sh);
  ctx.save(); ctx.filter = "brightness(" + S.bright + "%)" + (filter ? " " + filter : "");
  ctx.drawImage(im, sx, sy, sw, sh, x, y, w, h); ctx.restore();
}
// Fits text to a width: shrinks the size, then wraps to at most two lines.
function fit(ctx, text, font, size, maxW, min){
  var s = size;
  for (; s >= min; s -= 2) { ctx.font = font(s); if (ctx.measureText(text).width <= maxW) return { lines: [text], size: s }; }
  var words = text.split(/\s+/), best = null;
  for (s = size; s >= min * .8 && !best; s -= 2) {
    ctx.font = font(s);
    for (var i = 1; i < words.length; i++) {
      var a = words.slice(0, i).join(" "), b = words.slice(i).join(" ");
      if (ctx.measureText(a).width <= maxW && ctx.measureText(b).width <= maxW) { best = { lines: [a, b], size: s }; break; }
    }
  }
  return best || { lines: [text], size: min };
}
function lines(ctx, f, x, y, lh, align){ ctx.textAlign = align || "left"; f.lines.forEach(function(t, i){ ctx.fillText(t, x, y + i * lh); }); return y + (f.lines.length - 1) * lh; }
function badge(ctx, text, x, y, size, dark){
  if (!text) return;
  ctx.font = "700 " + size + "px 'RB Cinzel', Cinzel, serif"; var w = ctx.measureText(text.toUpperCase()).width + size * 1.6, h = size * 2;
  ctx.fillStyle = dark ? "#0B0A09" : gold(ctx, x, y, x + w, y + h); roundRect(ctx, x, y, w, h, h / 2); ctx.fill();
  ctx.fillStyle = dark ? GOLD[1] : "#0B0A09"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(text.toUpperCase(), x + size * .8, y + h / 2 + 1); ctx.textBaseline = "alphabetic";
}
function roundRect(ctx, x, y, w, h, r){ ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function mark(ctx, x, y, s){
  if (!$("mark").checked) return;
  ctx.fillStyle = gold(ctx, x, y, x + s, y + s); roundRect(ctx, x, y, s, s, s * .22); ctx.fill();
  ctx.fillStyle = "#0B0A09"; ctx.font = "700 " + Math.round(s * .5) + "px 'RB Cinzel', Cinzel, serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("RB", x + s / 2, y + s / 2 + s * .03); ctx.textBaseline = "alphabetic";
}
var SERIF = function(s){ return "600 " + s + "px 'RB Cormorant', 'Cormorant Garamond', Georgia, serif"; };
var CAPS = function(s){ return "800 " + s + "px 'RB Cinzel', Cinzel, 'Times New Roman', serif"; };

function draw(c, fmt, scale){
  var W = fmt.w * (scale || 1), H = fmt.h * (scale || 1), ctx = c.getContext("2d"); c.width = W; c.height = H;
  var u = Math.min(W, H) / 100, sf = fmt.safe, L = W * sf.l, R = W * (1 - sf.r), T = H * sf.t, B = H * (1 - sf.b);
  if (fmt.key === "yt") R = Math.min(R, W * (1 - sf.avoidBR[0]) + W * .1);
  var title = val("title") || "Your title", sub = val("sub"), tag = val("tag"), look = S.look, wide = W / H > 1.2;
  ctx.fillStyle = "#07060A"; ctx.fillRect(0, 0, W, H);
  if (look === "noir") {
    photo(ctx, 0, 0, W, H, "contrast(108%) saturate(90%)");
    var g = ctx.createLinearGradient(0, H * .35, 0, H); g.addColorStop(0, "rgba(7,6,10,0)"); g.addColorStop(1, "rgba(7,6,10,.92)"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    var v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .3, W / 2, H / 2, Math.max(W, H) * .75); v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,.55)"); ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = gold(ctx, 0, 0, W, H); ctx.lineWidth = Math.max(2, u * .5); ctx.strokeRect(u * 2.6, u * 2.6, W - u * 5.2, H - u * 5.2);
    var tf = fit(ctx, title, SERIF, Math.round(u * (wide ? 20 : 13)), R - L, Math.round(u * 6)), lh = tf.size * .98;
    var subH = sub ? u * (wide ? 6.5 : 5.2) : 0, y = B - subH - (tf.lines.length - 1) * lh;
    ctx.fillStyle = "#F7F1E3"; ctx.font = SERIF(tf.size); ctx.shadowColor = "rgba(0,0,0,.6)"; ctx.shadowBlur = u * 2; lines(ctx, tf, L, y, lh); ctx.shadowBlur = 0;
    if (sub) { ctx.fillStyle = GOLD[1]; ctx.font = CAPS(Math.round(u * (wide ? 4.6 : 3.4))); ctx.textAlign = "left"; ctx.fillText(sub.toUpperCase(), L, B); }
    badge(ctx, tag, L, T, Math.round(u * (wide ? 3.8 : 2.6)));
    mark(ctx, W - L - u * 9, T, u * 9);
  } else if (look === "pulse") {
    photo(ctx, 0, 0, W, H, "grayscale(100%) contrast(140%)");
    ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.translate(W * .5, H * .62); ctx.rotate(-0.18); ctx.fillStyle = gold(ctx, -W, 0, W, 0); ctx.fillRect(-W, -u * 2.2, W * 2, u * 4.4); ctx.restore();
    var pf = fit(ctx, title.toUpperCase(), CAPS, Math.round(u * (wide ? 18 : 12)), R - L, Math.round(u * 5)), plh = pf.size * 1.02;
    var py = (wide ? H * .5 : H * .48) - ((pf.lines.length - 1) * plh) / 2;
    ctx.fillStyle = "#FFFFFF"; ctx.font = CAPS(pf.size); ctx.shadowColor = "rgba(0,0,0,.75)"; ctx.shadowBlur = u * 2.5; lines(ctx, pf, W / 2, py, plh, "center"); ctx.shadowBlur = 0;
    if (sub) { ctx.font = "700 " + Math.round(u * (wide ? 5 : 3.6)) + "px system-ui, sans-serif"; ctx.fillStyle = GOLD[0]; ctx.textAlign = "center"; ctx.fillText(sub.toUpperCase(), W / 2, py + (pf.lines.length - 1) * plh + u * (wide ? 9 : 7)); }
    badge(ctx, tag, L, T, Math.round(u * (wide ? 3.8 : 2.6)));
    mark(ctx, W - L - u * 9, T, u * 9);
  } else if (look === "vinyl") {
    ctx.fillStyle = "#0B0A09"; ctx.fillRect(0, 0, W, H);
    var tall = H / W > 1.4, r = wide ? H * .42 : tall ? W * .36 : W * .29, cx = wide ? W * .27 : W / 2, cy = wide ? H / 2 : tall ? H * .4 : H * .36;
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = "#111"; ctx.fill();
    for (var k = 0; k < 14; k++) { ctx.beginPath(); ctx.arc(cx, cy, r * (.42 + k * .04), 0, Math.PI * 2); ctx.strokeStyle = "rgba(226,182,73," + (.08 + (k % 3) * .04) + ")"; ctx.lineWidth = Math.max(1, u * .2); ctx.stroke(); }
    ctx.beginPath(); ctx.arc(cx, cy, r * .38, 0, Math.PI * 2); ctx.clip(); photo(ctx, cx - r * .38, cy - r * .38, r * .76, r * .76); ctx.restore();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.strokeStyle = gold(ctx, cx - r, cy - r, cx + r, cy + r); ctx.lineWidth = u * .8; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, u * .9, 0, Math.PI * 2); ctx.fillStyle = "#0B0A09"; ctx.fill();
    var tx = wide ? W * .54 : L, tw = wide ? R - tx : R - L, ty = wide ? H * .5 : tall ? H * .8 : H * .8;
    var vf = fit(ctx, title, SERIF, Math.round(u * (wide ? 17 : 11)), tw, Math.round(u * 5)), vlh = vf.size;
    ctx.fillStyle = "#F7F1E3"; ctx.font = SERIF(vf.size); var vy = lines(ctx, vf, tx, ty, vlh);
    if (sub) { ctx.fillStyle = GOLD[1]; ctx.font = CAPS(Math.round(u * (wide ? 4.4 : 3.2))); ctx.textAlign = "left"; ctx.fillText(sub.toUpperCase(), tx, vy + u * (wide ? 8 : 6)); }
    badge(ctx, tag, tx, wide ? ty - vf.size - u * 9 : T, Math.round(u * (wide ? 3.6 : 2.6)));
    mark(ctx, W - L - u * 9, wide ? T : T, u * 9);
  } else {
    var split = wide ? W * .56 : H * .6;
    if (wide) photo(ctx, 0, 0, split, H); else photo(ctx, 0, 0, W, split);
    ctx.fillStyle = "#F3EBDD"; if (wide) ctx.fillRect(split, 0, W - split, H); else ctx.fillRect(0, split, W, H - split);
    ctx.fillStyle = gold(ctx, 0, 0, W, 0); if (wide) ctx.fillRect(split - u * .6, 0, u * 1.2, H); else ctx.fillRect(0, split - u * .6, W, u * 1.2);
    var ex = wide ? split + u * 5 : L, ew = wide ? W - ex - u * 5 : R - L, ey = wide ? H * .42 : split + u * 16;
    if (!wide) ew = R - L;
    ctx.fillStyle = "#8F6A22"; ctx.font = CAPS(Math.round(u * 2.6)); ctx.textAlign = "left"; ctx.fillText((tag || "Relentless Billionaire").toUpperCase(), ex, ey - u * 9);
    var ef = fit(ctx, title, SERIF, Math.round(u * (wide ? 16 : 12)), ew, Math.round(u * 5)), elh = ef.size * .98;
    ctx.fillStyle = "#0B0A09"; ctx.font = SERIF(ef.size); var eyy = lines(ctx, ef, ex, ey, elh);
    if (sub) { ctx.fillStyle = "#3A3326"; ctx.font = "600 " + Math.round(u * 3.4) + "px system-ui, sans-serif"; ctx.fillText(sub, ex, eyy + u * 7); }
    mark(ctx, wide ? W - u * 5 - u * 9 : W - L - u * 9, wide ? H - u * 5 - u * 9 - (fmt.key === "yt" ? H * .12 : 0) : T, u * 9);
  }
}

function render(){
  var outs = $("outs");
  if (!S.img) { outs.hidden = true; $("empty").hidden = false; return; }
  $("empty").hidden = true; outs.hidden = false;
  if (!outs.children.length) FORMATS.forEach(function(f){
    var box = document.createElement("div"); box.className = "out";
    box.innerHTML = '<h3>' + f.label + '<span>' + f.note + '</span></h3><canvas aria-label="' + f.label + ' preview"></canvas><div class="row"><button class="btn primary" type="button" data-dl="' + f.key + '">Download</button>' + (f.big ? '<button class="btn" type="button" data-dl="' + f.key + '" data-big="1">3000 px for streaming</button>' : "") + "</div>";
    outs.appendChild(box);
    var cv = box.querySelector("canvas");
    cv.addEventListener("click", function(e){ var b = cv.getBoundingClientRect(); S.fx = (e.clientX - b.left) / b.width; S.fy = (e.clientY - b.top) / b.height; render(); });
  });
  FORMATS.forEach(function(f, i){ draw(outs.children[i].querySelector("canvas"), f); });
}
function save(key, big){
  var f = FORMATS.filter(function(x){ return x.key === key; })[0], c = document.createElement("canvas");
  draw(c, f, big ? f.big / f.w : 1);
  var type = f.type, q = .92;
  (function go(){
    c.toBlob(function(b){
      if (!b) { say("Couldn't make that file. Try another photo.", true); return; }
      if (key === "yt" && b.size > 2e6 && q > .5) { q -= .1; return go(); }
      var a = document.createElement("a"), base = (val("title") || S.name).replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 50) || "cover";
      a.href = URL.createObjectURL(b); a.download = base + "-" + key + (big ? "-3000" : "") + (type === "image/png" ? ".png" : ".jpg");
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(function(){ URL.revokeObjectURL(a.href); }, 6e4);
      say("Saved " + a.download + " (" + (b.size / 1048576).toFixed(1) + " MB).");
    }, type, q);
  })();
}
function useImage(src, name){
  var im = new Image(); im.decoding = "async";
  im.onload = function(){ S.img = im; S.fx = .5; S.fy = .5; S.name = name || "cover"; say(""); document.fonts && document.fonts.ready.then(render); render(); };
  im.onerror = function(){ say("That picture couldn't be opened.", true); };
  im.src = src;
}
$("file").addEventListener("change", function(){ var f = this.files && this.files[0]; if (f) useImage(URL.createObjectURL(f), f.name.replace(/\.[^.]+$/, "")); });
$("bright").addEventListener("input", function(){ S.bright = +this.value; render(); });
["title", "sub", "tag", "mark"].forEach(function(id){ $(id).addEventListener("input", render); });
$("looks").addEventListener("click", function(e){ var b = e.target.closest("button[data-look]"); if (!b) return; S.look = b.dataset.look; [].forEach.call(this.children, function(x){ x.setAttribute("aria-pressed", String(x === b)); }); render(); });
$("outs").addEventListener("click", function(e){ var b = e.target.closest("button[data-dl]"); if (b) save(b.dataset.dl, b.dataset.big === "1"); });
fetch("/api/video/library", { credentials: "same-origin" }).then(function(r){ return r.json(); }).then(function(d){
  var sel = $("lib"), items = [].concat((d.songs || []).map(function(s){ return { t: s.title, a: s.artist, c: s.cover }; }), (d.beats || []).map(function(s){ return { t: s.title, a: "", c: s.cover }; }), (d.forge || []).map(function(s){ return { t: s.title, n: s.name, a: "", c: s.cover }; })).filter(function(x){ return x.c; });
  sel.innerHTML = '<option value="">' + (items.length ? "Pick a cover…" : "No covers in the catalog yet") + "</option>" + items.map(function(x, i){ return '<option value="' + i + '"></option>'; }).join("");
  items.forEach(function(x, i){ sel.options[i + 1].textContent = x.t; });
  sel.onchange = function(){ var x = items[+sel.value]; if (!x) return; if (!val("title")) $("title").value = (x.n || x.t).split(" · ")[0]; if (!val("sub") && x.a) $("sub").value = x.a; useImage("/api/video/media?u=" + encodeURIComponent(x.c), x.n || x.t); };
}).catch(function(){ $("lib").innerHTML = '<option value="">The catalog is unavailable</option>'; });
render();
})();`;
