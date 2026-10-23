"""Main-site additions for a pulled artist-router: counted post links and the ad slot for RB Radio and RB TV.

Usage: python3 -I patch_artist_router.py <pulled artist-router dir>

Ad slot: serves src/ad-slot.js and src/ad-slot.css at /api/ads/slot.js and /api/ads/slot.css, so RB Radio and RB TV
(same origin) can show sponsored cards for their surface. Rewritten from src/ on every run, so edits there go live.

Post links:

RB Command's Show planner gives every post a link like relentlessbillionaire.com/go/post/42?c=instagram. Opening it
adds one to that post's click count (show_plan_items.clicks; link previews, bots and prefetches don't count) and sends
the visitor to /events with UTM tags. An unknown id still goes to /events. Running it twice changes nothing.
"""
import pathlib
import sys

p = pathlib.Path(sys.argv[1]) / "artist-router-v14.js"
s = p.read_text(encoding="utf-8")
ANCHOR = '    const adReport = /^\\/ads\\/report\\/([0-9a-f]{32})$/.exec(path);\n'
NEW = '''    // Show planner post links (RB Command): count the click on that post, then go to /events with UTM tags.
    const goPost = /^\\/go\\/post\\/(\\d{1,9})$/.exec(path);
    if (goPost && (request.method === "GET" || request.method === "HEAD")) {
      const to = new URL(url.origin + "/events");
      const item = await env.DB.prepare("SELECT i.id, i.plan_id FROM show_plan_items i WHERE i.id = ? AND i.kind = 'content'").bind(Number(goPost[1])).first().catch(() => null);
      if (item) {
        const ch = (url.searchParams.get("c") || "").toLowerCase().replace(/[^a-z]/g, "").slice(0, 16) || "social";
        to.searchParams.set("utm_source", ch); to.searchParams.set("utm_medium", "social");
        to.searchParams.set("utm_campaign", "rb-show-" + item.plan_id); to.searchParams.set("utm_content", "post-" + item.id);
        const prefetch = /prefetch|prerender/i.test(request.headers.get("Sec-Purpose") || request.headers.get("Purpose") || "");
        if (request.method === "GET" && !prefetch && !adIsBot(request)) ctx.waitUntil(env.DB.prepare("UPDATE show_plan_items SET clicks = coalesce(clicks, 0) + 1 WHERE id = ?").bind(item.id).run().catch(() => {}));
      }
      return new Response(null, { status: 302, headers: { Location: to.toString(), "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "strict-origin-when-cross-origin" } });
    }
'''
if NEW in s:
    print("artist-router: post links already in place")
else:
    if s.count(ANCHOR) != 1:
        raise SystemExit(f"anchor found {s.count(ANCHOR)} times")
    s = s.replace(ANCHOR, NEW + ANCHOR)
    print("artist-router: post links added")

# ---- the ad slot: the two files as constants, and their routes
import json
import re
HERE = pathlib.Path(__file__).resolve().parent
consts = ("const RB_AD_SLOT_JS = " + json.dumps((HERE / "src" / "ad-slot.js").read_text(encoding="utf-8")) + ";\n"
          "const RB_AD_SLOT_CSS = " + json.dumps((HERE / "src" / "ad-slot.css").read_text(encoding="utf-8")) + ";\n")
if "const RB_AD_SLOT_JS = " in s:
    s = re.sub(r'const RB_AD_SLOT_JS = "(?:[^"\\]|\\.)*";\nconst RB_AD_SLOT_CSS = "(?:[^"\\]|\\.)*";\n', lambda m: consts, s, count=1)
else:
    if s.count("function adIsBot(request) {") != 1:
        raise SystemExit("adIsBot anchor not found once")
    s = s.replace("function adIsBot(request) {", "// The RB ad slot for other RB pages (rb-site-updates/src/ad-slot.js and ad-slot.css).\n" + consts + "function adIsBot(request) {", 1)
ROUTE_ANCHOR = '      if (path === "/api/ads" && request.method === "GET") {\n'
ROUTE = '''      if ((path === "/api/ads/slot.js" || path === "/api/ads/slot.css") && (request.method === "GET" || request.method === "HEAD")) {
        const js = path.endsWith(".js");
        return new Response(request.method === "HEAD" ? null : js ? RB_AD_SLOT_JS : RB_AD_SLOT_CSS, { headers: { "Content-Type": js ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" } });
      }
'''
if ROUTE not in s:
    if s.count(ROUTE_ANCHOR) != 1:
        raise SystemExit("ads route anchor not found once")
    s = s.replace(ROUTE_ANCHOR, ROUTE + ROUTE_ANCHOR)
    print("artist-router: ad slot route added")
p.write_text(s, encoding="utf-8")
