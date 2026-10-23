"""RB Badge in a pulled artist-router Worker: the member pass at relentlessbillionaire.com/badge.

Usage: python3 -I patch_badge.py <pulled artist-router dir>

Adds, after the RB Collect block (patch_rewards.py, whose helpers it reuses):
- GET /badge          the pass: sign in with Clerk, see points, level, perks, achievements, rewards and the door QR
- GET /badge/terms    the terms, built from the live values (always visible so they can be reviewed before launch)
- GET /app            the RB app (installable): pass, RB Gold Rush (the game that earns points), rewards, events, me
- GET /app/manifest.webmanifest
- GET /app/world/     RB World, the 3D city game (src/world/), on RB's own backend instead of InstantDB:
  POST /api/world/beat and /api/world/chat, GET /api/world/ads (src/world/world-worker.js)
- GET /api/badge/state, GET /api/badge/me, GET /api/badge/pass, POST /api/badge/redeem,
  POST /api/badge/game/start and /api/badge/game/finish (scores checked against the round's plan, src/badge/goldrush.js)
Points are pulled read-only by the member's verified email (or account) from signups, shop_inquiries, store_orders
(paid), DONOR_DB contributions, studio_memberships, record_submissions, rb_event_submissions and reward_claims, each
with a unique source_ref; door check-ins and hand adjustments come from RB Command's badge desk. Tables are created on
first use (src/badge/schema.sql). It ships switched off: until the owner sets "RB Badge switched on" to on in RB Command
(with at least one live level), /badge says coming soon and the API refuses. Running it twice changes nothing.
"""
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
folder = pathlib.Path(sys.argv[1])
p = folder / "artist-router-v14.js"
s = p.read_text(encoding="utf-8")
src = HERE / "src/badge"
page = (src / "badge.html").read_text(encoding="utf-8")
code = (src / "badge-worker.js").read_text(encoding="utf-8")
sql = (src / "schema.sql").read_text(encoding="utf-8")
qr = (HERE.parent / "rb-tools/vendor/qrcode-generator-2.0.4.js").read_text(encoding="utf-8")
goldrush = (src / "goldrush.js").read_text(encoding="utf-8")
app = (src / "app.html").read_text(encoding="utf-8")
loader = re.search(r'^<script nonce="__NONCE__">\(function\(\)\{function script\(.*$', page, re.M)
if not loader or app.count("<!--CLERK-LOADER-->") != 1 or app.count("/*GOLDRUSH*/") != 1:
    raise SystemExit("app.html: needs one <!--CLERK-LOADER--> and one /*GOLDRUSH*/, and badge.html its Clerk loader")
app = app.replace("<!--CLERK-LOADER-->", loader.group(0)).replace("/*GOLDRUSH*/", goldrush.rstrip("\n"))
wsrc = HERE / "src/world"
world = (wsrc / "index.html").read_text(encoding="utf-8")
if world.count("<!--CLERK-LOADER-->") != 1 or "__CLERK_KEY__" not in world or 'data-rbtabs="off"' not in world:
    raise SystemExit("src/world/index.html: needs the Clerk placeholders and data-rbtabs=\"off\"")
# The world page has no nonce: its own script tags carry none, and its CSP allows inline scripts as the game always has.
world = world.replace("<!--CLERK-LOADER-->", loader.group(0).replace(' nonce="__NONCE__"', ""))
world_main = (wsrc / "main.js").read_text(encoding="utf-8")
# Every game module in src/world (main.js, rb_world.js, empire.js, ...) is served at /app/world/<name>.js.
world_files = {f.name: f.read_text(encoding="utf-8") for f in sorted(wsrc.glob("*.js")) if f.name != "world-worker.js"}
world_code = (wsrc / "world-worker.js").read_text(encoding="utf-8")
# the game's sounds (src/world/audio/*.mp3), served at /app/world/audio/<name>.mp3
import base64
world_audio = {f.name: base64.b64encode(f.read_bytes()).decode("ascii") for f in sorted((wsrc / "audio").glob("*.mp3"))}
world_defs = world_files["empire_defs.js"]
# The server uses the same lot, district and business tables as the game, inside a namespace (RBE) so names like LOTS
# can't clash with anything else in artist-router.
defs_names = re.findall(r"^export (?:const|function) (\w+)", world_defs, re.M)
rbe_block = ("const RBE = (function () {\n" + re.sub(r"^export ", "", world_defs, flags=re.M).rstrip("\n")
             + "\nreturn { " + ", ".join(defs_names) + " };\n})();\n")
