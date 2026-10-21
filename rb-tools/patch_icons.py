"""One bold icon on every RB site: a gold tile with a black "RB" that stays readable at 16 px.

Usage: python3 -I patch_icons.py <pulled Worker dir> [more dirs...]

The icon files are in rb-tools/brand (made by brand/make.mjs from brand/outline.mjs; the letters are outlined from
Liberation Serif Bold, so no font is needed to show them).

- rb-favicon: /favicon.ico becomes the new multi-size icon (16, 32 and 48 px). It is cached for a day instead of a
  year, so the next change reaches people.
- artist-router: serves the rest at /brand/icon.svg, /brand/apple-touch-icon.png, /brand/icon-192.png,
  /brand/icon-512.png, /brand/maskable-512.png and /brand/site.webmanifest.
- Every Worker given: each HTML page gets the same icon tags (SVG icon, .ico fallback, Apple touch icon), using
  absolute https://relentlessbillionaire.com URLs so the subdomains (studio, beatstore, team) show it too. Old icon
  and apple-touch-icon tags are replaced. Pages with a <meta charset> and no icon get the tags after it.
  A page's own web manifest (RB TV's) is left alone.
Site images (rb-tools/patch_site_images.py): on the RB sites in WORKER_SITE, the tags point at
/api/content/site-image?site=<id> instead, so RB Command > Site images can give each site its own icon (nothing chosen
means the RB icon). Those pages also get /api/content/site-images.css?site=<id> (background and header logo; empty
until one is chosen), and their share picture (og:image and twitter:image) goes through the same endpoint, falling back
to the page's own picture. A page with no share picture gets one (the RB icon until one is chosen). RB Command's own
pages keep the fixed RB icon.
Running it twice changes nothing.
"""
import base64
import json
import pathlib
import re
import sys

BRAND = pathlib.Path(__file__).resolve().parent / "brand"
V = "3"
SITE = "https://relentlessbillionaire.com"
# The .ico is linked from /brand/ (served by artist-router): the /favicon.ico route has no "*", so it doesn't match a
# URL with ?v= on it.
STATIC = (f'<link rel="icon" href="{SITE}/brand/icon.svg?v={V}" type="image/svg+xml">'
          f'<link rel="icon" href="{SITE}/brand/favicon.ico?v={V}" sizes="48x48">'
          f'<link rel="apple-touch-icon" href="{SITE}/brand/apple-touch-icon.png?v={V}">')
STATIC_PREV = [STATIC.replace(f"{SITE}/brand/favicon.ico?v={V}", f"{SITE}/favicon.ico?v={V}")]
# Which site each Worker's pages are, for Site images. Workers not listed keep the fixed RB icon.
WORKER_SITE = {"artist-router": "home", "beatstore": "beats", "rb-tv": "tv", "rb-daw": "studio", "rb-mastering-studio": "mastering",
               "rb-fund-campaign": "fund", "rb-memberships": "memberships", "rb-events-page": "events", "rb-radio": "radio",
               "rb-radio-hub": "radio", "rb-release": "release", "relentless-hub": "home", "rb-partners": "partners", "rb-jobs": "jobs"}


def site_tags(site):
    img = f"{SITE}/api/content/site-image?site={site}&amp;slot="
    return (f'<link rel="icon" href="{img}icon&amp;v=4"><link rel="apple-touch-icon" href="{img}apple&amp;v=4">'
            f'<link rel="stylesheet" href="{SITE}/api/content/site-images.css?site={site}">')


# Set per Worker in the loop at the bottom: the tags its pages get, the earlier tags they replace, and the text that
# shows a page already has them.
TAGS, PREV_TAGS, MARK, SHARE_SITE = STATIC, STATIC_PREV, f"/brand/icon.svg?v={V}", None
# Whether the Worker already has share pictures somewhere (then none is added: RB TV, for one, builds them per video).
HAS_OG = False
SITE_ID = None
NO_SHARE = {"tv"}  # sites whose share pictures stay their own (see site_images_def.js)
OURS = (f"{SITE}/brand/", f"{SITE}/api/content/site-image")  # any of our tags
OLD_LINK = re.compile(r'<link\b(?=[^>]*\brel=(\\?)["\']?(?:shortcut icon|icon|apple-touch-icon)\1["\'\s>])[^>]*>', re.I)
CHARSET = re.compile(r'<meta\s+charset=(\\?)["\']?utf-8\1["\']?\s*/?>', re.I)


def tags(esc):
    return TAGS.replace('"', '\\"') if esc else TAGS


