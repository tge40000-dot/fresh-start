"""RB TV video cards: the thumbnail link gets the video's title as its accessible name (rb-tv, views.js).

Usage: python3 -I patch_tv_a11y.py <pulled rb-tv dir>

Each grid card has two links to the video: the thumbnail (an image with empty alt text) and the title. Screen readers
announced the thumbnail as a bare "link". It now reads the video's title. Nothing visible changes (RB TV's layout stays
exactly as it is). Running it twice changes nothing.
"""
import pathlib
import sys

p = pathlib.Path(sys.argv[1]) / "views.js"
s = p.read_text(encoding="utf-8")
old = '<article class="card"><a class="cl" href="${href}">${thumb(v, "", SIZES.grid)}</a>'
new = '<article class="card"><a class="cl" href="${href}" aria-label="${esc(v.title)}">${thumb(v, "", SIZES.grid)}</a>'
if new in s:
    print("rb-tv: card links already named")
else:
    if s.count(old) != 1:
        raise SystemExit(f"rb-tv/views.js: card thumbnail link: anchor found {s.count(old)} times")
    p.write_text(s.replace(old, new), encoding="utf-8")
    print("rb-tv: card thumbnail links named")
