// Usage: node --no-warnings rb-site-updates/test/badge.test.mjs <patched artist-router-v14.js>
// Runs the real patched artist-router bundle: RB Badge pages and API against in-memory D1s (DB and DONOR_DB), with
// Clerk's API stubbed (a generated RS256 key served as the JWKS, and per-user records). The QR on the pass is read
// back with the same decoder RB Command's door desk uses (rb-tools/vendor/jsQR-1.4.0.js).
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { fakeD1 } from "../../rb-surface/test/fake-d1.mjs";

function d1() {
  const db = fakeD1();
  db.batch = async (stmts) => {
    db.raw.exec("BEGIN");
    try {
      const out = [];
      for (const s of stmts) out.push(/^\s*(SELECT|WITH)\b/i.test(s.sql) || /\bRETURNING\b/i.test(s.sql) ? await s.all() : await s.run());
      db.raw.exec("COMMIT");
      return out;
    } catch (e) { db.raw.exec("ROLLBACK"); throw e; }
  };
  return db;
}

let NOW = Date.parse("2026-11-05T20:00:00Z");
Date.now = () => NOW;
const DAY = 864e5;
const kp = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = { ...(await crypto.subtle.exportKey("jwk", kp.publicKey)), kid: "test-kid", alg: "RS256", use: "sig" };
const b64u = (buf) => Buffer.from(buf).toString("base64url");
async function token(sub) {
  const h = b64u(JSON.stringify({ alg: "RS256", kid: "test-kid", typ: "JWT" }));
  const c = b64u(JSON.stringify({ sub, exp: 4102444800, iat: Math.floor(NOW / 1000), azp: "https://relentlessbillionaire.com" }));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(`${h}.${c}`));
  return `${h}.${c}.${b64u(sig)}`;
}
const USERS = {};
globalThis.fetch = async (input, init = {}) => {
  const u = String(input?.url || input);
  assert.equal((init.headers && (init.headers.Authorization || init.headers.authorization)) || "", "Bearer sk_test_fake");
  if (u === "https://api.clerk.com/v1/jwks") return Response.json({ keys: [jwk] });
  const m = u.match(/^https:\/\/api\.clerk\.com\/v1\/users\/([^/?]+)$/);
  if (m) {
    const x = USERS[decodeURIComponent(m[1])];
    if (!x) return new Response("{}", { status: 404 });
    return Response.json({ id: m[1], first_name: x.first || null, last_name: null, primary_email_address_id: "e1", email_addresses: [{ id: "e1", email_address: x.email, verification: { status: x.verified === false ? "unverified" : "verified" } }] });
  }
  throw new Error("unexpected fetch " + u);
};
globalThis.HTMLRewriter = class { on(sel, h) { this.h = h; return this; } transform(res) { this.h.element({ append() {} }); return res; } };

