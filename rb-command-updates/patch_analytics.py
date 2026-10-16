"""Add the Analytics screen (Cloudflare Web Analytics and Workers analytics) to a pulled rb-command Worker.

Usage: python3 -I patch_analytics.py <pulled rb-command dir>

Copies src/analytics.js in as a new module. Then it:
- adds the GET /api/analytics route, open to the same team members as the Overview's visitor numbers;
- adds the screen, its nav entry and its styles to ui.js;
- points the Overview's Visitors tile at the screen.

Each anchor must match exactly once. An edit that's already in place is skipped, so running it twice changes nothing.
"""
import pathlib
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
folder = pathlib.Path(sys.argv[1])


def edit(name, old, new):
    p = folder / name
    s = p.read_text(encoding="utf-8")
    if new in s:
        return
    if s.count(old) != 1:
        raise SystemExit(f"{name}: anchor found {s.count(old)} times: {old[:70]!r}")
    p.write_text(s.replace(old, new), encoding="utf-8")
    print(f"{name}: edited")


shutil.copyfile(HERE / "src" / "analytics.js", folder / "analytics.js")
print("analytics.js: copied")

# ---- index.js: module and route
edit("index.js", 'import * as sitetheme from "./sitetheme.js";\n',
     'import * as sitetheme from "./sitetheme.js";\nimport * as analytics from "./analytics.js";\n')
edit("index.js", '    if (path === "/api/traffic") return json(await traffic(env, ctx));\n',
     '    if (path === "/api/traffic") return json(await traffic(env, ctx));\n'
     '    if (path === "/api/analytics") return json(await analytics.report(env, ctx, url.searchParams));\n')

# ---- ui.js: styles, nav, route, Overview tile, screen
CSS = r""".achart{display:block;width:100%;height:auto;overflow:visible}
.achart .agrid{stroke:var(--line);stroke-width:1}
.achart text{fill:var(--muted);font-size:11px}
.abar path{fill:var(--brass)}.abar:hover path,.abar:focus path{fill:var(--brass2)}.abar .ahit{fill:transparent}
.abar:focus{outline:none}
.ameter{display:block;width:100%;height:6px;margin-top:5px}.ameter .atrack{fill:var(--panel2)}.ameter .afill{fill:var(--brass)}
.atip{min-height:1.3em;margin-top:6px}
"""
edit("ui.js", ".tgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}\n",
     ".tgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}\n" + CSS)

edit("ui.js", '  if (CAPS.groups.Events || CAPS.groups.Inbox) NAV_TOP.push(["inbox", "Inbox", "inbox"]);\n',
     '  if (!CAPS.limited) NAV_TOP.push(["analytics", "Analytics"]);\n'
     '  if (CAPS.groups.Events || CAPS.groups.Inbox) NAV_TOP.push(["inbox", "Inbox", "inbox"]);\n')
edit("ui.js", '      else if (r.name === "inbox") viewInbox();\n',
     '      else if (r.name === "inbox") viewInbox();\n      else if (r.name === "analytics") viewAnalytics(r.params);\n')
edit("ui.js",
     '    if (!r.connected) return paintTile("kpi-traffic", "—", "Add a read-only Cloudflare analytics token (CF_ANALYTICS_TOKEN) to see visitors");\n',
     '    if (!r.connected) return paintTile("kpi-traffic", "—", \'<a href="#/analytics">Connect Cloudflare analytics</a> to see visitors\');\n')
edit("ui.js",
     '''    box.innerHTML = '<div class="grid2"><div><h3>Top pages · 7 days</h3>''',
     '''    box.innerHTML = '<div class="row-actions"><a class="btn" href="#/analytics">Open analytics</a></div><div class="grid2"><div><h3>Top pages · 7 days</h3>''')

