"""RB Studio (rb-daw, studio.relentlessbillionaire.com): recording that ends cleanly, and a resizable track area.

Usage: python3 -I patch_daw_record_fix.py <pulled rb-daw dir>      (after patch_daw_plugins.py)

1. Recording. After Stop, a take that captured nothing (no input signal, or stopped during the count-in) said
   "Nothing was recorded" but left the red "Recording..." marker on the track, because only the transport was
   redrawn. Stop now redraws the track lanes too. If recording fails to start, the input monitor (the headphones
   button, which feeds back through speakers) is switched off again and the marker cleared. Opening another song
   while recording first stops and keeps the take, instead of leaving the recorder and monitor running.
2. Track area. A bar between the tracks and the Editor/Mixer panel: drag it (or focus it and use the arrow keys)
   to give the tracks more room, double-click it (or press Enter) to fold the panel down to its tabs and show every
   track; picking a tab opens the panel again. The height is remembered on this device.
Assets are cached immutable by ?v=BUILD, so BUILD is re-hashed the same way patch_daw_plugins.py does it.
Each anchor must match exactly once; running it twice changes nothing.
"""
import hashlib
import json
import pathlib
import re
import sys

folder = pathlib.Path(sys.argv[1])
p = folder / "assets.js"
s = p.read_text(encoding="utf-8")
PH = "__RB_BUILD__"

bm = re.findall(r'^export const BUILD = "([0-9a-f]{6,40})";$', s, re.M)
if len(bm) != 1:
    raise SystemExit(f"rb-daw: expected one BUILD, found {len(bm)}")
old_build = bm[0]
key = "export const ASSETS = "
if s.count(key) != 1 or not s.endswith(";\n"):
    raise SystemExit("rb-daw: ASSETS literal not where expected")
head, body = s.split(key)
assets = json.loads(body[:-2])
main = assets["main.js"]["body"].replace(f".js?v={old_build}", f".js?v={PH}")
css = assets["daw.css"]["body"]

BEGIN, END = "/* RB studio fixes begin */", "/* RB studio fixes end */"
SPLIT_JS = r'''
// Resizable track area: a bar above the Editor/Mixer panel. The panel height lives in --rb-panel-h on <body>.
function rbSplit() {
  let pan = document.querySelector(".panel"), b = document.body;
  if (!pan || document.querySelector(".rb-split")) return;
  let bar = document.createElement("div"), K = "rbdaw.panelH", FOLD = 42, last = 300;
  bar.className = "rb-split", bar.tabIndex = 0, bar.setAttribute("role", "separator"), bar.setAttribute("aria-orientation", "horizontal");
  bar.setAttribute("aria-label", "Resize the track area"), bar.title = "Drag to resize. Double-click to show every track.";
  pan.before(bar), b.classList.add("rb-has-split");
  let max = () => Math.max(FOLD, innerHeight - 220),
    cur = () => pan.getBoundingClientRect().height,
    set = (h, keep) => {
      h = Math.round(Math.min(max(), Math.max(FOLD, h)));
      b.style.setProperty("--rb-panel-h", h + "px"), b.classList.toggle("rb-folded", h <= FOLD + 4);
      bar.setAttribute("aria-valuenow", String(h)), bar.setAttribute("aria-valuemin", String(FOLD)), bar.setAttribute("aria-valuemax", String(max()));
      h > FOLD + 4 && (last = h);
      if (keep !== !1) try { localStorage.setItem(K, String(h)); } catch {}
    },
    fold = () => set(cur() <= FOLD + 4 ? Math.max(last, 200) : FOLD);
  try { let v = +localStorage.getItem(K); v > 0 && set(v, !1); } catch {}
  bar.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault(), bar.setPointerCapture(e.pointerId), b.classList.add("rb-resizing");
    let y0 = e.clientY, h0 = cur(),
      mv = (ev) => set(h0 + (y0 - ev.clientY)),
      up = () => { bar.removeEventListener("pointermove", mv), bar.removeEventListener("pointerup", up), bar.removeEventListener("pointercancel", up), b.classList.remove("rb-resizing"); };
    bar.addEventListener("pointermove", mv), bar.addEventListener("pointerup", up), bar.addEventListener("pointercancel", up);
  });
  bar.addEventListener("dblclick", fold);
  bar.addEventListener("keydown", (e) => {
    let d = e.key === "ArrowUp" ? 24 : e.key === "ArrowDown" ? -24 : 0;
    d ? (e.preventDefault(), set(cur() + d)) : (e.key === "Enter" || e.key === " ") && (e.preventDefault(), fold());
  });
  pan.querySelector(".tabs") && pan.querySelector(".tabs").addEventListener("click", () => { b.classList.contains("rb-folded") && set(Math.max(last, 200)); });
  addEventListener("resize", () => { b.style.getPropertyValue("--rb-panel-h") && cur() > max() && set(max(), !1); });
}
'''
SPLIT_CSS = """
/* Resizable track area (patch_daw_record_fix.py) */
body.rb-has-split{grid-template-rows:auto auto minmax(120px,1fr) auto auto auto}
body.rb-has-split .panel{height:var(--rb-panel-h,300px)}
body.rb-folded .panel-body{display:none}
.rb-split{height:10px;cursor:row-resize;touch-action:none;background:var(--panel);border-top:1px solid var(--line);position:relative}
.rb-split::after{content:"";position:absolute;left:50%;top:3px;width:44px;height:3px;margin-left:-22px;border-radius:2px;background:var(--line)}
.rb-split:hover::after,.rb-split:focus-visible::after,body.rb-resizing .rb-split::after{background:var(--accent,currentColor)}
.rb-split:focus-visible{outline:2px solid var(--accent,currentColor);outline-offset:-2px}
body.rb-resizing{cursor:row-resize;user-select:none}
@media (max-width:900px){body.rb-has-split .panel{height:var(--rb-panel-h,240px)}}
@media (pointer:coarse){.rb-split{height:18px}.rb-split::after{top:7px}}
"""


