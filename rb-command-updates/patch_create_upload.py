"""RB Command > Create: a quick way to put new songs in the music player and RB Radio, and beats that say where they go.

Usage: python3 -I patch_create_upload.py <pulled rb-command dir>

- "Add songs" panel at the top of Create, for people with Content edit rights. Drop in one or more audio files (MP3,
  WAV, M4A, AAC or FLAC) and an optional cover. Each file gets a row with Title and Artist, filled in from the file
  name ("Artist - Title.mp3"). Choose Live (music player and RB Radio) or Draft, then press Upload. Each file goes
  to RB's media bucket through the existing /api/upload, then into the Player table (tracks) through the existing
  table API, so the usual checks and the Activity log apply. New songs go to the end of the player order. RB Radio
  picks up live tracks in its next rotation.
- Beat publishing: the publish form now has an Artist field for beats too, and the button says beats go to the beat
  store, the music player and RB Radio (rb-autopilot now does that; see rb-site-updates/patch_beat_publish.py).
ui.js is a String.raw template: no backticks and no dollar-brace in the added code. Running it twice changes nothing.
"""
import pathlib
import sys

folder = pathlib.Path(sys.argv[1])
p = folder / "ui.js"
s = p.read_text(encoding="utf-8")
changed = []


def rep(old, new, what):
    global s
    if new in s:
        return
    if s.count(old) != 1:
        raise SystemExit(f"rb-command/ui.js: {what}: anchor found {s.count(old)} times")
    s = s.replace(old, new)
    changed.append(what)


QUICK = r'''  // ---------- Create: quick song upload to the music player and RB Radio
  function quickUploadHtml(){
    return '<section class="panel qup" id="qup"><h2>Add songs</h2><p class="muted">Drop in finished songs to put them in the music player and RB Radio. Names come from the file name (Artist - Title); change anything before you upload.</p>' +
      '<div class="row-actions"><label class="btn">Choose songs<input type="file" id="qup-files" accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac,audio/flac,.mp3,.wav,.m4a,.aac,.flac" multiple hidden></label>' +
      '<label class="btn">Cover (optional)<input type="file" id="qup-cover" accept="image/jpeg,image/png,image/webp" hidden></label><span class="muted" id="qup-cover-name"></span></div>' +
      '<ul class="list" id="qup-list"></ul>' +
      '<div class="row-actions" id="qup-go" hidden><select id="qup-status" aria-label="Where it goes"><option value="live">Live: music player and RB Radio</option><option value="draft">Draft: hidden for now</option></select>' +
      '<button class="btn primary" type="button" id="qup-up">Upload</button><span class="muted" id="qup-st" role="status"></span></div></section>';
  }
  function wireQuickUpload(){
    var files = [], cover = null, list = $("qup-list"), box = $("qup");
    if (!box) return;
    var guess = function(name){
      var base = String(name || "").replace(/\.[a-z0-9]+$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
      var m = base.split(" - ");
      return m.length > 1 ? { artist: m[0].trim(), title: m.slice(1).join(" - ").trim() } : { artist: "", title: base };
    };
    var draw = function(){
      list.innerHTML = files.map(function(f, i){
        return '<li class="qup-row"><div class="form"><div class="field"><label class="lbl" for="qt' + i + '">Title</label><input type="text" id="qt' + i + '" data-q="title" data-n="' + i + '" maxlength="140" value="' + esc(f.title) + '"></div>' +
          '<div class="field"><label class="lbl" for="qa' + i + '">Artist</label><input type="text" id="qa' + i + '" data-q="artist" data-n="' + i + '" maxlength="80" value="' + esc(f.artist) + '"></div></div>' +
          '<span class="muted">' + esc(f.file.name) + ' · ' + (f.file.size / 1048576).toFixed(1) + ' MB' + (f.done ? ' · <b>' + esc(f.done) + '</b>' : "") + '</span> <button class="btn" type="button" data-qx="' + i + '">Remove</button></li>';
      }).join("");
      $("qup-go").hidden = !files.length;
    };
    var add = function(fl){
      Array.prototype.forEach.call(fl || [], function(file){
        if (!/^audio\//.test(file.type) && !/\.(mp3|wav|m4a|aac|flac)$/i.test(file.name)) return;
        var g = guess(file.name); files.push({ file: file, title: g.title || "Untitled", artist: g.artist || "Relentless Billionaire" });
      });
      draw();
    };
    $("qup-files").onchange = function(e){ add(e.target.files); e.target.value = ""; };
    $("qup-cover").onchange = function(e){ cover = e.target.files[0] || null; $("qup-cover-name").textContent = cover ? cover.name : ""; };
    box.addEventListener("dragover", function(e){ e.preventDefault(); box.classList.add("drag"); });
    box.addEventListener("dragleave", function(){ box.classList.remove("drag"); });
    box.addEventListener("drop", function(e){ e.preventDefault(); box.classList.remove("drag"); add(e.dataTransfer && e.dataTransfer.files); });
    list.addEventListener("input", function(e){ var t = e.target; if (t.dataset.q) files[Number(t.dataset.n)][t.dataset.q] = t.value; });
    list.addEventListener("click", function(e){ var b = e.target.closest("[data-qx]"); if (b) { files.splice(Number(b.dataset.qx), 1); draw(); } });
    $("qup-up").onclick = function(){
      var b = this, st = $("qup-st"), status = $("qup-status").value, todo = files.filter(function(f){ return !f.id; });
      if (!todo.length) { toast("Add a song first"); return; }
      if (todo.some(function(f){ return !String(f.title).trim(); })) { toast("Every song needs a title"); return; }
      b.disabled = true;
      var coverUrl = null, order = 0;
      var start = cover ? uploadFile(cover, "tracks").then(function(r){ coverUrl = r.url; }) : Promise.resolve();
      start.then(function(){ return api("t/tracks?limit=500").catch(function(){ return { rows: [] }; }); }).then(function(d){
        (d.rows || []).forEach(function(r){ var n = Number(r.sort_order); if (n > order) order = n; });
        var i = 0;
        var next = function(){
          if (i >= todo.length) return Promise.resolve();
          var f = todo[i++];
          st.textContent = "Uploading " + i + " of " + todo.length + "…";
          return uploadFile(f.file, "tracks").then(function(up){
            var values = { title: String(f.title).trim().slice(0, 140), artist_name: String(f.artist || "").trim().slice(0, 80), audio_url: up.url, status: status, sort_order: ++order };
            if (coverUrl) values.cover_url = coverUrl;
            return api("t/tracks", { values: values });
          }).then(function(r){ f.id = r.id; f.done = status === "live" ? "Live" : "Saved as draft"; draw(); return next(); });
        };
        return next();
      }).then(function(){
        st.textContent = ""; b.disabled = false;
        toast(todo.length + " song" + (todo.length === 1 ? "" : "s") + (status === "live" ? " live in the music player and RB Radio" : " saved as drafts"));
        loadOverview().catch(function(){});
      }).catch(function(err){ st.textContent = ""; b.disabled = false; draw(); toast(err.message); });
    };
  }
'''

