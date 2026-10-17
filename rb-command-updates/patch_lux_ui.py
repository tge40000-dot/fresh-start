"""RB Command's dark-luxury look, in the direction of the owner's mockups (17 Oct 2026). Nothing is removed.

Usage: python3 -I patch_lux_ui.py <pulled rb-command dir>

- The page's content policy lets the two brand fonts load from Google (font-src fonts.gstatic.com; nothing else changes).
- A style layer on top of the existing CSS: Cinzel and Cormorant type, an icon for every nav item, gold glow and
  depth on panels and tiles, a gold-gradient page title, a crown mark, crimson LIVE badges, softer tables and buttons.
  It only uses the colour variables, so every RB Command palette from Site colours keeps working.
- Search everything (Ctrl/⌘ K or "/"): jump to any screen, table or tool by typing, from anywhere in RB Command.

Each anchor must match exactly once; an edit already in place is skipped, so running it twice changes nothing.
"""
import pathlib
import sys
from urllib.parse import quote

folder = pathlib.Path(sys.argv[1])


def edit(name, old, new):
    p = folder / name
    s = p.read_text(encoding="utf-8")
    added = new[len(old):] if new.startswith(old) else new[: len(new) - len(old)] if new.endswith(old) else None
    if added and s.count(added) > 1:
        first = s.index(added) + len(added)
        s = s[:first] + s[first:].replace(added, "")
        p.write_text(s, encoding="utf-8")
        print(f"{name}: removed a duplicate copy")
    mark = next((ln for ln in added.split("\n") if ln.strip()), "") if added else ""
    if new in s or (added and added in s) or (len(mark.strip()) >= 25 and ("\n" + mark + "\n") in ("\n" + s)):
        return
    if s.count(old) != 1:
        raise SystemExit(f"{name}: anchor found {s.count(old)} times: {old[:70]!r}")
    p.write_text(s.replace(old, new), encoding="utf-8")
    print(f"{name}: edited")


# ---------------------------------------------------------------- icons (24px outline paths, drawn with currentColor through a mask)
P = {
    "grid": "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
    "pulse": "M3 12h4l3-8 4 16 3-8h4",
    "chart": "M4 20V10M10 20V4M16 20v-7M22 20H2",
    "inbox": "M3 13l3-8h12l3 8v6H3zM3 13h5l2 3h4l2-3h5",
    "cal": "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
    "check": "M4 12l5 5L20 6",
    "layout": "M4 4h16v16H4zM4 9h16M10 9v11",
    "palette": "M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-1-2 0-3 3 0 4-1 2-3 2-4a8 8 0 0 0-8-8zM7.5 11.5h.01M10 7.5h.01M15 7.5h.01",
    "mega": "M3 10v4h4l7 5V5L7 10zM18 8a5 5 0 0 1 0 8",
    "radio": "M4 9h16v11H4zM8 9l9-5M8 15h.01M14 13h3M14 16h3",
    "users": "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M17 3a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6",
    "brief": "M3 7h18v13H3zM8 7V4h8v3M3 13h18",
    "folder": "M3 6h7l2 2h9v11H3z",
    "spark": "M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z",
    "pen": "M4 20l4-1 11-11-3-3L5 16zM14 6l3 3",
    "star": "M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9z",
    "search": "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5",
    "doc": "M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7",
    "film": "M3 5h18v14H3zM7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4",
    "upload": "M12 16V4M7 9l5-5 5 5M4 20h16",
    "list": "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01",
    "clock": "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
    "heart": "M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.5A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z",
    "link": "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
    "key": "M8 15a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM11 11h10M18 11v3M21 11v2",
    "user": "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
    "cloud": "M7 18a5 5 0 0 1-.5-10A6 6 0 0 1 18 9a4.5 4.5 0 0 1-1 9z",
    "dot": "M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
    "crown": "M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z",
}
ROUTE = {
    "#/": "grid", "#/signal": "pulse", "#/analytics": "chart", "#/inbox": "inbox", "#/shows": "cal", "#/review": "check",
    "#/blocks": "layout", "#/colors": "palette", "#/affiliate": "mega", "#/radio": "radio", "#/crm": "users", "#/jobs": "brief",
    "#/projects": "folder", "#/autopilot": "spark", "#/create": "pen", "#/marketing": "mega", "#/talent": "star",
    "/finder": "search", "/resumes": "doc", "/video": "film", "/upload": "upload", "#/tasks": "list", "#/activity": "clock",
    "#/health": "heart", "#/apps": "link", "#/team": "users", "#/keys": "key", "#/account": "user", "#/rehost": "cloud",
}


