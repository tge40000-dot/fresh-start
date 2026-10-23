"""RB Command: "Badges" for RB Badge (relentlessbillionaire.com/badge) and the Badge desk for the door.

Usage: python3 -I patch_badges_admin.py <pulled rb-command dir>

- Copies src/badgedesk.js in, and writes badge_schema.js (the same SQL as artist-router,
  rb-site-updates/src/badge/schema.sql) and badge_jsqr.js (rb-tools/vendor/jsQR-1.4.0.js, Apache-2.0, the QR reader).
- tables.js: a nav group "Badges" (owner only by default; give a role Badges: "view"/"edit" in auth.js ROLES) with
  Settings (badge_config: the on/off switch and every point value, checked), Levels (badge_levels), Rewards
  (badge_rewards) and Achievements (badge_achievements). Opening any of them creates missing tables.
- auth.js: a "Door staff" role for event workers: RB Command shows them only the Badge desk (signing in lands there).
- index.js: GET /badge-desk, /badge-desk/jsqr.js and /badge-desk/manifest.webmanifest (the desk installs on a phone as
  "RB Door"), GET /api/badge-desk, and POST /api/badge-desk/lookup, /checkin and /redeem (in person) for Badges edit,
  Club edit or Door staff (Door staff must scan to check in); /adjust, /grant, /redemption and GET
  /api/badge-desk/redemptions for Badges edit. Requested rewards show as an Overview to-do.
- ui.js: "Badge desk" in the nav (its section, Shows & sites, is in patch_nav.py).
RB Badge ships switched off; the Settings note says what to do before switching it on. Running this twice changes nothing.
"""
import json
import pathlib
import re
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
folder = pathlib.Path(sys.argv[1])
sql = (ROOT / "rb-site-updates/src/badge/schema.sql").read_text(encoding="utf-8")
statements = [x.strip() for x in re.split(r";\s*\n", "\n".join(l for l in sql.splitlines() if not l.startswith("--"))) if x.strip()]
changed = []

shutil.copyfile(HERE / "src" / "badgedesk.js", folder / "badgedesk.js")
(folder / "badge_schema.js").write_text("// RB Badge tables, created when missing (the same SQL as artist-router: rb-site-updates/src/badge/schema.sql).\n"
                                        "export const BADGE_SCHEMA = " + json.dumps(statements) + ";\n", encoding="utf-8")
jsqr = (ROOT / "rb-tools/vendor/jsQR-1.4.0.js").read_text(encoding="utf-8")
(folder / "badge_jsqr.js").write_text("// jsQR 1.4.0 (https://github.com/cozmo/jsQR), Apache License 2.0: rb-tools/vendor/jsQR-1.4.0.LICENSE.\n"
                                      "// Served to the Badge desk at /badge-desk/jsqr.js to read QR codes from the camera.\n"
                                      "export default " + json.dumps("/*! jsQR 1.4.0 | Apache-2.0 | https://github.com/cozmo/jsQR */\n" + jsqr) + ";\n", encoding="utf-8")


def upgrade(name, old, new, what):
    """Bring a line an earlier version of this patch added up to date."""
    p = folder / name
    t = p.read_text(encoding="utf-8")
    if old in t and new not in t:
        p.write_text(t.replace(old, new), encoding="utf-8")
        changed.append(what)


def edit(name, old, new, what):
    p = folder / name
    s = p.read_text(encoding="utf-8")
    # Done already, even if another patch has since added its own block at the same anchor: look for the first
    # line this edit adds.
    added = new.replace(old, "", 1) if old in new else new
    first = next((ln for ln in added.split("\n") if ln.strip()), "")
    if new in s or (len(first.strip()) > 20 and first in s):
        return
    if s.count(old) != 1:
        raise SystemExit(f"rb-command/{name}: {what}: anchor found {s.count(old)} times: {old[:70]!r}")
    p.write_text(s.replace(old, new), encoding="utf-8")
    changed.append(what)


