/**
 * Badge desk (team.relentlessbillionaire.com/badge-desk): the door and the counter for RB Badge
 * (relentlessbillionaire.com/badge, rb-site-updates/src/badge/).
 *
 * - Scan: the camera reads the QR on a member's pass (BarcodeDetector where the browser has it, else jsQR, served
 *   from /badge-desk/jsqr.js). The QR is RBB1.<pass code>.<minute>.<HMAC of the member's pass_secret>, good for
 *   TOKEN_MINUTES, so a screenshot stops working. Staff can also look a member up by email, name or pass code.
 * - Check in: points for showing up, once per member per event (source_ref checkin:<event>:<member>).
 * - Adjust: add or remove points by hand, with a note the member sees. Grant or remove hand-given achievements.
 * - Redemptions: approve, mark delivered, or reject (the points and the unit go back).
 * - Redeem in person: spend a member's points on a live reward on the spot (it's marked delivered). Needs the QR the
 *   member is showing right now, so nobody's points are spent without them there.
 * Scanning, check-ins and in-person redeeming: Badges edit, Club edit, or the Door staff role (RB Command shows that
 * role only this page; it can install it on a phone from /badge-desk/manifest.webmanifest). Door staff must scan to
 * check someone in; the others can also check in someone they looked up. Adjusting, achievements and the request
 * queue: Badges edit. Every change is in command_log. Check-ins and redeeming need RB Badge switched on.
 */
import { HttpError } from "./tables.js";
import { BADGE_SCHEMA } from "./badge_schema.js";
import JSQR from "./badge_jsqr.js";

export const TOKEN_MINUTES = 10;
const RULE_SOURCE = { checkins: "checkin", signup: "signup", membership: "membership", orders: "order", contributions: "contribution", member: "member_month", release: "release", event_listed: "event_listed", collect: "collect" };
const SOURCES = { welcome: "Welcome", daily: "Opened badge", signup: "RB list", membership: "Membership request", order: "Store order", contribution: "Gave at /fund", member_month: "RB Studio member",
  release: "Song approved", event_listed: "Event listed", collect: "RB Collect prize", checkin: "Checked in", adjust: "By hand", redeem: "Redeemed", refund: "Returned", game: "RB Gold Rush" };
const draft = (s) => /^\s*DRAFT:/i.test(String(s || ""));
const log = (env, who, action, target, detail) => env.DB.prepare("INSERT INTO command_log (actor, action, target, detail) VALUES (?, ?, ?, ?)").bind(who.email, action, String(target).slice(0, 200), String(detail).slice(0, 500));
const uid = (p) => p + [...crypto.getRandomValues(new Uint8Array(10))].map((x) => "abcdefghijkmnpqrstuvwxyz23456789"[x % 32]).join("");
const int = (v) => (Number.isInteger(Number(v)) ? Number(v) : NaN);

let ready = null;
async function ensure(env) {
  if (ready) return ready;
  ready = (async () => {
    try { await env.DB.prepare("SELECT 1 FROM badge_config LIMIT 1").first(); await env.DB.prepare("SELECT 1 FROM badge_grants LIMIT 1").first(); }
    catch { await env.DB.batch(BADGE_SCHEMA.map((q) => env.DB.prepare(q))); }
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

async function load(env) {
  await ensure(env);
  const [cfg, levels, ach, rewards] = await env.DB.batch([
    env.DB.prepare("SELECT key, value FROM badge_config"),
    env.DB.prepare("SELECT level_key, name, min_points, perks, status FROM badge_levels ORDER BY min_points, sort_order, id"),
    env.DB.prepare("SELECT key, name, description, rule, threshold, status FROM badge_achievements ORDER BY sort_order, key"),
    env.DB.prepare("SELECT id, name, description, cost, remaining, min_level, status FROM badge_rewards ORDER BY sort_order, cost, id"),
  ]);
  const c = Object.fromEntries((cfg.results || []).map((r) => [r.key, String(r.value ?? "")]));
  const n = (k, d) => (Number.isInteger(Number(c[k])) && Number(c[k]) >= 0 ? Number(c[k]) : d);
  const lv = (levels.results || []).filter((l) => l.status === "live" && !draft(l.perks)).map((l) => ({ key: l.level_key, name: l.name, min: Number(l.min_points) || 0, perks: l.perks }));
  return { on: String(c.enabled || "").trim().toLowerCase() === "on" && lv.length > 0, switch: String(c.enabled || "off"), levels: lv,
    achievements: (ach.results || []).filter((a) => a.status === "live"),
    rewards: (rewards.results || []).filter((r) => r.status === "live" && !draft(r.description) && Number(r.cost) > 0).map((r) => ({ id: Number(r.id), name: r.name, cost: Number(r.cost), remaining: Math.max(0, Number(r.remaining) || 0), min_level: r.min_level || "" })),
    checkin: n("checkin_points", 100), checkinMax: n("checkin_max", 1000), adjustMax: n("adjust_max", 10000) };
}

async function standing(env, g, memberId) {
  const [tot, counts, grants, recent] = await env.DB.batch([
    env.DB.prepare("SELECT coalesce(sum(points), 0) AS balance, coalesce(sum(CASE WHEN source NOT IN ('redeem', 'refund') THEN points ELSE 0 END), 0) AS lifetime FROM badge_points WHERE member_id = ?").bind(memberId),
    env.DB.prepare("SELECT source, count(*) AS n FROM badge_points WHERE member_id = ? GROUP BY source").bind(memberId),
    env.DB.prepare("SELECT achievement_key FROM badge_grants WHERE member_id = ?").bind(memberId),
    env.DB.prepare("SELECT source, source_ref, points, note, actor, created_at FROM badge_points WHERE member_id = ? ORDER BY created_at DESC LIMIT 12").bind(memberId),
  ]);
  const t = tot.results?.[0] || {}, lifetime = Math.max(0, Number(t.lifetime) || 0);
  const by = Object.fromEntries((counts.results || []).map((r) => [r.source, Number(r.n)]));
  const granted = new Set((grants.results || []).map((r) => r.achievement_key));
  let level = null;
  for (const l of g.levels) if (lifetime >= l.min) level = l;
  return { lifetime, balance: Math.max(0, Number(t.balance) || 0), checkins: by.checkin || 0, level, granted: [...granted],
    earned: g.achievements.filter((x) => (x.rule === "manual" ? granted.has(x.key) : x.rule === "lifetime" ? lifetime >= x.threshold : (by[RULE_SOURCE[x.rule]] || 0) >= x.threshold)).map((x) => x.key),
    recent: (recent.results || []).map((r) => ({ label: SOURCES[r.source] || r.source, ref: r.source_ref, points: Number(r.points), note: r.note || "", actor: r.actor || "", at: r.created_at })) };
}

const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
async function sign(secret, code, minute) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`RBB1.${code}.${minute}`))).slice(0, 24);
}
// "ok", "expired" or "bad" for a scanned token, and the member it names.
export async function checkToken(env, token, now = Date.now()) {
  const m = /^RBB1\.([A-Z2-9]{12})\.(\d{1,10})\.([0-9a-f]{24})$/.exec(String(token || "").trim());
  if (!m) return { state: "bad" };
  const member = await env.DB.prepare("SELECT * FROM badge_members WHERE pass_code = ?").bind(m[1]).first();
  if (!member) return { state: "bad" };
  const want = await sign(member.pass_secret, m[1], m[2]);
  let same = want.length === m[3].length;
  for (let i = 0; i < want.length; i++) same = same && want[i] === m[3][i];
  if (!same) return { state: "bad" };
  const age = Math.floor(now / 60000) - Number(m[2]);
  return { state: age > TOKEN_MINUTES || age < -2 ? "expired" : "ok", member };
}

