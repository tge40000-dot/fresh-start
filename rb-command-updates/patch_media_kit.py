"""Keep the media kit's traffic numbers up to date in a pulled rb-command Worker. Apply after patch_analytics.py and
patch_scheduled.py.

Usage: python3 -I patch_media_kit.py <pulled rb-command dir>

Copies src/mediakit.js in. Then:
- the daily scheduled run saves the last 30 days' totals for relentlessbillionaire.com/advertise;
- opening Analytics for 30 days across all sites saves them too, so the page doesn't wait for the next daily run.
Only totals are saved (see mediakit.js). Running it twice changes nothing.
"""
import pathlib
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
folder = pathlib.Path(sys.argv[1])
shutil.copyfile(HERE / "src" / "mediakit.js", folder / "mediakit.js")

p = folder / "index.js"
s = p.read_text(encoding="utf-8")
edits = [
    ('import * as analytics from "./analytics.js";\n',
     'import * as analytics from "./analytics.js";\nimport * as mediakit from "./mediakit.js";\n'),
    ('    if (path === "/api/analytics") return json(await analytics.report(env, ctx, url.searchParams));\n',
     '    if (path === "/api/analytics") {\n'
     '      const r = await analytics.report(env, ctx, url.searchParams);\n'
     '      ctx.waitUntil(mediakit.save(env, r).catch((e) => console.error("media kit", e && e.message)));\n'
     '      return json(r);\n'
     '    }\n'),
    ('  await showplanner.topUp(env).catch((e) => console.error("daily: show planner", e && e.message));\n',
     '  await showplanner.topUp(env).catch((e) => console.error("daily: show planner", e && e.message));\n'
     '  await mediakit.refresh(env).catch((e) => console.error("daily: media kit", e && e.message));\n'),
]
changed = False
for old, new in edits:
    if new in s:
        continue
    if s.count(old) != 1:
        raise SystemExit(f"rb-command/index.js: anchor found {s.count(old)} times: {old[:70]!r}")
    s = s.replace(old, new)
    changed = True
if changed:
    p.write_text(s, encoding="utf-8")
print("rb-command: media kit " + ("hooked in" if changed else "already hooked in"))
