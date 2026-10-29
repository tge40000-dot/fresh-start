"""The operator's AI policy on the AI Forge (rb-studio in the RB account, code only).

Usage: python3 -I patch_ai_policy_forge.py <pulled rb-studio dir>   (pulled with CF_ACCOUNT_ID set to the RB account)

Copies rb-tools/ai_policy.js and rb-tools/ai_forge.js in, then:
- every generation route (music, voice, video, pictures, writing, and the DAW's /ai/studio/* helpers) calls
  forgeGate() before it builds the model input: the switch, Autopilot's approval rule, style locks, size and length
  caps, content filters and the per-day caps, all from the Forge's copy of the owner's policy;
- every decision is logged (KV "audit:…", 14 days), and Autopilot copies the log into RB Command;
- GET /api/policy (operator key or Autopilot) shows the copy and its version; POST /api/policy (Autopilot only)
  replaces it; GET /api/audit?after= (operator key or Autopilot) lists the log.
The daily counters the Forge already keeps are what the per-day caps read; a cap of 0 (the default) means no cap, as
before. Running it twice changes nothing.
"""
import pathlib
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
folder = pathlib.Path(sys.argv[1])
for f in ("ai_policy.js", "ai_forge.js"):
    shutil.copyfile(HERE.parent / "rb-tools" / f, folder / f)
p = folder / "worker.js"
s = p.read_text(encoding="utf-8")
changed = []


def rep(old, new, what):
    global s
    if new in s:
        return
    if s.count(old) != 1:
        raise SystemExit(f"rb-studio: {what}: anchor found {s.count(old)} times")
    s = s.replace(old, new)
    changed.append(what)


IMPORT = 'import { forgeGate, forgePolicy, savePolicy, listAudit } from "./ai_forge.js";\nimport { visitorId } from "./ai_policy.js";\n'
if IMPORT not in s:
    s = IMPORT + s
    changed.append("import")

# Who is asking: Autopilot (its token) or the operator (the admin key).
rep("const today = () => new Date().toISOString().slice(0, 10);\n",
    "const today = () => new Date().toISOString().slice(0, 10);\n"
    "const fromAutopilot = (r, env) => !!env.AUTOPILOT_TOKEN && env.AUTOPILOT_TOKEN.length >= 32 && r.headers.get('x-rb-autopilot') === env.AUTOPILOT_TOKEN;\n"
    "const refuse = (g) => json({ ok: false, error: g.message, code: g.code }, g.status);\n",
    "caller helpers")

# music (queued)
rep("  const model = body.model || cfg(env, 'MUSIC_MODEL');\n  const storeKey = body.key",
    "  const model = body.model || cfg(env, 'MUSIC_MODEL');\n"
    "  const gate = await forgeGate(request, env, { kind: 'music', body, model, autopilot: fromAutopilot(request, env) });\n"
    "  if (!gate.ok) return refuse(gate);\n"
    "  const storeKey = body.key",
    "music check")
rep("    await env.MUSIC_QUEUE.send({ id, model, input, key: storeKey });\n",
    "    await env.MUSIC_QUEUE.send({ id, model, input, key: storeKey });\n    await gate.log('queued', { ref: id });\n",
    "music log")

# voice, video, pictures (startJob)
rep("  const model = body.model || cfg(env, opts.modelVar);\n  const input = opts.build(model, body);\n",
    "  const model = body.model || cfg(env, opts.modelVar);\n"
    "  const gate = await forgeGate(request, env, { kind: opts.kind, body, model, autopilot: fromAutopilot(request, env) });\n"
    "  if (!gate.ok) return refuse(gate);\n"
    "  const input = opts.build(model, body);\n",
    "render check")
rep("  await putJob(env, { id, kind: opts.kind, model, status: 'queued', key: storeKey, createdAt: Date.now() });\n  ctx.waitUntil(runJob(",
    "  await putJob(env, { id, kind: opts.kind, model, status: 'queued', key: storeKey, createdAt: Date.now() });\n"
    "  ctx.waitUntil(gate.log('queued', { ref: id }));\n"
    "  ctx.waitUntil(runJob(",
    "render log")