# ---------------------------------------------------------------- tables.js
edit("tables.js", '"Members", "Rewards", "Settings"];', '"Members", "Rewards", "Badges", "Settings"];', "Badges group")
tables = (folder / "tables.js").read_text(encoding="utf-8")
if 'from "./badge_schema.js"' not in tables:
    (folder / "tables.js").write_text('import { BADGE_SCHEMA } from "./badge_schema.js";\n' + tables, encoding="utf-8")
    changed.append("schema import")

SPECS = '''  // ---------------- Badges (RB Badge at relentlessbillionaire.com/badge; the door is /badge-desk)
  badge_config: {
    label: "Settings", group: "Badges", pk: "key", pkType: "text", title: "label", list: ["label", "value"], order: "sort_order, key", touch: "updated_at",
    ensure: BADGE_SCHEMA,
    note: "RB Badge ships switched off. Before switching it on: set each level live with what it really gets members (Levels), add any rewards (Rewards), read the terms at relentlessbillionaire.com/badge/terms (they show these values), then set RB Badge switched on to on. Points from earlier purchases, sign-ups and memberships are added the first time each member opens their badge.",
    fields: { label: f.ro("Setting"), help: f.ro("What it does", "textarea"), value: f.area("Value", { max: 2000, rows: 2 }), updated_at: f.ro("Updated", "datetime") },
    async check(env, v, errors, mode, before) {
      const k = before && before.key, val = v.value == null ? "" : String(v.value).trim();
      if (!("value" in v)) return;
      if ((k === "enabled" || k === "world_open") && !["on", "off"].includes(val)) errors.value = "Use on or off.";
      if (/^(points_|order_cap|contribution_cap|checkin_|adjust_max|game_|world_points|world_block)/.test(k || "") && !/^\\d{1,6}$/.test(val)) errors.value = "Use a whole number (0 turns it off).";
      if ((k === "eligibility" || k === "redeem_how") && !val) errors.value = "This is shown in the terms, so it can't be empty.";
      if (k === "enabled" && val === "on") {
        const live = await env.DB.prepare("SELECT count(*) AS n FROM badge_levels WHERE status = 'live' AND perks NOT LIKE 'DRAFT:%' AND trim(coalesce(perks, '')) != ''").first().catch(() => null);
        if (!(Number(live?.n) > 0)) errors.value = "Set at least one level live, with what it gets members, before switching RB Badge on.";
      }
      if (val !== String(v.value ?? "")) v.value = val;
    },
  },
  badge_levels: {
    label: "Levels", group: "Badges", pk: "id", title: "name", list: ["name", "min_points", "status", "perks"], order: "min_points, sort_order, id", touch: "updated_at",
    create: true, del: true, ensure: BADGE_SCHEMA,
    note: "A member's level is the highest live level their lifetime points reach (spending points never lowers it). Door staff see the level and its perks when they scan a badge. The four levels ship as drafts: write exactly what each one gets, then set it live. The lowest live level is what everyone starts at, so give one level 0.",
    fields: {
      level_key: f.text("Key", { required: true, max: 30, pattern: "^[a-z0-9_]{2,30}$", help: "Lowercase letters, numbers and _, for example gold. Rewards use it for their level limit." }),
      name: f.text("Level", { required: true, max: 40 }),
      min_points: f.int("Lifetime points needed", { required: true, min: 0, max: 10000000 }),
      perks: f.area("What it gets members", { max: 1000, rows: 3, help: "Shown on the badge, in the terms and to door staff. Only promise what RB will give." }),
      status: f.pick("Status", LIVE_DRAFT, { required: true }),
      sort_order: f.int("Order"),
      updated_at: f.ro("Updated", "datetime"),
    },
    async check(env, v, errors, mode, before) {
      const st = "status" in v ? v.status : before?.status, perks = String(("perks" in v ? v.perks : before?.perks) || "").trim();
      if (st === "live" && (!perks || /^DRAFT:/i.test(perks))) errors.perks = "Write what this level gets members before setting it live.";
    },
  },
  badge_rewards: {
    label: "Rewards", group: "Badges", pk: "id", title: "name", list: ["image_url", "name", "cost", "remaining", "min_level", "status"], search: ["name", "description"], filter: "status",
    order: "sort_order, cost, id", touch: "updated_at", create: true, del: true, ensure: BADGE_SCHEMA,
    note: "What members can spend points on. A reward shows on /badge while it is live; redeeming takes the points and one off Remaining, and the request waits in the Badge desk for the team to approve, deliver or reject (rejecting gives both back). Write exactly what the member gets.",
    fields: {
      name: f.text("Reward", { required: true, max: 120 }),
      description: f.area("What the member gets", { max: 1000, rows: 3 }),
      cost: f.int("Points", { required: true, min: 1, max: 10000000 }),
      quantity: f.int("Quantity", { required: true, min: 0, max: 100000, help: "How many there are in total." }),
      remaining: f.int("Remaining", { required: true, min: 0, max: 100000, help: "How many can still be redeemed. Never more than Quantity." }),
      min_level: f.text("Only for this level and up", { max: 30, help: "A level key, for example gold. Leave empty for everyone." }),
      status: f.pick("Status", LIVE_DRAFT, { required: true }),
      sort_order: f.int("Order"),
      image_url: f.image("Picture", "badges"),
      updated_at: f.ro("Updated", "datetime"),
    },
    async check(env, v, errors, mode, before) {
      const get = (k) => (k in v ? v[k] : before?.[k]);
      if (get("quantity") != null && get("remaining") != null && Number(get("remaining")) > Number(get("quantity"))) errors.remaining = "Remaining can't be more than Quantity.";
      if (get("status") === "live" && (!String(get("description") || "").trim() || /^DRAFT:/i.test(String(get("description"))))) errors.description = "Write what the member gets before going live.";
      const lvl = String(get("min_level") || "").trim();
      if (lvl && !(await env.DB.prepare("SELECT 1 AS ok FROM badge_levels WHERE level_key = ?").bind(lvl).first().catch(() => null))) errors.min_level = "No level has that key.";
    },
  },
  badge_achievements: {
    label: "Achievements", group: "Badges", pk: "key", pkType: "text", pkPattern: "^[a-z0-9_]{2,40}$", title: "name", list: ["name", "rule", "threshold", "status"], order: "sort_order, key",
    touch: "updated_at", create: true, del: true, ensure: BADGE_SCHEMA,
    pkHelp: "Lowercase letters, numbers and _, for example vip_night.",
    note: "Collectible badges members earn on their own (from the rule and how many) or that the team gives by hand in the Badge desk (rule manual). Rules count: checkins, signup, membership, orders, contributions, member (months), release, event_listed, collect, or lifetime (points).",
    fields: {
      name: f.text("Achievement", { required: true, max: 60 }),
      description: f.text("How it's earned", { max: 200 }),
      rule: f.pick("Rule", ["checkins", "signup", "membership", "orders", "contributions", "member", "release", "event_listed", "collect", "lifetime", "manual"], { required: true }),
      threshold: f.int("How many", { required: true, min: 1, max: 10000000 }),
      status: f.pick("Status", LIVE_DRAFT, { required: true }),
      sort_order: f.int("Order"),
      updated_at: f.ro("Updated", "datetime"),
    },
  },

  // ---------------- Settings
  feature_controls: {'''
