"""Gold skeletons for the main site's public loading states (artist-router, code only).

Usage: python3 -I patch_loading_states.py <pulled artist-router dir>

The shop, the store, the homepage roster and the homepage scoreboard showed a line of text ("Loading the shop…") until
their data arrived. Each now shows the shared gold skeleton (.rb-skel from /api/content/site-images.css, which every
artist-router page already loads), with the same words kept for screen readers (.rb-sr) and aria-busy on the holder.
The page's script replaces the holder's contents exactly as before, so nothing else changes. Where the stylesheet can't
load, the skeleton spans are empty and the words show as they used to.
The store's own wording ("Curating the storefront…", put in by a .replace() on the shop page) is kept in step: both the
shop's placeholder and the store's .replace() argument change together, so the store still finds and swaps it.
Running it twice changes nothing.
"""
import pathlib
import sys

folder = pathlib.Path(sys.argv[1])
p = folder / "artist-router-v14.js"
s = p.read_text(encoding="utf-8")


def skel(words, rows=("w60", "w40"), tag="p", attrs=""):
    bars = "".join(f'<span class="rb-skel {r}" aria-hidden="true"></span>' for r in rows)
    return f'<{tag}{attrs} aria-busy="true">{bars}<span class="rb-sr">{words}</span></{tag}>'


# (old, new, expected count). Strings are as they appear in the Worker's source (… is written out there).
EDITS = [
    ('<p class="shop-empty">Loading the shop\\u2026</p>', skel("Loading the shop\\u2026", ("w60", "", "w40"), attrs=' class="shop-empty"'), 2),
    ('<p class="shop-empty">Curating the storefront\\u2026</p>', skel("Curating the storefront\\u2026", ("w60", "", "w40"), attrs=' class="shop-empty"'), 1),
    ('<p style="color:var(--light)">Loading roster\\u2026</p>', skel("Loading roster\\u2026", ("round w40", "w60")), 1),
    ('<p class="rbs-empty">Loading today’s games…</p>', skel("Loading today’s games…", ("tall", "tall", "tall"), attrs=' class="rbs-empty"'), 1),
]
done = []
for old, new, n in EDITS:
    if new in s:
        continue
    c = s.count(old)
    if c != n:
        raise SystemExit(f"artist-router: expected {n} of {old[:60]!r}, found {c}")
    s = s.replace(old, new)
    done.append(old.split(">")[1][:30])
p.write_text(s, encoding="utf-8")
print("artist-router: loading states " + ("now gold skeletons: " + "; ".join(done) if done else "already in place"))
