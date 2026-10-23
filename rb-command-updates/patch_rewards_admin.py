"""RB Command: a "Rewards" section for RB Collect (the /rewards game on relentlessbillionaire.com).

Usage: python3 -I patch_rewards_admin.py <pulled rb-command dir>

Adds four tables to tables.js, in a new nav group "Rewards" (owner only by default; give another role
Rewards: "view"/"edit" in auth.js ROLES if they should see it):
- reward_prizes  Prizes: one per set. Edit name, description, quantity, remaining, status (draft/live), order, picture.
                 The four rows ship as DRAFT with quantity 0; a prize is only in the game once it is live with remaining > 0.
- reward_codes   Codes: make codes for shows, photoshoots and events (plays, max uses, expiry). Each works once per player.
- reward_claims  Claims: completed sets claimed by players; set the status (requested, approved, fulfilled, rejected) and notes.
- reward_config  Game settings: switch the game on/off, dates, eligibility, rare odds and every play amount; values are checked.
Requested claims show as a count on the nav and an Overview to-do.
If the RB Collect tables don't exist yet, opening any of these creates them with the same SQL as artist-router
(rb-site-updates/src/rewards/schema.sql: CREATE ... IF NOT EXISTS and INSERT OR IGNORE only), so nothing crashes and
the owner can set prizes up before the game is switched on. Running this twice changes nothing.
"""
import json
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
folder = pathlib.Path(sys.argv[1])
sql = (HERE.parent / "rb-site-updates/src/rewards/schema.sql").read_text(encoding="utf-8")
statements = [x.strip() for x in re.split(r";\s*\n", "\n".join(l for l in sql.splitlines() if not l.startswith("--"))) if x.strip()]


def edit(name, old, new, what):
    p = folder / name
    s = p.read_text(encoding="utf-8")
    # Done already, even if a later patch has since added its own lines inside this block: look for the first line
    # this edit adds.
    added = new.replace(old, "", 1) if old in new else new
    first = next((ln for ln in added.split("\n") if ln.strip()), "")
    if new in s or (len(first.strip()) > 20 and first in s):
        return
    if s.count(old) != 1:
        raise SystemExit(f"{name}: {what}: anchor found {s.count(old)} times: {old[:70]!r}")
    p.write_text(s.replace(old, new), encoding="utf-8")
    print(f"{name}: {what}")


# ---------------------------------------------------------------- tables.js
# (Done already when "Rewards" is in the list, even with groups added after it by later patches.)
if '"Members", "Rewards"' not in (folder / "tables.js").read_text(encoding="utf-8"):
  edit("tables.js", 'export const GROUPS = ["Content", "TV", "Events", "Club", "Money", "Inbox", "Sports 4 All", "Partners", "Members", "Settings"];',
     'export const GROUPS = ["Content", "TV", "Events", "Club", "Money", "Inbox", "Sports 4 All", "Partners", "Members", "Rewards", "Settings"];', "Rewards group")