edit("tables.js", "  // ---------------- Settings\n  feature_controls: {", SPECS, "Badges tables")

upgrade("tables.js", "/^(points_|order_cap|contribution_cap|checkin_|adjust_max)/", "/^(points_|order_cap|contribution_cap|checkin_|adjust_max|game_|world_points|world_block)/", "game settings are checked")
upgrade("tables.js", "/^(points_|order_cap|contribution_cap|checkin_|adjust_max|game_|world_)/", "/^(points_|order_cap|contribution_cap|checkin_|adjust_max|game_|world_points|world_block)/", "RB World point settings are checked")
upgrade("tables.js", 'if (k === "enabled" && !["on", "off"].includes(val))', 'if ((k === "enabled" || k === "world_open") && !["on", "off"].includes(val))', "RB World switch is checked")
upgrade("tables.js", "/^(points_|order_cap|contribution_cap|checkin_|adjust_max|game_)/", "/^(points_|order_cap|contribution_cap|checkin_|adjust_max|game_|world_points|world_block)/", "RB World settings are checked")

# RB World lots: who owns what in the game's city; deleting a row puts that lot back on sale.
edit("tables.js", "  // ---------------- Settings\n  feature_controls: {",
     "  world_lots: {\n"
     '    label: "RB World lots", group: "Badges", pk: "lot", title: "owner_name", list: ["lot", "owner_name", "business", "level", "title", "updated_at"], search: ["owner_name", "title", "business"], order: "lot",\n'
     "    del: true, ensure: BADGE_SCHEMA,\n"
     '    note: "Who owns which lot in RB World\'s city (game money only). Delete a row to put that lot back on sale, for example if a name or business title breaks the rules. Lots also go back on sale by themselves when their owner hasn\'t played for 14 days.",\n'
     '    fields: { owner_name: f.ro("Owner"), owner_id: f.ro("Game id"), business: f.ro("Business"), level: f.ro("Level", "int"), title: f.ro("Business name"), rent_pending: f.ro("Rent waiting", "int"), bought_at: f.ro("Bought", "datetime"), updated_at: f.ro("Updated", "datetime") },\n'
     "  },\n\n"
     "  // ---------------- Settings\n  feature_controls: {", "RB World lots table")

