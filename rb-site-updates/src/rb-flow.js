/* RB Flow: the "Create → Own → Elevate" steps and the houses switcher, drawn into any element marked data-rb-flow.
   It rides in /radio/embed.js, which every RB site already loads, so a page only needs the placeholder:
     <div data-rb-flow="license"></div>   record | license | master | release: that step is "You are here"
     <div data-rb-flow="houses"></div>    the houses switcher on its own
   Drawn in a shadow root so the page's styles can't touch it and it can't touch the page. Never runs on RB TV. */
(function () {
  "use strict";
  if (window.RBFlow) return;
  window.RBFlow = { version: 1 };
  if (/^\/tv(\/|$)/.test(location.pathname)) return;
  var MAIN = "https://relentlessbillionaire.com";
  var STEPS = [
    { key: "record", phase: "Create", label: "Record", line: "Record on a beat in your browser", href: "https://studio.relentlessbillionaire.com/" },
    { key: "license", phase: "Own", label: "License", line: "License the beat you used", href: "https://beatstore.relentlessbillionaire.com/" },
    { key: "master", phase: "Elevate", label: "Master", line: "Master the song for release", href: MAIN + "/studio/" },
    { key: "release", phase: "Elevate", label: "Release", line: "Release it and send it to RB Radio", href: MAIN + "/release" },
  ];
  var HOUSES = [
    ["Radio", MAIN + "/radio"], ["TV", MAIN + "/tv"], ["Beats", "https://beatstore.relentlessbillionaire.com/"],
    ["Record", "https://studio.relentlessbillionaire.com/"], ["Master", MAIN + "/studio/"], ["Release", MAIN + "/release"],
    ["Events", MAIN + "/events"], ["Jobs", MAIN + "/jobs"], ["Game", MAIN + "/game"], ["Memberships", MAIN + "/memberships"],
  ];
  var CSS = ":host{all:initial;display:block}\n" +
    ".f{--g:#D6AD65;--g2:#E9C687;--t:#F3EDE2;--d:#B9AE9C;--l:rgba(214,173,101,.28);--a08:rgba(214,173,101,.08);--a22:rgba(214,173,101,.22);--a06:rgba(214,173,101,.06);font:500 14px/1.4 -apple-system,BlinkMacSystemFont,\"Segoe UI\",Inter,Roboto,sans-serif;color:var(--t);box-sizing:border-box;" +
    "border:1px solid var(--l);border-radius:16px;padding:14px;background:linear-gradient(160deg,var(--a08),rgba(0,0,0,.25));-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}\n" +
    ".f *{box-sizing:border-box}a{color:inherit;text-decoration:none}a:focus-visible{outline:2px solid var(--g2);outline-offset:3px;border-radius:10px}\n" +
    ".hd{display:flex;align-items:baseline;justify-content:space-between;gap:8px 16px;flex-wrap:wrap;margin:0 0 10px}\n" +
    ".k{font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--g)}.k b{color:var(--g2)}\n" +
    ".nx{font-size:13px;color:var(--g2);font-weight:600}.nx:hover{text-decoration:underline}\n" +
    "ol{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;counter-reset:s}\n" +
    "li a{display:flex;flex-direction:column;gap:2px;min-height:64px;height:100%;padding:10px 12px;border:1px solid var(--l);border-radius:12px;background:rgba(0,0,0,.2)}\n" +
    "li a:hover{border-color:var(--g)}\n" +
    ".n{font-size:10px;font-weight:700;letter-spacing:.14em;color:var(--d);text-transform:uppercase}\n" +
    ".s{font-weight:700;font-size:15px}.ln{font-size:12px;color:var(--d)}\n" +
    "li.here a{border-color:var(--g);background:linear-gradient(145deg,var(--a22),var(--a06))}\n" +
    "li.here .n{color:var(--g2)}\n" +
    ".hs{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}.hs.solo{margin-top:0}\n" +
    ".hs a{display:inline-flex;align-items:center;min-height:36px;padding:0 12px;border:1px solid var(--l);border-radius:999px;font-size:13px;color:var(--d)}\n" +
    ".hs a:hover,.hs a[aria-current]{color:var(--g2);border-color:var(--g)}\n" +
    "@media (max-width:640px){ol{grid-template-columns:repeat(2,minmax(0,1fr))}}\n" +
    "@media print{.f{display:none}}\n";
  function sameHouse(href) {
    try { var u = new URL(href); return u.host === location.host && (u.pathname === "/" ? location.pathname === "/" : location.pathname.indexOf(u.pathname.replace(/\/$/, "")) === 0); } catch (e) { return false; }
  }
  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  function draw(spot) {
    if (spot.getAttribute("data-rb-flow-done")) return;
    spot.setAttribute("data-rb-flow-done", "1");
    var mode = (spot.getAttribute("data-rb-flow") || "").toLowerCase();
    var root = spot.attachShadow ? spot.attachShadow({ mode: "open" }) : spot;
    var st = document.createElement("style"); st.textContent = CSS; root.appendChild(st);
    var box = el("nav", { class: "f", "aria-label": mode === "houses" ? "Relentless Billionaire houses" : "Create, own, elevate" });
    var at = -1;
    for (var i = 0; i < STEPS.length; i++) if (STEPS[i].key === mode) at = i;
    if (mode !== "houses") {
      var hd = el("div", { class: "hd" });
      var k = el("p", { class: "k" }); k.appendChild(document.createTextNode("Create · Own · Elevate"));
      hd.appendChild(k);
      var next = at >= 0 && at < STEPS.length - 1 ? STEPS[at + 1] : null;
      if (next) hd.appendChild(el("a", { class: "nx", href: next.href }, "Next: " + next.line + " →"));
      box.appendChild(hd);
      var ol = el("ol");
      STEPS.forEach(function (s, j) {
        var li = el("li", j === at ? { class: "here" } : {});
        var a = el("a", { href: s.href, "aria-current": j === at ? "step" : null });
        a.appendChild(el("span", { class: "n" }, (j + 1) + " · " + s.phase + (j === at ? " · You are here" : "")));
        a.appendChild(el("span", { class: "s" }, s.label));
        a.appendChild(el("span", { class: "ln" }, s.line));
        li.appendChild(a); ol.appendChild(li);
      });
      box.appendChild(ol);
    }
    var hs = el("div", { class: mode === "houses" ? "hs solo" : "hs" });
    HOUSES.forEach(function (h) { hs.appendChild(el("a", { href: h[1], "aria-current": sameHouse(h[1]) ? "page" : null }, h[0])); });
    box.appendChild(hs);
    root.appendChild(box);
    follow(box);
  }
  /* The box takes the site colours RB Radio publishes (RB Command > Site colours > RB Radio), so it changes with
     every palette, custom ones included. Gold stays as the fallback until the station's first update arrives. */
  function rgbaOf(hex, a) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "")); if (!m) return null;
    var n = parseInt(m[1], 16); return "rgba(" + (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }
  function paint(box, th) {
    if (!th || !rgbaOf(th.accent, 1)) return;
    var set = function (k, v) { if (v) box.style.setProperty(k, v); };
    set("--g", th.accent); set("--g2", th.accent2 || th.accent); set("--t", th.text); set("--d", th.muted);
    set("--l", rgbaOf(th.accent, 0.28)); set("--a08", rgbaOf(th.accent, 0.08)); set("--a22", rgbaOf(th.accent, 0.22)); set("--a06", rgbaOf(th.accent, 0.06));
  }
  function follow(box) {
    var hook = function () {
      var r = window.RBRadio; if (!r || typeof r.subscribe !== "function") return false;
      var last = ""; r.subscribe(function (st) { var th = st && st.theme, k = th ? JSON.stringify(th) : ""; if (k !== last) { last = k; paint(box, th); } });
      return true;
    };
    if (!hook()) setTimeout(hook, 1200);
  }
  /* Pages that don't carry a placeholder yet get one here, near the end of the page and above its footer, so no
     other Worker needs a deploy. A page that adds its own data-rb-flow placeholder takes over from this list. */
  var AUTO = [
    { host: "relentlessbillionaire.com", path: /^\/store\/?$/, mode: "license", before: "main > footer" },
    { host: "beatstore.relentlessbillionaire.com", path: /^\/$/, mode: "license" },
    { host: "relentlessbillionaire.com", path: /^\/studio\/?$/, mode: "master", before: "main > .foot" },
    { host: "relentlessbillionaire.com", path: /^\/release\/?$/, mode: "release" },
    { host: "relentlessbillionaire.com", path: /^\/memberships\/?$/, mode: "houses" },
  ];
  function autoPlace() {
    if (document.querySelector("[data-rb-flow]")) return;
    var host = location.host.replace(/^www\./, "");
    for (var i = 0; i < AUTO.length; i++) {
      var a = AUTO[i];
      if (a.host !== host || !a.path.test(location.pathname)) continue;
      var main = document.querySelector("main"); if (!main) return;
      var spot = el("div", { "data-rb-flow": a.mode });
      spot.style.cssText = "display:block;max-width:1080px;margin:32px auto;padding:0 20px;box-sizing:border-box";
      var ref = a.before ? document.querySelector(a.before) : null;
      if (ref && ref.parentNode) ref.parentNode.insertBefore(spot, ref); else main.appendChild(spot);
      return;
    }
  }
  function scan() { autoPlace(); var spots = document.querySelectorAll("[data-rb-flow]"); for (var i = 0; i < spots.length; i++) draw(spots[i]); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan); else scan();
  /* Pages that build their markup after load (the store's catalog) get a second look. */
  setTimeout(scan, 1500);
})();
