"""The operator's AI policy on RB's public AI tools (relentless-billionaire-api, code only). Run after patch_ai_limit.py.

Usage: python3 -I patch_ai_policy_api.py <pulled relentless-billionaire-api dir>

media.relentlessbillionaire.com/ai/platform/* (RB Create's pictures, voice and captions; writing, vision…) and
/ai/studio/* (the studio's lyric and vocal helpers) now:
- check RB Command > AI limits before any model runs (rb-tools/ai_policy.js, copied in): the switch for public tools,
  the style locks (a picture request may name a style; the default is added when the operator says so), the size
  caps, the content filters, and for pictures the optional AI check (Llama Guard, already used for /safety);
- take their per-visitor and site-wide rate limits from the policy (today's numbers are its defaults);
- write every call to ai_audit (waitlist-db): outcome, model, style, a fingerprint of the prompt (and the prompt
  itself if the operator keeps them), the visitor as a hash of their IP, and how long it took.
A picture request may also ask for a shape (aspect: 1:1, 16:9, 9:16, 4:3, 3:4), each about one megapixel, so Film
can ask for wide backgrounds. Refusals answer 400 (503 when paused) with a plain message the tools already show.
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


def rep(old, new, what, count=1):
    global s
    if new in s:
        return
    if s.count(old) != count:
        raise SystemExit(f"relentless-billionaire-api: {what}: anchor found {s.count(old)} times")
    s = s.replace(old, new)
    changed.append(what)


if 'import * as RBP from "./ai_policy.js";' not in s:
    s = 'import * as RBP from "./ai_policy.js";\n' + s
    changed.append("import")

# rate limits from the policy (the built-in numbers stay as the fallback)
rep("  const lim = RB_AI_LIMITS[feature];\n  if (!lim || !env.DB) return { ok: true };\n",
    "  if (!env.DB) return { ok: true };\n  const lim = (await RBP.loadPolicy(env.DB)).rate.public[feature] || RB_AI_LIMITS[feature];\n  if (!lim) return { ok: true };\n",
    "limits from the policy")

# FLUX.2 at the size the policy allows
rep('async function rbAiFlux2(env, prompt) {\n  const form = new FormData();\n  form.append("prompt", prompt); form.append("width", "1024"); form.append("height", "1024");\n',
    'async function rbAiFlux2(env, prompt, w = 1024, h = 1024) {\n  const form = new FormData();\n  form.append("prompt", prompt); form.append("width", String(w)); form.append("height", String(h));\n',
    "picture size")

GATE = r'''// ---------------------------------------------------------------- operator AI policy (rb-site-updates/patch_ai_policy_api.py)
var RB_AI_KIND = { text: "text", image: "image", vision: "vision", transcription: "transcription", safety: "safety", embeddings: "embeddings", speech: "speech" };
// About one megapixel in each shape; the policy's largest side still applies.
var RB_AI_SHAPES = { "1:1": [1024, 1024], "16:9": [1344, 768], "9:16": [768, 1344], "4:3": [1152, 864], "3:4": [864, 1152] };
// Checks one request against the policy and, for pictures, runs the AI check. Returns {v} or {code, message, status}.
async function rbAiGate(env, A, req) {
  A.prompt = req.prompt;
  const v = RBP.evaluate(A.policy, { surface: "public", ...req });
  if (!v.ok) { A.code = v.code; return { code: "policy_" + v.code, message: v.message, status: v.code === "paused" ? 503 : 400 }; }
  A.style = v.style; A.notes = v.notes.slice();
  if (RBP.needsAiCheck(A.policy, "public", req.kind) && env.AI && req.prompt) {
    try {
      const said = RBP.aiCheckSays(await runAi(env.AI, RB_AI_SAFETY_MODEL, { messages: [{ role: "user", content: String(req.prompt).slice(0, 2500) }], max_tokens: 24 }));
      if (said.unsafe) { A.code = "ai_check"; A.notes.push("AI check " + (said.categories || "unsafe")); return { code: "policy_blocked", message: "That prompt was stopped by RB's AI safety check.", status: 400 }; }
      if (!said.readable) A.notes.push("AI check unreadable");
    } catch (_) { A.notes.push("AI check unavailable"); }
  }
  return { v };
}
async function rbAiAudit(request, env, A, res) {
  if (!A.kind || request.method !== "POST") return;
  const outcome = res.status === 429 ? "rate_limited" : res.ok ? "done" : A.code ? "blocked" : "failed";
  await RBP.writeAudit(env.DB, A.policy || await RBP.loadPolicy(env.DB), {
    surface: "public", kind: A.kind, model: A.model, style: A.style, outcome, code: A.code || (res.ok ? null : "http_" + res.status),
    notes: A.notes, prompt: A.prompt, who: A.who || await RBP.visitorId(request), ref: A.ref, ms: Date.now() - A.t0,
  });
}
async function handleRbAiPlatform(request, env, pathname) {
  const A = { t0: Date.now(), notes: [] };
  const res = await rbAiPlatformInner(request, env, pathname, A);
  await rbAiAudit(request, env, A, res);
  return res;
}
async function handleStudioAi(request, env, pathname) {
  const A = { t0: Date.now(), notes: [] };
  const res = await rbStudioAiInner(request, env, pathname, A);
  await rbAiAudit(request, env, A, res);
  return res;
}
// ---------------------------------------------------------------- end operator AI policy
'''
rep("async function handleRbAiPlatform(request, env, pathname) {\n  const origin = request.headers.get(\"Origin\") || \"\";\n",
    GATE + "async function rbAiPlatformInner(request, env, pathname, A) {\n  const origin = request.headers.get(\"Origin\") || \"\";\n",
    "platform wrapper")
rep("async function handleStudioAi(request, env, pathname) {\n  if (request.method === \"OPTIONS\")",
    "async function rbStudioAiInner(request, env, pathname, A) {\n  if (request.method === \"OPTIONS\")",
    "studio wrapper")

# platform: switch and kind, before the KV toggle and the rate limit
rep('  if (!feature) return rbAiJson({ ok: false, error: { code: "not_found" } }, 404, origin);\n  if (!await rbAiFeatureEnabled(env, feature)) return rbAiJson(',
    '  if (!feature) return rbAiJson({ ok: false, error: { code: "not_found" } }, 404, origin);\n'
    '  A.kind = RB_AI_KIND[feature]; A.policy = await RBP.loadPolicy(env.DB);\n'
    '  { const on = RBP.evaluate(A.policy, { surface: "public", kind: A.kind }); if (!on.ok) { A.code = on.code; return rbAiJson({ ok: false, error: { code: "policy_" + on.code, message: on.message } }, 503, origin); } }\n'
    '  if (!await rbAiFeatureEnabled(env, feature)) { A.code = "feature_off"; } else A.code = null;\n'
    '  if (A.code) return rbAiJson(',
    "platform switch")
rep('      const text = rbAiCleanText(body.text, 1500);\n      const lang = RB_AI_SPEECH_LANGS',
    '      const text = rbAiCleanText(body.text, 1500);\n'
    '      { const g = await rbAiGate(env, A, { kind: "speech", prompt: text }); if (!g.v) return rbAiJson({ ok: false, error: { code: g.code, message: g.message } }, g.status, origin); }\n'
    '      A.model = RB_AI_SPEECH_MODEL;\n'
    '      const lang = RB_AI_SPEECH_LANGS',
    "speech check")
rep('    if (feature === "text") {\n      const result = await rbAiGenerateText(env, body);\n',
    '    if (feature === "text") {\n'
    '      { const g = await rbAiGate(env, A, { kind: "text", prompt: String(body.prompt || "").slice(0, 6000) }); if (!g.v) return rbAiJson({ ok: false, error: { code: g.code, message: g.message } }, g.status, origin); }\n'
    '      A.model = RB_AI_TEXT_MODEL;\n'
    '      const result = await rbAiGenerateText(env, body);\n',
    "text check")
rep('      const prompt = rbAiCleanText(body.prompt, 2500);\n      let result;\n      let model = RB_AI_IMAGE_MODEL;\n',
    '      const prompt = rbAiCleanText(body.prompt, 2500);\n'
    '      const shape = RB_AI_SHAPES[String(body.aspect || "1:1")] || RB_AI_SHAPES["1:1"];\n'
    '      const g = await rbAiGate(env, A, { kind: "image", prompt, style: body.style ? String(body.style) : null, width: shape[0], height: shape[1] });\n'
    '      if (!g.v) return rbAiJson({ ok: false, error: { code: g.code, message: g.message } }, g.status, origin);\n'
    '      const genPrompt = g.v.prompt, gw = g.v.width || shape[0], gh = g.v.height || shape[1];\n'
    '      let result;\n      let model = RB_AI_IMAGE_MODEL;\n',
    "picture check")
rep("        result = await rbAiFlux2(env, prompt);\n", "        result = await rbAiFlux2(env, genPrompt, gw, gh);\n", "picture prompt")
rep("        result = await env.AI.run(RB_AI_IMAGE_FALLBACK_MODEL, { prompt, steps: 4 });\n",
    "        result = await env.AI.run(RB_AI_IMAGE_FALLBACK_MODEL, { prompt: genPrompt, steps: 4, width: gw, height: gh });\n", "fallback prompt")
rep("      const asset = await rbAiPersistImage(env, result?.image || result, model);\n",
    "      const asset = await rbAiPersistImage(env, result?.image || result, model);\n      A.model = model; A.ref = asset.key;\n", "picture log")
rep('      return rbAiJson({ ok: true, asset, model, fallback }, 200, origin);\n',
    '      return rbAiJson({ ok: true, asset, model, fallback, style: A.style || null, size: [gw, gh], notes: A.notes }, 200, origin);\n', "picture answer")
rep('    if (feature === "vision") {\n      const task =', '    if (feature === "vision") {\n      A.model = RB_AI_VISION_MODEL;\n      const task =', "vision log")
rep('    if (feature === "safety") {\n      const text = rbAiCleanText(body.text, 6000);\n', '    if (feature === "safety") {\n      const text = rbAiCleanText(body.text, 6000);\n      A.model = RB_AI_SAFETY_MODEL;\n', "safety log")
rep('    if (feature === "embeddings") {\n      const text = rbAiCleanText(body.text, 8000);\n', '    if (feature === "embeddings") {\n      const text = rbAiCleanText(body.text, 8000);\n      A.model = RB_AI_EMBED_MODEL;\n', "embeddings log")
rep('    if (feature === "transcription") {\n      const form = await request.formData();\n', '    if (feature === "transcription") {\n      A.model = RB_AI_TRANSCRIBE_MODEL;\n      const form = await request.formData();\n', "captions log")

# studio helpers: the switch, the words filter, the log (members by their id)
rep('  const rbLimit = await rbAiLimit(request, env, "studio");\n  if (!rbLimit.ok) return studioAiJson(',
    '  A.kind = pathname === "/ai/studio/vocal" ? "speech" : "text"; A.policy = await RBP.loadPolicy(env.DB);\n'
    '  if (effectiveMemberId) A.who = "member:" + String(effectiveMemberId).slice(0, 40);\n'
    '  { const on = RBP.evaluate(A.policy, { surface: "public", kind: A.kind }); if (!on.ok) { A.code = on.code; return studioAiJson({ ok: false, error: { code: "policy_" + on.code, message: on.message } }, 503); } }\n'
    '  const rbLimit = await rbAiLimit(request, env, "studio");\n  if (!rbLimit.ok) return studioAiJson(',
    "studio switch")
rep('      const messages = normalizeStudioMessages(body.messages);\n      const response = await runAi(env.AI, STUDIO_CHAT_MODEL,',
    '      const messages = normalizeStudioMessages(body.messages);\n'
    '      { const u = messages.filter((m) => m.role === "user").pop(); const g = await rbAiGate(env, A, { kind: "text", prompt: u ? u.content : "" }); if (!g.v) return studioAiJson({ ok: false, error: { code: g.code, message: g.message } }, g.status); }\n'
    '      A.model = STUDIO_CHAT_MODEL;\n'
    '      const response = await runAi(env.AI, STUDIO_CHAT_MODEL,',
    "studio writing check")
rep('    const voice = STUDIO_TTS_VOICES[String(body.voice || "").toLowerCase()] || "alloy";\n',
    '    { const g = await rbAiGate(env, A, { kind: "speech", prompt: text }); if (!g.v) return studioAiJson({ ok: false, error: { code: g.code, message: g.message } }, g.status); }\n'
    '    A.model = STUDIO_TTS_MODEL;\n'
    '    const voice = STUDIO_TTS_VOICES[String(body.voice || "").toLowerCase()] || "alloy";\n',
    "studio vocal check")

p.write_text(s, encoding="utf-8")
print("relentless-billionaire-api: AI policy " + (", ".join(changed) + " added" if changed else "already in place"))
