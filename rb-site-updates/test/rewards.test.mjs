// Usage: node --no-warnings rb-site-updates/test/rewards.test.mjs <patched artist-router-v14.js>
// Runs the real patched artist-router bundle: RB Collect pages and API against in-memory D1s (DB and DONOR_DB),
// with Clerk's API stubbed (a generated RS256 key served as the JWKS, and per-user email records).
import assert from "node:assert/strict";
import vm from "node:vm";
import { fakeD1 } from "../../rb-surface/test/fake-d1.mjs";

// D1's batch() runs its statements in order in one transaction and returns rows for queries. The shared fake runs
// everything with run(), so wrap it here.
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

// ---------------------------------------------------------------- time, Clerk and HTMLRewriter stubs
let NOW = Date.parse("2026-11-05T20:00:00Z");
const realNow = Date.now;
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
const USERS = {}; // clerk id -> { email, verified }
let clerkUserCalls = 0;
globalThis.fetch = async (input, init = {}) => {
  const u = String(input?.url || input);
  const auth = (init.headers && (init.headers.Authorization || init.headers.authorization)) || "";
  assert.equal(auth, "Bearer sk_test_fake", "Clerk Backend API called with the secret key");
  if (u === "https://api.clerk.com/v1/jwks") return Response.json({ keys: [jwk] });
  const m = u.match(/^https:\/\/api\.clerk\.com\/v1\/users\/([^/?]+)$/);
  if (m) {
    clerkUserCalls++;
    const x = USERS[decodeURIComponent(m[1])];
    if (!x) return new Response("{}", { status: 404 });
    return Response.json({ id: m[1], primary_email_address_id: "e1", email_addresses: [{ id: "e0", email_address: "old@example.com", verification: { status: "verified" } }, { id: "e1", email_address: x.email, verification: { status: x.verified === false ? "unverified" : "verified" } }] });
  }
  throw new Error("unexpected fetch " + u);
};
let radioTag = null;
globalThis.HTMLRewriter = class { on(sel, h) { this.h = h; return this; } transform(res) { this.h.element({ append: (t) => { radioTag = t; } }); return res; } };

