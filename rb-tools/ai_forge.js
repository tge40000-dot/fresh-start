// ---------------------------------------------------------------- AI policy in the AI Forge (rb-studio, RB account, 29 Oct 2026)
// The Forge is in the other Cloudflare account, so it keeps its own copy of the owner's policy in its JOBS KV
// ("rb:ai-policy"), sent by Autopilot (the only caller allowed to change it). Until a copy arrives it uses RB's
// defaults. Every generation route calls forgeGate() before it starts a model, and every decision is logged in
// JOBS KV under "audit:<time>:<id>" for 14 days; Autopilot copies those rows into RB Command's log.
import * as P from "./ai_policy.js";

const KEY = "rb:ai-policy";
let mem = null, memAt = 0;

/** {policy, version, saved_at}: the Forge's copy, kept a minute per instance. */
export async function forgePolicy(env, fresh = false) {
  if (!fresh && mem && Date.now() - memAt < 60000) return mem;
  let raw = null;
  try { raw = env.JOBS ? await env.JOBS.get(KEY, fresh ? { type: "json" } : { type: "json", cacheTtl: 60 }) : null; } catch { raw = null; }
  mem = { policy: P.cleanPolicy(raw && raw.policy), version: raw ? raw.version || null : null, saved_at: raw ? raw.saved_at || null : null, by: raw ? raw.by || null : null };
  memAt = Date.now();
  return mem;
}

/** Store a new copy (from Autopilot). Returns {ok, version}. */
export async function savePolicy(env, body = {}) {
  const policy = P.cleanPolicy(body.policy);
  const version = P.policyVersion(policy);
  await env.JOBS.put(KEY, JSON.stringify({ policy, version, saved_at: new Date().toISOString(), by: String(body.by || "Autopilot").slice(0, 120) }));
  mem = null;
  return { ok: true, version };
}

/** Log one decision. KV metadata holds the row (up to 1 KB), so a listing returns rows without reading each key. */
export async function auditForge(env, policy, e) {
  try {
    const row = await P.auditRow(policy, { ...e, surface: e.surface || "forge" });
    if (row.prompt) row.prompt = row.prompt.slice(0, 200);
    if (row.notes) row.notes = row.notes.slice(0, 120);
    let meta = row;
    if (JSON.stringify(meta).length > 1000) meta = { ...row, prompt: null };
    await env.JOBS.put(`audit:${row.at}:${row.id}`, "", { metadata: meta, expirationTtl: 1209600 });
    return row;
  } catch (x) { try { console.error("forge audit write failed", x && x.message); } catch {} return null; }
}

/** Rows after the given key, oldest first: {ok, rows, last, more}. */
export async function listAudit(env, after = "", limit = 500) {
  const max = Math.max(1, Math.min(500, Number(limit) || 500));
  const rows = [];
  let cursor, last = after || "", more = false;
  do {
    const page = await env.JOBS.list({ prefix: "audit:", cursor, limit: 1000 });
    for (const k of page.keys) {
      if (after && k.name <= after) continue;
      if (rows.length >= max) { more = true; break; }
      if (k.metadata) rows.push(k.metadata);
      last = k.name;
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor && !more);
  return { ok: true, rows, last, more };
}

const KIND = { tts: "speech", image: "image", video: "video", music: "music", text: "text" };

/**
 * The gate every generation route calls, after it has the request body and model and before it builds the input.
 * opts: {kind: image|video|music|tts|text, body, model, autopilot (bool), surface ("forge" | "public"), who}.
 * It brings sizes and lengths inside the caps and adds the style to the prompt (by changing body), and returns
 * {ok:true, log(outcome, extra)} or {ok:false, status, code, message} (already logged).
 */
export async function forgeGate(request, env, opts) {
  const { policy } = await forgePolicy(env);
  const b = opts.body || {};
  const kind = KIND[opts.kind] || "text";
  const msgs = Array.isArray(b.messages) ? b.messages : [];
  const lastUser = msgs.filter((m) => m && m.role === "user").pop();
  const prompt = String(b.prompt || b.text || (lastUser && lastUser.content) || b.brief || b.lyrics || "").slice(0, 10000);
  const ms = Number(b.music_length_ms || b.durationMs) || 0;
  const seconds = kind === "video" ? (b.durationSec == null ? null : Number(b.durationSec)) : kind === "music" ? (ms ? ms / 1000 : b.durationSec == null ? null : Number(b.durationSec)) : null;
  const surface = opts.surface || "forge";
  const approved = Boolean(b.approval && typeof b.approval === "object" && b.approval.idea);
  const who = opts.who || (opts.autopilot ? `autopilot${approved ? ` (approved by ${String(b.approval.by || "the owner").slice(0, 60)})` : ""}` : "operator");
  const v = P.evaluate(policy, { surface, kind, prompt, style: b.style || null, width: b.width, height: b.height, imageSize: b.imageSize, seconds, autonomous: Boolean(opts.autopilot), approved });
  const base = { surface, kind, model: opts.model, prompt, who, style: v.ok ? v.style : null };
  if (!v.ok) {
    await auditForge(env, policy, { ...base, outcome: "blocked", code: v.code });
    return { ok: false, status: v.code === "paused" ? 503 : v.code === "approval_required" ? 403 : 400, code: v.code, message: v.message };
  }
  const capKind = opts.kind === "tts" ? "tts" : opts.kind;
  const cap = policy.rate.forgePerDay[capKind] || 0;
  if (cap > 0 && env.JOBS) {
    const used = Number(await env.JOBS.get(`cap:${capKind}:${new Date().toISOString().slice(0, 10)}`)) || 0;
    if (used > cap) {
      await auditForge(env, policy, { ...base, outcome: "rate_limited", code: "daily_cap" });
      return { ok: false, status: 429, code: "daily_cap", message: `Today's limit of ${cap} ${capKind} renders on the AI Forge is reached (RB Command > AI limits).` };
    }
  }
  if (b.prompt && v.prompt) b.prompt = v.prompt;
  if (v.width) { b.width = v.width; b.height = v.height; }
  if (v.imageSize) b.imageSize = v.imageSize;
  if (kind === "video" && v.seconds != null) b.durationSec = v.seconds;
  if (kind === "music" && v.seconds != null && seconds != null) {
    if (b.music_length_ms) b.music_length_ms = v.seconds * 1000;
    if (b.durationMs) b.durationMs = v.seconds * 1000;
    if (b.durationSec) b.durationSec = v.seconds;
  }
  const t0 = Date.now();
  return { ok: true, notes: v.notes, log: (outcome, extra = {}) => auditForge(env, policy, { ...base, notes: v.notes, outcome, ms: Date.now() - t0, ...extra }) };
}