VIEW = r"""
  // ---------- analytics (Cloudflare Web Analytics and Workers analytics)
  var REGION = (function(){ try { return new Intl.DisplayNames(["en"], { type: "region" }); } catch (e) { return null; } })();
  function country(c){ try { return (REGION && c && c.length === 2 && REGION.of(c)) || c || "Unknown"; } catch (e) { return c || "Unknown"; } }
  function secs(v){ return v == null ? "—" : v >= 1000 ? (v / 1000).toFixed(1) + " s" : num(v) + " ms"; }
  // Core Web Vitals bands (web.dev): good, needs work, poor. The word goes with the colour.
  function band(v, good, poor){ return v == null ? "" : v <= good ? '<span class="tag good">Good</span>' : v <= poor ? '<span class="tag warn">Needs work</span>' : '<span class="tag bad">Poor</span>'; }
  function vLcp(v){ return v == null ? '<span class="muted">—</span>' : esc(secs(v)) + " " + band(v, 2500, 4000); }
  function vInp(v){ return v == null ? '<span class="muted">—</span>' : esc(secs(v)) + " " + band(v, 200, 500); }
  function vCls(v){ return v == null ? '<span class="muted">—</span>' : esc(v.toFixed(2)) + " " + band(v, 0.1, 0.25); }
  function pct(a, b){ return b ? Math.round(a / b * 100) : 0; }
  function meter(p){ return '<svg class="ameter" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><rect class="atrack" width="100" height="6" rx="3"></rect><rect class="afill" width="' + Math.max(p, p ? 2 : 0) + '" height="6" rx="3"></rect></svg>'; }
  function shareList(rows, label){
    var total = rows.reduce(function(t, x){ return t + x.views; }, 0);
    if (!rows.length) return '<p class="empty">No data yet.</p>';
    return '<ul class="list">' + rows.map(function(x){ var p = pct(x.views, total); return '<li><div class="grow"><div class="row-actions between"><span>' + esc(label(x)) + '</span><span class="muted">' + num(x.views) + " · " + p + "%</span></div>" + meter(p) + "</div></li>"; }).join("") + "</ul>";
  }
  function tickLabel(t, hourly){ var d = new Date(hourly ? t : t + "T12:00:00Z"); return hourly ? d.toLocaleTimeString("en-US", { hour: "numeric" }) : d.toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric" }); }
  function niceMax(v){ if (v <= 5) return 5; var p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }
  // Visits as thin bars, rounded at the data end only; hover or focus a bar for its numbers.
  function drawChart(box, series, hourly){
    if (!series.length) { box.innerHTML = '<p class="empty">No visits in this period.</p>'; return; }
    var W = Math.max(box.clientWidth || 640, 280), H = 190, L = 34, B = 22, T = 8, iw = W - L, ih = H - B - T;
    var max = niceMax(Math.max.apply(null, series.map(function(s){ return s.visits; }).concat([1])));
    var slot = iw / series.length, bw = Math.max(Math.min(slot - 2, 28), 2), every = Math.ceil(series.length / Math.max(Math.floor(iw / 64), 1));
    var y = function(v){ return T + ih - v / max * ih; };
    var out = [0, max / 2, max].map(function(g){ return '<line class="agrid" x1="' + L + '" x2="' + W + '" y1="' + y(g) + '" y2="' + y(g) + '"></line><text x="' + (L - 6) + '" y="' + (y(g) + 4) + '" text-anchor="end">' + num(g) + "</text>"; }).join("");
    series.forEach(function(s, i){
      var x = L + i * slot + (slot - bw) / 2, top = y(s.visits), h = T + ih - top, r = Math.min(4, bw / 2, h);
      var path = h <= 0 ? "" : "M" + x + "," + (T + ih) + "V" + (top + r) + "Q" + x + "," + top + " " + (x + r) + "," + top + "H" + (x + bw - r) + "Q" + (x + bw) + "," + top + " " + (x + bw) + "," + (top + r) + "V" + (T + ih) + "Z";
      var tip = tickLabel(s.t, hourly) + ": " + num(s.visits) + " visits, " + num(s.views) + " page views";
      out += '<g class="abar" tabindex="0" data-tip="' + esc(tip) + '"><rect class="ahit" x="' + (L + i * slot) + '" y="' + T + '" width="' + slot + '" height="' + ih + '"></rect><path d="' + path + '"></path><title>' + esc(tip) + "</title></g>";
      if (i % every === 0) out += '<text x="' + (x + bw / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(tickLabel(s.t, hourly)) + "</text>";
    });
    box.innerHTML = '<svg class="achart" viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="Visits ' + (hourly ? "by hour" : "by day") + '">' + out + '</svg><div class="muted atip" id="an-tip" aria-live="polite">Hover or tab to a bar for its numbers.</div>';
    var tipEl = box.querySelector("#an-tip");
    box.querySelectorAll(".abar").forEach(function(g){ var show = function(){ tipEl.textContent = g.dataset.tip; }; g.addEventListener("mouseenter", show); g.addEventListener("focus", show); });
  }

  function viewAnalytics(params){
    setTitle("Analytics");
    var here = stillHere();
    var st = { range: { "1d": 1, "7d": 1, "30d": 1 }[params.get("range")] ? params.get("range") : "7d", host: params.get("host") || "", bots: params.get("bots") === "1" };
    var href = function(ch){ var o = { range: st.range, host: st.host, bots: st.bots ? "1" : "" }; Object.keys(ch).forEach(function(k){ o[k] = ch[k]; }); var u = new URLSearchParams(); Object.keys(o).forEach(function(k){ if (o[k]) u.set(k, o[k]); }); return "#/analytics?" + u.toString(); };
    var chips = [["1d", "24 hours"], ["7d", "7 days"], ["30d", "30 days"]].map(function(r){ return '<a class="fchip" href="' + href({ range: r[0] }) + '" aria-pressed="' + (st.range === r[0]) + '">' + r[1] + "</a>"; }).join("");
    view.innerHTML = '<div class="toolbar"><div class="chips">' + chips + '</div><select id="an-host" aria-label="Site"><option value="">All sites</option>' + (st.host ? '<option value="' + esc(st.host) + '" selected>' + esc(st.host) + "</option>" : "") + '</select><label class="muted"><input type="checkbox" id="an-bots"' + (st.bots ? " checked" : "") + '> Include automated browsers</label></div><div id="an-out"><p class="empty">Loading Cloudflare analytics…</p></div>';
    $("an-host").onchange = function(){ go(href({ host: this.value })); };
    $("an-bots").onchange = function(){ go(href({ bots: this.checked ? "1" : "" })); };
    api("analytics?range=" + st.range + (st.host ? "&host=" + encodeURIComponent(st.host) : "") + (st.bots ? "&bots=1" : "")).then(function(r){
      if (!here()) return;
      var out = $("an-out");
      if (!r.connected) {
        out.innerHTML = '<section><h2>Connect Cloudflare analytics</h2><div class="panel"><p class="note">Cloudflare already counts visitors on the RB sites (Web Analytics) and traffic on every Worker. RB Command needs a read-only token to show those numbers here and on the Overview. It can only read analytics: it can\'t change anything.</p><ol class="note">' +
          "<li>In Cloudflare, open <b>My Profile → API Tokens → Create Token → Create Custom Token</b>.</li>" +
          "<li>Name it <b>RB Command analytics</b>. Under Permissions choose <b>Account → Account Analytics → Read</b>, and nothing else. Under Account Resources pick the RB account.</li>" +
          "<li>Create it and copy the token.</li>" +
          "<li>Open <b>Workers &amp; Pages → rb-command → Settings → Variables and Secrets → Add</b>. Type <b>Secret</b>, name <b>CF_ANALYTICS_TOKEN</b>, paste the token and deploy.</li>" +
          "<li>Come back here and press Refresh.</li></ol></div></section>";
        return;
      }
      if (r.error) { out.innerHTML = '<p class="empty">' + esc(r.error) + "</p>"; return; }
      // Sites for the picker, keeping the one chosen.
      var sel = $("an-host");
      r.hosts.forEach(function(h){ if (h.host !== st.host) sel.insertAdjacentHTML("beforeend", '<option value="' + esc(h.host) + '">' + esc(h.host) + "</option>"); });
      var t = r.totals, dev = r.devices.reduce(function(a, x){ a[x.name] = x.views; a.all += x.views; return a; }, { all: 0 });
      var errRate = r.workers.requests ? r.workers.errors / r.workers.requests * 100 : 0;
      var tr = function(a, b){ return trend(a, b).replace("last week", "the period before").replace("this week", "in this period"); };
      var span = { "1d": "24 hours", "7d": "7 days", "30d": "30 days" }[r.range];
      var tiles = [
        ["Visits · " + span, num(t.visits), tr(t.visits, t.prev_visits)],
        ["Page views", num(t.views), tr(t.views, t.prev_views)],
        ["Pages per visit", t.visits ? (t.views / t.visits).toFixed(1) : "—", "page views ÷ visits"],
        ["On phones", pct(dev.mobile || 0, dev.all) + "%", num(dev.desktop || 0) + " desktop · " + num(dev.tablet || 0) + " tablet views"],
        ["Largest paint · p75", secs(r.vitals.lcp), r.vitals.lcp == null ? "no samples yet" : band(r.vitals.lcp, 2500, 4000) + " · " + num(r.vitals.samples) + " samples"],
        ["Worker errors", num(r.workers.errors), num(r.workers.requests) + " requests · " + (errRate < 0.01 && r.workers.errors ? "<0.01" : errRate.toFixed(2)) + "%"],
      ];
      // Plain notes from the numbers, nothing guessed.
      var notes = [];
      if (t.prev_visits) { var c = Math.round((t.visits - t.prev_visits) / t.prev_visits * 100); notes.push("Visits are " + (c === 0 ? "level with" : (c > 0 ? "up " : "down ") + Math.abs(c) + "% on") + " the " + span + " before."); }
      if (r.pages[0]) notes.push("Most viewed page: " + (r.pages[0].host === "relentlessbillionaire.com" ? "" : r.pages[0].host) + r.pages[0].path + " (" + num(r.pages[0].views) + " views).");
      if (r.referrers[0]) notes.push("Biggest outside source: " + r.referrers[0].host + " (" + num(r.referrers[0].views) + " views).");
      var poor = r.hosts.filter(function(h){ return h.vitals && h.vitals.samples >= 5 && ((h.vitals.lcp || 0) > 4000 || (h.vitals.cls || 0) > 0.25 || (h.vitals.inp || 0) > 500); });
      poor.slice(0, 3).forEach(function(h){ var v = h.vitals, why = []; if ((v.lcp || 0) > 4000) why.push("slow to show its main content (" + secs(v.lcp) + ")"); if ((v.cls || 0) > 0.25) why.push("the layout jumps while loading (CLS " + v.cls.toFixed(2) + ")"); if ((v.inp || 0) > 500) why.push("slow to respond to taps (" + secs(v.inp) + ")"); notes.push(h.host + ": " + why.join(", ") + "."); });
      var bad = r.workers.scripts.filter(function(s){ return s.errors; }).sort(function(a, b){ return b.errors - a.errors; })[0];
      if (bad) notes.push("Most Worker errors: " + bad.name + " (" + num(bad.errors) + " of " + num(bad.requests) + " requests).");
      var sites = '<div class="scroll"><table class="rows"><thead><tr><th>Site</th><th>Visits</th><th>Views</th><th>Largest paint</th><th>Response to taps</th><th>Layout shift</th><th>Load · median</th></tr></thead><tbody>' + r.hosts.map(function(h){
        var v = h.vitals || {};
        return '<tr><td><a href="' + href({ host: h.host }) + '">' + esc(h.host) + "</a></td><td>" + num(h.visits) + "</td><td>" + num(h.views) + "</td><td>" + vLcp(v.lcp) + "</td><td>" + vInp(v.inp) + "</td><td>" + vCls(v.cls) + "</td><td>" + esc(h.load ? secs(h.load.p50) : "—") + "</td></tr>";
      }).join("") + "</tbody></table></div>";
      var pages = r.pages.length ? '<ul class="list">' + r.pages.map(function(p){ var url = "https://" + p.host + p.path; return '<li><div class="grow"><a href="' + esc(safeUrl(url)) + '" target="_blank" rel="noopener">' + esc((st.host || p.host === "relentlessbillionaire.com" ? "" : p.host) + p.path) + '</a></div><div class="muted">' + num(p.views) + "</div></li>"; }).join("") + "</ul>" : '<p class="empty">No page views in this period.</p>';
      var refs = (r.referrers.length ? shareList(r.referrers, function(x){ return x.host; }) : '<p class="empty">No outside sources yet: visits are direct or from RB\'s own pages.</p>') + (r.internal_views ? '<p class="muted">Plus ' + num(r.internal_views) + " views from one RB page to another.</p>" : "");
      var workers = r.workers.scripts.map(function(s){ var er = s.requests ? s.errors / s.requests * 100 : 0; return "<tr><td>" + esc(s.name) + "</td><td>" + num(s.requests) + "</td><td>" + (s.errors ? '<span class="' + (er >= 1 ? "down" : "") + '">' + num(s.errors) + "</span>" : '<span class="muted">0</span>') + "</td><td>" + (s.errors ? (er < 0.01 ? "<0.01" : er.toFixed(2)) + "%" : "—") + "</td><td>" + (s.cpu_p50 == null ? "—" : s.cpu_p50 + " / " + s.cpu_p99 + " ms") + "</td></tr>"; });
      var wtable = function(rows){ return '<div class="scroll"><table class="rows"><thead><tr><th>Worker</th><th>Requests</th><th>Errors</th><th>Error rate</th><th>CPU · median / p99</th></tr></thead><tbody>' + rows.join("") + "</tbody></table></div>"; };
      var dayRows = r.series.map(function(s){ return "<tr><td>" + esc(tickLabel(s.t, r.hourly)) + "</td><td>" + num(s.visits) + "</td><td>" + num(s.views) + "</td></tr>"; }).join("");
      out.innerHTML = '<div class="kpis">' + tiles.map(function(x){ return '<div class="kpi"><div class="label">' + esc(x[0]) + '</div><div class="value">' + esc(x[1]) + '</div><div class="sub">' + x[2] + "</div></div>"; }).join("") + "</div>" +
        '<section><h2>Visits ' + (r.hourly ? "by hour" : "by day") + (st.host ? " · " + esc(st.host) : "") + '</h2><div class="panel"><div id="an-chart"></div><details class="gap-top"><summary class="muted">Show as a table</summary><div class="scroll"><table class="rows"><thead><tr><th>' + (r.hourly ? "Hour" : "Day") + "</th><th>Visits</th><th>Page views</th></tr></thead><tbody>" + dayRows + "</tbody></table></div></details></div></section>" +
        (notes.length ? '<section><h2>Worth knowing</h2><div class="panel"><ul class="list">' + notes.map(function(x){ return '<li><div class="grow">' + esc(x) + "</div></li>"; }).join("") + "</ul></div></section>" : "") +
        '<section><h2>Sites</h2><div class="panel">' + (r.hosts.length ? sites : '<p class="empty">No visits in this period.</p>') + '<p class="muted">Speed is what real visitors saw (75th percentile, Core Web Vitals). Good: largest paint under 2.5 s, response to taps under 200 ms, layout shift under 0.1. Pick a site to see only its numbers.</p></div></section>' +
        '<div class="grid2"><section><h2>Top pages</h2><div class="panel">' + pages + "</div></section>" +
        '<section><h2>Where visitors come from</h2><div class="panel">' + refs + "</div></section></div>" +
        '<div class="grid2"><section><h2>Countries</h2><div class="panel">' + shareList(r.countries, function(x){ return country(x.code); }) + "</div></section>" +
        '<section><h2>Devices and browsers</h2><div class="panel">' + shareList(r.devices, function(x){ return cap(x.name); }) + '<h3 class="sub-h">Browsers</h3>' + shareList(r.browsers, function(x){ return x.name; }) + '<h3 class="sub-h">Systems</h3>' + shareList(r.os, function(x){ return x.name; }) + "</div></section></div>" +
        '<section><h2>Workers</h2><div class="panel">' + (workers.length ? wtable(workers.slice(0, 12)) + (workers.length > 12 ? '<details class="gap-top"><summary class="muted">All ' + workers.length + " Workers</summary>" + wtable(workers.slice(12)) + "</details>" : "") : '<p class="empty">No Worker traffic in this period.</p>') + '<p class="muted">Every site and API on the account. An error is a request the Worker didn\'t finish (an exception or a limit), not a 404.</p></div></section>' +
        '<p class="note gap-top">From Cloudflare Web Analytics and Workers analytics, refreshed every 10 minutes. Cloudflare samples busy periods, so counts are close estimates. RB Command\'s own pages' + (st.bots ? " are" : " and automated (headless) browsers are") + " left out.</p>";
      drawChart($("an-chart"), r.series, r.hourly);
    }).catch(function(e){ if (here()) $("an-out").innerHTML = '<p class="empty">' + esc(e.message) + "</p>"; });
  }
"""
edit("ui.js", "  // ---------- site colours (one theme for every RB site)\n", VIEW.lstrip("\n") + "\n  // ---------- site colours (one theme for every RB site)\n")
print("rb-command patched")
