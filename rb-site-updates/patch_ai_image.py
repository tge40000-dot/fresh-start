"""Fix the free AI image endpoint (relentless-billionaire-api: POST /ai/platform/image), which RB Create's
"Draw one" and "AI background" use.

Usage: python3 -I patch_ai_image.py <pulled relentless-billionaire-api dir>

FLUX.2 [klein] on Workers AI only takes multipart form data, so the JSON call failed every time. The fallback
(DreamShaper LCM, guidance 7.5) then returned a solid black picture, which was saved and handed back as a success.
This
- calls FLUX.2 [klein] with multipart form data, as Cloudflare documents;
- falls back to FLUX.1 [schnell] (JSON, 4 steps);
- refuses an image that is almost all one colour (a blank or filtered result), so the visitor sees "try again"
  rather than a black square;
- stores each file with its real type (PNG or JPEG).
Running it twice changes nothing.
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


rep('var RB_AI_IMAGE_FALLBACK_MODEL = "@cf/lykon/dreamshaper-8-lcm";\n',
    'var RB_AI_IMAGE_FALLBACK_MODEL = "@cf/black-forest-labs/flux-1-schnell";\n'
    '// FLUX.2 on Workers AI takes multipart form data only, even for a prompt alone.\n'
    'async function rbAiFlux2(env, prompt) {\n'
    '  const form = new FormData();\n'
    '  form.append("prompt", prompt); form.append("width", "1024"); form.append("height", "1024");\n'
    '  const r = new Response(form);\n'
    '  return env.AI.run(RB_AI_IMAGE_MODEL, { multipart: { body: r.body, contentType: r.headers.get("content-type") } });\n'
    '}\n', "models")
rep('        result = await env.AI.run(RB_AI_IMAGE_MODEL, { prompt });\n',
    '        result = await rbAiFlux2(env, prompt);\n', "FLUX.2 multipart call")
rep('        result = await env.AI.run(RB_AI_IMAGE_FALLBACK_MODEL, { prompt, width: 1024, height: 1024, num_steps: 8, guidance: 7.5 });\n',
    '        result = await env.AI.run(RB_AI_IMAGE_FALLBACK_MODEL, { prompt, steps: 4 });\n', "fallback call")
rep('  if (!bytes.byteLength || bytes.byteLength > 12000000) throw new Error("invalid_image_output");\n'
    '  const key = "ai/generated/" + new Date().toISOString().slice(0, 10) + "/" + crypto.randomUUID() + ".png";\n'
    '  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: "image/png",',
    '  if (!bytes.byteLength || bytes.byteLength > 12000000) throw new Error("invalid_image_output");\n'
    '  // a real 1024px picture is far bigger than this; a blank or filtered one compresses to almost nothing\n'
    '  if (bytes.byteLength < 12000) throw new Error("blank_image_output");\n'
    '  const jpeg = bytes[0] === 0xFF && bytes[1] === 0xD8;\n'
    '  const key = "ai/generated/" + new Date().toISOString().slice(0, 10) + "/" + crypto.randomUUID() + (jpeg ? ".jpg" : ".png");\n'
    '  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: jpeg ? "image/jpeg" : "image/png",', "blank check and file type")
p.write_text(s, encoding="utf-8")
print("relentless-billionaire-api: " + (", ".join(changed) + " updated" if changed else "image fix already in place"))
