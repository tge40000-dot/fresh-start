"""Add a sponsored slot to the RB Radio page (rb-radio). Needs the main site's /api/ads/slot.js (patch_artist_router.py).

Usage: python3 -I patch_radio.py <pulled rb-radio dir>

Under "Up next / Recently played" the page gets a slot showing up to two ads set to RB Radio or Everywhere. It stays
hidden when no ad is live. Running it twice changes nothing.
"""
import json
import pathlib
import re
import sys

p = pathlib.Path(sys.argv[1]) / "index.js"
s = p.read_text(encoding="utf-8")
m = re.search(r'const PAGE_HTML = ("(?:[^"\\]|\\.)*");', s)
html = json.loads(m.group(1))
EDITS = [
    ('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:wght@500;700&family=Manrope:wght@400;500;600;700&display=swap">\n',
     '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:wght@500;700&family=Manrope:wght@400;500;600;700&display=swap">\n<link rel="stylesheet" href="/api/ads/slot.css">\n'),
    ('  <div class="card"><h2>Recently played</h2><ol class="list" id="recent"><li class="empty">Loading the schedule…</li></ol></div>\n</section>\n',
     '  <div class="card"><h2>Recently played</h2><ol class="list" id="recent"><li class="empty">Loading the schedule…</li></ol></div>\n</section>\n\n<section class="rb-ad-slot" data-rb-ads="radio" hidden></section>\n'),
    ('<script src="/radio/embed.js" data-bar="off"></script>\n',
     '<script src="/radio/embed.js" data-bar="off"></script>\n<script src="/api/ads/slot.js" defer></script>\n'),
]
changed = False
for old, new in EDITS:
    if new in html:
        continue
    if html.count(old) != 1:
        raise SystemExit(f"anchor found {html.count(old)} times: {old[:60]!r}")
    html = html.replace(old, new); changed = True
if changed:
    s = s[: m.start(1)] + json.dumps(html, ensure_ascii=False) + s[m.end(1):]
    p.write_text(s, encoding="utf-8")
    print("rb-radio: sponsored slot added")
else:
    print("rb-radio: already in place")
