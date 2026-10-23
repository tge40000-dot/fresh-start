// RB Collect: the board (/rewards), its official rules (/rewards/rules) and its API (/api/rewards/*).
// Embedded into artist-router-v14.js by rb-site-updates/patch_rewards.py, together with
// RB_COLLECT_HTML (src/rewards/rewards.html) and RB_COLLECT_SCHEMA (src/rewards/schema.sql).
// Uses the bundle's verifyClerkSession(). Everything the game says comes from reward_config,
// reward_prizes and reward_pieces, which the owner edits in RB Command (Rewards).
const RBC_SCHEMA_VERSION = "rb-collect-1";
const RBC_TZ = "America/Los_Angeles";
const RBC_DEFAULTS = { enabled: "off", starts_at: "", ends_at: "", eligibility: "Open to legal residents of the United States who are 18 or older.", rare_odds: "50",
  plays_daily: "1", plays_welcome: "3", plays_signup: "2", plays_membership_request: "5", plays_member_daily: "2", plays_per_5_dollars_given: "2", contribution_cap: "40",
  plays_per_10_dollars_spent: "1", order_cap: "20", plays_referral: "2", referral_cap_month: "10",
  claim_how: "Complete a set and press Claim prize on the board. RB reviews each claim and contacts you at the verified email on your account to arrange the prize.", free_entry: "" };
const RBC_WRITES_PER_MINUTE = 30;
let rbcSchemaReady = null;

function rbcNow() { return Date.now(); }
function rbcIso(ms) { return new Date(ms).toISOString(); }
function rbcId(prefix, n = 16) {
  const abc = "abcdefghijkmnpqrstuvwxyz23456789", b = crypto.getRandomValues(new Uint8Array(n));
  return prefix + [...b].map((x) => abc[x % 32]).join("");
}
function rbcRefCode() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", b = crypto.getRandomValues(new Uint8Array(8));
  return [...b].map((x) => abc[x % 32]).join("");
}
// Unbiased whole number in [0, n) from crypto.getRandomValues.
function rbcRandInt(n) {
  const limit = Math.floor(4294967296 / n) * n, buf = new Uint32Array(1);
  for (;;) { crypto.getRandomValues(buf); if (buf[0] < limit) return buf[0] % n; }
}
function rbcLaDay(ms) { return new Intl.DateTimeFormat("en-CA", { timeZone: RBC_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms)); }
function rbcLaOffsetMin(ms) {
  const name = new Intl.DateTimeFormat("en-US", { timeZone: RBC_TZ, timeZoneName: "longOffset" }).formatToParts(new Date(ms)).find((p) => p.type === "timeZoneName")?.value || "GMT";
  const m = name.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0)) : 0;
}
// The UTC instant of a Pacific wall-clock time ("YYYY-MM-DD", "HH:MM:SS").
function rbcLaInstant(ymd, hms = "00:00:00") {
  const guess = Date.parse(`${ymd}T${hms}Z`);
  let t = guess - rbcLaOffsetMin(guess) * 60000;
  t = guess - rbcLaOffsetMin(t) * 60000;
  return t;
}
// Config dates: "YYYY-MM-DD" (Pacific, start or end of that day) or a full date-time with offset.
function rbcParseWhen(v, endOfDay) {
  const s = String(v || "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return endOfDay ? rbcLaInstant(s, "23:59:59") + 999 : rbcLaInstant(s);
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(s)) return rbcLaInstant(s.slice(0, 10), (s.slice(11) + ":00").slice(0, 8));
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}
function rbcFmtWhen(ms) {
  if (ms == null) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: RBC_TZ, dateStyle: "long", timeStyle: "short" }).format(new Date(ms)) + " Pacific";
}
function rbcInt(v, d, min = 0, max = 1e6) {
  const n = Number(String(v ?? "").trim());
  return Number.isInteger(n) && n >= min && n <= max ? n : d;
}
function rbcJson(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra } });
}
function rbcEsc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