def one_per_page(s):
    """Keeps the first set of our tags in each page's head and drops any later copies (a page that had two old icon
    tags, not side by side, gets one set)."""
    parts = re.split(r"(?=<head[\s>])", s, flags=re.I)  # one part per page, from its <head>
    for i, part in enumerate(parts):
        for esc in (False, True):
            t = tags(esc)
            first = part.find(t)
            if first != -1:
                part = part[: first + len(t)] + part[first + len(t):].replace(t, "")
        parts[i] = part
    return "".join(parts)


def tag_html(s):
    """Replace old icon tags with ours and add ours after <meta charset> where a page has none."""
    before = s
    if SITE_ID:  # a Worker moved to another site id: retarget its earlier tags, links and share pictures
        s = re.sub(r"(api/content/site-image\?site=)[a-z]+(&amp;slot=)", lambda m: m.group(1) + SITE_ID + m.group(2), s)
        s = re.sub(r"(api/content/site-images\.css\?site=)[a-z]+", lambda m: m.group(1) + SITE_ID, s)
    for prev in PREV_TAGS:
        s = s.replace(prev, TAGS).replace(prev.replace('"', '\\"'), tags(True))
    s = one_per_page(s)
    n = int(s != before)

    def swap(m):
        nonlocal n
        n += 1
        return tags(bool(m.group(1))) if "\\" not in m.group(0) or m.group(1) else tags(True)
    s = OLD_LINK.sub(lambda m: m.group(0) if any(o in m.group(0) for o in OURS) else swap(m), s)
    for esc in (False, True):  # one set per page, even where a page had two icon tags
        t = re.escape(tags(esc))
        s = re.sub(f"({t})(?:\\s*{t})+", r"\1", s)
    out, i = [], 0
    for m in CHARSET.finditer(s):
        head_end = s.find("</head", m.end())
        window = s[m.end(): head_end if head_end != -1 else m.end() + 4000]
        out.append(s[i:m.end()])
        if MARK not in window:
            out.append(tags(bool(m.group(1))))
            n += 1
        if SHARE_SITE and not HAS_OG and "og:image" not in window:
            out.append(share_meta(bool(m.group(1))))
            n += 1
        i = m.end()
    out.append(s[i:])
    s = one_per_page("".join(out))
    if SHARE_SITE:
        s, k = share_html(s)
        n += k
    return s, n


def share_meta(esc):
    t = f'<meta property="og:image" content="{SITE}/api/content/site-image?site={SHARE_SITE}&amp;slot=share">'
    return t.replace('"', '\\"') if esc else t


SHARE = re.compile(r'((?:property|name)=(\\?)"(?:og:image|twitter:image)\2"\s+content=\2")')


def share_html(s):
    """Sends each og:image / twitter:image through the site-image endpoint, keeping the page's own picture as the
    fallback: a ${...} expression is wrapped (so it stays dynamic), a plain URL is encoded into the link."""
    base = f"{SITE}/api/content/site-image?site={SHARE_SITE}&amp;slot=share&amp;fallback="
    out, i, n = [], 0, 0
    for m in SHARE.finditer(s):
        j = m.end()
        out.append(s[i:j])
        i = j
        if s.startswith(f"{SITE}/api/content/site-image", j) or s.startswith('${"' + SITE + "/api/content/site-image", j):
            continue
        if s.startswith("${", j):
            depth, k = 0, j
            while k < len(s):
                if s[k] == "{":
                    depth += 1
                elif s[k] == "}":
                    depth -= 1
                    if depth == 0:
                        break
                k += 1
            expr = s[j + 2:k]
            out.append('${"' + base + '" + encodeURIComponent(String(' + expr + '))}')
            i = k + 1
            n += 1
        else:
            end = s.find('\\"' if m.group(2) else '"', j)
            url = s[j:end]
            if url.startswith("http"):
                from urllib.parse import quote
                out.append(base + quote(url, safe=""))
                i = end
                n += 1
    out.append(s[i:])
    return "".join(out), n


def b64(name):
    return base64.b64encode((BRAND / name).read_bytes()).decode()


