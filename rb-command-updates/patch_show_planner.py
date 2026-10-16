"""Add the Show planner to a pulled rb-command Worker.

Usage: python3 -I patch_show_planner.py <pulled rb-command dir>

Copies src/showplanner.js in as a new module. Then it:
- wires the /api/shows/* routes into index.js (viewing needs Events view; changes need Events edit);
- adds planned shows and what's due to the Overview;
- adds the screen (plans, month calendar and the plan itself), its nav entry and its styles to ui.js.

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


shutil.copyfile(HERE / "src" / "showplanner.js", folder / "showplanner.js")
print("showplanner.js: copied")

# ---- index.js: module, routes, overview
edit("index.js", 'import * as affiliate from "./affiliate.js";\n',
     'import * as affiliate from "./affiliate.js";\nimport * as showplanner from "./showplanner.js";\n')

edit("index.js",
     '    if (path === "/api/blocks") { needs(user, "Content", "view"); return json(await blocks.listBlocks(env)); }\n',
     '    if (path.startsWith("/api/shows/")) {\n'
     '      needs(user, "Events", "view");\n'
     '      if (path === "/api/shows/plans") return json(await showplanner.list(env, url.searchParams));\n'
     '      if (path === "/api/shows/calendar") return json(await showplanner.calendar(env, url.searchParams));\n'
     '      if (path === "/api/shows/calendar.ics") return showplanner.ics(env);\n'
     '      if ((m = path.match(/^\\/api\\/shows\\/plan\\/(\\d{1,12})$/))) return json(await showplanner.get(env, Number(m[1])));\n'
     '      return fail("Not found", 404);\n'
     '    }\n'
     '    if (path === "/api/blocks") { needs(user, "Content", "view"); return json(await blocks.listBlocks(env)); }\n')

edit("index.js",
     '  if (path === "/api/affiliate/preview") {',
     '  if (path.startsWith("/api/shows/")) {\n'
     '    needs(user, "Events", "edit");\n'
     '    if (path === "/api/shows/suggest") return json(await showplanner.suggest(env, user.email, body.count, { date: body.date, venue_id: body.venue_id }));\n'
     '    if ((m = path.match(/^\\/api\\/shows\\/plan\\/(\\d{1,12})$/))) return json(await showplanner.update(env, user, Number(m[1]), body));\n'
     '    if ((m = path.match(/^\\/api\\/shows\\/plan\\/(\\d{1,12})\\/event$/))) return json(await showplanner.toEvent(env, user, Number(m[1])));\n'
     '    if ((m = path.match(/^\\/api\\/shows\\/plan\\/(\\d{1,12})\\/swap$/))) return json(await showplanner.swapAct(env, user, Number(m[1]), body.talent_id));\n'
     '    if ((m = path.match(/^\\/api\\/shows\\/item\\/(\\d{1,12})$/))) {\n'
     '      // Marking a booking email sent also marks the artist contacted in Talent, for people who can edit Talent.\n'
     '      let talent = null;\n'
     '      try { needs(user, "CRM", "edit"); talent = autopilot; } catch { /* Events only */ }\n'
     '      return json(await showplanner.updateItem(env, user, Number(m[1]), body, talent));\n'
     '    }\n'
     '    return fail("Not found", 404);\n'
     '  }\n'
     '  if (path === "/api/affiliate/preview") {')

edit("index.js",
     '  if (!calendar.length) need("watch", "calendar", 1, "Nothing on the calendar", "The homepage event card hides itself when there is no upcoming event.", "#/t/rb_events");\n',
     '  if (!calendar.length) need("watch", "calendar", 1, "Nothing on the calendar", "The homepage event card hides itself when there is no upcoming event.", "#/t/rb_events");\n'
     '  // The show planner keeps three suggestions waiting (at most once a day), then reports planned shows and what is due.\n'
     '  await showplanner.topUp(env).catch(() => null);\n'
     '  const planner = await showplanner.overview(env);\n'
     '  need("act", "show_plan_items", planner.due, "Show plan to-dos due", "Booking emails, tasks and posts for planned shows that are due today or overdue.", "#/shows?view=calendar");\n'
     '  need("watch", "show_plans", planner.suggested, "Show ideas from the planner", "Suggested from Talent with a lineup, venue and date. Plan the ones you like and drop the rest.", "#/shows");\n'
     '  if (planner.shows.length) { calendar.push(...planner.shows); calendar.sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at))); calendar.splice(12); }\n')

edit("index.js",
     '      if (!caps.groups.Events) d.needs = d.needs.filter((n) => n.key !== "submissions");\n',
     '      if (!caps.groups.Events) d.needs = d.needs.filter((n) => n.key !== "submissions");\n'
     '      if (!caps.groups.Events) { d.needs = d.needs.filter((n) => !n.key.startsWith("show_plan")); d.calendar = d.calendar.filter((e) => e.kind !== "plan"); }\n')

# ---- ui.js: styles, nav, route, overview link, screens
edit("ui.js", "    view.onclick = null; view.onchange = null;\n", "    view.onclick = null; view.onchange = null; view.oninput = null;\n")
CSS = r""".calgrid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}
.calhead{font-size:.68rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);padding:2px 6px}
.calday{min-height:96px;min-width:0;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:6px;display:flex;flex-direction:column;gap:3px}
.calday.out{opacity:.45}.calday.today{border-color:var(--brass)}
.calnum{font-size:.75rem;color:var(--muted)}
.calent{display:block;font-size:.72rem;line-height:1.3;padding:2px 6px;border-radius:6px;background:var(--panel2);border-left:3px solid var(--muted);color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.calent:hover{text-decoration:none;background:var(--line)}
.calent.k-plan{border-left-color:var(--brass);font-weight:600}.calent.k-event,.calent.k-show{border-left-color:var(--ok);font-weight:600}
.calent.k-outreach{border-left-color:var(--warn)}.calent.k-content{border-left-color:var(--brass2)}
.calent.sug{border-left-style:dashed;font-weight:400}.calent.done{opacity:.55;text-decoration:line-through}
.legend{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}.legend .calent{display:inline-block}
.agenda{display:none}
@media (max-width:640px){.calgrid{display:none}.agenda{display:block}}
.spitem .form{margin-top:8px}.spitem textarea{min-height:13rem}
.flash{outline:2px solid var(--brass);outline-offset:4px;border-radius:8px}
.spcheck{display:flex;gap:10px;align-items:flex-start;cursor:pointer}.spcheck input{margin-top:.25rem}
.spdone .title{text-decoration:line-through;color:var(--muted)}
.toolbar input[type=date],.row-actions input[type=datetime-local]{background:var(--panel2);border:1px solid var(--line2);border-radius:8px;padding:.35rem .5rem;color:var(--text);color-scheme:dark}
.rows input{background:var(--panel2);border:1px solid var(--line2);border-radius:8px;padding:.35rem .5rem;color:var(--text);width:100%;min-width:5rem}
"""
edit("ui.js", ".tgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}\n",
     ".tgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}\n" + CSS)

edit("ui.js", '  if (CAPS.groups.Events || CAPS.groups.Inbox) NAV_TOP.push(["inbox", "Inbox", "inbox"]);\n',
     '  if (CAPS.groups.Events || CAPS.groups.Inbox) NAV_TOP.push(["inbox", "Inbox", "inbox"]);\n'
     '  if (CAPS.groups.Events) NAV_TOP.push(["shows", "Show planner"]);\n')
edit("ui.js", '      else if (r.name === "affiliate") viewAffiliate();\n',
     '      else if (r.name === "affiliate") viewAffiliate();\n      else if (r.name === "shows") viewShows(r.params);\n')
edit("ui.js",
     '''<a class="title" href="#/t/' + (e.kind === "show" ? "shows" : "rb_events") + "/" + e.id + '">''',
     '''<a class="title" href="' + (e.kind === "plan" ? "#/shows?id=" + e.id : "#/t/" + (e.kind === "show" ? "shows" : "rb_events") + "/" + e.id) + '">''')

VIEW = r"""
  // ---------- show planner (shows, outreach and content, planned from Talent)
  var SHOW_STATUS = [["suggested", "Suggested"], ["planning", "Planning"], ["confirmed", "Confirmed"], ["dropped", "Dropped"]];
  var SHOW_KIND = { plan: "Planned show", event: "Event", show: "Show", outreach: "Email", task: "To do", content: "Post" };
  var MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  function ymdOf(d){ return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function dayOf(s){ var d = parseWhen(String(s || "").slice(0, 10)); return d ? d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : esc(s || ""); }
  function timeOf(s){ var d = parseWhen(s); return d ? d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(":00", "") : ""; }
  function copyText(t, msg){ (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function(){ toast(msg || "Copied"); }).catch(function(){ toast("Select the text and copy it."); }); }
  function calHref(e){ return e.type === "event" ? "#/t/rb_events/" + e.id : e.type === "show" ? "#/t/shows/" + e.id : e.type === "plan" ? "#/shows?id=" + e.id : "#/shows?id=" + e.plan_id + "&item=" + e.id; }
  function calEnt(e){ var off = e.status === "done" || e.status === "sent" || e.status === "skipped"; return '<a class="calent k-' + esc(e.type) + (e.type === "plan" && e.status === "suggested" ? " sug" : "") + (off ? " done" : "") + '" href="' + calHref(e) + '" title="' + esc(SHOW_KIND[e.type] + ": " + e.title + (e.place ? " · " + e.place : "")) + '">' + (e.time ? esc(timeOf(e.date + "T" + e.time)) + " " : "") + esc(e.title) + "</a>"; }

  function viewShows(params){
    var id = params.get("id"); if (id) return viewShowPlan(id, params.get("item"));
    var cal = params.get("view") === "calendar", all = params.get("status") === "all";
    setTitle("Show planner");
    var edit = CAPS.groups.Events === "edit", here = stillHere();
    view.innerHTML = '<p class="note">The planner suggests shows from <a href="#/talent">Talent</a>: a headliner and two supports who fit together, a venue from Events and a free Friday or Saturday. Each plan comes with booking emails for every artist and the venue, the full scope of the night, a to-do list and the posts to make, all dated on the calendar. Nothing is sent or published by itself: you send the emails from your own email, and a confirmed show goes to Events as a draft.</p>' +
      '<div class="toolbar"><div class="chips"><a class="fchip" href="#/shows" aria-pressed="' + !cal + '">Plans</a><a class="fchip" href="#/shows?view=calendar" aria-pressed="' + cal + '">Calendar</a></div><span class="spacer"></span><a class="btn" href="/api/shows/calendar.ics" download="rb-shows.ics">Download for Google or Apple Calendar</a></div>' +
      '<div id="sp-out"><p class="empty">Loading…</p></div>';
    if (cal) return showCalendar(params, here);
    var load = function(){
      api("shows/plans" + (all ? "?status=all" : "")).then(function(r){
        if (!here()) return;
        S.plans = r.plans;
        var group = function(list){ return list.length ? '<div class="panel"><ul class="list cal">' + list.map(planRow).join("") + "</ul></div>" : '<p class="empty">None.</p>'; };
        var by = function(sts){ return r.plans.filter(function(p){ return sts.indexOf(p.status) >= 0; }); };
        var form = edit ? '<form class="toolbar" id="sp-sug"><input type="date" id="sp-date" aria-label="Date (optional)"><select id="sp-venue" aria-label="Venue (optional)"><option value="">Venue: least used</option>' + r.venues.map(function(v){ return '<option value="' + esc(v.id) + '">' + esc(v.name + (v.city ? ", " + v.city : "")) + "</option>"; }).join("") + '</select><button class="btn primary" type="submit">Suggest a show</button><span class="muted">Leave them blank and the planner picks the next free Friday or Saturday 3 to 13 weeks out.</span></form>' : "";
        $("sp-out").innerHTML = (r.added ? '<p class="note">The planner just added ' + num(r.added) + " suggestion" + (r.added === 1 ? "" : "s") + ".</p>" : "") + form +
          '<section><h2>Suggested</h2>' + group(by(["suggested"])) + "</section>" +
          '<section><h2>Planning and confirmed</h2>' + group(by(["planning", "confirmed"])) + "</section>" +
          '<section><h2>On Events</h2>' + group(by(["published"])) + "</section>" +
          (all ? '<section><h2>Dropped</h2>' + group(by(["dropped"])) + '</section><p><a href="#/shows">Hide dropped shows</a></p>' : '<p><a href="#/shows?status=all">Show dropped and older plans</a></p>');
        if (edit) $("sp-sug").onsubmit = function(e){
          e.preventDefault(); var b = this.querySelector("button"); b.disabled = true; b.textContent = "Planning…";
          api("shows/suggest", { date: $("sp-date").value, venue_id: $("sp-venue").value }).then(function(x){
            if (!x.made.length) { toast(x.note); b.disabled = false; b.textContent = "Suggest a show"; return; }
            toast("Suggested: " + clip(x.made[0].title, 70)); go("#/shows?id=" + x.made[0].id);
          }).catch(function(err){ b.disabled = false; b.textContent = "Suggest a show"; toast(err.message); });
        };
      }).catch(function(e){ if (here()) $("sp-out").innerHTML = '<p class="empty">' + esc(e.message) + "</p>"; });
    };
    var planRow = function(p){
      var dt = parseWhen(p.starts_at), mon = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
      var acts = p.lineup.map(function(l){ return esc(l.name) + ' <span class="muted">(' + esc(l.role.toLowerCase()) + ")</span>"; }).join(", ");
      var prog = p.status === "suggested" ? (p.reasons ? '<div class="muted">' + esc(p.reasons) + "</div>" : "") : '<div class="muted">Emails ' + num(p.outreach_done) + "/" + num(p.outreach) + " sent or skipped · to-dos and posts " + num(p.todo_done) + "/" + num(p.todo) + " done</div>";
      var acts2 = edit && p.status === "suggested" ? '<button class="btn primary" type="button" data-st="planning">Plan it</button><button class="btn" type="button" data-st="dropped">Drop</button>' : "";
      return '<li data-plan="' + p.id + '">' + (dt ? '<div class="date"><span>' + mon[dt.getMonth()] + "</span><b>" + dt.getDate() + "</b></div>" : "") + '<div class="grow"><a class="title" href="#/shows?id=' + p.id + '">' + esc(p.title) + "</a> " + tag(p.status) + " " + tag(p.score + "/100") +
        '<div class="muted">' + dayOf(p.starts_at) + " · " + esc(timeOf(p.starts_at)) + " · " + esc(p.venue_name + (p.venue_city ? ", " + p.venue_city : "")) + "</div>" +
        '<div class="muted">' + acts + "</div>" + prog + '<div class="row-actions">' + acts2 + '<a class="btn" href="#/shows?id=' + p.id + '">Open the plan</a></div></div></li>';
    };
    load();
    view.onclick = function(e){
      var b = e.target.closest("[data-st]"); if (!b) return;
      var li = b.closest("[data-plan]"); b.disabled = true;
      api("shows/plan/" + li.dataset.plan, { status: b.dataset.st }).then(function(r){
        if (b.dataset.st === "planning") { toast("Planning it. Start with the venue email."); go("#/shows?id=" + r.plan.id); } else { toast("Dropped"); load(); }
      }).catch(function(err){ b.disabled = false; toast(err.message); });
    };
  }

  function showCalendar(params, here){
    var now = new Date(), m = /^\d{4}-\d{2}$/.test(params.get("m") || "") ? params.get("m") : ymdOf(now).slice(0, 7);
    var y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7)) - 1;
    var first = new Date(y, mo, 1), start = new Date(y, mo, 1 - first.getDay()), end = new Date(start); end.setDate(start.getDate() + 41);
    var shift = function(n){ var d = new Date(y, mo + n, 1); return "#/shows?view=calendar&m=" + ymdOf(d).slice(0, 7); };
    api("shows/calendar?from=" + ymdOf(start) + "&to=" + ymdOf(end)).then(function(r){
      if (!here()) return;
      var byDay = {}; r.entries.forEach(function(e){ (byDay[e.date] = byDay[e.date] || []).push(e); });
      var cells = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(function(d){ return '<div class="calhead">' + d + "</div>"; }).join("");
      for (var i = 0; i < 42; i++) {
        var d = new Date(start); d.setDate(start.getDate() + i); var key = ymdOf(d);
        cells += '<div class="calday' + (d.getMonth() !== mo ? " out" : "") + (key === r.today ? " today" : "") + '"><span class="calnum">' + d.getDate() + "</span>" + (byDay[key] || []).map(calEnt).join("") + "</div>";
      }
      var days = Object.keys(byDay).filter(function(k){ return k.slice(0, 7) === m; }).sort();
      var agenda = days.length ? '<div class="panel"><ul class="list">' + days.map(function(k){ return '<li><div class="grow"><div class="title">' + dayOf(k) + "</div>" + byDay[k].map(calEnt).join("") + "</div></li>"; }).join("") + "</ul></div>" : '<p class="empty">Nothing this month.</p>';
      var legend = '<div class="legend">' + ["plan","event","outreach","task","content"].map(function(k){ return '<span class="calent k-' + k + '">' + esc(SHOW_KIND[k]) + "</span>"; }).join("") + '<span class="calent k-plan sug">Suggested show</span></div>';
      $("sp-out").innerHTML = '<div class="toolbar"><a class="btn" href="' + shift(-1) + '">‹ ' + MONTHS[(mo + 11) % 12] + '</a><h3 class="grow">' + MONTHS[mo] + " " + y + '</h3><a class="btn" href="#/shows?view=calendar">This month</a><a class="btn" href="' + shift(1) + '">' + MONTHS[(mo + 1) % 12] + " ›</a></div>" +
        '<div class="calgrid">' + cells + '</div><div class="agenda">' + agenda + "</div>" + legend +
        '<p class="note gap-top">Shows, RB events and dated work for every plan you\'re planning. Suggested shows appear dashed; their emails and posts join the calendar once you plan them.</p>';
    }).catch(function(e){ if (here()) $("sp-out").innerHTML = '<p class="empty">' + esc(e.message) + "</p>"; });
  }

  function viewShowPlan(id, focus){
    setTitle("Show plan");
    var edit = CAPS.groups.Events === "edit", here = stillHere(), d = null;
    view.innerHTML = '<a class="back" href="#/shows">← Show planner</a><div id="sp-plan"><p class="empty">Loading…</p></div>';
    var fieldVals = function(li){ var o = {}; li.querySelectorAll("[data-f]").forEach(function(x){ o[x.dataset.f] = x.value; }); return o; };
    var itemsOf = function(kind){ return d.items.filter(function(i){ return i.kind === kind; }); };
    var due = function(i){ var late = i.status === "todo" && i.due_on < (d.today || ymdOf(new Date())); return '<span class="' + (late ? "down" : "muted") + '">' + (late ? "Overdue: " : "Due ") + dayOf(i.due_on) + "</span>"; };
    var paint = function(){
      var p = d.plan, sc = p.scope || {}, ro = !edit || p.status === "published" || p.status === "dropped";
      var count = function(kind, done){ var l = itemsOf(kind); return l.filter(function(i){ return done.indexOf(i.status) >= 0; }).length + "/" + l.length; };
      var lineup = '<div class="scroll"><table class="rows"><thead><tr><th>Set</th><th>Act</th><th>Role</th><th>From</th><th>Genre</th><th>Links</th>' + (ro ? "" : "<th></th>") + "</tr></thead><tbody>" + p.lineup.map(function(l){
        var links = [l.profile_url && safeUrl(l.profile_url) ? '<a href="' + esc(safeUrl(l.profile_url)) + '" target="_blank" rel="noopener">Profile ↗</a>' : "", l.email ? '<a href="mailto:' + esc(l.email) + '">' + esc(l.email) + "</a>" : ""].filter(Boolean).join(" · ");
        return "<tr><td>" + esc(timeOf(p.starts_at.slice(0, 10) + "T" + l.set_start)) + " · " + esc(l.set_minutes) + " min</td><td><b>" + esc(l.name) + "</b>" + (l.sample ? '<div class="muted">"' + esc(l.sample) + '"</div>' : "") + "</td><td>" + esc(l.role) + "</td><td>" + esc(l.city || "") + "</td><td>" + esc(l.genre || "") + "</td><td>" + (links || '<span class="muted">No email in Talent</span>') + "</td>" +
          (ro ? "" : '<td><button class="btn" type="button" data-swap="' + esc(l.talent_id) + '" data-name="' + esc(l.name) + '">Swap</button></td>') + "</tr>";
      }).join("") + "</tbody></table></div>";
      var ros = '<ul class="list">' + (sc.run_of_show || []).map(function(x){ return '<li><div class="date"><b>' + esc(x.label) + '</b></div><div class="grow">' + esc(x.item) + "</div></li>"; }).join("") + "</ul>";
      var mails = itemsOf("outreach").map(function(i){
        return '<li class="spitem" data-item="' + i.id + '"><div class="grow"><div class="title">' + esc(i.title) + " " + tag(i.status) + "</div>" + due(i) +
          '<div class="form"><div class="field"><label class="lbl" for="to-' + i.id + '">To</label><input type="email" id="to-' + i.id + '" data-f="to_email" value="' + esc(i.to_email || "") + '" placeholder="' + (i.target_type === "venue" ? "The venue's booking email" : "Their email, from their profile or DMs") + '"' + (ro ? " disabled" : "") + "></div>" +
          '<div class="field"><label class="lbl" for="su-' + i.id + '">Subject</label><input type="text" id="su-' + i.id + '" data-f="subject" value="' + esc(i.subject || "") + '"' + (ro ? " disabled" : "") + "></div>" +
          '<div class="field wide"><label class="lbl" for="bo-' + i.id + '">Email</label><textarea id="bo-' + i.id + '" data-f="body"' + (ro ? " disabled" : "") + ">" + esc(i.body || "") + '</textarea><div class="help">Fill in anything in [brackets] before sending.</div></div></div>' +
          '<div class="row-actions"><button class="btn primary" type="button" data-mail>Open in my email</button><button class="btn" type="button" data-copy>Copy</button>' +
          (ro ? "" : '<button class="btn" type="button" data-save>Save</button>' + (i.status === "todo" ? '<button class="btn" type="button" data-set="sent">Mark sent</button><button class="btn" type="button" data-set="skipped">Skip</button>' : '<button class="btn" type="button" data-set="todo">Back to to-do</button>')) + "</div></div></li>";
      }).join("");
      var check = function(i){ var off = i.status !== "todo"; return '<li class="spitem' + (off ? " spdone" : "") + '" data-item="' + i.id + '"><label class="spcheck grow"><input type="checkbox" data-check' + (off ? " checked" : "") + (ro ? " disabled" : "") + '><span><span class="title">' + esc(i.title) + "</span><br>" + due(i) + (i.channel ? ' <span class="muted">· ' + esc(i.channel) + "</span>" : "") + "</span></label>" + (i.kind === "content" ? '<button class="btn" type="button" data-copy-cap>Copy caption</button>' : "") + "</li>" + (i.kind === "content" ? '<li class="spsub"><pre class="note pre grow">' + esc(i.body || "") + "</pre></li>" : ""); };
      var tk = sc.tickets || {}, budget = sc.budget || [], total = budget.reduce(function(a, b){ return a + (Number(b.amount) || 0); }, 0);
      var tickets = '<div class="form">' + [["price", "Price or cover"], ["capacity", "Capacity"], ["age", "Age"], ["link", "Ticket or RSVP link"]].map(function(f){ return '<div class="field"><label class="lbl" for="tk-' + f[0] + '">' + f[1] + '</label><input type="text" id="tk-' + f[0] + '" data-tk="' + f[0] + '" value="' + esc(tk[f[0]] || "") + '"' + (ro ? " disabled" : "") + "></div>"; }).join("") + "</div>" + (ro ? "" : '<div class="row-actions"><button class="btn" type="button" data-save-tickets>Save tickets</button></div>');
      var bud = '<div class="scroll"><table class="rows"><thead><tr><th>Line</th><th>Amount ($)</th><th>Notes</th></tr></thead><tbody>' + budget.map(function(b, n){ return '<tr data-b="' + n + '"><td>' + esc(b.line) + '</td><td><input type="number" min="0" step="0.01" data-ba value="' + (b.amount == null ? "" : esc(b.amount)) + '" aria-label="Amount for ' + esc(b.line) + '"' + (ro ? " disabled" : "") + '></td><td><input type="text" data-bn value="' + esc(b.notes || "") + '" aria-label="Notes for ' + esc(b.line) + '"' + (ro ? " disabled" : "") + "></td></tr>"; }).join("") + "</tbody></table></div>" +
        '<div class="row-actions"><span class="muted grow">Total so far: ' + money(Math.round(total * 100)) + ". Amounts are what you've agreed or been quoted; leave a line empty until you know.</span>" + (ro ? "" : '<button class="btn" type="button" data-save-budget>Save budget</button>') + "</div>";
      var bullets = function(l){ return '<ul class="list">' + (l || []).map(function(x){ return '<li><div class="grow">' + esc(x) + "</div></li>"; }).join("") + "</ul>"; };
      var roles = '<ul class="list">' + (sc.roles || []).map(function(x){ return '<li><div class="grow"><div class="title">' + esc(x.role) + '</div><div class="muted">' + esc(x.who) + " · " + esc(x.notes) + "</div></div></li>"; }).join("") + "</ul>";
      var head = '<div class="panel"><h3>' + esc(p.title) + " " + tag(p.status) + " " + tag(p.score + "/100") + '</h3><div class="muted">' + dayOf(p.starts_at) + " · doors " + esc(p.door_time || "") + ", music " + esc(timeOf(p.starts_at)) + " to midnight · " + esc(p.venue_name + (p.venue_city ? ", " + p.venue_city : "")) + "</div>" +
        '<p class="note quote">' + esc(p.concept) + "</p>" + (p.reasons ? '<div class="muted">Why these artists: ' + esc(p.reasons) + "</div>" : "") +
        '<div class="muted">Emails ' + count("outreach", ["sent", "skipped"]) + " sent or skipped · to-dos " + count("task", ["done", "skipped"]) + " · posts " + count("content", ["done", "skipped"]) + "</div>" +
        (edit && p.status !== "published" ? '<div class="row-actions"><select id="sp-status" aria-label="Plan status">' + opts(SHOW_STATUS, p.status) + '</select><input type="datetime-local" id="sp-when" value="' + esc(p.starts_at.slice(0, 16)) + '" aria-label="Show start"><button class="btn" type="button" data-move>Move the date</button><button class="btn" type="button" data-rename>Rename</button>' + (p.status === "confirmed" ? '<button class="btn primary" type="button" data-event>Add to Events as a draft</button>' : "") + "</div>" : "") +
        (p.rb_event_id ? '<div class="row-actions"><a class="btn primary" href="#/t/rb_events/' + esc(p.rb_event_id) + '">Open on Events</a><span class="muted">It\'s a draft there: add the flyer and ticket link, then set it live.</span></div>' : p.status !== "confirmed" && edit && p.status !== "dropped" ? '<p class="muted">Confirm the show once the venue and acts have agreed; then you can add it to Events.</p>' : "") + "</div>";
      $("sp-plan").innerHTML = '<section>' + head + "</section>" +
        '<section><h2>Lineup</h2><div class="panel">' + lineup + (ro ? "" : '<p class="muted">Swap puts the next best free artist from Talent in that slot and rewrites the emails and posts that haven\'t gone out.</p>') + "</div></section>" +
        '<section><h2>Booking emails</h2><div class="panel"><p class="note">Open in my email starts a message in your email app with this text. Send it from there, then mark it sent. Marking an artist\'s email sent also marks them contacted in Talent.</p><ul class="list">' + mails + "</ul></div></section>" +
        '<div class="grid2"><section><h2>To do</h2><div class="panel"><ul class="list">' + itemsOf("task").map(check).join("") + "</ul></div></section>" +
        '<section><h2>Run of show</h2><div class="panel">' + ros + "</div></section></div>" +
        '<section><h2>Content calendar</h2><div class="panel"><p class="note">Posts to make, with captions. Use real photos and clips from the artists; tick each one off once it\'s up.</p><ul class="list">' + itemsOf("content").map(check).join("") + "</ul></div></section>" +
        '<div class="grid2"><section><h2>Tickets</h2><div class="panel">' + tickets + "</div></section>" +
        '<section><h2>Roles</h2><div class="panel">' + roles + "</div></section></div>" +
        '<section><h2>Budget</h2><div class="panel">' + bud + "</div></section>" +
        '<div class="grid2"><section><h2>Production</h2><div class="panel">' + bullets(sc.production) + "</div></section>" +
        '<section><h2>Risks and backups</h2><div class="panel">' + bullets(sc.risks) + "</div></section></div>";
      if (focus) { var f = view.querySelector('[data-item="' + focus + '"]'); focus = null; if (f) { f.classList.add("flash"); f.scrollIntoView({ block: "center" }); } }
    };
    var load = function(){ return api("shows/plan/" + encodeURIComponent(id)).then(function(r){ if (!here()) return; d = r; S.dirty = false; paint(); }).catch(function(e){ if (here()) $("sp-plan").innerHTML = '<p class="empty">' + esc(e.message) + "</p>"; }); };
    var item = function(li, body, msg){
      return api("shows/item/" + li.dataset.item, body).then(function(r){
        S.dirty = false;
        d.items = d.items.map(function(x){ return x.id === r.item.id ? r.item : x; });
        toast(msg + (r.talent === "contacted" ? " " + r.item.target_name + " is now marked contacted in Talent." : "")); paint();
      }).catch(function(err){ li.querySelectorAll("button[disabled],input[data-check][disabled]").forEach(function(x){ x.disabled = false; }); toast(err.message); });
    };
    var plan = function(body, msg){ return api("shows/plan/" + d.plan.id, body).then(function(r){ d = r; S.dirty = false; toast(msg); paint(); }).catch(function(err){ toast(err.message); }); };
    load();
    view.oninput = function(e){ if (e.target.dataset.f || e.target.dataset.tk !== undefined || e.target.dataset.ba !== undefined || e.target.dataset.bn !== undefined) S.dirty = true; };
    view.onchange = function(e){
      if (e.target.id === "sp-status") { var st = e.target.value; plan({ status: st }, st === "confirmed" ? "Confirmed. Add it to Events when you're ready." : "Status: " + st); return; }
      if (e.target.dataset.check !== undefined) { var li = e.target.closest("[data-item]"); e.target.disabled = true; item(li, { status: e.target.checked ? "done" : "todo" }, e.target.checked ? "Done" : "Back on the list"); }
    };
    view.onclick = function(e){
      var b = e.target.closest("button"); if (!b || !d) return;
      var li = b.closest("[data-item]");
      if (b.hasAttribute("data-mail")) { var v = fieldVals(li); location.href = "mailto:" + encodeURIComponent(v.to_email || "").replace(/%40/g, "@") + "?subject=" + encodeURIComponent(v.subject) + "&body=" + encodeURIComponent(v.body); toast("Send it from your email, then mark it sent here."); return; }
      if (b.hasAttribute("data-copy")) { var c = fieldVals(li); copyText("Subject: " + c.subject + "\n\n" + c.body, "Email copied"); return; }
      if (b.hasAttribute("data-copy-cap")) { var it = d.items.find(function(x){ return String(x.id) === li.dataset.item; }); copyText(it.body || "", "Caption copied"); return; }
      if (b.hasAttribute("data-save")) { b.disabled = true; item(li, fieldVals(li), "Saved"); return; }
      if (b.dataset.set) { var body = fieldVals(li); body.status = b.dataset.set; b.disabled = true; item(li, body, b.dataset.set === "sent" ? "Marked sent" : b.dataset.set === "skipped" ? "Skipped" : "Back on the list"); return; }
      if (b.hasAttribute("data-swap")) {
        if (!confirm("Swap " + b.dataset.name + " for the next best free artist in Talent?")) return;
        b.disabled = true;
        api("shows/plan/" + d.plan.id + "/swap", { talent_id: b.dataset.swap }).then(function(r){ d = r; toast(r.swapped.out + " out, " + r.swapped.in + " in. Their booking email is ready."); paint(); }).catch(function(err){ b.disabled = false; toast(err.message); });
        return;
      }
      if (b.hasAttribute("data-move")) { var w = $("sp-when").value; if (!w) return; plan({ starts_at: w }, "Moved. Due dates still to do moved with it."); return; }
      if (b.hasAttribute("data-rename")) { var t = prompt("Show title", d.plan.title); if (t && t.trim() && t.trim() !== d.plan.title) plan({ title: t.trim() }, "Renamed"); return; }
      if (b.hasAttribute("data-save-tickets")) { var tk = {}; view.querySelectorAll("[data-tk]").forEach(function(x){ tk[x.dataset.tk] = x.value.trim(); }); plan({ tickets: tk }, "Tickets saved"); return; }
      if (b.hasAttribute("data-save-budget")) {
        var lines = d.plan.scope.budget.map(function(x, n){ var row = view.querySelector('[data-b="' + n + '"]'); return { line: x.line, amount: row.querySelector("[data-ba]").value, notes: row.querySelector("[data-bn]").value }; });
        plan({ budget: lines }, "Budget saved"); return;
      }
      if (b.hasAttribute("data-event")) {
        b.disabled = true;
        api("shows/plan/" + d.plan.id + "/event", {}).then(function(r){ toast("Added to Events as a draft"); go("#/t/rb_events/" + r.rb_event_id); }).catch(function(err){ b.disabled = false; toast(err.message); });
      }
    };
  }
"""
edit("ui.js", "  // ---------- site colours (one theme for every RB site)\n", VIEW.lstrip("\n") + "\n  // ---------- site colours (one theme for every RB site)\n")
print("rb-command patched")
