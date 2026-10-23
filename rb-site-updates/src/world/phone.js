// RB World's phone: everything that used to sit around the screen, in one place, like the phone in GTA.
// While you drive the screen keeps only what you need: the radar and speed, your money and rank, wanted stars, the
// lot you're next to, the job you're on and the race you're in. Everything else is an app on the phone:
//   Jobs, Empire, Races, Goals, Messages, Radio, Leaders, Events, Talent, Armory, Combat, News, Camera, View, Map,
//   VR, Profile, RB Badge, Settings and Help.
// 📱 or T opens and closes it, Esc closes it. Settings > Screen > Classic brings back the old layout.
// The apps open the game's own panels (the same buttons as before, now kept off screen); Radio, Events and News
// are shown on the phone itself.
const KEY = "rb_world_screen";
const pref = { get: () => { try { return localStorage.getItem(KEY) || "phone"; } catch (e) { return "phone"; } }, set: (v) => { try { localStorage.setItem(KEY, v); } catch (e) {} } };
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const press = (id) => () => { const b = $(id); if (b) b.click(); };

const CSS = `
body.rb-phone-ui #event-ticker,body.rb-phone-ui #billion-bar,body.rb-phone-ui #leaderboard,body.rb-phone-ui #controls,body.rb-phone-ui #events-bar,
body.rb-phone-ui #radio-bar,body.rb-phone-ui #rb-level,body.rb-phone-ui #rb-clock,body.rb-phone-ui #rb-badge-chip,body.rb-phone-ui:not(.rb-racing) #rb-board{display:none!important}
body.rb-phone-ui #hud-stats{display:flex;justify-content:flex-end;gap:6px;padding:8px 12px 0;grid-template-columns:none}
body.rb-phone-ui #hud-stats .stat-card{padding:5px 10px;border-radius:999px;min-width:0;flex:none;display:flex;align-items:center;gap:6px;background:rgba(0,0,0,.72)}
body.rb-phone-ui #hud-stats .stat-label{font-size:8px;margin:0;opacity:.7}body.rb-phone-ui #hud-stats .stat-value{font-size:13px}
body.rb-phone-ui #hud-stats .stat-card:nth-child(2){display:none}
body.rb-phone-ui #hud-stats .stat-card:nth-child(3) .stat-value::before{content:"💎 "}body.rb-phone-ui #hud-stats .stat-card:nth-child(4) .stat-value::before{content:"🏆 "}
#rb-phone-btn{position:fixed;z-index:7700;right:14px;bottom:calc(14px + env(safe-area-inset-bottom));width:52px;height:52px;border-radius:16px;border:1px solid rgba(201,168,76,.7);
  background:linear-gradient(160deg,#1b1810,#050505);color:#F5E6A3;font-size:24px;cursor:pointer;box-shadow:0 10px 28px rgba(0,0,0,.6);display:none;align-items:center;justify-content:center;touch-action:manipulation}
body.rb-phone-ui #rb-phone-btn{display:flex}#rb-phone-btn i{position:absolute;top:6px;right:6px;width:9px;height:9px;border-radius:50%;background:#FF5A6E;display:none}#rb-phone-btn.dot i{display:block}
#rb-phone{position:fixed;z-index:9000;right:16px;bottom:calc(78px + env(safe-area-inset-bottom));width:320px;height:min(620px,calc(100vh - 110px));display:none;flex-direction:column;
  border-radius:34px;border:2px solid #2a2418;background:#07070a;box-shadow:0 0 0 6px #000,0 0 0 7px rgba(201,168,76,.45),0 30px 60px rgba(0,0,0,.7);overflow:hidden;color:#fff;font:500 13px/1.35 Inter,system-ui,sans-serif}
#rb-phone.open{display:flex;animation:rbph .22s ease-out}@keyframes rbph{from{transform:translateY(40px);opacity:0}to{transform:none;opacity:1}}
#rb-phone .ph-status{display:flex;justify-content:space-between;align-items:center;padding:12px 22px 6px;font:700 11px/1 Inter,sans-serif;color:#F5E6A3}
#rb-phone .ph-status span:last-child{display:flex;gap:6px;align-items:center}#rb-phone .ph-batt{width:20px;height:9px;border:1px solid #F5E6A3;border-radius:2px;position:relative}#rb-phone .ph-batt:after{content:"";position:absolute;inset:1px 3px 1px 1px;background:#F5E6A3}
#rb-phone .ph-body{flex:1;overflow-y:auto;padding:6px 14px 14px}
#rb-phone .ph-card{background:linear-gradient(160deg,rgba(201,168,76,.16),rgba(255,255,255,.03));border:1px solid rgba(201,168,76,.3);border-radius:18px;padding:12px 14px;margin-bottom:12px}
#rb-phone .ph-card small{display:block;color:rgba(255,255,255,.55);font-size:9px;letter-spacing:.14em;text-transform:uppercase}
#rb-phone .ph-worth{font:900 24px/1.1 Orbitron,Inter,sans-serif;color:#F5E6A3;margin:2px 0 6px}
#rb-phone .ph-row{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:rgba(255,255,255,.8)}#rb-phone .ph-row b{color:#fff}
#rb-phone .ph-bar{height:5px;border-radius:4px;background:rgba(255,255,255,.1);margin-top:8px;overflow:hidden}#rb-phone .ph-bar i{display:block;height:100%;background:linear-gradient(90deg,#C9A84C,#F5E6A3)}
#rb-phone .ph-apps{display:grid;grid-template-columns:repeat(4,1fr);gap:14px 6px}
#rb-phone .ph-app{display:flex;flex-direction:column;align-items:center;gap:5px;background:none;border:0;color:#fff;cursor:pointer;font:600 10px/1.2 Inter,sans-serif;padding:0;touch-action:manipulation}
#rb-phone .ph-app span{width:54px;height:54px;border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:25px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);position:relative}
#rb-phone .ph-app:hover span,#rb-phone .ph-app:focus-visible span{border-color:rgba(201,168,76,.7);background:rgba(201,168,76,.14)}#rb-phone .ph-app:focus-visible{outline:none}
#rb-phone .ph-app em{position:absolute;top:-4px;right:-4px;min-width:16px;height:16px;border-radius:8px;background:#FF5A6E;font:800 9px/16px Inter,sans-serif;font-style:normal;display:none}
#rb-phone .ph-app.dot em{display:block}
#rb-phone .ph-head{display:flex;align-items:center;gap:10px;margin:2px 0 12px}#rb-phone .ph-head button{background:none;border:0;color:#F5E6A3;font-size:20px;cursor:pointer;padding:4px 8px 4px 0}
#rb-phone .ph-head b{font:800 15px/1 Orbitron,Inter,sans-serif;letter-spacing:.06em;color:#F5E6A3}
#rb-phone .ph-list{list-style:none;margin:0;padding:0}#rb-phone .ph-list li{padding:10px 2px;border-bottom:1px solid rgba(255,255,255,.07);overflow-wrap:anywhere}#rb-phone .ph-list li small{color:rgba(255,255,255,.5)}
#rb-phone .ph-muted{color:rgba(255,255,255,.5);font-size:12px}
#rb-phone .ph-np{font:800 17px/1.25 Inter,sans-serif;margin:6px 0 2px}#rb-phone .ph-live{color:#FF5A6E;font-weight:800;font-size:11px;letter-spacing:.14em}
#rb-phone .ph-btn{border:1px solid rgba(201,168,76,.7);background:linear-gradient(135deg,#F2D98A,#C9A227);color:#111;border-radius:999px;padding:10px 18px;font:800 12px/1 Inter,sans-serif;cursor:pointer;min-height:40px}
#rb-phone .ph-btn.ghost{background:transparent;color:#F5E6A3}#rb-phone input[type=range]{width:100%;accent-color:#C9A227}
#rb-phone .ph-home{display:block;margin:8px auto 10px;width:110px;height:5px;border-radius:3px;background:rgba(255,255,255,.35);border:0;cursor:pointer}
@media (max-width:640px){#rb-phone-btn{right:auto;left:50%;transform:translateX(-50%);width:48px;height:48px}
  #rb-phone{left:8px;right:8px;width:auto;bottom:calc(70px + env(safe-area-inset-bottom));height:min(78vh,620px);border-radius:28px}
  body.rb-phone-ui #hud-stats{padding:6px 8px 0}body.rb-phone-ui #hud-stats .stat-card{padding:4px 8px}body.rb-phone-ui #hud-stats .stat-value{font-size:11px}body.rb-phone-ui #hud-stats .stat-label{display:none}}
body:has(.overlay[style*="flex"]) #rb-phone-btn,body:has(#chat-panel.open) #rb-phone-btn,body:has(#ov-empire[style*="flex"]) #rb-phone-btn,body.rb-photo #rb-phone-btn{display:none!important}
`;

