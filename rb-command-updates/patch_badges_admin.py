"""RB Command: "Badges" for RB Badge (relentlessbillionaire.com/badge) and the Badge desk for the door.

Usage: python3 -I patch_badges_admin.py <pulled rb-command dir>

- Copies src/badgedesk.js in, and writes badge_schema.js (the same SQL as artist-router,
  rb-site-updates/src/badge/schema.sql) and badge_jsqr.js (rb-tools/vendor/jsQR-1.4.0.js, Apache-2.0, the QR reader).
- tables.js: a nav group "Badges" (owner only by default; give a role Badges: "view"/"edit" in auth.js ROLES) with
  Settings (badge_config: the on/off switch and every point value, checked), Levels (badge_levels), Rewards
  (badge_rewards) and Achievements (badge_achievements). Opening any of them creates missing tables.
- index.js: GET /badge-desk (Badges edit or Club edit), GET /badge-desk/jsqr.js, GET /api/badge-desk, and POST
  /api/badge-desk/lookup and /checkin (same people), /adjust, /grant, /redemption and GET /api/badge-desk/redemptions
  (Badges edit). Requested rewards show as an Overview to-do.
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
      if (k === "enabled" && !["on", "off"].includes(val)) errors.value = "Use on or off.";
      if (/^(points_|order_cap|contribution_cap|checkin_|adjust_max)/.test(k || "") && !/^\\d{1,6}$/.test(val)) errors.value = "Use a whole number (0 turns it off).";
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

# ---------------------------------------------------------------- auth.js: the capability list knows the new group
edit("auth.js", '"Partners", "Members", "Rewards", "CRM", "Settings"])', '"Partners", "Members", "Rewards", "Badges", "CRM", "Settings"])', "Badges capability")

# ---------------------------------------------------------------- index.js
edit("index.js", 'import * as siteimages from "./siteimages.js";\n', 'import * as siteimages from "./siteimages.js";\nimport * as badgedesk from "./badgedesk.js";\n', "import")
DESK = 'const badgeDesk = (user) => auth.can(user.role, "Badges", "edit") || auth.can(user.role, "Club", "edit");\n'
edit("index.js", "async function readJson(request, url) {\n", DESK + "async function readJson(request, url) {\n", "desk access")
edit("index.js", '    if (path === "/images") {\n',
     '    if (path === "/badge-desk") {\n'
     '      if (!badgeDesk(user)) throw new HttpError(403, "The Badge desk needs Badges or Club edit access.");\n'
     '      const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));\n'
     '      return new Response(badgedesk.page(nonce, auth.can(user.role, "Badges", "edit")), { headers: { ...BASE_HEADERS, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": badgedesk.csp(nonce), "X-Frame-Options": "DENY" } });\n'
     '    }\n'
     '    if (path === "/badge-desk/jsqr.js") { if (!badgeDesk(user)) throw new HttpError(403, "Forbidden"); return badgedesk.jsqr(); }\n'
     '    if (path === "/images") {\n', "page routes")
edit("index.js", '    if (path === "/api/site-images") { needs(user, "Content", "view"); return json(await siteimages.get(env)); }\n',
     '    if (path === "/api/site-images") { needs(user, "Content", "view"); return json(await siteimages.get(env)); }\n'
     '    if (path === "/api/badge-desk") { if (!badgeDesk(user)) throw new HttpError(403, "Forbidden"); return json(await badgedesk.summary(env)); }\n'
     '    if (path === "/api/badge-desk/redemptions") { needs(user, "Badges", "edit"); return json(await badgedesk.redemptions(env)); }\n', "read routes")
edit("index.js", '  if (path === "/api/site-images") { needs(user, "Content", "edit"); return json(await siteimages.save(env, user, body)); }\n',
     '  if (path === "/api/site-images") { needs(user, "Content", "edit"); return json(await siteimages.save(env, user, body)); }\n'
     '  if (path === "/api/badge-desk/lookup") { if (!badgeDesk(user)) throw new HttpError(403, "Forbidden"); return json(await badgedesk.lookup(env, body)); }\n'
     '  if (path === "/api/badge-desk/checkin") { if (!badgeDesk(user)) throw new HttpError(403, "Forbidden"); return json(await badgedesk.checkin(env, user, body)); }\n'
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
