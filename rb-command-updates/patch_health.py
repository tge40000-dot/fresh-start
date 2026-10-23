"""Weekly health report in a pulled rb-command Worker. Apply after patch_scheduled.py and patch_media_kit.py.

Usage: python3 -I patch_health.py <pulled rb-command dir>

Copies src/health.js in. Then:
- the daily scheduled run makes the weekly report when the last one is 6.5 days old or more (every Worker's
  requests and errors for the last 7 days against the 7 before), saves it and writes one line to Activity;
- the Overview shows last week's line: a "watch" item, or an "act" item when a Worker had errors.
Running it twice changes nothing.
"""
import pathlib
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
folder = pathlib.Path(sys.argv[1])
shutil.copyfile(HERE / "src" / "health.js", folder / "health.js")
p = folder / "index.js"
s = p.read_text(encoding="utf-8")
edits = [
    ('import * as analytics from "./analytics.js";\n',
     'import * as analytics from "./analytics.js";\nimport * as weeklyHealth from "./health.js";\n'),
    ('  await mediakit.refresh(env).catch((e) => console.error("daily: media kit", e && e.message));\n',
     '  await mediakit.refresh(env).catch((e) => console.error("daily: media kit", e && e.message));\n'
     '  await weeklyHealth.weekly(env).catch((e) => console.error("daily: weekly health", e && e.message));\n'),
    ('  const rewardClaims = Number((await optional(env, "SELECT count(*) AS n FROM reward_claims WHERE status = \'requested\'"))?.[0]?.n) || 0;\n',
     '  // Last week\'s health report (made by the daily run, see health.js): every Worker\'s requests and errors.\n'
     '  const week = await weeklyHealth.latest(env);\n'
     '  if (week) need(week.errors ? "act" : "watch", "health_weekly", week.errors || 1, week.errors ? "Last week: Workers had errors" : "Last week: every Worker healthy", weeklyHealth.line(week), "#/analytics");\n'
     '  const rewardClaims = Number((await optional(env, "SELECT count(*) AS n FROM reward_claims WHERE status = \'requested\'"))?.[0]?.n) || 0;\n'),
]
changed = False
for old, new in edits:
    if new in s:
        continue
    if s.count(old) != 1:
        raise SystemExit(f"index.js: anchor found {s.count(old)} times: {old[:60]!r}")
    s = s.replace(old, new, 1)
    changed = True
if changed:
    p.write_text(s, encoding="utf-8")
    print("rb-command: weekly health report added")
else:
    print("rb-command: weekly health report already there")
