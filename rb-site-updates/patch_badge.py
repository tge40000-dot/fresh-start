"""RB Badge in a pulled artist-router Worker: the member pass at relentlessbillionaire.com/badge.

Usage: python3 -I patch_badge.py <pulled artist-router dir>

Adds, after the RB Collect block (patch_rewards.py, whose helpers it reuses):
- GET /badge          the pass: sign in with Clerk, see points, level, perks, achievements, rewards and the door QR
- GET /badge/terms    the terms, built from the live values (always visible so they can be reviewed before launch)
- GET /api/badge/state, GET /api/badge/me, GET /api/badge/pass, POST /api/badge/redeem
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
for ph in ("__NONCE__", "__STATUS__", "__STATE__", "__CLERK_KEY__"):
    if ph not in page:
        raise SystemExit(f"badge.html: missing {ph}")
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
block = (START + "const RB_BADGE_HTML = " + json.dumps(page) + ";\n" + "const RB_BADGE_SCHEMA = " + json.dumps(statements) + ";\n"
         + qr_block + code.rstrip("\n") + "\n" + END)

if START in s:
    a = s.index(START); b = s.index(END) + len(END)
    if s[a:b] != block:
        s = s[:a] + block + s[b:]; changed.append("RB Badge updated")
else:
    s = s.replace(COLLECT_END, COLLECT_END + block, 1); changed.append("RB Badge block")

ROUTE_OLD = "    if ((path === '/rewards' || path.startsWith('/rewards/') || path.startsWith('/api/rewards/'))"
ROUTE = ("    if ((path === '/badge' || path.startsWith('/badge/') || path.startsWith('/api/badge/')) && (host === 'relentlessbillionaire.com' || host === 'www.relentlessbillionaire.com')) { const rbb = await rbBadgeRoute(request, env, url); if (rbb) return rbb; }\n")
if ROUTE not in s:
    if s.count(ROUTE_OLD) != 1:
        raise SystemExit(f"artist-router: route anchor found {s.count(ROUTE_OLD)} times")
    s = s.replace(ROUTE_OLD, ROUTE + ROUTE_OLD); changed.append("routes")

p.write_text(s, encoding="utf-8")
print("artist-router: " + (", ".join(changed) + " done" if changed else "RB Badge already in place"))
