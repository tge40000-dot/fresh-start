"""RB World's controls in RB Command (team.relentlessbillionaire.com/world). Apply after patch_badges_admin.py.

Usage: python3 -I patch_world_admin.py <pulled rb-command dir>

Copies src/worldadmin.js in, then:
- GET /world (the page) and GET /api/world-admin (its numbers) for Badges view;
- POST /api/world-admin/settings, /chat-delete, /block, /unblock and /lot-release for Badges edit;
- "RB World" in the nav, right after the Badge desk.
The game's "Enter as Admin" links here (rb-site-updates/src/world/). Running it twice changes nothing.
"""
import pathlib
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
folder = pathlib.Path(sys.argv[1])
shutil.copyfile(HERE / "src" / "worldadmin.js", folder / "worldadmin.js")
changed = []


def edit(name, old, new, what):
    p = folder / name
    s = p.read_text(encoding="utf-8")
    added = new.replace(old, "", 1) if old in new else new
    first = next((ln for ln in added.split("\n") if len(ln.strip()) > 20), "")
    if new in s or (first and first in s):
        return
    if s.count(old) != 1:
        raise SystemExit(f"rb-command/{name}: {what}: anchor found {s.count(old)} times")
    p.write_text(s.replace(old, new), encoding="utf-8")
    changed.append(what)


edit("index.js", 'import * as badgedesk from "./badgedesk.js";\n',
     'import * as badgedesk from "./badgedesk.js";\nimport * as worldadmin from "./worldadmin.js";\n', "import")
edit("index.js", '    if (path === "/badge-desk") {\n',
     '    if (path === "/world") {\n'
     '      needs(user, "Badges", "view");\n'
     '      const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));\n'
     '      return new Response(worldadmin.page(nonce, auth.can(user.role, "Badges", "edit")), { headers: { ...BASE_HEADERS, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": worldadmin.csp(nonce), "X-Frame-Options": "DENY" } });\n'
     '    }\n'
     '    if (path === "/badge-desk") {\n', "page route")
edit("index.js", '    if (path === "/api/badge-desk") {',
     '    if (path === "/api/world-admin") { needs(user, "Badges", "view"); return json(await worldadmin.summary(env)); }\n'
     '    if (path === "/api/badge-desk") {', "read route")
edit("index.js", '  if (path === "/api/badge-desk/lookup") {',
     '  if (path === "/api/world-admin/settings") { needs(user, "Badges", "edit"); return json(await worldadmin.saveSettings(env, user, body)); }\n'
     '  if (path === "/api/world-admin/chat-delete") { needs(user, "Badges", "edit"); return json(await worldadmin.deleteChat(env, user, body)); }\n'
     '  if (path === "/api/world-admin/block") { needs(user, "Badges", "edit"); return json(await worldadmin.block(env, user, body)); }\n'
     '  if (path === "/api/world-admin/unblock") { needs(user, "Badges", "edit"); return json(await worldadmin.unblock(env, user, body)); }\n'
     '  if (path === "/api/world-admin/lot-release") { needs(user, "Badges", "edit"); return json(await worldadmin.releaseLot(env, user, body)); }\n'
     '  if (path === "/api/badge-desk/lookup") {', "write routes")
edit("ui.js", '  if (CAPS.groups.Badges === "edit" || CAPS.groups.Club === "edit") NAV_TOP.push(["/badge-desk", "Badge desk"]);\n',
     '  if (CAPS.groups.Badges === "edit" || CAPS.groups.Club === "edit") NAV_TOP.push(["/badge-desk", "Badge desk"]);\n'
     '  if (CAPS.groups.Badges) NAV_TOP.push(["/world", "RB World"]);\n', "nav entry")
print("rb-command: RB World controls " + (", ".join(changed) + " added" if changed else "already in place"))