MANIFEST = {
    "name": "Relentless Billionaire", "short_name": "RB", "start_url": "/", "display": "browser",
    "background_color": "#070708", "theme_color": "#070708",
    "icons": [
        {"src": f"/brand/icon-192.png?v={V}", "sizes": "192x192", "type": "image/png"},
        {"src": f"/brand/icon-512.png?v={V}", "sizes": "512x512", "type": "image/png"},
        {"src": f"/brand/maskable-512.png?v={V}", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        {"src": f"/brand/icon.svg?v={V}", "sizes": "any", "type": "image/svg+xml"},
    ],
}


def artist_router(d):
    files = {"icon.svg": ("image/svg+xml", b64("icon.svg")), "favicon.ico": ("image/x-icon", b64("favicon.ico")), "apple-touch-icon.png": ("image/png", b64("apple-touch-icon.png")),
             "icon-192.png": ("image/png", b64("icon-192.png")), "icon-512.png": ("image/png", b64("icon-512.png")),
             "maskable-512.png": ("image/png", b64("maskable-512.png")),
             "site.webmanifest": ("application/manifest+json", base64.b64encode(json.dumps(MANIFEST).encode()).decode())}
    (d / "brand_icons.js").write_text(
        "// RB icon files served at /brand/* (rb-tools/patch_icons.py; sources in rb-tools/brand). Generated, do not edit.\n"
        f"export const BRAND_ICONS = {json.dumps(files)};\n", encoding="utf-8")
    p = d / "artist-router-v14.js"
    s = p.read_text(encoding="utf-8")
    imp = 'import { BRAND_ICONS } from "./brand_icons.js";\n'
    route = ('    if (path.startsWith("/brand/") && BRAND_ICONS[path.slice(7)]) {\n'
             '      const [type, data] = BRAND_ICONS[path.slice(7)];\n'
             '      return new Response(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)), { headers: { "Content-Type": type, "Cache-Control": "public, max-age=86400", "Access-Control-Allow-Origin": "*", "X-Content-Type-Options": "nosniff" } });\n'
             '    }\n')
    anchor = '    if (path === "/shop" || path === "/shop/") {\n'
    if imp not in s:
        s = imp + s
    if route not in s:
        if s.count(anchor) != 1:
            raise SystemExit(f"artist-router: /shop anchor found {s.count(anchor)} times")
        s = s.replace(anchor, route + anchor)
    if '<link rel="manifest" href="/brand/site.webmanifest">' not in s:
        hub = "async function hubPage(env) {"
        i = s.find(hub)
        j = s.find(TAGS, i) if i != -1 else -1
        if j == -1:
            s, _ = tag_html(s)
            j = s.find(TAGS, i)
        if j != -1:
            s = s[: j + len(TAGS)] + '<link rel="manifest" href="/brand/site.webmanifest">' + s[j + len(TAGS):]
    p.write_text(s, encoding="utf-8")


def rb_favicon(d):
    p = d / "rb-favicon.js"
    s = p.read_text(encoding="utf-8")
    s = re.sub(r'const ICON = Uint8Array\.from\(atob\("[^"]*"\)', f'const ICON = Uint8Array.from(atob("{b64("favicon.ico")}")', s, count=1)
    s = s.replace('"Content-Type": "image/png"', '"Content-Type": "image/x-icon"').replace("public, max-age=31536000, immutable", "public, max-age=86400")
    p.write_text(s, encoding="utf-8")
    print("rb-favicon: /favicon.ico is the new icon")


for arg in sys.argv[1:]:
    d = pathlib.Path(arg)
    name = json.loads((d / "manifest.json").read_text())["script"] if (d / "manifest.json").exists() else d.name
    if name == "rb-favicon":
        rb_favicon(d)
        continue
    key = "rb-daw" if d.name == "src" and d.parent.name == "rb-daw" else name
    site = WORKER_SITE.get(key)
    if site:
        TAGS, PREV_TAGS, MARK = site_tags(site), [STATIC, *STATIC_PREV], f"site-image?site={site}&amp;slot=icon"
        SHARE_SITE = None if site in NO_SHARE else site
        SITE_ID = site
    else:
        TAGS, PREV_TAGS, MARK, SHARE_SITE = STATIC, STATIC_PREV, f"/brand/icon.svg?v={V}", None
        SITE_ID = None
    HAS_OG = any("og:image" in f.read_text(encoding="utf-8") for f in [*d.glob("*.js"), *d.glob("*.html")] if f.name != "brand_icons.js")
    if name == "artist-router":
        artist_router(d)
    total = 0
    for f in sorted([*d.glob("*.js"), *d.glob("*.html")]):
        if f.name == "brand_icons.js":
            continue
        s = f.read_text(encoding="utf-8")
        s2, n = tag_html(s)
        if s2 != s:
            f.write_text(s2, encoding="utf-8")
        total += n
    print(f"{name}: icon tags {'updated in ' + str(total) + ' place(s)' if total else 'already in place'}")
