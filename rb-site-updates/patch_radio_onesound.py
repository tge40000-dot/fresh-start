"""One RB sound at a time, across tabs and tools: the radio bar never plays over a video, a beat or the studio.

Usage: python3 -I patch_radio_onesound.py <pulled rb-radio dir>   (after patch_radio.py and patch_radio_flow.py)

/radio/embed.js (the radio bar every RB site loads) already pauses the radio when audio or video on the same page starts
making sound, and pauses that page's audible media when the radio starts. What it couldn't see:
- another RB tab or frame on the same site (a video on RB TV in one tab, the radio in another);
- the studio and other Web Audio tools, which play through an AudioContext, not an <audio> element.
This adds one BroadcastChannel, "rb-sound". Whenever the radio starts, or an audible <audio>/<video> starts on an RB
page, that page posts {t:"claim"}; every other RB page on the site pauses its radio and its audible media. The studio
(workers/rb-daw: rbClaimSound) posts the same claim when it plays or records, and any page can dispatch the window event
"rbsound:claim" to do the same. Muted loops (hero videos) never claim. Nothing else about the radio changes.
deploy-all.sh still skips rb-radio while a live show is on air. Running it twice changes nothing.
"""
import json
import pathlib
import re
import sys

p = pathlib.Path(sys.argv[1]) / "index.js"
s = p.read_text(encoding="utf-8")
m = re.search(r'const EMBED_JS = ("(?:[^"\\]|\\.)*");', s)
if not m:
    raise SystemExit("rb-radio: EMBED_JS not found")
js = json.loads(m.group(1))
MARK = "  /* One RB sound at a time (patch_radio_onesound.py)"
BLOCK = (
    MARK + ": a claim from another RB tab, frame or tool pauses this page's radio and its audible\n"
    "     media; this page claims whenever its radio or an audible <audio>/<video> starts. See \"rbsound:claim\" too. */\n"
    "  var soundId = Math.random().toString(36).slice(2), soundChan = null;\n"
    "  try { soundChan = new BroadcastChannel(\"rb-sound\"); } catch (e) {}\n"
    "  function claimSound() { if (soundChan) { try { soundChan.postMessage({ t: \"claim\", from: soundId }); } catch (e) {} } }\n"
    "  function stepAside() { if (st.playing) api.pause(); pauseOthers(); }\n"
    "  if (soundChan) soundChan.onmessage = function (ev) { var d = ev && ev.data; if (d && d.t === \"claim\" && d.from !== soundId) stepAside(); };\n"
    "  function mediaSound(ev) { var t = ev.target; if (t && t !== audio && (t.tagName === \"AUDIO\" || t.tagName === \"VIDEO\") && !t.paused && audible(t)) claimSound(); }\n"
    "  document.addEventListener(\"play\", mediaSound, true);\n"
    "  document.addEventListener(\"volumechange\", mediaSound, true);\n"
    "  window.addEventListener(\"rbsound:claim\", function () { if (st.playing) api.pause(); claimSound(); });\n"
)
ANCHOR = '  document.addEventListener("volumechange", otherSound, true);\n'
OLD_PLAY = "      clearTimeout(retryT); retries = 0; pauseOthers();\n"
NEW_PLAY = "      clearTimeout(retryT); retries = 0; pauseOthers(); claimSound();\n"
changed = []
if MARK not in js:
    if js.count(ANCHOR) != 1:
        raise SystemExit("rb-radio: embed.js volumechange anchor")
    js = js.replace(ANCHOR, ANCHOR + BLOCK)
    changed.append("channel")
if NEW_PLAY not in js:
    if js.count(OLD_PLAY) != 1:
        raise SystemExit("rb-radio: embed.js api.play anchor")
    js = js.replace(OLD_PLAY, NEW_PLAY)
    changed.append("radio claims on play")
if changed:
    s = s[: m.start(1)] + json.dumps(js, ensure_ascii=False) + s[m.end(1):]
    p.write_text(s, encoding="utf-8")
print("rb-radio: one sound " + (", ".join(changed) + " added" if changed else "already in place"))
