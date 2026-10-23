var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker-api-v2-fixed.js
var OG = "https://relentless-billionaire.pages.dev";
var VIDEO_SIDEBAR_HTML_TEMPLATE = `
<style>
.rb-video-sidebar{position:fixed;top:0;right:0;width:320px;height:100vh;background:#000;z-index:999;box-shadow:-2px 0 10px rgba(0,0,0,.3);transition:transform .3s ease;font-family:'Inter',sans-serif;overflow:hidden}
.rb-video-sidebar.hidden{transform:translateX(100%)}
.rb-video-sidebar .vs-close{position:absolute;top:12px;right:12px;z-index:1001;background:rgba(255,255,255,.9);border:none;border-radius:50%;width:32px;height:32px;cursor:pointer;font-size:18px;line-height:32px;text-align:center;color:#000}
.rb-video-sidebar .vs-mute{position:absolute;top:12px;left:12px;z-index:1001;background:rgba(255,255,255,.9);border:none;border-radius:50%;width:32px;height:32px;cursor:pointer;font-size:16px;line-height:32px;text-align:center;color:#000}
.rb-video-sidebar video{width:100%;height:100%;object-fit:cover}
.rb-video-sidebar .vs-overlay{position:absolute;bottom:0;left:0;right:0;background:linear-gradient(transparent,rgba(0,0,0,.85));padding:20px;color:#fff}
.rb-video-sidebar .vs-overlay h3{font-family:'Playfair Display',serif;font-size:18px;font-weight:700;margin:0 0 6px}
.rb-video-sidebar .vs-overlay p{font-size:13px;opacity:.9;margin:0 0 12px}
.rb-video-sidebar .vs-overlay .vs-cta{display:inline-block;background:#d4af37;color:#000;padding:8px 16px;text-decoration:none;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:1px;border-radius:3px}
.rb-video-sidebar .vs-overlay .vs-cta:hover{background:#c9a227}
.rb-video-sidebar .vs-nav{position:absolute;top:50%;left:0;right:0;transform:translateY(-50%);display:flex;justify-content:space-between;align-items:center;padding:0 10px;pointer-events:none}
.rb-video-sidebar .vs-nav button{pointer-events:auto;background:rgba(255,255,255,.9);border:none;border-radius:50%;width:36px;height:36px;font-size:20px;cursor:pointer;color:#000}
.rb-video-sidebar .vs-nav .vs-counter{background:rgba(0,0,0,.7);color:#fff;padding:3px 10px;border-radius:12px;font-size:11px}
.rb-vs-toggle{position:fixed;top:50%;right:0;transform:translateY(-50%);z-index:998;background:#d4af37;color:#000;border:none;padding:12px 8px;border-radius:4px 0 0 4px;cursor:pointer;font-size:14px;font-weight:700;writing-mode:vertical-rl;display:none}
.rb-vs-toggle.show{display:block}
@media(max-width:768px){.rb-video-sidebar{width:100%;height:220px;top:auto;bottom:0;right:0}.rb-video-sidebar.hidden{transform:translateY(100%)}}
</style>
<div id="rbVS" class="rb-video-sidebar {{HIDDEN_CLASS}}">
<button class="vs-close" onclick="rbVS.close()">&#10005;</button>
<button class="vs-mute" id="rbVSMute" onclick="rbVS.toggleMute()">&#128263;</button>
<video id="rbVSVideo" autoplay muted playsinline></video>
<div class="vs-overlay"><h3 id="rbVSTitle"></h3><p id="rbVSDesc"></p><a id="rbVSCta" class="vs-cta" href="#">Shop Now</a></div>
<div class="vs-nav" id="rbVSNav" style="display:none"><button onclick="rbVS.prev()">&#8249;</button><span class="vs-counter" id="rbVSCounter">1/1</span><button onclick="rbVS.next()">&#8250;</button></div>
</div>
<button id="rbVSToggle" class="rb-vs-toggle {{TOGGLE_CLASS}}" onclick="rbVS.open()">&#9654; VIDEO</button>
<script>
!function(){
  var e = {{VIDEO_CONFIG_JSON}};
  var t=0,n=!0,i,s=document.getElementById("rbVS"),o=document.getElementById("rbVSVideo"),a=document.getElementById("rbVSTitle"),r=document.getElementById("rbVSDesc"),c=document.getElementById("rbVSCta"),l=document.getElementById("rbVSCounter"),d=document.getElementById("rbVSNav"),u=document.getElementById("rbVSToggle"),m=document.getElementById("rbVSMute");
  function f(idx){
    var v=e[idx];
    if(!v) return;
    o.src=v.url;
    a.textContent=v.title;
    r.textContent=v.desc||"";
    c.textContent=v.cta?v.cta.text:"Shop Now";
    c.href=v.cta?v.cta.url:"/store";
    l.textContent=(idx+1)+"/"+e.length;
    e.length>1&&(d.style.display="flex");
    o.play().catch(function(){});
  }
  function g(){
    clearInterval(i);
    i=setInterval(function(){t=(t+1)%e.length;f(t)}, {{AUTO_ADVANCE_MS}});
  }
  window.rbVS={
    close:function(){s.classList.add("hidden");u.classList.add("show");clearInterval(i);o.pause()},
    open:function(){s.classList.remove("hidden");u.classList.remove("show");o.play().catch(function(){});g()},
    next:function(){t=(t+1)%e.length;f(t);g()},
    prev:function(){t=(t-1+e.length)%e.length;f(t);g()},
    toggleMute:function(){n=!n;o.muted=n;m.textContent=n?"\\u{1F507}":"\\u{1F50A}"}
  };
  o.addEventListener("ended",function(){t=(t+1)%e.length;f(t)});
  if(e.length>0){f(0);g();}
}();
<\/script>
`;
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,X-Admin-Key"
  };
}
__name(corsHeaders, "corsHeaders");
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders())
  });
}
__name(jsonResponse, "jsonResponse");
var worker_api_v2_fixed_default = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (path.startsWith("/api/trpc/") || path.startsWith("/api/auth/")) {
      const oUrl2 = OG + path + url.search;
      return fetch(new Request(oUrl2, request));
    }
    if (path === "/api/health") {
      return jsonResponse({ status: "ok", ts: Date.now() });
    }
    const oUrl = OG + path + url.search;
    const resp = await fetch(new Request(oUrl, request));
    const ct = resp.headers.get("content-type") || "";
    if (ct.includes("text/html")) {
      const rawConfig = await env.RELENTLESS_KV.get("video-config");
      const config = rawConfig ? JSON.parse(rawConfig) : {
        videos: [{
          url: "https://relentlessbillionaire.com/assets/videos/soho-collection.mp4",
          title: "The Soho Collection",
          desc: "Five pieces. Five stories.",
          cta: { text: "Shop Now", url: "/store" },
          active: true
        }],
        autoAdvanceSec: 30,
        showOnLoad: true
      };
      const activeVideos = config.videos.filter((v) => v.active);
      const html = VIDEO_SIDEBAR_HTML_TEMPLATE.replace("{{VIDEO_CONFIG_JSON}}", JSON.stringify(activeVideos)).replace("{{AUTO_ADVANCE_MS}}", (config.autoAdvanceSec * 1e3).toString()).replace("{{HIDDEN_CLASS}}", config.showOnLoad ? "" : "hidden").replace("{{TOGGLE_CLASS}}", config.showOnLoad ? "" : "show");
      return new HTMLRewriter().on("body", {
        element(el) {
          el.append(html, { html: true });
        }
      }).transform(resp);
    }
    return resp;
  }
};
export {
  worker_api_v2_fixed_default as default
};
//# sourceMappingURL=worker-api-v2-fixed.js.map
