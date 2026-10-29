// ---------------------------------------------------------------- RB AI policy (RB Command > AI limits, 29 Oct 2026)
// One set of rules for every generative call RB makes: the public AI tools (relentless-billionaire-api: RB Create's
// Film and Voice, the studio's AI helpers), the AI Forge (rb-studio, RB account) and Autopilot's agents (rb-autopilot).
// The owner sets it in RB Command; it lives in waitlist-db (site_settings "ai_policy"). The AI Forge, in the other
// Cloudflare account, gets a copy through Autopilot. Every call is checked here first and written to the audit log.
// The same file is copied into every one of those Workers (rb-tools/patch_ai_*.py), so they can't disagree.
//
// Pure functions only (no bindings), except loadPolicy / writeAudit, which take a D1 database.

export const POLICY_KEY = "ai_policy";
export const SURFACES = { public: "Public AI tools (RB Create, studio helpers)", forge: "AI Forge (operator and Autopilot renders)", autopilot: "Autopilot agents (drafts, ideas)" };
export const KINDS = ["image", "video", "music", "speech", "text", "vision", "transcription", "safety", "embeddings"];
const PAUSED = { public: "RB's AI tools are paused by the operator for now.", forge: "The AI Forge is paused by the operator.", autopilot: "Autopilot AI is paused by the operator." };
const VISUAL = new Set(["image", "video"]);
const WORDS = new Set(["text", "speech", "music"]);

/** The four style locks. Each adds its look to a picture or video prompt. */
export const STYLES = {
  "dark-luxury": { label: "Dark Luxury", prompt: "dark luxury editorial look: deep black backgrounds, champagne gold highlights, controlled crimson accents, rich shadows, soft film grain, premium magazine lighting" },
  "cinematic-night": { label: "Cinematic Night", prompt: "cinematic night look: anamorphic widescreen framing, city lights and soft bokeh, teal and amber night grade, light haze, shallow depth of field" },
  "hip-hop-editorial": { label: "Hip-Hop Editorial", prompt: "hip-hop editorial look: bold direct flash, high contrast, street-level camera angle, gritty texture, confident poses, album-cover framing" },
  photoreal: { label: "Photoreal", prompt: "photoreal: natural light, true-to-life skin and materials, 50mm lens, sharp focus, no illustration or painterly effects" },
};

// Content filters. Word lists catch the plain cases; the optional AI check (Llama Guard on Workers AI) backs them up
// on public picture and video prompts. Lists are lower-case; matching ignores case and simple letter swaps (0→o, 3→e…).
export const FILTERS = {
  explicit: { label: "Sexual or nude content", re: /\b(nude|nudes|nudity|naked|topless|bottomless|nsfw|porn\w*|xxx|sex scene|sex act|sexual(ly)?|intercourse|genitals?|penis|vagina|nipples?|erotic\w*|hentai|fetish\w*|onlyfans|stripper|striptease)\b/ },
  minors: { label: "Children and teenagers", re: /\b(child|children|kid|kids|kiddie|minor|minors|underage|under-age|teen|teens|teenager\w*|teenage|preteen\w*|pre-teen\w*|tween\w*|schoolgirl\w*|schoolboy\w*|toddler\w*|infant\w*|little (girl|boy)s?|young (girl|boy)s?|loli\w*|shota\w*)\b/ },
  "graphic-violence": { label: "Gore and graphic violence", re: /\b(gore|gory|dismember\w*|decapitat\w*|behead\w*|mutilat\w*|disembowel\w*|tortur\w*|severed (head|limb|arm|leg|hand)s?|blood ?bath|massacre\w*|corpses?|dead bod(y|ies)|mass shooting|school shooting)\b/ },
  hate: { label: "Hate symbols and slogans", re: /\b(nazis?|neo-?nazi\w*|swastikas?|kkk|ku klux\w*|white power|white supremac\w*|heil hitler|ethnic cleansing|sieg heil)\b/ },
  "self-harm": { label: "Suicide and self-harm", re: /\b(suicid\w*|self[- ]?harm\w*|kill(ing)? (my|your|him|her|them)sel(f|ves)|slit(ting)? (my|his|her|their) wrists?|cutting myself|hang(ing)? (my|him|her)self)\b/ },
};
// Never allowed, whatever the policy says: sexual content together with any sign of a minor.
const SEXUAL_ANY = /\b(sex\w*|nude\w*|nudity|naked|topless|porn\w*|erotic\w*|lingerie|bikini|seductive|sensual|kiss(ing)?|intimate|undress\w*|fetish\w*)\b/;
const AGE_UNDER_18 = /\b(1[0-7]|[1-9])[- ]?(yo|y\/o|yrs? old|years? old|year-old)\b/;

