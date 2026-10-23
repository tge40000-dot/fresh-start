"""/release (rb-release): no "flat" wording, and only claims the license terms back up.

Usage: python3 -I patch_release_copy.py <pulled rb-release dir>

- "30 BEATS • ALL FLATS", "You bought the flat for $1", "GET A $1 BEAT", "$1 FLAT" and #allflats are gone. The page
  doesn't state a beat price at all: prices live in the beatstore and change there.
- "$500 VALUE" is gone (no basis for it); "Your cost today $0" stays, the license is free.
- "Content ID safe" (the beats are licensed non-exclusively, so Content ID can't be promised) and "Viral cleared"
  become what the terms actually grant: monetize on any platform, commercial use.
- "then we spin it on Global Radio" becomes "submit it for Global Radio rotation": radio is opt-in and reviewed.
- The beat picker no longer shows "$1" when a beat has no price, and the terms summary no longer says "$1".
"12 Piece All Flats" on the events pages is a show's name, not this wording, and stays.
Running it twice changes nothing.
"""
import pathlib
import sys

p = pathlib.Path(sys.argv[1]) / "rb-release-worker.js"
s = p.read_text(encoding="utf-8")
edits = [
    ('30 BEATS &bull; ALL FLATS &bull; MULTI-USE RIGHTS', 'RB BEATS &bull; MULTI-USE RIGHTS &bull; GLOBAL RADIO'),
    ('<p class="lede">You bought the flat for $1. Now make it immortal. Upload your finished master and get your\n'
     '    <strong style="color:#fff">multi-use license instantly</strong> &mdash; then we spin it on Global Radio.</p>',
     '<p class="lede">Recorded on an RB beat? Now make it official. Upload your finished master and get your\n'
     '    <strong style="color:#fff">multi-use license instantly</strong> &mdash; then submit it for Global Radio rotation.</p>'),
    ('href="https://beatstore.relentlessbillionaire.com">GET A $1 BEAT</a>', 'href="https://beatstore.relentlessbillionaire.com">GET A BEAT</a>'),
    ('<b>01 &nbsp;BEATSTORE</b><span>$1 FLAT</span>', '<b>01 &nbsp;BEATSTORE</b><span>PICK A BEAT</span>'),
    ('<strong class="serif" style="font-size:32px;color:var(--gold)">$0</strong>\n              <span class="hint" style="text-decoration:line-through">$500 VALUE</span></span>',
     '<strong class="serif" style="font-size:32px;color:var(--gold)">$0</strong></span>'),
    ('<p class="hint">The $1 was the beat. The license is included.</p>', '<p class="hint">The license comes with your beat. There is nothing to pay here.</p>'),
    ('<div><b>YouTube</b><span>Content ID safe</span></div>', '<div><b>YouTube</b><span>Monetize your uploads</span></div>'),
    ('<div><b>TikTok / Reels</b><span>Viral cleared</span></div>', '<div><b>TikTok / Reels</b><span>Commercial use included</span></div>'),
    ('"#nogatekeepers", "#allflats", "#baytobroadcast"', '"#nogatekeepers", "#baytobroadcast"'),
    ("btn.querySelector('span').textContent=(b.price||'$1')+(b.genre?' \\\\u2022 '+b.genre:'');",
     "btn.querySelector('span').textContent=[b.price,b.genre].filter(Boolean).join(' \\\\u2022 ');"),
    ('Plain-language summary: you bought the beat for $1, you own your record,', 'Plain-language summary: you licensed the beat, you own your record,'),
]
done = 0
for old, new in edits:
    if new in s:
        continue
    if s.count(old) != 1:
        raise SystemExit(f"rb-release: anchor found {s.count(old)} times: {old[:80]!r}")
    s = s.replace(old, new)
    done += 1
if done:
    p.write_text(s, encoding="utf-8")
left = [w for w in ("ALL FLATS", "$1 FLAT", "the flat", "#allflats", "$1 BEAT", "$500 VALUE", "Content ID safe", "Viral cleared") if w in s]
if left:
    raise SystemExit(f"rb-release: still on the page: {left}")
print(f"rb-release: copy updated ({done} edit(s))" if done else "rb-release: copy already updated")