function card(member, st) {
  return { id: member.id, name: member.display_name || "", email: member.email_norm || "", code: String(member.pass_code || "").replace(/(.{4})(?=.)/g, "$1-"), since: member.created_at, ...st,
    level: st.level ? { key: st.level.key, name: st.level.name, perks: st.level.perks } : null };
}

// ---------------------------------------------------------------- reads
export async function summary(env) {
  const g = await load(env);
  const counts = await env.DB.prepare("SELECT (SELECT count(*) FROM badge_members) AS members, (SELECT count(*) FROM badge_redemptions WHERE status = 'requested') AS requested, (SELECT count(*) FROM badge_points WHERE source = 'checkin' AND created_at >= ?) AS checkins_today")
    .bind(new Date(Date.now() - 864e5).toISOString()).first();
  // RB Events from two days ago to two weeks ahead, for the door's event picker (none if that table isn't there).
  const events = await env.DB.prepare("SELECT id, title, starts_at, venue_name FROM rb_events WHERE status = 'live' AND datetime(starts_at) BETWEEN datetime('now', '-2 days') AND datetime('now', '+14 days') ORDER BY datetime(starts_at) LIMIT 20").all().catch(() => ({ results: [] }));
  return { ok: true, on: g.on, switch: g.switch, levels: g.levels, achievements: g.achievements.map((a) => ({ key: a.key, name: a.name, rule: a.rule })), rewards: g.rewards,
    checkin: g.checkin, checkin_max: g.checkinMax, adjust_max: g.adjustMax, events: events.results || [], counts: counts || {} };
}

export async function lookup(env, body) {
  const g = await load(env);
  if (body.token) {
    const t = await checkToken(env, body.token);
    if (t.state === "bad") return { ok: true, token: "bad", members: [] };
    return { ok: true, token: t.state, member: card(t.member, await standing(env, g, t.member.id)) };
  }
  if (body.id) {
    const m = await env.DB.prepare("SELECT * FROM badge_members WHERE id = ?").bind(String(body.id)).first();
    if (!m) throw new HttpError(404, "No badge with that id.");
    return { ok: true, token: null, member: card(m, await standing(env, g, m.id)) };
  }
  const q = String(body.q || "").trim().toLowerCase();
  if (q.length < 2) throw new HttpError(400, "Type at least 2 letters of an email, a name or a pass code.");
  const code = q.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const like = "%" + q.replace(/[%_\\]/g, (c) => "\\" + c) + "%";
  const rows = await env.DB.prepare("SELECT id, display_name, email_norm, pass_code FROM badge_members WHERE email_norm LIKE ? ESCAPE '\\' OR lower(display_name) LIKE ? ESCAPE '\\' OR pass_code = ? ORDER BY created_at DESC LIMIT 20").bind(like, like, code).all();
  return { ok: true, token: null, members: (rows.results || []).map((m) => ({ id: m.id, name: m.display_name || "", email: m.email_norm || "", code: String(m.pass_code).replace(/(.{4})(?=.)/g, "$1-") })) };
}

export async function redemptions(env) {
  await ensure(env);
  const r = await env.DB.prepare("SELECT r.id, r.reward_name, r.cost, r.status, r.email, r.notes, r.handled_by, r.created_at, r.updated_at, m.display_name FROM badge_redemptions r LEFT JOIN badge_members m ON m.id = r.member_id ORDER BY r.status = 'requested' DESC, r.status = 'approved' DESC, r.created_at DESC LIMIT 100").all();
  return { ok: true, redemptions: r.results || [] };
}

