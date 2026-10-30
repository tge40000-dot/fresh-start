"""The mastering studio (/studio/, RB Create's Master tab) survives a long wait in the file picker (code only).

Usage: python3 -I patch_studio_pick.py <pulled rb-mastering-studio dir>

On a phone, the file picker sends the browser to the background. If the picker stays open a while (scrolling
through folders, a cloud drive downloading the file), the phone may close the page to free memory and reload it
when the browser comes back. The picked file is then lost and the upload looks like it "timed out". Desktop
browsers don't do this: a pick after 2.5 minutes in the picker loads normally.

What changes:
- The studio notes when a picker is opened (the mix, the reference track, a vault upload) in this tab's session
  storage and clears the note when a file arrives or the picker is cancelled. If the page loads with the note still
  there, the browser reloaded it mid-pick, so the page says so in the right place and asks for the file again, with
  the tip that avoids it (save the file on the device first).
- The picked file is read straight away. A read refused by the phone (common right after a cloud drive hands a file
  over) is tried twice more before a plain-words message.
Running it twice changes nothing.
"""
import pathlib
import sys

d = pathlib.Path(sys.argv[1])
apps = [p for p in d.iterdir() if p.name.endswith("-app.html")]
if len(apps) != 1:
    raise SystemExit(f"rb-mastering-studio: expected one *-app.html, found {len(apps)}")
p = apps[0]
s = p.read_text(encoding="utf-8")
MARK = "/* rb studio pick guard */"
if MARK in s:
    print("rb-mastering-studio: pick guard already in place")
    sys.exit(0)


def rep(old, new):
    global s
    if s.count(old) != 1:
        raise SystemExit(f"rb-mastering-studio: anchor found {s.count(old)} times: {old[:80]!r}")
    s = s.replace(old, new)


rep('''  drop.onclick = function () { $("file").click(); };
  drop.onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("file").click(); } };''',
    '''  ''' + MARK + '''
  // A phone may close and reload the page while its file picker is open (to free memory), losing the pick. Note each
  // open picker in this tab's session; a page that loads with the note still there was reloaded mid-pick.
  var PICK = "rb_studio_picking";
  function picking(which) { try { if (which) sessionStorage.setItem(PICK, which + "|" + Date.now()); else sessionStorage.removeItem(PICK); } catch (e) {} }
  function openPicker(id, which) { picking(which); $(id).click(); }
  ["file", "ref-file", "v-file"].forEach(function (id) { $(id).addEventListener("cancel", function () { picking(""); }); });
  var LOST = "Your browser reloaded this page while the file picker was open (phones do this to free memory), so the file didn't arrive. Pick it again. Tip: save the file on the device first; picking from a cloud drive takes longer.";
  (function () {
    var v = ""; try { v = sessionStorage.getItem(PICK) || ""; } catch (e) {}
    var at = +v.split("|")[1] || 0, which = v.split("|")[0]; picking("");
    if (!at || Date.now() - at > 3 * 3600000) return;
    var show = function () { var box = which === "ref" ? $("ref-status") : which === "vault" ? $("v-status") : $("load-status"); if (box) box.textContent = LOST; };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", show); else show();
  })();
  // Read the picked file at once; a phone sometimes refuses the first read of a file a cloud drive just handed over.
  function readFile(file, tries) {
    return file.arrayBuffer().catch(function (e) {
      var refused = e && /NotReadable|NotFound|Abort/.test(e.name || "");
      if (refused && tries > 0) return new Promise(function (r) { setTimeout(r, 800); }).then(function () { return readFile(file, tries - 1); });
      throw refused ? new Error("The phone didn't hand the file over. Save it on the device (not only in a cloud drive) and pick it again.") : e;
    });
  }
  drop.onclick = function () { openPicker("file", "mix"); };
  drop.onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPicker("file", "mix"); } };''')
rep('''  $("file").onchange = function () { if (this.files[0]) loadFile(this.files[0]); this.value = ""; };''',
    '''  $("file").onchange = function () { picking(""); if (this.files[0]) loadFile(this.files[0]); this.value = ""; };''')
rep('''  function decode(file) {
    return file.arrayBuffer().then(function (ab) { return audioCtx().decodeAudioData(ab); });''',
    '''  function decode(file) {
    return readFile(file, 2).then(function (ab) { return audioCtx().decodeAudioData(ab); });''')
rep('''    }).catch(function (err) { $("load-status").textContent = "Couldn't read that file: " + (err && err.message || err) + " Try WAV or MP3."; });''',
    '''    }).catch(function (err) { var m = err && err.message || String(err); $("load-status").textContent = /phone didn't hand/.test(m) ? m : "Couldn't read that file: " + m + " Try WAV or MP3."; });''')
rep('''  $("ref-btn").onclick = function () { $("ref-file").click(); };''', '''  $("ref-btn").onclick = function () { openPicker("ref-file", "ref"); };''')
rep('''  $("ref-file").onchange = function () {
    var f = this.files[0]; this.value = ""; if (!f) return;''', '''  $("ref-file").onchange = function () {
    picking(""); var f = this.files[0]; this.value = ""; if (!f) return;''')
rep('''      .catch(function () { $("ref-status").textContent = "Couldn't read that reference."; });''',
    '''      .catch(function (e) { $("ref-status").textContent = e && /phone didn't hand/.test(e.message) ? e.message : "Couldn't read that reference."; });''')
rep('''  $("v-upload-btn").onclick = function () { $("v-file").click(); };
  $("v-file").onchange = function () {
    var f = this.files[0]; this.value = ""; if (!f) return;''', '''  $("v-upload-btn").onclick = function () { openPicker("v-file", "vault"); };
  $("v-file").onchange = function () {
    picking(""); var f = this.files[0]; this.value = ""; if (!f) return;''')
p.write_text(s, encoding="utf-8")
print("rb-mastering-studio: pick guard added")
