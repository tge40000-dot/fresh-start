"""Add the Cover maker (team.relentlessbillionaire.com/cover) next to the video creator in a pulled rb-command Worker.

Usage: python3 -I patch_cover.py <pulled rb-command dir>

Copies src/cover.js in, then:
- GET /cover for anyone who can open the video creator (RB TV, view);
- "Cover maker" in the nav right after "Video creator", with the same icon. Its place under "Shows & sites" is in
  patch_nav.py and the video creator's header link to it is in patch_video.py, the patches that own those blocks.
It reads RB's catalog through the video creator's /api/video/library and /api/video/media. Running it twice changes nothing.
"""
import pathlib
import re
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
folder = pathlib.Path(sys.argv[1])
shutil.copyfile(HERE / "src" / "cover.js", folder / "cover.js")
changed = []


def edit(name, old, new, what):
    p = folder / name
    s = p.read_text(encoding="utf-8")
    if new in s:
        return
    if s.count(old) != 1:
        raise SystemExit(f"rb-command/{name}: {what}: anchor found {s.count(old)} times")
    p.write_text(s.replace(old, new), encoding="utf-8")
    changed.append(what)


edit("index.js", 'import * as video from "./video.js";\n', 'import * as video from "./video.js";\nimport * as cover from "./cover.js";\n', "import")
edit("index.js", '    if (path === "/finder" || path === "/resumes") {\n',
     '    if (path === "/cover") {\n'
     '      needs(user, "TV", "view");\n'
     '      const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));\n'
     '      return new Response(cover.page(nonce), { headers: { ...BASE_HEADERS, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": cover.csp(nonce), "X-Frame-Options": "DENY" } });\n'
     '    }\n'
     '    if (path === "/finder" || path === "/resumes") {\n', "route")
edit("ui.js", 'if (CAPS.groups.TV) NAV_TOP.push(["/video", "Video creator"]);', 'if (CAPS.groups.TV) NAV_TOP.push(["/video", "Video creator"], ["/cover", "Cover maker"]);', "nav entry")
ui = (folder / "ui.js").read_text(encoding="utf-8")
m = re.search(r'\.nav a\[href="/video"\]\{--ic:url\("[^"]*"\)\}', ui)
if m and '.nav a[href="/cover"]' not in ui:
    edit("ui.js", m.group(0), m.group(0) + m.group(0).replace('href="/video"', 'href="/cover"'), "nav icon")
print("rb-command: cover maker " + (", ".join(changed) + " added" if changed else "already in place"))