def svg_url(path):
    svg = f"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='{path}'/></svg>"
    return 'url("data:image/svg+xml,' + quote(svg, safe="/:=' ,.-") + '")'


icons = "".join(f'.nav a[href="{h}"]{{--ic:{svg_url(P[k])}}}\n' for h, k in ROUTE.items())

LUX = (
    "/* ---- RB lux layer (17 Oct 2026): look and feel only, every value stays real */\n"
    '@font-face{font-family:"RB Cinzel";src:url(https://fonts.gstatic.com/s/cinzel/v26/8vIJ7ww63mVu7gt79mT7.woff2) format("woff2");font-weight:400 900;font-display:swap}\n'
    '@font-face{font-family:"RB Cormorant";src:url(https://fonts.gstatic.com/s/cormorantgaramond/v21/co3bmX5slCNuHLi8bLeY9MK7whWMhyjYqXtK.woff2) format("woff2");font-weight:300 700;font-display:swap}\n'
    ':root{--caps:"RB Cinzel",Cinzel,"Times New Roman",serif;--serif:"RB Cormorant","Cormorant Garamond",Georgia,serif;--glow:color-mix(in srgb,var(--brass) 22%,transparent);--glow2:color-mix(in srgb,var(--brass) 9%,transparent);--edge:color-mix(in srgb,var(--brass) 30%,var(--line))}\n'
    "body{background:radial-gradient(1100px 520px at 78% -12%,var(--glow2),transparent 62%),radial-gradient(900px 600px at -10% 110%,color-mix(in srgb,var(--bad) 7%,transparent),transparent 60%),var(--bg);background-attachment:fixed}\n"
    ".nav{background:linear-gradient(180deg,color-mix(in srgb,var(--side) 92%,var(--brass)),var(--side) 30%);box-shadow:inset -1px 0 0 var(--line)}\n"
    ".brand{font-family:var(--caps);display:flex;flex-direction:column;gap:6px;padding-left:44px;position:relative;min-height:40px}\n"
    ".brand::before{content:\"\";position:absolute;left:6px;top:2px;width:30px;height:30px;border-radius:50%;border:1px solid var(--edge);background:radial-gradient(circle at 50% 35%,var(--glow),transparent 70%);box-shadow:0 0 18px var(--glow2)}\n"
    f".brand::after{{content:\"\";position:absolute;left:13px;top:9px;width:16px;height:16px;background:var(--brass2);-webkit-mask:{svg_url(P['crown'])} center/contain no-repeat;mask:{svg_url(P['crown'])} center/contain no-repeat}}\n"
    ".brand b{font:600 .74rem/1.2 ui-sans-serif,system-ui,sans-serif;letter-spacing:.02em;text-transform:none}\n"
    ".cmdk input::-webkit-search-cancel-button{-webkit-appearance:none;appearance:none}\n"
    ".nav a{justify-content:flex-start;position:relative;transition:background .15s,color .15s}\n"
    ".nav a::before{content:\"\";flex:none;width:17px;height:17px;background:currentColor;opacity:.75;-webkit-mask:var(--ic," + svg_url(P["dot"]) + ") center/contain no-repeat;mask:var(--ic," + svg_url(P["dot"]) + ") center/contain no-repeat}\n"
    ".nav a>span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n"
    ".nav a.on{background:linear-gradient(90deg,var(--glow2),transparent);color:var(--brass2);box-shadow:inset 2px 0 0 var(--brass)}\n"
    ".nav a.on::before{opacity:1;background:var(--brass2)}\n"
    ".nav .grp{font-family:var(--caps);letter-spacing:.24em}\n"
    + icons +
    "header.top{background:color-mix(in srgb,var(--bg) 86%,transparent);box-shadow:0 1px 0 var(--line),0 10px 30px rgba(0,0,0,.25)}\n"
    "header.top h1{font:italic 500 1.55rem/1.1 var(--serif);letter-spacing:.01em;background:linear-gradient(180deg,#fff3c9,var(--brass2) 45%,var(--brass) 80%);-webkit-background-clip:text;background-clip:text;color:transparent}\n"
    "h2{font-family:var(--caps);letter-spacing:.26em;display:flex;align-items:center;gap:10px}\n"
    "h2::after{content:\"\";flex:1;height:1px;background:linear-gradient(90deg,var(--edge),transparent)}\n"
    ".panel,.kpi,.bento>.tile{background:linear-gradient(180deg,var(--panel2),var(--panel));border-color:var(--edge);box-shadow:inset 0 1px 0 color-mix(in srgb,var(--brass2) 10%,transparent),0 12px 32px rgba(0,0,0,.28)}\n"
    ".kpi{position:relative;overflow:hidden;transition:transform .18s,box-shadow .18s}\n"
    ".kpi::before{content:\"\";position:absolute;inset:0 0 auto 0;height:2px;background:linear-gradient(90deg,transparent,var(--brass),transparent);opacity:.55}\n"
    ".kpi:hover{transform:translateY(-2px);box-shadow:inset 0 1px 0 color-mix(in srgb,var(--brass2) 14%,transparent),0 16px 40px rgba(0,0,0,.35),0 0 24px var(--glow2)}\n"
    ".kpi .label{font-family:var(--caps);letter-spacing:.16em}\n"
    ".kpi .value{font-family:var(--serif);font-weight:600;font-size:2.15rem;background:linear-gradient(180deg,#fff6d8,var(--brass2) 55%,var(--brass));-webkit-background-clip:text;background-clip:text;color:transparent}\n"
    ".btn{transition:border-color .15s,box-shadow .15s,transform .15s}\n"
    ".btn:hover{box-shadow:0 0 0 3px var(--glow2)}\n"
    ".btn.primary{background:linear-gradient(145deg,var(--brass2),var(--brass) 60%,var(--brass2));box-shadow:0 6px 18px var(--glow2),inset 0 1px 0 rgba(255,255,255,.45)}\n"
    ".chip{border-color:var(--edge)}\n"
    ".live{color:#fff;background:linear-gradient(145deg,var(--bad),color-mix(in srgb,var(--bad) 70%,#000));border-color:transparent;box-shadow:0 0 16px color-mix(in srgb,var(--bad) 45%,transparent)}\n"
    ".live::before{background:#fff}\n"
    ".tile h3{font-family:var(--caps)}\n"
    ".onair img,.onair .ph{width:96px;height:96px;border-radius:14px;box-shadow:0 10px 26px rgba(0,0,0,.4),0 0 0 1px var(--edge)}\n"
    ".onair .title{font:italic 600 1.3rem/1.15 var(--serif)}\n"
    ".wcard{background:linear-gradient(180deg,var(--panel2),var(--panel));transition:border-color .15s,transform .15s}.wcard:hover{border-color:var(--brass);transform:translateY(-1px)}\n"
    ".spark{display:block;width:100%;height:28px;margin-top:6px}.spark polyline{fill:none;stroke:var(--brass2);stroke-width:1.5;vector-effect:non-scaling-stroke}.spark polygon{fill:var(--glow2);stroke:none}\n"
    ".wcard.errors .spark polyline{stroke:var(--bad)}\n"
    "table th{font-family:var(--caps);letter-spacing:.12em}\n"
    ".cmdk-btn kbd{font:600 .7rem/1 ui-monospace,monospace;border:1px solid var(--line2);border-radius:5px;padding:2px 5px;color:var(--muted);margin-left:6px}\n"
    ".cmdk{position:fixed;inset:0;z-index:60;display:none;align-items:flex-start;justify-content:center;padding:12vh 16px 16px;background:rgba(0,0,0,.55);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}\n"
    ".cmdk.open{display:flex}\n"
    ".cmdk .box{width:min(640px,100%);background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--edge);border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,.6),0 0 40px var(--glow2);overflow:hidden}\n"
    ".cmdk input{width:100%;border:0;border-bottom:1px solid var(--line);background:transparent;padding:16px 18px;font-size:1.05rem;color:var(--text);outline:none}\n"
    ".cmdk ul{list-style:none;margin:0;padding:6px;max-height:52vh;overflow:auto}\n"
    ".cmdk li a{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;color:var(--text)}\n"
    ".cmdk li a small{margin-left:auto;color:var(--muted);font-size:.74rem;letter-spacing:.08em;text-transform:uppercase}\n"
    ".cmdk li.on a,.cmdk li a:hover{background:var(--glow2);text-decoration:none;box-shadow:inset 2px 0 0 var(--brass)}\n"
    ".cmdk .hint{padding:8px 16px;border-top:1px solid var(--line);color:var(--muted);font-size:.74rem}\n"
    "@media (max-width:640px){.kpi .value{font-size:1.6rem}header.top h1{font-size:1.25rem}.cmdk-btn kbd{display:none}}\n"
)