if "@instantdb" in world_main or "instantdb" in world.lower():
    raise SystemExit("src/world: InstantDB is still referenced")
for ph in ("__NONCE__", "__STATUS__", "__STATE__", "__CLERK_KEY__"):
    if ph not in page or ph not in app:
        raise SystemExit(f"badge.html or app.html: missing {ph}")
statements = [x.strip() for x in re.split(r";\s*\n", "\n".join(l for l in sql.splitlines() if not l.startswith("--"))) if x.strip()]
if len(statements) < 14:
    raise SystemExit(f"schema.sql: expected the table and seed statements, found {len(statements)}")
COLLECT_END = "// ---------------------------------------------------------------- end RB Collect\n"
if COLLECT_END not in s:
    raise SystemExit("artist-router: RB Collect isn't there yet; run patch_rewards.py first (RB Badge reuses its helpers)")
changed = []

START = "// ---------------------------------------------------------------- RB Badge (/badge)\n"
END = "// ---------------------------------------------------------------- end RB Badge\n"
# The QR encoder is a plain script that defines `qrcode`; keep it private to this block.
qr_block = "const rbbQrcode = (function () {\n" + qr.rstrip("\n") + "\nreturn qrcode;\n})();\n"
block = (START + "const RB_BADGE_HTML = " + json.dumps(page) + ";\n" + "const RB_APP_HTML = " + json.dumps(app) + ";\n"
         + "const RB_BADGE_SCHEMA = " + json.dumps(statements) + ";\n" + qr_block + goldrush.rstrip("\n") + "\n" + code.rstrip("\n") + "\n"
         + "const RB_WORLD_HTML = " + json.dumps(world) + ";\nconst RB_WORLD_FILES = " + json.dumps(world_files) + ";\nconst RB_WORLD_AUDIO = " + json.dumps(world_audio) + ";\n" + rbe_block
         + world_code.rstrip("\n") + "\n" + END)

if START in s:
    a = s.index(START); b = s.index(END) + len(END)
    if s[a:b] != block:
        s = s[:a] + block + s[b:]; changed.append("RB Badge updated")
else:
    s = s.replace(COLLECT_END, COLLECT_END + block, 1); changed.append("RB Badge block")

ROUTE_OLD = "    if ((path === '/rewards' || path.startsWith('/rewards/') || path.startsWith('/api/rewards/'))"
ROUTE_V1 = "    if ((path === '/badge' || path.startsWith('/badge/') || path.startsWith('/api/badge/')) && (host === 'relentlessbillionaire.com' || host === 'www.relentlessbillionaire.com')) { const rbb = await rbBadgeRoute(request, env, url); if (rbb) return rbb; }\n"
ROUTE_V2 = "    if ((path === '/badge' || path.startsWith('/badge/') || path.startsWith('/api/badge/') || path === '/app' || path.startsWith('/app/')) && (host === 'relentlessbillionaire.com' || host === 'www.relentlessbillionaire.com')) { const rbb = await rbBadgeRoute(request, env, url); if (rbb) return rbb; }\n"
ROUTE = ("    if ((path === '/badge' || path.startsWith('/badge/') || path.startsWith('/api/badge/') || path === '/app' || path.startsWith('/app/') || path.startsWith('/api/world/')) && (host === 'relentlessbillionaire.com' || host === 'www.relentlessbillionaire.com')) { const rbb = await rbBadgeRoute(request, env, url); if (rbb) return rbb; }\n")
for old_route in (ROUTE_V1, ROUTE_V2):
    if old_route in s:
        s = s.replace(old_route, ROUTE); changed.append("routes brought up to date")
if ROUTE not in s:
    if s.count(ROUTE_OLD) != 1:
        raise SystemExit(f"artist-router: route anchor found {s.count(ROUTE_OLD)} times")
    s = s.replace(ROUTE_OLD, ROUTE + ROUTE_OLD); changed.append("routes")

p.write_text(s, encoding="utf-8")
print("artist-router: " + (", ".join(changed) + " done" if changed else "RB Badge already in place"))
