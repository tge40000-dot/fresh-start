"""RB Command > AI limits: the owner's boundaries for every AI call, and the log of every call (rb-command, code only).

Usage: python3 -I patch_ai_policy.py <pulled rb-command dir>   (after patch_site_images.py and patch_nav.py)

Copies rb-tools/ai_policy.js and rb-command-updates/src/aipolicy.js in, then adds, for the owner role only:
- GET /ai (the screen), GET /api/ai-policy, GET /api/ai-policy/audit;
- POST /api/ai-policy (publish; also sends it to the AI Forge through Autopilot), /api/ai-policy/undo and
  /api/ai-policy/check (try a prompt; nothing is generated);
- "AI limits" in the nav (under Growth, next to Autopilot), for the owner only.
Every other role gets a 403. Running it twice changes nothing.
"""
import pathlib
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
folder = pathlib.Path(sys.argv[1])
shutil.copyfile(HERE.parent / "rb-tools" / "ai_policy.js", folder / "ai_policy.js")
shutil.copyfile(HERE / "src" / "aipolicy.js", folder / "aipolicy.js")
changed = []


def edit(name, old, new, what):
    p = folder / name
    s = p.read_text(encoding="utf-8")
    added = new.replace(old, "", 1) if old in new else new
    first = next((ln for ln in added.split("\n") if ln.strip()), "")
    if new in s or (len(first.strip()) > 20 and first in s):
        return
    if s.count(old) != 1:
        raise SystemExit(f"rb-command/{name}: {what}: anchor found {s.count(old)} times")
    p.write_text(s.replace(old, new), encoding="utf-8")
    changed.append(what)


OWNER = '{ if (!aipolicy.isOperator(auth.ROLES, user)) throw new HttpError(403, "AI limits are for the owner only."); }'
edit("index.js", 'import * as siteimages from "./siteimages.js";\n',
     'import * as siteimages from "./siteimages.js";\nimport * as aipolicy from "./aipolicy.js";\n', "import")
edit("index.js", '    if (path === "/images") {\n',
     '    if (path === "/ai") {\n'
     f'      {OWNER}\n'
     '      const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));\n'
     '      return new Response(aipolicy.page(nonce), { headers: { ...BASE_HEADERS, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": aipolicy.csp(nonce), "X-Frame-Options": "DENY" } });\n'
     '    }\n'
     '    if (path === "/images") {\n', "page route")
edit("index.js", '    if (path === "/api/site-images") { needs(user, "Content", "view"); return json(await siteimages.get(env)); }\n',
     '    if (path === "/api/site-images") { needs(user, "Content", "view"); return json(await siteimages.get(env)); }\n'
     f'    if (path === "/api/ai-policy") {{ {OWNER[2:-2]} return json(await aipolicy.get(env)); }}\n'
     f'    if (path === "/api/ai-policy/audit") {{ {OWNER[2:-2]} return json(await aipolicy.audit(env, url.searchParams)); }}\n',
     "read routes")
edit("index.js", '  if (path === "/api/site-images") { needs(user, "Content", "edit"); return json(await siteimages.save(env, user, body)); }\n',
     '  if (path === "/api/site-images") { needs(user, "Content", "edit"); return json(await siteimages.save(env, user, body)); }\n'
     f'  if (path === "/api/ai-policy") {{ {OWNER[2:-2]} return json(await aipolicy.save(env, user, body)); }}\n'
     f'  if (path === "/api/ai-policy/undo") {{ {OWNER[2:-2]} return json(await aipolicy.undo(env, user)); }}\n'
     f'  if (path === "/api/ai-policy/check") {{ {OWNER[2:-2]} return json(await aipolicy.check(env, body)); }}\n',
     "write routes")
edit("ui.js", '  if (CFG.autopilot && CAPS.groups.CRM) NAV_TOP.push(["/finder", "Lead finder"], ["/resumes", "Resume builder"]);\n',
     '  if (CFG.autopilot && CAPS.groups.CRM) NAV_TOP.push(["/finder", "Lead finder"], ["/resumes", "Resume builder"]);\n'
     '  if (ME.role === "owner") NAV_TOP.push(["/ai", "AI limits"]);\n', "nav entry")
edit("ui.js", '"/finder": "Growth", ', '"/finder": "Growth", "/ai": "Growth", ', "nav section")
print("rb-command: AI limits " + (", ".join(changed) + " added" if changed else "already in place"))