# 1. let the brand fonts load (fonts.gstatic.com only)
edit("index.js", '    "img-src \'self\' https: data: blob:",\n    "media-src https: blob:",\n',
     '    "img-src \'self\' https: data: blob:",\n    "font-src https://fonts.gstatic.com",\n    "media-src https: blob:",\n')
# 2. the style layer, last so it sits on top of the existing rules
edit("ui.js", "@media (prefers-reduced-motion:reduce){*{transition:none!important}}\n`;\n",
     LUX + "@media (prefers-reduced-motion:reduce){*{transition:none!important}}\n`;\n")
# 3. the search button in the header
edit("ui.js", '      <button class="btn" id="refresh">Refresh</button>\n',
     '      <button class="btn cmdk-btn" id="cmdk-open" type="button" aria-label="Search everything (Ctrl K)">Search<kbd>⌘K</kbd></button>\n      <button class="btn" id="refresh">Refresh</button>\n')

CMDK = r"""
  // ---------- search everything (Ctrl/⌘ K or "/"): every nav item and table, from anywhere
  (function(){
    var wrap = document.createElement("div"); wrap.className = "cmdk"; wrap.setAttribute("role", "dialog"); wrap.setAttribute("aria-label", "Search everything");
    wrap.innerHTML = '<div class="box"><input type="search" id="cmdk-q" placeholder="Jump to a screen, table or tool…" autocomplete="off" aria-label="Search"><ul id="cmdk-list" role="listbox"></ul><div class="hint">↑ ↓ to move · Enter to open · Esc to close</div></div>';
    document.body.appendChild(wrap);
    var q = wrap.querySelector("#cmdk-q"), ul = wrap.querySelector("#cmdk-list"), items = [], pick = 0, shown = [];
    var collect = function(){
      var seen = {}; items = [];
      [].forEach.call(document.querySelectorAll("#nav a[href]"), function(a){ var h = a.getAttribute("href"); if (seen[h]) return; seen[h] = 1; items.push({ label: (a.textContent || "").replace(/\s+\d+$/, "").trim(), href: h, kind: "Screen" }); });
      Object.keys(T || {}).forEach(function(k){ var h = "#/t/" + k; if (seen[h]) return; seen[h] = 1; items.push({ label: T[k].label || k, href: h, kind: T[k].group || "Table" }); });
      items.push({ label: "Add an event", href: "#/t/rb_events/new", kind: "Action" }, { label: "Add a show", href: "#/t/shows/new", kind: "Action" });
    };
    var score = function(label, s){ var l = label.toLowerCase(); if (!s) return 1; if (l.indexOf(s) === 0) return 3; if (l.indexOf(s) > 0) return 2; var i = 0; for (var c = 0; c < l.length && i < s.length; c++) if (l[c] === s[i]) i++; return i === s.length ? 1 : 0; };
    var draw = function(){
      var s = q.value.trim().toLowerCase();
      shown = items.map(function(x){ return [score(x.label, s), x]; }).filter(function(r){ return r[0] > 0; }).sort(function(a, b){ return b[0] - a[0]; }).slice(0, 40).map(function(r){ return r[1]; });
      pick = Math.min(pick, Math.max(0, shown.length - 1));
      ul.innerHTML = shown.length ? shown.map(function(x, i){ return '<li role="option"' + (i === pick ? ' class="on" aria-selected="true"' : "") + '><a href="' + esc(x.href) + '">' + esc(x.label) + "<small>" + esc(x.kind) + "</small></a></li>"; }).join("") : '<li><p class="empty">Nothing matches.</p></li>';
      var on = ul.querySelector("li.on"); if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest" });
    };
    var open = function(){ collect(); q.value = ""; pick = 0; draw(); wrap.classList.add("open"); setTimeout(function(){ q.focus(); }, 0); };
    var close = function(){ wrap.classList.remove("open"); };
    var go2 = function(x){ close(); if (!x) return; if (x.href.charAt(0) === "#") go(x.href); else location.href = x.href; };
    q.addEventListener("input", function(){ pick = 0; draw(); });
    q.addEventListener("keydown", function(e){
      if (e.key === "ArrowDown") { e.preventDefault(); pick = Math.min(pick + 1, shown.length - 1); draw(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); pick = Math.max(pick - 1, 0); draw(); }
      else if (e.key === "Enter") { e.preventDefault(); go2(shown[pick]); }
      else if (e.key === "Escape") { e.preventDefault(); close(); }
    });
    ul.addEventListener("click", function(e){ var a = e.target.closest("a"); if (!a) return; e.preventDefault(); go2(shown.filter(function(x){ return x.href === a.getAttribute("href"); })[0]); });
    wrap.addEventListener("click", function(e){ if (e.target === wrap) close(); });
    document.addEventListener("keydown", function(e){
      var t = e.target, typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (wrap.classList.contains("open")) close(); else open(); }
      else if (e.key === "/" && !typing && !wrap.classList.contains("open")) { e.preventDefault(); open(); }
    });
    var b = $("cmdk-open"); if (b) b.onclick = open;
  })();
"""
edit("ui.js", "  // ---------- site colours (one theme for every RB site)\n", CMDK.lstrip("\n") + "\n  // ---------- site colours (one theme for every RB site)\n")
print("rb-command: lux layer patched")

