"""Add a free AI voice to the public AI endpoints (relentless-billionaire-api): POST /ai/platform/speech.

Usage: python3 -I patch_ai_speech.py <pulled relentless-billionaire-api dir>

RB Create's Voice and Film tools use it to read a script or a character's line aloud. It runs Workers AI's MeloTTS
(the same model the studio's vocal endpoint already uses) and returns audio/mpeg. It is a normal platform feature:
same allowed origins, same per-feature on/off switch (rb-ai:feature:speech), same cooldown and metrics as the
image and transcription endpoints. Text is 1 to 1,500 characters. Running it twice changes nothing.
"""
import pathlib
import sys

folder = pathlib.Path(sys.argv[1])
p = folder / "script.js"
s = p.read_text(encoding="utf-8")
changed = []


def rep(old, new, what):
    global s
    if new in s:
        return
    if s.count(old) != 1:
        raise SystemExit(f"relentless-billionaire-api: {what}: anchor found {s.count(old)} times")
    s = s.replace(old, new)
    changed.append(what)


rep('var RB_AI_FEATURES = new Set(["text", "image", "vision", "transcription", "safety", "embeddings"]);\n',
    'var RB_AI_FEATURES = new Set(["text", "image", "vision", "transcription", "safety", "embeddings", "speech"]);\n'
    'var RB_AI_SPEECH_MODEL = "@cf/myshell-ai/melotts";\n'
    'var RB_AI_SPEECH_LANGS = new Set(["en", "es", "fr", "zh", "ja", "ko"]);\n', "feature list")
rep('    "/ai/platform/embed": "embeddings"\n  };\n',
    '    "/ai/platform/embed": "embeddings",\n    "/ai/platform/speech": "speech"\n  };\n', "route")
rep('    if (feature === "text") {\n      const result = await rbAiGenerateText(env, body);\n',
    '    if (feature === "speech") {\n'
    '      // RB Create: read a script or a line aloud (MeloTTS). Returns the audio itself.\n'
    '      const text = rbAiCleanText(body.text, 1500);\n'
    '      const lang = RB_AI_SPEECH_LANGS.has(String(body.lang || "")) ? String(body.lang) : "en";\n'
    '      const out = await env.AI.run(RB_AI_SPEECH_MODEL, { prompt: text, lang });\n'
    '      let audio = out;\n'
    '      if (out && typeof out.audio === "string") audio = Uint8Array.from(atob(out.audio), (c) => c.charCodeAt(0));\n'
    '      else if (out && out.audio) audio = out.audio;\n'
    '      await rbAiMetric(env, feature, "success");\n'
    '      return new Response(audio, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", ...rbAiCorsHeaders(origin) } });\n'
    '    }\n'
    '    if (feature === "text") {\n      const result = await rbAiGenerateText(env, body);\n', "handler")
p.write_text(s, encoding="utf-8")
print("relentless-billionaire-api: " + (", ".join(changed) + " updated" if changed else "speech already in place"))