async function rbcEnsureSchema(env) {
  try {
    const row = await env.DB.prepare("SELECT version FROM router_schema WHERE id = 'rb-collect'").first();
    if (row?.version === RBC_SCHEMA_VERSION) return;
  } catch {}
  await env.DB.batch(RB_COLLECT_SCHEMA.map((sql) => env.DB.prepare(sql)));
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS router_schema (id TEXT PRIMARY KEY, version TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')))").run();
  await env.DB.prepare("INSERT INTO router_schema (id, version, applied_at) VALUES ('rb-collect', ?, datetime('now')) ON CONFLICT(id) DO UPDATE SET version = excluded.version, applied_at = excluded.applied_at").bind(RBC_SCHEMA_VERSION).run();
}

// ---------------------------------------------------------------- the live configuration
async function rbcLoad(env) {
  const [cfgRows, prizeRows, pieceRows] = await env.DB.batch([
    env.DB.prepare("SELECT key, value FROM reward_config"),
    env.DB.prepare("SELECT set_key, set_label, name, description, quantity, remaining, status, sort_order, image_url FROM reward_prizes ORDER BY sort_order, id"),
    env.DB.prepare("SELECT piece_key, set_key, label, rare, sort_order FROM reward_pieces ORDER BY set_key, sort_order, piece_key"),
  ]);
  const cfg = { ...RBC_DEFAULTS };
  for (const r of cfgRows.results || []) if (r.key in cfg && r.value != null) cfg[r.key] = String(r.value);
  const n = (k, min = 0, max = 1000) => rbcInt(cfg[k], Number(RBC_DEFAULTS[k]), min, max);
  const amounts = { daily: n("plays_daily"), welcome: n("plays_welcome"), signup: n("plays_signup"), membership: n("plays_membership_request"), memberDaily: n("plays_member_daily"),
    per5: n("plays_per_5_dollars_given"), contribCap: n("contribution_cap", 0, 100000), per10: n("plays_per_10_dollars_spent"), orderCap: n("order_cap", 0, 100000),
    referral: n("plays_referral"), referralCap: n("referral_cap_month", 0, 100000) };
  const rareOdds = rbcInt(cfg.rare_odds, 50, 2, 1e6);
  const pieces = pieceRows.results || [];
  const sets = (prizeRows.results || []).map((p) => ({ ...p, quantity: Number(p.quantity) || 0, remaining: Math.max(0, Number(p.remaining) || 0),
    pieces: pieces.filter((x) => x.set_key === p.set_key).map((x) => ({ piece_key: x.piece_key, label: x.label, rare: Number(x.rare) ? 1 : 0 })) }))
    .filter((s) => s.pieces.length);
  const live = sets.filter((s) => s.status === "live");
  const drawable = live.filter((s) => s.remaining > 0 && s.pieces.some((x) => x.rare) && s.pieces.some((x) => !x.rare));
  const now = rbcNow(), start = rbcParseWhen(cfg.starts_at, false), end = rbcParseWhen(cfg.ends_at, true);
  let status;
  if (String(cfg.enabled).trim().toLowerCase() !== "on" || !live.length) status = "off";
  else if (start != null && now < start) status = "soon";
  else if (end != null && now > end) status = "ended";
  else if (!drawable.length) status = "claimed_out";
  else status = "live";
  return { cfg, amounts, rareOdds, sets, live, drawable, start, end, status, on: String(cfg.enabled).trim().toLowerCase() === "on" };
}

const RBC_MESSAGES = {
  off: "RB Collect is coming soon. Nothing to play yet.",
  soon: "RB Collect opens soon.",
  ended: "RB Collect has ended. Thanks for playing.",
  claimed_out: "Every prize in this round has been claimed.",
  live: "RB Collect is on.",
};

// Exact per-play odds for the sets in the draw right now (see the official rules).
function rbcOdds(g) {
  const N = g.drawable.length, R = g.rareOdds;
  if (!N) return { sets_in_draw: 0, rare_odds: R, pieces: [] };
  const out = [];
  for (const s of g.drawable) {
    const commons = s.pieces.filter((x) => !x.rare), rares = s.pieces.filter((x) => x.rare);
    for (const x of rares) out.push({ set_key: s.set_key, piece_key: x.piece_key, label: x.label, rare: 1, num: 1, den: N * R * rares.length });
    for (const x of commons) out.push({ set_key: s.set_key, piece_key: x.piece_key, label: x.label, rare: 0, num: R - 1, den: N * R * commons.length });
  }
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  for (const o of out) { const d = gcd(o.num, o.den); o.num /= d; o.den /= d; o.percent = Math.round((o.num / o.den) * 1e6) / 1e4; }
  return { sets_in_draw: N, rare_odds: R, pieces: out };
}

function rbcEarnList(g) {
  const a = g.amounts, list = [];
  const add = (key, label, plays, detail, href) => { if (plays > 0) list.push({ key, label, plays, detail, href: href || null }); };
  add("daily", "Free play every day", a.daily, `${a.daily} free ${a.daily === 1 ? "play" : "plays"} every day you sign in. Resets at midnight Pacific. No purchase or membership needed.`);
  add("welcome", "Welcome", a.welcome, `${a.welcome} plays the first time you sign in.`);
  add("signup", "Join the RB list", a.signup, `${a.signup} plays, one time, when your verified email is on the RB list. Free.`);
  add("membership", "Join a membership", a.membership, `${a.membership} plays, one time per membership level, when you join a waitlist or apply.`, "/memberships");
  add("member_daily", "Active RB Studio membership", a.memberDaily, `${a.memberDaily} extra plays every day while your RB Studio membership is active.`, "/memberships");
  add("contribution", "Support RB", a.per5, `${a.per5} plays for every $5 you give (up to ${a.contribCap} plays per contribution).`, "/fund");
  add("order", "Shop the RB store", a.per10, `${a.per10} ${a.per10 === 1 ? "play" : "plays"} for every $10 spent (up to ${a.orderCap} plays per order).`, "/store");
  add("referral", "Invite a friend", a.referral, `${a.referral} plays when someone new signs in through your link (up to ${a.referralCap} referral plays a month).`);
  list.push({ key: "code", label: "Codes at RB shows and shoots", plays: null, detail: "RB may hand out codes at shows, photoshoots and events. Each code works once per player.", href: null });
  return list;
}

function rbcPublicState(g) {
  const sets = (g.status === "off" ? g.sets : g.live).map((s) => ({
    set_key: s.set_key, set_label: s.set_label, pieces: s.pieces,
    prize: s.status === "live" ? { name: s.name, description: s.description || "", quantity: s.quantity, remaining: s.remaining, image_url: s.image_url || null } : null,
    in_draw: g.drawable.some((d) => d.set_key === s.set_key),
  }));
  return {
    ok: true, name: "RB Collect", status: g.status, live: g.status === "live", message: RBC_MESSAGES[g.status],
    starts_at: g.start != null ? rbcIso(g.start) : null, ends_at: g.end != null ? rbcIso(g.end) : null,
    starts_label: rbcFmtWhen(g.start), ends_label: rbcFmtWhen(g.end), eligibility: g.cfg.eligibility, claim_how: g.cfg.claim_how,
    sets, earn: g.status === "off" ? [] : rbcEarnList(g), odds: g.status === "live" ? rbcOdds(g) : null, rules_url: "/rewards/rules",
    no_purchase: "No purchase or membership necessary. Free play every day.",
  };
}

// ---------------------------------------------------------------- players
function rbcPublishableDomain(key) {
  try { const d = atob(String(key || "").split("_")[2] || "").replace(/\$$/, ""); return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d) ? d : null; } catch { return null; }
}

