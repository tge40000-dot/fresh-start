"""rb-game after the 26 Oct 2026 rebuild (an outside tool added a "/game/api" backend to it): put back what the rebuild
dropped and close what it left open. RB World (/app/world/) is the game; its API is /api/world/* on artist-router,
with sign-in, device keys and server checks, so the extra API's ideas live there now (Empire Nodes, deals, ...).

Usage: python3 -I patch_rb_game_api.py <pulled rb-game dir>

  - The page helpers the rebuild lost (fixCsp, GAME_HEAD, GAME_ONLINE_STATUS, isGamePage, from rb_game_page.js): without
    them any HTML page the old game serves under /game/ fails. They go back in.
  - /game/api/health still answers (anything that checks it keeps working); every other /game/api/ path now answers 410
    with where the game is. Those endpoints had no sign-in (any X-Player-Id), so anyone could write player rows and
    claim territories.
  - Territory alarms: a claimed territory used to wake every minute forever. The alarm now ends itself and never
    reschedules, so the ones already set stop after one more run. Both Durable Object classes stay exported: the
    Worker's bindings name them, and removing them would need a migration.
Bindings, routes and stored data are left as they are. Running it twice changes nothing.
"""
import json
import pathlib
import re
import sys

d = pathlib.Path(sys.argv[1])
man = json.loads((d / "manifest.json").read_text())
if man["script"] != "rb-game":
    raise SystemExit("patch_rb_game_api.py is for rb-game")
p = d / man["entry"]
s = p.read_text(encoding="utf-8")
if "async function handleGameApi" not in s:
    print("rb-game: no /game/api code, nothing to do")
    raise SystemExit(0)
MARK = "// rb-game's page helpers (from version 88c5d874"
changed = []
if "function isGamePage" not in s:
    helpers = (pathlib.Path(__file__).with_name("rb_game_page.js")).read_text(encoding="utf-8")
    anchor = "async function handleGameApi(request, env) {"
    if s.count(anchor) != 1:
        raise SystemExit("rb-game: handleGameApi anchor not found once")
    s = s.replace(anchor, helpers + anchor, 1)
    changed.append("page helpers back")
GONE = "RB World's game API moved"
if GONE not in s:
    a = s.index("async function handleGameApi(request, env) {")
    b = s.index("\n}\n", a) + 3
    s = s[:a] + '''async function handleGameApi(request, env) {
  // 28 Oct 2026: the game is RB World (/app/world/), with its own API (/api/world/*, signed in or with this device's
  // key). This one had no sign-in, so only the health check is left.
  const path = new URL(request.url).pathname.replace(/^\\/game\\/api\\//, "/api/");
  if (path === "/api/health") return Response.json({ status: "ok", game: "Relentless Billionaire", integrated: true });
  return Response.json({ ok: false, error: "RB World's game API moved: play at https://relentlessbillionaire.com/app/world/" }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
''' + s[b:]
    changed.append("open /game/api endpoints closed (health kept)")
if "the alarm ends here" not in s:
    m = re.search(r"\n  // Alarm fires only for territories that have an owner\n  async alarm\(\) \{.*?\n  \}\n", s, re.S)
    if not m:
        m = re.search(r"\n  async alarm\(\) \{.*?setAlarm\(Date\.now\(\) \+ 6e4\);\n  \}\n", s, re.S)
    if not m:
        raise SystemExit("rb-game: Territory.alarm not found")
    s = s[:m.start()] + '''
  // the alarm ends here: territories no longer earn every minute (see patch_rb_game_api.py)
  async alarm() {
    try { await this.ctx.storage.deleteAlarm(); } catch (_) {}
  }
''' + s[m.end():]
    changed.append("territory alarms stop")
if not changed:
    print("rb-game: /game/api already closed")
else:
    p.write_text(s, encoding="utf-8")
    print("rb-game: " + ", ".join(changed))
