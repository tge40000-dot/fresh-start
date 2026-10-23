"""Crash guard for artist-router (relentlessbillionaire.com) and rb-mastering-studio (/studio). Code only: no route,
binding or secret changes.

Usage: python3 -I patch_resilience.py <pulled artist-router dir> [<pulled rb-mastering-studio dir> [<other Worker dir>...]]

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
rb-mastering-studio: R2 (the VAULT bucket) now and then fails a read with "We encountered an internal error. Please
try again. (10001)". The studio reads its pricing settings from R2 for /studio/api/pricing and /studio/api/me, so 12 of
142 requests on 21 Oct 2026 crashed. Now a failed R2 read of a JSON record is tried once more, the pricing settings
fall back to the last ones read, and the same guard as artist-router goes round the whole Worker.
Other Workers (any more dirs): the same guard round each one's fetch handler, so a passing storage error on RB Radio,
RB TV, the beatstore and the rest answers with a "please try again" page instead of an error page.
Each part is applied once: running it again changes nothing.
"""
import json
import pathlib
import sys

d = pathlib.Path(sys.argv[1])
studio = pathlib.Path(sys.argv[2]) if len(sys.argv) > 2 else None
others = [pathlib.Path(a) for a in sys.argv[3:]]
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
  if (/(^|\/)api\//.test(u.pathname) || /json/i.test(request.headers.get("Accept") || ""))
    return new Response(JSON.stringify({ ok: false, error: "Something went wrong on our side. Please try again in a moment." }), { status: 503, headers: { ...h, "Content-Type": "application/json; charset=utf-8" } });
  if (request.method === "HEAD") return new Response(null, { status: 503, headers: h });
  return new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Relentless Billionaire</title>'
    + '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0a0a;color:#f5f0e6;font:16px/1.5 Inter,system-ui,sans-serif;padding:24px;box-sizing:border-box}main{max-width:420px;text-align:center}h1{color:#C9A84C;font-size:22px;letter-spacing:.5px}a{display:inline-block;margin-top:14px;padding:12px 20px;border-radius:10px;background:#C9A84C;color:#000;font-weight:800;text-decoration:none}</style></head>'
    + '<body data-rbtabs="off"><main><h1>We hit a snag</h1><p>That page didn\'t load this time. It\'s on our side, and trying again usually fixes it.</p><a href="">Try again</a></main></body></html>',
    { status: 503, headers: { ...h, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "frame-ancestors 'self'; base-uri 'self'; object-src 'none'" } });
}
// Bots probe every site for leaked files (.env, .git, wp-admin, .php, docker and AWS config): answer them at once,
// before any database or storage call. No RB page lives at these paths.
function __rbProbe(request) {
  let p = ""; try { p = new URL(request.url).pathname.toLowerCase(); } catch (_) { return false; }
  return /^\/\.(?!well-known\/)/.test(p) || /\/\.(env|git|aws|ssh|svn|hg|ds_store|bash|zsh|profile|npmrc|docker|htaccess|htpasswd)/.test(p)
    || /(wp-(admin|login|includes|content|config)|xmlrpc\.php|phpmyadmin|docker-compose|serverless\.ya?ml|dockerrun\.aws|aws_credentials|\/vendor\/phpunit|\.php$|\/cgi-bin\/)/.test(p);
}
function __rbSafeWrap(handler) {
  if (!handler || typeof handler.fetch !== "function" || handler.fetch.__rbSafe) return;
  const inner = handler.fetch;
  const why = (e) => String((e && e.message) || e).slice(0, 300);
  const outer = async function (request, env, ctx) {
    if (__rbProbe(request)) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400", "X-Robots-Tag": "noindex" } });
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
__rbSafeWrap(HANDLER);
'''
def upgrade(s, name):
    """Bring a guard an earlier run added up to date (the scanner answer)."""
    if "__rbProbe(" in s:
        return s
    if s.count(OLD_OUTER) != 1:
        raise SystemExit(f"{name}: guard found, but not its handler")
    print(f"{name}: guard answers scanner probes at once")
    return s.replace(OLD_OUTER, NEW_OUTER).replace("function __rbSafeWrap(handler) {", PROBE + "function __rbSafeWrap(handler) {", 1)


OLD_OUTER = '  const outer = async function (request, env, ctx) {\n    try { return await inner.call(this, request, env, ctx); }'
NEW_OUTER = '  const outer = async function (request, env, ctx) {\n    if (__rbProbe(request)) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400", "X-Robots-Tag": "noindex" } });\n    try { return await inner.call(this, request, env, ctx); }'
PROBE = '// Bots probe every site for leaked files (.env, .git, wp-admin, .php, docker and AWS config): answer them at once,\n// before any database or storage call. No RB page lives at these paths.\nfunction __rbProbe(request) {\n  let p = ""; try { p = new URL(request.url).pathname.toLowerCase(); } catch (_) { return false; }\n  return /^\\/\\.(?!well-known\\/)/.test(p) || /\\/\\.(env|git|aws|ssh|svn|hg|ds_store|bash|zsh|profile|npmrc|docker|htaccess|htpasswd)/.test(p)\n    || /(wp-(admin|login|includes|content|config)|xmlrpc\\.php|phpmyadmin|docker-compose|serverless\\.ya?ml|dockerrun\\.aws|aws_credentials|\\/vendor\\/phpunit|\\.php$|\\/cgi-bin\\/)/.test(p);\n}\n'

if "__rbSafeWrap(artist_router_v11_default)" in s:
    print("artist-router: crash guard already in place")
    s = upgrade(s, "artist-router")
else:
    if "artist_router_v11_default as default" not in s:
        raise SystemExit("artist-router: default export not found")
    s = s.rstrip("\n") + "\n" + GUARD.replace("HANDLER", "artist_router_v11_default")
    print("artist-router: crash guard round the Worker (one retry for passing errors, then a 503 page)")
p.write_text(s, encoding="utf-8")

# ---------------------------------------------------------------- rb-mastering-studio
if studio:
    if json.loads((studio / "manifest.json").read_text())["script"] != "rb-mastering-studio":
        raise SystemExit(f"patch_resilience.py: {studio} isn't rb-mastering-studio")
    p = studio / "index.js"
    s = p.read_text(encoding="utf-8")
    OLD = """var getJson = /* @__PURE__ */ __name(async (env, key) => {
  const o = await env.VAULT.get(key);
  return o ? o.json() : null;
}, "getJson");"""
    NEW = """var getJson = /* @__PURE__ */ __name(async (env, key) => {
  let o;
  try { o = await env.VAULT.get(key); } catch (e) { await new Promise((r) => setTimeout(r, 150)); o = await env.VAULT.get(key); } // R2 now and then fails a read with a passing internal error: once more
  return o ? o.json() : null;
}, "getJson");"""
    if NEW in s:
        print("rb-mastering-studio: R2 reads already retried")
    elif s.count(OLD) == 1:
        s = s.replace(OLD, NEW); print("rb-mastering-studio: a failed R2 read of a record is tried once more")
    else:
        raise SystemExit("rb-mastering-studio: getJson not found")
    OLD = """async function getConfig(env) {
  return await getJson(env, "billing/config.json") || { live: false, prices: {}, created: nowIso() };
}"""
    NEW = """var rbConfigLast = null; // the pricing settings last read, for when R2 can't be reached
async function getConfig(env) {
  try { const c = await getJson(env, "billing/config.json"); if (c) rbConfigLast = c; return c || { live: false, prices: {}, created: nowIso() }; }
  catch (e) { if (rbConfigLast) { try { console.error("pricing settings from memory:", String((e && e.message) || e)); } catch (_) {} return rbConfigLast; } throw e; }
}"""
    if NEW in s:
        print("rb-mastering-studio: pricing settings fallback already in place")
    elif s.count(OLD) == 1:
        s = s.replace(OLD, NEW); print("rb-mastering-studio: pricing settings fall back to the last ones read")
    else:
        raise SystemExit("rb-mastering-studio: getConfig not found")
    if "__rbSafeWrap(index_default)" in s:
        print("rb-mastering-studio: crash guard already in place")
        s = upgrade(s, "rb-mastering-studio")
    else:
        if "__rbRadioWrap(index_default);" not in s:
            raise SystemExit("rb-mastering-studio: handler not found")
        s = s.rstrip("\n") + "\n" + GUARD.replace("HANDLER", "index_default")
        print("rb-mastering-studio: crash guard round the Worker")
    p.write_text(s, encoding="utf-8")

# ---------------------------------------------------------------- the other Workers: the guard round each fetch handler
import re
for od in others:
    man = json.loads((od / "manifest.json").read_text())
    name, entry = man["script"], man.get("entry") or "index.js"
    p = od / entry
    s = p.read_text(encoding="utf-8")
    if "__rbSafeWrap(" in s:
        print(f"{name}: crash guard already in place")
        s2 = upgrade(s, name)
        if s2 != s: p.write_text(s2, encoding="utf-8")
        continue
    wrapped = re.findall(r"^__rbRadioWrap\(([A-Za-z_$][\w$]*)\);", s, re.M)
    named = re.findall(r"^\s*([A-Za-z_$][\w$]*) as default\s*$", s, re.M)
    if wrapped:
        s = s.rstrip("\n") + "\n" + GUARD.replace("HANDLER", wrapped[-1])
    elif len(re.findall(r"^export default \{", s, re.M)) == 1:
        s = re.sub(r"^export default \{", "const __rbMain = {", s, count=1, flags=re.M)
        s = s.rstrip("\n") + "\n" + GUARD.replace("HANDLER", "__rbMain") + "export default __rbMain;\n"
    elif named:
        s = s.rstrip("\n") + "\n" + GUARD.replace("HANDLER", named[-1])
    else:
        raise SystemExit(f"{name}: fetch handler not found")
    p.write_text(s, encoding="utf-8")
    print(f"{name}: crash guard round the Worker")
