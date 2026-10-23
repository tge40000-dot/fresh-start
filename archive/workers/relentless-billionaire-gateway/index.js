var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
var index_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/dashboard" || path.startsWith("/dashboard/")) {
      const target = "https://relentless-billionaire-assistant.tge40000.workers.dev";
      return fetch(target + path.replace("/dashboard", ""), request);
    }
    if (path.startsWith("/dashboard/admin")) {
      return fetch("https://relentless-billionaire.pages.dev/admin", request);
    }
    const modules = [
      "leadgen",
      "crm",
      "health",
      "approvals",
      "alerts",
      "agents",
      "system"
    ];
    for (const m of modules) {
      if (path.startsWith(`/dashboard/${m}`)) {
        return fetch(`https://relentless-billionaire-assistant.tge40000.workers.dev/${m}`, request);
      }
    }
    if (path.startsWith("/agent/")) {
      return handleAgent(request, env);
    }
    if (path.startsWith("/signal/")) {
      return handleSignal(request, env);
    }
    if (path.startsWith("/state/")) {
      return handleState(request, env);
    }
    if (path.startsWith("/memory/")) {
      return handleMemory(request, env);
    }
    return fetch(`https://relentless-billionaire.pages.dev${path}`, request);
  }
};
async function handleAgent(request, env) {
  const url = new URL(request.url);
  const agent = url.pathname.replace("/agent/", "");
  switch (agent) {
    case "lead":
      return json({ status: "lead agent executed" });
    case "crm":
      return json({ status: "crm agent executed" });
    case "health":
      return json({ status: "health agent executed" });
    case "approvals":
      return json({ status: "approvals agent executed" });
    case "alerts":
      return json({ status: "alerts agent executed" });
    default:
      return new Response("Unknown agent", { status: 404 });
  }
}
__name(handleAgent, "handleAgent");
async function handleSignal(request, env) {
  return json({ signal: "received" });
}
__name(handleSignal, "handleSignal");
async function handleState(request, env) {
  return json({ state: "ok" });
}
__name(handleState, "handleState");
async function handleMemory(request, env) {
  return json({ memory: "ok" });
}
__name(handleMemory, "handleMemory");
function json(obj) {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
__name(json, "json");
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
