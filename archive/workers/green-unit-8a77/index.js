// src/index.js
var src_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/game" || url.pathname.startsWith("/game/")) {
      const rewritten = new Request(
        new URL("/", url).toString(),
        request
      );
      return env.ASSETS.fetch(rewritten);
    }
    return env.ASSETS.fetch(request);
  }
};
export {
  src_default as default
};
//# sourceMappingURL=index.js.map
