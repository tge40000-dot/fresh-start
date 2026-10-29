"""The Soho Luxury Atelier at relentlessbillionaire.com/atelier (artist-router, code only).

Usage: python3 -I patch_atelier.py <pulled artist-router dir>

The Genesis collection (the nine varsity, leather and wool pieces from the old Pages build of the RB shop), manufactured
by Manzo Leathers, as its own page:
- the page (rb-site-updates/src/atelier/atelier.html) is embedded and served at /atelier and /atelier/ on the main
  site's hosts with a fresh script nonce and a strict CSP per request (styles may be inline, so the RB Radio bar that
  the Worker adds to every page can style itself: the old shop had its music player at the bottom too; fonts may come
  from the site itself, where Cloudflare's font optimisation serves Google Fonts);
- the pieces are ordinary shop products with brand "atelier" (shop_products), so prices, pictures and order are edited
  in RB admin > Shop like any other product; requests go through the shop's own /api/shop/inquire and show in RB admin
  > Inquiries labelled "Soho Atelier";
- The Store (/store) gets a third tab that opens the Atelier;
- RB admin's product form can choose the Atelier brand, and saving an Atelier piece keeps it in the Atelier.
Nothing is charged on the page: a request is sent and the atelier replies by email. No route, binding or secret changes.
Running it twice changes nothing; re-running with a newer atelier.html replaces the page.
"""
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
folder = pathlib.Path(sys.argv[1])
p = folder / "artist-router-v14.js"
s = p.read_text(encoding="utf-8")
page = (HERE / "src/atelier/atelier.html").read_text(encoding="utf-8")
if page.count("__NONCE__") < 3:
    raise SystemExit("atelier.html: expected __NONCE__ on its stylesheet, style and script tags")
changed = []

START = "// ---------------------------------------------------------------- RB Soho Atelier (/atelier)\n"
END = "// ---------------------------------------------------------------- end RB Soho Atelier\n"
block = START + (
    "const RB_ATELIER_HTML = " + json.dumps(page) + ";\n"
    "function rbAtelierPage(request) {\n"
    "  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replace(/[+/=]/g, '');\n"
    "  const csp = [\"default-src 'self'\", `script-src 'nonce-${nonce}'`, \"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com\", \"font-src 'self' https://fonts.gstatic.com\",\n"
    "    'img-src \\'self\\' data: https://media.relentlessbillionaire.com https://relentlessbillionaire.com', \"connect-src 'self'\", \"media-src 'self' https://media.relentlessbillionaire.com\",\n"
    "    \"object-src 'none'\", \"base-uri 'none'\", \"form-action 'self'\", \"frame-ancestors 'self'\"].join('; ');\n"
    "  return new Response(request.method === 'HEAD' ? null : RB_ATELIER_HTML.replaceAll('__NONCE__', nonce), { headers: {\n"
    "    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60', 'Content-Security-Policy': csp,\n"
    "    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',\n"
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
    "    if ((path === '/atelier' || path === '/atelier/') && (host === 'relentlessbillionaire.com' || host === 'www.relentlessbillionaire.com') && (request.method === 'GET' || request.method === 'HEAD')) return rbAtelierPage(request);\n" + ROUTE_OLD,
    "route")
# The Store: a third tab, a link to the Atelier
rep('    <button class="btab" data-brand="slank">Slank Customs<small>Custom Apparel &amp; Print</small></button>\n  </div>',
    '    <button class="btab" data-brand="slank">Slank Customs<small>Custom Apparel &amp; Print</small></button>\n'
    '    <a class="btab" href="/atelier" style="text-decoration:none">Soho Atelier<small>Varsity &amp; Leather \\xB7 Manzo Leathers</small></a>\n  </div>',
    "store tab")
rep("  document.querySelectorAll('.btab').forEach(function(tab){\n    tab.addEventListener('click', function(){",
    "  document.querySelectorAll('.btab[data-brand]').forEach(function(tab){\n    tab.addEventListener('click', function(){",
    "store tab click")
# RB admin: the brand, its labels, and saving keeps it
rep('            <option value="slank">Slank Customs \\u2014 Apparel</option>',
    '            <option value="slank">Slank Customs \\u2014 Apparel</option>\n            <option value="atelier">Soho Atelier \\u2014 Manzo Leathers</option>',
    "admin brand option")
rep("    $('sp-kind').value = this.value === 'slank' ? 'apparel' : 'beat';",
    "    $('sp-kind').value = this.value === 'slank' || this.value === 'atelier' ? 'apparel' : 'beat';",
    "admin brand kind")
rep("        var brandLabel = x.brand==='slank' ? 'Slank Customs' : 'RB \\xB7 GOT BEATS';",
    "        var brandLabel = x.brand==='slank' ? 'Slank Customs' : x.brand==='atelier' ? 'Soho Atelier' : 'RB \\xB7 GOT BEATS';",
    "admin product label")
rep("            (q.brand==='slank'?'Slank Customs':'GOT BEATS')+'</span></td>'+",
    "            (q.brand==='slank'?'Slank Customs':q.brand==='atelier'?'Soho Atelier':'GOT BEATS')+'</span></td>'+",
    "admin inquiry label")
rep('          b.brand === "slank" ? "slank" : "rb",',
    '          b.brand === "slank" || b.brand === "atelier" ? b.brand : "rb",',
    "admin save keeps the brand")

p.write_text(s, encoding="utf-8")
print("artist-router: " + (", ".join(changed) + " updated" if changed else "Soho Atelier already in place"))