# RB World race records: best times on each track; deleting a row takes a time off the record board.
edit("tables.js", "  // ---------------- Settings\n  feature_controls: {",
     "  world_race_best: {\n"
     '    label: "RB World race records", group: "Badges", pk: "k", pkType: "text", title: "name", list: ["track", "name", "ms", "at"], search: ["name", "track", "player_id"], order: "track, ms",\n'
     "    del: true, ensure: BADGE_SCHEMA,\n"
     '    note: "Each player\'s best time on each RB World street race track (ms = milliseconds, timed by the server). Delete a row to take a time off the record board, for example if a name breaks the rules. Race prizes are game money only.",\n'
     '    fields: { track: f.ro("Track"), name: f.ro("Player"), ms: f.ro("Time (ms)", "int"), player_id: f.ro("Game id"), race_id: f.ro("Race"), at: f.ro("Set", "datetime") },\n'
     "  },\n\n"
     "  // ---------------- Settings\n  feature_controls: {", "RB World race records table")

# RB World chat (the 3D game at relentlessbillionaire.com/app/world), so the team can remove messages.
edit("tables.js", "  // ---------------- Settings\n  feature_controls: {",
     "  world_chat: {\n"
     '    label: "RB World chat", group: "Badges", pk: "n", title: "text", list: ["created_at", "name", "text"], search: ["name", "text", "player_id"], order: "n DESC",\n'
     "    del: true, readonly: false, ensure: BADGE_SCHEMA,\n"
     '    note: "Messages players sent in RB World\'s city chat (the newest 2,000 are kept). Delete any that break the rules; it disappears from the game within a few seconds.",\n'
     '    fields: { name: f.ro("Player"), text: f.ro("Message", "textarea"), player_id: f.ro("Game id"), created_at: f.ro("Sent", "datetime") },\n'
     "  },\n\n"
     "  // ---------------- Settings\n  feature_controls: {", "RB World chat table")

