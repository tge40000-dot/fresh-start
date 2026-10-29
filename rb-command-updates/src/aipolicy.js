/**
 * AI limits (team.relentlessbillionaire.com/ai): the owner's boundaries for every AI call RB makes, and the log of
 * every call. Owner only, to look at and to change.
 *
 * The policy is site_settings.ai_policy in waitlist-db (ai_policy_previous for "Put back"); the rules and the check
 * are in ai_policy.js, the same file every AI Worker uses. Saving it also sends a copy to the AI Forge (rb-studio, in
 * the RB account) through Autopilot (env.AUTOPILOT.aiSync), which holds the Forge's key. The log is ai_audit:
 * written by the public AI tools and Autopilot directly, and copied from the AI Forge every 10 minutes.
 */
import { HttpError } from "./tables.js";
import * as P from "./ai_policy.js";

const UPSERT = "INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')";
const log = (env, who, action, detail) => env.DB.prepare("INSERT INTO command_log (actor, action, target, detail) VALUES (?, ?, 'ai limits', ?)").bind(who.email, action, String(detail).slice(0, 500));
const ready = (env) => env.DB.batch([env.DB.prepare(P.AUDIT_TABLE), env.DB.prepare(P.AUDIT_INDEX)]);

/** Who may use this screen: the owner role only (every group). */
export const isOperator = (roles, user) => !!user && !!roles[user.role] && roles[user.role].groups === "*";

async function forgeStatus(env) {
  if (!env.AUTOPILOT || typeof env.AUTOPILOT.aiForgeStatus !== "function") return { ok: false, error: "Autopilot isn't connected, so the AI Forge can't get the policy from here." };
  try { return await env.AUTOPILOT.aiForgeStatus(); } catch (e) { return { ok: false, error: "Autopilot didn't answer. Try again in a minute." }; }
}

/** One line saying what the policy does, for the log and the screen. */
export function summary(p) {
  const off = Object.entries(p.on).filter(([, v]) => !v).map(([k]) => k);
  return [
    off.length ? `paused: ${off.join(", ")}` : "all AI on",
    `styles: ${p.styles.allowed.map((k) => P.STYLES[k].label).join(", ") || "none"}${p.styles.lock ? ` (default ${P.STYLES[p.styles.default]?.label} always applied)` : ""}`,
    `pictures up to ${p.image.maxSide}px, video up to ${p.video.maxSeconds}s, music up to ${p.music.maxSeconds}s`,
    `filters: ${p.filters.visual.length} for pictures, ${p.filters.words.length} for words${p.filters.terms.length ? `, ${p.filters.terms.length} blocked words` : ""}${p.filters.aiCheck ? ", AI check on" : ""}`,
    p.autonomous.requireApproval ? "Autopilot needs approval" : "Autopilot may generate without approval",
  ].join("; ");
}

export async function get(env) {
  await ready(env);
  const since = new Date(Date.now() - 864e5).toISOString();
  const [rows, stats, last] = await Promise.all([
    env.DB.prepare("SELECT key, value, updated_at FROM site_settings WHERE key IN ('ai_policy', 'ai_policy_previous')").all(),
    env.DB.prepare("SELECT surface, outcome, COUNT(*) AS n FROM ai_audit WHERE at > ? GROUP BY surface, outcome").bind(since).all(),
    env.DB.prepare("SELECT actor, created_at FROM command_log WHERE target = 'ai limits' ORDER BY id DESC LIMIT 1").first().catch(() => null),
  ]);
  const row = Object.fromEntries((rows.results || []).map((r) => [r.key, r]));
  const policy = P.cleanPolicy(row.ai_policy && row.ai_policy.value);
  const prev = row.ai_policy_previous ? P.cleanPolicy(row.ai_policy_previous.value) : null;
  const approvals = await env.DB.prepare("SELECT COUNT(*) AS n FROM creative_ideas WHERE status = 'proposed'").first().then((r) => r.n).catch(() => null);
  return {
    ok: true, policy, version: P.policyVersion(policy), saved: Boolean(row.ai_policy), updated_at: row.ai_policy ? row.ai_policy.updated_at : null,
    updated_by: last ? last.actor : null, summary: summary(policy),
    previous: prev && P.policyVersion(prev) !== P.policyVersion(policy) ? { policy: prev, summary: summary(prev) } : null,
    defaults: P.DEFAULT_POLICY, surfaces: P.SURFACES, kinds: P.KINDS,
    styles: Object.entries(P.STYLES).map(([key, s]) => ({ key, label: s.label, prompt: s.prompt })),
    filters: Object.entries(P.FILTERS).map(([key, f]) => ({ key, label: f.label })),
    stats: stats.results || [], approvals, forge: await forgeStatus(env),
  };
}

