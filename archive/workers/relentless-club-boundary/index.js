var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.ts
var clubPrefix = "/club";
function securityHeaders(headers = new Headers()) {
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("x-frame-options", "SAMEORIGIN");
  return headers;
}
__name(securityHeaders, "securityHeaders");
function htmlResponse(status, title, detail) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="margin:0;background:#10110f;color:#f5eee2;font-family:ui-sans-serif,system-ui;display:grid;min-height:100vh;place-items:center;padding:2rem"><main style="max-width:38rem"><p style="letter-spacing:.2em;text-transform:uppercase;color:#d6b778;font-size:.75rem">Relentless Billionaire</p><h1 style="font-family:Georgia,serif;font-size:3rem;line-height:1;margin:.75rem 0">${title}</h1><p style="color:#b9b0a2;line-height:1.7">${detail}</p></main></body></html>`, { status, headers: securityHeaders(new Headers({ "content-type": "text/html; charset=UTF-8" })) });
}
__name(htmlResponse, "htmlResponse");
async function proxyClubRequest(request, origin) {
  const incoming = new URL(request.url);
  const upstream = new URL(origin);
  upstream.pathname = `${upstream.pathname.replace(/\/$/, "")}${incoming.pathname.slice(clubPrefix.length) || "/"}`;
  upstream.search = incoming.search;
  const headers = new Headers(request.headers);
  headers.set("x-rb-club-boundary", "1");
  headers.delete("host");
  const response = await fetch(new Request(upstream, { method: request.method, headers, body: ["GET", "HEAD"].includes(request.method) ? void 0 : request.body, redirect: "manual" }));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: securityHeaders(new Headers(response.headers)) });
}
__name(proxyClubRequest, "proxyClubRequest");
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/_internal/health") {
      return Response.json({ service: "relentless-club-boundary", status: "healthy", routing: env.CLUB_APP_ORIGIN ? "proxy-ready" : "origin-pending", bindings: ["CLUB_DB", "CLUB_PUBLIC", "CLUB_MEDIA", "AI"] }, { headers: securityHeaders() });
    }
    if (!url.pathname.startsWith(clubPrefix)) return new Response("Not Found", { status: 404, headers: securityHeaders() });
    if (!env.CLUB_APP_ORIGIN) return htmlResponse(503, "The club is being prepared.", "The protected member environment has been deployed safely and is awaiting its published club application origin.");
    return proxyClubRequest(request, env.CLUB_APP_ORIGIN);
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
