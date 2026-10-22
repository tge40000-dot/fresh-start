// RB Badge: the member pass (/badge), its terms (/badge/terms) and its API (/api/badge/*).
// Embedded into artist-router-v14.js by rb-site-updates/patch_badge.py, after RB Collect (it reuses rbcCsp, rbcLaDay,
// rbcId, rbcJson, rbcEsc, RBC_TIERS and the bundle's verifyClerkSession), together with RB_BADGE_HTML (badge.html),
// RB_BADGE_SCHEMA (schema.sql) and rbbQrcode (rb-tools/vendor/qrcode-generator-2.0.4.js, MIT).
// Points are a ledger (badge_points, one row per award with a unique source_ref, so nothing counts twice):
//   lifetime = everything earned (minus hand removals), which sets the level; balance = lifetime minus redemptions.
// The door desk in RB Command (badgedesk.js) checks members in by scanning the QR on their pass, which carries a token
// signed with the member's own pass_secret and good for RBB_TOKEN_MINUTES, so a screenshot stops working.
const RBB_SCHEMA_VERSION = "rb-badge-4";
const RBB_DEFAULTS = { enabled: "off", eligibility: "Open to anyone with an RB account and a verified email address.", redeem_how: "",
  points_welcome: "50", points_daily: "5", points_signup: "25", points_membership_request: "50", points_per_dollar_spent: "10", order_cap: "5000",
  points_per_dollar_given: "10", contribution_cap: "5000", points_member_month: "100", points_release: "100", points_event_listed: "50", points_collect: "50",
  checkin_points: "100", checkin_max: "1000", adjust_max: "10000", game_points_round: "20", game_score_per_point: "10", game_points_daily: "60", game_rounds_daily: "25", world_points_block: "5", world_block_minutes: "10", world_points_daily: "30", world_open: "on" };
const RBB_TOKEN_MINUTES = 10;
const RBB_WRITES_PER_MINUTE = 20;
// Where each achievement rule counts from: the ledger source it counts rows of.
const RBB_RULE_SOURCE = { checkins: "checkin", signup: "signup", membership: "membership", orders: "order", contributions: "contribution", member: "member_month", release: "release", event_listed: "event_listed", collect: "collect" };
const RBB_SOURCES = { welcome: "Welcome", daily: "Opened your badge", signup: "Joined the RB list", membership: "Membership request", order: "Store order", contribution: "Gave at /fund",
  member_month: "RB Studio membership", release: "Song approved on RB Release", event_listed: "Event listed on RB Events", collect: "RB Collect prize", checkin: "Checked in",
  adjust: "From the RB team", redeem: "Redeemed", refund: "Points returned", game: "RB Gold Rush", world: "Played RB World" };
let rbbSchemaReady = null;

async function rbbEnsureSchema(env) {
  try {
    const row = await env.DB.prepare("SELECT version FROM router_schema WHERE id = 'rb-badge'").first();
    if (row?.version === RBB_SCHEMA_VERSION) return;
  } catch {}
  await env.DB.batch(RB_BADGE_SCHEMA.map((sql) => env.DB.prepare(sql)));
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS router_schema (id TEXT PRIMARY KEY, version TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT (datetime('now')))").run();
  await env.DB.prepare("INSERT INTO router_schema (id, version, applied_at) VALUES ('rb-badge', ?, datetime('now')) ON CONFLICT(id) DO UPDATE SET version = excluded.version, applied_at = excluded.applied_at").bind(RBB_SCHEMA_VERSION).run();
}

function rbbInt(v, d, min = 0, max = 1e7) {
  const n = Number(String(v ?? "").trim());
  return Number.isInteger(n) && n >= min && n <= max ? n : d;
}
const rbbDraft = (s) => /^\s*DRAFT:/i.test(String(s || ""));

