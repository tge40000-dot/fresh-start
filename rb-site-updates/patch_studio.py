"""Add "Suggested settings" to RB Studio mastering (rb-mastering-studio): one-click Apply buttons built from the mix's
own measurements.

Usage: python3 -I patch_studio.py <pulled rb-mastering-studio dir>

After a mix is measured, the studio already lists notes (narrow stereo, quiet mix, MP3-like top end). This adds, under
those notes, a short list of settings worth trying, each with Apply and Undo. They are fixed rules on the numbers shown
(loudness, true peak, dynamics, stereo), not AI, and the box says so. Apply only moves a control on the page; nothing is
mastered until "Master it" is pressed, as before. Mastering still runs on the visitor's device.

Each anchor must match exactly once; running it twice changes nothing.
"""
import pathlib
import sys

folder = pathlib.Path(sys.argv[1])
apps = sorted(folder.glob("*-app.html"))
if len(apps) != 1:
    raise SystemExit(f"rb-mastering-studio: expected one *-app.html, found {len(apps)}")
p = apps[0]
s = p.read_text(encoding="utf-8")

EDITS = [
    ('.ins li.warn:before{background:var(--warn)}\n',
     '.ins li.warn:before{background:var(--warn)}\n'
     '.sugg{margin:16px 0 0;padding:14px 16px;border:1px solid var(--line);border-radius:12px;background:rgba(242,213,126,.04)}\n'
     '.sugg h4{margin:0 0 4px;font-size:11px;letter-spacing:.14em;color:var(--gold2)}\n'
     '.sugg p{margin:0 0 8px;font-size:12px;color:var(--dim)}\n'
     '.sugg ul{list-style:none;margin:0;padding:0}\n'
     '.sugg li{display:flex;align-items:center;gap:12px;padding:8px 0;border-top:1px solid var(--line);font-size:13px;color:var(--txt)}\n'
     '.sugg li span{flex:1}.sugg li.done span{color:var(--dim)}\n'),
    ('<ul class="ins" id="insights"></ul>\n',
     '<ul class="ins" id="insights"></ul>\n'
     '    <div class="sugg hide" id="sugg"><h4>SUGGESTED SETTINGS</h4><p>Rules on the measurements above, not AI. Apply only changes a setting below; nothing is mastered until you press Master it.</p><ul id="sugg-list"></ul></div>\n'),
    ("""    $("insights").innerHTML = ins.length ? ins.map(function (i) { return '<li class="' + i.level + '">' + esc(i.text) + "</li>"; }).join("") : '<li>Healthy mix: nothing to warn about.</li>';
  }
""",
     """    $("insights").innerHTML = ins.length ? ins.map(function (i) { return '<li class="' + i.level + '">' + esc(i.text) + "</li>"; }).join("") : '<li>Healthy mix: nothing to warn about.</li>';
    renderSuggestions(m);
  }

  // ---------------------------------------------------------------- suggested settings: fixed rules on the measurements, each with Apply / Undo
  function renderSuggestions(m) {
    var list = [], chip = function (box, attr, v) { var b = $(box).querySelector('.chip[' + attr + '="' + v + '"]'); if (b) b.click(); };
    var onChip = function (box, attr) { var b = $(box).querySelector(".chip.on"); return b ? b.getAttribute(attr) : null; };
    if (m.width < -20) list.push({ text: "Close to mono (correlation " + m.correlation.toFixed(2) + "). Widen the upper range to 140%; the bass stays centred.",
      get: function () { return [$("width").value, $("width").dataset.touched || ""]; },
      set: function (v) { var w = $("width"); w.value = v[0]; if (v[1]) w.dataset.touched = v[1]; else delete w.dataset.touched; w.nextElementSibling.textContent = (v[1] ? "" : "auto ") + Math.round(v[0] * 100) + "%"; },
      to: ["1.4", "1"] });
    if (m.lufs > -10) list.push({ text: "Already loud (" + m.lufs.toFixed(1) + " LUFS). Low intensity keeps what punch is left.",
      get: function () { return onChip("intensity", "data-v"); }, set: function (v) { chip("intensity", "data-v", v); }, to: "0.3" });
    if (m.plr > 14 && style !== "punchy") list.push({ text: "Very dynamic (" + m.plr.toFixed(1) + " dB peak to loudness). The Punchy character makes the drums hit harder once it's louder.",
      get: function () { return onChip("styles", "data-s"); }, set: function (v) { chip("styles", "data-s", v); }, to: "punchy" });
    if (m.truePeak > -0.5 && !$("safe-ceiling").checked) list.push({ text: "Peaks reach " + m.truePeak.toFixed(1) + " dBTP. Re-export the mix with about 3 dB of headroom if you can. Meanwhile, keep the streaming-safe ceiling on.",
      get: function () { return $("safe-ceiling").checked; }, set: function (v) { $("safe-ceiling").checked = v; }, to: true });
    var box = $("sugg"), ul = $("sugg-list");
    ul.textContent = "";
    box.classList.toggle("hide", !list.length);
    list.forEach(function (sg) {
      var li = document.createElement("li"), t = document.createElement("span"), b = document.createElement("button"), was = null;
      t.textContent = sg.text; b.className = "ghost"; b.type = "button"; b.textContent = "APPLY";
      b.onclick = function () {
        if (was === null) { was = sg.get(); sg.set(sg.to); b.textContent = "UNDO"; li.classList.add("done"); }
        else { sg.set(was); was = null; b.textContent = "APPLY"; li.classList.remove("done"); }
      };
      li.appendChild(t); li.appendChild(b); ul.appendChild(li);
    });
  }
"""),
]
changed = False
for old, new in EDITS:
    added = new[len(old):] if new.startswith(old) else None
    if new in s or (added and added in s):
        continue
    if s.count(old) != 1:
        raise SystemExit(f"rb-mastering-studio: anchor found {s.count(old)} times: {old[:60]!r}")
    s = s.replace(old, new)
    changed = True
if changed:
    p.write_text(s, encoding="utf-8")
    print("rb-mastering-studio: suggested settings added")
else:
    print("rb-mastering-studio: already in place")