const RATE_DEFAULTS = {
  image: { minute: 6, hour: 40, day: 120, all: 3000 },
  speech: { minute: 20, hour: 200, day: 600, all: 20000 },
  transcription: { minute: 6, hour: 60, day: 200, all: 5000 },
  text: { minute: 20, hour: 200, day: 600, all: 20000 },
  vision: { minute: 10, hour: 100, day: 300, all: 5000 },
  safety: { minute: 30, hour: 300, day: 1000, all: 30000 },
  embeddings: { minute: 30, hour: 300, day: 1000, all: 30000 },
  studio: { minute: 6, hour: 60, day: 200, all: 5000 },
};
const FORGE_KINDS = ["image", "video", "music", "tts", "text"];

/** The policy RB starts with: today's limits, the spec's caps, every filter on for pictures and video. */
export const DEFAULT_POLICY = Object.freeze({
  on: { public: true, forge: true, autopilot: true },
  styles: { allowed: Object.keys(STYLES), default: "dark-luxury", lock: false },
  image: { maxSide: 2048 },
  video: { maxSeconds: 20 },
  music: { maxSeconds: 600 },
  filters: { visual: Object.keys(FILTERS), words: ["hate"], terms: [], aiCheck: true },
  rate: { public: RATE_DEFAULTS, forgePerDay: Object.fromEntries(FORGE_KINDS.map((k) => [k, 0])) },
  autonomous: { requireApproval: true },
  audit: { keepPrompts: true, days: 90 },
});

const clone = (x) => JSON.parse(JSON.stringify(x));
const isObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const int = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };

/** A clean, complete policy from whatever is stored: anything unknown or out of range takes the default. Never throws. */
export function cleanPolicy(raw) {
  let r = raw;
  if (typeof r === "string") { try { r = JSON.parse(r); } catch { r = null; } }
  const p = clone(DEFAULT_POLICY);
  if (!isObj(r)) return p;
  if (isObj(r.on)) for (const k of Object.keys(SURFACES)) if (typeof r.on[k] === "boolean") p.on[k] = r.on[k];
  if (isObj(r.styles)) {
    if (Array.isArray(r.styles.allowed)) p.styles.allowed = Object.keys(STYLES).filter((k) => r.styles.allowed.includes(k));
    if (STYLES[r.styles.default] && p.styles.allowed.includes(r.styles.default)) p.styles.default = r.styles.default;
    else p.styles.default = p.styles.allowed[0] || null;
    if (typeof r.styles.lock === "boolean") p.styles.lock = r.styles.lock;
  }
  if (isObj(r.image) && int(r.image.maxSide, 256, 4096)) p.image.maxSide = int(r.image.maxSide, 256, 4096);
  if (isObj(r.video) && int(r.video.maxSeconds, 2, 60)) p.video.maxSeconds = int(r.video.maxSeconds, 2, 60);
  if (isObj(r.music) && int(r.music.maxSeconds, 10, 600)) p.music.maxSeconds = int(r.music.maxSeconds, 10, 600);
  if (isObj(r.filters)) {
    for (const g of ["visual", "words"]) if (Array.isArray(r.filters[g])) p.filters[g] = Object.keys(FILTERS).filter((k) => r.filters[g].includes(k));
    if (Array.isArray(r.filters.terms)) p.filters.terms = cleanTerms(r.filters.terms);
    if (typeof r.filters.aiCheck === "boolean") p.filters.aiCheck = r.filters.aiCheck;
  }
  if (isObj(r.rate)) {
    if (isObj(r.rate.public)) for (const [f, d] of Object.entries(RATE_DEFAULTS)) {
      const x = r.rate.public[f];
      if (!isObj(x)) continue;
      const o = {};
      for (const w of ["minute", "hour", "day", "all"]) o[w] = int(x[w], 0, 1e6) ?? d[w];
      p.rate.public[f] = o;
    }
    if (isObj(r.rate.forgePerDay)) for (const k of FORGE_KINDS) { const n = int(r.rate.forgePerDay[k], 0, 100000); if (n !== null) p.rate.forgePerDay[k] = n; }
  }
  if (isObj(r.autonomous) && typeof r.autonomous.requireApproval === "boolean") p.autonomous.requireApproval = r.autonomous.requireApproval;
  if (isObj(r.audit)) {
    if (typeof r.audit.keepPrompts === "boolean") p.audit.keepPrompts = r.audit.keepPrompts;
    if (int(r.audit.days, 7, 365)) p.audit.days = int(r.audit.days, 7, 365);
  }
  return p;
}