# 5. Live signal: a 24-hour traffic line on each Worker card (signal.js now returns `hourly`, 24 slots, oldest first)
edit("ui.js", '(job ? "<br>" + job : "") + "</div></div>";',
     '(job ? "<br>" + job : "") + "</div>" + sparkline(x.hourly) + "</div>";')
SPARK = r"""
  /** A small line of 24 hourly values, drawn with SVG attributes only (the page's CSP has no inline styles). */
  function sparkline(v){
    if (!v || !v.length) return "";
    var max = Math.max.apply(null, v), n = v.length - 1;
    if (!max) return '<svg class="spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><polyline points="0,27 100,27"></polyline></svg>';
    var pts = v.map(function(y, i){ return (i / n * 100).toFixed(1) + "," + (27 - y / max * 24).toFixed(1); }).join(" ");
    return '<svg class="spark" viewBox="0 0 100 28" preserveAspectRatio="none" role="img" aria-label="Requests per hour, last 24 hours, peak ' + num(max) + '"><polygon points="0,28 ' + pts + ' 100,28"></polygon><polyline points="' + pts + '"></polyline></svg>';
  }
"""
edit("ui.js", "  // ---------- live signal: what is running right now (real data only)\n", SPARK.lstrip("\n") + "\n  // ---------- live signal: what is running right now (real data only)\n")
print("rb-command: sparklines patched")