# ---------------------------------------------------------------- auth.js: the new group and the Door staff role
edit("auth.js", '"Partners", "Members", "Rewards", "CRM", "Settings"])', '"Partners", "Members", "Rewards", "Badges", "CRM", "Settings"])', "Badges capability")
edit("auth.js", 'const STORED_AS = { store: "support", member: "support" };', 'const STORED_AS = { store: "support", member: "support", door: "support" };', "door role storage")
edit("auth.js", "  // Members only ever see the member portal",
     "  // Door staff only ever see the Badge desk (index.js sends them there and refuses everything else).\n"
     '  door: { label: "Door staff", blurb: "Only the Badge desk: scan RB Badges at shows and events, check people in and redeem rewards in person. Nothing else in RB Command.",\n'
     "    groups: {}, door: true },\n"
     "  // Members only ever see the member portal", "door role")
edit("auth.js", "limited: Boolean(r.limited), member: Boolean(r.member) };", "limited: Boolean(r.limited), member: Boolean(r.member), door: Boolean(r.door) };", "door capability")


# ---------------------------------------------------------------- index.js
edit("index.js", 'import * as siteimages from "./siteimages.js";\n', 'import * as siteimages from "./siteimages.js";\nimport * as badgedesk from "./badgedesk.js";\n', "import")
DESK_V1 = 'const badgeDesk = (user) => auth.can(user.role, "Badges", "edit") || auth.can(user.role, "Club", "edit");\n'
DESK = ('const badgeDesk = (user) => Boolean(auth.ROLES[user.role]?.door) || auth.can(user.role, "Badges", "edit") || auth.can(user.role, "Club", "edit");\n'
        "// Door staff check people in only by scanning; the Badges and Club teams can also check in someone they looked up.\n"
        'const deskWho = (user) => ({ ...user, mustScan: !(auth.can(user.role, "Badges", "edit") || auth.can(user.role, "Club", "edit")) });\n')
upgrade("index.js", DESK_V1, DESK, "desk access with Door staff")
edit("index.js", "async function readJson(request, url) {\n", DESK + "async function readJson(request, url) {\n", "desk access")
edit("index.js", "  const limited = Boolean(auth.ROLES[user.role]?.limited);\n",
     "  if (auth.ROLES[user.role]?.door) {\n"
     '    const read = request.method === "GET" || request.method === "HEAD";\n'
     '    const ok = read ? ["/", "/login", "/api/me", "/badge-desk", "/badge-desk/jsqr.js", "/badge-desk/manifest.webmanifest", "/api/badge-desk"].includes(path)\n'
     '      : request.method === "POST" && /^\\/api\\/(badge-desk\\/(lookup|checkin|redeem)|auth\\/(logout|password))$/.test(path);\n'
     '    if (!ok) { await discard(request); throw new HttpError(403, "Your role only covers the Badge desk."); }\n'
     '    if (read && (path === "/" || path === "/login")) return redirect("/badge-desk");\n'
     "  }\n"
     "  const limited = Boolean(auth.ROLES[user.role]?.limited);\n", "door staff gate")
PAGE_V1 = 'return new Response(badgedesk.page(nonce, auth.can(user.role, "Badges", "edit")), {'
PAGE = 'return new Response(badgedesk.page(nonce, auth.can(user.role, "Badges", "edit"), Boolean(auth.ROLES[user.role]?.door)), {'
upgrade("index.js", PAGE_V1, PAGE, "desk page knows Door staff")
JSQR = '    if (path === "/badge-desk/jsqr.js") { if (!badgeDesk(user)) throw new HttpError(403, "Forbidden"); return badgedesk.jsqr(); }\n'
MANIFEST = '    if (path === "/badge-desk/manifest.webmanifest") { if (!badgeDesk(user)) throw new HttpError(403, "Forbidden"); return badgedesk.manifest(); }\n'
upgrade("index.js", JSQR, JSQR + MANIFEST, "desk manifest route")
edit("index.js", '    if (path === "/images") {\n',
     '    if (path === "/badge-desk") {\n'
     '      if (!badgeDesk(user)) throw new HttpError(403, "The Badge desk needs Badges or Club edit access, or the Door staff role.");\n'
     '      const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));\n'
     '      ' + PAGE + ' headers: { ...BASE_HEADERS, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": badgedesk.csp(nonce), "X-Frame-Options": "DENY" } });\n'
     '    }\n' + JSQR + MANIFEST +
     '    if (path === "/images") {\n', "page routes")