function cleanTerms(list) {
  const out = [];
  for (const t of list) {
    const s = String(t || "").toLowerCase().replace(/[<>"`]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (s.length >= 2 && !out.includes(s)) out.push(s);
    if (out.length >= 200) break;
  }
  return out;
}

/** Strict check for a save from RB Command: {ok, policy} or {ok:false, error}. */
export function validatePolicy(body) {
  const b = isObj(body) && isObj(body.policy) ? body.policy : body;
  if (!isObj(b)) return { ok: false, error: "Send a policy." };
  const p = cleanPolicy(b);
  const err = (m) => ({ ok: false, error: m });
  if (isObj(b.styles) && Array.isArray(b.styles.allowed) && b.styles.allowed.some((k) => !STYLES[k])) return err("One of the styles isn't one of the four style locks.");
  if (p.styles.lock && !p.styles.allowed.length) return err("To apply a style to every prompt, allow at least one style.");
  if (isObj(b.styles) && b.styles.default && b.styles.default !== p.styles.default) return err("The default style must be one of the allowed styles.");
  if (isObj(b.image) && b.image.maxSide !== undefined && p.image.maxSide !== int(b.image.maxSide, 256, 4096)) return err("Largest picture side: 256 to 4096 pixels.");
  if (isObj(b.video) && b.video.maxSeconds !== undefined && p.video.maxSeconds !== int(b.video.maxSeconds, 2, 60)) return err("Longest video: 2 to 60 seconds.");
  if (isObj(b.music) && b.music.maxSeconds !== undefined && p.music.maxSeconds !== int(b.music.maxSeconds, 10, 600)) return err("Longest music render: 10 to 600 seconds.");
  for (const [f, x] of Object.entries(p.rate.public)) {
    const raw = isObj(b.rate) && isObj(b.rate.public) ? b.rate.public[f] : null;
    if (isObj(raw)) for (const w of ["minute", "hour", "day", "all"]) if (raw[w] !== undefined && int(raw[w], 0, 1e6) === null) return err(`${f}: limits are whole numbers from 0 to 1,000,000.`);
    if (x.minute > x.hour || x.hour > x.day) return err(`${f}: the per-minute limit can't be above the hourly one, or the hourly above the daily one.`);
  }
  if (isObj(b.filters) && Array.isArray(b.filters.terms) && b.filters.terms.length > 200) return err("Up to 200 blocked words.");
  return { ok: true, policy: p };
}

/** A short fingerprint of a policy, so a copy elsewhere can tell it's out of date. */
export function policyVersion(policy) {
  const s = JSON.stringify(cleanPolicy(policy));
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

const SWAP = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", "@": "a", $: "s" };
function norm(text) {
  const t = String(text || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return [t, t.replace(/[013457@$]/g, (c) => SWAP[c])];
}
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Which filters a prompt trips: ["minors", ...]; "never" means the hard floor (sexual + minor). */
export function filterHits(policy, kind, text) {
  const p = cleanPolicy(policy);
  const [a, b] = norm(text);
  const has = (re) => re.test(a) || re.test(b);
  const hits = [];
  if ((has(FILTERS.minors.re) || has(AGE_UNDER_18)) && (has(SEXUAL_ANY) || has(FILTERS.explicit.re))) hits.push("never");
  const cats = VISUAL.has(kind) ? p.filters.visual : WORDS.has(kind) ? p.filters.words : [];
  for (const c of cats) if (has(FILTERS[c].re)) hits.push(c);
  for (const t of p.filters.terms) { const re = new RegExp(`(^|[^a-z0-9])${escRe(t)}($|[^a-z0-9])`); if (re.test(a) || re.test(b)) { hits.push("term:" + t); break; } }
  return hits;
}

/**
 * Check one generative request. req: {surface, kind, prompt, style, width, height, imageSize, seconds, autonomous, approved}.
 * Returns {ok:true, prompt, style, width, height, imageSize, seconds, notes[]} (prompt with the style added, sizes
 * brought inside the caps) or {ok:false, code, message}. The AI check isn't run here (it needs Workers AI): callers
 * with AI ask needsAiCheck() and run it themselves.
 */
export function evaluate(policy, req) {
  const p = cleanPolicy(policy);
  const r = req || {};
  const no = (code, message) => ({ ok: false, code, message });
  const surface = SURFACES[r.surface] ? r.surface : "public";
  if (!p.on[surface]) return no("paused", PAUSED[surface]);
  if (r.autonomous && !p.on.autopilot) return no("paused", PAUSED.autopilot);
  if (r.autonomous && p.autonomous.requireApproval && !r.approved) return no("approval_required", "The operator requires approval before Autopilot can generate. Approve it in RB Command first.");
  const kind = KINDS.includes(r.kind) ? r.kind : "text";
  const out = { ok: true, prompt: r.prompt == null ? r.prompt : String(r.prompt), style: null, notes: [] };
  // style lock
  let style = r.style ? String(r.style) : null;
  if (style && !STYLES[style]) return no("style_unknown", "That style isn't one of RB's style locks.");
  if (style && !p.styles.allowed.includes(style)) return no("style_not_allowed", `The ${STYLES[style].label} style is switched off by the operator.`);
  if (!style && VISUAL.has(kind) && p.styles.lock && p.styles.default) { style = p.styles.default; out.notes.push("default style"); }
  if (style && VISUAL.has(kind)) { out.style = style; if (out.prompt) out.prompt = `${out.prompt.replace(/[\s.,;]+$/, "")}. ${STYLES[style].prompt}`; }
  // content filters (on the words the person wrote, not the style text)
  if (r.prompt) {
    const hits = filterHits(p, kind, r.prompt);
    if (hits.includes("never")) return no("blocked", "That prompt can't be made on RB.");
    if (hits.length) {
      const h = hits[0];
      return no("blocked", h.startsWith("term:") ? "That prompt uses a word the operator has blocked." : `That prompt is blocked by the operator's ${FILTERS[h].label.toLowerCase()} filter.`);
    }
  }
  // size caps: shrink to fit, never refuse
  if (kind === "image") {
    const m = p.image.maxSide, w = Number(r.width) || 0, h = Number(r.height) || 0;
    if (w > 0 && h > 0) {
      const k = Math.min(1, m / Math.max(w, h));
      out.width = Math.max(256, Math.floor((w * k) / 8) * 8); out.height = Math.max(256, Math.floor((h * k) / 8) * 8);
      if (k < 1) out.notes.push(`size ${w}×${h} → ${out.width}×${out.height}`);
    }
    if (r.imageSize) {
      const want = String(r.imageSize).toUpperCase(), sizes = [["4K", 4096], ["2K", 2048], ["1K", 1024]];
      const fit = sizes.find(([, px]) => px <= m) || sizes[2];
      const asked = sizes.find(([s]) => s === want) || sizes[1];
      out.imageSize = asked[1] <= m ? asked[0] : fit[0];
      if (out.imageSize !== asked[0]) out.notes.push(`size ${asked[0]} → ${out.imageSize}`);
    }
  }
  const cap = kind === "video" ? p.video.maxSeconds : kind === "music" ? p.music.maxSeconds : null;
  if (cap && Number(r.seconds) > cap) { out.seconds = cap; out.notes.push(`length ${Number(r.seconds)}s → ${cap}s`); }
  else if (r.seconds != null) out.seconds = Number(r.seconds);
  return out;
}

/** Whether the AI check should run for this request (public picture and video prompts, when switched on). */
export const needsAiCheck = (policy, surface, kind) => cleanPolicy(policy).filters.aiCheck && surface === "public" && VISUAL.has(kind);

/** Llama Guard's answer ("safe" / "unsafe\nS1") → blocked or not. Anything unreadable counts as safe (and is noted). */
export function aiCheckSays(out) {
  const t = String((out && (out.response ?? out.result?.response)) ?? out ?? "").trim().toLowerCase();
  return { unsafe: /^unsafe\b/.test(t), readable: /^(safe|unsafe)\b/.test(t), categories: (t.match(/\bs\d{1,2}\b/g) || []).join(",") };
}

// ---------------------------------------------------------------- audit log
export const AUDIT_TABLE = "CREATE TABLE IF NOT EXISTS ai_audit (id TEXT PRIMARY KEY, at TEXT NOT NULL, surface TEXT NOT NULL, kind TEXT, model TEXT, style TEXT, outcome TEXT NOT NULL, code TEXT, notes TEXT, prompt_hash TEXT, prompt TEXT, who TEXT, ref TEXT, ms INTEGER)";
export const AUDIT_INDEX = "CREATE INDEX IF NOT EXISTS ai_audit_at ON ai_audit (at)";
const AUDIT_COLS = ["id", "at", "surface", "kind", "model", "style", "outcome", "code", "notes", "prompt_hash", "prompt", "who", "ref", "ms"];
export const OUTCOMES = ["done", "queued", "blocked", "rate_limited", "failed"];

export async function sha(text, bytes = 12) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text))));
  return Array.from(d.slice(0, bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
/** A visitor as a short hash of their IP (the IP itself is never stored). */
export const visitorId = async (request) => "visitor:" + (await sha("rb-ai-audit:" + (request.headers.get("CF-Connecting-IP") || "unknown"), 6));

/** One clean audit row. The prompt is kept (first 300 characters) only when the policy says so; its hash always. */
export async function auditRow(policy, e) {
  const p = cleanPolicy(policy);
  const text = e.prompt == null ? "" : String(e.prompt);
  return {
    id: e.id || crypto.randomUUID(), at: e.at || new Date().toISOString(),
    surface: SURFACES[e.surface] ? e.surface : "public", kind: KINDS.includes(e.kind) ? e.kind : String(e.kind || "").slice(0, 20) || null,
    model: e.model ? String(e.model).slice(0, 80) : null, style: STYLES[e.style] ? e.style : null,
    outcome: OUTCOMES.includes(e.outcome) ? e.outcome : "done", code: e.code ? String(e.code).slice(0, 40) : null,
    notes: e.notes && e.notes.length ? [].concat(e.notes).join("; ").slice(0, 300) : null,
    prompt_hash: text ? await sha(text, 16) : null, prompt: text && p.audit.keepPrompts ? text.slice(0, 300) : null,
    who: e.who ? String(e.who).slice(0, 80) : null, ref: e.ref ? String(e.ref).slice(0, 120) : null,
    ms: Number.isFinite(e.ms) ? Math.round(e.ms) : null,
  };
}

let auditReady = null;
/** Write one row to waitlist-db's ai_audit (made on first use). Never throws: logging must not break a tool. */
export async function writeAudit(db, policy, e) {
  if (!db) return null;
  try {
    await (auditReady ||= db.batch([db.prepare(AUDIT_TABLE), db.prepare(AUDIT_INDEX)]).catch((x) => { auditReady = null; throw x; }));
    const row = await auditRow(policy, e);
    await db.prepare(`INSERT OR IGNORE INTO ai_audit (${AUDIT_COLS.join(", ")}) VALUES (${AUDIT_COLS.map(() => "?").join(", ")})`).bind(...AUDIT_COLS.map((c) => row[c])).run();
    if (Math.random() < 0.01) await db.prepare("DELETE FROM ai_audit WHERE at < ?").bind(new Date(Date.now() - cleanPolicy(policy).audit.days * 864e5).toISOString()).run().catch(() => {});
    return row;
  } catch (x) { try { console.error("ai audit write failed", x && x.message); } catch {} return null; }
}
/** Rows that arrive already made (the AI Forge's, through Autopilot). Returns how many were new. */
export async function writeAuditRows(db, rows) {
  if (!db || !rows.length) return 0;
  await (auditReady ||= db.batch([db.prepare(AUDIT_TABLE), db.prepare(AUDIT_INDEX)]).catch((x) => { auditReady = null; throw x; }));
  const st = db.prepare(`INSERT OR IGNORE INTO ai_audit (${AUDIT_COLS.join(", ")}) VALUES (${AUDIT_COLS.map(() => "?").join(", ")})`);
  const clean = rows.filter((r) => r && typeof r.id === "string" && typeof r.at === "string").slice(0, 500);
  let added = 0;
  for (let i = 0; i < clean.length; i += 50) {
    const res = await db.batch(clean.slice(i, i + 50).map((r) => st.bind(...AUDIT_COLS.map((c) => (r[c] === undefined ? null : r[c])))));
    for (const x of res || []) added += Number(x && x.meta && x.meta.changes) || 0;
  }
  return added; // rows already there (sent again) aren't counted
}

// ---------------------------------------------------------------- reading the policy (D1)
let cached = null, cachedAt = 0;
/** The current policy from waitlist-db, kept 30 seconds per Worker instance. Defaults if it can't be read. */
export async function loadPolicy(db, { fresh = false } = {}) {
  if (!fresh && cached && Date.now() - cachedAt < 30000) return cached;
  let value = null;
  try { const row = db && await db.prepare("SELECT value FROM site_settings WHERE key = ?").bind(POLICY_KEY).first(); value = row ? row.value : null; }
  catch { if (cached) return cached; }
  cached = cleanPolicy(value); cachedAt = Date.now();
  return cached;
}