def block(text, src, anchor, label):
    code = BEGIN + "\n" + src.strip() + "\n" + END + "\n"
    if BEGIN in text:
        a, rest = text.split(BEGIN, 1)
        _, b2 = rest.split(END + "\n", 1)
        return a + code + b2, ("refreshed " if a + code + b2 != text else "") + label
    if text.count(anchor) != 1:
        raise SystemExit(f"rb-daw: {label}: anchor found {text.count(anchor)} times: {anchor[:60]!r}")
    return text.replace(anchor, code + anchor), "applied " + label


def edits(text, items, what):
    done = []
    for label, old, new in items:
        if new in text:
            continue
        if text.count(old) != 1:
            raise SystemExit(f"rb-daw: {what} {label}: anchor found {text.count(old)} times: {old[:60]!r}")
        text = text.replace(old, new)
        done.append("applied " + label)
    return text, done


log = []
main, msg = block(main, SPLIT_JS, "function Vn(t,e){", "track area resizer")
log.append(msg)
main, done = edits(main, [
    ("stop clears the recording marker",
     'let e=await g.stopRecording(r.p.latencyMs||0);if(R("transport"),!e)',
     'let e=await g.stopRecording(r.p.latencyMs||0);if(R("transport"),R("lanes"),!e)'),
    ("failed start turns the monitor off",
     "catch(o){g.recording=!1,g.stop();",
     'catch(o){g.recording=!1,g.stop(),g.setMonitor(null),r.recordingClip=null,R("lanes");'),
    ("opening a song stops recording first",
     "async function yt(t){mt&&(",
     "async function yt(t){g.recording&&await bt(),mt&&("),
    ("resizer wiring",
     'function qa(){k("#t-play")',
     'function qa(){rbSplit(),k("#t-play")'),
], "main.js")
log += done
if BEGIN in css:
    a, rest = css.split(BEGIN, 1)
    _, b2 = rest.split(END + "\n", 1)
    new_css = a + BEGIN + "\n" + SPLIT_CSS.strip() + "\n" + END + "\n" + b2
    if new_css != css:
        log.append("refreshed track area css")
    css = new_css
else:
    css = css + "\n" + BEGIN + "\n" + SPLIT_CSS.strip() + "\n" + END + "\n"
    log.append("applied track area css")

assets["main.js"]["body"] = main
assets["daw.css"]["body"] = css
# BUILD = hash of every asset (with the placeholder) and the shell, exactly as patch_daw_plugins.py computes it.
shell = head.split("\n", 2)[2]
h = hashlib.sha256((shell + json.dumps(assets, sort_keys=True)).encode()).hexdigest()[:12]
assets["main.js"]["body"] = main.replace(PH, h)
if PH in json.dumps(assets) or PH in head:
    raise SystemExit("rb-daw: build placeholder left behind")
new_head = head.replace(f'export const BUILD = "{old_build}";', f'export const BUILD = "{h}";')
out = new_head + key + json.dumps(assets, separators=(",", ":")) + ";\n"
if out != s:
    p.write_text(out, encoding="utf-8")
    for m in log:
        if m.startswith(("applied", "refreshed")):
            print("rb-daw:", m)
    print(f"rb-daw: BUILD {old_build} -> {h}")
else:
    print(f"rb-daw: recording fix already in place (BUILD {h})")
