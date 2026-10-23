"""Group RB Command's nav into sections.

Usage: python3 -I patch_nav.py <pulled rb-command dir>

The nav had grown to about 30 tools and 30 tables in one column. Now:
- Overview, Analytics and Inbox stay at the top;
- the tools sit under "Shows & sites" and "Growth";
- each table group (Content, TV, Events, ...) folds away. A group opens by itself when it holds the page you're on or
  something waiting (its count shows on the heading), and remembers whether you left it open.
Nothing is removed: every link is still there. Running it twice changes nothing.
"""
import pathlib
import sys

folder = pathlib.Path(sys.argv[1])


MARK = "    // The tools in two sections; anything not listed here stays at the top with Overview.\n"


def edit(name, old, new):
    p = folder / name
    s = p.read_text(encoding="utf-8")
    if new in s or (new.startswith(MARK) and MARK in s):
        return
    if s.count(old) != 1:
        raise SystemExit(f"{name}: anchor found {s.count(old)} times: {old[:70]!r}")
    p.write_text(s.replace(old, new), encoding="utf-8")
    print(f"{name}: edited")


edit("ui.js", '''    NAV_TOP.forEach(function(n){ html += link(n[0] === "home" ? "" : n[0], n[1], n[2]); });
    CFG.groups.forEach(function(g){
      html += '<div class="grp">' + esc(g) + "</div>";
      Object.keys(T).forEach(function(k){ if (T[k].group === g) html += link("t/" + k, T[k].label, k); });
    });
''', '''    // The tools in two sections; anything not listed here stays at the top with Overview.
    var SECT = { shows: "Shows & sites", radio: "Shows & sites", review: "Shows & sites", blocks: "Shows & sites", colors: "Shows & sites", "/images": "Shows & sites", affiliate: "Shows & sites", "/video": "Shows & sites", "/cover": "Shows & sites", "/badge-desk": "Shows & sites", "/upload": "Shows & sites",
      crm: "Growth", talent: "Growth", marketing: "Growth", create: "Growth", autopilot: "Growth", projects: "Growth", "/finder": "Growth", jobs: "Growth", "/resumes": "Growth" };
    NAV_TOP.forEach(function(n){ if (!SECT[n[0]]) html += link(n[0] === "home" ? "" : n[0], n[1], n[2]); });
    ["Shows & sites", "Growth"].forEach(function(sec){
      var items = NAV_TOP.filter(function(n){ return SECT[n[0]] === sec; });
      if (!items.length) return;
      html += '<div class="grp">' + esc(sec) + "</div>";
      items.forEach(function(n){ html += link(n[0], n[1], n[2]); });
    });
    // Table groups fold away; one opens by itself when it holds this page or something waiting, or was left open.
    var saved = {}; try { saved = JSON.parse(localStorage.getItem("rbc-nav") || "{}") || {}; } catch (e) {}
    CFG.groups.forEach(function(g){
      var keys = Object.keys(T).filter(function(k){ return T[k].group === g; });
      var waiting = keys.reduce(function(a, k){ return a + (S.ov && S.ov.badges ? Number(S.ov.badges[k]) || 0 : 0); }, 0);
      var here = keys.some(function(k){ return cur === "t/" + k; });
      var open = here || waiting > 0 || saved[g] === true;
      html += '<details class="ngrp" data-g="' + esc(g) + '"' + (open ? " open" : "") + '><summary class="grp">' + esc(g) + (waiting ? ' <span class="badge">' + num(waiting) + "</span>" : "") + "</summary>";
      keys.forEach(function(k){ html += link("t/" + k, T[k].label, k); });
      html += "</details>";
    });
''')
ui = folder / "ui.js"
cur = ui.read_text(encoding="utf-8")
for key, after in (('"/cover"', '"/video": "Shows & sites", '), ('"/images"', 'colors: "Shows & sites", '), ('"/badge-desk"', '"/cover": "Shows & sites", ')):
    if MARK in cur and f'{key}: "Shows & sites"' not in cur and cur.count(after) == 1:
        cur = cur.replace(after, after + f'{key}: "Shows & sites", ')
        ui.write_text(cur, encoding="utf-8")
        print(f"ui.js: {key} added to Shows & sites")
edit("ui.js", '''    $("nav").innerHTML = html;
''', '''    $("nav").innerHTML = html;
    $("nav").querySelectorAll("details[data-g]").forEach(function(d){ d.addEventListener("toggle", function(){ try { var o = JSON.parse(localStorage.getItem("rbc-nav") || "{}") || {}; o[d.dataset.g] = d.open; localStorage.setItem("rbc-nav", JSON.stringify(o)); } catch (e) {} }); });
''')
edit("ui.js", ".nav .grp{font-size:.66rem;letter-spacing:.2em;text-transform:uppercase;color:var(--brass);margin:16px 8px 4px}\n",
     ".nav .grp{font-size:.66rem;letter-spacing:.2em;text-transform:uppercase;color:var(--brass);margin:16px 8px 4px}\n"
     ".nav summary.grp{cursor:pointer;list-style:none;display:flex;align-items:center;gap:6px}.nav summary.grp::-webkit-details-marker{display:none}"
     ".nav summary.grp::before{content:\"▸\";font-size:.7rem;color:var(--muted);transition:transform .15s}.nav details[open]>summary.grp::before{transform:rotate(90deg)}"
     ".nav summary.grp:focus-visible{outline:2px solid var(--brass);outline-offset:2px;border-radius:4px}\n")
print("rb-command patched")