edit("index.js", '    if (path === "/api/site-images") { needs(user, "Content", "view"); return json(await siteimages.get(env)); }\n',
     '    if (path === "/api/site-images") { needs(user, "Content", "view"); return json(await siteimages.get(env)); }\n'
     '    if (path === "/api/badge-desk") { if (!badgeDesk(user)) throw new HttpError(403, "Forbidden"); return json(await badgedesk.summary(env)); }\n'
     '    if (path === "/api/badge-desk/redemptions") { needs(user, "Badges", "edit"); return json(await badgedesk.redemptions(env)); }\n', "read routes")
CHECKIN_V1 = '  if (path === "/api/badge-desk/checkin") { if (!badgeDesk(user)) throw new HttpError(403, "Forbidden"); return json(await badgedesk.checkin(env, user, body)); }\n'
CHECKIN = ('  if (path === "/api/badge-desk/checkin") { if (!badgeDesk(user)) throw new HttpError(403, "Forbidden"); return json(await badgedesk.checkin(env, deskWho(user), body)); }\n'
           '  if (path === "/api/badge-desk/redeem") { if (!badgeDesk(user)) throw new HttpError(403, "Forbidden"); return json(await badgedesk.redeemInPerson(env, deskWho(user), body)); }\n')
upgrade("index.js", CHECKIN_V1, CHECKIN, "check-in and in-person redeem routes")
edit("index.js", '  if (path === "/api/site-images") { needs(user, "Content", "edit"); return json(await siteimages.save(env, user, body)); }\n',
     '  if (path === "/api/site-images") { needs(user, "Content", "edit"); return json(await siteimages.save(env, user, body)); }\n'
     '  if (path === "/api/badge-desk/lookup") { if (!badgeDesk(user)) throw new HttpError(403, "Forbidden"); return json(await badgedesk.lookup(env, body)); }\n'
     + CHECKIN +
     '  if (path === "/api/badge-desk/adjust") { needs(user, "Badges", "edit"); return json(await badgedesk.adjust(env, user, body)); }\n'
     '  if (path === "/api/badge-desk/grant") { needs(user, "Badges", "edit"); return json(await badgedesk.grant(env, user, body)); }\n'
     '  if (path === "/api/badge-desk/redemption") { needs(user, "Badges", "edit"); return json(await badgedesk.setRedemption(env, user, body)); }\n', "write routes")
edit("index.js", '  need("act", "reward_claims", rewardClaims,',
     '  const badgeRequests = Number((await optional(env, "SELECT count(*) AS n FROM badge_redemptions WHERE status = \'requested\'"))?.[0]?.n) || 0;\n'
     '  need("act", "badge_rewards", badgeRequests, "RB Badge reward requests", "Members spent points on a reward. Open the Badge desk, contact them, then mark it delivered.", "/badge-desk");\n'
     '  need("act", "reward_claims", rewardClaims,', "requests to-do")

# ---------------------------------------------------------------- ui.js
edit("ui.js", '  if (CAPS.groups.Content) NAV_TOP.push(["/images", "Site images"]);\n',
     '  if (CAPS.groups.Content) NAV_TOP.push(["/images", "Site images"]);\n'
     '  if (CAPS.groups.Badges === "edit" || CAPS.groups.Club === "edit") NAV_TOP.push(["/badge-desk", "Badge desk"]);\n', "nav entry")
print("rb-command: badges " + (", ".join(changed) + " added" if changed else "already in place"))
