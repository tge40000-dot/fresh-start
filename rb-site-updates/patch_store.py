"""The Shop (relentlessbillionaire.com/store) becomes the three apparel houses (artist-router, code only).

Usage: python3 -I patch_store.py <pulled artist-router dir>

The Store showed GOT BEATS beats first, with Slank Customs as a second tab. It now presents three houses, with no beats:
- the Soho Luxury Atelier (/soho), with four pieces from the Genesis collection (the shop's own atelier products);
- Slank Customs (slank.relentlessbillionaire.com), custom apparel and print;
- Sports 4 All (sports4all.relentlessbillionaire.com), jerseys, hats and tees in Vallejo.
The page is rb-site-updates/src/store/store.html, served with a fresh script nonce per request.
Beats stay at beatstore.relentlessbillionaire.com (the site tabs still say Beats). The beat store's "request exclusive
rights" link (/store?license=exclusive&beat=<id>) still opens the old request form, so that flow keeps working.
The homepage card's built-in words and picture now describe the three houses (an RB admin hub tile still overrides them).
Running it twice changes nothing; re-running with a newer store.html replaces the page.
"""
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
folder = pathlib.Path(sys.argv[1])
p = folder / "artist-router-v14.js"
s = p.read_text(encoding="utf-8")
page = (HERE / "src/store/store.html").read_text(encoding="utf-8")
if page.count("__NONCE__") < 3:
    raise SystemExit("store.html: expected __NONCE__ on its stylesheet, style and script tags")
changed = []

START = "// ---------------------------------------------------------------- RB Shop: the three houses (/store)\n"
END = "// ---------------------------------------------------------------- end RB Shop\n"
block = START + (
    "const RB_STORE_HTML = " + json.dumps(page) + ";\n"
    "function rbStorePage(request) {\n"
    "  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replace(/[+/=]/g, '');\n"
    "  const csp = [\"default-src 'self'\", `script-src 'nonce-${nonce}'`, \"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com\", \"font-src 'self' https://fonts.gstatic.com\",\n"
    "    \"img-src 'self' data: https://media.relentlessbillionaire.com https://relentlessbillionaire.com\", \"connect-src 'self'\", \"media-src 'self' https://media.relentlessbillionaire.com\",\n"
    "    \"object-src 'none'\", \"base-uri 'none'\", \"form-action 'self'\", \"frame-ancestors 'self'\"].join('; ');\n"
    "  return new Response(request.method === 'HEAD' ? null : RB_STORE_HTML.replaceAll('__NONCE__', nonce), { headers: {\n"
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


rep('''    if (path === "/store" || path === "/store/") {
      return new Response(storeHTML(), { status: 200, headers: DYNAMIC_HTML_HEADERS });
    }''', '''    if (path === "/store" || path === "/store/") {
      // the beat store's exclusive-rights request still uses the old storefront's form
      if (url.searchParams.has("beat") || url.searchParams.has("license")) return new Response(storeHTML(), { status: 200, headers: DYNAMIC_HTML_HEADERS });
      return rbStorePage(request);
    }''', "route")
rep('{ id: "shop", data: "beats", paths: ["/shop", "/store", "/beats"], kicker: "Beats & apparel", title: "The Shop", blurb: "GOT BEATS licensing and Slank Customs apparel in one storefront.", verb: "Shop the collection", href: "/store", img: "https://media.relentlessbillionaire.com/beats/covers/1-84dfd1e8.jpg" },',
    '{ id: "shop", data: "beats", paths: ["/shop", "/store", "/beats"], kicker: "Apparel", title: "The Shop", blurb: "The Soho Luxury Atelier, Slank Customs and Sports 4 All under one name.", verb: "Shop the houses", href: "/store", img: "https://media.relentlessbillionaire.com/atelier/atelier-hero-crop.webp" },',
    "homepage card")

p.write_text(s, encoding="utf-8")
print("artist-router: " + (", ".join(changed) + " updated" if changed else "the Shop already in place"))
