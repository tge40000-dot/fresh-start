"""Add the "Live signal" screen to a pulled rb-command Worker: one bento view of what is running right now.

Usage: python3 -I patch_signal.py <pulled rb-command dir>

Copies src/signal.js in. Then it:
- adds GET /api/signal (anyone who can see Analytics, so every role except the limited store staff);
- adds "Live signal" to the nav, right under Overview;
- adds the screen and its styles to ui.js.

Nothing existing is removed or changed: Overview, Analytics and every other screen stay as they are.
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


shutil.copyfile(HERE / "src" / "signal.js", folder / "signal.js")
print("signal.js: copied")

edit("index.js", 'import * as analytics from "./analytics.js";\n',
     'import * as analytics from "./analytics.js";\nimport * as signal from "./signal.js";\n')
edit("index.js", '    if (path === "/api/analytics") return json(await analytics.report(env, ctx, url.searchParams));\n',
     '    if (path === "/api/analytics") return json(await analytics.report(env, ctx, url.searchParams));\n'
     '    if (path === "/api/signal") { if (limited) throw new HttpError(403, "Not available for this role."); return json(await signal.signal(env, ctx)); }\n')

edit("ui.js", '  if (!CAPS.limited) NAV_TOP.push(["analytics", "Analytics"]);\n',
     '  if (!CAPS.limited) NAV_TOP.push(["signal", "Live signal"]);\n  if (!CAPS.limited) NAV_TOP.push(["analytics", "Analytics"]);\n')
edit("ui.js", '      else if (r.name === "analytics") viewAnalytics(r.params);\n',
     '      else if (r.name === "signal") viewSignal();\n      else if (r.name === "analytics") viewAnalytics(r.params);\n')

CSS = (
    ".bento{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:12px}\n"
    ".bento>.tile{grid-column:span 4;min-width:0;background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--line);border-radius:16px;padding:16px;position:relative;overflow:hidden}\n"
    ".bento>.tile.w8{grid-column:span 8}.bento>.tile.w12{grid-column:span 12}.bento>.tile.w6{grid-column:span 6}\n"
    ".tile h3{margin:0 0 10px;font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:var(--brass2);display:flex;align-items:center;gap:8px}\n"
    ".tile h3 .grow{flex:1}.tile h3 a{font-size:.72rem;letter-spacing:.06em;color:var(--muted)}\n"
    ".tile .big{font-size:1.6rem;font-weight:600;line-height:1.15}.tile .muted{font-size:.82rem}\n"
    ".onair{display:flex;gap:12px;align-items:center}.onair img,.onair .ph{width:72px;height:72px;border-radius:10px;object-fit:cover;flex:none;background:var(--panel2);border:1px solid var(--line)}\n"
    ".live{display:inline-flex;align-items:center;gap:6px;font-size:.7rem;letter-spacing:.1em;color:var(--bad);border:1px solid var(--bad);border-radius:999px;padding:1px 8px}\n"
    ".live::before{content:\"\";width:6px;height:6px;border-radius:50%;background:var(--bad);animation:sigpulse 1.6s ease-in-out infinite}\n"
    "@keyframes sigpulse{0%,100%{opacity:1}50%{opacity:.3}}@media (prefers-reduced-motion:reduce){.live::before{animation:none}}\n"
    ".prog{height:4px;border-radius:4px;background:var(--line);margin-top:10px;overflow:hidden}.prog i{display:block;height:100%;background:var(--brass)}\n"
    ".wsum{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}\n"
    ".wgrp{font-size:.7rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin:14px 0 6px}\n"
    ".wgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px}\n"
    ".wcard{border:1px solid var(--line);border-radius:12px;padding:10px 12px;background:var(--panel);min-width:0}\n"
    ".wcard .t{display:flex;align-items:center;gap:8px;font-weight:600;font-size:.88rem}.wcard .t span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n"
    ".wcard .n{font-size:.72rem;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n"
    ".wcard .m{font-size:.76rem;color:var(--muted);margin-top:6px}.wcard.errors{border-color:var(--bad)}.wcard.job_failed{border-color:var(--warn)}\n"
    ".tag{display:inline-block;font-size:.64rem;letter-spacing:.06em;border:1px solid var(--line2);border-radius:999px;padding:0 6px;color:var(--brass2);margin-left:auto;flex:none}\n"
    ".skel{display:block;height:12px;border-radius:6px;margin:8px 0;background:linear-gradient(90deg,var(--line) 0%,var(--line2) 40%,var(--line) 80%);background-size:200% 100%;animation:skel 1.4s ease-in-out infinite}\n"
    ".skel.w60{width:60%}.skel.w40{width:40%}.skel.tall{height:40px}\n"
    "@keyframes skel{0%{background-position:100% 0}100%{background-position:-100% 0}}@media (prefers-reduced-motion:reduce){.skel{animation:none}}\n"
    "@media (max-width:980px){.bento>.tile,.bento>.tile.w8,.bento>.tile.w6{grid-column:span 12}}\n"
)
edit("ui.js", ".kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}\n",
     ".kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}\n" + CSS)

VIEW = r"""
  // ---------- live signal: what is running right now (real data only)
  function viewSignal(){
    setTitle("Live signal");
    var here = stillHere();
    var sk = '<span class="skel w60"></span><span class="skel"></span><span class="skel w40"></span>';
    view.innerHTML = '<p class="note">Everything here is live: Cloudflare analytics for the last 24 hours, the radio, and your own data. Nothing is estimated or made up. It refreshes every two minutes while open.</p>' +
      '<div class="bento">' +
      '<div class="tile" id="sg-radio"><h3><span class="grow">RB Radio</span><a href="#/radio">Open</a></h3>' + sk + '</div>' +
      '<div class="tile" id="sg-pulse"><h3><span class="grow">Pulse</span><a href="#/">Overview</a></h3>' + sk + '</div>' +
      '<div class="tile" id="sg-cal"><h3><span class="grow">Coming up</span><a href="#/shows">Show planner</a></h3>' + sk + '</div>' +
      '<div class="tile w12" id="sg-work"><h3><span class="grow">Workers · last 24 hours</span><a href="#/health">Site health</a></h3>' + sk + sk + '</div>' +
      '<div class="tile w6" id="sg-beats"><h3><span class="grow">Record on a beat</span><a href="https://studio.relentlessbillionaire.com" target="_blank" rel="noopener">Studio</a></h3>' + sk + '</div>' +
      '<div class="tile w6" id="sg-funnel"><h3><span class="grow">Studio and store · 7 days</span><a href="#/analytics">Analytics</a></h3>' + sk + '</div>' +
      "</div>";
    var box = function(id){ var el = $(id); if (!el) return null; var h = el.querySelector("h3").outerHTML; return function(html){ el.innerHTML = h + html; }; };
    var ago = function(iso){ var m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? "just now" : m < 60 ? m + " min ago" : Math.round(m / 60) + " h ago"; };

    var paintSide = function(d){
      if (!here()) return;
      var k = d.kpis, f = k.funnel, put;
      if ((put = box("sg-pulse"))) {
        var rows = [];
        rows.push(["Signups this week", num(k.signups.d7), trend(k.signups.d7, k.signups.p7)]);
        if (k.orders) rows.push(["Store orders", num(k.orders.total), money(k.orders.revenue30) + " paid in 30 days"]);
        if (k.members) rows.push(["Studio members", num(k.members.active), num(k.members.total) + " on record"]);
        if (k.tv) rows.push(["RB TV views", num(k.tv.views), num(k.tv.videos) + " videos"]);
        put('<ul class="list">' + rows.map(function(r){ return '<li><div class="grow"><div class="title">' + esc(r[0]) + '</div><div class="muted">' + r[2] + '</div></div><div class="big">' + esc(r[1]) + "</div></li>"; }).join("") + "</ul>");
      }
      if ((put = box("sg-cal"))) {
        var cal = (d.calendar || []).slice(0, 4);
        put(cal.length ? '<ul class="list">' + cal.map(function(e){
          return '<li><div class="grow"><a class="title" href="' + (e.kind === "plan" ? "#/shows?id=" + e.id : "#/t/" + (e.kind === "show" ? "shows" : "rb_events") + "/" + e.id) + '">' + esc(e.title) + '</a><div class="muted">' + when(e.starts_at) + "</div></div></li>";
        }).join("") + "</ul>" : '<p class="empty">No upcoming events or shows.</p>');
      }
      if ((put = box("sg-funnel"))) {
        if (!f) put('<p class="empty">Counting starts once rb-public-content is live.</p>');
        else {
          var w = f.week, views = w.pricing_view || 0, done = w.checkout_done || 0;
          put('<div class="kpis">' +
            '<div class="kpi"><div class="label">Pricing views</div><div class="value">' + num(views) + "</div></div>" +
            '<div class="kpi"><div class="label">Studio checkouts</div><div class="value">' + num(done) + '</div><div class="sub">' + (views ? (done / views * 100).toFixed(1) + "% of views" : "no views yet") + "</div></div>" +
            '<div class="kpi"><div class="label">Masters made</div><div class="value">' + num(w.master_done || 0) + '</div><div class="sub">' + num((w.download_wav || 0) + (w.download_mp3 || 0)) + " downloads</div></div>" +
            '<div class="kpi"><div class="label">Beatstore → studio</div><div class="value">' + num(w.studio_click || 0) + '</div><div class="sub">' + num(w.beatstore_click || 0) + " the other way</div></div></div>");
        }
      }
    };
    var sideFail = function(e){ ["sg-pulse", "sg-cal", "sg-funnel"].forEach(function(id){ var put = here() && box(id); if (put) put('<p class="empty">' + esc(e.message || "Couldn't load the overview.") + "</p>"); }); };
    if (S.ov) paintSide(S.ov); else loadOverview().then(paintSide).catch(sideFail);

    api("loop").then(function(r){
      var put = here() && box("sg-beats"); if (!put) return;
      var beats = (r.beats || []).slice(0, 5);
      put(beats.length ? '<ul class="list">' + beats.map(function(b){
        var href = "https://studio.relentlessbillionaire.com/?beat=" + encodeURIComponent(b.id);
        return '<li><div class="grow"><a class="title" href="' + esc(href) + '" target="_blank" rel="noopener">' + esc(b.title) + '</a><div class="muted">' + esc([b.bpm ? b.bpm + " BPM" : "", b.song_key || "", b.price != null ? "$" + b.price : ""].filter(Boolean).join(" · ")) + "</div></div></li>";
      }).join("") + "</ul>" : '<p class="empty">No live beats.</p>');
    }).catch(function(e){ var put = here() && box("sg-beats"); if (put) put('<p class="empty">' + esc(e.message) + "</p>"); });

    var STATUS = { running: ["ok", "Running"], quiet: ["", "Quiet"], errors: ["bad", "Errors"], job_failed: ["warn", "A scheduled job failed"] };
    var paintSignal = function(s){
      if (!here()) return;
      var put = box("sg-radio");
      if (put) {
        var r = s.radio;
        if (!r) put('<p class="empty">' + esc(s.errors.filter(function(e){ return /Radio/.test(e); })[0] || "Nothing on air.") + "</p>");
        else {
          var pct = r.duration_ms ? Math.max(0, Math.min(100, (Date.now() - r.starts_at) / r.duration_ms * 100)) : 0;
          put('<div class="onair">' + (r.cover ? '<img src="' + esc(r.cover) + '" alt="">' : '<div class="ph"></div>') +
            '<div class="grow">' + (r.live ? '<span class="live">LIVE · ' + esc(r.live.title) + "</span>" : '<span class="live">ON AIR</span>') +
            '<div class="title">' + esc(r.title) + '</div><div class="muted">' + esc(r.artist || "") + "</div></div></div>" +
            '<div class="prog"><i data-w="' + pct.toFixed(1) + '"></i></div>' +
            (r.next.length ? '<p class="muted">Next: ' + r.next.map(function(n){ return esc(n.title) + (n.artist ? " · " + esc(n.artist) : ""); }).join(" / ") + "</p>" : "") +
            '<p class="muted">Song requests are ' + (r.requests_open ? "open" : "closed") + ".</p>");
          var bar = $("sg-radio").querySelector(".prog i"); if (bar) bar.style.width = bar.getAttribute("data-w") + "%";
        }
      }
      put = box("sg-work"); if (!put) return;
      if (!s.connected) { put('<p class="empty"><a href="#/analytics">Connect Cloudflare analytics</a> to see every Worker here.</p>'); return; }
      var w = s.workforce;
      if (!w) { put('<p class="empty">' + esc(s.errors[0] || "Couldn't load Workers.") + "</p>"); return; }
      var t = w.totals;
      var html = '<div class="wsum"><span class="chip"><span class="dot ok"></span>' + num(t.running) + " running</span>" +
        (t.errors ? '<span class="chip"><span class="dot bad"></span>' + num(t.errors) + " with errors</span>" : "") +
        (t.job_failed ? '<span class="chip"><span class="dot warn"></span>' + num(t.job_failed) + " with a failed job</span>" : "") +
        '<span class="chip">' + num(t.requests) + " requests</span>" +
        '<span class="chip">' + num(t.jobs) + " scheduled jobs · " + num(t.job_runs) + " runs" + (t.job_fails ? " · " + num(t.job_fails) + " failed" : " · none failed") + "</span>" +
        '<span class="chip">Updated ' + esc(ago(w.generated_at)) + "</span></div>" +
        '<p class="muted">Each card is a Cloudflare Worker: the code that runs one part of RB. <span class="tag">Workers AI</span> marks the ones that use Cloudflare\'s AI models. Workers that had no traffic and no scheduled run today don\'t appear.</p>';
      var groups = [];
      w.workers.forEach(function(x){ if (groups.indexOf(x.group) < 0) groups.push(x.group); });
      groups.forEach(function(g){
        html += '<div class="wgrp">' + esc(g) + '</div><div class="wgrid">' + w.workers.filter(function(x){ return x.group === g; }).map(function(x){
          var st = STATUS[x.status] || STATUS.quiet;
          var job = x.jobs.length ? x.jobs.map(function(j){ return "Job " + esc(j.cron) + ": last ran " + esc(ago(j.last)) + (j.failed ? ", " + num(j.failed) + " of " + num(j.runs) + " failed" : ""); }).join("<br>") : "";
          return '<div class="wcard ' + esc(x.status) + '"><div class="t"><span class="dot ' + st[0] + '" title="' + esc(st[1]) + '"></span><span>' + esc(x.label) + "</span>" + (x.ai ? '<span class="tag">Workers AI</span>' : "") + "</div>" +
            '<div class="n">' + esc(x.name) + '</div><div class="m">' + esc(st[1]) + " · " + num(x.requests) + " requests" + (x.errors ? " · " + num(x.errors) + " errors (" + x.error_rate + "%)" : "") + (x.cpu_ms != null ? " · " + x.cpu_ms + " ms CPU" : "") + (job ? "<br>" + job : "") + "</div></div>";
        }).join("") + "</div>";
      });
      put(html);
    };
    var load = function(){ api("signal").then(paintSignal).catch(function(e){ var put = here() && box("sg-work"); if (put) put('<p class="empty">' + esc(e.message) + "</p>"); }); };
    load();
    var timer = setInterval(function(){ if (!here()) return clearInterval(timer); load(); }, 120000);
  }
"""
edit("ui.js", "  // ---------- site colours (one theme for every RB site)\n", VIEW.lstrip("\n") + "\n  // ---------- site colours (one theme for every RB site)\n")
print("rb-command patched")
