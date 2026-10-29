"""Let pages with a nonce-only style policy load their Site images stylesheet (code only).

Usage: python3 -I patch_site_css_nonce.py <pulled worker dir>...

patch_icons.py adds <link rel="stylesheet" href=".../api/content/site-images.css?site=…"> to every page. Pages whose
Content-Security-Policy allows styles by nonce only (RB Create at /create, for one) block it, so the browser logs a
CSP error and the page misses its Site images background and header logo. Each page that uses the __NONCE__
placeholder gets nonce="__NONCE__" on that link, which the Worker fills in with the page's nonce like its other tags.
Pages without the placeholder are left alone. Running it twice changes nothing.
"""
import pathlib
import re
import sys

LINK = re.compile(r'<link rel=(\\?)"stylesheet\1" href=\1"https://relentlessbillionaire\.com/api/content/site-images\.css\?site=([a-z0-9-]+)\1">')

for arg in sys.argv[1:]:
    folder = pathlib.Path(arg)
    total = 0
    for p in sorted(folder.glob("*.js")):
        s = p.read_text(encoding="utf-8")
        parts = re.split(r"(?=<head[\s>])", s)  # one part per page, from its <head>
        n = 0
        for i, part in enumerate(parts):
            if "__NONCE__" not in part:
                continue

            def add(m):
                q = m.group(1)
                return f'<link rel={q}"stylesheet{q}" nonce={q}"__NONCE__{q}" href={q}"https://relentlessbillionaire.com/api/content/site-images.css?site={m.group(2)}{q}">'
            parts[i], k = LINK.subn(add, part)
            n += k
        if n:
            p.write_text("".join(parts), encoding="utf-8")
            total += n
    print(f"{folder.name}: site stylesheet nonce on {total} page(s)" if total else f"{folder.name}: nothing to change")
