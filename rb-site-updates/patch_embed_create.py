"""Let RB Create (relentlessbillionaire.com/create) show RB Studio's recorder and mastering in its frames.

Usage: python3 -I patch_embed_create.py <pulled rb-daw or rb-mastering-studio dir>

Both apps refuse to be framed by any page (frame-ancestors 'none'; mastering also sends X-Frame-Options: DENY).
This changes their app pages to allow framing by pages on their own site only (frame-ancestors 'self',
X-Frame-Options: SAMEORIGIN). Other sites still can't frame them. Nothing else changes. Running it twice changes nothing.
"""
import pathlib
import sys

folder = pathlib.Path(sys.argv[1])
p = folder / "index.js"
s = p.read_text(encoding="utf-8")
name = folder.name
changed = []


def rep(old, new, what):
    global s
    if new in s:
        return
    if s.count(old) != 1:
        raise SystemExit(f"{name}: {what}: anchor found {s.count(old)} times")
    s = s.replace(old, new)
    changed.append(what)


if "rb-daw" in name:
    rep('''      "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"].join("; "),
    "Permissions-Policy": "microphone=(self), midi=(self), camera=(), geolocation=(), payment=()",''',
        '''      "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'"].join("; "),
    "Permissions-Policy": "microphone=(self), midi=(self), camera=(), geolocation=(), payment=()", "X-Frame-Options": "SAMEORIGIN",''', "app shell")
elif "mastering" in name:
    rep('var SECURITY = {\n  "X-Frame-Options": "DENY",\n', 'var SECURITY = {\n  "X-Frame-Options": "SAMEORIGIN",\n', "X-Frame-Options")
    rep('''    "form-action 'none'",\n    "frame-ancestors 'none'"\n  ].join("; ")\n};''',
        '''    "form-action 'none'",\n    "frame-ancestors 'self'"\n  ].join("; ")\n};''', "frame-ancestors")
else:
    raise SystemExit(f"{name}: not rb-daw or rb-mastering-studio")
p.write_text(s, encoding="utf-8")
print(f"{name}: " + (", ".join(changed) + " updated" if changed else "already framable by its own site"))