rep('  var KIND_DEST = { beat: "the beat store", song: "the music player", video: "RB TV" };\n',
    QUICK + '  var KIND_DEST = { beat: "the beat store, music player and RB Radio", song: "the music player", video: "RB TV" };\n', "quick upload + beat destination")
rep("""        '<section><div class="toolbar"><div class="chips">' + CREATE_TABS.map""",
    """        (CAPS.groups.Content === "edit" ? quickUploadHtml() : "") +
        '<section><div class="toolbar"><div class="chips">' + CREATE_TABS.map""", "quick upload panel")
rep('      $("cr-signals").onclick = function(){\n', '      wireQuickUpload();\n      $("cr-signals").onclick = function(){\n', "quick upload wiring")
rep("""      (x.kind === "song" ? '<div class="field"><label class="lbl" for="pa' + i + '">Artist name</label>""",
    """      (x.kind === "song" || x.kind === "beat" ? '<div class="field"><label class="lbl" for="pa' + i + '">Artist name</label>""", "artist field for beats")
rep("@media (prefers-reduced-motion:reduce){*{transition:none!important}}\n",
    ".qup.drag{outline:2px dashed var(--gold,#C9A227);outline-offset:4px}.qup .qup-row{display:block}.qup .qup-row .form{margin-bottom:6px}\n"
    "@media (prefers-reduced-motion:reduce){*{transition:none!important}}\n", "quick upload styles")
if "`" in QUICK or "${" in QUICK:
    raise SystemExit("quick upload code must not contain backticks or dollar-brace (ui.js is a String.raw template)")
p.write_text(s, encoding="utf-8")
print("rb-command: " + (", ".join(changed) + " updated" if changed else "quick upload already in place"))
