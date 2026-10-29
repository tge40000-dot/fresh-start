"""The operator's AI policy on RB Cloud's model runs (rb-cloud, code only). Inactive until rb-cloud has a D1 binding.

Usage: python3 -I patch_ai_policy_cloud.py <pulled rb-cloud dir>

rb-cloud runs Workers AI for keyed callers: cover art (FLUX), voice-over, transcription, writing (Llama 3.3), and for
its audio engine, transcription and the cover-art check. It has no database binding, so it can't read RB Command >
AI limits or write the log. This puts the check and the log in front of both paths (rb-tools/ai_policy.js, copied in)
and switches them on only when the Worker has a D1 binding named DB (waitlist-db). Without it, every call runs
exactly as before. So this deploys safely today, and adding the binding (an owner decision) turns it on with no
further code. With it: the public switch and the content filters apply before the model, sizes are not touched (cover
art is 1024 px), every call is logged in ai_audit (who: the member account, or "operator"), and a refused prediction
fails with the operator's message. Running it twice changes nothing.
"""
import pathlib
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
folder = pathlib.Path(sys.argv[1])
shutil.copyfile(HERE.parent / "rb-tools" / "ai_policy.js", folder / "ai_policy.js")
p = folder / "index.js"
s = p.read_text(encoding="utf-8")
changed = []


def rep(old, new, what):
    global s
    if new in s:
        return
    if s.count(old) != 1:
        raise SystemExit(f"rb-cloud: {what}: anchor found {s.count(old)} times")
    s = s.replace(old, new)
    changed.append(what)


if 'import * as RBP from "./ai_policy.js";' not in s:
    s = 'import * as RBP from "./ai_policy.js";\n' + s
    changed.append("import")

GATE = r'''// ---------------------------------------------------------------- operator AI policy (patch_ai_policy_cloud.py)
// Only with a D1 binding named DB (waitlist-db); without one, calls run exactly as before.
var RBC_KIND = { "rb/cover-art": "image", "rb/transcribe": "transcription", "rb/voiceover": "speech", "rb/write": "text", asr: "transcription", artwork: "vision" };
async function rbcPolicied(env, e, run) {
  if (!env.DB) return run();
  const policy = await RBP.loadPolicy(env.DB), t0 = Date.now();
  const v = RBP.evaluate(policy, { surface: "public", kind: e.kind, prompt: e.prompt });
  const log = (outcome, code) => RBP.writeAudit(env.DB, policy, { surface: "public", kind: e.kind, model: e.model, outcome, code, prompt: e.prompt, who: e.who, ref: e.ref, ms: Date.now() - t0 });
  if (!v.ok) { await log("blocked", v.code); throw new Error(v.message); }
  try { const out = await run(); await log("done", null); return out; }
  catch (x) { await log("failed", "error"); throw x; }
}
async function runAiModel(env, p, model) {
  const i = p.input || {};
  return rbcPolicied(env, { kind: RBC_KIND[p.model] || "text", model: model.aiModel, prompt: i.prompt ?? i.text ?? null, who: p.owner ? "member:" + p.owner : "operator", ref: "rb-cloud " + p.model + " " + p.id },
    () => runAiModelInner(env, p, model));
}
async function containerAi(env, task, bytes, params) {
  return rbcPolicied(env, { kind: RBC_KIND[task] || "text", model: task === "artwork" ? "@cf/meta/llama-3.2-11b-vision-instruct" : "@cf/openai/whisper-large-v3-turbo", prompt: null, who: "audio engine", ref: "rb-cloud " + task },
    () => containerAiInner(env, task, bytes, params));
}
// ---------------------------------------------------------------- end operator AI policy
'''
if "async function containerAiInner(" not in s:  # the wrappers below reuse both names, so rename first
    rep("async function containerAi(env, task, bytes, params) {\n", "async function containerAiInner(env, task, bytes, params) {\n", "audio engine")
rep("async function runAiModel(env, p, model) {\n", GATE + "async function runAiModelInner(env, p, model) {\n", "predictions")

if changed:
    p.write_text(s, encoding="utf-8")
    print("rb-cloud: AI policy wired, active once DB is bound (" + ", ".join(changed) + ")")
else:
    print("rb-cloud: AI policy already in place")