export async function save(env, who, body) {
  const v = P.validatePolicy(body);
  if (!v.ok) throw new HttpError(400, v.error);
  const before = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'ai_policy'").first();
  const stmts = [];
  if (before) stmts.push(env.DB.prepare(UPSERT).bind("ai_policy_previous", before.value));
  stmts.push(env.DB.prepare(UPSERT).bind("ai_policy", JSON.stringify(v.policy)), log(env, who, "saved", summary(v.policy)));
  await env.DB.batch(stmts);
  await P.loadPolicy(env.DB, { fresh: true });
  const synced = await sync(env, who); // first, so the screen shows what the AI Forge has after it
  return { ...(await get(env)), sync: synced };
}

export async function undo(env, who) {
  const prev = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'ai_policy_previous'").first();
  if (!prev) throw new HttpError(409, "There's no earlier policy to put back.");
  const cur = await env.DB.prepare("SELECT value FROM site_settings WHERE key = 'ai_policy'").first();
  const p = P.cleanPolicy(prev.value);
  await env.DB.batch([
    env.DB.prepare(UPSERT).bind("ai_policy", JSON.stringify(p)),
    ...(cur ? [env.DB.prepare(UPSERT).bind("ai_policy_previous", cur.value)] : []),
    log(env, who, "put back", summary(p)),
  ]);
  await P.loadPolicy(env.DB, { fresh: true });
  const synced = await sync(env, who); // first, so the screen shows what the AI Forge has after it
  return { ...(await get(env)), sync: synced };
}

async function sync(env, who) {
  if (!env.AUTOPILOT || typeof env.AUTOPILOT.aiSync !== "function") return { ok: false, error: "Saved. The AI Forge gets it once Autopilot is connected." };
  try { return await env.AUTOPILOT.aiSync({ by: who.email }); }
  catch { return { ok: false, error: "Saved. Autopilot didn't answer, so the AI Forge gets it on Autopilot's next 10-minute run." }; }
}

/** Try a prompt against the saved policy (or the draft on screen). Nothing is generated. */
export async function check(env, body = {}) {
  const policy = body.policy ? P.cleanPolicy(body.policy) : await P.loadPolicy(env.DB, { fresh: true });
  const req = {
    surface: P.SURFACES[body.surface] ? body.surface : "public", kind: P.KINDS.includes(body.kind) ? body.kind : "image",
    prompt: String(body.prompt || "").slice(0, 4000), style: body.style || null,
    width: Number(body.width) || null, height: Number(body.height) || null, seconds: body.seconds == null || body.seconds === "" ? null : Number(body.seconds),
    autonomous: Boolean(body.autonomous), approved: Boolean(body.approved),
  };
  const result = P.evaluate(policy, req);
  return { ok: true, result, aiCheck: result.ok && P.needsAiCheck(policy, req.surface, req.kind) };
}

