"""Add mobile clip/track delete and per-track plugins to RB Studio's browser DAW (rb-daw, relentlessbillionaire.com/record).

Usage: python3 -I patch_daw_plugins.py <pulled rb-daw dir>

1. Delete on phones. The Editor only said "delete with Delete", which a phone doesn't have, and the track x was hidden
   under 900 px. Every selected clip now gets a row of buttons above its editor: Duplicate, Split at playhead,
   Delete clip, Delete track (the existing "Delete X and its N clips?" confirm) and Plugins (opens that track's
   plugins in the Mixer). All go through the existing undo. The buttons are 40 px tall on touch screens, and the
   track x stays visible on small screens.
2. Plugins. Each mixer strip gets a collapsible "Plugins" section, all generic names, each OFF by default so saved
   songs sound exactly as before (old projects have no plugin keys and read the defaults):
     Noise gate (threshold) - Low cut (20-300 Hz, 24 dB/oct) - Air (11 kHz shelf) - Sibilance (split-band de-esser,
     5-9 kHz, threshold) - Comp mode (Standard / Punch fast / Smooth slow, same Comp knob) - Drive (Tape / Tube /
     Console, amount, mix, level matched, 4x oversampled) - Phone/Radio (300 Hz-3.4 kHz with grit) - Crunch (bits,
     sample-rate divider, low-pass) - Double (two detuned short delays, left/right, cancels in mono) - Verb mode
     (Classic / Plate / Room / Hall) and Echo timing (1/8 dotted / 1/4 / 1/8 / 1/16) on the shared sends.
   They are built in the engine's per-track graph, so live playback, Export WAV, stems and share renders all include
   them. Gate, Sibilance and Crunch's sample-rate part run in a new asset, fx-worklet.js, loaded in the live context
   and in each OfflineAudioContext (the page's CSP has no blob: scripts). If it can't load, Gate and Sibilance are
   bypassed, Crunch falls back to bit depth only, and everything else keeps working.
   Six vocal-chain presets join the preset menu: Hard Trap Lead, Melodic Hook, Boom-bap Rap, R&B Silk, Ad-lib Spice,
   Phone/Radio. Any preset now also resets the plugins first, so "Flat (no effects)" really is flat.

The plugin code lives in src/daw-plugins/ and is rewritten from there on every run. Assets are cached immutable by
?v=BUILD, so BUILD (in assets.js and in the worklet URLs in main.js) becomes a hash of the patched content.
Each anchor must match exactly once; running it twice changes nothing.
"""
import hashlib
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
SRC = HERE / "src" / "daw-plugins"
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
for name in ("main.js", "daw.css", "rec-worklet.js"):
    if name not in assets:
        raise SystemExit(f"rb-daw: {name} missing from ASSETS")

main = assets["main.js"]["body"]
css = assets["daw.css"]["body"]
if main.count(f".js?v={old_build}") < 1:
    raise SystemExit("rb-daw: worklet ?v=BUILD not found in main.js")
main = main.replace(f".js?v={old_build}", f".js?v={PH}")

BEGIN, END = "/* RB plugins begin */", "/* RB plugins end */"


def block(text, src, anchor, label):
    """Insert (or refresh) src between BEGIN/END markers placed right before anchor."""
    code = BEGIN + "\n" + src.strip() + "\n" + END + "\n"
    if BEGIN in text:
        a, rest = text.split(BEGIN, 1)
        _, b = rest.split(END + "\n", 1)
        return a + code + b, ("refreshed " if a + code + b != text else "") + label
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
plug_js = (SRC / "plugins.js").read_text(encoding="utf-8")
main, msg = block(main, plug_js, "function Vn(t,e){", "engine+UI block")
log.append(msg)
main, done = edits(main, [
    ("track inserts",
     "n.input.connect(n.low).connect(n.mid).connect(n.high).connect(n.comp).connect(n.vol).connect(n.pan),n.pan.connect(this.master.input),",
     "rbChain(this,n),n.vol.connect(n.pan),n.pan.connect(this.master.input),"),
    ("apply params",
     "s(a.del.gain,e.fx.delay*.8)}synth(e){",
     "s(a.del.gain,e.fx.delay*.8),rbApply(this,a,e,n)}synth(e){"),
    ("synced echo bpm",
     "setBpm(e){this.delay.delayTime.setTargetAtTime(",
     "setBpm(e){rbSetBpm(this,e),this.delay.delayTime.setTargetAtTime("),
    ("removed-track cleanup",
     "s.pan.disconnect(),this.tracks.delete(o)",
     "s.pan.disconnect(),rbKill(s),this.tracks.delete(o)"),
    ("offline worklet",
     ",u=new Ht(d);return u.sync(t,n),",
     ",u=(await rbFxLoad(d),new Ht(d));return u.sync(t,n),"),
    ("live worklet",
     "this.ready=this.loadRecorder()),await this.ready",
     "this.ready=this.loadRecorder(),rbFxLoad(this.ctx).then(()=>this.sync())),await this.ready"),
    ("vocal presets",
     'flat:{label:"Flat (no effects)",fx:{low:0,mid:0,high:0,comp:0,reverb:0,delay:0},volume:.8}};',
     'flat:{label:"Flat (no effects)",fx:{low:0,mid:0,high:0,comp:0,reverb:0,delay:0},volume:.8},...RBPRESETS};'),
    ("preset resets plugins",
     "Object.assign(n.fx,a.fx)",
     "Object.assign(n.fx,RBFX,a.fx)"),
    ("mixer plugins",
     'a("Delay",0,1,.01,()=>n.fx.delay,o=>n.fx.delay=o),',
     'a("Delay",0,1,.01,()=>n.fx.delay,o=>n.fx.delay=o),rbPlug(n),'),
    ("editor clip tools",
     "return t.c.pattern?pa(t.t,t.c):t.c.notes?ha(t.t,t.c):fa(t.t,t.c)}",
     'return l("div",{},rbClipBar(t),t.c.pattern?pa(t.t,t.c):t.c.notes?ha(t.t,t.c):fa(t.t,t.c))}'),
    ("hint text",
     "duplicate with Ctrl+D, delete with Delete.",
     "duplicate with Ctrl+D, delete with Delete, or use the buttons above."),
], "main.js")
log += done

css, done = edits(css, [
    ("mobile track x",
     "  .head .l2 .mini.x{display:none}\n",
     "  .head .l2 .mini.x{display:inline-block}\n"),
], "daw.css")
log += done
plug_css = (SRC / "plugins.css").read_text(encoding="utf-8")
css, msg = block(css, plug_css, ".strip select,.ph select{max-width:100%}", "plugins css")
log.append(msg)

worklet = (SRC / "fx-worklet.js").read_text(encoding="utf-8")
if assets.get("fx-worklet.js", {}).get("body") != worklet:
    log.append(("refreshed " if "fx-worklet.js" in assets else "added ") + "fx-worklet.js")
assets["main.js"]["body"] = main
assets["daw.css"]["body"] = css
assets["fx-worklet.js"] = {"type": "text/javascript; charset=utf-8", "body": worklet}

# BUILD = hash of every asset (with the placeholder) and the shell, so the same input always gives the same BUILD.
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
        if m.startswith(("applied", "added", "refreshed")):
            print("rb-daw:", m)
    print(f"rb-daw: BUILD {old_build} -> {h}")
else:
    print(f"rb-daw: already in place (BUILD {h})")