const worker = (await import(process.argv[2])).default;
const DB = d1(), DONOR_DB = d1();
DB.raw.exec(`CREATE TABLE router_schema (id TEXT PRIMARY KEY, version TEXT NOT NULL, applied_at TEXT);
INSERT INTO router_schema VALUES ('artist-router','artist-router-v14.3',datetime('now'));
CREATE TABLE signups (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), ip_hash TEXT, source TEXT);
CREATE TABLE shop_inquiries (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, product_title TEXT, brand TEXT, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, options TEXT, quantity INTEGER, message TEXT, status TEXT DEFAULT 'new', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE store_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, stripe_session_id TEXT NOT NULL UNIQUE, product_id INTEGER, product_title TEXT, brand TEXT, fulfillment_type TEXT, customer_email TEXT, customer_name TEXT, amount_total INTEGER, currency TEXT, payment_status TEXT, status TEXT DEFAULT 'paid', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE studio_memberships (clerk_user_id TEXT PRIMARY KEY, tier_key TEXT NOT NULL, status TEXT NOT NULL, stripe_customer_id TEXT, stripe_subscription_id TEXT UNIQUE, current_period_start TEXT, current_period_end TEXT, source TEXT NOT NULL DEFAULT 'admin', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE record_submissions (id TEXT PRIMARY KEY, email TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft');
CREATE TABLE rb_event_submissions (id INTEGER PRIMARY KEY AUTOINCREMENT, submitter_email TEXT NOT NULL, status TEXT DEFAULT 'pending');
CREATE TABLE rb_events (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, starts_at TEXT NOT NULL, venue_name TEXT, ticket_url TEXT, status TEXT DEFAULT 'live');`);
DONOR_DB.raw.exec(`CREATE TABLE contributions (id INTEGER PRIMARY KEY AUTOINCREMENT, stripe_event_id TEXT NOT NULL UNIQUE, email TEXT, amount_total INTEGER, payment_status TEXT);`);
const PK = "pk_test_" + btoa("example-clerk.clerk.accounts.dev$");
const env = { DB, DONOR_DB, CLERK_PUBLISHABLE_KEY: PK, CLERK_SECRET_KEY: "sk_test_fake" };
const ctx = { waitUntil() {} };
const SITE = "https://relentlessbillionaire.com";
const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
const one = (q, ...a) => DB.raw.prepare(q).get(...a);
async function go(path, { method = "GET", user, body, host = SITE } = {}) {
  const h = { "User-Agent": "Mozilla/5.0" };
  if (user) h.Authorization = "Bearer " + (await token(user));
  if (body !== undefined) { h["Content-Type"] = "application/json"; h.Origin = SITE; }
  return worker.fetch(new Request(host + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
}
async function api(path, opts) { const r = await go(path, opts); return { status: r.status, body: await r.json() }; }
const me = (user) => api("/api/badge/me", { user });
const redeem = (user, reward_id) => { NOW += 4000; return api("/api/badge/redeem", { method: "POST", user, body: { reward_id } }); };

function checkPage(r, html) {
  const csp = r.headers.get("Content-Security-Policy");
  const n = /script-src 'nonce-([A-Za-z0-9]+)'/.exec(csp)[1];
  assert.ok(!/script-src[^;]*unsafe-(inline|eval)/.test(csp), "scripts are nonce-only");
  assert.ok(!/__(NONCE|STATE|CLERK_KEY|STATUS)__/.test(html), "placeholders filled");
  const tags = html.match(/<(script|style)\b[^>]*>/g) || [];
  assert.ok(tags.length >= 1 && tags.every((t) => t.includes(`nonce="${n}"`)), "every script and style tag carries the nonce");
  assert.ok(!/<[a-z][^<>]*\sstyle=["']/i.test(html) && !/\son[a-z]+=["']/i.test(html), "no inline style or handler attributes");
  for (const m of html.matchAll(/<script(?![^>]*application\/json)[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(m[1]);
}

// ---------------------------------------------------------------- 1. off by default
{
  const r = await go("/badge"), html = await r.text();
  assert.equal(r.status, 200); checkPage(r, html);
  assert.ok(html.includes('data-status="off"') && html.includes("RB Badge is coming soon"));
  assert.ok(html.includes(JSON.stringify(PK)), "Clerk key injected");
  assert.equal((await go("/badge/", { host: "https://www.relentlessbillionaire.com" })).status, 200);
  const t = await go("/badge/terms"), th = await t.text();
  assert.equal(t.status, 200); checkPage(t, th);
  assert.ok(th.includes("RB Badge is coming soon. These terms show the values") && th.includes("no cash value"), "terms visible for review, marked coming soon");
  assert.ok(!th.includes("DRAFT"), "draft perks are never published");
  assert.ok(th.includes("Levels and what each one gets you are listed here once RB publishes them"));
  const st = await api("/api/badge/state");
  assert.equal(st.body.status, "off"); assert.deepEqual(st.body.levels, []); assert.deepEqual(st.body.earn, []);
  assert.equal(one("SELECT value FROM badge_config WHERE key='enabled'").value, "off");
  assert.equal(one("SELECT count(*) n FROM badge_levels WHERE status='draft'").n, 4, "four draft levels");
  USERS.u_alice = { email: "Alice@Example.com", first: "Alice" };
  const m = await me("u_alice");
  assert.equal(m.status, 403); assert.match(m.body.error, /coming soon/);
  assert.equal(one("SELECT count(*) n FROM badge_points").n, 0, "nothing is awarded while off");
  sql("UPDATE badge_config SET value='on' WHERE key='enabled'");
  assert.equal((await api("/api/badge/state")).body.status, "off", "switched on but no live level: still off");
}

// ---------------------------------------------------------------- 2. switched on: points pulled from what Alice already did
sql("UPDATE badge_levels SET status='live', perks='Early access to RB show tickets.' WHERE level_key='bronze'");
sql("UPDATE badge_levels SET status='live', perks='Guest list at RB shows.' WHERE level_key='gold'");
sql("INSERT INTO signups (email, name) VALUES ('alice@example.com', 'Alice')");
sql("INSERT INTO shop_inquiries (name, email, options) VALUES ('A', 'ALICE@example.com', 'membership:apply:coach'), ('A', 'alice@example.com', 'membership:apply:coach'), ('A', 'alice@example.com', 'membership:made-up')");
sql("INSERT INTO store_orders (stripe_session_id, customer_email, amount_total, payment_status, status) VALUES ('cs_1', 'alice@example.com', 2540, 'paid', 'paid'), ('cs_2', 'alice@example.com', 900000, 'paid', 'fulfilled'), ('cs_3', 'alice@example.com', 5000, 'unpaid', 'pending')");
DONOR_DB.raw.prepare("INSERT INTO contributions (stripe_event_id, email, amount_total, payment_status) VALUES ('evt_1', 'alice@example.com', 1000, 'paid')").run();
sql("INSERT INTO studio_memberships (clerk_user_id, tier_key, status) VALUES ('u_alice', 'pro', 'active')");
sql("INSERT INTO record_submissions (id, email, status) VALUES ('s1', 'alice@example.com', 'approved'), ('s2', 'alice@example.com', 'licensed')");
sql("INSERT INTO rb_event_submissions (submitter_email, status) VALUES ('alice@example.com', 'published'), ('alice@example.com', 'declined')");
{
  const st = await api("/api/badge/state");
  assert.equal(st.body.status, "live");
  assert.deepEqual(st.body.levels.map((l) => l.key), ["bronze", "gold"], "only live levels with real perks");
  assert.ok(st.body.earn.some((x) => x.label === "Show up"));
  const m = await me("u_alice");
  assert.equal(m.status, 200, JSON.stringify(m.body));
  // welcome 50 + daily 5 + list 25 + coach 50 + $25 order 250 + $9000 order capped 5000 + $10 gift 100 + member 100 + song 100 + event 50
  const want = 50 + 5 + 25 + 50 + 250 + 5000 + 100 + 100 + 100 + 50;
  assert.equal(m.body.added, want); assert.equal(m.body.standing.lifetime, want); assert.equal(m.body.standing.balance, want);
  assert.equal(m.body.standing.level.key, "gold"); assert.equal(m.body.standing.next, null);
  assert.equal(m.body.member.name, "Alice"); assert.match(m.body.member.email, /^al•+@example\.com$/);
  for (const k of ["on_the_list", "supporter", "backer", "member", "released", "promoter"]) assert.ok(m.body.standing.earned.includes(k), k);
  assert.ok(!m.body.standing.earned.includes("first_night") && !m.body.standing.earned.includes("founding"), "no check-in yet; drafts never earned");
  assert.ok(m.body.standing.earned.includes("club_1k"));
  const again = await me("u_alice");
  assert.equal(again.body.added, 0, "nothing counts twice"); assert.equal(again.body.standing.lifetime, want);
  NOW += DAY;
  assert.equal((await me("u_alice")).body.added, 5, "the next day: today's points");

  // ---- the pass: a signed token, in a QR the door desk's decoder reads back
  const pass = again.body.pass, mem = one("SELECT * FROM badge_members WHERE clerk_user_id='u_alice'");
  const [v, code, minute, sig] = pass.token.split(".");
  assert.equal(v, "RBB1"); assert.equal(code, mem.pass_code); assert.match(code, /^[A-Z2-9]{12}$/);
  assert.equal(sig, createHmac("sha256", mem.pass_secret).update(`RBB1.${code}.${minute}`).digest("hex").slice(0, 24), "signed with the member's own secret");
  assert.equal(pass.code, code.replace(/(.{4})(?=.)/g, "$1-"));
  const size = Number(/viewBox="0 0 (\d+) \1"/.exec(pass.svg)[1]), S = 4, px = new Uint8ClampedArray(size * S * size * S * 4).fill(255);
  for (const mm of pass.svg.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    const x0 = +mm[1] * S, y0 = +mm[2] * S;
    for (let y = y0; y < y0 + S; y++) for (let x = x0; x < x0 + S; x++) px.fill(0, (y * size * S + x) * 4, (y * size * S + x) * 4 + 3);
  }
  const jsQR = vm.runInNewContext(readFileSync(new URL("../../rb-tools/vendor/jsQR-1.4.0.js", import.meta.url), "utf8") + ";self.jsQR", { self: {} });
  assert.equal(jsQR(px, size * S, size * S)?.data, pass.token, "the QR decodes to the token");
  const p2 = await api("/api/badge/pass", { user: "u_alice" });
  assert.equal(p2.status, 200); assert.equal(p2.body.pass.code, pass.code);
}

// ---------------------------------------------------------------- 3. rewards: spend, run out, level-only, drafts
sql("INSERT INTO badge_rewards (name, description, cost, quantity, remaining, status) VALUES ('RB hoodie', 'One RB hoodie, any size.', 1000, 1, 1, 'live')");
sql("INSERT INTO badge_rewards (name, description, cost, quantity, remaining, status) VALUES ('Secret', 'DRAFT: not yet', 10, 5, 5, 'live')");
sql("INSERT INTO badge_rewards (name, description, cost, quantity, remaining, status, min_level) VALUES ('Black table', 'A table for four.', 10, 5, 5, 'live', 'black')");
sql("UPDATE badge_levels SET status='live', perks='VIP at RB events.', min_points=100000 WHERE level_key='black'");
USERS.u_bob = { email: "bob@example.com" };
{
  const st = (await api("/api/badge/state")).body;
  assert.deepEqual(st.rewards.map((r) => r.name).sort(), ["Black table", "RB hoodie"], "draft rewards stay hidden");
  const id = (n) => st.rewards.find((r) => r.name === n).id, hoodie = id("RB hoodie"), table = id("Black table");
  const before = (await me("u_alice")).body.standing;
  const r = await redeem("u_alice", hoodie);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.standing.balance, before.balance - 1000); assert.equal(r.body.standing.lifetime, before.lifetime, "spending never lowers the level");
  assert.equal(one("SELECT remaining FROM badge_rewards WHERE name='RB hoodie'").remaining, 0);
  assert.equal(one("SELECT status FROM badge_redemptions").status, "requested");
  await me("u_bob");
  sql("INSERT INTO badge_points (id, member_id, source, source_ref, points, created_at) SELECT 'x1', id, 'adjust', 'adjust:x1', 5000, datetime('now') FROM badge_members WHERE clerk_user_id='u_bob'");
  const out = await redeem("u_bob", hoodie);
  assert.equal(out.status, 409); assert.match(out.body.error, /run out/);
  const lvl = await redeem("u_alice", table);
  assert.equal(lvl.status, 403); assert.match(lvl.body.error, /Black members and up/);
  assert.equal((await redeem("u_alice", 2)).status, 404, "a draft reward can't be redeemed");
  sql("UPDATE badge_rewards SET remaining = 3, quantity = 3 WHERE name='RB hoodie'");
  const poor = await redeem("u_bob", hoodie);
  assert.equal(poor.status, 200, "bob has 5,000+ from the team");
  sql("DELETE FROM badge_points WHERE source_ref='adjust:x1'");
  const broke = await redeem("u_bob", hoodie);
  assert.equal(broke.status, 409); assert.match(broke.body.error, /You need 1,000 points/);
  const hist = (await me("u_alice")).body;
  assert.equal(hist.redemptions[0].reward, "RB hoodie");
  assert.ok(hist.history.some((x) => x.source === "redeem" && x.points === -1000));
}

// ---------------------------------------------------------------- 3b. the RB app and RB Gold Rush
{
  sql("INSERT INTO rb_events (title, starts_at, venue_name, ticket_url, status) VALUES ('RB Comedy Night', datetime('now', '+3 days'), 'The Room', 'https://tickets.example/rb', 'live'), ('Old', datetime('now', '-9 days'), 'x', '', 'live'), ('Hidden', datetime('now', '+2 days'), 'x', 'javascript:alert(1)', 'archived')");
  const app = await go("/app"), ah = await app.text();
  assert.equal(app.status, 200); checkPage(app, ah);
  assert.ok(ah.includes('data-rbtabs="off"') && ah.includes('rel="manifest" href="/app/manifest.webmanifest"') && ah.includes("function rbgPlan("), "app page with its game");
  const man = await go("/app/manifest.webmanifest");
  assert.equal(man.headers.get("Content-Type"), "application/manifest+json");
  const mj = await man.json(); assert.equal(mj.start_url, "/app"); assert.equal(mj.display, "standalone"); assert.ok(mj.icons.some((i) => i.purpose === "maskable"));
  const st = (await api("/api/badge/state")).body;
  assert.deepEqual(st.events.map((e) => e.title), ["RB Comedy Night"], "upcoming live events only"); assert.equal(st.events[0].ticket_url, "https://tickets.example/rb");
  assert.equal(st.game.round_max, 20); assert.ok(st.earn.some((x) => x.label === "Play RB Gold Rush"));
  const terms = await (await go("/badge/terms")).text();
  assert.ok(terms.includes("RB Gold Rush is a free game") && terms.includes("1 point for every 10 score") && terms.includes("spend points in person"));

  const plan = vm.runInNewContext(readFileSync(new URL("../src/badge/goldrush.js", import.meta.url), "utf8") + ";({ rbgPlan, rbgMax, RBG_MS })");
  const startRound = () => api("/api/badge/game/start", { method: "POST", user: "u_bob", body: {} });
  const finish = (round, score) => api("/api/badge/game/finish", { method: "POST", user: "u_bob", body: { round, score } });
  const bobBefore = (await me("u_bob")).body.standing.lifetime;
  let r = await startRound();
  assert.equal(r.status, 200); assert.equal(r.body.ms, 45000);
  const max = plan.rbgMax(r.body.seed);
  assert.ok(max > 300 && max < 2000, "a round is worth a few hundred");
  assert.equal(max, plan.rbgPlan(r.body.seed).filter((x) => x.value > 0).reduce((n, x) => n + x.value, 0));
  assert.equal((await finish(r.body.round, 100)).status, 409, "the round isn't over yet");
  NOW += 46000;
  assert.match((await finish(r.body.round, max + 10)).body.error, /higher than the round allowed/);
  assert.equal((await finish(r.body.round, -5)).status, 400);
  assert.equal((await api("/api/badge/game/finish", { method: "POST", user: "u_alice", body: { round: r.body.round, score: 10 } })).status, 404, "someone else's round");
  let f = await finish(r.body.round, 157);
  assert.equal(f.status, 200, JSON.stringify(f.body)); assert.equal(f.body.points, 15); assert.equal(f.body.standing.lifetime, bobBefore + 15);
  assert.equal((await finish(r.body.round, 157)).status, 409, "counted once");
  // the round cap, then the daily cap
  r = await startRound(); NOW += 46000; f = await finish(r.body.round, Math.min(max, plan.rbgMax(r.body.seed)));
  assert.equal(f.body.points, 20, "at most 20 a round");
  r = await startRound(); NOW += 46000; f = await finish(r.body.round, plan.rbgMax(r.body.seed));
  assert.equal(f.body.points, 20); assert.equal(f.body.today.points, 55);
  r = await startRound(); NOW += 46000; f = await finish(r.body.round, plan.rbgMax(r.body.seed));
  assert.equal(f.body.points, 5); assert.equal(f.body.capped, true, "60 a day");
  r = await startRound(); NOW += 46000; f = await finish(r.body.round, plan.rbgMax(r.body.seed));
  assert.equal(f.body.points, 0); assert.equal(f.body.today.points, 60);
  r = await startRound(); NOW += 20 * 60000; f = await finish(r.body.round, 50);
  assert.equal(f.body.points, 0); assert.equal(f.body.late, true, "a round sent much later earns nothing");
  sql("UPDATE badge_config SET value='7' WHERE key='game_rounds_daily'");
  assert.equal((await startRound()).status, 200);
  const no = await startRound(); assert.equal(no.status, 429); assert.match(no.body.error, /all 7 rounds/);
  const hist = (await me("u_bob")).body;
  assert.ok(hist.history.some((x) => x.source === "game" && x.label === "RB Gold Rush")); assert.equal(hist.game.points, 60);
  assert.equal(one("SELECT count(*) n FROM badge_points WHERE source='game'").n, 4, "one ledger row per round that earned");
}

// ---------------------------------------------------------------- 3c. RB World, on RB's own backend
{
  sql("CREATE TABLE IF NOT EXISTS ads (id INTEGER PRIMARY KEY AUTOINCREMENT, advertiser TEXT NOT NULL, headline TEXT, body TEXT, status TEXT DEFAULT 'live', starts_at TEXT, ends_at TEXT, weight INTEGER DEFAULT 1, surface TEXT NOT NULL DEFAULT 'all')");
  sql("INSERT INTO ads (advertiser, headline, body, surface) VALUES ('Acme', 'Acme Studios', 'Book a session', 'game'), ('Radio only', 'x', 'y', 'radio')");
  const redir = await go("/app/world");
  assert.equal(redir.status, 301); assert.equal(redir.headers.get("Location"), "/app/world/");
  const w = await go("/app/world/"), wh = await w.text();
  assert.equal(w.status, 200);
  const csp = w.headers.get("Content-Security-Policy");
  assert.ok(/connect-src 'self'[^;]*basemaps\.cartocdn\.com/.test(csp) && !/esm\.sh|instantdb|stripe/i.test(csp), "the game's hosts only: no InstantDB, no Stripe");
  assert.ok(!/instantdb|esm\.sh|js\.stripe\.com|\$9\.99/i.test(wh), "no InstantDB, Stripe or the unbacked $9.99 offer");
  assert.ok(wh.includes('src="/app/world/main.js?v=w3"') && wh.includes('data-rbtabs="off"') && wh.includes(JSON.stringify(PK)) && wh.includes("window.RBLoadClerk"));
  assert.ok(wh.includes("OPEN THE RB APP") && wh.includes("SEE MEMBERSHIPS"));
  const mj = await (await go("/app/world/main.js")).text(), cj = await (await go("/app/world/rb_world.js")).text();
  assert.ok(mj.includes("from './rb_world.js'") && !mj.includes("@instantdb") && mj.includes("const db = init();"));
  assert.ok(cj.includes("/api/world/beat") && cj.includes("export function init"));
  const beat = (user, body) => { NOW += 4000; return api("/api/world/beat", { method: "POST", user, body }); };
  let b = await beat(null, { id: "aaaaaaaa-1111", name: "<b>Guest</b>", pos: [-74.0, 40.7], netWorth: 75000, tokens: 500, health: 100 });
  assert.equal(b.status, 200, JSON.stringify(b.body)); assert.deepEqual(b.body.points, { member: false, on: true }, "guests play without points");
  assert.equal(b.body.board[0].name, "bGuest/b", "names are cleaned");
  b = await beat(null, { id: "bbbbbbbb-2222", name: "Rival", pos: [-74.01, 40.71], netWorth: 9e6 });
  assert.deepEqual(b.body.peers.map((x) => x.id), ["aaaaaaaa-1111"], "sees the other player"); assert.deepEqual(b.body.peers[0].pos, [-74, 40.7]);
  assert.deepEqual(b.body.board.map((x) => x.name), ["Rival", "bGuest/b"], "leaderboard by net worth");
  assert.equal((await beat(null, { id: "bad" })).status, 400);
  const chat = (id, text) => api("/api/world/chat", { method: "POST", body: { id, name: "Rival", text } });
  assert.equal((await chat("bbbbbbbb-2222", "  ")).status, 400);
  assert.equal((await chat("bbbbbbbb-2222", "gm <script>")).status, 200);
  b = await beat(null, { id: "aaaaaaaa-1111", name: "Guest", since: 0 });
  assert.equal(b.body.chat.at(-1).text, "gm script"); assert.equal(b.body.chat.at(-1).senderId, "bbbbbbbb-2222");
  const since = b.body.chat.at(-1).n;
  b = await beat(null, { id: "aaaaaaaa-1111", name: "Guest", since });
  assert.deepEqual(b.body.chat, [], "only new messages after since");
  let limited = 0; for (let i = 0; i < 14; i++) if ((await chat("bbbbbbbb-2222", "msg " + i)).status === 429) limited++;
  assert.ok(limited >= 2, "chat is rate limited");
  NOW += 120000;
  assert.deepEqual((await beat(null, { id: "aaaaaaaa-1111", name: "Guest" })).body.peers, [], "players gone quiet drop off");
  const ads = (await api("/api/world/ads")).body.ads;
  assert.ok(ads.some((x) => x.title === "Acme Studios" && x.channel === "Ticker") && !ads.some((x) => x.title === "x"), "game ads only");
  assert.ok(ads.some((x) => x.title === "RB Comedy Night"), "upcoming RB Events in the ticker");

  // play time while signed in: 5 points per 10 minutes, up to 30 a day
  const before = (await me("u_bob")).body.standing.lifetime;
  let added = 0;
  for (let i = 0; i < 151; i++) { const r = await beat("u_bob", { id: "cccccccc-3333", name: "Bob" }); added += r.body.points.added || 0; }
  assert.equal(added, 5, "10 minutes of beats: 5 points"); assert.equal((await me("u_bob")).body.standing.lifetime, before + 5);
  NOW += 5 * 60000;
  const gap = await beat("u_bob", { id: "cccccccc-3333", name: "Bob" });
  assert.equal(gap.body.points.minutes, 10, "a five-minute gap isn't play time");
  sql("UPDATE badge_config SET value='1' WHERE key='world_block_minutes'");
  for (let i = 0; i < 200; i++) await beat("u_bob", { id: "cccccccc-3333", name: "Bob" });
  const capped = await beat("u_bob", { id: "cccccccc-3333", name: "Bob" });
  assert.equal(capped.body.points.today, 30, "30 a day"); assert.equal(capped.body.points.daily, 30);
  assert.equal(one("SELECT coalesce(sum(points), 0) n FROM badge_points WHERE source='world'").n, 30);
  assert.equal(one("SELECT clerk_user_id FROM world_players WHERE id='cccccccc-3333'").clerk_user_id, "u_bob", "the player is linked to the account");
  assert.ok((await me("u_bob")).body.history.some((x) => x.label === "Played RB World"));
  const terms = await (await go("/badge/terms")).text();
  assert.ok(terms.includes("RB World, the 3D city game") && terms.includes("are not RB Badge points"));
}

// ---------------------------------------------------------------- 4. sign-in rules and the switch
{
  assert.equal((await me()).status, 401, "needs sign-in");
  USERS.u_unv = { email: "x@example.com", verified: false };
  assert.equal((await me("u_unv")).status, 403, "verified email required");
  const h = { "Content-Type": "application/json", Origin: "https://evil.example", Authorization: "Bearer " + (await token("u_alice")) };
  const evil = await worker.fetch(new Request(SITE + "/api/badge/redeem", { method: "POST", headers: h, body: "{}" }), env, ctx);
  assert.equal(evil.status, 403, "cross-site posts refused");
  const live = await go("/badge"), lh = await live.text();
  assert.ok(lh.includes('data-status="live"')); checkPage(live, lh);
  const terms = await (await go("/badge/terms")).text();
  assert.ok(terms.includes("Guest list at RB shows.") && terms.includes("RB hoodie") && !terms.includes("coming soon"));
  sql("UPDATE badge_config SET value='off' WHERE key='enabled'");
  assert.equal((await me("u_alice")).status, 403, "switched off again: closed");
  const ob = await api("/api/world/beat", { method: "POST", body: { id: "aaaaaaaa-1111", name: "Guest" } });
  assert.equal(ob.status, 200, "RB World stays open with RB Badge off"); assert.deepEqual(ob.body.points, { member: false, on: false }, "but no points");
  const signedOff = await api("/api/world/beat", { method: "POST", user: "u_bob", body: { id: "cccccccc-3333", name: "Bob" } });
  assert.equal(signedOff.body.points.member, false, "signed in, still no points while RB Badge is off");
  assert.ok((await (await go("/app/world/")).text()).includes("/app/world/main.js"), "the world page plays");
  sql("UPDATE badge_config SET value='off' WHERE key='world_open'");
  assert.equal((await api("/api/world/beat", { method: "POST", body: { id: "aaaaaaaa-1111" } })).status, 403, "RB World open = off closes it");
  const closed = await (await go("/app/world/")).text();
  assert.ok(closed.includes("coming soon") && !closed.includes("main.js"), "the world page says coming soon");
  sql("UPDATE badge_config SET value='on' WHERE key='world_open'");
}
console.log("badge ok: RB World on RB's backend (page, no InstantDB or Stripe, players, leaderboard, chat with limits, ads ticker, play-time points with gaps and daily cap), RB app and manifest, Gold Rush scores checked against the round (early, too high, twice, late, round and daily caps, rounds a day), off by default, terms for review, pulled points counted once, levels, achievements, signed QR read back, redeem with stock/balance/level checks, sign-in rules");
