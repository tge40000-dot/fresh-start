"""Crash guard for artist-router (relentlessbillionaire.com). Code only: no route, binding or secret changes.

Usage: python3 -I patch_resilience.py <pulled artist-router dir>

Why: D1 now and then answers a query with a passing "D1_ERROR: internal error". artist-router's schema check runs
first on every new isolate, and when that check met one of these errors it threw out of the Worker: the visitor got
Cloudflare's error page and the request counted as a crash (19 of about 30,000 requests on 22-23 Oct 2026, 18 of
them in one burst from a scanner probing br.relentlessbillionaire.com for .env and config files).

What it changes:
  - The schema check is no longer fatal. The tables already exist, so when the check can't reach the database the
    request carries on, the error is logged, and the next request checks again.
  - A guard round the whole Worker: a GET or HEAD that throws on a passing database or network error is tried once
    more; if anything still throws, the visitor gets a short "please try again" page (JSON on /api/) with a 503 and
    Retry-After instead of an error page, and the error is logged with the method and path.
Each part is applied once: running it again changes nothing.
"""
import json
import pathlib
import sys

d = pathlib.Path(sys.argv[1])
if json.loads((d / "manifest.json").read_text())["script"] != "artist-router":
    raise SystemExit(f"patch_resilience.py: {d} isn't artist-router")
p = d / "artist-router-v14.js"
s = p.read_text(encoding="utf-8")

OLD = "await (rbSchemaReady ||= ensureSchemaOnce(env).catch((e) => { rbSchemaReady = null; throw e; }));"
NEW = ("await (rbSchemaReady ||= ensureSchemaOnce(env).catch((e) => { rbSchemaReady = null; "
       "try { console.error(\"schema check skipped (tried again on the next request):\", String((e && e.message) || e)); } catch (_) {} }));")
if NEW in s:
    print("artist-router: schema check already non-fatal")
elif s.count(OLD) == 1:
    s = s.replace(OLD, NEW)
    print("artist-router: schema check is no longer fatal")
else:
    raise SystemExit("artist-router: schema check line not found")

GUARD = r'''
/* ---------------------------------------------------------------- RB crash guard (added 23 Oct 2026)
   A GET or HEAD that throws on a passing database or network error is tried once more; if anything still throws,
   the visitor gets a short "please try again" page (JSON on /api/) with a 503 and Retry-After instead of Cloudflare's
   error page, and the error is logged. To take it off, delete this block (rb-tools/patch_resilience.py). */
function __rbTransient(e) { return /D1_ERROR|internal error|Network connection lost|object to be reset|timed out|overloaded/i.test(String((e && e.message) || e)); }
function __rbSorry(request) {
  const u = new URL(request.url), h = { "Retry-After": "5", "Cache-Control": "no-store" };
  if (u.pathname.startsWith("/api/") || /json/i.test(request.headers.get("Accept") || ""))
    return new Response(JSON.stringify({ ok: false, error: "Something went wrong on our side. Please try again in a moment." }), { status: 503, headers: { ...h, "Content-Type": "application/json; charset=utf-8" } });
  if (request.method === "HEAD") return new Response(null, { status: 503, headers: h });
  return new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Relentless Billionaire</title>'
    + '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0a0a;color:#f5f0e6;font:16px/1.5 Inter,system-ui,sans-serif;padding:24px;box-sizing:border-box}main{max-width:420px;text-align:center}h1{color:#C9A84C;font-size:22px;letter-spacing:.5px}a{display:inline-block;margin-top:14px;padding:12px 20px;border-radius:10px;background:#C9A84C;color:#000;font-weight:800;text-decoration:none}</style></head>'
    + '<body data-rbtabs="off"><main><h1>We hit a snag</h1><p>That page didn\'t load this time. It\'s on our side, and trying again usually fixes it.</p><a href="">Try again</a></main></body></html>',
    { status: 503, headers: { ...h, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" } });
}
function __rbSafeWrap(handler) {
  if (!handler || typeof handler.fetch !== "function" || handler.fetch.__rbSafe) return;
  const inner = handler.fetch;
  const why = (e) => String((e && e.message) || e).slice(0, 300);
  const outer = async function (request, env, ctx) {
    try { return await inner.call(this, request, env, ctx); }
    catch (e) {
      let path = ""; try { path = new URL(request.url).host + new URL(request.url).pathname; } catch (_) {}
      try { console.error("request failed:", request.method, path, why(e)); } catch (_) {}
      if ((request.method === "GET" || request.method === "HEAD") && __rbTransient(e)) {
        try { return await inner.call(this, request, env, ctx); } catch (e2) { try { console.error("retry failed:", request.method, path, why(e2)); } catch (_) {} }
      }
      return __rbSorry(request);
    }
  };
  outer.__rbSafe = true; handler.fetch = outer;
}
__rbSafeWrap(artist_router_v11_default);
'''
if "__rbSafeWrap(artist_router_v11_default)" in s:
    print("artist-router: crash guard already in place")
else:
    if "artist_router_v11_default as default" not in s:
        raise SystemExit("artist-router: default export not found")
    s = s.rstrip("\n") + "\n" + GUARD
    print("artist-router: crash guard round the Worker (one retry for passing errors, then a 503 page)")
p.write_text(s, encoding="utf-8")