# the DAW's public helpers (only when STUDIO_PUBLIC_AI is on): public tools in the policy
rep("      const messages = Array.isArray(b.messages) ? b.messages : [];\n      if (!messages.length) return json({ ok: false, error: { message: 'No prompt provided.' } }, 400);\n",
    "      const messages = Array.isArray(b.messages) ? b.messages : [];\n      if (!messages.length) return json({ ok: false, error: { message: 'No prompt provided.' } }, 400);\n"
    "      const gate = await forgeGate(request, env, { kind: 'text', body: b, model: cfg(env, 'TEXT_MODEL'), surface: 'public', who: await visitorId(request) });\n"
    "      if (!gate.ok) return json({ ok: false, error: { message: gate.message, code: gate.code } }, gate.status);\n",
    "daw writing check")
rep("        return json({ ok: true, content: content || '' });\n",
    "        await gate.log('done');\n        return json({ ok: true, content: content || '' });\n", "daw writing log")
rep("      if (!text.trim()) return json({ ok: false, error: { message: 'No text provided.' } }, 400);\n",
    "      if (!text.trim()) return json({ ok: false, error: { message: 'No text provided.' } }, 400);\n"
    "      const gate = await forgeGate(request, env, { kind: 'tts', body: b, model: cfg(env, 'TTS_MODEL'), surface: 'public', who: await visitorId(request) });\n"
    "      if (!gate.ok) return json({ ok: false, error: { message: gate.message, code: gate.code } }, gate.status);\n",
    "daw vocal check")
rep("        // DAW expects the raw blob, not JSON.\n",
    "        await gate.log('done');\n        // DAW expects the raw blob, not JSON.\n", "daw vocal log")

# operator writing
rep("      const model = b.model || cfg(env, 'TEXT_MODEL');\n      try {\n        const out = await env.AI.run(model, buildTextInput(",
    "      const model = b.model || cfg(env, 'TEXT_MODEL');\n"
    "      const gate = await forgeGate(request, env, { kind: 'text', body: b, model, autopilot: fromAutopilot(request, env) });\n"
    "      if (!gate.ok) return refuse(gate);\n"
    "      try {\n        const out = await env.AI.run(model, buildTextInput(",
    "writing check")
rep("        return json({ model, text: text || JSON.stringify(out).slice(0, 4000) });\n",
    "        await gate.log('done');\n        return json({ model, text: text || JSON.stringify(out).slice(0, 4000) });\n", "writing log")

# policy and log routes
rep("    /* media jobs */\n",
    "    /* the owner's AI policy (RB Command > AI limits, carried here by Autopilot) and the log */\n"
    "    if (p === '/api/policy') {\n"
    "      if (request.method === 'POST') {\n"
    "        if (!fromAutopilot(request, env)) return json({ ok: false, error: 'Only RB Autopilot can change the AI policy (RB Command > AI limits).' }, 403);\n"
    "        let b; try { b = await request.json(); } catch { return json({ ok: false, error: 'invalid JSON body' }, 400); }\n"
    "        return json(await savePolicy(env, b));\n"
    "      }\n"
    "      if (!authed(request, env)) return json({ error: 'unauthorized' }, 401);\n"
    "      const f = await forgePolicy(env, true);\n"
    "      return json({ ok: true, version: f.version, saved_at: f.saved_at, by: f.by, policy: f.policy });\n"
    "    }\n"
    "    if (p === '/api/audit') {\n"
    "      if (!authed(request, env)) return json({ error: 'unauthorized' }, 401);\n"
    "      return json(await listAudit(env, url.searchParams.get('after') || '', url.searchParams.get('limit')));\n"
    "    }\n\n"
    "    /* media jobs */\n",
    "policy routes")

p.write_text(s, encoding="utf-8")
print("rb-studio: AI policy " + (", ".join(changed) + " added" if changed else "already in place"))