export function initPhone(E, ctx) {
  const st = el("style"); st.textContent = CSS; document.head.appendChild(st);
  const btn = el("button"); btn.id = "rb-phone-btn"; btn.type = "button"; btn.title = "Phone (T)"; btn.setAttribute("aria-label", "Open your phone (T)"); btn.setAttribute("aria-expanded", "false");
  btn.append("📱", el("i")); document.body.appendChild(btn);
  const ph = el("div"); ph.id = "rb-phone"; ph.setAttribute("role", "dialog"); ph.setAttribute("aria-label", "Phone");
  const status = el("div", "ph-status"), time = el("span", null, "RB"), right = el("span");
  const radioIcon = el("span", null, ""); right.append(radioIcon, el("span", null, "RB 5G"), el("span", "ph-batt"));
  status.append(time, right);
  const body = el("div", "ph-body"), home = el("button", "ph-home"); home.type = "button"; home.setAttribute("aria-label", "Home screen");
  ph.append(status, body, home); document.body.appendChild(ph);
  const news = [], out = { open: false, screen: "home", show: (s) => render(s), toggle: () => (out.open ? close() : open()) };

  const APPS = [
    ["jobs", "💼", "Jobs", press("btn-hustle")], ["empire", "🏢", "Empire", press("btn-empire")], ["races", "🏁", "Races", press("btn-race")], ["goals", "📋", "Goals", press("btn-goals")],
    ["chat", "💬", "Messages", press("btn-chat")], ["radio", "📻", "Radio", "radio"], ["leaders", "🏆", "Leaders", press("btn-board")], ["events", "📅", "Events", "events"],
    ["talent", "🃏", "Talent", press("btn-cards")], ["armory", "🔫", "Armory", press("btn-shop")], ["combat", "⚔️", "Combat", press("btn-combat")], ["news", "📰", "News", "news"],
    ["camera", "📷", "Camera", press("btn-photo")], ["view", "🎥", "View", press("btn-pov")], ["map", "🗺️", "Map", press("rb-radar")], ["vr", "🥽", "VR", press("btn-vr")],
    ["profile", "👤", "Profile", press("btn-profile")], ["badge", "⭐", "RB Badge", () => { const c = $("rb-badge-chip"); window.open(c && c.href ? c.href : "/app", "_blank", "noopener"); }],
    ["settings", "⚙️", "Settings", press("btn-settings")], ["help", "❔", "Help", press("btn-help")],
  ];
  const txt = (id) => (($(id) || {}).textContent || "").trim();
  function widget() {
    const c = el("div", "ph-card");
    c.append(el("small", null, "Net worth"), el("div", "ph-worth", txt("s-networth") || "$0"));
    const r = el("div", "ph-row");
    const lv = txt("rb-level").replace(/\s+/g, " ");
    [["Empire", txt("s-empire")], ["Tokens", txt("s-tokens")], ["Rank", txt("s-rank")]].forEach(([k, v]) => { const s = el("span"); s.append(k + " ", el("b", null, v || "–")); r.appendChild(s); });
    c.appendChild(r);
    if (lv) c.appendChild(el("div", "ph-muted", lv));
    const badge = txt("rb-badge-chip"); if (badge) c.appendChild(el("div", "ph-muted", "⭐ " + badge));
    const bar = el("div", "ph-bar"), fill = el("i"); fill.style.width = (($("billion-fill") || {}).style || {}).width || "0%"; bar.appendChild(fill);
    c.append(bar, el("div", "ph-muted", "Race to $1B"));
    return c;
  }
  function head(title) {
    const h = el("div", "ph-head"), back = el("button", null, "‹"); back.type = "button"; back.setAttribute("aria-label", "Back"); back.onclick = () => render("home");
    h.append(back, el("b", null, title)); return h;
  }
  function radioScreen() {
    const R = window.RBRadio, cr = window.RBCarRadio || {}, frag = document.createDocumentFragment();
    frag.appendChild(head("RB RADIO"));
    if (cr.enabled === false) { frag.appendChild(el("p", "ph-muted", "The car radio is off in RB World right now.")); return frag; }
    const s = R ? R.state() : null, c = el("div", "ph-card");
    if (s && s.live) c.appendChild(el("div", "ph-live", "● LIVE NOW"));
    c.appendChild(el("small", null, s && s.playing ? "Now playing" : "On air"));
    c.appendChild(el("div", "ph-np", s ? (s.live ? s.live.title || "Live show" : s.on_air ? s.on_air.title : "Tuning in…") : "Tuning in…"));
    c.appendChild(el("div", "ph-muted", s ? (s.live ? s.live.host || "" : s.on_air ? s.on_air.artist || "" : "") : ""));
    const play = el("button", "ph-btn", s && s.playing ? "⏸ Turn off" : "▶ Listen in the car"); play.type = "button"; play.style.marginTop = "12px";
    play.onclick = () => { if (cr.toggle) cr.toggle(); setTimeout(() => render("radio"), 300); };
    c.appendChild(play);
    if (R) { const v = el("input"); v.type = "range"; v.min = "0"; v.max = "1"; v.step = "0.05"; v.value = String(s ? s.volume : 1); v.setAttribute("aria-label", "Radio volume"); v.oninput = () => R.volume(Number(v.value)); v.style.marginTop = "12px"; c.appendChild(v); }
    frag.appendChild(c);
    const playing = s && s.on_air ? s.on_air.title + "|" + s.on_air.artist : "";
    const next = s && !s.live ? (s.next || []).filter((n) => n.title + "|" + n.artist !== playing).slice(0, 4) : [];
    if (next.length) { frag.appendChild(el("small", "ph-muted", "UP NEXT")); const ul = el("ul", "ph-list"); next.forEach((n) => { const li = el("li"); li.append(el("b", null, n.title), el("br"), el("small", null, n.artist || "")); ul.appendChild(li); }); frag.appendChild(ul); }
    frag.appendChild(el("p", "ph-muted", "Everyone in RB World hears the same song. M turns it on and off while you drive."));
    return frag;
  }
  function listScreen(title, items, empty) {
    const frag = document.createDocumentFragment(); frag.appendChild(head(title));
    if (!items.length) { frag.appendChild(el("p", "ph-muted", empty)); return frag; }
    const ul = el("ul", "ph-list"); items.forEach((t) => ul.appendChild(el("li", null, t))); frag.appendChild(ul); return frag;
  }
  function render(screen = "home") {
    out.screen = screen; body.textContent = "";
    if (screen === "radio") body.appendChild(radioScreen());
    else if (screen === "events") body.appendChild(listScreen("RB EVENTS", [...(($("events-list") || {}).children || [])].map((x) => x.textContent.trim()).filter((t) => t && !/^No upcoming/i.test(t)), "No RB events coming up right now. See relentlessbillionaire.com/events."));
    else if (screen === "news") body.appendChild(listScreen("CITY NEWS", news.slice().reverse(), "Nothing on the wire yet."));
    else {
      body.appendChild(widget());
      const grid = el("div", "ph-apps");
      APPS.forEach(([key, icon, label, act]) => {
        const b = el("button", "ph-app"); b.type = "button"; b.dataset.app = key; b.setAttribute("aria-label", label);
        const ic = el("span", null, icon); ic.appendChild(el("em", null, "")); b.append(ic, label);
        if (key === "chat" && chatUnread()) b.classList.add("dot");
        b.onclick = () => { if (typeof act === "string") render(act); else { close(); act(); } };
        grid.appendChild(b);
      });
      body.appendChild(grid);
    }
    body.scrollTop = 0;
  }
  // new city chat while the chat isn't open: a dot on the phone and on Messages
  let unread = false, seen = 0;
  const chatUnread = () => unread;
  const cm = $("chat-messages"), cp = $("chat-panel");
  if (cm && cp) {
    new MutationObserver(() => { const n = cm.children.length; if (n > seen && !cp.classList.contains("open")) unread = true; seen = n; }).observe(cm, { childList: true });
    new MutationObserver(() => { if (cp.classList.contains("open")) { unread = false; seen = cm.children.length; } }).observe(cp, { attributes: true, attributeFilter: ["class"] });
  }
  function tick() {
    const clock = ($("rb-clock") || {}).textContent || "";
    time.textContent = clock.split(" · ")[0] || "RB";
    const cr = window.RBCarRadio; radioIcon.textContent = cr && cr.playing ? "📻" : "";
    btn.classList.toggle("dot", chatUnread());
    if (out.open && out.screen === "home") { const w = body.querySelector(".ph-card"); if (w) w.replaceWith(widget()); }
  }
  // a game window (a panel, the shop, the profile, the chat) is open: the phone waits until it's closed
  const busy = () => ($("ov-empire") || {}).style?.display === "flex" || !!document.querySelector('.overlay[style*="flex"]') || !!($("chat-panel") || {}).classList?.contains("open") || document.body.classList.contains("rb-photo");
  function open(screen = "home") { if (!document.body.classList.contains("rb-phone-ui") || busy()) return; out.open = true; render(screen); ph.classList.add("open"); btn.setAttribute("aria-expanded", "true"); const f = ph.querySelector(".ph-app,.ph-head button"); if (f && matchMedia("(pointer:fine)").matches) f.focus({ preventScroll: true }); }
  function close() { out.open = false; ph.classList.remove("open"); btn.setAttribute("aria-expanded", "false"); }
  btn.onclick = () => (out.open ? close() : open());
  home.onclick = () => render("home");
  window.addEventListener("keydown", (e) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "")) return;
    if (e.code === "KeyT" && !e.repeat) { e.preventDefault(); out.open ? close() : open(); }
    else if (e.code === "Escape" && out.open) close();
  });
  // the news wire: every ticker line the game shows
  const tk = $("ticker-text");
  if (tk) new MutationObserver(() => { const t = tk.textContent.trim(); if (t && news[news.length - 1] !== t) { news.push(t); if (news.length > 30) news.shift(); if (out.open && out.screen === "news") render("news"); } }).observe(tk, { childList: true, characterData: true, subtree: true });
  if (window.RBRadio) window.RBRadio.subscribe(() => { if (out.open && out.screen === "radio" && document.activeElement?.type !== "range") render("radio"); });
  else window.addEventListener("rbradio:ready", () => window.RBRadio.subscribe(() => { if (out.open && out.screen === "radio" && document.activeElement?.type !== "range") render("radio"); }), { once: true });
  // the screen: phone (clean) or classic (everything on screen, as before)
  const sel = $("set-screen");
  const apply = (v) => { document.body.classList.toggle("rb-phone-ui", v !== "classic"); if (sel) sel.value = v === "classic" ? "classic" : "phone"; if (v === "classic") close(); window.dispatchEvent(new Event("resize")); };
  apply(pref.get());
  if (sel) sel.onchange = () => { pref.set(sel.value); apply(sel.value); };
  setInterval(tick, 1000); tick();
  return out;
}
