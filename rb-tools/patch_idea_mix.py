"""AI Forge ideas follow what RB TV viewers actually watch (rb-autopilot, creative.js).

Usage: python3 -I patch_idea_mix.py <pulled rb-autopilot dir>

The daily ideas used to rotate evenly (beat, song, video). Now, when RB TV's own watch data (the last 28 days, the
same numbers shown with every idea) says shorts hold people at least 1.5 times as well as other videos, the day's mix
leads with a short and gives the third slot to a second short every other day:
  3 ideas: short, beat, then song or short on alternate days (over two days: 3 shorts, 2 beats, 1 song, not 2/2/2).
With no plays yet, or once the gap closes, it goes back to the even rotation by itself. A mix asked for by name
(kinds) is left as asked. Running it twice changes nothing.
"""
import pathlib
import sys

p = pathlib.Path(sys.argv[1]) / "creative.js"
s = p.read_text(encoding="utf-8")
MARK = "function ideaMix("
if MARK in s:
    print("rb-autopilot: idea mix already follows RB TV watch data")
    raise SystemExit(0)

old_sig = 'export async function propose(env, { count = 3, kinds = KINDS } = {}) {\n  const s = await signals(env);\n  const facts = describeSignals(s);\n  const want = Array.from({ length: count }, (_, i) => kinds[i % kinds.length]);\n'
new_sig = 'export async function propose(env, { count = 3, kinds } = {}) {\n  const s = await signals(env);\n  const facts = describeSignals(s);\n  const want = kinds ? Array.from({ length: count }, (_, i) => kinds[i % kinds.length]) : ideaMix(s, count);\n'
assert s.count(old_sig) == 1, "rb-autopilot: propose() isn't what it was"
helper = '''// How well a set of RB TV videos holds people: the share of each video watched, averaged over its plays.
function heldShare(list) {
  let sec = 0, len = 0;
  for (const v of list) if (v.plays > 0 && v.duration_s > 0) { sec += v.seconds; len += v.plays * v.duration_s; }
  return len > 0 ? sec / len : null;
}
// The day's mix of kinds. Even (beat, song, video) unless RB TV's watch data says shorts hold people at least 1.5x as
// well as other videos: then a short leads and, every other day, the third slot is a second short instead of a song.
export function ideaMix(s, count, day = Math.floor(Date.now() / 864e5)) {
  const vids = (s && s.rb && s.rb.videos) || [];
  const shorts = heldShare(vids.filter((v) => v.kind === "short")), others = heldShare(vids.filter((v) => v.kind !== "short"));
  const lean = shorts != null && others != null && others > 0 && shorts >= others * 1.5;
  const order = lean ? (day % 2 ? ["video", "beat", "video", "song"] : ["video", "beat", "song", "video"]) : KINDS;
  return Array.from({ length: count }, (_, i) => order[i % order.length]);
}

'''
s = s.replace(old_sig, helper + new_sig, 1)
p.write_text(s, encoding="utf-8")
print("rb-autopilot: idea mix follows RB TV watch data")
