"""One row of tabs at the top of every RB site for users, linking all of them, with the current site highlighted.

Usage: python3 -I patch_tabs.py <pulled Worker dir> [more dirs...]   (also workers/rb-daw/src)

Each page's <body> gets <nav class="rbtabs" hidden>: plain links, no script. The look comes from the stylesheet every
site already loads (/api/content/site-images.css, served by rb-public-content, see site-images-public.js): it shows
the bar and styles it. Where a page can't load that stylesheet (its CSP blocks it), the bar stays hidden rather than
showing as bare links. On phones the row scrolls sideways.

The current tab is the Worker's site; artist-router serves several (home, the store, RB Create), so its pages pick
theirs from their <title> or data-route. RB Command's pages are for the team and get no bar.
Running it twice changes nothing; a later run brings an older bar up to date with TABS.
"""
import json
import pathlib
import re
import sys

M = "https://relentlessbillionaire.com"
TABS = [
    ("home", "Home", f"{M}/"), ("events", "Events", f"{M}/events"), ("shop", "Shop", f"{M}/store"),
    ("beats", "Beats", "https://beatstore.relentlessbillionaire.com/"), ("mastering", "Mix & Master", f"{M}/studio/"),
    ("studio", "Record", "https://studio.relentlessbillionaire.com/"), ("create", "Create", f"{M}/create"),
    ("tv", "RB TV", f"{M}/tv"), ("radio", "Radio", f"{M}/radio"), ("release", "Release", f"{M}/release"),
    ("game", "Game", f"{M}/game/"), ("jobs", "Jobs", f"{M}/jobs"), ("memberships", "Memberships", f"{M}/memberships"),
    ("fund", "Fund", f"{M}/fund"),
]
WORKER_TAB = {"beatstore": "beats", "rb-tv": "tv", "rb-daw": "studio", "rb-mastering-studio": "mastering",
              "rb-fund-campaign": "fund", "rb-memberships": "memberships", "rb-events-page": "events", "rb-radio": "radio",
              "rb-radio-hub": "radio", "rb-release": "release", "rb-jobs": "jobs", "relentless-hub": None,
              "rb-partners": None, "artist-router": "by-page"}
NAV = re.compile(r'<nav class=(\\?)"rbtabs\1".*?</nav>(?:<style nonce=\\"__NONCE__\\">nav\.rbtabs.*?</style>)?', re.S)
PUBLIC = pathlib.Path(__file__).resolve().parent.parent / "rb-site-updates" / "src" / "site-images-public.js"


def tabs_css():
    """The bar's rules, read from the shared stylesheet's source so there is one copy (TABS_CSS there)."""
    src = PUBLIC.read_text(encoding="utf-8")
    block = src[src.index("const TABS_CSS = "):]
    block = block[: block.index(";\n")]
    return "".join(re.findall(r"'((?:[^'\\]|\\.)*)'", block)).replace("\\n", "")
BODY = re.compile(r"<body\b[^>]*>", re.I)


def nav(cur, esc):
    cur_attr = ' aria-current="page"'
    links = "".join(f'<a href="{u}"{cur_attr if k == cur else ""}>{label.replace("&", "&amp;")}</a>' for k, label, u in TABS)
    html = f'<nav class="rbtabs" hidden aria-label="Relentless Billionaire sites">{links}</nav>'
    return html.replace('"', '\\"') if esc else html


def in_dq_string(s, at):
    """Whether position at is inside a double-quoted JS string (HTML kept as "<!doctype html>\\n..." on one line):
    an odd number of unescaped quotes on the source line before it."""
    line = s[s.rfind("\n", 0, at) + 1:at]
    return len(re.findall(r'(?<!\\)"', re.sub(r"\\\\.", "", line))) % 2 == 1


def page_tab(s, at):
    """artist-router: which tab a page is, from its <title> or data-route (the nearest before its <body>)."""
    head = s[max(0, s.rfind("<head", 0, at)):at]
    title = (re.findall(r"<title>(.*?)</title>", head, re.S) or [""])[-1].lower()
    body = BODY.match(s, at).group(0)
    if 'data-route="home"' in body or 'data-route=\\"home\\"' in body:
        return "home"
    if "rb create" in title or title.startswith("create"):
        return "create"
    if "store" in title or "shop" in title:
        return "shop"
    return None


def patch_text(s, worker):
    mode = WORKER_TAB[worker]
    out, i, n = [], 0, 0
    for m in BODY.finditer(s):
        esc = in_dq_string(s, m.start())
        cur = page_tab(s, m.start()) if mode == "by-page" else mode
        want = nav(cur, esc)
        # A page whose CSP takes only nonced styles (RB Create) can't load the shared stylesheet: give it the same
        # rules in a style tag with the nonce placeholder its Worker fills in per request.
        if esc and 'nonce=\\"__NONCE__\\"' in s[max(0, s.rfind("<head", 0, m.start())):m.start()]:
            want += '<style nonce=\\"__NONCE__\\">' + tabs_css().replace("\\", "\\\\").replace('"', '\\"') + "</style>"
        out.append(s[i:m.end()])
        i = m.end()
        old = NAV.match(s, i)
        if old:
            if old.group(0) != want:
                out.append(want)
                i = old.end()
                n += 1
            continue
        out.append(want)
        n += 1
    out.append(s[i:])
    return "".join(out), n


for arg in sys.argv[1:]:
    d = pathlib.Path(arg)
    name = json.loads((d / "manifest.json").read_text())["script"] if (d / "manifest.json").exists() else d.name
    worker = "rb-daw" if d.name == "src" and d.parent.name == "rb-daw" else name
    if worker not in WORKER_TAB:
        print(f"{name}: not a site for users, no tabs")
        continue
    total = 0
    for f in sorted([*d.glob("*.js"), *d.glob("*.html")]):
        if f.name in ("brand_icons.js",):
            continue
        s = f.read_text(encoding="utf-8")
        s2, k = patch_text(s, worker)
        if s2 != s:
            f.write_text(s2, encoding="utf-8")
            total += k
    print(f"{name}: tabs {'added or updated in ' + str(total) + ' page(s)' if total else 'already in place'}")
