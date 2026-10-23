"""Fix the homepage's "Live watch" line that said "Loading today's games and forecasts…" all day (artist-router).

Usage: python3 -I patch_home_status.py <pulled artist-router dir>

When ESPN had no featured games, the scoreboard script stopped early, before it updated the status line, so the line kept
its loading text all day (seen 17 Oct 2026: /api/scoreboard returned "games": []). Now the empty case also sets the line.
Running it twice changes nothing.
"""
import json
import pathlib
import re
import sys

folder = pathlib.Path(sys.argv[1])
files = [p for p in folder.glob("*.js") if "var RB_HUB_CLIENT = " in p.read_text(encoding="utf-8")]
if len(files) != 1:
    raise SystemExit(f"artist-router: RB_HUB_CLIENT found in {len(files)} files")
p = files[0]
s = p.read_text(encoding="utf-8")
m = re.search(r'var RB_HUB_CLIENT = ("(?:[^"\\]|\\.)*");', s)
js = json.loads(m.group(1))
OLD = "if (!games.length) { list.innerHTML = '<p class=\"rbs-empty\">No featured games today. Check back tomorrow.</p>'; if (chips) chips.innerHTML = ''; if (more) more.hidden = true; return; }"
NEW = "if (!games.length) { list.innerHTML = '<p class=\"rbs-empty\">No featured games today. Check back tomorrow.</p>'; if (chips) chips.innerHTML = ''; if (more) more.hidden = true; var s0 = document.getElementById('rb-live-status'); if (s0) s0.textContent = 'No featured games today. Forecasts update on their own.'; return; }"
if NEW in js:
    print("artist-router: homepage status already fixed")
elif js.count(OLD) != 1:
    raise SystemExit(f"artist-router: anchor found {js.count(OLD)} times")
else:
    js = js.replace(OLD, NEW)
    s = s[: m.start(1)] + json.dumps(js, ensure_ascii=False) + s[m.end(1):]
    p.write_text(s, encoding="utf-8")
    print("artist-router: homepage status fixed for days with no games")
