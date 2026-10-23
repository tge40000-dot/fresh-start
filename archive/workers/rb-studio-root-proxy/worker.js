const STUDIO_ORIGIN = "https://relentless-rvpv4ddx.manus.space";

function upstreamPath(pathname) {
  const suffix = pathname.slice("/studio".length) || "/";
  const assetIndex = suffix.indexOf("/assets/");
  return assetIndex >= 0 ? suffix.slice(assetIndex) : suffix;
}

export default {
  async fetch(request) {
    const incoming = new URL(request.url);
    if (!incoming.pathname.startsWith("/studio")) return new Response("Not found", { status: 404 });
    if (incoming.pathname === "/studio") return Response.redirect(new URL("/studio/", incoming.origin), 308);
    const upstream = new URL(upstreamPath(incoming.pathname) + incoming.search, STUDIO_ORIGIN);
    const headers = new Headers(request.headers);
    headers.set("x-rb-studio-base", "/studio");
    headers.set("x-forwarded-host", incoming.host);
    headers.set("x-forwarded-proto", incoming.protocol.replace(":", ""));
    return fetch(new Request(upstream, { method: request.method, headers, body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body, redirect: "manual" }));
  },
};