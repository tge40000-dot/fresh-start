// ---------------------------------------------------------------- AI policy in Autopilot (rb-autopilot, 29 Oct 2026)
// 1. Autopilot's own Workers AI calls (talent notes, pitches, résumés, ideas) go through aiRun(): the operator's
//    switch is checked first and every call is logged in ai_audit.
// 2. The AI Forge (rb-studio, RB account) can't read waitlist-db, so Autopilot, which holds the Forge's key
//    (FORGE_TOKEN), carries the policy there (aiSync, right after the owner saves it in RB Command, and on every
//    10-minute run if the Forge's copy is out of date) and brings the Forge's log back (pullForgeAudit).
import * as P from "./ai_policy.js";

const FORGE = "https://studio.relentlessbillionaire.vip";
const UA = "RB-Autopilot (+https://relentlessbillionaire.com)";
const CURSOR = "ai_forge_audit_cursor";
const nowIso = () => new Date().toISOString();

async function forgeCall(env, path, body) {
  if (!env.FORGE_TOKEN) throw new Error("The AI Forge isn't connected to Autopilot (FORGE_TOKEN).");
  const r = await fetch((env.FORGE_URL || FORGE) + path, {
    method: body ? "POST" : "GET", signal: AbortSignal.timeout(30000),
    headers: { "x-rb-autopilot": env.FORGE_TOKEN, "User-Agent": UA, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.ok === false) throw new Error(String(d.error && (d.error.message || d.error) || `AI Forge answered ${r.status}`).slice(0, 200));
  return d;
}

/** env.AI.run with the operator's switch and the log. task names what it's for (draft, ideas…). */
export async function aiRun(env, task, model, input, opts) {
  const policy = await P.loadPolicy(env.DB);
  const msgs = input && Array.isArray(input.messages) ? input.messages : [];
  const user = msgs.filter((m) => m && m.role === "user").pop();
  const prompt = String((user && user.content) || (input && input.prompt) || "");
  const base = { surface: "autopilot", kind: "text", model, prompt, who: "autopilot", ref: task };
  const v = P.evaluate(policy, { surface: "autopilot", kind: "text" });
  if (!v.ok) { await P.writeAudit(env.DB, policy, { ...base, outcome: "blocked", code: v.code }); throw new Error(v.message + " (RB Command > AI limits)"); }
  const t0 = Date.now();
  try {
    const r = await (opts ? env.AI.run(model, input, opts) : env.AI.run(model, input));
    await P.writeAudit(env.DB, policy, { ...base, outcome: "done", ms: Date.now() - t0 });
    return r;
  } catch (e) {
    await P.writeAudit(env.DB, policy, { ...base, outcome: "failed", code: String((e && e.message) || e).slice(0, 40), ms: Date.now() - t0 });
    throw e;
  }
}

/** What the AI Forge has now: {ok, version, saved_at, checked_at} (RB Command's AI limits screen shows it). */
export async function aiForgeStatus(env) {
  try { const d = await forgeCall(env, "/api/policy"); return { ok: true, version: d.version || null, saved_at: d.saved_at || null, checked_at: nowIso() }; }
  catch (e) { return { ok: false, error: `Couldn't reach the AI Forge: ${e.message}` }; }
}

/** Send the saved policy to the AI Forge, then bring its log back. Called by RB Command right after a save. */
export async function aiSync(env, { by = "RB Command" } = {}) {
  const policy = await P.loadPolicy(env.DB, { fresh: true });
  const version = P.policyVersion(policy);
  let pushed = false, error = null, pulled = 0;
  try { await forgeCall(env, "/api/policy", { policy, version, by: String(by).slice(0, 120) }); pushed = true; }
  catch (e) { error = `The AI Forge didn't take the new rules yet (${e.message}). Autopilot tries again every 10 minutes.`; }
  try { pulled = await pullForgeAudit(env); } catch (_) {}
  return { ok: pushed, version, pulled, error };
}

/**
 * Copy the AI Forge's new log rows into ai_audit (it keeps them 14 days; we keep them as long as the policy says).
 * Each read starts 5 minutes before the last row seen: two rows in the same millisecond can land in either order, and
 * Cloudflare's key listing can lag behind a write. Rows already copied are skipped by their id.
 */
export async function pullForgeAudit(env) {
  const row = await env.DB.prepare("SELECT value FROM site_settings WHERE key = ?").bind(CURSOR).first().catch(() => null);
  const seen = row ? String(row.value || "") : "", at = Date.parse(seen.split(":").slice(1, 4).join(":"));
  let after = seen && Number.isFinite(at) ? `audit:${new Date(at - 300000).toISOString()}` : "", total = 0;
  for (let page = 0; page < 4; page++) {
    const d = await forgeCall(env, `/api/audit?after=${encodeURIComponent(after)}&limit=500`);
    const rows = Array.isArray(d.rows) ? d.rows : [];
    if (!rows.length) break;
    total += await P.writeAuditRows(env.DB, rows.map((r) => ({ ...r, surface: P.SURFACES[r.surface] ? r.surface : "forge" })));
    after = d.last && d.last > after ? d.last : after;
    if (after > seen) await env.DB.prepare("INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')").bind(CURSOR, after).run();
    if (!d.more) break;
  }
  return total;
}

/** Every 10 minutes: bring the Forge up to date if its copy is old, and collect its log. Quiet when nothing changed. */
export async function aiTick(env) {
  if (!env.FORGE_TOKEN) return { skipped: true };
  const policy = await P.loadPolicy(env.DB, { fresh: true }), version = P.policyVersion(policy);
  const st = await aiForgeStatus(env);
  let pushed = false;
  if (st.ok && st.version !== version) pushed = (await aiSync(env, { by: "Autopilot (10-minute check)" })).ok;
  const pulled = st.ok ? await pullForgeAudit(env).catch(() => 0) : 0;
  return { version, forge: st.ok ? st.version : null, pushed, pulled };
}