// ---------------------------------------------------------------- writes
export async function checkin(env, who, body) {
  const g = await load(env);
  if (!g.on) throw new HttpError(409, "RB Badge is switched off. Switch it on in Badges > Settings before checking anyone in.");
  const member = await present(env, who, body);
  const points = body.points == null || body.points === "" ? g.checkin : int(body.points);
  if (!(points >= 0 && points <= g.checkinMax)) throw new HttpError(400, `Points for a check-in go from 0 to ${g.checkinMax}.`);
  let key = "", label = "";
  if (body.event_id != null && body.event_id !== "") {
    const ev = await env.DB.prepare("SELECT id, title, starts_at FROM rb_events WHERE id = ?").bind(int(body.event_id)).first().catch(() => null);
    if (!ev) throw new HttpError(404, "That event isn't in RB Events.");
    key = `ev${ev.id}`; label = `${ev.title} (${String(ev.starts_at).slice(0, 10)})`;
  } else {
    label = String(body.event_label || "").trim().slice(0, 120);
    if (label.length < 3) throw new HttpError(400, "Pick an event, or type its name.");
    key = new Date().toISOString().slice(0, 10) + ":" + label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  }
  const ref = `checkin:${key}:${member.id}`;
  const res = await env.DB.prepare("INSERT OR IGNORE INTO badge_points (id, member_id, source, source_ref, points, note, actor, created_at) VALUES (?, ?, 'checkin', ?, ?, ?, ?, ?)")
    .bind(uid("b_"), member.id, ref, points, label, who.email, new Date().toISOString()).run();
  const already = !res.meta?.changes;
  if (!already) await log(env, who, "badge.checkin", member.email_norm || member.id, `${label}: +${points}`).run();
  return { ok: true, already, event: label, member: card(member, await standing(env, g, member.id)) };
}

// The member a door action is for. With a scanned token it must be theirs and current; door staff must always scan.
async function present(env, who, body, mustScan = Boolean(who.mustScan)) {
  if (body.token) {
    const t = await checkToken(env, body.token);
    if (t.state !== "ok") throw new HttpError(403, t.state === "expired" ? "That QR is out of date. Ask them to open their badge and scan again." : "That isn't a valid RB Badge.");
    if (body.member_id && t.member.id !== String(body.member_id)) throw new HttpError(409, "That QR belongs to someone else. Scan again.");
    return t.member;
  }
  if (mustScan) throw new HttpError(403, "Scan the member's badge first.");
  const member = await env.DB.prepare("SELECT * FROM badge_members WHERE id = ?").bind(String(body.member_id || "")).first();
  if (!member) throw new HttpError(404, "No badge with that id.");
  return member;
}

// Spend points on a reward in person: the debit, one unit off and a delivered request, in one batch, each step only
// if the one before happened (the same checks as the member's own Redeem on /badge).
export async function redeemInPerson(env, who, body) {
  const g = await load(env);
  if (!g.on) throw new HttpError(409, "RB Badge is switched off.");
  const member = await present(env, who, body, true);
  const r = g.rewards.find((x) => x.id === Number(body.reward_id));
  if (!r) throw new HttpError(404, "That reward isn't available.");
  if (r.remaining <= 0) throw new HttpError(409, "That reward has run out.");
  const st = await standing(env, g, member.id);
  const need = r.min_level && g.levels.find((l) => l.key === r.min_level);
  if (need && st.lifetime < need.min) throw new HttpError(403, `This reward is for ${need.name} members and up.`);
  if (st.balance < r.cost) throw new HttpError(409, `They need ${r.cost.toLocaleString("en-US")} points and have ${st.balance.toLocaleString("en-US")}.`);
  const rid = uid("r_"), ref = `redeem:${rid}`, at = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO badge_points (id, member_id, source, source_ref, points, note, actor, created_at) SELECT ?, ?, 'redeem', ?, ?, ?, ?, ? WHERE (SELECT coalesce(sum(points), 0) FROM badge_points WHERE member_id = ?) >= ? AND (SELECT remaining FROM badge_rewards WHERE id = ? AND status = 'live') > 0")
      .bind(uid("b_"), member.id, ref, -r.cost, r.name + " (in person)", who.email, at, member.id, r.cost, r.id),
    env.DB.prepare("UPDATE badge_rewards SET remaining = remaining - 1 WHERE id = ? AND EXISTS (SELECT 1 FROM badge_points WHERE source_ref = ?)").bind(r.id, ref),
    env.DB.prepare("INSERT INTO badge_redemptions (id, member_id, reward_id, reward_name, cost, status, email, notes, handled_by, created_at, updated_at) SELECT ?, ?, ?, ?, ?, 'fulfilled', ?, 'In person', ?, ?, ? WHERE EXISTS (SELECT 1 FROM badge_points WHERE source_ref = ?)")
      .bind(rid, member.id, r.id, r.name, r.cost, member.email_norm, who.email, at, at, ref),
  ]);
  if (!(await env.DB.prepare("SELECT id FROM badge_redemptions WHERE id = ?").bind(rid).first())) throw new HttpError(409, "That didn't go through: the reward ran out or their balance changed. Scan again.");
  await log(env, who, "badge.redeem", member.email_norm || member.id, `${r.name} in person: -${r.cost}`).run();
  return { ok: true, reward: r.name, member: card(member, await standing(env, g, member.id)) };
}

