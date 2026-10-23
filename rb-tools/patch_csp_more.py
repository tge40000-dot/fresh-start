"""The baseline security header on the last RB pages that sent none: /showcase, /yoshcoastmusic, /assassin and
weed.relentlessbillionaire.com. Code only: no route, domain, binding or secret changes.

Usage: python3 -I patch_csp_more.py <rb-showcase dir> <yoshcoastmusic dir> <assassin-in-the-room-signal dir> <weed-relentless-billionaire dir>

The same block rb-tools/patch_seo.py puts on the main site: HTML pages that send no Content-Security-Policy get
frame-ancestors 'self'; base-uri 'self'; object-src 'none' (no framing by other sites, no <base> swaps, no plugins).
It says nothing about scripts, styles or connections, so it can't break a page; a page with its own policy keeps it.
Run it before patch_resilience.py, so the crash guard stays the outermost wrapper. Running it twice changes nothing.
"""
import json
import pathlib
import sys

BASELINE = "frame-ancestors 'self'; base-uri 'self'; object-src 'none'"
SEC_JS = """
/* ---------------------------------------------------------------- RB baseline security header (added 23 Oct 2026)
   HTML pages that send no Content-Security-Policy get a baseline one (no framing by other sites, no <base> swaps, no
   plugins). It doesn't touch scripts, styles or connections, so it can't break a page; pages with a policy keep it.
   To take it off, delete this block (rb-tools/patch_csp_more.py). */
const __RB_BASELINE_CSP = "%s";
function __rbSecHeaders(res) {
  try {
    if (!/^text\\/html/i.test(res.headers.get("Content-Type") || "") || res.headers.get("Content-Security-Policy")) return res;
    const h = new Headers(res.headers); h.set("Content-Security-Policy", __RB_BASELINE_CSP);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  } catch (e) { return res; }
}
function __rbSecWrap(handler) {
  if (!handler || typeof handler.fetch !== "function" || handler.fetch.__rbSec) return;
  const inner = handler.fetch;
  const outer = async function (request, env, ctx) { return __rbSecHeaders(await inner.call(this, request, env, ctx)); };
  outer.__rbSec = true; handler.fetch = outer;
}
""" % BASELINE

# (script, the handler object it exports, and where the call goes: before that export line, or at the end)
SITES = (("rb-showcase", "worker_default", None),
         ("yoshcoastmusic", "__rbRadioWorker", "export default __rbRadioWorker;"),
         ("assassin-in-the-room-signal", "entry_default", None),
         ("weed-relentless-billionaire", "weed_worker_default", None))
for d, (name, handler, anchor) in zip(map(pathlib.Path, sys.argv[1:]), SITES):
    m = json.loads((d / "manifest.json").read_text())
    if m["script"] != name:
        raise SystemExit(f"patch_csp_more.py: {d} isn't {name}")
    p = d / m["entry"]
    s = p.read_text(encoding="utf-8")
    call = f"__rbSecWrap({handler});"
    if call in s:
        print(f"{name}: baseline header already in place")
        continue
    if anchor is None:
        if f"{handler} as default" not in s:
            raise SystemExit(f"{name}: '{handler} as default' not found")
        s = s.rstrip("\n") + "\n" + SEC_JS + call + "\n"
    else:
        if s.count(anchor) != 1:
            raise SystemExit(f"{name}: export not found")
        s = s.replace(anchor, SEC_JS + call + "\n" + anchor)
    p.write_text(s, encoding="utf-8")
    print(f"{name}: baseline header")