SPECS = '''  // ---------------- Rewards (RB Collect at relentlessbillionaire.com/rewards)
  reward_prizes: {
    label: "Prizes", group: "Rewards", pk: "id", title: "name", list: ["image_url", "set_label", "name", "quantity", "remaining", "status"],
    search: ["name", "description", "set_label"], filter: "status", order: "sort_order, id", touch: "updated_at", ensure: REWARD_SCHEMA,
    note: "One prize per set. A prize is in RB Collect only while it is live and has some remaining. Write exactly what the winner gets; the official rules at /rewards/rules show the name, description, quantity and remaining. Claims take one off Remaining. Lowering Remaining below the rare pieces players already hold means some of them can't claim.",
    fields: {
      set_label: f.ro("Set"),
      set_key: f.ro("Set key"),
      name: f.text("Prize", { required: true, max: 120 }),
      description: f.area("What the winner gets", { max: 1000, rows: 3 }),
      quantity: f.int("Quantity", { required: true, min: 0, max: 100000, help: "How many of this prize there are in total." }),
      remaining: f.int("Remaining", { required: true, min: 0, max: 100000, help: "How many can still be claimed. Never more than Quantity." }),
      status: f.pick("Status", LIVE_DRAFT, { required: true }),
      sort_order: f.int("Order"),
      image_url: f.image("Picture", "rewards"),
      updated_at: f.ro("Updated", "datetime"),
    },
    async check(env, v, errors, mode, before) {
      const q = "quantity" in v ? v.quantity : before?.quantity, r = "remaining" in v ? v.remaining : before?.remaining;
      if (q != null && r != null && Number(r) > Number(q)) errors.remaining = "Remaining can't be more than Quantity.";
      const st = "status" in v ? v.status : before?.status;
      if (st === "live" && /^DRAFT:/i.test(String(("description" in v ? v.description : before?.description) || ""))) errors.description = "Replace the DRAFT text with what the winner gets before going live.";
      if (st === "live" && !(Number(q) > 0)) errors.quantity = "Set how many there are before going live.";
    },
  },
  reward_codes: {
    label: "Codes", group: "Rewards", pk: "code", pkType: "text", pkPattern: "^[A-Z0-9-]{3,40}$", title: "code",
    pkHelp: "Capital letters, numbers and -, 3 to 40 characters, for example SHOW-NOV12. Players type it on /rewards.",
    list: ["code", "label", "plays", "uses", "max_uses", "expires_at"], search: ["code", "label"], order: "created_at DESC", create: true, del: true, exportable: true,
    ensure: REWARD_SCHEMA,
    note: "Hand these out at shows, photoshoots and events. Each code works once per player, up to Max uses in total, until it expires.",
    fields: {
      label: f.text("What it's for", { max: 120 }),
      plays: f.int("Plays", { required: true, min: 1, max: 100 }),
      max_uses: f.int("Max uses", { required: true, min: 1, max: 100000 }),
      uses: f.ro("Used", "int"),
      expires_at: f.when("Expires", { zone: "America/Los_Angeles", help: "Pacific time. Leave empty for no expiry." }),
      created_at: CREATED,
    },
  },
  reward_claims: {
    label: "Claims", group: "Rewards", pk: "id", pkType: "text", title: "email", list: ["created_at", "set_key", "email", "status"],
    search: ["email", "set_key", "notes", "player_id"], filter: "status", order: "status='requested' DESC, created_at DESC", exportable: true, touch: "updated_at",
    ensure: REWARD_SCHEMA,
    note: "Players who completed a set. Contact them at the email shown (it is their verified sign-in email), check eligibility, then set approved and fulfilled. Rejecting does not put the prize back: raise Remaining on the prize if you want it back in the game.",
    fields: {
      set_key: f.ro("Set"), email: f.ro("Email", "email"), player_id: f.ro("Player"),
      status: f.pick("Status", ["requested", "approved", "fulfilled", "rejected"], { required: true }),
      notes: f.area("Notes", { max: 2000, rows: 3 }),
      created_at: CREATED, updated_at: f.ro("Updated", "datetime"),
    },
  },
  reward_config: {
    label: "Game settings", group: "Rewards", pk: "key", pkType: "text", title: "label", list: ["label", "value"], order: "sort_order, key", touch: "updated_at",
    ensure: REWARD_SCHEMA,
    note: "RB Collect ships switched off. Set the prizes live first, then the dates and who can play, then set Game switched on to on. The board and the official rules use these values as soon as you save.",
    fields: { label: f.ro("Setting"), help: f.ro("What it does", "textarea"), value: f.area("Value", { max: 2000, rows: 2 }), updated_at: f.ro("Updated", "datetime") },
    async check(env, v, errors, mode, before) {
      const k = before && before.key, val = v.value == null ? "" : String(v.value).trim();
      if (!("value" in v)) return;
      if (k === "enabled" && !["on", "off"].includes(val)) errors.value = "Use on or off.";
      if ((k === "starts_at" || k === "ends_at") && val && !/^\\d{4}-\\d{2}-\\d{2}([T ]\\d{2}:\\d{2}(:\\d{2})?(Z|[+-]\\d{2}:\\d{2})?)?$/.test(val)) errors.value = "Use a date like 2026-12-31, or a date and time like 2026-12-31T18:00-08:00.";
      if (k === "rare_odds" && !(/^\\d{1,6}$/.test(val) && +val >= 2)) errors.value = "Use a whole number, 2 or more.";
      if (/^(plays_|contribution_cap|order_cap|referral_cap)/.test(k || "") && !(/^\\d{1,5}$/.test(val))) errors.value = "Use a whole number (0 turns it off).";
      if ((k === "eligibility" || k === "claim_how") && !val) errors.value = "This is shown in the official rules, so it can't be empty.";
      if (k === "enabled" && val === "on") {
        const live = await env.DB.prepare("SELECT count(*) AS n FROM reward_prizes WHERE status = 'live' AND remaining > 0").first().catch(() => null);
        if (!(Number(live?.n) > 0)) errors.value = "Set at least one prize live, with some remaining, before switching the game on.";
      }
      if (val !== String(v.value ?? "")) v.value = val;
    },
  },

  // ---------------- Settings
  feature_controls: {'''
