"""Add "Move outside files" to a pulled rb-command Worker: copy files still on files.manuscdn.com into RB media.

Usage: python3 -I patch_rehost.py <pulled rb-command dir>

Copies src/rehost.js in. Then it:
- adds GET /api/rehost (Content view) and POST /api/rehost/run (Content edit; each table also needs its own edit right);
- points the Overview's "Site files hosted on files.manuscdn.com" item at the new screen;
- adds the screen to ui.js.

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
    # Already done? For an insertion, look for the inserted text on its own: another patch may have added its own
    # block next to the same anchor since, so "anchor + block" isn't side by side any more.
    added = new[len(old):] if new.startswith(old) else new[: len(new) - len(old)] if new.endswith(old) else None
    if added and s.count(added) > 1:
        # An earlier version of these scripts could add a block twice. Keep the first copy, drop the rest.
        first = s.index(added) + len(added)
        s = s[:first] + s[first:].replace(added, "")
        p.write_text(s, encoding="utf-8")
        print(f"{name}: removed a duplicate copy")
    # A later patch may have edited the block since (see patch_planner_links.py): its first line still marks it as done.
    # The whole first line, indentation included, so one block's first line can't match a look-alike line elsewhere.
    mark = next((ln for ln in added.split("\n") if ln.strip()), "") if added else ""
    if new in s or (added and added in s) or (len(mark.strip()) >= 25 and ("\n" + mark + "\n") in ("\n" + s)):
        return
    if s.count(old) != 1:
        raise SystemExit(f"{name}: anchor found {s.count(old)} times: {old[:70]!r}")
    p.write_text(s.replace(old, new), encoding="utf-8")
    print(f"{name}: edited")


shutil.copyfile(HERE / "src" / "rehost.js", folder / "rehost.js")
print("rehost.js: copied")

edit("index.js", 'import * as sitetheme from "./sitetheme.js";\n',
     'import * as sitetheme from "./sitetheme.js";\nimport * as rehost from "./rehost.js";\n')
edit("index.js",
     '    if (path === "/api/blocks") { needs(user, "Content", "view"); return json(await blocks.listBlocks(env)); }\n',
     '    if (path === "/api/rehost") { needs(user, "Content", "view"); return json(await rehost.scan(env)); }\n'
     '    if (path === "/api/blocks") { needs(user, "Content", "view"); return json(await blocks.listBlocks(env)); }\n')
edit("index.js",
     '  if (path === "/api/site-theme") { needs(user, "Content", "edit"); return json(await sitetheme.save(env, user, body)); }\n',
     '  if (path === "/api/site-theme") { needs(user, "Content", "edit"); return json(await sitetheme.save(env, user, body)); }\n'
     '  if (path === "/api/rehost/run") { needs(user, "Content", "edit"); return json(await rehost.run(env, user, body, (t) => auth.can(user.role, TABLES[t]?.group, "edit"))); }\n')
edit("index.js",
     '"Player audio and homepage images load from an outside service. Re-upload them here so they can\'t disappear.", "#/t/tracks?q=manuscdn");',
     '"Player audio and homepage images load from an outside service. Move them into RB media in one step so they can\'t disappear.", "#/rehost");')

edit("ui.js", '      else if (r.name === "colors") viewColors();\n',
     '      else if (r.name === "colors") viewColors();\n      else if (r.name === "rehost") viewRehost();\n')

VIEW = r"""
  // ---------- move outside files (files.manuscdn.com) into RB media
  function viewRehost(){
    setTitle("Move outside files");
    var here = stillHere(), edit = CAPS.groups.Content === "edit", busy = false;
    view.innerHTML = '<p class="note">These files still load from files.manuscdn.com, a service RB doesn\'t control. If it goes away, the songs stop playing and the pictures stop showing. Moving them copies each file into RB media (media.relentlessbillionaire.com) and points the rows below at the copies. Each change is logged as an edit, so Undo in <a href="#/activity">Activity</a> puts the old link back.</p><div id="rh-out"><p class="empty">Checking…</p></div>';
    var load = function(){
      api("rehost").then(function(r){
        if (!here()) return;
        var out = $("rh-out");
        if (!r.files) { out.innerHTML = '<div class="panel"><p class="empty">Nothing left on files.manuscdn.com. Every file loads from RB media.</p></div>'; return; }
        var rows = '<ul class="list">' + r.rows.map(function(x){ return '<li><div class="grow"><a class="title" href="#/t/' + esc(x.table) + "/" + encodeURIComponent(x.id) + '">' + esc(x.label) + '</a><div class="muted">' + esc(T[x.table] ? T[x.table].label : x.table) + " · " + num(x.files) + " file" + (x.files === 1 ? "" : "s") + "</div></div></li>"; }).join("") + "</ul>";
        var failed = r.failed.length ? '<section><h2>Couldn\'t copy</h2><div class="panel"><ul class="list">' + r.failed.map(function(f){ return '<li><div class="grow"><div class="title">' + esc(clip(f.src.replace(/^https?:\/\//, ""), 90)) + '</div><div class="muted">' + esc(f.error) + (f.gave_up ? " · tried 3 times; upload a copy by hand on the row" : " · will try again") + "</div></div></li>"; }).join("") + "</ul></div></section>" : "";
        out.innerHTML = '<section><h2>' + num(r.files) + " file" + (r.files === 1 ? "" : "s") + " in " + num(r.rows.length) + " row" + (r.rows.length === 1 ? "" : "s") + '</h2><div class="panel">' + rows +
          (edit ? '<div class="row-actions"><button class="btn primary" type="button" id="rh-go">Move them into RB media</button><span class="muted" id="rh-status" role="status"></span></div>' : '<p class="muted">Your role can look at this but not move files.</p>') + "</div></section>" + failed;
        if (edit) $("rh-go").onclick = go;
      }).catch(function(e){ if (here()) $("rh-out").innerHTML = '<p class="empty">' + esc(e.message) + "</p>"; });
    };
    var go = function(){
      if (busy) return; busy = true; S.dirty = true;
      var b = $("rh-go"), st = $("rh-status"), copied = 0, failed = 0, updated = 0;
      b.disabled = true;
      var step = function(){
        api("rehost/run", { max: 3 }).then(function(x){
          copied += x.copied.length; failed += x.failed.length; updated += x.updated;
          if (st) st.textContent = "Copied " + num(copied) + " of " + num(x.total) + " files" + (failed ? " · " + num(failed) + " failed" : "") + " · " + num(updated) + " rows updated";
          if (x.remaining && (x.copied.length || x.failed.length) && here()) return step();
          busy = false; S.dirty = false;
          toast(copied ? "Moved " + num(copied) + " file" + (copied === 1 ? "" : "s") + " into RB media" : "Nothing more to move");
          if (here()) load();
        }).catch(function(e){ busy = false; S.dirty = false; if (b) b.disabled = false; toast(e.message); });
      };
      step();
    };
    load();
  }
"""
edit("ui.js", "  // ---------- site colours (one theme for every RB site)\n", VIEW.lstrip("\n") + "\n  // ---------- site colours (one theme for every RB site)\n")
print("rb-command patched")
