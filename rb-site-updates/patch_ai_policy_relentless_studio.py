"""The operator's AI policy on relentless-studio's two AI helpers (code only).

Usage: python3 -I patch_ai_policy_relentless_studio.py <pulled relentless-studio dir>

relentless-studio (the studio custom domain) answers /ai/studio/generate (AI FORGE chat) and its compose endpoint
(a brief → an arrangement) with Llama 3.3. They already had their own daily caps and credits; this adds, before any
model runs, RB Command > AI limits: the public switch and the word filters (rb-tools/ai_policy.js, copied in), and
writes each call to ai_audit. Its PLATFORM_DB binding is waitlist-db, where the policy and the log live, so nothing
new is bound. Requests turned away before that point (cross-site, empty) never reached a model and aren't logged.
Running it twice changes nothing.
"""
import pathlib
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
folder = pathlib.Path(sys.argv[1])
shutil.copyfile(HERE.parent / "rb-tools" / "ai_policy.js", folder / "ai_policy.js")
p = folder / "script.js"
s = p.read_text(encoding="utf-8")
changed = []


def rep(old, new, what):
    global s
    if new in s:
        return
    if s.count(old) != 1:
        raise SystemExit(f"relentless-studio: {what}: anchor found {s.count(old)} times")
    s = s.replace(old, new)
    changed.append(what)


if 'import * as RBP from "./ai_policy.js";' not in s:
    s = 'import * as RBP from "./ai_policy.js";\n' + s
    changed.append("import")

GATE = r'''// ---------------------------------------------------------------- operator AI policy (patch_ai_policy_relentless_studio.py)
// RB Command > AI limits, checked before the model runs; every call that gets that far is written to ai_audit.
async function rsGate(env, A, prompt) {
  A.prompt = prompt; A.policy = await RBP.loadPolicy(env.PLATFORM_DB);
  const v = RBP.evaluate(A.policy, { surface: "public", kind: "text", prompt });
  if (v.ok) return null;
  A.code = v.code;
  return Response.json({ ok: false, error: { code: "policy_" + v.code, message: v.message } }, { status: v.code === "paused" ? 503 : 400 });
}
async function rsAudited(request, env, url, inner) {
  const A = { t0: Date.now() };
  const res = await inner(request, env, url, A);
  if (A.policy) await RBP.writeAudit(env.PLATFORM_DB, A.policy, {
    surface: "public", kind: "text", model: AI_MODEL, outcome: res.status === 429 ? "rate_limited" : res.ok ? "done" : A.code ? "blocked" : "failed",
    code: A.code || (res.ok ? null : "http_" + res.status), prompt: A.prompt, who: await RBP.visitorId(request), ref: "relentless-studio " + url.pathname, ms: Date.now() - A.t0,
  });
  return res;
}
function aiGenerate(request, env, url) { return rsAudited(request, env, url, aiGenerateInner); }
function composeApi(request, env, url) { return rsAudited(request, env, url, composeApiInner); }
// ---------------------------------------------------------------- end operator AI policy

'''
rep("async function aiGenerate(request, env, url) {\n", GATE + "async function aiGenerateInner(request, env, url, A) {\n", "chat wrapper")
rep("async function composeApi(request, env, url) {\n", "async function composeApiInner(request, env, url, A) {\n", "compose wrapper")
rep("    if (m.content.length > 6000) m.content = m.content.slice(0, 6000);\n  }\n\n  const gate = await spendCredit(request, env, 'text');\n",
    "    if (m.content.length > 6000) m.content = m.content.slice(0, 6000);\n  }\n\n"
    "  { const u = messages.filter((m) => m.role === 'user').pop(); const g = await rsGate(env, A, u ? u.content : ''); if (g) return g; }\n"
    "  const gate = await spendCredit(request, env, 'text');\n", "chat gate")
rep("  if (!brief.trim()) return jsonErr('Describe what you want first.', 400);\n\n  const gate = await spendCredit(request, env, 'text');\n",
    "  if (!brief.trim()) return jsonErr('Describe what you want first.', 400);\n\n"
    "  { const g = await rsGate(env, A, brief); if (g) return g; }\n"
    "  const gate = await spendCredit(request, env, 'text');\n", "compose gate")

if changed:
    p.write_text(s, encoding="utf-8")
    print("relentless-studio: AI policy wired (" + ", ".join(changed) + ")")
else:
    print("relentless-studio: AI policy already in place")
