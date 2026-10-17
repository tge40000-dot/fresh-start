"""Add sponsored slots to RB TV (rb-tv). Needs the main site's /api/ads/slot.js (patch_artist_router.py).

Usage: python3 -I patch_tv.py <pulled rb-tv dir>

The TV home gets a slot after the video grid, and every watch page one under "Up next". Each shows up to two ads set
to RB TV or Everywhere (one on watch pages), and stays hidden when no ad is live. Running it twice changes nothing.
"""
import pathlib
import sys

p = pathlib.Path(sys.argv[1]) / "views.js"
s = p.read_text(encoding="utf-8")
SLOT = 'const AD_SLOT = (max = 2) => `<section class="rb-ad-slot" data-rb-ads="tv" data-rb-ads-max="${max}" hidden></section>`;\n'
EDITS = [
    ('export function layout({', SLOT + '\nexport function layout({'),
    ('<script src="/tv/assets/tv.js?v=${BUILD}" defer></script>\n', '<script src="/tv/assets/tv.js?v=${BUILD}" defer></script>\n<script src="/api/ads/slot.js" defer></script><link rel="stylesheet" href="/api/ads/slot.css">\n'),
    ('if (!cat && featured) return h1 + hubTop({ featured, shorts, beats }, L) + resume + following + chips + grid + beatsShelf(beats, L)',
     'if (!cat && featured) return h1 + hubTop({ featured, shorts, beats }, L) + resume + following + chips + grid + AD_SLOT() + beatsShelf(beats, L)'),
    ('return h1 + chips + hero + resume + following + grid + shelf + (cat ? "" : beatsShelf(beats, L)',
     'return h1 + chips + hero + resume + following + grid + AD_SLOT() + shelf + (cat ? "" : beatsShelf(beats, L)'),
    ('`<p class="muted">${esc(L.t("more_soon"))}</p>`}${signupBox("watch", true, L)}</aside>',
     '`<p class="muted">${esc(L.t("more_soon"))}</p>`}${AD_SLOT(1)}${signupBox("watch", true, L)}</aside>'),
]
changed = False
for old, new in EDITS:
    if new in s:
        continue
    if s.count(old) != 1:
        raise SystemExit(f"views.js: anchor found {s.count(old)} times: {old[:60]!r}")
    s = s.replace(old, new); changed = True
p.write_text(s, encoding="utf-8")
print("rb-tv: sponsored slots added" if changed else "rb-tv: already in place")
