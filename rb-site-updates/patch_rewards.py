"""Serve RB Collect at relentlessbillionaire.com/rewards (artist-router, code only).

Usage: python3 -I patch_rewards.py <pulled artist-router dir>

RB Collect is a collect-the-set game: every play reveals one piece, and a full set (two pieces plus a rare one, marked ★)
can be claimed for that set's prize. Prizes, quantities, dates, odds and play amounts all come from tables the owner
edits in RB Command (Rewards). It ships switched OFF, with four DRAFT prizes of quantity 0, so the board says
"RB Collect is coming soon" until the owner fills in the prizes, sets them live and sets reward_config.enabled to on.

This
- embeds src/rewards/rewards-worker.js, the board (src/rewards/rewards.html) and the table SQL (src/rewards/schema.sql)
  as one block before passportHTML(); re-running with newer sources replaces the block in place;
- adds the routes before the /passport route, on relentlessbillionaire.com and www. only:
    GET  /rewards              the board (?ref=<code> stores the referral in an rb_ref cookie for 30 days)
    GET  /rewards/rules        official rules, generated from the live config (prizes, quantities, remaining, exact odds)
    GET  /api/rewards/state    public: status, live prizes with remaining, ways to earn, odds
    GET  /api/rewards/me       Clerk sign-in: runs the award sync, then plays, pieces, claims, history
    POST /api/rewards/play     spend one play (server-side draw with crypto.getRandomValues)
    POST /api/rewards/claim    {set}: needs the full set, one per set per player, decrements remaining once
    POST /api/rewards/code     {code}: owner-made code, once per player, max uses, expiry
  Pages get a fresh nonce and a strict CSP per request (scripts: nonce + Clerk + Turnstile hosts). The RB Radio bar
  stays on /rewards; its injector reads the nonce from the CSP and widens it as it does elsewhere.
- Tables are created on first use (schema version 'rb-collect-1' in router_schema). To create them up front, run
  src/rewards/schema.sql on waitlist-db (DB); it is all CREATE ... IF NOT EXISTS / INSERT OR IGNORE:
    reward_config  (key TEXT PK, value TEXT, label, help, sort_order, updated_at)
    reward_prizes  (id PK, set_key UNIQUE, set_label, name, description, quantity, remaining, status 'draft'|'live', sort_order, image_url, updated_at)
    reward_pieces  (piece_key PK, set_key, label, rare, sort_order)                 4 sets x 3 pieces, seeded
    reward_players (id TEXT PK, clerk_user_id UNIQUE, email_norm, email_at, ref_code UNIQUE, referred_by, created_at, daily_at)
    reward_awards  (id TEXT PK, player_id, source, source_ref UNIQUE, plays, created_at)   every play ever earned
    reward_draws   (id TEXT PK, player_id, set_key, piece_key, rare, created_at)           pieces owned = draws
    reward_claims  (id TEXT PK, player_id, set_key, status 'requested'|'approved'|'fulfilled'|'rejected', email, created_at, updated_at, notes, UNIQUE(player_id, set_key))
    reward_codes   (code TEXT PK, label, plays, max_uses, uses, expires_at, created_at)
    reward_rate    (player_id, minute, n)  30 writes a minute per player
- Awards are pulled from existing records by the player's verified Clerk email, read only, each source optional:
  signups, shop_inquiries ('membership:<request>:<tier>'), store_orders (paid), studio_memberships (active, by Clerk id)
  and DONOR_DB contributions (paid). Each award's source_ref is unique, so a re-sync never awards twice.
No route, binding or secret changes: it uses DB, DONOR_DB, CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY, which artist-router has.
"""
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
folder = pathlib.Path(sys.argv[1])
p = folder / "artist-router-v14.js"
s = p.read_text(encoding="utf-8")
src = HERE / "src/rewards"
page = (src / "rewards.html").read_text(encoding="utf-8")
code = (src / "rewards-worker.js").read_text(encoding="utf-8")
sql = (src / "schema.sql").read_text(encoding="utf-8")
for ph in ("__NONCE__", "__STATUS__", "__STATE__", "__CLERK_KEY__"):
    if ph not in page:
        raise SystemExit(f"rewards.html: missing {ph}")
statements = [x.strip() for x in re.split(r";\s*\n", "\n".join(l for l in sql.splitlines() if not l.startswith("--"))) if x.strip()]
if len(statements) < 15:
    raise SystemExit(f"schema.sql: expected the table and seed statements, found {len(statements)}")
changed = []

START = "// ---------------------------------------------------------------- RB Collect (/rewards)\n"
END = "// ---------------------------------------------------------------- end RB Collect\n"
block = START + "const RB_COLLECT_HTML = " + json.dumps(page) + ";\n" + "const RB_COLLECT_SCHEMA = " + json.dumps(statements) + ";\n" + code.rstrip("\n") + "\n" + END

if START in s:
    a = s.index(START); b = s.index(END) + len(END)
    if s[a:b] != block:
        s = s[:a] + block + s[b:]; changed.append("RB Collect updated")
else:
    anchor = "function passportHTML() {"
    if s.count(anchor) != 1:
        raise SystemExit(f"artist-router: passportHTML anchor found {s.count(anchor)} times")
    s = s.replace(anchor, block + anchor); changed.append("RB Collect block")

ROUTE_OLD = "    if (path === '/passport' || path === '/passport/') return new Response(passportHTML(),"
ROUTE = ("    if ((path === '/rewards' || path.startsWith('/rewards/') || path.startsWith('/api/rewards/')) && (host === 'relentlessbillionaire.com' || host === 'www.relentlessbillionaire.com')) { const rbc = await rbRewardsRoute(request, env, url); if (rbc) return rbc; }\n")
if ROUTE not in s:
    if s.count(ROUTE_OLD) != 1:
        raise SystemExit(f"artist-router: route anchor found {s.count(ROUTE_OLD)} times")
    s = s.replace(ROUTE_OLD, ROUTE + ROUTE_OLD); changed.append("routes")

p.write_text(s, encoding="utf-8")
print("artist-router: " + (", ".join(changed) + " done" if changed else "RB Collect already in place"))