// ---------------------------------------------------------------- the worker and its databases
const worker = (await import(process.argv[2])).default;
const DB = d1(), DONOR_DB = d1();
DB.raw.exec(`CREATE TABLE router_schema (id TEXT PRIMARY KEY, version TEXT NOT NULL, applied_at TEXT);
INSERT INTO router_schema VALUES ('artist-router','artist-router-v14.3',datetime('now'));
CREATE TABLE signups (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), ip_hash TEXT, source TEXT);
CREATE TABLE shop_inquiries (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER, product_title TEXT, brand TEXT, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, options TEXT, quantity INTEGER, message TEXT, status TEXT DEFAULT 'new', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE store_orders (id INTEGER PRIMARY KEY AUTOINCREMENT, stripe_session_id TEXT NOT NULL UNIQUE, product_id INTEGER, product_title TEXT, brand TEXT, fulfillment_type TEXT, customer_email TEXT, customer_name TEXT, amount_total INTEGER, currency TEXT, payment_status TEXT, status TEXT DEFAULT 'paid', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE studio_memberships (clerk_user_id TEXT PRIMARY KEY, tier_key TEXT NOT NULL, status TEXT NOT NULL, stripe_customer_id TEXT, stripe_subscription_id TEXT UNIQUE, current_period_start TEXT, current_period_end TEXT, source TEXT NOT NULL DEFAULT 'admin', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));`);
DONOR_DB.raw.exec(`CREATE TABLE contributions (id INTEGER PRIMARY KEY AUTOINCREMENT, stripe_event_id TEXT NOT NULL UNIQUE, stripe_invoice_id TEXT, stripe_checkout_session_id TEXT, stripe_payment_intent_id TEXT, stripe_subscription_id TEXT, stripe_customer_id TEXT, email TEXT, event_type TEXT NOT NULL, support_type TEXT, tier_id TEXT, amount_total INTEGER, currency TEXT, payment_status TEXT, subscription_status TEXT, occurred_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
const PK = "pk_test_" + btoa("example-clerk.clerk.accounts.dev$");
const env = { DB, DONOR_DB, CLERK_PUBLISHABLE_KEY: PK, CLERK_SECRET_KEY: "sk_test_fake" };
const ctx = { waitUntil() {} };
const SITE = "https://relentlessbillionaire.com";
const sql = (q, ...a) => DB.raw.prepare(q).run(...a);
const one = (q, ...a) => DB.raw.prepare(q).get(...a);

async function go(path, { method = "GET", user, body, headers = {}, host = SITE } = {}) {
  const h = { "User-Agent": "Mozilla/5.0", ...headers };
  if (user) h.Authorization = "Bearer " + (await token(user));
  if (body !== undefined) { h["Content-Type"] = "application/json"; h.Origin = SITE; }
  return worker.fetch(new Request(host + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), env, ctx);
}
async function api(path, opts) { const r = await go(path, opts); return { status: r.status, body: await r.json() }; }
const me = (user, headers) => api("/api/rewards/me", { user, headers });
const play = (user) => { NOW += 3000; return api("/api/rewards/play", { method: "POST", user, body: {} }); }; // 20 a minute, under the limit

// ---------------------------------------------------------------- 1. off by default
function checkPage(r, html) {
  const csp = r.headers.get("Content-Security-Policy");
  const n = /script-src 'nonce-([A-Za-z0-9]+)'/.exec(csp)[1];
  for (const d of ["default-src 'self'", "object-src 'none'", "base-uri 'none'", "frame-ancestors 'self'", "https://example-clerk.clerk.accounts.dev", "https://clerk.relentlessbillionaire.com", "https://*.clerk.accounts.dev", "font-src https://fonts.gstatic.com"]) assert.ok(csp.includes(d), d);
  assert.ok(!/script-src[^;]*unsafe-(inline|eval)/.test(csp), "scripts are nonce-only");
  assert.ok(!html.includes("__NONCE__") && !html.includes("__STATE__") && !html.includes("__CLERK_KEY__") && !html.includes("__STATUS__"), "placeholders filled");
  const tags = html.match(/<(script|style)\b[^>]*>/g) || [];
  assert.ok(tags.length >= 1 && tags.every((t) => t.includes(`nonce="${n}"`)), "every script and style tag carries the nonce");
  assert.ok(!/<[a-z][^<>]*\sstyle=["']/i.test(html) && !/\son[a-z]+=["']/i.test(html), "no inline style or handler attributes");
  for (const m of html.matchAll(/<script(?![^>]*application\/json)[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(m[1]);
  // The RB Radio bar is still added, with the page's nonce, and the CSP widened for it.
  assert.ok(radioTag && radioTag.includes(`nonce="${n}"`), "radio bar tag uses the page nonce");
  assert.ok(/script-src [^;]*https:\/\/relentlessbillionaire\.com/.test(csp), "CSP widened for the radio script");
  return n;
}
{
  const nonces = new Set();
  for (const path of ["/rewards", "/rewards/"]) {
    radioTag = null;
    const r = await go(path);
    assert.equal(r.status, 200, path);
    const html = await r.text();
    nonces.add(checkPage(r, html));
    assert.ok(html.includes('data-status="off"') && html.includes("RB Collect is coming soon"), "coming soon while off");
    assert.ok(html.includes("No purchase or membership necessary. Free play every day."));
    assert.ok(html.includes('href="/memberships"') && html.includes("/rewards/rules"));
    assert.ok(!html.includes("Photoshoot session"), "draft prize names are not published");
    assert.ok(html.includes(JSON.stringify(PK)), "Clerk publishable key injected");
  }
  assert.equal(nonces.size, 2, "fresh nonce per request");
  const head = await go("/rewards", { method: "HEAD" }); assert.equal(head.status, 200); assert.equal(await head.text(), "");
  assert.equal((await go("/rewards", { host: "https://www.relentlessbillionaire.com" })).status, 200);
  const rules = await go("/rewards/rules"); const rh = await rules.text();
  assert.equal(rules.status, 200); checkPage(rules, rh);
  assert.ok(rh.includes("No prizes are live yet") && rh.includes("Relentless Billionaire") && rh.includes("NO PURCHASE OR MEMBERSHIP NECESSARY"));
  const st = await api("/api/rewards/state");
  assert.equal(st.body.status, "off"); assert.equal(st.body.live, false);
  assert.ok(!JSON.stringify(st.body).includes("Photoshoot session"), "state hides drafts");
  assert.equal(one("SELECT count(*) n FROM reward_prizes WHERE status='draft' AND quantity=0 AND remaining=0").n, 4, "four draft prizes, quantity 0");
  assert.equal(one("SELECT count(*) n FROM reward_pieces").n, 12);
  assert.equal(one("SELECT value FROM reward_config WHERE key='enabled'").value, "off");
}
USERS.u_alice = { email: "Alice@Example.com" };
USERS.u_bob = { email: "bob@example.com" };
{
  const m = await me("u_alice");
  assert.equal(m.status, 200); assert.equal(m.body.plays, 0, "nothing is awarded while off");
  const p = await play("u_alice");
  assert.equal(p.status, 403); assert.match(p.body.error, /coming soon/);
  assert.equal((await api("/api/rewards/code", { method: "POST", user: "u_alice", body: { code: "X1X" } })).status, 403);
  assert.equal((await api("/api/rewards/claim", { method: "POST", user: "u_alice", body: { set: "front_row" } })).status, 403);
  assert.equal((await me()).status, 401, "me needs sign-in");
  USERS.u_unv = { email: "unverified@example.com", verified: false };
  assert.equal((await me("u_unv")).status, 403, "verified email required");
}

// ---------------------------------------------------------------- 2. switch on, awards from every source exactly once
sql("UPDATE reward_config SET value='on' WHERE key='enabled'");
sql("UPDATE reward_prizes SET status='live', quantity=1, remaining=1, name='2 tickets to the RB show' WHERE set_key='front_row'");
sql("UPDATE reward_prizes SET status='live', quantity=0, remaining=0 WHERE set_key='camera_ready'"); // live but none left: never drawn
sql("INSERT INTO signups (email, name) VALUES ('alice@example.com', 'Alice')");
sql("INSERT INTO shop_inquiries (name, email, options) VALUES ('A', 'alice@example.com', 'membership:waitlist:just-starting'), ('A', 'alice@example.com', 'membership:apply:just-starting'), ('A', 'ALICE@example.com', 'membership:apply:coach'), ('A', 'alice@example.com', 'membership:x:t1'), ('A', 'alice@example.com', 'membership:apply:made-up-tier'), ('A', 'alice@example.com', 'beat:wav')");
sql("INSERT INTO store_orders (stripe_session_id, customer_email, amount_total, payment_status, status) VALUES ('cs_1', 'alice@example.com', 3500, 'paid', 'paid'), ('cs_2', 'alice@example.com', 9000, 'paid', 'refunded'), ('cs_3', 'alice@example.com', 50000, 'paid', 'fulfilled')");
sql("INSERT INTO studio_memberships (clerk_user_id, tier_key, status) VALUES ('u_alice', 'artist', 'active')");
DONOR_DB.raw.exec("INSERT INTO contributions (stripe_event_id, email, event_type, amount_total, payment_status, occurred_at) VALUES ('evt_a', 'alice@example.com', 'checkout.session.completed', 1200, 'paid', 'x'), ('evt_b', 'alice@example.com', 'invoice.paid', 50000, 'paid', 'x'), ('evt_c', 'alice@example.com', 'invoice.payment_failed', 5000, 'unpaid', 'x')");
// welcome 3 + daily 1 + signup 2 + membership 5 x 2 tiers + orders (3, capped 20) + gifts (4, capped 40) + member daily 2
const EXPECT = 3 + 1 + 2 + 10 + 3 + 20 + 4 + 40 + 2;
{
  const st = await api("/api/rewards/state");
  assert.equal(st.body.status, "live");
  assert.deepEqual(st.body.sets.map((s) => s.set_key), ["front_row", "camera_ready"], "only live sets are shown");
  assert.ok(st.body.earn.some((e) => e.key === "membership" && e.href === "/memberships" && e.plays === 5));
  assert.ok(st.body.earn.some((e) => e.key === "contribution" && e.href === "/fund"));
  const a1 = await me("u_alice");
  assert.equal(a1.body.added, EXPECT); assert.equal(a1.body.plays, EXPECT);
  for (let i = 0; i < 3; i++) { const again = await me("u_alice"); assert.equal(again.body.added, 0); assert.equal(again.body.plays, EXPECT); }
  assert.equal(one("SELECT count(*) n FROM reward_awards WHERE source='membership'").n, 2, "one award per real membership tier; made-up tiers and mismatched request types earn nothing");
  assert.equal(one("SELECT count(*) n FROM reward_awards WHERE source='order'").n, 2, "refunded order not counted");
  assert.equal(one("SELECT count(*) n FROM reward_awards WHERE source='contribution'").n, 2, "unpaid contribution not counted");
  // daily play once per day; the next Pacific day gives it again (plus the member daily plays)
  NOW += DAY;
  const a2 = await me("u_alice"); assert.equal(a2.body.added, 1 + 2); assert.equal(a2.body.plays, EXPECT + 3);
  assert.equal((await me("u_alice")).body.added, 0);
  // an optional source disappearing never breaks the game
  DB.raw.exec("ALTER TABLE studio_memberships RENAME TO studio_memberships_x");
  assert.equal((await me("u_alice")).status, 200);
  DB.raw.exec("ALTER TABLE studio_memberships_x RENAME TO studio_memberships");
  assert.equal((await me("u_bob")).body.plays, 3 + 1, "bob: welcome + daily only");
}

// ---------------------------------------------------------------- 3. draws, the rare piece and claims
sql("UPDATE reward_config SET value='2' WHERE key='rare_odds'");
{
  // alice plays until her front_row set is complete (only front_row is in the draw; camera_ready has none left)
  let got = new Set(), rares = 0, n = 0;
  while (got.size < 3 && n < 60) {
    const r = await play("u_alice"); assert.equal(r.status, 200, JSON.stringify(r.body)); n++;
    assert.equal(r.body.draw.set_key, "front_row", "a set with none remaining is never drawn");
    got.add(r.body.draw.piece_key); rares += r.body.draw.rare;
  }
  assert.equal(got.size, 3, "alice completed the set"); assert.equal(rares, 1, "one rare piece per set per player");
  // the only unit is matched to alice's rare piece, so bob can't draw it
  sql("INSERT INTO reward_awards (id, player_id, source, source_ref, plays, created_at) SELECT 'a_test', id, 'code', 'test:bob', 40, '2026-11-06' FROM reward_players WHERE clerk_user_id='u_bob'");
  let bobPlays = 0, r;
  while ((r = await play("u_bob")).status === 200 && bobPlays < 100) { bobPlays++; assert.equal(r.body.draw.rare, 0, "no rare piece while the remaining unit is spoken for"); }
  assert.ok(bobPlays >= 40, "bob used all his plays"); assert.equal(r.status, 409); assert.match(r.body.error, /out of plays/);
  assert.equal((await me("u_bob")).body.plays, 0);
  const bobClaim = await api("/api/rewards/claim", { method: "POST", user: "u_bob", body: { set: "front_row" } });
  assert.equal(bobClaim.status, 409); assert.match(bobClaim.body.error, /Collect every piece/);
  const c1 = await api("/api/rewards/claim", { method: "POST", user: "u_alice", body: { set: "front_row" } });
  assert.equal(c1.status, 200, JSON.stringify(c1.body)); assert.equal(c1.body.claim.status, "requested"); assert.equal(c1.body.remaining, 0);
  const c2 = await api("/api/rewards/claim", { method: "POST", user: "u_alice", body: { set: "front_row" } });
  assert.equal(c2.status, 409); assert.match(c2.body.error, /already claimed/);
  assert.equal(one("SELECT remaining FROM reward_prizes WHERE set_key='front_row'").remaining, 0, "decremented once");
  assert.equal(one("SELECT count(*) n FROM reward_claims").n, 1);
  assert.equal(one("SELECT email FROM reward_claims").email, "alice@example.com", "claim carries the verified email");
  assert.equal((await api("/api/rewards/state")).body.status, "claimed_out");
  assert.equal((await play("u_alice")).status, 403, "nothing left to draw");
  const ma = await me("u_alice"); assert.equal(ma.body.claims[0].set_key, "front_row");
  // remaining 0 with plays left: still never a rare piece
  sql("UPDATE reward_prizes SET status='live', quantity=3, remaining=3 WHERE set_key='merch_drop'");
  sql("UPDATE reward_prizes SET remaining=0 WHERE set_key='front_row'");
  for (let i = 0; i < 20; i++) { const r = await play("u_alice"); assert.equal(r.status, 200); assert.equal(r.body.draw.set_key, "merch_drop"); }
}

// ---------------------------------------------------------------- 4. codes
sql("INSERT INTO reward_codes (code, label, plays, max_uses) VALUES ('SHOW-NOV', 'November show', 3, 2), ('OLD1', 'old', 2, 10)");
sql("UPDATE reward_codes SET expires_at='2026-11-01' WHERE code='OLD1'");
USERS.u_carol = { email: "carol@example.com" };
{
  const code = (user, c) => api("/api/rewards/code", { method: "POST", user, body: { code: c } });
  const before = (await me("u_bob")).body.plays;
  const r1 = await code("u_bob", "show-nov"); assert.equal(r1.status, 200); assert.equal(r1.body.plays_added, 3); assert.equal(r1.body.plays, before + 3);
  assert.equal((await code("u_bob", "SHOW-NOV")).status, 409, "once per player");
  assert.equal((await code("u_alice", "SHOW-NOV")).status, 200);
  const r3 = await code("u_carol", "SHOW-NOV"); assert.equal(r3.status, 409); assert.match(r3.body.error, /used up/);
  assert.equal(one("SELECT uses FROM reward_codes WHERE code='SHOW-NOV'").uses, 2);
  assert.equal((await code("u_carol", "OLD1")).status, 410, "expired");
  assert.equal((await code("u_carol", "NOPE")).status, 404);
}

// ---------------------------------------------------------------- 5. referrals
{
  const ref = (await me("u_alice")).body.player.ref_code;
  assert.match(ref, /^[A-Z0-9]{8}$/);
  const page = await go("/rewards?ref=" + ref.toLowerCase());
  assert.match(page.headers.get("Set-Cookie"), new RegExp(`^rb_ref=${ref}; Path=/; Max-Age=2592000; SameSite=Lax; Secure`));
  const refAwards = () => one("SELECT count(*) n, coalesce(sum(plays),0) p FROM reward_awards a JOIN reward_players p ON p.id=a.player_id WHERE p.clerk_user_id='u_alice' AND a.source='referral'");
  const cookie = { Cookie: `rb_ref=${ref}` };
  USERS.u_dave = { email: "dave@example.com" };
  await me("u_dave", cookie); await me("u_dave", cookie); await me("u_dave", cookie);
  assert.deepEqual({ ...refAwards() }, { n: 1, p: 2 }, "referrer credited once");
  USERS.u_alt = { email: "alice@example.com" }; // a second account with alice's email
  await me("u_alt", cookie);
  await me("u_alice", cookie); // alice herself with her own code
  assert.equal(refAwards().n, 1, "no self-referral");
  sql("UPDATE reward_config SET value='4' WHERE key='referral_cap_month'");
  USERS.u_fay = { email: "fay@example.com" }; USERS.u_gus = { email: "gus@example.com" };
  await me("u_fay", cookie); await me("u_gus", cookie);
  assert.deepEqual({ ...refAwards() }, { n: 2, p: 4 }, "monthly referral cap");
  assert.equal(one("SELECT referred_by IS NOT NULL r FROM reward_players WHERE clerk_user_id='u_carol'").r, 0, "no cookie, no referrer");
}

// ---------------------------------------------------------------- 6. official rules from the live config
sql("UPDATE reward_config SET value='50' WHERE key='rare_odds'");
sql("UPDATE reward_config SET value='2026-11-01' WHERE key='starts_at'");
sql("UPDATE reward_config SET value='2026-12-31' WHERE key='ends_at'");
sql("UPDATE reward_config SET value='Open to legal residents of California who are 18 or older.' WHERE key='eligibility'");
{
  const r = await go("/rewards/rules"); const h = await r.text();
  assert.equal(r.status, 200);
  assert.ok(h.includes("Drip ★</td><td>1 in 50</td><td>2%"), "rare odds: 1 set in the draw x 1 in 50");
  assert.ok(h.includes("Tag</td><td>49 in 100</td><td>49%"), "common odds");
  assert.ok(h.includes("<td>RB merch pack</td>") || h.includes("<b>RB merch pack</b>"));
  assert.ok(/<b>RB merch pack<\/b>[\s\S]*?<\/td><td>3<\/td><td>3<\/td>/.test(h), "quantity and remaining");
  assert.ok(/<b>2 tickets to the RB show<\/b>[\s\S]*?<\/td><td>1<\/td><td>0<\/td>/.test(h));
  assert.ok(h.includes("Open to legal residents of California who are 18 or older."));
  assert.ok(h.includes("November 1, 2026") && h.includes("December 31, 2026 at 11:59"), "dates in Pacific");
  assert.ok(h.includes("One prize per set per person") && h.includes("Void where prohibited") && h.includes("verify a player"));
  assert.ok(h.includes("5 plays, one time per membership level"));
  const st = (await api("/api/rewards/state")).body;
  assert.deepEqual(st.odds.pieces.find((o) => o.piece_key === "merch_drop:drip"), { set_key: "merch_drop", piece_key: "merch_drop:drip", label: "Drip", rare: 1, num: 1, den: 50, percent: 2 });
  // before the start date: plays refused, page says it opens soon
  sql("UPDATE reward_config SET value='2026-12-01' WHERE key='starts_at'");
  assert.equal((await api("/api/rewards/state")).body.status, "soon");
  assert.equal((await play("u_alice")).status, 403);
  NOW = Date.parse("2027-01-01T08:30:00Z"); // 00:30 Pacific on Jan 1: ended
  sql("UPDATE reward_config SET value='2026-11-01' WHERE key='starts_at'");
  assert.equal((await api("/api/rewards/state")).body.status, "ended");
  assert.equal((await play("u_alice")).status, 403);
  NOW = Date.parse("2027-01-01T07:30:00Z"); // 23:30 Pacific on Dec 31: still on
  assert.equal((await api("/api/rewards/state")).body.status, "live");
}

// ---------------------------------------------------------------- 7. rate limit and request checks
{
  USERS.u_hal = { email: "hal@example.com" };
  let last;
  for (let i = 0; i < 31; i++) last = await api("/api/rewards/code", { method: "POST", user: "u_hal", body: { code: "NOPE" } });
  assert.equal(last.status, 429, "31st write in a minute refused");
  NOW += 61e3;
  assert.equal((await api("/api/rewards/code", { method: "POST", user: "u_hal", body: { code: "NOPE" } })).status, 404, "allowed again next minute");
  const cross = await worker.fetch(new Request(SITE + "/api/rewards/play", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.example", Authorization: "Bearer " + (await token("u_hal")) }, body: "{}" }), env, ctx);
  assert.equal(cross.status, 403, "other origins refused");
  const form = await worker.fetch(new Request(SITE + "/api/rewards/play", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Bearer " + (await token("u_hal")) }, body: "a=1" }), env, ctx);
  assert.equal(form.status, 415, "JSON only");
  const other = await worker.fetch(new Request("https://beats.relentlessbillionaire.com/rewards", { headers: { "User-Agent": "Mozilla/5.0" } }), env, ctx);
  assert.ok(!(other.headers.get("Content-Security-Policy") || "").includes("clerk.accounts.dev") || other.status !== 200, "only the main hosts serve RB Collect");
}
assert.ok(clerkUserCalls > 0);
Date.now = realNow;
console.log("RB Collect ok: off by default (coming soon, plays refused, drafts hidden); awards from signups, membership requests, store orders, contributions and active memberships once each across re-syncs; daily play once per Pacific day; rare piece never drawn without an unreserved unit; claim needs the full set, decrements remaining once, one per set; codes once per player, max uses, expiry; referrals once, no self-referral, monthly cap; rules show live odds, quantities, remaining, dates, eligibility; nonce per request, every tag nonced, radio bar nonce; rate limit 30/min; origin and JSON checks");
