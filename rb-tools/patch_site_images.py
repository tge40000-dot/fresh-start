"""Site images: pick which picture each RB site uses for its tab icon, share preview, background and header logo.

Usage: python3 -I patch_site_images.py <pulled rb-command dir | pulled rb-public-content dir>

- rb-command: copies rb-command-updates/src/siteimages.js and rb-tools/site_images_def.js in, then adds
  GET /images (the screen), GET /api/site-images, and POST /api/site-images, /api/site-images/undo,
  /api/site-images/asset and /api/site-images/asset/delete. Looking needs Content view, changing needs Content edit,
  the same as Site colours. "Site images" goes in the nav after "Affiliate ads" (its section is in patch_nav.py).
- rb-public-content: copies rb-site-updates/src/site-images-public.js and site_images_def.js in, then serves
  /api/content/site-image and /api/content/site-images.css (see that file).
Each site's pages link these through rb-tools/patch_icons.py. Running it twice changes nothing.
"""
import json
import pathlib
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
d = pathlib.Path(sys.argv[1])
name = json.loads((d / "manifest.json").read_text())["script"]
shutil.copyfile(ROOT / "rb-tools" / "site_images_def.js", d / "site_images_def.js")
changed = []


def edit(file, old, new, what):
    p = d / file
    s = p.read_text(encoding="utf-8")
    # Done already, even if another patch has since added its own block at the same anchor: look for the first
    # line this edit adds.
    added = new.replace(old, "", 1) if old in new else new
    first = next((ln for ln in added.split("\n") if ln.strip()), "")
    if new in s or (len(first.strip()) > 20 and first in s):
        return
    if s.count(old) != 1:
        raise SystemExit(f"{name}/{file}: {what}: anchor found {s.count(old)} times")
    p.write_text(s.replace(old, new), encoding="utf-8")
    changed.append(what)


if name == "rb-command":
    shutil.copyfile(ROOT / "rb-command-updates" / "src" / "siteimages.js", d / "siteimages.js")
    edit("index.js", 'import * as sitetheme from "./sitetheme.js";\n', 'import * as sitetheme from "./sitetheme.js";\nimport * as siteimages from "./siteimages.js";\n', "import")
    edit("index.js", '    if (path === "/finder" || path === "/resumes") {\n',
         '    if (path === "/images") {\n'
         '      needs(user, "Content", "view");\n'
         '      const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));\n'
         '      return new Response(siteimages.page(nonce, auth.can(user.role, "Content", "edit")), { headers: { ...BASE_HEADERS, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": siteimages.csp(nonce), "X-Frame-Options": "DENY" } });\n'
         '    }\n'
         '    if (path === "/finder" || path === "/resumes") {\n', "page route")
    edit("index.js", '    if (path === "/api/site-theme") { needs(user, "Content", "view"); return json(await sitetheme.get(env)); }\n',
         '    if (path === "/api/site-theme") { needs(user, "Content", "view"); return json(await sitetheme.get(env)); }\n'
         '    if (path === "/api/site-images") { needs(user, "Content", "view"); return json(await siteimages.get(env)); }\n', "read route")
    edit("index.js", '  if (path === "/api/site-theme") { needs(user, "Content", "edit"); return json(await sitetheme.save(env, user, body)); }\n',
         '  if (path === "/api/site-theme") { needs(user, "Content", "edit"); return json(await sitetheme.save(env, user, body)); }\n'
         '  if (path === "/api/site-images") { needs(user, "Content", "edit"); return json(await siteimages.save(env, user, body)); }\n'
         '  if (path === "/api/site-images/undo") { needs(user, "Content", "edit"); return json(await siteimages.undo(env, user)); }\n'
         '  if (path === "/api/site-images/asset") { needs(user, "Content", "edit"); return json(await siteimages.addAsset(env, user, body)); }\n'
         '  if (path === "/api/site-images/asset/delete") { needs(user, "Content", "edit"); return json(await siteimages.removeAsset(env, user, body)); }\n', "write routes")
    edit("ui.js", '  if (T.ads && T.ads.canEdit && CFG.uploads) NAV_TOP.push(["affiliate", "Affiliate ads"]);\n',
         '  if (T.ads && T.ads.canEdit && CFG.uploads) NAV_TOP.push(["affiliate", "Affiliate ads"]);\n'
         '  if (CAPS.groups.Content) NAV_TOP.push(["/images", "Site images"]);\n', "nav entry")
elif name == "rb-public-content":
    shutil.copyfile(ROOT / "rb-site-updates" / "src" / "site-images-public.js", d / "site-images-public.js")
    edit("rb-public-content.js", 'import { parseSetting, themeFor, siteCss, MAPPED_SITES } from "./theme.js";\n',
         'import { parseSetting, themeFor, siteCss, MAPPED_SITES } from "./theme.js";\nimport { siteImage, siteImagesCss } from "./site-images-public.js";\n', "import")
    edit("rb-public-content.js", '    if (path === "/api/content/theme.css") return themeCss(request, env, ctx, url);\n',
         '    if (path === "/api/content/theme.css") return themeCss(request, env, ctx, url);\n'
         '    if (path === "/api/content/site-image") return siteImage(request, env, ctx, url);\n'
         '    if (path === "/api/content/site-images.css") return siteImagesCss(request, env, ctx, url);\n', "routes")
else:
    raise SystemExit(f"{name}: patch_site_images.py is for rb-command and rb-public-content")
print(f"{name}: site images " + (", ".join(changed) + " added" if changed else "already in place"))
