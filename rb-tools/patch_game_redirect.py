"""relentlessbillionaire.com/game/ sends players to RB World (/app/world/), the same game on RB's own backend.

Usage: python3 -I patch_game_redirect.py <pulled rb-game dir>

rb-game serves the old game (Worker relentless-billionaire-game, through its GAME service binding). This adds one check
at the top of its fetch handler: the game page itself (/game, /game/, /game/index.html) answers with a 302 to
https://relentlessbillionaire.com/app/world/ (query string kept). Every other file under /game/ is served as before,
so RB World keeps loading its sounds from /game/assets/audio/. No route or binding changes; to undo, roll rb-game back.
Saved progress carries over: both pages are on relentlessbillionaire.com, so the game's localStorage is shared.
Running it twice changes nothing.
"""
import json
import pathlib
import sys

d = pathlib.Path(sys.argv[1])
if json.loads((d / "manifest.json").read_text())["script"] != "rb-game":
    raise SystemExit("patch_game_redirect.py is for rb-game")
p = d / "worker.js"
s = p.read_text(encoding="utf-8")
ANCHOR = "  async fetch(request, env) {\n    const res = await env.GAME.fetch(request);\n"
ADD = ("  async fetch(request, env) {\n"
       "    // 23 Oct 2026: the game page moved to RB World (/app/world/): the same game on RB's own backend instead of\n"
       "    // InstantDB. Its files (sounds, scripts) are still served from here.\n"
       "    { const u = new URL(request.url);\n"
       "      if ((request.method === \"GET\" || request.method === \"HEAD\") && /^\\/game\\/?(index\\.html)?$/.test(u.pathname)) {\n"
       "        return new Response(null, { status: 302, headers: { Location: \"https://relentlessbillionaire.com/app/world/\" + u.search, \"Cache-Control\": \"no-store\" } });\n"
       "      } }\n"
       "    const res = await env.GAME.fetch(request);\n")
if ADD in s:
    print("rb-game: redirect already in place")
else:
    if s.count(ANCHOR) != 1:
        raise SystemExit(f"rb-game: fetch anchor found {s.count(ANCHOR)} times")
    p.write_text(s.replace(ANCHOR, ADD), encoding="utf-8")
    print("rb-game: /game/ now sends players to RB World")
