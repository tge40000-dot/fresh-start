var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// rb-operations-admin.js
var CONTENT_TYPES = /* @__PURE__ */ new Set(["site-settings", "featured-artists", "beats-home-shelf", "active-campaign"]);
var THEME_KEYS = /* @__PURE__ */ new Set(["blackgold", "gold", "emerald", "rose", "crimson", "violet", "copper", "amber", "plum", "merlot", "moss", "sand", "noir"]);
var MAX_BODY_BYTES = 64 * 1024;
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=UTF-8", "Cache-Control": "no-store", ...headers }
  });
}
__name(json, "json");
function contentKey(type, revision = null) {
  return revision ? `v1:public:${type}:revision:${revision}` : `v1:public:${type}:current`;
}
__name(contentKey, "contentKey");
function text(value, maximum) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}
__name(text, "text");
function publicUrl(value) {
  const candidate = text(value, 900);
  if (!candidate) return null;
  if (candidate.startsWith("/") && !candidate.startsWith("//")) return candidate;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}
__name(publicUrl, "publicUrl");
function validatePublicContentPayload(type, raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Content payload must be an object." };
  if (type === "site-settings") {
    const payload = {};
    for (const [key, maximum] of [["hub_headline", 120], ["hub_subheadline", 220]]) {
      if (Object.prototype.hasOwnProperty.call(raw, key)) {
        const value = text(raw[key], maximum);
        if (!value) return { ok: false, error: `${key} must be a non-empty string.` };
        payload[key] = value;
      }
    }
    for (const mediaKey of ["hub_hero_image", "hub_hero_video"]) {
      if (Object.prototype.hasOwnProperty.call(raw, mediaKey)) {
        const value = publicUrl(raw[mediaKey]);
        if (!value) return { ok: false, error: `${mediaKey} must be an HTTPS or site-relative URL.` };
        payload[mediaKey] = value;
      }
    }
    if (Object.prototype.hasOwnProperty.call(raw, "hub_theme")) {
      if (!THEME_KEYS.has(raw.hub_theme)) return { ok: false, error: "hub_theme is not supported." };
      payload.hub_theme = raw.hub_theme;
    }
    return Object.keys(payload).length ? { ok: true, payload } : { ok: false, error: "Provide at least one supported hub setting." };
  }
  if (type === "featured-artists") {
    if (!Array.isArray(raw.items) || raw.items.length < 1 || raw.items.length > 12) return { ok: false, error: "featured-artists requires one to twelve items." };
    const items = [];
    for (const item of raw.items) {
      const handle = text(item?.handle, 63).toLowerCase();
      const name = text(item?.name, 100);
      const href = publicUrl(item?.href || `/${handle}`);
      const image_url = item?.image_url == null ? null : publicUrl(item.image_url);
      if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(handle) || !name || !href || item?.image_url != null && !image_url) return { ok: false, error: "Each featured artist requires a valid handle, name, and safe URL fields." };
      items.push({ handle, name, href, image_url, tagline: text(item?.tagline, 180) || null });
    }
    return { ok: true, payload: { items } };
  }
  if (type === "beats-home-shelf") {
    if (!Array.isArray(raw.items) || raw.items.length < 1 || raw.items.length > 12) return { ok: false, error: "beats-home-shelf requires one to twelve items." };
    const items = [];
    for (const item of raw.items) {
      const title = text(item?.title, 140);
      const href = publicUrl(item?.href);
      const image_url = item?.image_url == null ? null : publicUrl(item.image_url);
      if (!title || !href || item?.image_url != null && !image_url) return { ok: false, error: "Each Beats shelf item requires a title and safe URL fields." };
      items.push({ title, href, image_url, artist_name: text(item?.artist_name, 100) || null, badge: text(item?.badge, 40) || null });
    }
    return { ok: true, payload: { items } };
  }
  if (type === "active-campaign") {
    const headline = text(raw.headline, 140);
    const body = text(raw.body, 480);
    const cta_label = text(raw.cta_label, 60);
    const cta_url = publicUrl(raw.cta_url);
    const image_url = raw.image_url == null ? null : publicUrl(raw.image_url);
    if (!headline || !body || !cta_label || !cta_url || raw.image_url != null && !image_url) return { ok: false, error: "active-campaign requires headline, body, CTA label, and safe URL fields." };
    return { ok: true, payload: { headline, body, cta_label, cta_url, image_url } };
  }
  return { ok: false, error: "Unsupported public content type." };
}
__name(validatePublicContentPayload, "validatePublicContentPayload");
function base64UrlBytes(value) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
__name(base64UrlBytes, "base64UrlBytes");
function decodeJwtPart(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlBytes(value)));
}
__name(decodeJwtPart, "decodeJwtPart");
var accessJwks = { until: 0, keys: [] };
async function getAccessKeys(teamDomain) {
  if (accessJwks.keys.length && Date.now() < accessJwks.until) return accessJwks.keys;
  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error("Access signing keys are unavailable.");
  const body = await response.json();
  if (!Array.isArray(body?.keys) || !body.keys.length) throw new Error("Access signing keys are unavailable.");
  accessJwks = { keys: body.keys, until: Date.now() + 10 * 60 * 1e3 };
  return accessJwks.keys;
}
__name(getAccessKeys, "getAccessKeys");
async function verifyAccess(request, env) {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return { ok: false, status: 401 };
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, status: 401 };
  try {
    const header = decodeJwtPart(parts[0]);
    const claims = decodeJwtPart(parts[1]);
    const now = Math.floor(Date.now() / 1e3);
    const audiences = Array.isArray(claims?.aud) ? claims.aud : [claims?.aud];
    if (header?.alg !== "RS256" || !header?.kid || !claims?.email || !Number.isFinite(claims?.exp) || claims.exp <= now || Number.isFinite(claims?.nbf) && claims.nbf > now) return { ok: false, status: 401 };
    const allowedAudiences = String(env.CF_ACCESS_AUD).split(',').map((value) => value.trim()).filter(Boolean);
    if (claims.iss !== `https://${env.CF_ACCESS_TEAM_DOMAIN}` || !allowedAudiences.some((audience) => audiences.includes(audience)) || String(claims.email).toLowerCase() !== String(env.ADMIN_EMAIL).toLowerCase()) return { ok: false, status: 403 };
    const keys = await getAccessKeys(env.CF_ACCESS_TEAM_DOMAIN);
    const jwk = keys.find((key2) => key2.kid === header.kid && key2.kty === "RSA" && key2.alg === "RS256");
    if (!jwk) return { ok: false, status: 401 };
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const valid = await crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, key, base64UrlBytes(parts[2]), signed);
    return valid ? { ok: true, email: String(claims.email).toLowerCase() } : { ok: false, status: 401 };
  } catch {
    return { ok: false, status: 401 };
  }
}
__name(verifyAccess, "verifyAccess");
async function requireAdmin(request, env) {
  const identity = await verifyAccess(request, env);
  return identity.ok ? identity : null;
}
__name(requireAdmin, "requireAdmin");
async function audit(env, eventType, type, revision, actor) {
  try {
    await env.DB.prepare("INSERT INTO public_content_audit_log (event_type,content_type,revision,actor) VALUES (?,?,?,?)").bind(eventType.slice(0, 80), type, revision, actor.slice(0, 254)).run();
    return { ok: true };
  } catch (error) {
    console.error('audit_failed', eventType, type, revision, error);
    return { ok: false, warning: 'Publish succeeded, but the audit log could not be written.' };
  }
}
__name(audit, "audit");
async function readCurrent(env, type) {
  const stored = await env.PUBLIC_CONTENT_KV.get(contentKey(type), { type: "json" });
  if (!stored || stored.schema_version !== 1 || stored.type !== type || !stored.revision || !stored.payload) return null;
  const validated = validatePublicContentPayload(type, stored.payload);
  return validated.ok ? { revision: String(stored.revision), published_at: String(stored.published_at || ""), payload: validated.payload } : null;
}
__name(readCurrent, "readCurrent");
async function parseBody(request) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > MAX_BODY_BYTES) return { ok: false, status: 413, error: "Payload exceeds the 64 KB limit." };
  try {
    const body = await request.json();
    return { ok: true, body };
  } catch {
    return { ok: false, status: 400, error: "Invalid JSON payload." };
  }
}
__name(parseBody, "parseBody");
function operationsHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>RB Dashboard</title>
  <style>
    :root{color-scheme:dark;--void:#070705;--ink:#f5f0e5;--muted:#ada695;--soft:#767061;--gold:#d5ae52;--gold2:#f0cf7d;--line:rgba(213,174,82,.22);--surface:#12110e;--raised:#1a1812;--green:#7bc895;--red:#ee8084;--shadow:0 22px 70px rgba(0,0,0,.32)}
    *{box-sizing:border-box} body{min-width:320px;margin:0;background:radial-gradient(circle at 86% -5%,rgba(213,174,82,.16),transparent 34rem),var(--void);color:var(--ink);font:15px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif} button,input,select,textarea{font:inherit}button{cursor:pointer}.app{min-height:100vh;display:grid;grid-template-columns:248px minmax(0,1fr)}
    .rail{position:sticky;top:0;height:100vh;display:flex;flex-direction:column;padding:23px 16px 16px;background:linear-gradient(180deg,#10100d,rgba(7,7,5,.98));border-right:1px solid var(--line)}.brand{display:flex;align-items:center;gap:11px;padding:3px 8px 24px}.mark{display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:linear-gradient(145deg,var(--gold2),var(--gold));color:#171107;font:700 1.25rem Georgia,serif}.brand b{display:block;font:500 1.05rem Georgia,serif}.brand span{display:block;margin-top:1px;color:var(--gold);font-size:.61rem;font-weight:800;letter-spacing:.14em;text-transform:uppercase}.rail-label{margin:0 8px 8px;color:var(--soft);font-size:.61rem;font-weight:850;letter-spacing:.15em;text-transform:uppercase}.nav{display:grid;gap:5px}.nav-btn{display:flex;align-items:center;gap:11px;width:100%;padding:11px;border:1px solid transparent;border-radius:11px;background:transparent;color:var(--muted);font-size:.83rem;font-weight:750;text-align:left}.nav-btn:hover{background:rgba(255,255,255,.035);color:var(--ink)}.nav-btn.active{border-color:rgba(213,174,82,.25);background:linear-gradient(90deg,rgba(213,174,82,.18),rgba(213,174,82,.03));color:var(--ink)}.nav-symbol{width:16px;color:var(--gold);text-align:center}.safe{margin-top:auto;padding:15px;border:1px solid var(--line);border-radius:14px;background:rgba(213,174,82,.06)}.safe b{display:flex;align-items:center;gap:7px;color:var(--gold2);font-size:.63rem;letter-spacing:.1em;text-transform:uppercase}.safe p{margin:8px 0 0;color:var(--muted);font-size:.75rem;line-height:1.5}.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 0 4px rgba(123,200,149,.1)}
    main{min-width:0;padding:24px 30px 48px}.top{display:flex;align-items:center;justify-content:space-between;gap:18px;max-width:1280px;margin:0 auto 28px}.crumb{margin:0;color:var(--muted);font-size:.68rem;font-weight:800;letter-spacing:.13em;text-transform:uppercase}.crumb strong{color:var(--gold)}.status{display:inline-flex;align-items:center;gap:8px;padding:8px 11px;border:1px solid var(--line);border-radius:999px;color:var(--muted);background:rgba(0,0,0,.17);font-size:.72rem}.status b{color:var(--ink)}.view{display:none;max-width:1280px;margin:0 auto}.view.active{display:block}.eyebrow{margin:0 0 8px;color:var(--gold);font-size:.65rem;font-weight:850;letter-spacing:.16em;text-transform:uppercase}h1{max-width:760px;margin:0;font:500 clamp(2.3rem,5vw,4.7rem)/.98 Georgia,serif;letter-spacing:-.055em}h1 em{color:var(--gold2);font-weight:400}.lead{max-width:630px;margin:15px 0 28px;color:var(--muted);font-size:.93rem;line-height:1.65}
    .cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.choice{min-height:210px;padding:20px;border:1px solid var(--line);border-radius:17px;background:linear-gradient(145deg,rgba(27,25,19,.92),rgba(13,13,10,.95));color:var(--ink);text-align:left;transition:.2s ease}.choice:hover{border-color:rgba(240,207,125,.6);transform:translateY(-2px);box-shadow:var(--shadow)}.choice .step{color:var(--gold);font-size:.63rem;font-weight:850;letter-spacing:.13em;text-transform:uppercase}.choice h2{margin:30px 0 6px;font:500 1.36rem Georgia,serif}.choice p{margin:0;color:var(--muted);font-size:.77rem;line-height:1.5}.choice .go{display:inline-block;margin-top:20px;color:var(--gold2);font-size:.7rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
    .guide{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-top:28px}.guide-card{padding:18px;border:1px solid rgba(244,240,229,.1);border-radius:15px;background:rgba(255,255,255,.02)}.guide-num{display:grid;place-items:center;width:26px;height:26px;margin-bottom:12px;border:1px solid var(--line);border-radius:8px;color:var(--gold);font:.72rem ui-monospace,monospace}.guide-card b{display:block;font-size:.86rem}.guide-card p{margin:5px 0 0;color:var(--muted);font-size:.76rem;line-height:1.5}
    .editor-layout{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:18px}.panel{border:1px solid var(--line);border-radius:19px;background:rgba(18,17,13,.91);box-shadow:var(--shadow);overflow:hidden}.panel-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;padding:21px 22px 18px;border-bottom:1px solid rgba(213,174,82,.13)}.panel-head h2{margin:0;font:500 1.34rem Georgia,serif}.panel-head p{margin:4px 0 0;color:var(--muted);font-size:.78rem}.badge{padding:5px 8px;border:1px solid rgba(213,174,82,.34);border-radius:999px;color:var(--gold2);font-size:.61rem;font-weight:850;letter-spacing:.1em;text-transform:uppercase;white-space:nowrap}.panel-body{padding:22px}.back{display:inline-flex;align-items:center;gap:7px;margin:0 0 18px;padding:0;border:0;background:transparent;color:var(--gold2);font-size:.74rem;font-weight:800}.back:hover{text-decoration:underline}.selector{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:21px}.selector button{min-height:75px;padding:11px;border:1px solid rgba(244,240,229,.11);border-radius:12px;background:#0d0d0a;color:var(--muted);font-size:.75rem;font-weight:750;text-align:left}.selector button.active{border-color:var(--gold);background:rgba(213,174,82,.1);color:var(--ink)}.selector button span{display:block;margin-top:4px;color:var(--soft);font-size:.65rem;font-weight:600}
    .form-title{margin:0;font:500 1.55rem Georgia,serif}.form-help{margin:6px 0 20px;color:var(--muted);font-size:.8rem;line-height:1.55}.fields{display:grid;gap:16px}.fields.two{grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.fields.three{grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.field label{display:block;margin:0 0 7px;color:var(--muted);font-size:.65rem;font-weight:850;letter-spacing:.12em;text-transform:uppercase}.field label small{float:right;color:var(--soft);font-size:.6rem;font-weight:650;letter-spacing:0;text-transform:none}.field input,.field select,.field textarea{width:100%;border:1px solid rgba(244,240,229,.16);border-radius:10px;outline:0;background:#090907;color:var(--ink);padding:11px 12px}.field textarea{min-height:112px;resize:vertical;line-height:1.5}.field input:focus,.field select:focus,.field textarea:focus{border-color:var(--gold);box-shadow:0 0 0 3px rgba(213,174,82,.1)}.info{margin:18px 0 0;padding:12px 13px;border-left:2px solid var(--gold);border-radius:0 10px 10px 0;background:rgba(213,174,82,.06);color:var(--muted);font-size:.77rem;line-height:1.55}.actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:22px}.btn{min-height:42px;padding:10px 14px;border:1px solid transparent;border-radius:10px;font-size:.77rem;font-weight:850}.primary{background:linear-gradient(135deg,var(--gold2),var(--gold));color:#1a1307;box-shadow:0 9px 22px rgba(213,174,82,.15)}.primary:hover{transform:translateY(-1px)}.quiet{border-color:rgba(244,240,229,.2);background:transparent;color:var(--ink)}.danger{border-color:rgba(238,128,132,.42);background:rgba(238,128,132,.05);color:var(--red)}.btn:disabled{opacity:.55;cursor:wait}.notice{min-height:43px;margin-top:18px;padding:11px 12px;border:1px solid rgba(244,240,229,.1);border-radius:10px;background:rgba(0,0,0,.18);color:var(--muted);font-size:.78rem}.notice.ok{border-color:rgba(123,200,149,.38);color:var(--green)}.notice.error{border-color:rgba(238,128,132,.48);color:var(--red)}.dirty{display:none;margin:8px 0 0;border-color:rgba(240,207,125,.55);color:var(--gold2)}.dirty.visible{display:inline-block}.field-error{margin:6px 0 0;color:var(--red);font-size:.7rem;line-height:1.35}.field input[aria-invalid="true"],.field textarea[aria-invalid="true"],.field select[aria-invalid="true"]{border-color:var(--red)}.item-actions{display:flex;flex-wrap:wrap;gap:7px;justify-content:flex-end}.move{border:1px solid rgba(244,240,229,.18);border-radius:7px;background:transparent;color:var(--muted);padding:4px 7px;font-size:.66rem;font-weight:750}.move:disabled{opacity:.38;cursor:not-allowed}.modal-backdrop{position:fixed;inset:0;z-index:20;display:none;place-items:center;padding:20px;background:rgba(0,0,0,.72)}.modal-backdrop.open{display:grid}.modal{width:min(690px,100%);max-height:calc(100vh - 40px);overflow:auto;padding:24px;border:1px solid var(--line);border-radius:18px;background:#14130f;box-shadow:var(--shadow)}.modal h2{margin:0;font:500 1.6rem Georgia,serif}.modal p{margin:8px 0 0;color:var(--muted);font-size:.82rem;line-height:1.55}.review-list{display:grid;gap:10px;margin-top:18px}.review-row{display:grid;grid-template-columns:150px 1fr 1fr;gap:10px;padding:12px;border:1px solid rgba(244,240,229,.1);border-radius:10px;background:rgba(0,0,0,.14);font-size:.74rem}.review-row b{color:var(--ink)}.review-row span{display:block;color:var(--muted);overflow-wrap:anywhere}.review-row small{display:block;margin-bottom:3px;color:var(--soft);font-size:.58rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase}.review-destination{margin-top:16px!important;padding:11px 12px;border-left:2px solid var(--gold);border-radius:0 9px 9px 0;background:rgba(213,174,82,.06)}
    .list{display:grid;gap:12px}.item{position:relative;padding:17px;border:1px solid rgba(244,240,229,.12);border-radius:14px;background:rgba(0,0,0,.16)}.item-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}.item-head b{font-size:.83rem}.remove{border:0;background:transparent;color:var(--red);font-size:.71rem;font-weight:850}.add{width:100%;padding:12px;border:1px dashed rgba(213,174,82,.5);border-radius:11px;background:rgba(213,174,82,.045);color:var(--gold2);font-size:.76rem;font-weight:850}.add:hover{background:rgba(213,174,82,.1)}.side{display:grid;align-content:start;gap:18px}.side-panel{padding:19px}.side-panel h3{margin:0;font:500 1.18rem Georgia,serif}.side-panel p{margin:7px 0 14px;color:var(--muted);font-size:.77rem;line-height:1.55}.side-list{display:grid;gap:10px;margin:0;padding:0;list-style:none}.side-list li{padding-top:10px;border-top:1px solid rgba(244,240,229,.08);color:var(--muted);font-size:.74rem}.side-list li b{float:right;color:var(--ink);font-weight:750}.restore select{width:100%;min-height:42px;margin-top:12px;padding:9px;border:1px solid rgba(244,240,229,.16);border-radius:10px;background:#090907;color:var(--ink)}.restore .btn{width:100%;margin-top:10px}.restore small{display:block;margin-top:10px;color:var(--soft);font-size:.69rem;line-height:1.45}
    @media(max-width:1050px){.cards{grid-template-columns:repeat(2,minmax(0,1fr))}.editor-layout{grid-template-columns:1fr}.side{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:760px){.app{grid-template-columns:1fr}.rail{position:relative;height:auto;padding:16px;border-right:0;border-bottom:1px solid var(--line)}.brand{padding-bottom:14px}.rail-label,.safe{display:none}.nav{display:flex;overflow:auto}.nav-btn{flex:0 0 auto;width:auto}.nav-symbol{display:none}main{padding:17px 14px 32px}.top{margin-bottom:23px}.status{display:none}.cards,.guide,.side,.fields.two,.fields.three,.selector{grid-template-columns:1fr}.choice{min-height:160px}.choice h2{margin-top:20px}h1{font-size:2.5rem}.panel-head{display:block}.badge{display:inline-block;margin-top:12px}}
  </style>
</head>
<body>
  <div class="app">
    <aside class="rail">
      <div class="brand"><div class="mark">RB</div><div><b>Relentless Billionaire</b><span>Owner Dashboard</span></div></div>
      <p class="rail-label">Your workspace</p>
      <nav class="nav" aria-label="Admin navigation"><button class="nav-btn active" data-view="home"><span class="nav-symbol">◈</span>Home</button><button class="nav-btn" data-view="editor"><span class="nav-symbol">✦</span>Make an update</button></nav>
      <div class="safe"><b><span class="dot"></span> Your changes are protected</b><p>Every update is checked before it goes live. You can restore a previous version at any time.</p></div>
    </aside>
    <main>
      <header class="top"><p class="crumb"><strong>RB</strong> / Simple publishing</p><div class="status"><span class="dot"></span><b>Protected access</b> Owner session verified</div></header>
      <section class="view active" id="view-home">
        <p class="eyebrow">Welcome to your publishing dashboard</p><h1>What would you like to <em>update?</em></h1><p class="lead">Choose one area below. You will fill out simple fields, review your changes, and publish when you are ready. No code is needed.</p>
        <div class="cards">
          <a class="choice" href="https://relentlessbillionaire.com/admin"><span class="step">Advanced controls</span><h2>Pages &amp; media</h2><p>Open the full editor for all artist pages, homepage sections, slider, shop, shows, ads, legal, music, uploads, and ticker controls.</p><span class="go">Open full editor →</span></a><button class="choice" data-choice="site-settings"><span class="step">Website look & message</span><h2>Website settings</h2><p>Change the main headline, supporting message, hero image, and color theme.</p><span class="go">Update website →</span></button>
          <button class="choice" data-choice="featured-artists"><span class="step">Roster spotlight</span><h2>Featured artists</h2><p>Add, edit, remove, and reorder the artists you want visitors to see.</p><span class="go">Manage artists →</span></button>
          <button class="choice" data-choice="beats-home-shelf"><span class="step">Music & offers</span><h2>Featured beats</h2><p>Choose the releases, links, badges, and artist credits shown on the home page.</p><span class="go">Manage beats →</span></button>
          <button class="choice" data-choice="active-campaign"><span class="step">Promotion & action</span><h2>Active campaign</h2><p>Publish a current announcement, campaign message, button text, and destination.</p><span class="go">Create campaign →</span></button>
        </div>
        <div class="guide"><article class="guide-card"><span class="guide-num">1</span><b>Choose what to update</b><p>Start with the part of the public site you want to change.</p></article><article class="guide-card"><span class="guide-num">2</span><b>Fill in the simple form</b><p>Use normal words, links, and labels. The dashboard handles the technical format.</p></article><article class="guide-card"><span class="guide-num">3</span><b>Review and publish</b><p>Your update is checked and saved as a recoverable version before it goes live.</p></article></div>
      </section>
      <section class="view" id="view-editor">
        <button class="back" id="back-home">← Back to all updates</button>
        <div class="editor-layout"><section class="panel"><header class="panel-head"><div><p class="eyebrow" id="page-eyebrow">Make an update</p><h2 id="page-title">Website settings</h2><p id="page-description">Change your website’s main message and visual identity.</p><span class="badge dirty" id="dirty-state">Unsaved changes</span></div><span class="badge" id="live-badge">Not loaded</span></header><div class="panel-body">
          <div class="selector" aria-label="Content area"><button data-type="site-settings" class="active">Website<span>Headline & theme</span></button><button data-type="featured-artists">Artists<span>Roster spotlight</span></button><button data-type="beats-home-shelf">Beats<span>Music shelf</span></button><button data-type="active-campaign">Campaign<span>Promotion & CTA</span></button></div>
          <div id="guided-form"></div><div id="notice" class="notice" role="status" aria-live="polite">Choose an area, then load its current details.</div>
        </div></section>
        <aside class="side"><section class="panel side-panel"><h3>You are in control</h3><p>The dashboard handles the technical details behind the scenes, so you can focus on the message visitors will see.</p><ul class="side-list"><li>Changes checked <b>Before publishing</b></li><li>Current version <b id="version-label">Not loaded</b></li><li>History saved <b>Automatically</b></li></ul></section><section class="panel side-panel restore"><h3>Need to undo a change?</h3><p>Select an earlier version below and restore it. Your current version is still saved in the history.</p><select id="previous"><option value="">Load this area first</option></select><button class="btn danger" id="rollback">Restore selected version</button><small>This only affects the area currently selected above.</small></section></aside>
        </div>
      </section>
    </main>
  </div>
  <div class="modal-backdrop" id="review-modal" role="dialog" aria-modal="true" aria-labelledby="review-title">
    <section class="modal"><p class="eyebrow">Final check</p><h2 id="review-title">Review your public update</h2><p>Compare the current live content with the version that will be published. Nothing changes until you confirm.</p><div id="review-summary" class="review-list"></div><div class="actions"><button class="btn quiet" id="review-cancel" type="button">Keep editing</button><button class="btn primary" id="review-publish" type="button">Publish this update</button></div></section>
  </div>
  <div class="modal-backdrop" id="unsaved-modal" role="dialog" aria-modal="true" aria-labelledby="unsaved-title">
    <section class="modal"><p class="eyebrow">Unsaved changes</p><h2 id="unsaved-title">What would you like to do?</h2><p>Your current edits have not been published. Choose whether to discard them, keep editing, or review the update before publishing.</p><div class="actions"><button class="btn danger" id="unsaved-discard" type="button">Discard changes</button><button class="btn quiet" id="unsaved-keep" type="button">Keep editing</button><button class="btn primary" id="unsaved-review" type="button">Review & publish</button></div></section>
  </div>
  <div class="modal-backdrop" id="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
    <section class="modal"><p class="eyebrow">Please confirm</p><h2 id="confirm-title">Confirm action</h2><p id="confirm-message"></p><div class="actions"><button class="btn quiet" id="confirm-cancel" type="button">Cancel</button><button class="btn danger" id="confirm-accept" type="button">Continue</button></div></section>
  </div>
  <script>
    const $=id=>document.getElementById(id);
    const meta={
      'site-settings':{title:'Website settings',eyebrow:'Website look & message',description:'Edit the message and visual style visitors see when they arrive on the RB home page.',badge:'Website update'},
      'featured-artists':{title:'Featured artists',eyebrow:'Roster spotlight',description:'Choose the artists you want to showcase. Add a name, profile link, and a short public description.',badge:'Artist update'},
      'beats-home-shelf':{title:'Featured beats',eyebrow:'Music & offers',description:'Choose the music and offers that should appear first on the home page.',badge:'Beats update'},
      'active-campaign':{title:'Active campaign',eyebrow:'Promotion & action',description:'Create a clear campaign message and the button visitors should use to take action.',badge:'Campaign update'}
    };
    const defaults={
      'site-settings':{hub_headline:'Relentless Billionaire',hub_subheadline:'Built for the signal.',hub_theme:'blackgold',hub_hero_image:'',hub_hero_video:''},
      'featured-artists':{items:[{handle:'artist-name',name:'Artist Name',href:'/artist-name',tagline:'Short public description'}]},
      'beats-home-shelf':{items:[{title:'Release title',href:'/beats',artist_name:'Artist',badge:'New',image_url:''}]},
      'active-campaign':{headline:'AUGUST 27 — THE RB SIGNAL GOES LIVE',body:'The next move is loading: live culture, new energy, and exclusive moments from Relentless Billionaire. Be early. Stay locked in.',cta_label:'Explore Events',cta_url:'/events',image_url:''}
    };
    const themeOptions=['blackgold','gold','emerald','rose','crimson','violet','copper','amber','plum','merlot','moss','sand','noir'];
    const state={type:'site-settings',content:null,payload:null,baseline:null,dirty:false,pendingNavigation:null,reviewPayload:null};
    function escape(value){const e=document.createElement('div');e.textContent=String(value==null?'':value);return e.innerHTML}
    function formatDate(value){if(!value)return 'Not published';const d=new Date(value);return isNaN(d)?value:d.toLocaleString([],{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})}
    function setNotice(message,kind=''){const el=$('notice');el.textContent=message;el.className='notice '+kind}
    function activateView(view){document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x.id==='view-'+view));document.querySelectorAll('.nav-btn').forEach(x=>x.classList.toggle('active',x.dataset.view===view))}
    function updateDirtyBadge(){const el=$('dirty-state');el.classList.toggle('visible',state.dirty)}
    function setType(type){state.type=type;document.querySelectorAll('.selector button').forEach(x=>x.classList.toggle('active',x.dataset.type===type));document.querySelectorAll('.choice').forEach(x=>x.classList.toggle('active',x.dataset.choice===type));const m=meta[type];$('page-eyebrow').textContent=m.eyebrow;$('page-title').textContent=m.title;$('page-description').textContent=m.description;renderForm();load()}
    async function api(path,options={}){const response=await fetch(path,{headers:{'Content-Type':'application/json',...(options.headers||{})},...options});const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||'Request failed.');return body}
    function rowTitle(label,index,total){return '<div class="item-head"><b>'+escape(label)+' '+(index+1)+'</b><div class="item-actions"><button class="move" type="button" data-move="up" data-index="'+index+'" '+(index===0?'disabled':'')+'>Move up</button><button class="move" type="button" data-move="down" data-index="'+index+'" '+(index===total-1?'disabled':'')+'>Move down</button><button class="remove" type="button" data-remove="'+index+'">Remove</button></div></div>'}
    function renderForm(){const data=state.payload||structuredClone(defaults[state.type]);let html='';if(state.type==='site-settings'){html='<h3 class="form-title">Make your website feel current</h3><p class="form-help">Use clear, short language. This appears in the main experience visitors see first.</p><div class="fields"><div class="field"><label>Main headline <small>Up to 120 characters</small></label><input id="f-headline" value="'+escape(data.hub_headline)+'" placeholder="The main message on your website"></div><div class="field"><label>Supporting message <small>Up to 220 characters</small></label><textarea id="f-subheadline" placeholder="A short explanation of what is happening right now">'+escape(data.hub_subheadline)+'</textarea></div><div class="fields two"><div class="field"><label>Color theme</label><select id="f-theme">'+themeOptions.map(x=>'<option value="'+x+'" '+(data.hub_theme===x?'selected':'')+'>'+escape(x.charAt(0).toUpperCase()+x.slice(1))+'</option>').join('')+'</select></div><div class="field"><label>Hero image link <small>Optional</small></label><input id="f-hero" value="'+escape(data.hub_hero_image||'')+'" placeholder="https://... or /image.jpg"></div><div class="field"><label>Hero video link <small>Optional</small></label><input id="f-hero-video" value="'+escape(data.hub_hero_video||'')+'" placeholder="/media/video/... or https://..."></div></div></div><div class="info">Tip: leave the hero image blank if you only want to update the writing or color theme.</div>'}
      if(state.type==='featured-artists'){const items=data.items||[];html='<h3 class="form-title">Choose who gets the spotlight</h3><p class="form-help">Add up to 12 artists. Use their profile link exactly as it appears on the website.</p><div id="artist-list" class="list">'+items.map((item,i)=>artistCard(item,i)).join('')+'</div><div style="margin-top:12px"><button class="add" id="add-artist" type="button">+ Add another artist</button></div>'}
      if(state.type==='beats-home-shelf'){const items=data.items||[];html='<h3 class="form-title">Feature the right music and offers</h3><p class="form-help">Add up to 12 releases or offers. Keep each title and link clear for visitors.</p><div id="beat-list" class="list">'+items.map((item,i)=>beatCard(item,i)).join('')+'</div><div style="margin-top:12px"><button class="add" id="add-beat" type="button">+ Add another beat or offer</button></div>'}
      if(state.type==='active-campaign'){html='<h3 class="form-title">Create one clear call to action</h3><p class="form-help">Tell visitors what is happening now and where they should go next.</p><div class="fields"><div class="field"><label>Campaign headline <small>Up to 140 characters</small></label><input id="f-campaign-headline" value="'+escape(data.headline)+'" placeholder="What do you want people to notice?"></div><div class="field"><label>Campaign message <small>Up to 480 characters</small></label><textarea id="f-campaign-body" placeholder="Give visitors the essential details and energy behind this campaign.">'+escape(data.body)+'</textarea></div><div class="fields two"><div class="field"><label>Button text <small>Up to 60 characters</small></label><input id="f-cta-label" value="'+escape(data.cta_label)+'" placeholder="Explore now"></div><div class="field"><label>Where the button goes</label><input id="f-cta-url" value="'+escape(data.cta_url)+'" placeholder="/events or https://..."></div></div><div class="field"><label>Campaign image link <small>Optional</small></label><input id="f-campaign-image" value="'+escape(data.image_url||'')+'" placeholder="https://... or /image.jpg"></div></div>'}
      html+='<div class="actions"><button class="btn quiet" id="reload" type="button">Discard changes</button><button class="btn primary" id="publish" type="button">Review & publish changes</button></div>';$('guided-form').innerHTML=html;wireForm()}
    function artistCard(item,i){const total=(state.payload?.items||[]).length;return '<article class="item" data-index="'+i+'">'+rowTitle('Artist',i,total)+'<div class="fields two"><div class="field"><label>Artist name</label><input data-field="name" value="'+escape(item.name)+'" placeholder="Artist name"></div><div class="field"><label>Profile link</label><input data-field="href" value="'+escape(item.href)+'" placeholder="/artist-name"></div></div><div class="field" style="margin-top:14px"><label>Artist image link <small>Optional</small></label><input data-field="image_url" value="'+escape(item.image_url||'')+'" placeholder="https://... or /artist.jpg"></div><div class="field" style="margin-top:14px"><label>Short public description <small>Optional</small></label><textarea data-field="tagline" placeholder="What should visitors know about this artist?">'+escape(item.tagline||'')+'</textarea></div></article>'}
    function beatCard(item,i){const total=(state.payload?.items||[]).length;return '<article class="item" data-index="'+i+'">'+rowTitle('Beat or offer',i,total)+'<div class="fields two"><div class="field"><label>Title</label><input data-field="title" value="'+escape(item.title)+'" placeholder="Release title"></div><div class="field"><label>Link</label><input data-field="href" value="'+escape(item.href)+'" placeholder="/beats"></div></div><div class="fields two" style="margin-top:14px"><div class="field"><label>Artist name <small>Optional</small></label><input data-field="artist_name" value="'+escape(item.artist_name||'')+'" placeholder="Artist"></div><div class="field"><label>Badge <small>Optional</small></label><input data-field="badge" value="'+escape(item.badge||'')+'" placeholder="New"></div></div><div class="field" style="margin-top:14px"><label>Cover image link <small>Optional</small></label><input data-field="image_url" value="'+escape(item.image_url||'')+'" placeholder="https://... or /cover.jpg"></div></article>'}
    function cleanText(value){return String(value||'').trim()}
    function handleFromHref(href,name){const source=cleanText(href).replace(/^https?:\\/\\/[^/]+/,'').replace(/^\\/+|\\/+$/g,'')||cleanText(name);const handle=source.toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'');return handle.length>=2?handle:'artist-profile'}
    function readPayload(){
      if(state.type==='site-settings')return{hub_headline:cleanText($('f-headline')?.value),hub_subheadline:cleanText($('f-subheadline')?.value),hub_theme:$('f-theme')?.value,hub_hero_image:cleanText($('f-hero')?.value)||undefined,hub_hero_video:cleanText($('f-hero-video')?.value)||undefined};
      if(state.type==='active-campaign')return{headline:cleanText($('f-campaign-headline')?.value),body:cleanText($('f-campaign-body')?.value),cta_label:cleanText($('f-cta-label')?.value),cta_url:cleanText($('f-cta-url')?.value),image_url:cleanText($('f-campaign-image')?.value)||undefined};
      if(state.type==='featured-artists')return{items:[...document.querySelectorAll('#artist-list .item')].map(card=>{const get=field=>cleanText(card.querySelector('[data-field="'+field+'"]').value);const href=get('href');const name=get('name');return{handle:handleFromHref(href,name),name,href,image_url:get('image_url')||undefined,tagline:get('tagline')||undefined}})};
      if(state.type==='beats-home-shelf')return{items:[...document.querySelectorAll('#beat-list .item')].map(card=>{const get=field=>cleanText(card.querySelector('[data-field="'+field+'"]').value);return{title:get('title'),href:get('href'),artist_name:get('artist_name')||undefined,badge:get('badge')||undefined,image_url:get('image_url')||undefined}})};
      return{};
    }
    function samePayload(a,b){return JSON.stringify(a||{})===JSON.stringify(b||{})}
    function markDirty(){if(!state.baseline)return;state.dirty=!samePayload(readPayload(),state.baseline);updateDirtyBadge()}
    function wireForm(){
      const remove=index=>{const next=readPayload();next.items.splice(index,1);state.payload=next;renderForm();markDirty()};
      document.querySelectorAll('[data-remove]').forEach(btn=>btn.addEventListener('click',()=>remove(Number(btn.dataset.remove))));
      document.querySelectorAll('[data-move]').forEach(btn=>btn.addEventListener('click',()=>{const index=Number(btn.dataset.index);const destination=btn.dataset.move==='up'?index-1:index+1;const next=readPayload();if(destination<0||destination>=next.items.length)return;const moved=next.items.splice(index,1)[0];next.items.splice(destination,0,moved);state.payload=next;renderForm();markDirty()}));
      const addArtist=$('add-artist');if(addArtist)addArtist.addEventListener('click',()=>{const next=readPayload();if(next.items.length>=12){setNotice('You can feature up to 12 artists at one time.','error');return}next.items.push({handle:'artist-name',name:'',href:'/',image_url:'',tagline:''});state.payload=next;renderForm();markDirty()});
      const addBeat=$('add-beat');if(addBeat)addBeat.addEventListener('click',()=>{const next=readPayload();if(next.items.length>=12){setNotice('You can feature up to 12 beats or offers at one time.','error');return}next.items.push({title:'',href:'/',artist_name:'',badge:'',image_url:''});state.payload=next;renderForm();markDirty()});
      document.querySelectorAll('#guided-form input,#guided-form textarea,#guided-form select').forEach(input=>input.addEventListener('input',markDirty));
      $('reload').addEventListener('click',discardCurrent);$('publish').addEventListener('click',openReview);
    }
    function clearFieldErrors(){document.querySelectorAll('.field-error').forEach(el=>el.remove());document.querySelectorAll('[aria-invalid="true"]').forEach(el=>el.removeAttribute('aria-invalid'))}
    function showFieldError(field,message){if(!field)return;field.setAttribute('aria-invalid','true');const error=document.createElement('p');error.className='field-error';error.textContent=message;field.after(error)}
    function isPublicUrl(value){return /^\\/(?!\\/)/.test(value)||/^https:\\/\\//i.test(value)}
    function validateClientPayload(payload,showErrors=true){
      if(showErrors)clearFieldErrors();const errors=[];const add=(field,message)=>{errors.push(message);if(showErrors)showFieldError(field,message)};const required=(field,message)=>{if(!cleanText(field?.value))add(field,message)};const url=(field,message,optional=false)=>{const value=cleanText(field?.value);if(!value&&optional)return;if(!isPublicUrl(value))add(field,message)};
      if(state.type==='site-settings'){required($('f-headline'),'Enter a main headline before publishing.');required($('f-subheadline'),'Enter a supporting message before publishing.');url($('f-hero'),'Use an HTTPS or site-relative hero image link.',true);url($('f-hero-video'),'Use an HTTPS or site-relative hero video link.',true)}
      if(state.type==='active-campaign'){required($('f-campaign-headline'),'Enter a campaign headline.');required($('f-campaign-body'),'Enter a campaign message.');required($('f-cta-label'),'Enter button text.');required($('f-cta-url'),'Enter the destination for the button.');url($('f-cta-url'),'Use an HTTPS or site-relative button destination.');url($('f-campaign-image'),'Use an HTTPS or site-relative campaign image link.',true)}
      if(state.type==='featured-artists'){const cards=[...document.querySelectorAll('#artist-list .item')];if(!cards.length)errors.push('Add at least one featured artist.');cards.forEach((card,index)=>{const name=card.querySelector('[data-field="name"]');const href=card.querySelector('[data-field="href"]');const image=card.querySelector('[data-field="image_url"]');required(name,'Enter a name for artist '+(index+1)+'.');required(href,'Enter a profile link for artist '+(index+1)+'.');url(href,'Use an HTTPS or site-relative profile link.');url(image,'Use an HTTPS or site-relative artist image link.',true)})}
      if(state.type==='beats-home-shelf'){const cards=[...document.querySelectorAll('#beat-list .item')];if(!cards.length)errors.push('Add at least one beat or offer.');cards.forEach((card,index)=>{const title=card.querySelector('[data-field="title"]');const href=card.querySelector('[data-field="href"]');const image=card.querySelector('[data-field="image_url"]');required(title,'Enter a title for beat or offer '+(index+1)+'.');required(href,'Enter a link for beat or offer '+(index+1)+'.');url(href,'Use an HTTPS or site-relative link.');url(image,'Use an HTTPS or site-relative cover image link.',true)})}
      return errors;
    }
    function reviewRow(label,current,next){return '<div class="review-row"><b>'+escape(label)+'</b><span><small>Current/live</small>'+escape(current||'Not set')+'</span><span><small>Will publish</small>'+escape(next||'Not set')+'</span></div>'}
    function itemList(items,key){return(items||[]).map(item=>cleanText(item[key])||'Untitled').join(', ')||'Not set'}
    function reviewSummary(before,after){let rows='';if(state.type==='site-settings'){rows+=reviewRow('Main headline',before.hub_headline,after.hub_headline);rows+=reviewRow('Supporting message',before.hub_subheadline,after.hub_subheadline);rows+=reviewRow('Color theme',before.hub_theme,after.hub_theme);rows+=reviewRow('Hero image',before.hub_hero_image,after.hub_hero_image);rows+=reviewRow('Hero video',before.hub_hero_video,after.hub_hero_video)}if(state.type==='active-campaign'){rows+=reviewRow('Campaign headline',before.headline,after.headline);rows+=reviewRow('Campaign message',before.body,after.body);rows+=reviewRow('Button text',before.cta_label,after.cta_label);rows+=reviewRow('Button destination',before.cta_url,after.cta_url);rows+=reviewRow('Campaign image',before.image_url,after.image_url)}if(state.type==='featured-artists'){rows+=reviewRow('Featured artists',itemList(before.items,'name'),itemList(after.items,'name'));rows+=reviewRow('Display order',''+(before.items||[]).length+' artists',''+(after.items||[]).length+' artists')}if(state.type==='beats-home-shelf'){rows+=reviewRow('Featured beats & offers',itemList(before.items,'title'),itemList(after.items,'title'));rows+=reviewRow('Display order',''+(before.items||[]).length+' items',''+(after.items||[]).length+' items')}const destination=state.type==='active-campaign'?(after.cta_url||'Campaign destination'):state.type==='site-settings'?'relentlessbillionaire.com home page':state.type==='featured-artists'?'relentlessbillionaire.com featured artists section':'relentlessbillionaire.com featured beats section';return rows+'<p class="review-destination"><b>Public destination:</b> '+escape(destination)+'</p>'}
    function openReview(){const payload=readPayload();const errors=validateClientPayload(payload,true);if(errors.length){setNotice(errors[0]+' Review the highlighted fields, then try again.','error');return}state.reviewPayload=payload;$('review-summary').innerHTML=reviewSummary(state.baseline||{},payload);$('review-modal').classList.add('open');$('review-publish').focus()}
    function closeReview(){$('review-modal').classList.remove('open');state.reviewPayload=null}
    function showUnsaved(action){state.pendingNavigation=action;$('unsaved-modal').classList.add('open');$('unsaved-keep').focus()}
    function closeUnsaved(){$('unsaved-modal').classList.remove('open')}
    function requestNavigation(action){if(state.dirty){showUnsaved(action);return}action()}
    function discardAndContinue(){state.payload=structuredClone(state.baseline||defaults[state.type]);state.dirty=false;updateDirtyBadge();renderForm();const action=state.pendingNavigation;state.pendingNavigation=null;closeUnsaved();if(action)action()}
    function discardCurrent(){if(!state.dirty){setNotice('There are no unsaved changes to discard.','ok');return}askConfirmation('Discard unsaved changes?','This will restore the last loaded version for this area.','Discard changes',()=>{state.payload=structuredClone(state.baseline||defaults[state.type]);state.dirty=false;updateDirtyBadge();renderForm();setNotice('Your unpublished draft changes were discarded.','ok')})}
    let confirmAction=null;
    function askConfirmation(title,message,label,action){confirmAction=action;$('confirm-title').textContent=title;$('confirm-message').textContent=message;$('confirm-accept').textContent=label;$('confirm-modal').classList.add('open');$('confirm-accept').focus()}
    function closeConfirmation(){$('confirm-modal').classList.remove('open');confirmAction=null}
    async function history(current){const data=await api('/api/content/revisions?type='+encodeURIComponent(state.type));const rows=(data.revisions||[]).filter(x=>x.revision!==current);$('previous').innerHTML='<option value="">'+(rows.length?'Choose a version to restore':'No earlier versions available')+'</option>'+rows.map(x=>'<option value="'+escape(x.revision)+'">'+escape(formatDate(x.published_at))+'</option>').join('')}
    async function load(){setNotice('Loading the current '+meta[state.type].title.toLowerCase()+'…');$('live-badge').textContent='Loading';try{const data=await api('/api/content?type='+encodeURIComponent(state.type));state.content=data.content||null;state.payload=structuredClone(data.content?.payload||defaults[state.type]);state.baseline=structuredClone(state.payload);state.dirty=false;updateDirtyBadge();renderForm();await history(data.content?.revision||'');$('live-badge').textContent=data.content?'Live now':'New draft';$('version-label').textContent=data.content?formatDate(data.content.published_at):'Not published';setNotice(data.content?'You are viewing the current live version. Edit the fields below, review the change summary, then publish when ready.':'Nothing is published here yet. Fill in the form, review it, and publish when you are ready.','ok')}catch(error){$('live-badge').textContent='Unavailable';setNotice(error.message,'error')}}
    async function performPublish(){const payload=state.reviewPayload||readPayload();closeReview();$('publish').disabled=true;setNotice('Checking and publishing your changes…');try{const data=await api('/api/content/publish',{method:'POST',body:JSON.stringify({type:state.type,payload})});state.content={revision:data.revision,published_at:data.published_at,payload};state.payload=structuredClone(payload);state.baseline=structuredClone(payload);state.dirty=false;updateDirtyBadge();await history(data.revision);$('live-badge').textContent='Live now';$('version-label').textContent=formatDate(data.published_at);setNotice('Success — your update is live and a restorable version was saved.','ok');const action=state.pendingNavigation;state.pendingNavigation=null;if(action)action()}catch(error){setNotice(error.message,'error')}finally{$('publish').disabled=false}}
    function rollback(){const revision=$('previous').value;if(!revision){setNotice('Choose an earlier version before restoring it.','error');return}askConfirmation('Restore this earlier version?','The selected version will become live. The current version will remain safely stored in the history.','Restore version',()=>performRollback(revision))}
    async function performRollback(revision){$('rollback').disabled=true;setNotice('Restoring the earlier version…');try{await api('/api/content/rollback',{method:'POST',body:JSON.stringify({type:state.type,revision})});await load();setNotice('The earlier version is now live.','ok')}catch(error){setNotice(error.message,'error')}finally{$('rollback').disabled=false}}
    document.querySelectorAll('.choice').forEach(x=>x.addEventListener('click',()=>requestNavigation(()=>{activateView('editor');setType(x.dataset.choice)})));
    document.querySelectorAll('.selector button').forEach(x=>x.addEventListener('click',()=>requestNavigation(()=>setType(x.dataset.type))));
    document.querySelectorAll('.nav-btn').forEach(x=>x.addEventListener('click',()=>requestNavigation(()=>activateView(x.dataset.view))));
    $('back-home').addEventListener('click',()=>requestNavigation(()=>activateView('home')));$('rollback').addEventListener('click',rollback);
    $('review-cancel').addEventListener('click',closeReview);$('review-publish').addEventListener('click',performPublish);
    $('unsaved-keep').addEventListener('click',()=>{closeUnsaved();state.pendingNavigation=null});$('unsaved-discard').addEventListener('click',discardAndContinue);$('unsaved-review').addEventListener('click',()=>{closeUnsaved();openReview()});
    $('confirm-cancel').addEventListener('click',closeConfirmation);$('confirm-accept').addEventListener('click',()=>{const action=confirmAction;closeConfirmation();if(action)action()});
    window.addEventListener('beforeunload',event=>{if(state.dirty){event.preventDefault();event.returnValue=''}});
    setType('site-settings');
  </script>
</body>
</html>`;
}


__name(operationsHtml, "operationsHtml");
var rb_operations_admin_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/healthz" && request.method === "GET") return json({ ok: true, service: 'rb-operations-admin', bindings: { kv: Boolean(env.PUBLIC_CONTENT_KV), db: Boolean(env.DB), access_team_domain: Boolean(env.CF_ACCESS_TEAM_DOMAIN), access_aud: Boolean(env.CF_ACCESS_AUD), admin_email: Boolean(env.ADMIN_EMAIL) } });
    if (!env.PUBLIC_CONTENT_KV || !env.DB || !env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD || !env.ADMIN_EMAIL) return json({ ok: false, error: "Operations service is not configured." }, 503);
    const identity = await requireAdmin(request, env);
    if (!identity) {
      if (request.headers.get('Accept')?.includes('text/html')) {
        const login = `https://${env.CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/login?returnTo=${encodeURIComponent(request.url)}`;
        return new Response(null, { status: 302, headers: { Location: login, 'Cache-Control': 'no-store' } });
      }
      return json({ ok: false, error: "Owner authorization is required." }, 401);
    }
    if (path === "/" || path === "/index.html") return new Response(operationsHtml(), { headers: { "Content-Type": "text/html; charset=UTF-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' https: data:; base-uri 'none'; frame-ancestors 'none'" } });
    if (path === "/api/content" && request.method === "GET") {
      const type = String(url.searchParams.get("type") || "");
      if (!CONTENT_TYPES.has(type)) return json({ ok: false, error: "A supported content type is required." }, 400);
      return json({ ok: true, type, content: await readCurrent(env, type) });
    }
    if (path === "/api/content/revisions" && request.method === "GET") {
      const type = String(url.searchParams.get("type") || "");
      if (!CONTENT_TYPES.has(type)) return json({ ok: false, error: "A supported content type is required." }, 400);
      const listed = await env.PUBLIC_CONTENT_KV.list({ prefix: `v1:public:${type}:revision:`, limit: 100 });
      const revisions = (await Promise.all((listed.keys || []).map(async (key) => {
        const stored = await env.PUBLIC_CONTENT_KV.get(key.name, { type: "json" });
        if (!stored || stored.schema_version !== 1 || stored.type !== type || !/^[0-9a-f-]{36}$/i.test(String(stored.revision || ""))) return null;
        return { revision: String(stored.revision), published_at: String(stored.published_at || "") };
      }))).filter(Boolean).sort((a, b) => b.published_at.localeCompare(a.published_at));
      return json({ ok: true, type, revisions });
    }
    if (path === "/api/content/publish" && request.method === "POST") {
      const parsed = await parseBody(request);
      if (!parsed.ok) return json({ ok: false, error: parsed.error }, parsed.status);
      const type = String(parsed.body?.type || "");
      if (!CONTENT_TYPES.has(type)) return json({ ok: false, error: "Unsupported public content type." }, 400);
      const validated = validatePublicContentPayload(type, parsed.body?.payload);
      if (!validated.ok) return json({ ok: false, error: validated.error }, 400);
      const revision = crypto.randomUUID();
      const published_at = (/* @__PURE__ */ new Date()).toISOString();
      const document = { schema_version: 1, type, revision, published_at, payload: validated.payload };
      await env.PUBLIC_CONTENT_KV.put(contentKey(type, revision), JSON.stringify(document));
      await env.PUBLIC_CONTENT_KV.put(contentKey(type), JSON.stringify(document));
      const auditResult = await audit(env, "public-content.published", type, revision, identity.email);
      return json({ ok: true, type, revision, published_at, ...(auditResult.warning ? { warning: auditResult.warning } : {}) });
    }
    if (path === "/api/content/rollback" && request.method === "POST") {
      const parsed = await parseBody(request);
      if (!parsed.ok) return json({ ok: false, error: parsed.error }, parsed.status);
      const type = String(parsed.body?.type || "");
      const revision = String(parsed.body?.revision || "");
      if (!CONTENT_TYPES.has(type) || !/^[0-9a-f-]{36}$/i.test(revision)) return json({ ok: false, error: "A supported content type and revision are required." }, 400);
      const prior = await env.PUBLIC_CONTENT_KV.get(contentKey(type, revision), { type: "json" });
      if (!prior || prior.schema_version !== 1 || prior.type !== type) return json({ ok: false, error: "That content revision was not found." }, 404);
      const validated = validatePublicContentPayload(type, prior.payload);
      if (!validated.ok) return json({ ok: false, error: "That stored revision is no longer valid." }, 409);
      const newRevision = crypto.randomUUID();
      const published_at = (/* @__PURE__ */ new Date()).toISOString();
      const document = { ...prior, revision: newRevision, published_at, payload: validated.payload };
      await env.PUBLIC_CONTENT_KV.put(contentKey(type, newRevision), JSON.stringify(document));
      await env.PUBLIC_CONTENT_KV.put(contentKey(type), JSON.stringify(document));
      const auditResult = await audit(env, "public-content.rolled-back", type, newRevision, identity.email);
      return json({ ok: true, type, revision: newRevision, restored_revision: revision, published_at, ...(auditResult.warning ? { warning: auditResult.warning } : {}) });
    }
    return json({ ok: false, error: "Not found." }, 404);
  }
};
export {
  rb_operations_admin_default as default,
  validatePublicContentPayload
};