async function rbcVerifiedEmail(env, userId) {
  if (!env.CLERK_SECRET_KEY) throw Object.assign(new Error("Sign-in is not configured yet."), { status: 503 });
  const res = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`, { headers: { Authorization: `Bearer ${env.CLERK_SECRET_KEY}` } });
  if (!res.ok) throw Object.assign(new Error("Your account could not be checked right now. Try again shortly."), { status: 503 });
  const u = await res.json();
  const list = Array.isArray(u?.email_addresses) ? u.email_addresses : [];
  const primary = list.find((e) => e.id === u.primary_email_address_id);
  const ok = (e) => e && e.verification && e.verification.status === "verified" && e.email_address;
  return ok(primary) ? String(primary.email_address).trim().toLowerCase() : null;
}

function rbcCookie(request, name) {
  const m = (request.headers.get("Cookie") || "").match(new RegExp("(?:^|;\\s*)" + name + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : null;
}

async function rbcPlayer(request, env) {
  const session = await verifyClerkSession(request, env);
  if (!session.ok) throw Object.assign(new Error(session.error || "Sign in is required."), { status: session.status || 401 });
  const userId = session.userId, now = rbcNow();
  let p = await env.DB.prepare("SELECT * FROM reward_players WHERE clerk_user_id = ?").bind(userId).first();
  if (p && p.email_norm && p.email_at && now - Date.parse(p.email_at) < 864e5) return p;
  const email = await rbcVerifiedEmail(env, userId);
  if (!email) throw Object.assign(new Error("Verify the email on your account to play RB Collect."), { status: 403 });
  if (p) {
    await env.DB.prepare("UPDATE reward_players SET email_norm = ?, email_at = ? WHERE id = ?").bind(email, rbcIso(now), p.id).run();
    return { ...p, email_norm: email, email_at: rbcIso(now) };
  }
  // A new player: a referral counts only from someone else (another account and another email).
  let referredBy = null;
  const ref = String(rbcCookie(request, "rb_ref") || "").toUpperCase();
  if (/^[A-Z0-9]{6,12}$/.test(ref)) {
    const r = await env.DB.prepare("SELECT id, clerk_user_id, email_norm FROM reward_players WHERE ref_code = ?").bind(ref).first();
    if (r && r.clerk_user_id !== userId && r.email_norm !== email) referredBy = r.id;
  }
  for (let i = 0; i < 4; i++) {
    const id = rbcId("p_", 14), code = rbcRefCode();
    const res = await env.DB.prepare("INSERT OR IGNORE INTO reward_players (id, clerk_user_id, email_norm, email_at, ref_code, referred_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(id, userId, email, rbcIso(now), code, referredBy, rbcIso(now)).run();
    p = await env.DB.prepare("SELECT * FROM reward_players WHERE clerk_user_id = ?").bind(userId).first();
    if (p) return p;
    if (res.meta?.changes) break;
  }
  throw Object.assign(new Error("Your player could not be set up. Try again."), { status: 503 });
}

// The membership requests rb-memberships records (options column) and the tier each one is.
const RBC_TIERS = { "membership:free:passport": "passport", "membership:waitlist:just-starting": "just-starting", "membership:apply:coach": "coach",
  "membership:apply:business-starter": "business-starter", "membership:apply:business-pro": "business-pro", "membership:apply:business-elite": "business-elite" };

// ---------------------------------------------------------------- awards (pull model; every award has a unique source_ref)
async function rbcSync(env, g, p) {
  if (g.status !== "live") return 0;
  const a = g.amounts, now = rbcNow(), at = rbcIso(now), day = rbcLaDay(now), email = p.email_norm;
  const rows = [];
  const add = (source, ref, plays) => { if (plays > 0) rows.push([source, ref, plays]); };
  add("welcome", `welcome:${p.id}`, a.welcome);
  add("daily", `daily:${day}:${p.id}`, a.daily);
  const tryRead = async (fn) => { try { return await fn(); } catch { return null; } };
  if (email) {
    if (a.signup > 0 && await tryRead(() => env.DB.prepare("SELECT id FROM signups WHERE lower(trim(email)) = ? LIMIT 1").bind(email).first())) add("signup", `signup:${email}`, a.signup);
    const inq = await tryRead(() => env.DB.prepare("SELECT DISTINCT options FROM shop_inquiries WHERE lower(trim(email)) = ? AND options LIKE 'membership:%'").bind(email).all());
    // Only the real /memberships tiers count (rb-memberships saves exactly these), so made-up tiers sent to the public
    // inquiry endpoint can't mint plays: at most one award per tier, six tiers in all.
    for (const r of inq?.results || []) {
      const tier = RBC_TIERS[String(r.options || "").toLowerCase()];
      if (tier) add("membership", `membership:${tier}:${email}`, a.membership);
    }
    const orders = await tryRead(() => env.DB.prepare("SELECT id, amount_total FROM store_orders WHERE lower(trim(customer_email)) = ? AND coalesce(payment_status, 'paid') = 'paid' AND coalesce(status, 'paid') IN ('paid', 'fulfilled') AND amount_total > 0 LIMIT 500").bind(email).all());
    for (const r of orders?.results || []) add("order", `order:${r.id}`, Math.min(a.orderCap, Math.floor(Number(r.amount_total) / 1000) * a.per10));
    if (env.DONOR_DB) {
      const gifts = await tryRead(() => env.DONOR_DB.prepare("SELECT id, stripe_event_id, amount_total FROM contributions WHERE lower(trim(email)) = ? AND payment_status = 'paid' AND amount_total > 0 LIMIT 500").bind(email).all());
      for (const r of gifts?.results || []) add("contribution", `contrib:${r.stripe_event_id || r.id}`, Math.min(a.contribCap, Math.floor(Number(r.amount_total) / 500) * a.per5));
    }
  }
  if (a.memberDaily > 0 && await tryRead(() => env.DB.prepare("SELECT 1 AS ok FROM studio_memberships WHERE clerk_user_id = ? AND status = 'active' AND (current_period_end IS NULL OR datetime(current_period_end) > datetime('now')) LIMIT 1").bind(p.clerk_user_id).first())) {
    add("member_daily", `member:${day}:${p.id}`, a.memberDaily);
  }
  const stmts = rows.map(([source, ref, plays]) => env.DB.prepare("INSERT OR IGNORE INTO reward_awards (id, player_id, source, source_ref, plays, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(rbcId("a_"), p.id, source, ref, plays, at));
  // Referral: the referrer gets plays once per new player, within the monthly cap (checked in the same statement).
  if (p.referred_by && a.referral > 0) {
    const monthStart = rbcIso(rbcLaInstant(day.slice(0, 7) + "-01"));
    stmts.push(env.DB.prepare("INSERT OR IGNORE INTO reward_awards (id, player_id, source, source_ref, plays, created_at) SELECT ?, ?, 'referral', ?, ?, ? WHERE (SELECT coalesce(sum(plays), 0) FROM reward_awards WHERE player_id = ? AND source = 'referral' AND created_at >= ?) + ? <= ?")
      .bind(rbcId("a_"), p.referred_by, `ref:${p.id}`, a.referral, at, p.referred_by, monthStart, a.referral, a.referralCap));
  }
  stmts.push(env.DB.prepare("UPDATE reward_players SET daily_at = ? WHERE id = ?").bind(day, p.id));
  const res = await env.DB.batch(stmts);
  return res.slice(0, rows.length).reduce((n, r, i) => n + (r.meta?.changes ? rows[i][2] : 0), 0);
}

async function rbcBalance(env, playerId) {
  const r = await env.DB.prepare("SELECT (SELECT coalesce(sum(plays), 0) FROM reward_awards WHERE player_id = ?) - (SELECT count(*) FROM reward_draws WHERE player_id = ?) AS plays").bind(playerId, playerId).first();
  return Math.max(0, Number(r?.plays) || 0);
}

async function rbcMe(env, g, p) {
  const [pieces, claims, awards, draws] = await env.DB.batch([
    env.DB.prepare("SELECT piece_key, count(*) AS n FROM reward_draws WHERE player_id = ? GROUP BY piece_key").bind(p.id),
    env.DB.prepare("SELECT id, set_key, status, created_at FROM reward_claims WHERE player_id = ? ORDER BY created_at").bind(p.id),
    env.DB.prepare("SELECT source, plays, created_at FROM reward_awards WHERE player_id = ? ORDER BY created_at DESC LIMIT 25").bind(p.id),
    env.DB.prepare("SELECT d.piece_key, d.set_key, d.rare, d.created_at, x.label FROM reward_draws d LEFT JOIN reward_pieces x ON x.piece_key = d.piece_key WHERE d.player_id = ? ORDER BY d.created_at DESC LIMIT 25").bind(p.id),
  ]);
  const owned = Object.fromEntries((pieces.results || []).map((r) => [r.piece_key, Number(r.n)]));
  const history = [...(awards.results || []).map((r) => ({ kind: "award", source: r.source, plays: Number(r.plays), at: r.created_at })),
    ...(draws.results || []).map((r) => ({ kind: "draw", set_key: r.set_key, piece_key: r.piece_key, label: r.label, rare: Number(r.rare), at: r.created_at }))]
    .sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0)).slice(0, 30);
  const [user, domain] = String(p.email_norm || "").split("@");
  return {
    ok: true, player: { ref_code: p.ref_code, email: user ? `${user.slice(0, 2)}${"•".repeat(Math.max(1, Math.min(6, user.length - 2)))}@${domain}` : null },
    plays: await rbcBalance(env, p.id), pieces: owned, claims: (claims.results || []).map((c) => ({ id: c.id, set_key: c.set_key, status: c.status, created_at: c.created_at })),
    history, today: rbcLaDay(rbcNow()),
  };
}

async function rbcRateOk(env, playerId) {
  const minute = rbcIso(rbcNow()).slice(0, 16);
  await env.DB.prepare("DELETE FROM reward_rate WHERE player_id = ? AND minute < ?").bind(playerId, minute).run();
  const row = await env.DB.prepare("INSERT INTO reward_rate (player_id, minute, n) VALUES (?, ?, 1) ON CONFLICT(player_id, minute) DO UPDATE SET n = n + 1 RETURNING n").bind(playerId, minute).first();
  return Number(row?.n || 0) <= RBC_WRITES_PER_MINUTE;
}

// ---------------------------------------------------------------- play, claim, code
const RBC_HAS_PLAY = "(SELECT coalesce(sum(plays), 0) FROM reward_awards WHERE player_id = ?) > (SELECT count(*) FROM reward_draws WHERE player_id = ?)";
// A rare piece is drawable only while the prize has more units left than rare pieces already held by players who have
// not claimed that set yet, so every rare piece drawn can still be claimed. One rare piece per set per player.
const RBC_RARE_OK = " AND NOT EXISTS (SELECT 1 FROM reward_claims WHERE player_id = ? AND set_key = ?)"
  + " AND NOT EXISTS (SELECT 1 FROM reward_draws WHERE player_id = ? AND set_key = ? AND rare = 1)"
  + " AND (SELECT remaining FROM reward_prizes WHERE set_key = ? AND status = 'live') > (SELECT count(DISTINCT d.player_id) FROM reward_draws d WHERE d.set_key = ? AND d.rare = 1 AND NOT EXISTS (SELECT 1 FROM reward_claims c WHERE c.player_id = d.player_id AND c.set_key = d.set_key))";

async function rbcPlay(env, g, p) {
  const N = g.drawable.length, R = g.rareOdds, at = rbcIso(rbcNow());
  if (!N) return rbcJson({ ok: false, error: RBC_MESSAGES.claimed_out }, 403);
  // Pick a set uniformly, then a rare piece with chance 1 in R, otherwise one of its common pieces (see rbcOdds).
  const set = g.drawable[rbcRandInt(N)], rares = set.pieces.filter((x) => x.rare), commons = set.pieces.filter((x) => !x.rare);
  let piece = rbcRandInt(R) === 0 ? rares[rbcRandInt(rares.length)] : commons[rbcRandInt(commons.length)];
  const insert = (pc, extra, binds) => env.DB.prepare(`INSERT INTO reward_draws (id, player_id, set_key, piece_key, rare, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE ${RBC_HAS_PLAY}${extra}`)
    .bind(rbcId("d_"), p.id, set.set_key, pc.piece_key, pc.rare, at, p.id, p.id, ...binds).run();
  let res = null;
  if (piece.rare) {
    res = await insert(piece, RBC_RARE_OK, [p.id, set.set_key, p.id, set.set_key, set.set_key, set.set_key]);
    if (!res.meta?.changes) { piece = commons[rbcRandInt(commons.length)]; res = null; }
  }
  if (!res) res = await insert(piece, "", []);
  if (!res.meta?.changes) return rbcJson({ ok: false, error: "You're out of plays. Your free play comes back at midnight Pacific." }, 409);
  const have = await env.DB.prepare("SELECT count(DISTINCT piece_key) AS n FROM reward_draws WHERE player_id = ? AND set_key = ?").bind(p.id, set.set_key).first();
  return rbcJson({ ok: true, draw: { set_key: set.set_key, set_label: set.set_label, piece_key: piece.piece_key, label: piece.label, rare: piece.rare, set_complete: Number(have?.n) >= set.pieces.length }, plays: await rbcBalance(env, p.id) });
}

async function rbcClaim(env, g, p, body) {
  const setKey = String(body?.set || "");
  const set = g.live.find((s) => s.set_key === setKey);
  if (!set) return rbcJson({ ok: false, error: "That set isn't in the game." }, 404);
  const prior = await env.DB.prepare("SELECT id, status FROM reward_claims WHERE player_id = ? AND set_key = ?").bind(p.id, setKey).first();
  if (prior) return rbcJson({ ok: false, error: "You've already claimed this prize. One prize per set per person.", claim: prior }, 409);
  const have = await env.DB.prepare("SELECT count(DISTINCT piece_key) AS n FROM reward_draws WHERE player_id = ? AND set_key = ?").bind(p.id, setKey).first();
  if (Number(have?.n) < set.pieces.length) return rbcJson({ ok: false, error: "Collect every piece of this set first." }, 409);
  const id = rbcId("c_"), at = rbcIso(rbcNow());
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO reward_claims (id, player_id, set_key, status, email, created_at, updated_at) SELECT ?, ?, ?, 'requested', ?, ?, ? WHERE (SELECT remaining FROM reward_prizes WHERE set_key = ? AND status = 'live') > 0 AND (SELECT count(DISTINCT piece_key) FROM reward_draws WHERE player_id = ? AND set_key = ?) >= (SELECT count(*) FROM reward_pieces WHERE set_key = ?)")
      .bind(id, p.id, setKey, p.email_norm, at, at, setKey, p.id, setKey, setKey),
    env.DB.prepare("UPDATE reward_prizes SET remaining = remaining - 1, updated_at = ? WHERE set_key = ? AND remaining > 0 AND EXISTS (SELECT 1 FROM reward_claims WHERE id = ?)").bind(at, setKey, id),
  ]);
  const claim = await env.DB.prepare("SELECT id, set_key, status, created_at FROM reward_claims WHERE id = ?").bind(id).first();
  if (!claim) return rbcJson({ ok: false, error: "Every unit of this prize has been claimed." }, 409);
  const left = await env.DB.prepare("SELECT remaining FROM reward_prizes WHERE set_key = ?").bind(setKey).first();
  return rbcJson({ ok: true, claim, remaining: Number(left?.remaining) || 0, message: g.cfg.claim_how });
}

async function rbcCode(env, g, p, body) {
  const code = String(body?.code || "").toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9-]{3,40}$/.test(code)) return rbcJson({ ok: false, error: "That code doesn't look right." }, 400);
  const row = await env.DB.prepare("SELECT code, plays, max_uses, uses, expires_at FROM reward_codes WHERE code = ?").bind(code).first();
  if (!row || !(Number(row.plays) > 0)) return rbcJson({ ok: false, error: "That code isn't valid." }, 404);
  const exp = rbcParseWhen(row.expires_at, true);
  if (exp != null && rbcNow() > exp) return rbcJson({ ok: false, error: "That code has expired." }, 410);
  const ref = `code:${code}:${p.id}`;
  if (await env.DB.prepare("SELECT 1 AS ok FROM reward_awards WHERE source_ref = ?").bind(ref).first()) return rbcJson({ ok: false, error: "You've already used this code." }, 409);
  const id = rbcId("a_"), at = rbcIso(rbcNow());
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO reward_awards (id, player_id, source, source_ref, plays, created_at) SELECT ?, ?, 'code', ?, plays, ? FROM reward_codes WHERE code = ? AND uses < max_uses").bind(id, p.id, ref, at, code),
    env.DB.prepare("UPDATE reward_codes SET uses = uses + 1 WHERE code = ? AND EXISTS (SELECT 1 FROM reward_awards WHERE id = ?)").bind(code, id),
  ]);
  const got = await env.DB.prepare("SELECT plays FROM reward_awards WHERE id = ?").bind(id).first();
  if (!got) return rbcJson({ ok: false, error: "This code has been used up." }, 409);
  return rbcJson({ ok: true, plays_added: Number(got.plays), plays: await rbcBalance(env, p.id) });
}

// ---------------------------------------------------------------- pages
function rbcNonce() { return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16)))).replace(/[+/=]/g, ""); }
function rbcCsp(env, nonce) {
  const fapi = rbcPublishableDomain(env.CLERK_PUBLISHABLE_KEY);
  const clerk = [...new Set([fapi ? "https://" + fapi : null, "https://clerk.relentlessbillionaire.com", "https://*.clerk.accounts.dev"].filter(Boolean))].join(" ");
  // Clerk's sign-in UI adds its own <style> tags at runtime, so styles allow 'unsafe-inline' (a nonce there would switch it off);
  // scripts stay nonce-only plus the Clerk and Turnstile hosts.
  return ["default-src 'self'", `script-src 'nonce-${nonce}' ${clerk} https://challenges.cloudflare.com`, "style-src 'self' 'unsafe-inline'", "font-src https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:", `connect-src 'self' ${clerk} https://clerk-telemetry.com`, `frame-src https://challenges.cloudflare.com ${clerk}`, "worker-src 'self' blob:",
    "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'self'"].join("; ");
}
function rbcPageHeaders(env, nonce, extra = {}) {
  return { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": rbcCsp(env, nonce),
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()", "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff", "X-Frame-Options": "SAMEORIGIN", ...extra };
}
const rbcScriptJson = (v) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

async function rbcBoardPage(request, env, url) {
  const g = await rbcLoad(env), nonce = rbcNonce(), state = rbcPublicState(g);
  const html = RB_COLLECT_HTML.replaceAll("__NONCE__", nonce).replace("__STATUS__", () => rbcEsc(g.status))
    .replace("__CLERK_KEY__", () => rbcScriptJson(String(env.CLERK_PUBLISHABLE_KEY || ""))).replace("__STATE__", () => rbcScriptJson(state));
  const extra = {};
  const ref = String(url.searchParams.get("ref") || "").toUpperCase();
  if (/^[A-Z0-9]{6,12}$/.test(ref)) extra["Set-Cookie"] = `rb_ref=${ref}; Path=/; Max-Age=2592000; SameSite=Lax; Secure`;
  return new Response(request.method === "HEAD" ? null : html, { headers: rbcPageHeaders(env, nonce, extra) });
}

function rbcFrac(o) { return o.num === 1 ? `1 in ${o.den.toLocaleString("en-US")}` : `${o.num.toLocaleString("en-US")} in ${o.den.toLocaleString("en-US")}`; }

async function rbcRulesPage(request, env) {
  const g = await rbcLoad(env), nonce = rbcNonce(), a = g.amounts, odds = rbcOdds(g), e = rbcEsc;
  const prizes = g.live.length
    ? `<table><thead><tr><th>Set</th><th>Prize</th><th>Quantity</th><th>Remaining</th></tr></thead><tbody>${g.live.map((s) => `<tr><td>${e(s.set_label)}</td><td><b>${e(s.name)}</b>${s.description ? `<br><span class="m">${e(s.description)}</span>` : ""}</td><td>${s.quantity}</td><td>${s.remaining}</td></tr>`).join("")}</tbody></table>`
    : `<p>No prizes are live yet. This section lists each prize, how many there are and how many remain once the owner publishes them.</p>`;
  const pieceList = g.live.map((s) => `<li><b>${e(s.set_label)}</b>: ${s.pieces.map((x) => e(x.label) + (x.rare ? " ★ (rare)" : "")).join(", ")}</li>`).join("");
  const oddsHtml = odds.pieces.length
    ? `<p>Each play draws one piece. Right now ${odds.sets_in_draw} ${odds.sets_in_draw === 1 ? "set is" : "sets are"} in the draw and the rare-piece setting is 1 in ${g.rareOdds}, so the odds for each play are:</p><table><thead><tr><th>Set</th><th>Piece</th><th>Odds per play</th><th>Percent</th></tr></thead><tbody>${odds.pieces.map((o) => `<tr><td>${e(g.drawable.find((s) => s.set_key === o.set_key)?.set_label)}</td><td>${e(o.label)}${o.rare ? " ★" : ""}</td><td>${rbcFrac(o)}</td><td>${o.percent}%</td></tr>`).join("")}</tbody></table>
<p>Only sets whose prize has at least one unit remaining are in the draw. When a prize runs out, its set leaves the draw and the odds above change; this page always shows the current odds. A rare piece is only given while its prize has more units left than rare pieces already held (and not yet claimed) for that set, and each player can hold one rare piece per set. When a draw lands on a rare piece that can't be given for those reasons, it gives one of that set's other pieces instead. Every play has the same odds however it was earned. Your chance of completing a set depends on how many plays you use.</p>`
    : `<p>The odds per play are shown here once prizes are live. They come from the rare-piece setting (currently 1 in ${g.rareOdds}) and the number of sets in the draw.</p>`;
  const earn = rbcEarnList(g).map((x) => `<li><b>${e(x.label)}</b>: ${e(x.detail)}</li>`).join("");
  const dates = `<p>Start: ${g.start != null ? e(rbcFmtWhen(g.start)) : "not set yet"}. End: ${g.end != null ? e(rbcFmtWhen(g.end)) : "not set yet"}.</p>${g.status === "live" ? "" : `<p>Current status: ${e(RBC_MESSAGES[g.status])}</p>`}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RB Collect official rules · Relentless Billionaire</title><meta name="description" content="Official rules for RB Collect by Relentless Billionaire."><link rel="canonical" href="https://relentlessbillionaire.com/rewards/rules"><style nonce="${nonce}">
@font-face{font-family:"RB Cinzel";src:url(https://fonts.gstatic.com/s/cinzel/v26/8vIJ7ww63mVu7gt79mT7.woff2) format("woff2");font-weight:400 900;font-display:swap}
@font-face{font-family:"RB Cormorant";src:url(https://fonts.gstatic.com/s/cormorantgaramond/v21/co3bmX5slCNuHLi8bLeY9MK7whWMhyjYqXtK.woff2) format("woff2");font-weight:300 700;font-display:swap}
:root{color-scheme:dark;--bg:#07060A;--line:#2B261C;--gold:#C9A227;--gold2:#E9CF83;--text:#EFE8D8;--muted:#A79E89}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}main{max-width:820px;margin:0 auto;padding:28px 16px 64px}h1{font:600 clamp(28px,6vw,44px)/1.1 "RB Cinzel",Cinzel,Georgia,serif;color:var(--gold2);margin:8px 0 6px;letter-spacing:.04em}h2{font:600 20px/1.3 "RB Cinzel",Cinzel,Georgia,serif;color:var(--gold);margin:32px 0 8px;letter-spacing:.05em}a{color:var(--gold2)}.m{color:var(--muted);font-size:14px}.lead{font:italic 20px/1.4 "RB Cormorant",Georgia,serif;color:var(--muted)}.box{border:1px solid var(--gold);border-radius:12px;padding:14px 16px;margin:18px 0;font-weight:600}table{width:100%;border-collapse:collapse;font-size:14px;margin:8px 0;display:block;overflow-x:auto}th,td{border-bottom:1px solid var(--line);padding:8px 6px;text-align:left;vertical-align:top}th{color:var(--gold);font-weight:600}li{margin:4px 0}
</style></head><body><main><a href="/rewards">← RB Collect</a><h1>RB Collect official rules</h1><p class="lead">Collect the pieces of a set to claim its prize.</p>
<div class="box">NO PURCHASE OR MEMBERSHIP NECESSARY TO PLAY OR WIN. A purchase, donation or membership does not improve the odds of any play. Free play every day. Void where prohibited.</div>
<h2>1. Sponsor</h2><p>RB Collect is run by Relentless Billionaire ("RB"), relentlessbillionaire.com.</p>
<h2>2. Who can play</h2><p>${e(g.cfg.eligibility)}</p><p>One account per person. You need an RB account with a verified email address.</p>
<h2>3. Dates</h2>${dates}<p>Plays and draws are only available between the start and the end. A set completed before the end can still be claimed while RB Collect stays switched on and its prize has units remaining.</p>
<h2>4. How to get plays</h2><ul>${earn}</ul>${g.cfg.free_entry ? `<p><b>Free plays by request:</b> ${e(g.cfg.free_entry)}</p>` : ""}<p>Each way of earning counts once as described (a contribution, order or membership request is never counted twice). Plays have no cash value and can't be sold or transferred.</p>
<h2>5. Prizes</h2>${prizes}
<h2>6. Sets and pieces</h2>${pieceList ? `<ul>${pieceList}</ul>` : "<p>Sets are listed here once prizes are live.</p>"}<p>Collect every piece of a set (★ marks the rare piece) to claim that set's prize.</p>
<h2>7. Odds</h2>${oddsHtml}
<h2>8. How to claim</h2><p>${e(g.cfg.claim_how)}</p><p>One prize per set per person. Prizes are given while units remain.</p>
<h2>9. Verification</h2><p>RB may verify a player's identity, age and eligibility before giving a prize, and may refuse or cancel plays or claims that come from duplicate accounts, automation, fraud or a breach of these rules.</p>
<h2>10. General</h2><p>Void where prohibited or restricted by law. RB may change or end RB Collect, with any change shown on this page. Your information is handled as described in the <a href="/privacy">privacy policy</a>; the <a href="/terms">terms</a> also apply.</p>
</main></body></html>`;
  return new Response(request.method === "HEAD" ? null : html, { headers: rbcPageHeaders(env, nonce) });
}

// ---------------------------------------------------------------- router
async function rbRewardsRoute(request, env, url) {
  const path = url.pathname.replace(/\/+$/, "") || "/", method = request.method;
  const page = method === "GET" || method === "HEAD";
  if (!["/rewards", "/rewards/rules"].includes(path) && !path.startsWith("/api/rewards/")) return null;
  try {
    await (rbcSchemaReady ||= rbcEnsureSchema(env).catch((err) => { rbcSchemaReady = null; throw err; }));
    if (path === "/rewards" && page) return await rbcBoardPage(request, env, url);
    if (path === "/rewards/rules" && page) return await rbcRulesPage(request, env);
    if (path === "/api/rewards/state" && method === "GET") return rbcJson(rbcPublicState(await rbcLoad(env)));
    const g = await rbcLoad(env);
    if (path === "/api/rewards/me" && method === "GET") {
      const p = await rbcPlayer(request, env);
      const added = await rbcSync(env, g, p);
      return rbcJson({ ...(await rbcMe(env, g, p)), added, state: rbcPublicState(g) });
    }
    if (method === "POST" && ["/api/rewards/play", "/api/rewards/claim", "/api/rewards/code"].includes(path)) {
      const origin = request.headers.get("Origin");
      if (origin && origin !== url.origin) return rbcJson({ ok: false, error: "Not allowed from another site." }, 403);
      if (!/^application\/json/i.test(request.headers.get("Content-Type") || "")) return rbcJson({ ok: false, error: "Send JSON." }, 415);
      const body = await request.json().catch(() => ({}));
      const p = await rbcPlayer(request, env);
      if (!(await rbcRateOk(env, p.id))) return rbcJson({ ok: false, error: "Too many tries. Wait a minute and try again." }, 429, { "Retry-After": "60" });
      if (path === "/api/rewards/claim") {
        if (!g.on || g.status === "off" || g.status === "soon") return rbcJson({ ok: false, error: RBC_MESSAGES[g.status === "soon" ? "soon" : "off"] }, 403);
        return await rbcClaim(env, g, p, body);
      }
      if (g.status !== "live") return rbcJson({ ok: false, error: RBC_MESSAGES[g.status] }, 403);
      if (p.daily_at !== rbcLaDay(rbcNow())) await rbcSync(env, g, p); // today's free play, if not given yet
      return path === "/api/rewards/play" ? await rbcPlay(env, g, p) : await rbcCode(env, g, p, body);
    }
    return rbcJson({ ok: false, error: "Not found" }, path.startsWith("/api/") ? 404 : 405);
  } catch (err) {
    const status = Number(err?.status) || 500;
    if (status >= 500 && status !== 503) console.error("rb-collect", err?.stack || err);
    if (page && !path.startsWith("/api/")) return new Response("RB Collect is unavailable right now. Please try again shortly.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
    return rbcJson({ ok: false, error: status === 500 ? "Something went wrong. Please try again." : err.message }, status);
  }
}
