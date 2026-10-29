"""The operator's AI policy in Autopilot (rb-autopilot, code only).

Usage: python3 -I patch_ai_policy_autopilot.py <pulled rb-autopilot dir>

Copies rb-tools/ai_policy.js and rb-tools/ai_autopilot.js in, then:
- Autopilot's own Workers AI calls (ai.js ask(): talent notes, pitches, résumés, captions; creative.js: ideas) go
  through aiRun(): paused in RB Command > AI limits means no AI call, and every call is logged in ai_audit;
- the renders Autopilot asks the AI Forge for carry the approval they come from ({idea, by}), so the Forge can hold
  them to the "needs my approval" rule;
- RB Command can call aiSync() (send the policy to the Forge now) and aiForgeStatus() through its AUTOPILOT binding;
- the 10-minute schedule also brings the Forge's copy up to date and collects its log (aiTick).
Running it twice changes nothing.
"""
import pathlib
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
folder = pathlib.Path(sys.argv[1])
for f in ("ai_policy.js", "ai_autopilot.js"):
    shutil.copyfile(HERE.parent / "rb-tools" / f, folder / f)
changed = []


def edit(name, old, new, what, count=1):
    p = folder / name
    s = p.read_text(encoding="utf-8")
    if new in s:
        return
    if s.count(old) != count:
        raise SystemExit(f"rb-autopilot/{name}: {what}: anchor found {s.count(old)} times")
    p.write_text(s.replace(old, new), encoding="utf-8")
    changed.append(f"{name}: {what}")


def prepend(name, line, what):
    p = folder / name
    s = p.read_text(encoding="utf-8")
    if line in s:
        return
    p.write_text(line + s, encoding="utf-8")
    changed.append(f"{name}: {what}")


# Autopilot's own model calls
prepend("ai.js", 'import { aiRun } from "./ai_autopilot.js";\n', "import")
edit("ai.js", "  const r = await env.AI.run(MODEL, { messages: [{ role: \"system\", content: system }, { role: \"user\", content: user }], max_tokens: maxTokens, temperature: 0.4 });\n",
     "  const r = await aiRun(env, \"draft\", MODEL, { messages: [{ role: \"system\", content: system }, { role: \"user\", content: user }], max_tokens: maxTokens, temperature: 0.4 });\n",
     "drafts through the policy")
prepend("creative.js", 'import { aiRun } from "./ai_autopilot.js";\n', "import")
edit("creative.js", "    const r = await env.AI.run(MODEL, { temperature: 0.7, max_tokens: 2600, messages: [\n",
     "    const r = await aiRun(env, \"ideas\", MODEL, { temperature: 0.7, max_tokens: 2600, messages: [\n", "ideas through the policy")

# renders carry the owner's approval
edit("creative.js", "  const jobs = {};\n  try {\n    const music = idea.music_prompt",
     "  const jobs = {};\n  const approval = { idea: id, by: clip(by, 120) }; // the AI Forge holds Autopilot to the owner's approval rule\n  try {\n    const music = idea.music_prompt",
     "approval")
for path in ("music", "video", "image"):
    edit("creative.js", f'await forge(env, "/api/{path}/generate", {{ ', f'await forge(env, "/api/{path}/generate", {{ approval, ',
         f"{path} renders carry the approval", count=2 if path == "music" else 1)

# RB Command's binding, and the 10-minute run
edit("index.js", 'import * as creative from "./creative.js";\n',
     'import * as creative from "./creative.js";\nimport { aiSync, aiForgeStatus, aiTick } from "./ai_autopilot.js";\n', "import")
edit("index.js", "export class AdminApi extends WorkerEntrypoint {\n",
     "export class AdminApi extends WorkerEntrypoint {\n"
     "  /** RB Command > AI limits: send the saved policy to the AI Forge now, and what the Forge has. */\n"
     "  async aiSync(o = {}) { return aiSync(this.env, o); }\n"
     "  async aiForgeStatus() { return aiForgeStatus(this.env); }\n",
     "RB Command methods")
edit("index.js", "      ctx.waitUntil(publishQueue(env).catch((e) => console.error(\"rb-autopilot publish queue\", e && e.stack || e)));\n",
     "      ctx.waitUntil(publishQueue(env).catch((e) => console.error(\"rb-autopilot publish queue\", e && e.stack || e)));\n"
     "      ctx.waitUntil(aiTick(env).then((r) => (r.pushed || r.pulled) && console.log(\"rb-autopilot ai policy\", JSON.stringify(r))).catch((e) => console.error(\"rb-autopilot ai policy\", e && e.stack || e)));\n",
     "10-minute sync")

print("rb-autopilot: AI policy " + (", ".join(changed) + " added" if changed else "already in place"))
