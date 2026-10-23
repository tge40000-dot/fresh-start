"""Keep the media kit's traffic numbers up to date in a pulled rb-command Worker. Apply after patch_analytics.py and
patch_scheduled.py.

Usage: python3 -I patch_media_kit.py <pulled rb-command dir>

Copies src/mediakit.js in. Then:
- the daily scheduled run saves the last 30 days' totals for relentlessbillionaire.com/advertise;
- opening Analytics for 30 days across all sites saves them too, so the page doesn't wait for the next daily run.
  (A separate line above the Analytics route, which stays exactly as patch_analytics.py wrote it.)
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
LINE = '    if (path === "/api/analytics") return json(await analytics.report(env, ctx, url.searchParams));\n'
HOOK = ('    // Media kit: a 30-day, all-sites Analytics view also saves its totals for /advertise (patch_media_kit.py).\n'
        '    if (path === "/api/analytics" && url.searchParams.get("range") === "30d" && !url.searchParams.get("host") && url.searchParams.get("bots") !== "1") ctx.waitUntil(mediakit.refresh(env, ctx).catch((e) => console.error("media kit", e && e.message)));\n')
BLOCK = ('    if (path === "/api/analytics") {\n'
         '      const r = await analytics.report(env, ctx, url.searchParams);\n'
         '      ctx.waitUntil(mediakit.save(env, r).catch((e) => console.error("media kit", e && e.message)));\n'
         '      return json(r);\n'
         '    }\n')
edits = [
    ('import * as analytics from "./analytics.js";\n',
     'import * as analytics from "./analytics.js";\nimport * as mediakit from "./mediakit.js";\n'),
    (LINE, HOOK + LINE),
    ('  await showplanner.topUp(env).catch((e) => console.error("daily: show planner", e && e.message));\n',
     '  await showplanner.topUp(env).catch((e) => console.error("daily: show planner", e && e.message));\n'
     '  await mediakit.refresh(env).catch((e) => console.error("daily: media kit", e && e.message));\n'),
]
changed = False
# An earlier version of this patch rewrote the Analytics route into a block, which made patch_analytics.py add its
# route again. Put the route back as patch_analytics.py wrote it (once) and keep the save on its own line above it.
if BLOCK in s:
    s = s.replace(BLOCK, "" if LINE in s else LINE)
    changed = True
for old, new in edits:
    # done already, even if another patch has since added its own line at the same anchor: look for the first
    # distinctive line this edit adds
    added = new.replace(old, "", 1) if old in new else new
    first = next((ln for ln in added.split("\n") if len(ln.strip()) > 20), "")
    if new in s or (first and first in s):
        continue
    if s.count(old) != 1:
        raise SystemExit(f"rb-command/index.js: anchor found {s.count(old)} times: {old[:70]!r}")
    s = s.replace(old, new)
    changed = True
if changed:
    p.write_text(s, encoding="utf-8")
print("rb-command: media kit " + ("hooked in" if changed else "already hooked in"))
