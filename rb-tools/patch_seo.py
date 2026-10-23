"""Site hygiene from the crawl notes: the sitemap, a robots.txt for the beatstore, a baseline security header, and
game.relentlessbillionaire.com going to RB World. Code only: no route, domain, binding or secret changes.

Usage: python3 -I patch_seo.py <pulled artist-router dir> <pulled beatstore dir> [<rb-events-page dir> <rb-fund-campaign dir> <rb-release dir>]

artist-router (relentlessbillionaire.com and its *.relentlessbillionaire.com route):
  - /sitemap.xml lists /create, /beats and /advertise, and RB World at /app/world/ in place of /game/ (which only
    redirects there now). /rewards and /badge stay out while they're switched off.
  - game.relentlessbillionaire.com (served by the wildcard route, where it showed the 404 page) sends visitors to
    https://relentlessbillionaire.com/app/world/ with a 302. Its /game* paths already go there through rb-game.
  - HTML pages that send no Content-Security-Policy get a baseline one: frame-ancestors 'self' (no clickjacking from
    other sites), base-uri 'self' and object-src 'none'. It says nothing about scripts, styles or connections, so it
    can't break a page; pages with their own policy keep it unchanged.
beatstore (beatstore.relentlessbillionaire.com):
  - a real /robots.txt (pointing at its sitemap) and /sitemap.xml, in place of the store page it served for both;
  - the same baseline header on its pages.
rb-events-page (/events), rb-fund-campaign (/fund) and rb-release (/release, /showcase): the same baseline header.
Each part is applied once: running it again changes nothing.
"""
import json
import pathlib
import sys

ar, bs = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
for d, name in ((ar, "artist-router"), (bs, "beatstore")):
    if json.loads((d / "manifest.json").read_text())["script"] != name:
        raise SystemExit(f"patch_seo.py: {d} isn't {name}")

BASELINE = "frame-ancestors 'self'; base-uri 'self'; object-src 'none'"
SEC_JS = """
/* ---------------------------------------------------------------- RB baseline security header (added 23 Oct 2026)
   HTML pages that send no Content-Security-Policy get a baseline one (no framing by other sites, no <base> swaps, no
   plugins). It doesn't touch scripts, styles or connections, so it can't break a page; pages with a policy keep it.
   To take it off, delete this block (rb-tools/patch_seo.py). */
const __RB_BASELINE_CSP = "%s";
function __rbSecHeaders(res) {
  try {
    if (!/^text\\/html/i.test(res.headers.get("Content-Type") || "") || res.headers.get("Content-Security-Policy")) return res;
    const h = new Headers(res.headers); h.set("Content-Security-Policy", __RB_BASELINE_CSP);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  } catch (e) { return res; }
}
function __rbSecWrap(handler, before) {
  if (!handler || typeof handler.fetch !== "function" || handler.fetch.__rbSec) return;
  const inner = handler.fetch;
  const outer = async function (request, env, ctx) { const early = before && before(request); if (early) return early; return __rbSecHeaders(await inner.call(this, request, env, ctx)); };
  outer.__rbSec = true; handler.fetch = outer;
}
""" % BASELINE

# ---------------------------------------------------------------- artist-router
p = ar / "artist-router-v14.js"
s = p.read_text(encoding="utf-8")
OLD_LIST = '"/jobs", "/game/", '
if '"/advertise"' in s and '"/app/world/"' in s.split('if (path === "/sitemap.xml")', 1)[-1][:2000]:
    print("artist-router: sitemap already up to date")
else:
    i = s.index('if (path === "/sitemap.xml")')
    head, tail = s[:i], s[i:]
    if tail[:2000].count(OLD_LIST) != 1:
        raise SystemExit("artist-router: sitemap list not found")
    tail = tail.replace(OLD_LIST, '"/jobs", "/create", "/beats", "/advertise", "/app/world/", ', 1)
    s = head + tail
    print("artist-router: sitemap lists /create, /beats, /advertise and /app/world/")
if "__rbSecWrap(artist_router_v11_default" in s:
    print("artist-router: baseline header and game host redirect already in place")
else:
    s = s.rstrip("\n") + "\n" + SEC_JS + """// game.relentlessbillionaire.com is RB World's old address: send it there (its /game* paths go through rb-game).
__rbSecWrap(artist_router_v11_default, (request) => {
  const u = new URL(request.url);
  if (u.hostname === "game.relentlessbillionaire.com" && !u.pathname.startsWith("/api/") && (request.method === "GET" || request.method === "HEAD"))
    return new Response(null, { status: 302, headers: { Location: "https://relentlessbillionaire.com/app/world/" + u.search, "Cache-Control": "no-store" } });
  return null;
});
"""
    print("artist-router: baseline security header; game.relentlessbillionaire.com goes to RB World")
p.write_text(s, encoding="utf-8")

# ---------------------------------------------------------------- beatstore
p = bs / "worker.js"
s = p.read_text(encoding="utf-8")
if "__rbSecWrap(__rbRadioWorker" in s:
    print("beatstore: robots, sitemap and baseline header already in place")
else:
    anchor = "export default __rbRadioWorker;"
    if s.count(anchor) != 1:
        raise SystemExit("beatstore: export not found")
    add = SEC_JS + """// a real robots.txt and sitemap for beatstore.relentlessbillionaire.com (it's one page: the catalog)
__rbSecWrap(__rbRadioWorker, (request) => {
  const u = new URL(request.url), base = u.origin;
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  if (u.pathname === "/robots.txt") return new Response("User-agent: *\\nAllow: /\\nDisallow: /api/\\n\\nSitemap: " + base + "/sitemap.xml\\n", { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
  if (u.pathname === "/sitemap.xml") return new Response('<?xml version="1.0" encoding="UTF-8"?>\\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\\n  <url><loc>' + base + '/</loc></url>\\n</urlset>\\n', { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
  return null;
});
"""
    s = s.replace(anchor, add + anchor)
    print("beatstore: robots.txt, sitemap.xml and the baseline header")
p.write_text(s, encoding="utf-8")

# ---------------------------------------------------------------- the other page Workers: the baseline header only
# (script, file, the handler to wrap, and where the call goes: before the export, or at the end after the radio wrap)
OTHERS = (("rb-events-page", "events-worker.js", "__rbRadioWorker", "export default __rbRadioWorker;"),
          ("rb-fund-campaign", "worker.js", "__rbRadioWorker", "export default __rbRadioWorker;"),
          ("rb-release", "rb-release-worker.js", "rb_release_worker_default", None))
for d, (name, fname, handler, anchor) in zip(map(pathlib.Path, sys.argv[3:6]), OTHERS):
    if json.loads((d / "manifest.json").read_text())["script"] != name:
        raise SystemExit(f"patch_seo.py: {d} isn't {name}")
    p = d / fname
    s = p.read_text(encoding="utf-8")
    call = f"__rbSecWrap({handler});"
    if call in s:
        print(f"{name}: baseline header already in place")
        continue
    if anchor is None:
        if f"__rbRadioWrap({handler});" not in s:
            raise SystemExit(f"{name}: radio wrap not found")
        s = s.rstrip("\n") + "\n" + SEC_JS + call + "\n"
    else:
        if s.count(anchor) != 1:
            raise SystemExit(f"{name}: export not found")
        s = s.replace(anchor, SEC_JS + call + "\n" + anchor)
    p.write_text(s, encoding="utf-8")
    print(f"{name}: baseline header")