// ---------------------------------------------------------------- the live configuration
async function rbbLoad(env) {
  const [cfgRows, levelRows, rewardRows, achRows] = await env.DB.batch([
    env.DB.prepare("SELECT key, value FROM badge_config"),
    env.DB.prepare("SELECT level_key, name, min_points, perks, status, sort_order FROM badge_levels ORDER BY min_points, sort_order, id"),
    env.DB.prepare("SELECT id, name, description, cost, quantity, remaining, min_level, status, sort_order, image_url FROM badge_rewards ORDER BY sort_order, cost, id"),
    env.DB.prepare("SELECT key, name, description, rule, threshold, status, sort_order FROM badge_achievements ORDER BY sort_order, key"),
  ]);
  const cfg = { ...RBB_DEFAULTS };
  for (const r of cfgRows.results || []) if (r.key in cfg && r.value != null) cfg[r.key] = String(r.value);
  const n = (k, max = 1e6) => rbbInt(cfg[k], Number(RBB_DEFAULTS[k]), 0, max);
  const amounts = { welcome: n("points_welcome"), daily: n("points_daily"), signup: n("points_signup"), membership: n("points_membership_request"),
    perDollarSpent: n("points_per_dollar_spent"), orderCap: n("order_cap"), perDollarGiven: n("points_per_dollar_given"), contribCap: n("contribution_cap"),
    memberMonth: n("points_member_month"), release: n("points_release"), eventListed: n("points_event_listed"), collect: n("points_collect"),
    checkin: n("checkin_points"), checkinMax: n("checkin_max"), adjustMax: n("adjust_max"),
    gameRound: n("game_points_round"), gamePerPoint: Math.max(1, n("game_score_per_point")), gameDaily: n("game_points_daily"), gameRounds: n("game_rounds_daily", 1000),
    worldBlock: n("world_points_block"), worldBlockMinutes: n("world_block_minutes", 1440), worldDaily: n("world_points_daily") };
  // Only live levels with real perks count; Draft text never reaches members.
  const levels = (levelRows.results || []).filter((l) => l.status === "live" && !rbbDraft(l.perks)).map((l) => ({ key: l.level_key, name: l.name, min: Math.max(0, Number(l.min_points) || 0), perks: String(l.perks || "") }));
  const rewards = (rewardRows.results || []).filter((r) => r.status === "live" && !rbbDraft(r.description) && Number(r.cost) > 0)
    .map((r) => ({ id: Number(r.id), name: r.name, description: r.description || "", cost: Number(r.cost), remaining: Math.max(0, Number(r.remaining) || 0), quantity: Number(r.quantity) || 0, min_level: r.min_level || "", image_url: r.image_url || "" }));
  const achievements = (achRows.results || []).filter((a) => a.status === "live").map((a) => ({ key: a.key, name: a.name, description: a.description || "", rule: a.rule, threshold: Math.max(1, Number(a.threshold) || 1) }));
  const on = String(cfg.enabled).trim().toLowerCase() === "on" && levels.length > 0;
  // Upcoming RB Events, for the app (none if that table isn't there).
  let events = [];
  if (on) {
    try {
      const r = await env.DB.prepare("SELECT id, title, starts_at, venue_name, ticket_url FROM rb_events WHERE status = 'live' AND datetime(starts_at) >= datetime('now', '-6 hours') ORDER BY datetime(starts_at) LIMIT 8").all();
      events = (r.results || []).map((e) => ({ id: e.id, title: e.title, starts_at: e.starts_at, venue: e.venue_name || "", ticket_url: /^https:\/\//.test(String(e.ticket_url || "")) ? e.ticket_url : "" }));
    } catch {}
  }
  return { cfg, amounts, levels, rewards, achievements, events, on, status: on ? "live" : "off", worldOpen: String(cfg.world_open).trim().toLowerCase() !== "off" };
}

// The level a lifetime total reaches, and the next one.
function rbbLevelFor(g, lifetime) {
  let cur = null, next = null;
  for (const l of g.levels) { if (lifetime >= l.min) cur = l; else if (!next) next = l; }
  return { level: cur, next };
}

function rbbEarnList(g) {
  const a = g.amounts, out = [];
  const add = (pts, label, detail) => { if (pts > 0) out.push({ points: pts, label, detail }); };
  add(a.welcome, "Welcome", `${a.welcome} points the first time you open your badge.`);
  add(a.daily, "Open your badge", `${a.daily} points once a day when you open your badge.`);
  add(a.checkin, "Show up", `Usually ${a.checkin} points when RB staff scan your badge at the door of an RB show or event, once per event.`);
  add(a.signup, "Join the RB list", `${a.signup} points once your verified email is on the RB list.`);
  add(a.membership, "Request a membership", `${a.membership} points for each membership tier you join or apply for at /memberships.`);
  add(a.perDollarSpent, "Shop the RB store", `${a.perDollarSpent} points per $1 of a paid order (up to ${a.orderCap.toLocaleString("en-US")} per order).`);
  add(a.perDollarGiven, "Give at /fund", `${a.perDollarGiven} points per $1 of a paid contribution (up to ${a.contribCap.toLocaleString("en-US")} per contribution).`);
  add(a.memberMonth, "Be an RB Studio member", `${a.memberMonth} points each month your RB Studio membership is active.`);
  add(a.release, "Release with RB", `${a.release} points for each song RB approves on RB Release.`);
  add(a.eventListed, "List an event", `${a.eventListed} points for each event RB publishes on RB Events.`);
  if (a.gameRound > 0 && a.gameDaily > 0) out.push({ points: a.gameRound, label: "Play RB Gold Rush", detail: `Up to ${a.gameRound} points a round in the RB app (1 point per ${a.gamePerPoint} score), up to ${a.gameDaily} a day.` });
  if (a.worldBlock > 0 && a.worldBlockMinutes > 0 && a.worldDaily > 0) out.push({ points: a.worldBlock, label: "Play RB World", detail: `${a.worldBlock} points for every ${a.worldBlockMinutes} minutes you play RB World signed in, up to ${a.worldDaily} a day.` });
  add(a.collect, "Win at RB Collect", `${a.collect} points for each RB Collect prize claim RB approves.`);
  return out;
}

function rbbPublicState(g) {
  return { status: g.status, events: g.on ? g.events || [] : [], game: g.on ? { round_max: g.amounts.gameRound, per_point: g.amounts.gamePerPoint, daily: g.amounts.gameDaily, rounds: g.amounts.gameRounds, ms: RBG_MS } : null, eligibility: g.cfg.eligibility, redeem_how: g.cfg.redeem_how,
    levels: g.on ? g.levels.map((l) => ({ key: l.key, name: l.name, min: l.min, perks: l.perks })) : [],
    rewards: g.on ? g.rewards.map((r) => ({ id: r.id, name: r.name, description: r.description, cost: r.cost, remaining: r.remaining, min_level: r.min_level, image_url: r.image_url })) : [],
    achievements: g.on ? g.achievements.map((a) => ({ key: a.key, name: a.name, description: a.description })) : [],
    earn: g.on ? rbbEarnList(g) : [] };
}

// ---------------------------------------------------------------- members
async function rbbClerkUser(env, userId) {
  if (!env.CLERK_SECRET_KEY) throw Object.assign(new Error("Sign-in is not configured yet."), { status: 503 });
  const res = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(userId)}`, { headers: { Authorization: `Bearer ${env.CLERK_SECRET_KEY}` } });
  if (!res.ok) throw Object.assign(new Error("Your account could not be checked right now. Try again shortly."), { status: 503 });
  const u = await res.json();
  const list = Array.isArray(u?.email_addresses) ? u.email_addresses : [];
  const primary = list.find((e) => e.id === u.primary_email_address_id);
  const ok = primary && primary.verification && primary.verification.status === "verified" && primary.email_address;
  const name = [u?.first_name, u?.last_name].filter(Boolean).join(" ").trim() || String(u?.username || "").trim();
  return { email: ok ? String(primary.email_address).trim().toLowerCase() : null, name: name.slice(0, 80) };
}

function rbbPassCode() {
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", b = crypto.getRandomValues(new Uint8Array(12));
  return [...b].map((x) => abc[x % 32]).join("");
}
function rbbHex(bytes) { return [...new Uint8Array(bytes)].map((x) => x.toString(16).padStart(2, "0")).join(""); }

async function rbbMember(request, env) {
  const session = await verifyClerkSession(request, env);
  if (!session.ok) throw Object.assign(new Error(session.error || "Sign in is required."), { status: session.status || 401 });
  const userId = session.userId, now = Date.now(), at = new Date(now).toISOString();
  let m = await env.DB.prepare("SELECT * FROM badge_members WHERE clerk_user_id = ?").bind(userId).first();
  if (m && m.email_norm && m.email_at && now - Date.parse(m.email_at) < 864e5) return m;
  const u = await rbbClerkUser(env, userId);
  if (!u.email) throw Object.assign(new Error("Verify the email on your account to get your RB Badge."), { status: 403 });
  if (m) {
    await env.DB.prepare("UPDATE badge_members SET email_norm = ?, email_at = ?, display_name = ? WHERE id = ?").bind(u.email, at, u.name || m.display_name, m.id).run();
    return { ...m, email_norm: u.email, email_at: at, display_name: u.name || m.display_name };
  }
  for (let i = 0; i < 4; i++) {
    const secret = rbbHex(crypto.getRandomValues(new Uint8Array(32)));
    await env.DB.prepare("INSERT OR IGNORE INTO badge_members (id, clerk_user_id, email_norm, email_at, display_name, pass_code, pass_secret, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(rbcId("m_", 14), userId, u.email, at, u.name || null, rbbPassCode(), secret, at).run();
    m = await env.DB.prepare("SELECT * FROM badge_members WHERE clerk_user_id = ?").bind(userId).first();
    if (m) return m;
  }
  throw Object.assign(new Error("Your badge could not be set up. Try again."), { status: 503 });
}

// The QR token: RBB1.<pass code>.<minute>.<signature>. RB Command checks it the same way (badgedesk.js).
async function rbbSign(secret, code, minute) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return rbbHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`RBB1.${code}.${minute}`))).slice(0, 24);
}
async function rbbPass(m) {
  const minute = Math.floor(Date.now() / 60000);
  const token = `RBB1.${m.pass_code}.${minute}.${await rbbSign(m.pass_secret, m.pass_code, minute)}`;
  const qr = rbbQrcode(0, "M");
  qr.addData(token);
  qr.make();
  const count = qr.getModuleCount(), quiet = 4, size = count + quiet * 2;
  let d = "";
  for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  return { token, svg, refresh_seconds: (RBB_TOKEN_MINUTES - 2) * 60, code: m.pass_code.replace(/(.{4})(?=.)/g, "$1-") };
}

// ---------------------------------------------------------------- awards (pull model; every award has a unique source_ref)
async function rbbSync(env, g, m) {
  if (!g.on) return 0;
  const a = g.amounts, now = Date.now(), at = new Date(now).toISOString(), day = rbcLaDay(now), month = day.slice(0, 7), email = m.email_norm;
  const rows = [];
  const add = (source, ref, points) => { if (points > 0) rows.push([source, ref, points]); };
  const tryRead = async (fn) => { try { return await fn(); } catch { return null; } };
  add("welcome", `welcome:${m.id}`, a.welcome);
  add("daily", `daily:${day}:${m.id}`, a.daily);
  if (email) {
    if (a.signup > 0 && await tryRead(() => env.DB.prepare("SELECT id FROM signups WHERE lower(trim(email)) = ? LIMIT 1").bind(email).first())) add("signup", `signup:${email}`, a.signup);
    if (a.membership > 0) {
      const inq = await tryRead(() => env.DB.prepare("SELECT DISTINCT options FROM shop_inquiries WHERE lower(trim(email)) = ? AND options LIKE 'membership:%'").bind(email).all());
      for (const r of inq?.results || []) { const tier = RBC_TIERS[String(r.options || "").toLowerCase()]; if (tier) add("membership", `membership:${tier}:${email}`, a.membership); }
    }
    if (a.perDollarSpent > 0) {
      const orders = await tryRead(() => env.DB.prepare("SELECT id, amount_total FROM store_orders WHERE lower(trim(customer_email)) = ? AND coalesce(payment_status, 'paid') = 'paid' AND coalesce(status, 'paid') IN ('paid', 'fulfilled') AND amount_total > 0 LIMIT 500").bind(email).all());
      for (const r of orders?.results || []) add("order", `order:${r.id}`, Math.min(a.orderCap, Math.floor(Number(r.amount_total) / 100) * a.perDollarSpent));
    }
    if (a.perDollarGiven > 0 && env.DONOR_DB) {
      const gifts = await tryRead(() => env.DONOR_DB.prepare("SELECT id, stripe_event_id, amount_total FROM contributions WHERE lower(trim(email)) = ? AND payment_status = 'paid' AND amount_total > 0 LIMIT 500").bind(email).all());
      for (const r of gifts?.results || []) add("contribution", `contrib:${r.stripe_event_id || r.id}`, Math.min(a.contribCap, Math.floor(Number(r.amount_total) / 100) * a.perDollarGiven));
    }
    if (a.release > 0) {
      const songs = await tryRead(() => env.DB.prepare("SELECT id FROM record_submissions WHERE lower(trim(email)) = ? AND status IN ('approved', 'live') LIMIT 500").bind(email).all());
      for (const r of songs?.results || []) add("release", `release:${r.id}`, a.release);
    }
    if (a.eventListed > 0) {
      const evs = await tryRead(() => env.DB.prepare("SELECT id FROM rb_event_submissions WHERE lower(trim(submitter_email)) = ? AND status = 'published' LIMIT 500").bind(email).all());
      for (const r of evs?.results || []) add("event_listed", `event:${r.id}`, a.eventListed);
    }
  }
  if (a.collect > 0) {
    const claims = await tryRead(() => env.DB.prepare("SELECT c.id FROM reward_claims c JOIN reward_players p ON p.id = c.player_id WHERE p.clerk_user_id = ? AND c.status IN ('approved', 'fulfilled') LIMIT 100").bind(m.clerk_user_id).all());
    for (const r of claims?.results || []) add("collect", `collect:${r.id}`, a.collect);
  }
  if (a.memberMonth > 0 && await tryRead(() => env.DB.prepare("SELECT 1 AS ok FROM studio_memberships WHERE clerk_user_id = ? AND status = 'active' AND (current_period_end IS NULL OR datetime(current_period_end) > datetime('now')) LIMIT 1").bind(m.clerk_user_id).first())) {
    add("member_month", `member:${month}:${m.id}`, a.memberMonth);
  }
  const stmts = rows.map(([source, ref, points]) => env.DB.prepare("INSERT OR IGNORE INTO badge_points (id, member_id, source, source_ref, points, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(rbcId("b_"), m.id, source, ref, points, at));
  stmts.push(env.DB.prepare("UPDATE badge_members SET daily_at = ? WHERE id = ?").bind(day, m.id));
  const res = await env.DB.batch(stmts);
  return res.slice(0, rows.length).reduce((n, r, i) => n + (r.meta?.changes ? rows[i][2] : 0), 0);
}

// Totals, counts per source and the achievements a member has, from the ledger (shared with RB Command's desk).
async function rbbStanding(env, g, memberId) {
  const [tot, counts, grants] = await env.DB.batch([
    env.DB.prepare("SELECT coalesce(sum(points), 0) AS balance, coalesce(sum(CASE WHEN source NOT IN ('redeem', 'refund') THEN points ELSE 0 END), 0) AS lifetime FROM badge_points WHERE member_id = ?").bind(memberId),
    env.DB.prepare("SELECT source, count(*) AS n FROM badge_points WHERE member_id = ? GROUP BY source").bind(memberId),
    env.DB.prepare("SELECT achievement_key FROM badge_grants WHERE member_id = ?").bind(memberId),
  ]);
  const t = tot.results?.[0] || {}, lifetime = Math.max(0, Number(t.lifetime) || 0), balance = Math.max(0, Number(t.balance) || 0);
  const by = Object.fromEntries((counts.results || []).map((r) => [r.source, Number(r.n)]));
  const granted = new Set((grants.results || []).map((r) => r.achievement_key));
  const earned = g.achievements.filter((x) => x.rule === "manual" ? granted.has(x.key) : x.rule === "lifetime" ? lifetime >= x.threshold : (by[RBB_RULE_SOURCE[x.rule]] || 0) >= x.threshold).map((x) => x.key);
  const progress = Object.fromEntries(g.achievements.filter((x) => x.rule !== "manual").map((x) => [x.key, Math.min(x.threshold, x.rule === "lifetime" ? lifetime : by[RBB_RULE_SOURCE[x.rule]] || 0)]));
  const { level, next } = rbbLevelFor(g, lifetime);
  return { lifetime, balance, checkins: by.checkin || 0, earned, progress, level: level ? { key: level.key, name: level.name, perks: level.perks } : null, next: next ? { key: next.key, name: next.name, min: next.min, to_go: next.min - lifetime } : null };
}

async function rbbMe(env, g, m) {
  const [hist, reds] = await env.DB.batch([
    env.DB.prepare("SELECT source, points, note, created_at FROM badge_points WHERE member_id = ? ORDER BY created_at DESC, id LIMIT 30").bind(m.id),
    env.DB.prepare("SELECT id, reward_name, cost, status, created_at FROM badge_redemptions WHERE member_id = ? ORDER BY created_at DESC LIMIT 30").bind(m.id),
  ]);
  const [user, domain] = String(m.email_norm || "").split("@");
  return { ok: true, member: { name: m.display_name || "", email: user ? `${user.slice(0, 2)}${"•".repeat(Math.max(1, Math.min(6, user.length - 2)))}@${domain}` : null, since: m.created_at },
    standing: await rbbStanding(env, g, m.id), pass: await rbbPass(m), game: await rbbGameToday(env, m.id),
    history: (hist.results || []).map((r) => ({ source: r.source, label: RBB_SOURCES[r.source] || r.source, points: Number(r.points), note: r.source === "checkin" || r.source === "adjust" ? r.note || "" : "", at: r.created_at })),
    redemptions: (reds.results || []).map((r) => ({ id: r.id, reward: r.reward_name, cost: Number(r.cost), status: r.status, at: r.created_at })) };
}

async function rbbRateOk(env, memberId) {
  const minute = new Date(Date.now()).toISOString().slice(0, 16);
  await env.DB.prepare("DELETE FROM badge_rate WHERE member_id = ? AND minute < ?").bind(memberId, minute).run();
  const row = await env.DB.prepare("INSERT INTO badge_rate (member_id, minute, n) VALUES (?, ?, 1) ON CONFLICT(member_id, minute) DO UPDATE SET n = n + 1 RETURNING n").bind(memberId, minute).first();
  return Number(row?.n || 0) <= RBB_WRITES_PER_MINUTE;
}

// Spend points on a reward: the debit, one unit off the reward and the request are one batch, each step only if the
// one before happened, so the balance and the stock can't go below zero however many requests arrive at once.
async function rbbRedeem(env, g, m, body) {
  const id = Number(body?.reward_id), r = g.rewards.find((x) => x.id === id);
  if (!r) return rbcJson({ ok: false, error: "That reward isn't available." }, 404);
  if (r.remaining <= 0) return rbcJson({ ok: false, error: "That reward has run out." }, 409);
  const st = await rbbStanding(env, g, m.id);
  if (r.min_level) {
    const need = g.levels.find((l) => l.key === r.min_level);
    if (need && st.lifetime < need.min) return rbcJson({ ok: false, error: `This reward is for ${need.name} members and up.` }, 403);
  }
  if (st.balance < r.cost) return rbcJson({ ok: false, error: `You need ${r.cost.toLocaleString("en-US")} points for this. You have ${st.balance.toLocaleString("en-US")}.` }, 409);
  const rid = rbcId("r_", 14), ref = `redeem:${rid}`, at = new Date(Date.now()).toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO badge_points (id, member_id, source, source_ref, points, note, created_at) SELECT ?, ?, 'redeem', ?, ?, ?, ? WHERE (SELECT coalesce(sum(points), 0) FROM badge_points WHERE member_id = ?) >= ? AND (SELECT remaining FROM badge_rewards WHERE id = ? AND status = 'live') > 0")
      .bind(rbcId("b_"), m.id, ref, -r.cost, r.name, at, m.id, r.cost, r.id),
    env.DB.prepare("UPDATE badge_rewards SET remaining = remaining - 1 WHERE id = ? AND EXISTS (SELECT 1 FROM badge_points WHERE source_ref = ?)").bind(r.id, ref),
    env.DB.prepare("INSERT INTO badge_redemptions (id, member_id, reward_id, reward_name, cost, status, email, created_at) SELECT ?, ?, ?, ?, ?, 'requested', ?, ? WHERE EXISTS (SELECT 1 FROM badge_points WHERE source_ref = ?)")
      .bind(rid, m.id, r.id, r.name, r.cost, m.email_norm, at, ref),
  ]);
  const done = await env.DB.prepare("SELECT id FROM badge_redemptions WHERE id = ?").bind(rid).first();
  if (!done) return rbcJson({ ok: false, error: "That didn't go through: the reward ran out or your balance changed. Refresh and try again." }, 409);
  return rbcJson({ ok: true, redemption: { id: rid, reward: r.name, cost: r.cost, status: "requested" }, standing: await rbbStanding(env, g, m.id) });
}

// ---------------------------------------------------------------- RB Gold Rush (the game in the app)
async function rbbGameToday(env, memberId) {
  const since = new Date(rbcLaInstant(rbcLaDay(Date.now()))).toISOString();
  const r = await env.DB.prepare("SELECT count(*) AS rounds, coalesce(sum(points), 0) AS points, coalesce(max(score), 0) AS best FROM badge_game_rounds WHERE member_id = ? AND started_at >= ?").bind(memberId, since).first();
  return { rounds: Number(r?.rounds) || 0, points: Number(r?.points) || 0, best: Number(r?.best) || 0, since };
}

async function rbbGameStart(env, g, m) {
  const today = await rbbGameToday(env, m.id);
  if (today.rounds >= g.amounts.gameRounds) return rbcJson({ ok: false, error: `That's all ${g.amounts.gameRounds} rounds for today. Come back tomorrow.` }, 429);
  const id = rbcId("g_", 14), seed = crypto.getRandomValues(new Uint32Array(1))[0];
  await env.DB.prepare("INSERT INTO badge_game_rounds (id, member_id, seed, started_at) VALUES (?, ?, ?, ?)").bind(id, m.id, seed, new Date(Date.now()).toISOString()).run();
  return rbcJson({ ok: true, round: id, seed, ms: RBG_MS, today: { rounds: today.rounds + 1, points: today.points } });
}

// A score is accepted once, for a round this member started, after the round has had time to play out, and only up
// to what that round could score. Points: score / per_point, at most round_max, and never past today's limit.
async function rbbGameFinish(env, g, m, body) {
  const id = String(body?.round || ""), score = Number(body?.score);
  const r = await env.DB.prepare("SELECT * FROM badge_game_rounds WHERE id = ? AND member_id = ?").bind(id, m.id).first();
  if (!r) return rbcJson({ ok: false, error: "That round isn't yours." }, 404);
  if (r.finished_at) return rbcJson({ ok: false, error: "That round is already counted." }, 409);
  const age = Date.now() - Date.parse(r.started_at);
  if (age < RBG_MS - 2000) return rbcJson({ ok: false, error: "That round isn't over yet." }, 409);
  if (!Number.isInteger(score) || score < 0) return rbcJson({ ok: false, error: "That score isn't valid." }, 400);
  const late = age > 15 * 60000, max = rbgMax(Number(r.seed));
  if (score > max) return rbcJson({ ok: false, error: "That score is higher than the round allowed." }, 400);
  const a = g.amounts, today = await rbbGameToday(env, m.id);
  const want = late ? 0 : Math.min(a.gameRound, Math.floor(score / a.gamePerPoint));
  const points = Math.max(0, Math.min(want, a.gameDaily - today.points));
  const at = new Date(Date.now()).toISOString();
  const res = await env.DB.batch([
    env.DB.prepare("UPDATE badge_game_rounds SET finished_at = ?, score = ?, points = ? WHERE id = ? AND finished_at IS NULL").bind(at, score, points, id),
    env.DB.prepare("INSERT OR IGNORE INTO badge_points (id, member_id, source, source_ref, points, note, created_at) SELECT ?, ?, 'game', ?, ?, ?, ? WHERE ? > 0 AND EXISTS (SELECT 1 FROM badge_game_rounds WHERE id = ? AND finished_at = ?)")
      .bind(rbcId("b_"), m.id, `game:${id}`, points, `Score ${score}`, at, points, id, at),
  ]);
  if (!res[0].meta?.changes) return rbcJson({ ok: false, error: "That round is already counted." }, 409);
  return rbcJson({ ok: true, score, points, capped: points < want, late, today: { rounds: today.rounds, points: today.points + points, best: Math.max(today.best, score) }, standing: await rbbStanding(env, g, m.id) });
}

// ---------------------------------------------------------------- pages
async function rbbPassPage(request, env) {
  const g = await rbbLoad(env), nonce = rbcNonce();
  const html = RB_BADGE_HTML.replaceAll("__NONCE__", nonce).replace("__STATUS__", () => rbcEsc(g.status))
    .replace("__CLERK_KEY__", () => rbcScriptJson(String(env.CLERK_PUBLISHABLE_KEY || ""))).replace("__STATE__", () => rbcScriptJson(rbbPublicState(g)));
  return new Response(request.method === "HEAD" ? null : html, { headers: rbcPageHeaders(env, nonce) });
}

async function rbbAppPage(request, env) {
  const g = await rbbLoad(env), nonce = rbcNonce();
  const html = RB_APP_HTML.replaceAll("__NONCE__", nonce).replace("__STATUS__", () => rbcEsc(g.status))
    .replace("__CLERK_KEY__", () => rbcScriptJson(String(env.CLERK_PUBLISHABLE_KEY || ""))).replace("__STATE__", () => rbcScriptJson(rbbPublicState(g)));
  return new Response(request.method === "HEAD" ? null : html, { headers: rbcPageHeaders(env, nonce) });
}
const RBB_MANIFEST = JSON.stringify({ name: "RB: Relentless Billionaire", short_name: "RB", description: "Your RB Badge: points, levels, rewards, events and RB Gold Rush.", id: "/app", start_url: "/app", scope: "/app", display: "standalone", orientation: "portrait", background_color: "#07060A", theme_color: "#07060A",
  icons: [{ src: "/brand/icon-192.png?v=3", sizes: "192x192", type: "image/png" }, { src: "/brand/icon-512.png?v=3", sizes: "512x512", type: "image/png" }, { src: "/brand/maskable-512.png?v=3", sizes: "512x512", type: "image/png", purpose: "maskable" }] });

const a0 = (g) => { const a = g.amounts; return a.worldBlock > 0 && a.worldBlockMinutes > 0 && a.worldDaily > 0 ? `Play time while you're signed in earns ${a.worldBlock} RB Badge points every ${a.worldBlockMinutes} minutes, up to ${a.worldDaily} a day; RB counts the time itself. ` : "Right now play time doesn't earn RB Badge points. "; };

async function rbbTermsPage(request, env) {
  const g = await rbbLoad(env), nonce = rbcNonce(), e = rbcEsc, fmt = (x) => Number(x).toLocaleString("en-US");
  const earn = rbbEarnList(g).map((x) => `<li><b>${e(x.label)}</b>: ${e(x.detail)}</li>`).join("");
  const levels = g.levels.length
    ? `<table><thead><tr><th>Level</th><th>Lifetime points</th><th>What it gets you</th></tr></thead><tbody>${g.levels.map((l) => `<tr><td><b>${e(l.name)}</b></td><td>${fmt(l.min)}+</td><td>${e(l.perks)}</td></tr>`).join("")}</tbody></table>`
    : "<p>Levels and what each one gets you are listed here once RB publishes them.</p>";
  const rewards = g.rewards.length
    ? `<table><thead><tr><th>Reward</th><th>Points</th><th>Remaining</th></tr></thead><tbody>${g.rewards.map((r) => `<tr><td><b>${e(r.name)}</b>${r.description ? `<br><span class="m">${e(r.description)}</span>` : ""}${r.min_level && g.levels.find((l) => l.key === r.min_level) ? `<br><span class="m">For ${e(g.levels.find((l) => l.key === r.min_level).name)} members and up.</span>` : ""}</td><td>${fmt(r.cost)}</td><td>${fmt(r.remaining)}</td></tr>`).join("")}</tbody></table>`
    : "<p>Rewards you can spend points on are listed here once RB publishes them.</p>";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RB Badge terms · Relentless Billionaire</title><meta name="description" content="How RB Badge points, levels and rewards work."><link rel="canonical" href="https://relentlessbillionaire.com/badge/terms"><style nonce="${nonce}">
@font-face{font-family:"RB Cinzel";src:url(https://fonts.gstatic.com/s/cinzel/v26/8vIJ7ww63mVu7gt79mT7.woff2) format("woff2");font-weight:400 900;font-display:swap}
@font-face{font-family:"RB Cormorant";src:url(https://fonts.gstatic.com/s/cormorantgaramond/v21/co3bmX5slCNuHLi8bLeY9MK7whWMhyjYqXtK.woff2) format("woff2");font-weight:300 700;font-display:swap}
:root{color-scheme:dark;--bg:#07060A;--line:#2B261C;--gold:#C9A227;--gold2:#E9CF83;--text:#EFE8D8;--muted:#A79E89}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}main{max-width:820px;margin:0 auto;padding:28px 16px 64px}h1{font:600 clamp(28px,6vw,44px)/1.1 "RB Cinzel",Cinzel,Georgia,serif;color:var(--gold2);margin:8px 0 6px;letter-spacing:.04em}h2{font:600 20px/1.3 "RB Cinzel",Cinzel,Georgia,serif;color:var(--gold);margin:32px 0 8px;letter-spacing:.05em}a{color:var(--gold2)}.m{color:var(--muted);font-size:14px}.lead{font:italic 20px/1.4 "RB Cormorant",Georgia,serif;color:var(--muted)}.box{border:1px solid var(--gold);border-radius:12px;padding:14px 16px;margin:18px 0;font-weight:600}table{width:100%;border-collapse:collapse;font-size:14px;margin:8px 0;display:block;overflow-x:auto}th,td{border-bottom:1px solid var(--line);padding:8px 6px;text-align:left;vertical-align:top}th{color:var(--gold);font-weight:600}li{margin:4px 0}
</style></head><body><main><a href="/badge">← RB Badge</a><h1>RB Badge terms</h1><p class="lead">Points for showing up and backing RB, levels for the people who do it most.</p>
${g.on ? "" : `<div class="box">RB Badge is coming soon. These terms show the values RB has set so far; they apply once RB Badge is switched on.</div>`}
<h2>1. Who runs it</h2><p>RB Badge is run by Relentless Billionaire ("RB"), relentlessbillionaire.com.</p>
<h2>2. Who can join</h2><p>${e(g.cfg.eligibility)}</p><p>One badge per person. Your badge is tied to your RB account and its verified email.</p>
<h2>3. How you earn points</h2>${earn ? `<ul>${earn}</ul>` : "<p>Ways to earn are listed here once RB sets them.</p>"}<p>Purchases, contributions, memberships, songs, events and prize claims are matched to your badge by the verified email (or account) they were made with, including ones made before you opened your badge, and each one counts once. The RB team can also add points (for example for helping at an event) or remove points given by mistake; each change shows in your history.</p>
<h2>4. Levels</h2><p>Your level comes from your lifetime points: everything you have earned, minus any points the team removed. Spending points on rewards never lowers your level.</p>${levels}<p>Perks at shows and events are given by RB staff at the door when they scan your badge, while places or tickets last, and can depend on the venue's own rules (for example age limits).</p>
<h2>5. Rewards</h2><p>${e(g.cfg.redeem_how)}</p><p>At RB shows and events you can also spend points in person: show your pass and RB staff redeem the reward for you on the spot.</p>${rewards}
<h2>6. RB Gold Rush</h2><p>RB Gold Rush is a free game in the RB app at <a href="/app">relentlessbillionaire.com/app</a>. Each round is decided by skill: catch what falls, avoid the bombs. ${g.amounts.gameRound > 0 && g.amounts.gameDaily > 0 ? `A round earns 1 point for every ${g.amounts.gamePerPoint} score, up to ${g.amounts.gameRound} points a round and ${g.amounts.gameDaily} a day, with up to ${g.amounts.gameRounds} rounds a day.` : "Right now rounds don't earn points."} RB checks every score against what that round could reach, and may remove points from scores it believes were not played fairly. Game points spend like any other points, online or at RB events.</p>
<h2>7. RB World</h2><p>RB World, the 3D city game in the RB app at <a href="/app/world/">relentlessbillionaire.com/app/world</a>, is free. ${a0(g)}Your net worth, tokens and items in RB World are game money only: they stay in the game and are not RB Badge points. The leaderboard shows what each player's game reports.</p>
<h2>8. Your pass</h2><p>The QR code on your badge changes every few minutes and only works for you. Don't share it. Staff may ask for ID that matches your account.</p>
<h2>9. What points aren't</h2><p>Points and levels have no cash value. They can't be sold, transferred, exchanged for money or combined between accounts. Buying something never earns more than the amounts above, and you can earn points without buying anything.</p>
<h2>10. Fair play</h2><p>RB may remove points, cancel redemptions or close a badge that comes from duplicate accounts, automation, fraud, refunded or charged-back payments, or a breach of these terms.</p>
<h2>11. Changes</h2><p>RB may change the amounts, levels, perks or rewards, or end RB Badge. Changes show on this page. Your information is handled as described in the <a href="/privacy">privacy policy</a>; the <a href="/terms">terms</a> also apply.</p>
</main></body></html>`;
  return new Response(request.method === "HEAD" ? null : html, { headers: rbcPageHeaders(env, nonce) });
}

// ---------------------------------------------------------------- router
async function rbBadgeRoute(request, env, url) {
  const path = url.pathname.replace(/\/+$/, "") || "/", method = request.method;
  const page = method === "GET" || method === "HEAD";
  if (!["/badge", "/badge/terms", "/app", "/app/manifest.webmanifest"].includes(path) && !path.startsWith("/api/badge/") && !path.startsWith("/app/world") && !path.startsWith("/api/world/")) return null;
  try {
    await (rbbSchemaReady ||= rbbEnsureSchema(env).catch((err) => { rbbSchemaReady = null; throw err; }));
    if (path === "/badge" && page) return await rbbPassPage(request, env);
    if (path === "/badge/terms" && page) return await rbbTermsPage(request, env);
    if (path === "/app" && page) return await rbbAppPage(request, env);
    if (path.startsWith("/app/world") || path.startsWith("/api/world/")) { const w = await rbWorldRoute(request, env, url, path, method); if (w) return w; }
    if (path === "/app/manifest.webmanifest" && page) return new Response(RBB_MANIFEST, { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" } });
    const g = await rbbLoad(env);
    if (path === "/api/badge/state" && method === "GET") return rbcJson(rbbPublicState(g));
    if (!g.on) return rbcJson({ ok: false, error: "RB Badge is coming soon." }, 403);
    if (path === "/api/badge/me" && method === "GET") {
      const m = await rbbMember(request, env);
      const added = await rbbSync(env, g, m);
      return rbcJson({ ...(await rbbMe(env, g, m)), added, state: rbbPublicState(g) });
    }
    if (path === "/api/badge/pass" && method === "GET") return rbcJson({ ok: true, pass: await rbbPass(await rbbMember(request, env)) });
    if ((path === "/api/badge/redeem" || path === "/api/badge/game/start" || path === "/api/badge/game/finish") && method === "POST") {
      const origin = request.headers.get("Origin");
      if (origin && origin !== url.origin) return rbcJson({ ok: false, error: "Not allowed from another site." }, 403);
      if (!/^application\/json/i.test(request.headers.get("Content-Type") || "")) return rbcJson({ ok: false, error: "Send JSON." }, 415);
      const body = await request.json().catch(() => ({}));
      const m = await rbbMember(request, env);
      if (!(await rbbRateOk(env, m.id))) return rbcJson({ ok: false, error: "Too many tries. Wait a minute and try again." }, 429, { "Retry-After": "60" });
      if (path === "/api/badge/game/start") return await rbbGameStart(env, g, m);
      if (path === "/api/badge/game/finish") return await rbbGameFinish(env, g, m, body);
      return await rbbRedeem(env, g, m, body);
    }
    return rbcJson({ ok: false, error: "Not found" }, path.startsWith("/api/") ? 404 : 405);
  } catch (err) {
    const status = Number(err?.status) || 500;
    if (status >= 500 && status !== 503) console.error("rb-badge", err?.stack || err);
    if (page && !path.startsWith("/api/")) return new Response("RB Badge is unavailable right now. Please try again shortly.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
    return rbcJson({ ok: false, error: status === 500 ? "Something went wrong. Please try again." : err.message }, status);
  }
}