/** The log, newest first: ?surface=&outcome=&kind=&q=&before=<at> (50 at a time). */
export async function audit(env, q) {
  await ready(env);
  const where = [], binds = [];
  const s = q.get("surface"), o = q.get("outcome"), k = q.get("kind"), text = String(q.get("q") || "").trim().slice(0, 80), before = q.get("before");
  if (P.SURFACES[s]) { where.push("surface = ?"); binds.push(s); }
  if (P.OUTCOMES.includes(o)) { where.push("outcome = ?"); binds.push(o); }
  if (P.KINDS.includes(k)) { where.push("kind = ?"); binds.push(k); }
  if (text) {
    // % and _ are searched for as themselves, not as wildcards
    const L = "LIKE ? ESCAPE '\\'", like = `%${text.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
    where.push(`(prompt ${L} OR model ${L} OR who ${L} OR ref ${L})`); binds.push(like, like, like, like);
  }
  if (before && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(before)) { where.push("at < ?"); binds.push(before); }
  const sql = `SELECT id, at, surface, kind, model, style, outcome, code, notes, prompt_hash, prompt, who, ref, ms FROM ai_audit ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY at DESC LIMIT 51`;
  const rows = (await env.DB.prepare(sql).bind(...binds).all()).results || [];
  return { ok: true, rows: rows.slice(0, 50), more: rows.length > 50 };
}

// ---------------------------------------------------------------- page

export function csp(nonce) {
  return ["default-src 'none'", `script-src 'nonce-${nonce}'`, `style-src 'nonce-${nonce}'`, "font-src https://fonts.gstatic.com",
    "img-src 'self' data:", "connect-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"].join("; ");
}

const STYLE = `
@font-face{font-family:"RB Cinzel";src:url(https://fonts.gstatic.com/s/cinzel/v26/8vIJ7ww63mVu7gt79mT7.woff2) format("woff2");font-weight:400 900;font-display:swap}
@font-face{font-family:"RB Cormorant";src:url(https://fonts.gstatic.com/s/cormorantgaramond/v21/co3bmX5slCNuHLi8bLeY9MK7whWMhyjYqXtK.woff2) format("woff2");font-weight:300 700;font-display:swap}
:root{--bg:#05040A;--panel:#0C0A10;--panel2:#13110D;--line:#2A261C;--line2:#3D3527;--gold:#D4AF37;--gold2:#F5E6C8;--deep:#8B6914;--crimson:#C41E3A;--crimson-t:#E07A8A;--text:#F5F0E6;--muted:#A89F8C;--ok:#7CC48A;
  --caps:"RB Cinzel",Cinzel,"Times New Roman",serif;--serif:"RB Cormorant","Cormorant Garamond",Georgia,serif;--sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
*{box-sizing:border-box}html{color-scheme:dark}
body{margin:0;min-height:100vh;background:radial-gradient(1200px 600px at 70% -10%,rgba(212,175,55,.09),transparent 60%),var(--bg);color:var(--text);font:15px/1.5 var(--sans)}
a{color:var(--gold2)}:focus-visible{outline:2px solid var(--gold2);outline-offset:2px;border-radius:6px}
.top{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 28px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.brand{font:600 12px/1 var(--caps);letter-spacing:.32em;color:var(--gold)}.brand b{display:block;margin-top:6px;font:400 11px/1 var(--sans);letter-spacing:.08em;color:var(--muted)}
.back{color:var(--muted);text-decoration:none;font-size:13px;border:1px solid var(--line2);padding:8px 14px;border-radius:999px}
main{max-width:1180px;margin:0 auto;padding:22px 28px 90px}@media (max-width:700px){main,.top{padding-left:16px;padding-right:16px}}
h1{margin:0;font:500 clamp(30px,5vw,44px)/1.05 var(--serif)}.lead{color:var(--muted);max-width:760px;margin:8px 0 0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:14px;margin-top:18px}
.card{background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--line);border-radius:16px;padding:18px;min-width:0}
.card.wide{grid-column:1/-1}
.card h2{margin:0 0 4px;font:600 12px/1.2 var(--caps);letter-spacing:.24em;color:var(--gold)}.card>p.muted{margin:0 0 12px}
.muted{color:var(--muted);font-size:13px}
.sw{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid var(--line)}.sw:first-of-type{border-top:0}
.sw b{display:block;font-weight:600}.sw small{color:var(--muted)}
.tg{position:relative;flex:none;width:52px;height:30px}.tg input{position:absolute;inset:0;opacity:0;margin:0;cursor:pointer}
.tg input{z-index:1}.tg i{pointer-events:none;position:absolute;inset:0;border-radius:999px;background:#2b1418;border:1px solid var(--crimson);transition:background .2s,border-color .2s}
.tg i::after{content:"";position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:var(--crimson-t);transition:transform .2s,background .2s}
.tg input:checked+i{background:#2a2410;border-color:var(--gold)}.tg input:checked+i::after{transform:translateX(22px);background:var(--gold)}
.tg input:focus-visible+i{outline:2px solid var(--gold2);outline-offset:2px}
.state{font:600 11px/1 var(--sans);letter-spacing:.12em;text-transform:uppercase;padding:4px 8px;border-radius:999px;border:1px solid}
.state.on{color:var(--gold);border-color:rgba(212,175,55,.45)}.state.off{color:var(--crimson-t);border-color:rgba(196,30,58,.55)}
label.ck{display:flex;gap:10px;align-items:flex-start;padding:7px 0;cursor:pointer}label.ck input{margin-top:3px}input[type=checkbox]{accent-color:var(--gold)}
label.f{display:flex;flex-direction:column;gap:6px;font-size:12px;letter-spacing:.06em;color:var(--muted);margin-top:10px}
input[type=number],input[type=text],input[type=search],select,textarea{width:100%;min-width:0;padding:9px 10px;border-radius:10px;border:1px solid var(--line2);background:#08070B;color:var(--text);font:inherit;font-size:14px;letter-spacing:0}
textarea{min-height:84px;resize:vertical}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{padding:7px 6px;border-bottom:1px solid var(--line);text-align:left;vertical-align:middle}th{color:var(--muted);font-weight:500;font-size:11px;letter-spacing:.06em}
td input[type=number]{padding:6px 7px;max-width:110px}
.scroll{overflow-x:auto}
.btn{appearance:none;border:1px solid var(--gold);background:transparent;color:var(--gold2);border-radius:999px;padding:10px 16px;font:600 13px/1 var(--sans);cursor:pointer}
.btn.primary{background:linear-gradient(135deg,#F5E6C8,#D4AF37 55%,#8B6914);color:#120E05;border-color:transparent}.btn:disabled{opacity:.5;cursor:default}
.bar{position:sticky;bottom:0;background:rgba(5,4,10,.94);border-top:1px solid var(--line);padding:12px 0;margin-top:18px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;z-index:5}
.msg{font-size:13px}.msg.bad{color:var(--crimson-t)}.msg.ok{color:var(--ok)}
.stats{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.stat{border:1px solid var(--line2);border-radius:12px;padding:8px 12px;font-size:12px;color:var(--muted)}.stat b{display:block;font:500 22px/1.1 var(--serif);color:var(--text)}
.pill{display:inline-block;font:600 10.5px/1 var(--sans);letter-spacing:.08em;text-transform:uppercase;padding:4px 7px;border-radius:999px;border:1px solid var(--line2);color:var(--muted)}
.pill.done,.pill.queued{color:var(--gold);border-color:rgba(212,175,55,.4)}.pill.blocked,.pill.failed{color:var(--crimson-t);border-color:rgba(196,30,58,.55)}.pill.rate_limited{color:#E4B452;border-color:rgba(228,180,82,.45)}
.res{margin-top:12px;padding:12px;border-radius:12px;border:1px solid var(--line2);font-size:14px}.res.ok{border-color:rgba(212,175,55,.45)}.res.no{border-color:rgba(196,30,58,.6)}
.res code{display:block;white-space:pre-wrap;color:var(--muted);font-size:12px;margin-top:6px}
.filters{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:10px}
td.p{max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}td.p span{color:var(--muted)}
.when{white-space:nowrap;color:var(--muted)}
.now{margin:12px 0 0;max-width:900px}.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.mt{margin-top:14px}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

export function page(nonce) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>AI limits · RB Command</title><style nonce="${nonce}">${STYLE}</style></head><body>
<header class="top"><div class="brand">RB COMMAND<b>AI limits · owner only</b></div><a class="back" href="/">← Back to RB Command</a></header>
<main>
<h1>Your rules for every AI call.</h1>
<p class="lead">What RB's AI may make, how big, how often, and what it never makes. Every check runs before a model is called: the public tools in RB Create and the studio, the AI Forge, and Autopilot. Every call is logged below.</p>
<p class="muted now" id="now"></p>
<div class="stats" id="stats"></div>
<div class="grid">
  <section class="card"><h2>On or paused</h2><p class="muted">Pausing stops new AI calls straight away. Nothing already made is touched.</p><div id="on"></div><p class="muted" id="forge"></p></section>
  <section class="card"><h2>Style locks</h2><p class="muted">The looks picture and video prompts may use. A style that's off is refused.</p><div id="styles"></div>
    <label class="f">DEFAULT STYLE<select id="style-default"></select></label>
    <label class="ck"><input type="checkbox" id="style-lock"><span>Add the default style to every picture and video prompt that doesn't choose one</span></label></section>
  <section class="card"><h2>Size and length</h2><p class="muted">Bigger requests are brought down to these, not refused.</p>
    <label class="f">LARGEST PICTURE SIDE<select id="max-side"></select></label>
    <label class="f">LONGEST VIDEO (SECONDS, 2–60)<input type="number" id="max-video" min="2" max="60"></label>
    <label class="f">LONGEST MUSIC RENDER (SECONDS, 10–600)<input type="number" id="max-music" min="10" max="600"></label></section>
  <section class="card"><h2>Autonomous actions</h2><p class="muted">Autopilot proposes beats, songs and videos. With this on, it can't start a paid render until you approve that idea.</p>
    <label class="ck"><input type="checkbox" id="approval"><span>Autopilot needs my approval before it generates anything</span></label>
    <p class="muted" id="approvals"></p></section>
  <section class="card wide"><h2>Content filters</h2><p class="muted">Word filters catch the plain cases; the AI check (Llama Guard) also reads public picture and video prompts. Sexual content involving anyone under 18 is always refused, whatever is set here.</p>
    <div class="scroll"><table><thead><tr><th>Filter</th><th>Pictures and video</th><th>Words, voice and music</th></tr></thead><tbody id="filters"></tbody></table></div>
    <label class="f">MORE WORDS TO BLOCK (ONE PER LINE OR COMMA)<textarea id="terms" placeholder="e.g. a rival's name, a word RB never uses"></textarea></label>
    <label class="ck"><input type="checkbox" id="ai-check"><span>AI check of public picture and video prompts (adds about half a second)</span></label></section>
  <section class="card wide"><h2>Rate limits</h2><p class="muted">Public tools: per visitor per minute, hour and day, and a site-wide daily cap that protects the AI bill. 0 stops that feature.</p>
    <div class="scroll"><table><thead><tr><th>Public tool</th><th>Per minute</th><th>Per hour</th><th>Per day</th><th>Whole site per day</th></tr></thead><tbody id="rates"></tbody></table></div>
    <p class="muted mt">AI Forge renders per day (operator and Autopilot together). 0 means no cap, as now.</p>
    <div class="scroll"><table><thead><tr id="forge-head"></tr></thead><tbody><tr id="forge-caps"></tr></tbody></table></div></section>
  <section class="card"><h2>The log</h2><p class="muted">Every call is logged with its outcome and a fingerprint of the prompt.</p>
    <label class="ck"><input type="checkbox" id="keep"><span>Keep the first 300 characters of each prompt (visitors' prompts included)</span></label>
    <label class="f">KEEP THE LOG FOR (DAYS, 7–365)<input type="number" id="days" min="7" max="365"></label></section>
  <section class="card"><h2>Try a prompt</h2><p class="muted">Checks a prompt against the rules on this screen, saved or not. Nothing is generated.</p>
    <div class="filters"><select id="t-surface"></select><select id="t-kind"></select><select id="t-style"></select></div>
    <textarea id="t-prompt" placeholder="Describe a picture, a video, a song…"></textarea>
    <div class="row mt"><button class="btn" type="button" id="t-go">Check it</button></div><div id="t-res"></div></section>
</div>
<section class="card wide mt"><h2>Every AI call</h2><p class="muted">Newest first. The AI Forge's calls arrive every 10 minutes.</p>
  <div class="filters"><select id="l-surface"></select><select id="l-outcome"></select><select id="l-kind"></select><input type="search" id="l-q" placeholder="Search prompts, models, who"></div>
  <div class="scroll"><table><thead><tr><th>When</th><th>Where</th><th>What</th><th>Outcome</th><th>Prompt</th><th>Model</th><th>Who</th></tr></thead><tbody id="log"></tbody></table></div>
  <div class="row mt"><button class="btn" type="button" id="l-more" hidden>Older</button></div></section>
<div class="bar"><button class="btn primary" id="save" type="button" disabled>Publish these rules</button><button class="btn" id="undo" type="button" hidden>Put back the last rules</button><button class="btn" id="reset" type="button">Start from RB's defaults</button>
  <span class="msg" id="msg" role="status" aria-live="polite"></span></div>
</main>
<script nonce="${nonce}">${CLIENT}</script></body></html>`;
}

const CLIENT = String.raw`(function(){
var $ = function(id){ return document.getElementById(id); };
var D = null, S = null, dirty = false, logBefore = null;
var RATE_NAMES = { image: "Pictures (Film, Voice backgrounds)", speech: "AI voice", transcription: "Captions", text: "Writing", vision: "Reading pictures", safety: "Safety check", embeddings: "Search", studio: "Studio helpers (lyrics, vocals)" };
var SURF = { public: "Public tools", forge: "AI Forge", autopilot: "Autopilot" };
var OUT = { done: "Done", queued: "Queued", blocked: "Blocked", rate_limited: "Rate limited", failed: "Failed" };
function api(path, body){
  return fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json", "X-RB-Command": "1" }, body: JSON.stringify(body), credentials: "same-origin" } : { credentials: "same-origin" })
    .then(function(r){ return r.json().then(function(d){ if (!r.ok || d.ok === false) throw new Error(d.error || ("Error " + r.status)); return d; }); });
}
function say(t, kind){ var m = $("msg"); m.textContent = t || ""; m.className = "msg" + (kind ? " " + kind : ""); }
function el(tag, attrs, kids){ var e = document.createElement(tag); for (var k in attrs || {}) { if (k === "text") e.textContent = attrs[k]; else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), attrs[k]); else if (attrs[k] !== false && attrs[k] != null) e.setAttribute(k, attrs[k] === true ? "" : attrs[k]); } (kids || []).forEach(function(c){ if (c != null) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); }); return e; }
function opt(sel, list, cur){ sel.innerHTML = ""; list.forEach(function(o){ var x = el("option", { value: o[0], text: o[1] }); if (String(o[0]) === String(cur)) x.selected = true; sel.appendChild(x); }); }
function setDirty(v){ dirty = v; $("save").disabled = !v; if (v) say("Not published yet."); }
function changed(){ setDirty(true); }
function toggle(id, on, title, sub, fn){
  var inp = el("input", { type: "checkbox", id: id, role: "switch", "aria-label": title }); inp.checked = on;
  var st = el("span", { class: "state " + (on ? "on" : "off"), text: on ? "On" : "Paused" });
  inp.addEventListener("change", function(){ st.className = "state " + (inp.checked ? "on" : "off"); st.textContent = inp.checked ? "On" : "Paused"; fn(inp.checked); changed(); });
  return el("div", { class: "sw" }, [el("div", {}, [el("b", { text: title }), el("small", { text: sub })]), el("div", { class: "row" }, [st, el("span", { class: "tg" }, [inp, el("i")])])]);
}
function num(id, v, fn){ var i = $(id); i.value = v; i.oninput = function(){ fn(Math.round(Number(i.value))); changed(); }; }
function render(){
  var on = $("on"); on.innerHTML = "";
  Object.keys(D.surfaces).forEach(function(k){ var t = D.surfaces[k].split(" (")[0], sub = (D.surfaces[k].match(/\((.*)\)/) || [, ""])[1]; on.appendChild(toggle("on-" + k, S.on[k], t, sub, function(v){ S.on[k] = v; })); });
  var f = D.forge || {};
  $("forge").textContent = f.ok ? (f.version === D.version ? "The AI Forge has these rules (checked " + new Date(f.checked_at || Date.now()).toLocaleString() + ")." : "The AI Forge still has older rules" + (f.version ? " (" + f.version + ")" : "") + ". It gets these when you publish, or on Autopilot's next 10-minute run.") : (f.error || "");
  var st = $("styles"); st.innerHTML = "";
  D.styles.forEach(function(s){
    var c = el("input", { type: "checkbox" }); c.checked = S.styles.allowed.indexOf(s.key) >= 0;
    c.addEventListener("change", function(){ var a = S.styles.allowed.filter(function(x){ return x !== s.key; }); if (c.checked) a.push(s.key); S.styles.allowed = D.styles.map(function(x){ return x.key; }).filter(function(k){ return a.indexOf(k) >= 0; }); if (S.styles.allowed.indexOf(S.styles["default"]) < 0) S.styles["default"] = S.styles.allowed[0] || null; changed(); renderDefault(); });
    st.appendChild(el("label", { class: "ck" }, [c, el("span", {}, [el("b", { text: s.label }), el("br"), el("small", { class: "muted", text: s.prompt })])]));
  });
  renderDefault();
  $("style-lock").checked = S.styles.lock; $("style-lock").onchange = function(){ S.styles.lock = this.checked; changed(); };
  opt($("max-side"), [512, 768, 1024, 1536, 2048, 3072, 4096].map(function(n){ return [n, n + " px" + (n === 2048 ? " (2K)" : n === 4096 ? " (4K)" : "")]; }), S.image.maxSide);
  $("max-side").onchange = function(){ S.image.maxSide = Number(this.value); changed(); };
  num("max-video", S.video.maxSeconds, function(v){ S.video.maxSeconds = v; });
  num("max-music", S.music.maxSeconds, function(v){ S.music.maxSeconds = v; });
  $("approval").checked = S.autonomous.requireApproval; $("approval").onchange = function(){ S.autonomous.requireApproval = this.checked; changed(); };
  $("approvals").innerHTML = ""; if (D.approvals != null) $("approvals").appendChild(el("span", {}, [D.approvals + " idea" + (D.approvals === 1 ? "" : "s") + " waiting for you · ", el("a", { href: "/#/create", text: "Review in Create" })]));
  var fb = $("filters"); fb.innerHTML = "";
  D.filters.forEach(function(x){
    var row = el("tr", {}, [el("td", { text: x.label })]);
    ["visual", "words"].forEach(function(g){ var c = el("input", { type: "checkbox", "aria-label": x.label + (g === "visual" ? " for pictures and video" : " for words, voice and music") }); c.checked = S.filters[g].indexOf(x.key) >= 0;
      c.addEventListener("change", function(){ var a = S.filters[g].filter(function(k){ return k !== x.key; }); if (c.checked) a.push(x.key); S.filters[g] = a; changed(); }); row.appendChild(el("td", {}, [c])); });
    fb.appendChild(row);
  });
  $("terms").value = S.filters.terms.join("\n"); $("terms").oninput = function(){ S.filters.terms = this.value.split(/[\n,]+/).map(function(t){ return t.trim(); }).filter(Boolean); changed(); };
  $("ai-check").checked = S.filters.aiCheck; $("ai-check").onchange = function(){ S.filters.aiCheck = this.checked; changed(); };
  var rb = $("rates"); rb.innerHTML = "";
  Object.keys(S.rate["public"]).forEach(function(k){
    var r = S.rate["public"][k], row = el("tr", {}, [el("td", { text: RATE_NAMES[k] || k })]);
    ["minute", "hour", "day", "all"].forEach(function(w){ var i = el("input", { type: "number", min: "0", max: "1000000", value: r[w], "aria-label": (RATE_NAMES[k] || k) + " " + w }); i.oninput = function(){ r[w] = Math.round(Number(i.value)); changed(); }; row.appendChild(el("td", {}, [i])); });
    rb.appendChild(row);
  });
  var fh = $("forge-head"), fc = $("forge-caps"); fh.innerHTML = ""; fc.innerHTML = "";
  var FK = { image: "Pictures", video: "Videos", music: "Music", tts: "Voice", text: "Writing" };
  Object.keys(S.rate.forgePerDay).forEach(function(k){ fh.appendChild(el("th", { text: FK[k] || k })); var i = el("input", { type: "number", min: "0", max: "100000", value: S.rate.forgePerDay[k], "aria-label": "AI Forge " + (FK[k] || k) + " per day" }); i.oninput = function(){ S.rate.forgePerDay[k] = Math.round(Number(i.value)); changed(); }; fc.appendChild(el("td", {}, [i])); });
  $("keep").checked = S.audit.keepPrompts; $("keep").onchange = function(){ S.audit.keepPrompts = this.checked; changed(); };
  num("days", S.audit.days, function(v){ S.audit.days = v; });
  $("undo").hidden = !D.previous; $("undo").title = D.previous ? "Back to: " + D.previous.summary : "";
  var stats = $("stats"); stats.innerHTML = "";
  var tot = {}; (D.stats || []).forEach(function(r){ tot[r.outcome] = (tot[r.outcome] || 0) + r.n; });
  [["done", "Made"], ["queued", "Renders started"], ["blocked", "Blocked"], ["rate_limited", "Rate limited"], ["failed", "Failed"]].forEach(function(x){ stats.appendChild(el("div", { class: "stat" }, [el("b", { text: String(tot[x[0]] || 0) }), x[1] + " · 24 h"])); });
}
function renderDefault(){ opt($("style-default"), S.styles.allowed.map(function(k){ return [k, D.styles.filter(function(s){ return s.key === k; })[0].label]; }), S.styles["default"]); $("style-default").onchange = function(){ S.styles["default"] = this.value; changed(); }; }
function load(){
  return api("/api/ai-policy").then(function(d){ D = d; S = JSON.parse(JSON.stringify(d.policy)); setDirty(false); render();
    $("now").textContent = d.saved ? "In force: " + d.summary + (d.updated_by ? " · last changed by " + d.updated_by : "") : "Nothing published yet: RB's starting rules are on screen. Publish them to make them yours.";
    say("");
    if (!d.saved) setDirty(true); });
}
function showSync(d){ $("now").textContent = "In force: " + d.summary + (d.updated_by ? " · last changed by " + d.updated_by : ""); var s = d.sync || {}; say(s.ok ? "Published. The public tools and Autopilot use it within 30 seconds; the AI Forge has it now." : "Published. " + (s.error || ""), s.ok ? "ok" : ""); }
$("save").addEventListener("click", function(){ var b = this; b.disabled = true; say("Publishing…"); api("/api/ai-policy", { policy: S }).then(function(d){ D = d; S = JSON.parse(JSON.stringify(d.policy)); dirty = false; render(); showSync(d); loadLog(true); }).catch(function(e){ b.disabled = false; say(e.message, "bad"); }); });
$("undo").addEventListener("click", function(){ if (!confirm("Put back: " + (D.previous ? D.previous.summary : "the last rules") + "?")) return; api("/api/ai-policy/undo", {}).then(function(d){ D = d; S = JSON.parse(JSON.stringify(d.policy)); dirty = false; render(); showSync(d); }).catch(function(e){ say(e.message, "bad"); }); });
$("reset").addEventListener("click", function(){ S = JSON.parse(JSON.stringify(D.defaults)); render(); changed(); say("RB's defaults are on screen. Publish to use them."); });
// try a prompt
opt($("t-surface"), Object.keys(SURF).map(function(k){ return [k, SURF[k]]; }), "public");
opt($("t-kind"), [["image", "Picture"], ["video", "Video"], ["music", "Music"], ["speech", "Voice"], ["text", "Writing"]], "image");
$("t-go").addEventListener("click", function(){
  var res = $("t-res"); res.innerHTML = "";
  api("/api/ai-policy/check", { policy: S, surface: $("t-surface").value, kind: $("t-kind").value, style: $("t-style").value || null, prompt: $("t-prompt").value, autonomous: $("t-surface").value === "autopilot" }).then(function(d){
    var r = d.result;
    res.appendChild(el("div", { class: "res " + (r.ok ? "ok" : "no") }, r.ok ? [el("b", { text: "Allowed" + (d.aiCheck ? ", after the AI check" : "") }), r.notes.length ? el("div", { class: "muted", text: "Adjusted: " + r.notes.join("; ") }) : null, r.prompt ? el("code", { text: r.prompt }) : null]
      : [el("b", { text: "Refused" }), el("div", { text: r.message })]));
  }).catch(function(e){ res.textContent = e.message; });
});
// the log
opt($("l-surface"), [["", "Everywhere"]].concat(Object.keys(SURF).map(function(k){ return [k, SURF[k]]; })), "");
opt($("l-outcome"), [["", "Any outcome"]].concat(Object.keys(OUT).map(function(k){ return [k, OUT[k]]; })), "");
opt($("l-kind"), [["", "Anything"], ["image", "Pictures"], ["video", "Videos"], ["music", "Music"], ["speech", "Voice"], ["text", "Writing"], ["transcription", "Captions"], ["vision", "Reading pictures"]], "");
function loadLog(reset){
  if (reset) { logBefore = null; $("log").innerHTML = ""; }
  var q = new URLSearchParams({ surface: $("l-surface").value, outcome: $("l-outcome").value, kind: $("l-kind").value, q: $("l-q").value });
  if (logBefore) q.set("before", logBefore);
  return api("/api/ai-policy/audit?" + q.toString()).then(function(d){
    var tb = $("log");
    if (reset && !d.rows.length) tb.appendChild(el("tr", {}, [el("td", { colspan: "7", class: "muted", text: "Nothing logged yet for this view." })]));
    d.rows.forEach(function(r){
      var p = r.prompt ? r.prompt : r.prompt_hash ? "(not kept) #" + r.prompt_hash.slice(0, 10) : "—";
      tb.appendChild(el("tr", {}, [
        el("td", { class: "when", text: new Date(r.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) }),
        el("td", { text: SURF[r.surface] || r.surface }), el("td", { text: (r.kind || "") + (r.style ? " · " + r.style : "") }),
        el("td", {}, [el("span", { class: "pill " + r.outcome, text: OUT[r.outcome] || r.outcome }), r.code ? el("div", { class: "muted", text: r.code }) : null, r.notes ? el("div", { class: "muted", text: r.notes }) : null]),
        el("td", { class: "p", title: r.prompt || "" }, [document.createTextNode(p)]), el("td", { class: "muted", text: (r.model || "").replace(/^@cf\//, "") }), el("td", { class: "muted", text: r.who || "" }),
      ]));
      logBefore = r.at;
    });
    $("l-more").hidden = !d.more;
  }).catch(function(e){ say(e.message, "bad"); });
}
["l-surface", "l-outcome", "l-kind"].forEach(function(id){ $(id).addEventListener("change", function(){ loadLog(true); }); });
var qt = null; $("l-q").addEventListener("input", function(){ clearTimeout(qt); qt = setTimeout(function(){ loadLog(true); }, 300); });
$("l-more").addEventListener("click", function(){ loadLog(false); });
window.addEventListener("beforeunload", function(e){ if (dirty && D && D.saved) { e.preventDefault(); e.returnValue = ""; } });
load().then(function(){ opt($("t-style"), [["", "No style"]].concat(D.styles.map(function(s){ return [s.key, s.label]; })), ""); return loadLog(true); }).catch(function(e){ say(e.message, "bad"); });
})();`;
