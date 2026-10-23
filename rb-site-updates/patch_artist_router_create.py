"""Serve RB Create at relentlessbillionaire.com/create (artist-router, code only).

Usage: python3 -I patch_artist_router_create.py <pulled artist-router dir>

RB Create is one page (rb-site-updates/src/create/create.html) with a tool rail: Record (/record), Master (/studio)
and AI Forge in frames, plus Voice & visualizer, Cartoon & film and a Library kept in the visitor's browser. This
- embeds the page as a constant (re-running with a newer create.html replaces it, so edits deploy);
- adds the /create and /create/ route on the main site's hosts, with a fresh nonce and a strict CSP per request;
- leaves the floating RB Radio bar off /create (it would play into the microphone while recording).
No route, binding or secret changes: the main site's existing route already reaches artist-router.
"""
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
folder = pathlib.Path(sys.argv[1])
p = folder / "artist-router-v14.js"
s = p.read_text(encoding="utf-8")
page = (HERE / "src/create/create.html").read_text(encoding="utf-8")
if page.count("__NONCE__") < 2:
    raise SystemExit("create.html: expected __NONCE__ on its style and script tags")
changed = []

START = "// ---------------------------------------------------------------- RB Create (/create)\n"
END = "// ---------------------------------------------------------------- end RB Create\n"
block = START + (
    "const RB_CREATE_HTML = " + json.dumps(page) + ";\n"
    "function rbCreatePage(request) {\n"
    "  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replace(/[+/=]/g, '');\n"
    "  const csp = [\"default-src 'self'\", `script-src 'nonce-${nonce}'`, `style-src 'nonce-${nonce}'`, 'font-src https://fonts.gstatic.com',\n"
    "    'img-src \\'self\\' data: blob: https:', 'media-src \\'self\\' data: blob: https:', 'connect-src \\'self\\' https://media.relentlessbillionaire.com',\n"
    "    'frame-src \\'self\\' https://studio.relentlessbillionaire.vip', 'worker-src \\'self\\' blob:', \"object-src 'none'\", \"base-uri 'none'\", \"form-action 'none'\", \"frame-ancestors 'self'\"].join('; ');\n"
    "  return new Response(request.method === 'HEAD' ? null : RB_CREATE_HTML.replaceAll('__NONCE__', nonce), { headers: {\n"
    "    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'Content-Security-Policy': csp,\n"
    "    'Permissions-Policy': 'microphone=(self), midi=(self), camera=(), geolocation=(), payment=()',\n"
    "    'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN' } });\n"
    "}\n") + END

if START in s:
    a = s.index(START); b = s.index(END) + len(END)
    if s[a:b] != block:
        s = s[:a] + block + s[b:]; changed.append("page updated")
else:
    anchor = "function passportHTML() {"
    if s.count(anchor) != 1:
        raise SystemExit(f"artist-router: passportHTML anchor found {s.count(anchor)} times")
    s = s.replace(anchor, block + anchor); changed.append("page")


def rep(old, new, what):
    global s
    if new in s:
        return
    if s.count(old) != 1:
        raise SystemExit(f"artist-router: {what}: anchor found {s.count(old)} times")
    s = s.replace(old, new)
    changed.append(what)


ROUTE_OLD = "    if (path === '/passport' || path === '/passport/') return new Response(passportHTML(),"
rep(ROUTE_OLD,
    "    if ((path === '/create' || path === '/create/') && (host === 'relentlessbillionaire.com' || host === 'www.relentlessbillionaire.com') && (request.method === 'GET' || request.method === 'HEAD')) return rbCreatePage(request);\n" + ROUTE_OLD,
    "route")
rep('    if (/\\/(admin|api)(\\/|$)/.test(new URL(request.url).pathname)) return res; // no bar on admin pages or APIs\n',
    '    if (/\\/(admin|api|create)(\\/|$)/.test(new URL(request.url).pathname)) return res; // no bar on admin pages, APIs or RB Create\n',
    "no radio bar on /create")
p.write_text(s, encoding="utf-8")
print("artist-router: " + (", ".join(changed) + " updated" if changed else "RB Create already in place"))
