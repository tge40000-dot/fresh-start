"""yoshcoastmusic: the paid music model only for signed-in admins (code only).

Usage: python3 -I patch_yoshcoast_ai.py <pulled yoshcoastmusic dir>

relentlessbillionaire.com/yoshcoastmusic/api/generate ran MiniMax music-2.6 through the AI Gateway (a paid model) for
anyone, with no sign-in and no limit. It now asks for a signed-in admin (the site's own login, or its admin key), the
same check its experiment controls already use, and runs RB's built-in content filters on the prompt and lyrics
(rb-tools/ai_policy.js, copied in, with its defaults: this Worker's database is its own, so the owner's saved
AI limits in RB Command don't reach it). Every attempt is still recorded in its generation_events table, as before.
The page says why when a visitor presses Create. Running it twice changes nothing.
"""
import pathlib
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
folder = pathlib.Path(sys.argv[1])
shutil.copyfile(HERE.parent / "rb-tools" / "ai_policy.js", folder / "ai_policy.js")
p = folder / "worker.js"
s = p.read_text(encoding="utf-8")
changed = []


def rep(old, new, what):
    global s
    if new in s:
        return
    if s.count(old) != 1:
        raise SystemExit(f"yoshcoastmusic: {what}: anchor found {s.count(old)} times")
    s = s.replace(old, new)
    changed.append(what)


if 'import * as RBP from "./ai_policy.js";' not in s:
    s = 'import * as RBP from "./ai_policy.js";\n' + s
    changed.append("import")

rep("""  if (!prompt || prompt.length < 8) {
    return json({ error: 'Describe the sound you want in at least 8 characters.' }, 400);
  }
""", """  if (!prompt || prompt.length < 8) {
    return json({ error: 'Describe the sound you want in at least 8 characters.' }, 400);
  }
  // RB AI limits (patch_yoshcoast_ai.py): the paid music model is for signed-in admins only, and RB's built-in
  // content filters read the prompt and lyrics before anything is queued.
  if (!(await isAdmin(request, env))) {
    return json({ error: 'Making new music here is for the site admin. Sign in at ' + BASE_PATH + '/login.', needsLogin: true }, 401);
  }
  {
    const v = RBP.evaluate(RBP.DEFAULT_POLICY, { surface: 'forge', kind: 'music', prompt: prompt + (lyrics ? '\\n' + lyrics : '') });
    if (!v.ok) return json({ error: v.message, code: 'policy_' + v.code }, 400);
  }
""", "admin and filters")

if changed:
    p.write_text(s, encoding="utf-8")
    print("yoshcoastmusic: generate gated (" + ", ".join(changed) + ")")
else:
    print("yoshcoastmusic: already in place")