edit("tables.js", "  // ---------------- Settings\n  feature_controls: {", SPECS, "Rewards tables")

edit("tables.js", "const CREATED = { type: \"datetime\", label: \"Created\", ro: true };\n",
     "const CREATED = { type: \"datetime\", label: \"Created\", ro: true };\n"
     "// RB Collect tables, created when missing (same SQL as artist-router: rb-site-updates/src/rewards/schema.sql).\n"
     "const REWARD_SCHEMA = " + json.dumps(statements) + ";\n", "RB Collect schema")

# A section whose table a migration creates: run its `ensure` SQL once when the table is missing, then retry.
edit("tables.js", "// ---------------------------------------------------------------- operations\n",
     "// ---------------------------------------------------------------- operations\n\n"
     "async function ensured(env, name, fn) {\n"
     "  try {\n"
     "    return await fn();\n"
     "  } catch (e) {\n"
     "    const t = Object.hasOwn(TABLES, name) ? TABLES[name] : null;\n"
     "    if (!t?.ensure || !/no such table/i.test(String(e?.message || e))) throw e;\n"
     "    await env.DB.batch(t.ensure.map((q) => env.DB.prepare(q)));\n"
     "    return await fn();\n"
     "  }\n"
     "}\n", "ensure helper")
for fn, args in [("listRows", "env, name, params"), ("getRow", "env, name, rawId"), ("createRow", "env, who, name, body"),
                 ("updateRow", "env, who, name, rawId, body"), ("deleteRow", "env, who, name, rawId"), ("exportCsv", "env, name")]:
    edit("tables.js", f"export async function {fn}({args}) {{\n",
         f"export async function {fn}({args}) {{\n  return ensured(env, name, () => {fn}Now({args}));\n}}\nasync function {fn}Now({args}) {{\n", f"{fn} creates missing Rewards tables")

# The IDENT check must not trip over the new `ensure` key (it only checks pk and field names), and publicConfig doesn't
# send `ensure` or `check` to the browser (it lists its keys explicitly), so nothing else changes in tables.js.

# ---------------------------------------------------------------- auth.js: the capability list knows the new group
if '"Members", "Rewards"' not in (folder / "auth.js").read_text(encoding="utf-8"):
  edit("auth.js", 'for (const g of ["Content", "TV", "Events", "Club", "Money", "Inbox", "Sports 4 All", "Partners", "Members", "CRM", "Settings"])',
     'for (const g of ["Content", "TV", "Events", "Club", "Money", "Inbox", "Sports 4 All", "Partners", "Members", "Rewards", "CRM", "Settings"])', "Rewards capability")

# ---------------------------------------------------------------- index.js: requested claims as a nav count and a to-do
edit("index.js", '  if (funnelNow === null) need("watch", "funnel", 1,',
     '  const rewardClaims = Number((await optional(env, "SELECT count(*) AS n FROM reward_claims WHERE status = \'requested\'"))?.[0]?.n) || 0;\n'
     '  need("act", "reward_claims", rewardClaims, "RB Collect prize claims", "Players completed a set. Contact them at the email on the claim, then set it approved and fulfilled.", "#/t/reward_claims?status=requested");\n'
     '  if (funnelNow === null) need("watch", "funnel", 1,', "claims to-do")
edit("index.js", "aff_partners: affApps ? Number(affApps[0]?.n) || 0 : 0,\n    },",
     "aff_partners: affApps ? Number(affApps[0]?.n) || 0 : 0, reward_claims: rewardClaims,\n    },", "claims badge")