export function manifest() {
  return new Response(JSON.stringify({ name: "RB Door", short_name: "RB Door", description: "Scan RB Badges at RB shows and events.", id: "/badge-desk", start_url: "/badge-desk", scope: "/badge-desk",
    display: "standalone", orientation: "portrait", background_color: "#07060A", theme_color: "#07060A",
    icons: [{ src: "https://relentlessbillionaire.com/brand/icon-192.png?v=3", sizes: "192x192", type: "image/png" }, { src: "https://relentlessbillionaire.com/brand/icon-512.png?v=3", sizes: "512x512", type: "image/png" }, { src: "https://relentlessbillionaire.com/brand/maskable-512.png?v=3", sizes: "512x512", type: "image/png", purpose: "maskable" }] }),
    { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
}

export async function adjust(env, who, body) {
  const g = await load(env);
  const member = await env.DB.prepare("SELECT * FROM badge_members WHERE id = ?").bind(String(body.member_id || "")).first();
  if (!member) throw new HttpError(404, "No badge with that id.");
  const points = int(body.points), note = String(body.note || "").trim().slice(0, 200);
  if (!points || Math.abs(points) > g.adjustMax) throw new HttpError(400, `Add or remove between 1 and ${g.adjustMax} points.`);
  if (note.length < 3) throw new HttpError(400, "Say why. The member sees this note in their history.");
  await env.DB.batch([
    env.DB.prepare("INSERT INTO badge_points (id, member_id, source, source_ref, points, note, actor, created_at) VALUES (?, ?, 'adjust', ?, ?, ?, ?, ?)").bind(uid("b_"), member.id, "adjust:" + uid(""), points, note, who.email, new Date().toISOString()),
    log(env, who, "badge.adjust", member.email_norm || member.id, `${points > 0 ? "+" : ""}${points}: ${note}`),
  ]);
  return { ok: true, member: card(member, await standing(env, g, member.id)) };
}

export async function grant(env, who, body) {
  const g = await load(env);
  const member = await env.DB.prepare("SELECT * FROM badge_members WHERE id = ?").bind(String(body.member_id || "")).first();
  if (!member) throw new HttpError(404, "No badge with that id.");
  const a = g.achievements.find((x) => x.key === String(body.key || "") && x.rule === "manual");
  if (!a) throw new HttpError(400, "Only live hand-given achievements can be given here.");
  await env.DB.batch([
    body.on === false ? env.DB.prepare("DELETE FROM badge_grants WHERE member_id = ? AND achievement_key = ?").bind(member.id, a.key)
      : env.DB.prepare("INSERT OR IGNORE INTO badge_grants (member_id, achievement_key, granted_by, created_at) VALUES (?, ?, ?, ?)").bind(member.id, a.key, who.email, new Date().toISOString()),
    log(env, who, body.on === false ? "badge.ungrant" : "badge.grant", member.email_norm || member.id, a.name),
  ]);
  return { ok: true, member: card(member, await standing(env, g, member.id)) };
}

const NEXT = { requested: ["approved", "fulfilled", "rejected"], approved: ["fulfilled", "rejected"], fulfilled: [], rejected: [] };
export async function setRedemption(env, who, body) {
  await ensure(env);
  const r = await env.DB.prepare("SELECT * FROM badge_redemptions WHERE id = ?").bind(String(body.id || "")).first();
  if (!r) throw new HttpError(404, "That request is gone.");
  const to = String(body.status || ""), notes = body.notes == null ? r.notes : String(body.notes).slice(0, 2000);
  if (!(NEXT[r.status] || []).includes(to)) throw new HttpError(409, `A ${r.status} request can't be set to ${to || "that"}.`);
  const at = new Date().toISOString();
  const stmts = [env.DB.prepare("UPDATE badge_redemptions SET status = ?, notes = ?, handled_by = ?, updated_at = ? WHERE id = ? AND status = ?").bind(to, notes, who.email, at, r.id, r.status)];
  if (to === "rejected") {
    // The points and the unit go back, once (the refund's source_ref is unique).
    stmts.push(env.DB.prepare("INSERT OR IGNORE INTO badge_points (id, member_id, source, source_ref, points, note, actor, created_at) SELECT ?, ?, 'refund', ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM badge_redemptions WHERE id = ? AND status = 'rejected')")
      .bind(uid("b_"), r.member_id, `refund:${r.id}`, Number(r.cost), r.reward_name, who.email, at, r.id));
    stmts.push(env.DB.prepare("UPDATE badge_rewards SET remaining = min(quantity, remaining + 1) WHERE id = ? AND EXISTS (SELECT 1 FROM badge_points WHERE source_ref = ? AND created_at = ?)").bind(r.reward_id, `refund:${r.id}`, at));
  }
  stmts.push(log(env, who, "badge.redemption", r.email || r.member_id, `${r.reward_name}: ${r.status} -> ${to}`));
  await env.DB.batch(stmts);
  return redemptions(env);
}

// ---------------------------------------------------------------- page
export function jsqr() {
  return new Response(JSQR, { headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" } });
}

export function csp(nonce) {
  return ["default-src 'none'", `script-src 'nonce-${nonce}'`, `style-src 'nonce-${nonce}'`, "font-src https://fonts.gstatic.com",
    "img-src 'self' https: data: blob:", "media-src 'self' blob:", "connect-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"].join("; ");
}

const STYLE = `
@font-face{font-family:"RB Cinzel";src:url(https://fonts.gstatic.com/s/cinzel/v26/8vIJ7ww63mVu7gt79mT7.woff2) format("woff2");font-weight:400 900;font-display:swap}
@font-face{font-family:"RB Cormorant";src:url(https://fonts.gstatic.com/s/cormorantgaramond/v21/co3bmX5slCNuHLi8bLeY9MK7whWMhyjYqXtK.woff2) format("woff2");font-weight:300 700;font-display:swap}
:root{--bg:#07060A;--panel:#100E0B;--line:#2A251C;--line2:#3B3426;--gold:#C9A227;--gold2:#E9CF83;--text:#EFE8D8;--muted:#9C9380;--bad:#E0674A;--ok:#7CC48A;
  --caps:"RB Cinzel",Cinzel,"Times New Roman",serif;--serif:"RB Cormorant","Cormorant Garamond",Georgia,serif;--sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
*{box-sizing:border-box}html{color-scheme:dark}[hidden]{display:none!important}
body{margin:0;min-height:100vh;background:radial-gradient(1200px 600px at 70% -10%,rgba(201,162,39,.10),transparent 60%),var(--bg);color:var(--text);font:15px/1.5 var(--sans)}
a{color:var(--gold2)}
.top{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 28px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.brand{font:600 12px/1 var(--caps);letter-spacing:.32em;color:var(--gold)}.brand b{display:block;margin-top:6px;font:400 11px/1 var(--sans);letter-spacing:.08em;color:var(--muted)}
.back{color:var(--muted);text-decoration:none;font-size:13px;border:1px solid var(--line2);padding:8px 14px;border-radius:999px}button.back{background:transparent;cursor:pointer;font:inherit;font-size:13px}
main{max-width:1180px;margin:0 auto;padding:22px 28px 80px}@media (max-width:700px){main,.top{padding-left:16px;padding-right:16px}}
h1{margin:0;font:500 clamp(30px,5vw,44px)/1.05 var(--serif)}.lead{color:var(--muted);max-width:760px;margin:8px 0 0}
.card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px;margin-bottom:14px;min-width:0}
.card h2.mt{margin-top:20px}.card h2{margin:0 0 10px;font:600 12px/1 var(--caps);letter-spacing:.24em;color:var(--gold)}.muted{color:var(--muted);font-size:13px}
.cols{display:grid;gap:14px;margin-top:18px}@media (min-width:900px){.cols{grid-template-columns:minmax(0,1fr) minmax(0,1.2fr)}}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.mt{margin-top:12px}
input,select,textarea{min-width:0;max-width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--line2);background:#0B0A08;color:var(--text);font:inherit}
input.grow,select.grow{flex:1 1 220px}input.num{width:110px}
.btn{appearance:none;border:1px solid var(--gold);background:transparent;color:var(--gold2);border-radius:999px;padding:10px 16px;font:600 13px/1 var(--sans);cursor:pointer;min-height:40px}
.btn.primary{background:linear-gradient(135deg,#F2D98A,#C9A227);color:#111;border-color:transparent}.btn:disabled{opacity:.5;cursor:default}.btn.bad{border-color:var(--bad);color:var(--bad)}
.cam{position:relative;border-radius:14px;overflow:hidden;background:#000;aspect-ratio:4/3;border:1px solid var(--line2)}
.cam video{width:100%;height:100%;object-fit:cover;display:block}.cam .aim{position:absolute;inset:18%;border:2px solid rgba(233,207,131,.8);border-radius:14px}
.status{padding:10px 12px;border-radius:12px;border:1px solid var(--line2);margin:10px 0;font-weight:600}.status.ok{border-color:var(--ok);color:var(--ok)}.status.bad{border-color:var(--bad);color:var(--bad)}.status.warn{border-color:var(--gold);color:var(--gold2)}
.member .lvl{display:inline-block;padding:6px 14px;border-radius:999px;border:1px solid var(--gold);font:700 14px/1 var(--caps);letter-spacing:.2em;color:var(--gold2)}
.member .name{font:600 28px/1.1 var(--serif);margin:10px 0 2px;overflow-wrap:anywhere}
.member .perks{margin:10px 0;padding:12px;border-radius:12px;background:rgba(201,162,39,.08);border:1px solid var(--line2);font-size:16px}
.nums{display:flex;flex-wrap:wrap;gap:12px 26px;margin:10px 0}.nums b{display:block;font:700 26px/1 var(--caps);color:var(--gold2)}.nums span{font-size:12px;color:var(--muted)}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{border:1px solid var(--line2);border-radius:999px;padding:4px 10px;font-size:12px;color:var(--muted)}.chip.got{border-color:var(--gold);color:var(--gold2)}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{padding:8px 6px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{color:var(--muted);font-weight:500;font-size:12px}
.scroll{overflow-x:auto}
.list button{display:block;width:100%;text-align:left;margin:6px 0;background:#0B0A08;border:1px solid var(--line2);border-radius:12px;padding:10px 12px;color:var(--text);cursor:pointer;font:inherit}
.msg{font-size:13px;min-height:1.4em}.msg.bad{color:var(--bad)}.msg.ok{color:var(--ok)}
`;

export function page(nonce, canEdit, door = false) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex">
<title>Badge desk · RB Command</title><link rel="manifest" href="/badge-desk/manifest.webmanifest"><meta name="theme-color" content="#07060A"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="RB Door"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="icon" href="https://relentlessbillionaire.com/brand/icon.svg?v=3" type="image/svg+xml"><link rel="apple-touch-icon" href="https://relentlessbillionaire.com/brand/apple-touch-icon.png?v=3">
<style nonce="${nonce}">${STYLE}</style></head><body data-edit="${canEdit ? "1" : "0"}" data-door="${door ? "1" : "0"}">
<header class="top"><div class="brand">RB COMMAND<b>Badge desk</b></div>${door ? '<button class="back" id="signout" type="button">Sign out</button>' : '<a class="back" href="/">← Back to RB Command</a>'}</header>
<main>
<h1>The door, for RB Badge.</h1>
<p class="lead">Scan a member's badge to see their level and perks, check them in for points and hand over rewards in person.${door ? "" : " Levels, rewards, achievements and point values are in Badges in the menu."} On a phone, add this page to your home screen to open it like an app.</p>
<div class="status warn" id="off" hidden></div>
<div class="cols">
  <section class="card"><h2>Scan</h2>
    <div class="row"><select class="grow" id="event" aria-label="Event"></select><input class="grow" id="event-other" placeholder="Event name" hidden aria-label="Event name"></div>
    <div class="row mt"><label class="muted" for="pts">Points for checking in</label><input class="num" id="pts" type="number" min="0" inputmode="numeric"></div>
    <div class="row mt"><button class="btn primary" id="cam-go" type="button">Start camera</button><button class="btn" id="cam-stop" type="button" hidden>Stop</button><label class="muted"><input type="checkbox" id="auto"> Check in as soon as a badge scans</label></div>
    <div class="cam mt" id="cam" hidden><video id="video" playsinline muted></video><div class="aim"></div></div>
    <p class="muted mt" id="find-label">No camera? Look the member up:</p>
    <form class="row" id="find"><input class="grow" id="q" placeholder="Email, name or pass code" autocomplete="off" aria-label="Email, name or pass code"><button class="btn" type="submit">Find</button></form>
    <div class="list" id="results"></div>
  </section>
  <section class="card member" id="member-box"><h2>Member</h2>
    <div class="status" id="tok" hidden></div>
    <p class="muted" id="empty">Scan a badge or find a member.</p>
    <div id="member" hidden>
      <span class="lvl" id="m-lvl"></span>
      <div class="name" id="m-name"></div><div class="muted" id="m-email"></div>
      <div class="perks" id="m-perks" hidden></div>
      <div class="nums"><div><b id="m-bal"></b><span>to spend</span></div><div><b id="m-life"></b><span>lifetime</span></div><div><b id="m-chk"></b><span>check-ins</span></div></div>
      <div class="row"><button class="btn primary" id="checkin" type="button">Check in</button><span class="msg" id="c-msg" role="status" aria-live="polite"></span></div>
      <div id="red-in" hidden>
        <h2 class="mt">Redeem in person</h2>
        <div class="row"><select class="grow" id="rw" aria-label="Reward"></select><button class="btn primary" id="rw-go" type="button">Redeem</button></div>
        <p class="muted" id="rw-help">Needs the QR they're showing now. It's marked delivered straight away, so hand the reward over.</p>
      </div>
      <div class="chips mt" id="m-ach"></div>
      <div id="edit-box" hidden>
        <h2 class="mt">Points by hand</h2>
        <form class="row" id="adj"><input class="num" id="adj-pts" type="number" placeholder="+50 or -50" aria-label="Points"><input class="grow" id="adj-note" maxlength="200" placeholder="Why (the member sees this)" aria-label="Why"><button class="btn" type="submit">Save</button></form>
        <div class="chips mt" id="m-grants"></div>
      </div>
      <h2 class="mt">Recent</h2><div class="scroll"><table><tbody id="m-recent"></tbody></table></div>
    </div>
  </section>
</div>
<section class="card" id="red-box" hidden><h2>Reward requests</h2><p class="muted">Contact the member at their email, then mark it delivered. Rejecting gives the points and the unit back.</p>
  <div class="scroll"><table><thead><tr><th>When</th><th>Member</th><th>Reward</th><th>Points</th><th>Status</th><th></th></tr></thead><tbody id="reds"></tbody></table></div></section>
<p class="msg" id="msg" role="status" aria-live="polite"></p>
</main>
<script nonce="${nonce}" src="/badge-desk/jsqr.js"></script>
<script nonce="${nonce}">${CLIENT}</script></body></html>`;
}

const CLIENT = String.raw`(function(){
var $ = function(id){ return document.getElementById(id); };
var EDIT = document.body.getAttribute("data-edit") === "1", DOOR = document.body.getAttribute("data-door") === "1", S = null, M = null, TOKEN = null, RAW = null, stream = null, busy = false, last = "", lastAt = 0, det = null;
var fmt = function(n){ return Number(n || 0).toLocaleString("en-US"); };
function api(path, body){
  return fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json", "X-RB-Command": "1" }, body: JSON.stringify(body), credentials: "same-origin" } : { credentials: "same-origin" })
    .then(function(r){ return r.json().catch(function(){ return {}; }).then(function(d){ if (!r.ok || d.ok === false) throw new Error(d.error || ("Error " + r.status)); return d; }); });
}
function say(id, t, kind){ var m = $(id); m.textContent = t || ""; m.className = "msg" + (kind ? " " + kind : ""); }
function el(tag, cls, text){ var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

function loadSummary(){
  return api("/api/badge-desk").then(function(d){
    S = d;
    $("off").hidden = d.on;
    $("off").textContent = d.switch === "on" ? "RB Badge is set to on but no level is live yet, so it's still off. Set a level live (with its perks) in Badges > Levels." : "RB Badge is switched off. Nobody can earn points and check-ins are paused until the owner switches it on in Badges > Settings.";
    var sel = $("event"), keep = sel.value; sel.textContent = "";
    (d.events || []).forEach(function(e){ var o = el("option", null, e.title + " · " + String(e.starts_at).slice(0, 10) + (e.venue_name ? " · " + e.venue_name : "")); o.value = "ev:" + e.id; sel.appendChild(o); });
    var other = el("option", null, "Another event (type its name)"); other.value = "other"; sel.appendChild(other);
    if (keep) sel.value = keep;
    $("event-other").hidden = sel.value !== "other";
    if (!$("pts").value) $("pts").value = d.checkin;
    $("pts").max = d.checkin_max;
    $("red-box").hidden = !EDIT;
    if (EDIT) loadReds();
  }).catch(function(e){ say("msg", e.message, "bad"); });
}

function show(d){
  // A check-in, adjustment or grant answers with the member only: keep the scan that's already on screen.
  if (!("token" in d)) d.token = TOKEN;
  var tok = $("tok");
  tok.hidden = !d.token;
  if (d.token === "ok") { tok.className = "status ok"; tok.textContent = "Badge is valid."; }
  else if (d.token === "expired") { tok.className = "status warn"; tok.textContent = "This QR is out of date (an old screenshot?). Ask them to open their badge again, or check their ID."; }
  else if (d.token === "bad") { tok.className = "status bad"; tok.textContent = "Not an RB Badge, or not a real one."; }
  TOKEN = d.token; if (d.token !== "ok") RAW = null;
  if (!d.member) { if (d.token === "bad") { M = null; $("member").hidden = true; $("empty").hidden = false; } return; }
  M = d.member; $("empty").hidden = true; $("member").hidden = false; $("results").textContent = "";
  $("m-lvl").textContent = M.level ? M.level.name.toUpperCase() : "NO LEVEL";
  $("m-name").textContent = M.name || "(no name on the account)";
  $("m-email").textContent = M.email + " · " + M.code;
  $("m-perks").hidden = !(M.level && M.level.perks); if (M.level) $("m-perks").textContent = M.level.perks;
  $("m-bal").textContent = fmt(M.balance); $("m-life").textContent = fmt(M.lifetime); $("m-chk").textContent = fmt(M.checkins);
  var ach = $("m-ach"); ach.textContent = "";
  (S.achievements || []).forEach(function(a){ ach.appendChild(el("span", "chip" + (M.earned.indexOf(a.key) >= 0 ? " got" : ""), a.name)); });
  $("edit-box").hidden = !EDIT;
  var gr = $("m-grants"); gr.textContent = "";
  (S.achievements || []).filter(function(a){ return a.rule === "manual"; }).forEach(function(a){
    var has = M.granted.indexOf(a.key) >= 0, b = el("button", "btn" + (has ? " bad" : ""), (has ? "Remove " : "Give ") + a.name); b.type = "button";
    b.addEventListener("click", function(){ api("/api/badge-desk/grant", { member_id: M.id, key: a.key, on: !has }).then(show).catch(function(e){ say("c-msg", e.message, "bad"); }); });
    gr.appendChild(b);
  });
  var tb = $("m-recent"); tb.textContent = "";
  (M.recent || []).forEach(function(r){ var tr = el("tr"); tr.appendChild(el("td", null, String(r.at).slice(0, 16).replace("T", " "))); tr.appendChild(el("td", null, r.label + (r.note ? " · " + r.note : ""))); tr.appendChild(el("td", null, (r.points > 0 ? "+" : "") + fmt(r.points))); tb.appendChild(tr); });
  $("checkin").disabled = !S.on || (DOOR && TOKEN !== "ok");
  var rw = $("rw"); rw.textContent = "";
  (S.rewards || []).forEach(function(r){ var o = el("option", null, r.name + " · " + fmt(r.cost) + " pts" + (r.remaining > 0 ? "" : " · all gone")); o.value = r.id; o.disabled = r.remaining <= 0 || M.balance < r.cost; rw.appendChild(o); });
  $("red-in").hidden = !S.on || !(S.rewards || []).length;
  $("rw-go").disabled = TOKEN !== "ok";
  $("rw-help").textContent = TOKEN === "ok" ? "It's marked delivered straight away, so hand the reward over." : "Scan their badge to redeem. Looking someone up isn't enough.";
}

function lookup(body){ return api("/api/badge-desk/lookup", body).then(function(d){ show(d); return d; }); }

function doCheckin(){
  if (!M) return;
  var sel = $("event").value, body = { member_id: M.id, points: $("pts").value };
  if (RAW && TOKEN === "ok") body.token = RAW;
  if (sel === "other") body.event_label = $("event-other").value; else body.event_id = sel.slice(3);
  $("checkin").disabled = true;
  return api("/api/badge-desk/checkin", body).then(function(d){ show(d); say("c-msg", d.already ? "Already checked in for " + d.event + "." : "Checked in for " + d.event + ".", d.already ? "" : "ok"); })
    .catch(function(e){ say("c-msg", e.message, "bad"); }).then(function(){ $("checkin").disabled = !S.on; });
}

function onCode(text){
  var now = Date.now();
  if (busy || (text === last && now - lastAt < 4000)) return;
  last = text; lastAt = now; busy = true;
  lookup({ token: text }).then(function(d){ if (d.token === "ok") RAW = text; if (d.token === "ok" && $("auto").checked && S.on) return doCheckin(); })
    .catch(function(e){ say("msg", e.message, "bad"); }).then(function(){ busy = false; });
}
function tick(){
  if (!stream) return;
  var v = $("video");
  if (v.readyState >= 2) {
    if (det) det.detect(v).then(function(c){ if (c && c[0]) onCode(c[0].rawValue); }).catch(function(){});
    else if (window.jsQR) {
      var w = Math.min(640, v.videoWidth), h = Math.round(v.videoHeight * w / v.videoWidth), c = tick.c || (tick.c = document.createElement("canvas"));
      c.width = w; c.height = h; var x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(v, 0, 0, w, h);
      var r = window.jsQR(x.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" }); if (r && r.data) onCode(r.data);
    }
  }
  setTimeout(tick, 220);
}
function camStart(){
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { say("msg", "This browser can't use the camera here. Look the member up instead.", "bad"); return; }
  try { if ("BarcodeDetector" in window) det = new window.BarcodeDetector({ formats: ["qr_code"] }); } catch (e) { det = null; }
  navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false }).then(function(s){
    stream = s; var v = $("video"); v.srcObject = s; v.play(); $("cam").hidden = false; $("cam-go").hidden = true; $("cam-stop").hidden = false; tick();
  }).catch(function(){ say("msg", "The camera was blocked. Allow it in the browser, or look the member up.", "bad"); });
}
function camStop(){ if (stream) stream.getTracks().forEach(function(t){ t.stop(); }); stream = null; $("cam").hidden = true; $("cam-go").hidden = false; $("cam-stop").hidden = true; }

function loadReds(){
  return api("/api/badge-desk/redemptions").then(function(d){
    var tb = $("reds"); tb.textContent = "";
    if (!d.redemptions.length) { var tr = el("tr"); var td = el("td", "muted", "No requests yet."); td.colSpan = 6; tr.appendChild(td); tb.appendChild(tr); }
    d.redemptions.forEach(function(r){
      var tr = el("tr");
      tr.appendChild(el("td", null, String(r.created_at).slice(0, 10)));
      tr.appendChild(el("td", null, (r.display_name ? r.display_name + " · " : "") + (r.email || "")));
      tr.appendChild(el("td", null, r.reward_name)); tr.appendChild(el("td", null, fmt(r.cost))); tr.appendChild(el("td", null, r.status));
      var act = el("td"), next = { requested: ["approved", "fulfilled", "rejected"], approved: ["fulfilled", "rejected"] }[r.status] || [];
      var names = { approved: "Approve", fulfilled: "Delivered", rejected: "Reject" };
      next.forEach(function(s){ var b = el("button", "btn" + (s === "rejected" ? " bad" : ""), names[s]); b.type = "button";
        b.addEventListener("click", function(){ if (s === "rejected" && !confirm("Reject and give back " + fmt(r.cost) + " points?")) return; api("/api/badge-desk/redemption", { id: r.id, status: s }).then(loadReds).then(loadSummary).catch(function(e){ say("msg", e.message, "bad"); }); });
        act.appendChild(b); });
      tr.appendChild(act); tb.appendChild(tr);
    });
  });
}

$("rw-go").addEventListener("click", function(){
  if (!M || !RAW) return;
  var opt = $("rw").selectedOptions[0]; if (!opt || opt.disabled) { say("c-msg", "Pick a reward they have enough points for.", "bad"); return; }
  if (!confirm("Spend their points on " + opt.textContent + "?")) return;
  $("rw-go").disabled = true;
  api("/api/badge-desk/redeem", { member_id: M.id, token: RAW, reward_id: Number(opt.value) }).then(function(d){ say("c-msg", "Redeemed " + d.reward + ". Hand it over.", "ok"); return loadSummary().then(function(){ show({ token: "ok", member: d.member }); }); })
    .catch(function(e){ say("c-msg", e.message, "bad"); $("rw-go").disabled = false; });
});
if ($("signout")) $("signout").addEventListener("click", function(){ api("/api/auth/logout", {}).catch(function(){}).then(function(){ location.href = "/"; }); });
if (DOOR) { $("find-label").textContent = "No camera? Look the member up (to check someone in, scan their badge):"; }
$("event").addEventListener("change", function(){ $("event-other").hidden = this.value !== "other"; });
$("cam-go").addEventListener("click", camStart);
$("cam-stop").addEventListener("click", camStop);
$("checkin").addEventListener("click", doCheckin);
$("find").addEventListener("submit", function(ev){
  ev.preventDefault();
  var q = $("q").value.trim();
  if (/^RBB1\./.test(q)) { onCode(q); return; }
  api("/api/badge-desk/lookup", { q: q }).then(function(d){
    var box = $("results"); box.textContent = "";
    if (!d.members.length) box.appendChild(el("p", "muted", "No badge matches."));
    d.members.forEach(function(m){ var b = el("button", null, (m.name || "(no name)") + " · " + m.email + " · " + m.code); b.type = "button"; b.addEventListener("click", function(){ lookup({ id: m.id }).catch(function(e){ say("msg", e.message, "bad"); }); }); box.appendChild(b); });
  }).catch(function(e){ say("msg", e.message, "bad"); });
});
$("adj").addEventListener("submit", function(ev){
  ev.preventDefault();
  if (!M) return;
  api("/api/badge-desk/adjust", { member_id: M.id, points: Number($("adj-pts").value), note: $("adj-note").value }).then(function(d){ show(d); $("adj-pts").value = ""; $("adj-note").value = ""; say("c-msg", "Saved.", "ok"); })
    .catch(function(e){ say("c-msg", e.message, "bad"); });
});
loadSummary();
})();`;
