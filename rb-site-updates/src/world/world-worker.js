// RB World: the 3D city game (rb-site-updates/src/world/), served at relentlessbillionaire.com/app/world/ and run on
// RB's own backend instead of InstantDB. Embedded into artist-router-v14.js by patch_badge.py after the RB Badge code,
// whose helpers it uses (rbbLoad, rbbMember, rbcJson, rbcId, rbcLaDay, rbcLaInstant, rbcPublishableDomain).
//   GET  /app/world/            the game (RB_WORLD_HTML), /app/world/main.js and /app/world/rb_world.js
//   POST /api/world/beat        a player's state in; players seen in the last WORLD_PEER_SECONDS, the top 10, new chat
//                               and, for signed-in members, play-time RB Badge points out
//   POST /api/world/chat        a message (240 characters, rate limited)
//   GET  /api/world/ads         the ticker: live RB ads for the game and upcoming RB Events
//   POST /api/world/race        street races: host, solo, join, sync (position and checkpoints), leave, records
//   POST /api/world/me          who this player is: the RB account's one player (signed in, on any device), or this
//                               device's guest player; with their money, tokens and saved game
//   POST /api/world/ticket      a one-use ticket (60 seconds) to join the live room (rb-world-live) as this player
//   POST /api/world/node        Empire Nodes: real places near you (phone location or your car), claim and take over
//   POST /api/world/deal        offers to buy other players' lots and hostile takeover bids, accept, decline, list
//   POST /api/world/node        also upgrades (a level at a time), raids (fights for another player's node) and giving
//                               a node to another player
//   POST /api/world/empire      what your empire is worth (money, lots, nodes), its income an hour, city sets, events
//   POST /api/world/heist       a timed job: the vault, the crack, the getaway to the drop, for big money
//   POST /api/world/save        the saved game (empire, progress, customs, story, wardrobe, ...), so it follows the
//                               player: to any device for an RB account, back after signing out for a guest
// One player per RB account (world_accounts) and one per device for guests (world_guests: the device keeps a random
// key, the server only its hash). Once a player is tied to either, every write for it (beat, chat, lots, rent, races,
// save) needs that account's session or that device's key, so nobody else can play as them.
// Play time: a signed-in member's beats add up the seconds between them (at most WORLD_BEAT_CREDIT each, so several
// tabs or a stalled tab don't count extra); every world_block_minutes of play gives world_points_block points, up to
// world_points_daily a day. Net worth and the rest of the game stay in the player's browser, as before; the
// leaderboard shows what each player's game reports. RB World is open on its own (setting world_open, default on, so
// relentlessbillionaire.com/game/ keeps working); play-time points only start once RB Badge itself is switched on.
const WORLD_PEER_SECONDS = 20;
const WORLD_BEAT_CREDIT = 10;
const WORLD_VERSION = "w19";
const WORLD_OWNER_DAYS = 14; // a lot whose owner hasn't played for this long is for sale again
const WORLD_CAR_COLOR = /^#[0-9a-fA-F]{6}$/;

function worldClean(s, n) { return String(s ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").trim().slice(0, n); }
function worldNum(v, max = 1e15) { const x = Math.floor(Number(v)); return Number.isFinite(x) ? Math.max(-max, Math.min(max, x)) : 0; }
const WORLD_ID = /^[A-Za-z0-9-]{8,64}$/;

async function worldIpKey(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  return rbbHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("rb-world:" + ip))).slice(0, 24);
}
async function worldRateOk(env, key, perMinute) {
  const minute = new Date(Date.now()).toISOString().slice(0, 16);
  await env.DB.prepare("DELETE FROM world_rate WHERE k = ? AND minute < ?").bind(key, minute).run();
  const row = await env.DB.prepare("INSERT INTO world_rate (k, minute, n) VALUES (?, ?, 1) ON CONFLICT(k, minute) DO UPDATE SET n = n + 1 RETURNING n").bind(key, minute).first();
  return Number(row?.n || 0) <= perMinute;
}

// Play-time points for a signed-in member (only while RB Badge is on).
async function worldPlayPoints(env, g, m) {
  const a = g.amounts, now = Date.now(), day = rbcLaDay(now), at = new Date(now).toISOString();
  const row = await env.DB.prepare("SELECT * FROM world_play WHERE member_id = ? AND day = ?").bind(m.id, day).first();
  const gap = row?.last_beat ? (now - Date.parse(row.last_beat)) / 1000 : 0;
  const seconds = Math.floor((Number(row?.seconds) || 0) + (gap > 0 && gap <= 30 ? Math.min(gap, WORLD_BEAT_CREDIT) : 0));
  const blocks = a.worldBlockMinutes > 0 ? Math.floor(seconds / (a.worldBlockMinutes * 60)) : 0;
  const awarded = Number(row?.awarded) || 0;
  const stmts = [env.DB.prepare("INSERT INTO world_play (member_id, day, seconds, last_beat, awarded) VALUES (?, ?, ?, ?, ?) ON CONFLICT(member_id, day) DO UPDATE SET seconds = excluded.seconds, last_beat = excluded.last_beat")
    .bind(m.id, day, seconds, at, awarded)];
  let added = 0;
  const today = Number((await env.DB.prepare("SELECT coalesce(sum(points), 0) AS n FROM badge_points WHERE member_id = ? AND source = 'world' AND source_ref LIKE ?").bind(m.id, `world:${day}:%`).first())?.n) || 0;
  if (blocks > awarded && a.worldBlock > 0) {
    const give = Math.max(0, Math.min(a.worldBlock * (blocks - awarded), a.worldDaily - today));
    stmts.push(env.DB.prepare("UPDATE world_play SET awarded = ? WHERE member_id = ? AND day = ? AND awarded = ?").bind(blocks, m.id, day, awarded));
    if (give > 0) {
      stmts.push(env.DB.prepare("INSERT OR IGNORE INTO badge_points (id, member_id, source, source_ref, points, note, created_at) SELECT ?, ?, 'world', ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM world_play WHERE member_id = ? AND day = ? AND awarded = ?)")
        .bind(rbcId("b_"), m.id, `world:${day}:${m.id}:${blocks}`, give, `${Math.round(seconds / 60)} min played`, at, m.id, day, blocks));
      added = give;
    }
  }
  const res = await env.DB.batch(stmts);
  if (added && !res[res.length - 1].meta?.changes) added = 0;
  return { member: true, on: true, added, today: today + added, daily: a.worldDaily, minutes: Math.floor(seconds / 60) };
}

async function worldBeat(request, env, g, body) {
  const pid = String(body?.id || "");
  if (!WORLD_ID.test(pid)) return rbcJson({ ok: false, error: "Start the game again." }, 400);
  if (!(await worldRateOk(env, "b:" + pid, 40))) return rbcJson({ ok: false, error: "Too fast." }, 429);
  const pos = Array.isArray(body.pos) ? body.pos.slice(0, 2).map(Number) : [];
  const lng = Number.isFinite(pos[0]) ? Math.max(-180, Math.min(180, pos[0])) : null, lat = Number.isFinite(pos[1]) ? Math.max(-90, Math.min(90, pos[1])) : null;
  const name = worldClean(body.name, 24) || "Hustler";
  let points = { member: false, on: g.on };
  let clerkId = null;
  if (g.on && /^Bearer\s+\S+/i.test(request.headers.get("Authorization") || "")) {
    try { const m = await rbbMember(request, env); clerkId = m.clerk_user_id; points = await worldPlayPoints(env, g, m); } catch {}
  }
  const now = new Date(Date.now()).toISOString(), since = Math.max(0, worldNum(body.since)), ms = Date.now();
  const car = Array.isArray(body.car) ? body.car.slice(0, 4).map(Number) : [];
  const lvl = Math.max(0, Math.min(999, worldNum(body.level))); // 0: not sent, keep what's stored
  const carOk = car.length === 4 && car.every(Number.isFinite) && Math.abs(car[0]) < 2e5 && Math.abs(car[1]) < 2e5; // the whole Bay Area, in metres from downtown Vallejo
  const [, peers, board, chat] = await env.DB.batch([
    env.DB.prepare("INSERT INTO world_players (id, name, clerk_user_id, net_worth, tokens, kills, deaths, health, lng, lat, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, clerk_user_id = coalesce(excluded.clerk_user_id, world_players.clerk_user_id), net_worth = excluded.net_worth, tokens = excluded.tokens, kills = excluded.kills, deaths = excluded.deaths, health = excluded.health, lng = coalesce(excluded.lng, world_players.lng), lat = coalesce(excluded.lat, world_players.lat), seen_at = excluded.seen_at")
      .bind(pid, name, clerkId, worldNum(body.netWorth), worldNum(body.tokens), worldNum(body.kills, 1e9), worldNum(body.deaths, 1e9), Math.max(0, Math.min(1000, worldNum(body.health, 1e6))), lng, lat, now),
    env.DB.prepare("SELECT p.id, p.name, p.net_worth, p.health, p.lng, p.lat, c.x, c.z, c.h, c.s, c.level, c.color, c.at FROM world_players p LEFT JOIN world_cars c ON c.id = p.id WHERE p.seen_at >= ? AND p.id != ? AND p.id NOT IN (SELECT id FROM world_bans) ORDER BY p.seen_at DESC LIMIT 50").bind(new Date(Date.now() - WORLD_PEER_SECONDS * 1000).toISOString(), pid),
    env.DB.prepare("SELECT id, name, net_worth FROM world_players WHERE seen_at >= ? AND id NOT IN (SELECT id FROM world_bans) ORDER BY net_worth DESC LIMIT 10").bind(new Date(Date.now() - 30 * 864e5).toISOString()),
    since > 0
      ? env.DB.prepare("SELECT n, player_id, name, text, created_at FROM world_chat WHERE n > ? ORDER BY n LIMIT 30").bind(since)
      : env.DB.prepare("SELECT * FROM (SELECT n, player_id, name, text, created_at FROM world_chat WHERE created_at >= ? ORDER BY n DESC LIMIT 20) ORDER BY n").bind(new Date(Date.now() - 6 * 3600e3).toISOString()),
  ]);
  // The shared city: who owns which lot, and rent others paid this player since the last beat. Where this player's
  // car is in the city (others draw it), races open to join or under way, and the other live leaderboards.
  const [ownLots, rentDue, , races, lotBoard, levelBoard] = await env.DB.batch([
    worldLotsQuery(env),
    env.DB.prepare("SELECT coalesce(sum(rent_pending), 0) AS n FROM world_lots WHERE owner_id = ?").bind(pid),
    carOk
      ? env.DB.prepare("INSERT INTO world_cars (id, x, z, h, s, level, color, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET x = excluded.x, z = excluded.z, h = excluded.h, s = excluded.s, level = CASE WHEN ? > 0 THEN excluded.level ELSE world_cars.level END, color = excluded.color, at = excluded.at")
        .bind(pid, car[0], car[1], car[2], Math.max(-60, Math.min(60, car[3])), lvl || 1, WORLD_CAR_COLOR.test(String(body.color || "")) ? body.color : null, ms, lvl)
      : env.DB.prepare("UPDATE world_cars SET level = coalesce(?, level) WHERE id = ?").bind(lvl || null, pid),
    env.DB.prepare("SELECT r.id, r.track, r.host_name, r.start_at, r.ends_at, (SELECT count(*) FROM world_race_entries e WHERE e.race_id = r.id) AS n, (SELECT count(*) FROM world_race_entries e WHERE e.race_id = r.id AND e.player_id = ?) AS mine FROM world_races r WHERE r.solo = 0 AND r.ends_at > ? ORDER BY r.start_at LIMIT 6").bind(pid, ms),
    env.DB.prepare("SELECT l.owner_id AS id, max(l.owner_name) AS name, count(*) AS n, sum(l.level) AS stars FROM world_lots l JOIN world_players p ON p.id = l.owner_id WHERE p.seen_at >= ? GROUP BY l.owner_id ORDER BY n DESC, stars DESC LIMIT 10").bind(worldActiveSince()),
    env.DB.prepare("SELECT p.id, p.name, c.level FROM world_cars c JOIN world_players p ON p.id = c.id WHERE p.seen_at >= ? ORDER BY c.level DESC, p.net_worth DESC LIMIT 10").bind(new Date(Date.now() - 30 * 864e5).toISOString()),
  ]);
  const rent = Number(rentDue.results?.[0]?.n) || 0;
  const pay = await worldPayouts(env, pid); // node income and money owed from deals (deals.js, nodes.js)
  if (rent > 0) await env.DB.prepare("UPDATE world_lots SET rent_pending = 0 WHERE owner_id = ?").bind(pid).run();
  return rbcJson({
    ok: true,
    peers: (peers.results || []).map((p) => ({ id: p.id, name: p.name, netWorth: Number(p.net_worth), health: Number(p.health), pos: p.lng == null ? null : [Number(p.lng), Number(p.lat)],
      car: p.x == null || ms - Number(p.at) > WORLD_PEER_SECONDS * 1000 ? null : [Number(p.x), Number(p.z), Number(p.h), Number(p.s)], level: Number(p.level) || 1, color: p.color || null })),
    board: (board.results || []).map((u) => ({ id: u.id, name: u.name, netWorth: Number(u.net_worth) })),
    boards: {
      lots: (lotBoard.results || []).map((u) => ({ id: u.id, name: u.name, lots: Number(u.n), stars: Number(u.stars) || 0 })),
      level: (levelBoard.results || []).map((u) => ({ id: u.id, name: u.name, level: Number(u.level) || 1 })),
    },
    races: (races.results || []).map((r) => ({ id: r.id, track: r.track, host: r.host_name, start_at: Number(r.start_at), ends_at: Number(r.ends_at), n: Number(r.n), mine: Number(r.mine) > 0 })),
    now: ms,
    chat: (chat.results || []).map((c) => ({ n: Number(c.n), id: "c" + c.n, senderId: c.player_id, author: c.name, text: c.text, ts: Date.parse(c.created_at) })),
    points,
    lots: (ownLots.results || []).map(worldLotOut),
    rent,
    nodeIncome: pay.nodeIncome,
    settle: pay.settle,
  });
}

// ---------------------------------------------------------------- accounts and saved games
const WORLD_SAVE_MAX = 200000;
async function worldHash(key) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key)))].map((b) => b.toString(16).padStart(2, "0")).join(""); }
async function worldKeyHash(request) { const k = String(request.headers.get("X-RB-World-Key") || ""); return /^[a-f0-9]{64}$/.test(k) ? await worldHash(k) : null; }
// May this request act for this player? { ok, banned, clerk } (clerk: the account's user when it's an account's player)
async function worldWho(request, env, pid) {
  const t = await env.DB.prepare("SELECT (SELECT 1 FROM world_bans WHERE id = ?1) AS banned, (SELECT clerk_user_id FROM world_accounts WHERE player_id = ?1) AS owner, (SELECT key_hash FROM world_guests WHERE player_id = ?1) AS gkey").bind(pid).first();
  if (t?.owner) { const s = await verifyClerkSession(request, env); return { ok: s.ok && s.userId === t.owner, banned: !!t.banned, clerk: t.owner, account: true }; }
  if (t?.gkey) return { ok: (await worldKeyHash(request)) === t.gkey, banned: !!t.banned, clerk: null };
  return { ok: true, banned: !!t?.banned, clerk: null }; // a player from before accounts: open, as it always was
}
async function worldMe(request, env, body) {
  if (!(await worldRateOk(env, "me:" + (await worldIpKey(request)), 20))) return rbcJson({ ok: false, error: "Too fast." }, 429);
  const keyHash = await worldKeyHash(request);
  if (!keyHash) return rbcJson({ ok: false, error: "Start the game again." }, 400);
  const dev = String(body?.id || ""), now = new Date(Date.now()).toISOString();
  const taken = async (id) => WORLD_ID.test(id) ? await env.DB.prepare("SELECT (SELECT 1 FROM world_accounts WHERE player_id = ?1) AS a, (SELECT key_hash FROM world_guests WHERE player_id = ?1) AS g").bind(id).first() : { a: 1 };
  let clerkId = null;
  if (/^Bearer\s+\S+/i.test(request.headers.get("Authorization") || "")) {
    const s = await verifyClerkSession(request, env);
    if (s.ok) clerkId = s.userId;
    else if (s.status === 503) return rbcJson({ ok: false, error: "Sign-in is busy. Try again in a moment." }, 503);
  }
  let pid;
  if (clerkId) {
    // the account's player; the first time, its best player from before (when it was signed in), or this device's
    // guest player (so what you built as a guest comes with you), or a new one
    let acc = await env.DB.prepare("SELECT player_id FROM world_accounts WHERE clerk_user_id = ?").bind(clerkId).first();
    if (!acc) {
      const old = await env.DB.prepare("SELECT id FROM world_players WHERE clerk_user_id = ? AND id NOT IN (SELECT player_id FROM world_accounts) ORDER BY net_worth DESC LIMIT 1").bind(clerkId).first();
      let pick = old?.id || null;
      if (!pick) { const t = await taken(dev); if (!t?.a && (!t?.g || t.g === keyHash)) pick = dev; }
      await env.DB.prepare("INSERT OR IGNORE INTO world_accounts (clerk_user_id, player_id, created_at, updated_at) VALUES (?, ?, ?, ?)").bind(clerkId, pick || crypto.randomUUID(), now, now).run();
      acc = await env.DB.prepare("SELECT player_id FROM world_accounts WHERE clerk_user_id = ?").bind(clerkId).first();
    }
    pid = acc.player_id;
  } else {
    // a guest: this device's player, unless it's an account's or another device's; then a new one for this device
    const t = await taken(dev);
    pid = !t?.a && (!t?.g || t.g === keyHash) ? dev : crypto.randomUUID();
    await env.DB.prepare("INSERT OR IGNORE INTO world_guests (player_id, key_hash, created_at) VALUES (?, ?, ?)").bind(pid, keyHash, now).run();
    const g = await env.DB.prepare("SELECT key_hash FROM world_guests WHERE player_id = ?").bind(pid).first();
    if (g?.key_hash !== keyHash) { pid = crypto.randomUUID(); await env.DB.prepare("INSERT INTO world_guests (player_id, key_hash, created_at) VALUES (?, ?, ?)").bind(pid, keyHash, now).run(); }
  }
  const [row, save] = await env.DB.batch([
    env.DB.prepare("SELECT name, net_worth, tokens FROM world_players WHERE id = ?").bind(pid),
    env.DB.prepare("SELECT data, updated_at FROM world_saves WHERE player_id = ?").bind(pid),
  ]);
  const r = row.results?.[0], sv = save.results?.[0];
  return rbcJson({ ok: true, id: pid, signedIn: !!clerkId, name: r?.name || null, netWorth: r ? Number(r.net_worth) : null, tokens: r ? Number(r.tokens) : null,
    save: sv ? { data: sv.data, at: Number(sv.updated_at) } : null });
}
async function worldTicket(env, body) {
  const pid = String(body?.id || "");
  if (!WORLD_ID.test(pid)) return rbcJson({ ok: false, error: "Start the game again." }, 400);
  if (!(await worldRateOk(env, "t:" + pid, 12))) return rbcJson({ ok: false, error: "Too fast." }, 429);
  const ticket = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join(""), now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM world_tickets WHERE expires_at < ?").bind(now),
    env.DB.prepare("INSERT INTO world_tickets (ticket, player_id, expires_at) VALUES (?, ?, ?)").bind(ticket, pid, now + 60000),
  ]);
  return rbcJson({ ok: true, ticket });
}
async function worldSave(env, body) {
  const pid = String(body?.id || ""), data = typeof body?.data === "string" ? body.data : "";
  if (!WORLD_ID.test(pid) || !data) return rbcJson({ ok: false, error: "Nothing to save." }, 400);
  if (data.length > WORLD_SAVE_MAX) return rbcJson({ ok: false, error: "The save is too big." }, 413);
  try { const o = JSON.parse(data); if (!o || typeof o !== "object" || Array.isArray(o)) throw 0; } catch { return rbcJson({ ok: false, error: "That isn't a saved game." }, 400); }
  if (!(await worldRateOk(env, "s:" + pid, 8))) return rbcJson({ ok: false, error: "Too fast." }, 429);
  const at = Date.now();
  await env.DB.prepare("INSERT INTO world_saves (player_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(player_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at").bind(pid, data, at).run();
  return rbcJson({ ok: true, at });
}

// ---------------------------------------------------------------- payouts: money and tokens owed to a player
// The game keeps a player's money on their device, so what others pay them (a lot sold, a node taken over, income
// from nodes, a walking streak) waits here and goes out with their next beat, once.
function worldSettle(env, pid, cash, tokens, note) {
  return env.DB.prepare("INSERT INTO world_settle (player_id, cash, tokens, note, created_at) VALUES (?, ?, ?, ?, ?)").bind(pid, Math.round(cash) || 0, Math.round(tokens) || 0, String(note || "").slice(0, 120), Date.now());
}
// The nodes a player owns, with their level, city and income an hour (price, upgrade level and the city set bonus).
async function worldNodesOf(env, pid) {
  const rows = (await env.DB.prepare("SELECT n.id, n.owner_name, n.price, n.collected_at, n.shield_until, coalesce(i.level, 0) AS level, coalesce(i.spent, 0) AS spent, i.city FROM world_nodes n LEFT JOIN world_node_info i ON i.id = n.id WHERE n.owner_id = ?").bind(pid).all()).results || [];
  const per = {};
  for (const r of rows) if (r.city) per[r.city] = (per[r.city] || 0) + 1;
  return rows.map((r) => {
    const bonus = RBE.cityBonus(r.city ? per[r.city] : 1);
    return { ...r, price: Number(r.price), level: Number(r.level), spent: Number(r.spent), bonus, incomeH: RBE.nodeIncomeH(r.price, r.level, bonus), cityCount: r.city ? per[r.city] : 1 };
  });
}
// what a node has earned its owner since they last collected (at most a day's worth)
function worldEarned(n, now) { return (n.incomeH * Math.min(Math.max(0, now - Number(n.collected_at || now)), RBE.NODE_CAP_H * 3600e3)) / 3600e3; }
function worldEvent(env, pid, kind, text, other, node, amount) {
  return env.DB.prepare("INSERT INTO world_events (at, kind, player_id, other_id, node, amount, text) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(Date.now(), kind, pid, other || null, node || null, Math.round(amount) || 0, String(text || "").slice(0, 160));
}
// money and tokens owed to a player, delivered once on the beat: node income, sales, payments from other players
async function worldPayouts(env, pid) {
  const now = Date.now();
  const mine = await worldNodesOf(env, pid);
  let income = 0;
  for (const n of mine) if (now - Number(n.collected_at || now) >= 60000) income += worldEarned(n, now);
  const due = (await env.DB.prepare("SELECT id, cash, tokens, note FROM world_settle WHERE player_id = ? AND applied_at IS NULL ORDER BY id LIMIT 20").bind(pid).all()).results || [];
  const w = [];
  if (income >= 1) w.push(env.DB.prepare("UPDATE world_nodes SET collected_at = ? WHERE owner_id = ? AND collected_at <= ?").bind(now, pid, now - 60000));
  if (due.length) w.push(env.DB.prepare(`UPDATE world_settle SET applied_at = ? WHERE id IN (${due.map(() => "?").join(",")}) AND applied_at IS NULL`).bind(now, ...due.map((d) => d.id)));
  if (w.length) await env.DB.batch(w);
  return { nodeIncome: Math.floor(income), settle: due.map((d) => ({ cash: Number(d.cash), tokens: Number(d.tokens), note: d.note })) };
}

// Where a player is, checked against where they last were: moving faster than a person (phone location) or a car can
// go means a jump, so nothing that needs you to be somewhere counts until you stop. Walking pace counts as walking.
async function worldWhere(env, pid, lat, lng, src, now) {
  const fix = await env.DB.prepare("SELECT lat, lng, at, src FROM world_fix WHERE player_id = ?").bind(pid).first();
  let moving = false, walked = 0;
  if (fix && fix.src === src) {
    const dt = (now - Number(fix.at)) / 1000, dist = RBE.metresBetween(Number(fix.lat), Number(fix.lng), lat, lng);
    if (dist > 150 && dist / Math.max(dt, 0.5) > (src === "gps" ? 45 : 70)) moving = true;
    else if (src === "gps" && dt > 2 && dist < 400 && dist / dt < 3.5) walked = dist;
  }
  return { moving, walked, stmt: env.DB.prepare("INSERT INTO world_fix (player_id, lat, lng, at, src) VALUES (?, ?, ?, ?, ?) ON CONFLICT(player_id) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, at = excluded.at, src = excluded.src").bind(pid, lat, lng, now, src) };
}
function worldPlace(body) {
  const lat = Number(body?.lat), lng = Number(body?.lng), src = body?.src === "gps" ? "gps" : "car";
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 85 && Math.abs(lng) <= 180 ? { lat, lng, src } : null;
}
// The city a node is in: the Bay Area town the game reports (bay_data.js names), else an area of about 4 km round it.
// A node keeps the city it was first claimed in.
let worldTowns = null;
function worldCity(town, lat, lng) {
  if (!worldTowns) {
    worldTowns = new Set(["Vallejo"]);
    try { const m = /export const CITIES = (\{.*?\});/s.exec(RB_WORLD_FILES["bay_data.js"] || ""); if (m) for (const k of Object.keys(JSON.parse(m[1]))) worldTowns.add(k); } catch (e) {}
  }
  const t = String(town || "").trim();
  return worldTowns.has(t) ? t : `Area ${Math.floor(lng / 0.05)}:${Math.floor(lat / 0.04)}`;
}

// ---------------------------------------------------------------- Empire Nodes: real places, claimed in person
// POST /api/world/node { id, name, op, lat, lng, src: "gps" | "car", node, ... }. Where you are comes from your phone's
// location (src gps, with your consent in the browser) or your car in the game (src car, for players without
// location). The server keeps your last position only to check speed (worldWhere). Ops:
//   near    the nodes round you (r: 1 to 4 cells each way), with owner, level, city and income an hour
//   claim   a free node, or another player's after its shield (a quarter more than its price and upgrades; they get half)
//   upgrade one of yours, a level at a time (it earns more; the cost comes off your money)
//   raid    start a fight for another player's node (combat on): its crew, 3 + its level, guards it
//   raid-end / raid-status   the fight's result (a win takes the node and pays a tenth of its worth) or where it's at
//   give    one of yours to another player (a trade agreed in chat, or after a fight)
async function worldNode(env, g, body) {
  const pid = String(body?.id || ""), op = String(body?.op || "near"), here = worldPlace(body);
  if (!WORLD_ID.test(pid)) return rbcJson({ ok: false, error: "Start the game again." }, 400);
  if (!here) return rbcJson({ ok: false, error: "Where are you? (no location)" }, 400);
  if (!(await worldRateOk(env, "n:" + pid, 30))) return rbcJson({ ok: false, error: "Slow down a little." }, 429);
  const { lat, lng, src } = here, now = Date.now(), day = rbcLaDay(now), name = worldClean(body?.name, 24) || "Hustler";
  const where = await worldWhere(env, pid, lat, lng, src, now), moving = where.moving, walked = where.walked;
  const w = [where.stmt];
  let today = Number((await env.DB.prepare("SELECT metres FROM world_walk WHERE player_id = ? AND day = ?").bind(pid, day).first())?.metres) || 0;
  if (walked > 0) {
    w.push(env.DB.prepare("INSERT INTO world_walk (player_id, day, metres) VALUES (?, ?, ?) ON CONFLICT(player_id, day) DO UPDATE SET metres = metres + excluded.metres").bind(pid, day, walked));
    if (today < RBE.WALK_DAY_M && today + walked >= RBE.WALK_DAY_M) {
      const days = new Set(((await env.DB.prepare("SELECT day FROM world_walk WHERE player_id = ? AND metres >= ? ORDER BY day DESC LIMIT 30").bind(pid, RBE.WALK_DAY_M).all()).results || []).map((r) => r.day));
      let streak = 1; for (let k = 1; k < 30 && days.has(rbcLaDay(now - k * 864e5)); k++) streak++;
      w.push(worldSettle(env, pid, 0, 10 * Math.min(streak, 7), `🚶 Walked ${RBE.WALK_DAY_M / 1000} km today: day ${streak} of your streak`));
    }
    today += walked;
  }
  await env.DB.batch(w);
  const active = worldActiveSince();
  const myNodes = Object.fromEntries((await worldNodesOf(env, pid)).map((n) => [n.id, n]));
  const view = async (list) => {
    const rows = list.length ? ((await env.DB.prepare(`SELECT n.*, coalesce(i.level, 0) AS level, coalesce(i.spent, 0) AS spent, i.city, (SELECT p.seen_at FROM world_players p WHERE p.id = n.owner_id) AS seen FROM world_nodes n LEFT JOIN world_node_info i ON i.id = n.id WHERE n.id IN (${list.map(() => "?").join(",")})`).bind(...list.map((n) => n.id)).all()).results || []) : [];
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    return list.map((n) => {
      const r = by[n.id], owned = !!(r && r.owner_id && r.seen && r.seen >= active), d = RBE.metresBetween(lat, lng, n.lat, n.lng), mine = owned && r.owner_id === pid;
      const level = r ? Number(r.level) : 0, base = r ? Number(r.price) : RBE.NODE_BASE, spent = r ? Number(r.spent) : 0;
      // to take it: a quarter more than its price and its upgrades if someone holds it, else what it last cost
      const price = owned ? Math.round(base * RBE.NODE_STEP) + Math.round(spent * RBE.NODE_STEP) : base + spent;
      const me = mine ? myNodes[n.id] : null;
      return { id: n.id, name: n.name, lat: n.lat, lng: n.lng, d: Math.round(d), owner: owned ? r.owner_name : null, ownerId: owned ? r.owner_id : null, mine, price, level, city: r?.city || null,
        incomeH: Math.round(me ? me.incomeH : RBE.nodeIncomeH(base, level, 1)), bonus: me ? me.bonus : 1, upCost: mine && level < RBE.NODE_UP_MAX ? RBE.nodeUpCost(base, level) : null,
        shield: owned ? Math.max(0, Number(r.shield_until) - now) : 0, value: base + spent, _base: base, _spent: spent };
    });
  };
  const clean = (v) => { const { _base, _spent, ...rest } = v; return rest; };
  const walk = { today: Math.round(today), goal: RBE.WALK_DAY_M };
  if (op === "near") {
    const r = Math.max(1, Math.min(4, Math.round(Number(body?.r)) || 2));
    return rbcJson({ ok: true, nodes: (await view(RBE.nodesNear(lat, lng, r))).sort((a, b) => a.d - b.d).map(clean), walk, moving });
  }
  if (op === "raid-status" || op === "raid-end") return await worldRaidEnd(env, body, pid, name, here, moving, op);
  if (!["claim", "upgrade", "raid", "give"].includes(op)) return rbcJson({ ok: false, error: "Unknown action." }, 400);
  const n = RBE.nodeById(body?.node);
  if (!n) return rbcJson({ ok: false, error: "That node isn't on the map." }, 400);
  const [v] = await view([n]);
  const worthOf = async (id) => Number((await env.DB.prepare("SELECT net_worth FROM world_players WHERE id = ?").bind(id).first())?.net_worth) || 0;
  const openRaid = await env.DB.prepare("SELECT id, attacker_id FROM world_raids WHERE node = ? AND status = 'open' AND ends_at > ?").bind(n.id, now).first();

  if (op === "upgrade" || op === "give") {
    if (!v.mine) return rbcJson({ ok: false, error: "That node isn't yours." }, 403);
    const me = myNodes[n.id];
    if (op === "upgrade") {
      if (v.level >= RBE.NODE_UP_MAX) return rbcJson({ ok: false, error: `It's at the top level (${RBE.NODE_UP_MAX}).` }, 409);
      const cost = RBE.nodeUpCost(v._base, v.level);
      if ((await worthOf(pid)) < cost) return rbcJson({ ok: false, error: `The next level costs $${cost.toLocaleString("en-US")}.` }, 402);
      // what it earned at the old rate is paid first, so the new rate only counts from now
      const earned = worldEarned(me, now);
      const [, up] = await env.DB.batch([
        env.DB.prepare("UPDATE world_nodes SET collected_at = ? WHERE id = ? AND owner_id = ?").bind(now, n.id, pid),
        env.DB.prepare("INSERT INTO world_node_info (id, city, level, spent) VALUES (?, ?, 1, ?) ON CONFLICT(id) DO UPDATE SET level = world_node_info.level + 1, spent = world_node_info.spent + excluded.spent WHERE world_node_info.level = ?").bind(n.id, worldCity(body?.town, n.lat, n.lng), cost, v.level),
      ]);
      if (!up.meta.changes) return rbcJson({ ok: false, error: "It was just upgraded. Try again." }, 409);
      await env.DB.batch([
        ...(earned >= 1 ? [worldSettle(env, pid, earned, 0, `🏛️ ${n.name} earned`)] : []),
        worldEvent(env, pid, "upgrade", `Upgraded ${n.name} to level ${v.level + 1}`, null, n.id, -cost),
      ]);
      const [after] = await view([n]);
      return rbcJson({ ok: true, paid: cost, node: clean({ ...after, incomeH: Math.round(RBE.nodeIncomeH(after._base, after.level, me.bonus)), bonus: me.bonus }) });
    }
    const to = String(body?.to || "");
    if (!WORLD_ID.test(to) || to === pid) return rbcJson({ ok: false, error: "Pick another player." }, 400);
    const them = await env.DB.prepare("SELECT id, name FROM world_players WHERE id = ? AND seen_at >= ?").bind(to, active).first();
    if (!them) return rbcJson({ ok: false, error: "That player hasn't played lately." }, 404);
    if (openRaid) return rbcJson({ ok: false, error: "It's being fought over right now." }, 409);
    const theirs = Number((await env.DB.prepare("SELECT count(*) AS n FROM world_nodes WHERE owner_id = ?").bind(to).first())?.n) || 0;
    if (theirs >= RBE.NODE_MAX) return rbcJson({ ok: false, error: `${them.name} already holds ${RBE.NODE_MAX} nodes.` }, 409);
    const earned = worldEarned(me, now);
    const moved = await env.DB.prepare("UPDATE world_nodes SET owner_id = ?, owner_name = ?, claimed_at = ?, shield_until = ?, collected_at = ? WHERE id = ? AND owner_id = ?").bind(to, them.name, now, now + RBE.NODE_SHIELD_H * 3600e3, now, n.id, pid).run();
    if (!moved.meta.changes) return rbcJson({ ok: false, error: "It isn't yours any more." }, 409);
    await env.DB.batch([
      ...(earned >= 1 ? [worldSettle(env, pid, earned, 0, `🏛️ ${n.name} earned`)] : []),
      worldEvent(env, pid, "give", `Gave ${n.name} to ${them.name}`, to, n.id, 0),
      worldEvent(env, to, "given", `${name} gave you ${n.name}`, pid, n.id, 0),
    ]);
    return rbcJson({ ok: true, to: them.name });
  }

  // the rest need you to be there and standing still
  if (v.d > RBE.NODE_RADIUS) return rbcJson({ ok: false, error: `Get within ${RBE.NODE_RADIUS} m of it (you're ${v.d} m away).` }, 403);
  if (moving) return rbcJson({ ok: false, error: "You're moving too fast. Stop for a moment." }, 409);
  if (v.mine) return rbcJson({ ok: false, error: "It's already yours." }, 409);
  if (v.shield > 0) return rbcJson({ ok: false, error: `${v.owner} just took it: safe for another ${Math.ceil(v.shield / 3600e3)} h.` }, 409);
  if (openRaid && openRaid.attacker_id !== pid) return rbcJson({ ok: false, error: "Someone is fighting for it right now." }, 409);
  const count = Object.keys(myNodes).length;
  if (count >= RBE.NODE_MAX) return rbcJson({ ok: false, error: `You hold ${RBE.NODE_MAX} nodes, the most anyone can.` }, 409);

  if (op === "raid") {
    if (!g.worldCombat) return rbcJson({ ok: false, error: "Fights are switched off in RB World right now." }, 403);
    if (!v.owner) return rbcJson({ ok: false, error: "Nobody holds it: claim it instead." }, 409);
    if (openRaid) return rbcJson({ ok: false, error: "You're already fighting for it." }, 409);
    const mine = await env.DB.prepare("SELECT id FROM world_raids WHERE attacker_id = ? AND status = 'open' AND ends_at > ?").bind(pid, now).first();
    if (mine) return rbcJson({ ok: false, error: "Finish the fight you're in first." }, 409);
    const recent = await env.DB.prepare("SELECT id FROM world_raids WHERE attacker_id = ? AND node = ? AND started_at > ?").bind(pid, n.id, now - RBE.RAID_COOLDOWN_MIN * 60000).first();
    if (recent) return rbcJson({ ok: false, error: `You raided it lately. Try again within the hour (${RBE.RAID_COOLDOWN_MIN} min between raids on the same node).` }, 429);
    const weapon = /^[a-z]{2,12}$/.test(String(body?.weapon || "")) ? String(body.weapon) : "unarmed";
    const crew = RBE.raidCrew(v.level), id = rbcId("rd_");
    await env.DB.prepare("INSERT INTO world_raids (id, node, attacker_id, attacker_name, defender_id, defender_name, weapon, crew, status, started_at, ends_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)")
      .bind(id, n.id, pid, name, v.ownerId, v.owner, weapon, crew, now, now + RBE.RAID_LEN_S * 1000).run();
    return rbcJson({ ok: true, raid: { id, node: n.id, name: n.name, owner: v.owner, crew, weapon, ends: now + RBE.RAID_LEN_S * 1000, minS: RBE.RAID_MIN_S + 3 * crew, reward: Math.round(v.value * RBE.RAID_REWARD) } });
  }

  // claim: a free node, or a takeover
  if ((await worthOf(pid)) < v.price) return rbcJson({ ok: false, error: `It costs $${v.price.toLocaleString("en-US")}.` }, 402);
  const cur = await env.DB.prepare("SELECT owner_id, owner_name, price, collected_at FROM world_nodes WHERE id = ?").bind(n.id).first();
  const newBase = v.owner ? Math.round(v._base * RBE.NODE_STEP) : v._base, newSpent = v.owner ? Math.round(v._spent * RBE.NODE_STEP) : v._spent;
  const prev = v.owner && cur?.owner_id && cur.owner_id !== pid ? (await worldNodesOf(env, cur.owner_id)).find((x) => x.id === n.id) : null;
  await env.DB.prepare("INSERT INTO world_nodes (id, owner_id, owner_name, price, takes, claimed_at, shield_until, collected_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET owner_id = excluded.owner_id, owner_name = excluded.owner_name, price = excluded.price, takes = world_nodes.takes + 1, claimed_at = excluded.claimed_at, shield_until = excluded.shield_until, collected_at = excluded.collected_at WHERE coalesce(world_nodes.owner_id, '') = ?")
    .bind(n.id, pid, name, newBase, now, now + RBE.NODE_SHIELD_H * 3600e3, now, cur?.owner_id || "").run();
  const after = await env.DB.prepare("SELECT owner_id FROM world_nodes WHERE id = ?").bind(n.id).first();
  if (after?.owner_id !== pid) return rbcJson({ ok: false, error: "Someone else just claimed it." }, 409);
  const w2 = [
    env.DB.prepare("INSERT INTO world_node_info (id, city, level, spent) VALUES (?, ?, 0, ?) ON CONFLICT(id) DO UPDATE SET spent = excluded.spent, city = coalesce(world_node_info.city, excluded.city)").bind(n.id, worldCity(body?.town, n.lat, n.lng), newSpent),
    worldEvent(env, pid, "claim", `${v.owner ? "Took over" : "Claimed"} ${n.name}${v.owner ? ` from ${v.owner}` : ""}`, v.owner ? cur?.owner_id : null, n.id, -v.price),
  ];
  // the owner it was taken from: half the price, plus what it earned them since they last collected
  if (prev) {
    const back = v.price * 0.5 + worldEarned(prev, now);
    w2.push(worldSettle(env, cur.owner_id, back, 0, `🏛️ ${name} took over ${n.name}: you get half the price`));
    w2.push(worldEvent(env, cur.owner_id, "lost", `${name} took over ${n.name}`, pid, n.id, back));
  }
  await env.DB.batch(w2);
  return rbcJson({ ok: true, paid: v.price, node: clean((await view([n]))[0]) });
}

// A raid's result, or where it's at. A win counts if it took long enough for the crew it had, came in time and you're
// still at the node: the node is yours (safe for the shield hours), its owner keeps what it had earned them, and you
// get a tenth of what it's worth. The win itself is reported by your game (the fight runs in your browser).
async function worldRaidEnd(env, body, pid, name, here, moving, op) {
  const now = Date.now(), r = await env.DB.prepare("SELECT * FROM world_raids WHERE id = ? AND attacker_id = ?").bind(String(body?.raid || ""), pid).first();
  if (!r) return rbcJson({ ok: false, error: "No such fight." }, 404);
  const n = RBE.nodeById(r.node), out = (status, extra) => rbcJson({ ok: true, raid: { id: r.id, node: r.node, name: n?.name, owner: r.defender_name, crew: Number(r.crew), status, ends: Number(r.ends_at), ...extra } });
  if (r.status === "open" && now > Number(r.ends_at)) { await env.DB.prepare("UPDATE world_raids SET status = 'lapsed', done_at = ? WHERE id = ? AND status = 'open'").bind(now, r.id).run(); r.status = "lapsed"; }
  if (op === "raid-status" || r.status !== "open") return out(r.status);
  const close = (status) => env.DB.prepare("UPDATE world_raids SET status = ?, done_at = ? WHERE id = ? AND status = 'open'").bind(status, now, r.id);
  if (body?.won !== true) {
    await env.DB.batch([close("lost"), worldEvent(env, r.defender_id, "defended", `Your crew at ${n.name} fought off ${name}`, pid, r.node, 0), worldEvent(env, pid, "raid-lost", `Lost the fight for ${n.name}`, r.defender_id, r.node, 0)]);
    return out("lost");
  }
  const minMs = (RBE.RAID_MIN_S + 3 * Number(r.crew)) * 1000;
  if (now - Number(r.started_at) < minMs) return rbcJson({ ok: false, error: "That was too quick to count." }, 409);
  if (RBE.metresBetween(here.lat, here.lng, n.lat, n.lng) > RBE.NODE_RADIUS * 1.5 || moving) return rbcJson({ ok: false, error: "Stay at the node to take it." }, 409);
  const prev = (await worldNodesOf(env, r.defender_id)).find((x) => x.id === r.node);
  if (!prev) { await close("gone").run(); return out("gone"); }
  const reward = Math.round((prev.price + prev.spent) * RBE.RAID_REWARD), earned = worldEarned(prev, now);
  const [done] = await env.DB.batch([close("won")]);
  if (!done.meta.changes) return out("closed");
  const moved = await env.DB.prepare("UPDATE world_nodes SET owner_id = ?, owner_name = ?, takes = takes + 1, claimed_at = ?, shield_until = ?, collected_at = ? WHERE id = ? AND owner_id = ?").bind(pid, name, now, now + RBE.NODE_SHIELD_H * 3600e3, now, r.node, r.defender_id).run();
  if (!moved.meta.changes) { await env.DB.prepare("UPDATE world_raids SET status = 'gone' WHERE id = ?").bind(r.id).run(); return out("gone"); }
  await env.DB.batch([
    worldSettle(env, pid, reward, 0, `⚔️ Took ${n.name} from ${r.defender_name}`),
    ...(earned >= 1 ? [worldSettle(env, r.defender_id, earned, 0, `🏛️ ${n.name} earned before ${name} took it`)] : []),
    worldEvent(env, pid, "raid-won", `Took ${n.name} from ${r.defender_name} in a fight (${r.weapon})`, r.defender_id, r.node, reward),
    worldEvent(env, r.defender_id, "raided", `${name} took ${n.name} in a fight`, pid, r.node, 0),
  ]);
  return out("won", { reward });
}

// ---------------------------------------------------------------- your empire: what it's worth and what happened
// POST /api/world/empire { id }: money (from the last beat), lots and nodes at what they're worth, income an hour from
// the nodes, the city sets, open fights and heists, and the last things that happened to you.
async function worldEmpire(env, body) {
  const pid = String(body?.id || ""), now = Date.now();
  if (!WORLD_ID.test(pid)) return rbcJson({ ok: false, error: "Start the game again." }, 400);
  const p = await env.DB.prepare("SELECT net_worth, tokens FROM world_players WHERE id = ?").bind(pid).first();
  const nodes = await worldNodesOf(env, pid);
  const lots = (await env.DB.prepare("SELECT lot, business, level FROM world_lots WHERE owner_id = ?").bind(pid).all()).results || [];
  const events = ((await env.DB.prepare("SELECT at, kind, text, amount FROM world_events WHERE player_id = ? ORDER BY id DESC LIMIT 12").bind(pid).all()).results || []).map((e) => ({ at: Number(e.at), kind: e.kind, text: e.text, amount: Number(e.amount) }));
  const lotsValue = lots.reduce((s, l) => s + RBE.lotValue(l.lot, l.business, l.level), 0), nodesValue = nodes.reduce((s, n) => s + n.price + n.spent, 0), cash = Math.max(0, Number(p?.net_worth) || 0);
  const cities = {};
  for (const n of nodes) if (n.city) cities[n.city] = { count: n.cityCount, bonus: n.bonus };
  return rbcJson({ ok: true, cash, tokens: Number(p?.tokens) || 0, value: cash + lotsValue + nodesValue, incomeH: Math.round(nodes.reduce((s, n) => s + n.incomeH, 0)),
    lots: { count: lots.length, value: lotsValue }, nodes: nodes.map((n) => { const d = RBE.nodeById(n.id); return { id: n.id, name: d?.name, lat: d?.lat, lng: d?.lng, city: n.city, level: n.level, incomeH: Math.round(n.incomeH), bonus: n.bonus, value: n.price + n.spent, upCost: n.level < RBE.NODE_UP_MAX ? RBE.nodeUpCost(n.price, n.level) : null, shield: Math.max(0, Number(n.shield_until) - now) }; }),
    nodesValue, cities, events });
}

// ---------------------------------------------------------------- heists: a timed job for big money
// POST /api/world/heist { id, op, lat, lng, src }: op "start" (a vault 250 m to 1 km from you and a drop further on),
// "arrive" (at the vault: the crack starts), "loot" (still at the vault HEIST_CRACK_S later), "finish" (at the drop in
// time: the pay comes in with the next beat), "status", "cancel". One at a time, HEIST_COOLDOWN_MIN apart, at most
// HEIST_DAY_MAX a day. Each step is checked where you are and how fast you got there (worldWhere).
async function worldHeist(env, body) {
  const pid = String(body?.id || ""), op = String(body?.op || "status"), here = worldPlace(body), now = Date.now(), name = worldClean(body?.name, 24) || "Hustler";
  if (!WORLD_ID.test(pid)) return rbcJson({ ok: false, error: "Start the game again." }, 400);
  if (!(await worldRateOk(env, "h:" + pid, 30))) return rbcJson({ ok: false, error: "Slow down a little." }, 429);
  let h = await env.DB.prepare("SELECT * FROM world_heists WHERE player_id = ? ORDER BY started_at DESC LIMIT 1").bind(pid).first();
  if (h && h.status === "open" && now > Number(h.ends_at)) { await env.DB.prepare("UPDATE world_heists SET status = 'failed', done_at = ? WHERE id = ? AND status = 'open'").bind(now, h.id).run(); h.status = "failed"; }
  const show = (x) => {
    if (!x) return null;
    const v = RBE.nodeById(x.vault), d = RBE.nodeById(x.drop_node);
    return { id: x.id, stage: x.stage, status: x.status, pay: Number(x.pay), ends: Number(x.ends_at), vault: { lat: v.lat, lng: v.lng, name: v.name }, drop: { lat: d.lat, lng: d.lng, name: d.name },
      crackLeft: x.stage === "crack" ? Math.max(0, Math.ceil((Number(x.arrived_at) + RBE.HEIST_CRACK_S * 1000 - now) / 1000)) : null };
  };
  if (op === "status") return rbcJson({ ok: true, heist: show(h), cooldown: h ? Math.max(0, Number(h.started_at) + RBE.HEIST_COOLDOWN_MIN * 60000 - now) : 0 });
  const open = h && h.status === "open" ? h : null;
  if (op === "cancel") {
    if (open) await env.DB.prepare("UPDATE world_heists SET status = 'cancelled', done_at = ? WHERE id = ? AND status = 'open'").bind(now, open.id).run();
    return rbcJson({ ok: true });
  }
  if (!here) return rbcJson({ ok: false, error: "Where are you? (no location)" }, 400);
  const where = await worldWhere(env, pid, here.lat, here.lng, here.src, now);
  await where.stmt.run();
  if (op === "start") {
    if (open) return rbcJson({ ok: false, error: "You're on a job already." }, 409);
    if (h && now - Number(h.started_at) < RBE.HEIST_COOLDOWN_MIN * 60000) return rbcJson({ ok: false, error: `Lie low: the next job is in ${Math.ceil((Number(h.started_at) + RBE.HEIST_COOLDOWN_MIN * 60000 - now) / 60000)} min.` }, 429);
    const done = Number((await env.DB.prepare("SELECT count(*) AS n FROM world_heists WHERE player_id = ? AND started_at > ?").bind(pid, now - 864e5).first())?.n) || 0;
    if (done >= RBE.HEIST_DAY_MAX) return rbcJson({ ok: false, error: `That's ${RBE.HEIST_DAY_MAX} jobs today. Come back tomorrow.` }, 429);
    const pick = (list) => list[Math.floor((crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296) * list.length)];
    const vaults = RBE.nodesNear(here.lat, here.lng, 4).filter((n) => { const d = RBE.metresBetween(here.lat, here.lng, n.lat, n.lng); return d >= 250 && d <= 1000; });
    const vault = vaults.length ? pick(vaults) : null;
    const drops = vault ? RBE.nodesNear(vault.lat, vault.lng, 5).filter((n) => { const d = RBE.metresBetween(vault.lat, vault.lng, n.lat, n.lng); return d >= 500 && d <= 1400 && RBE.metresBetween(here.lat, here.lng, n.lat, n.lng) >= 300; }) : [];
    if (!vault || !drops.length) return rbcJson({ ok: false, error: "No job round here. Try somewhere else." }, 409);
    const step = 500, pay = RBE.HEIST_PAY[0] + step * Math.floor((crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296) * ((RBE.HEIST_PAY[1] - RBE.HEIST_PAY[0]) / step + 1));
    const x = { id: rbcId("hs_"), player_id: pid, vault: vault.id, drop_node: pick(drops).id, stage: "vault", status: "open", pay, started_at: now, ends_at: now + RBE.HEIST_LEN_S * 1000, arrived_at: null };
    await env.DB.prepare("INSERT INTO world_heists (id, player_id, vault, drop_node, stage, status, pay, started_at, ends_at) VALUES (?, ?, ?, ?, 'vault', 'open', ?, ?, ?)").bind(x.id, pid, x.vault, x.drop_node, pay, now, x.ends_at).run();
    return rbcJson({ ok: true, heist: show(x) });
  }
  if (!open) return rbcJson({ ok: false, error: "You're not on a job." }, 409);
  if (where.moving) return rbcJson({ ok: false, error: "You're moving too fast. Stop for a moment." }, 409);
  const at = (nodeId) => { const n = RBE.nodeById(nodeId); return RBE.metresBetween(here.lat, here.lng, n.lat, n.lng) <= RBE.HEIST_NEAR; };
  const set = (sql, ...v) => env.DB.prepare(`UPDATE world_heists SET ${sql} WHERE id = ? AND status = 'open'`).bind(...v, open.id).run();
  if (op === "arrive") {
    if (open.stage !== "vault") return rbcJson({ ok: true, heist: show(open) });
    if (!at(open.vault)) return rbcJson({ ok: false, error: "Get to the vault first." }, 409);
    await set("stage = 'crack', arrived_at = ?", now);
    return rbcJson({ ok: true, heist: show({ ...open, stage: "crack", arrived_at: now }) });
  }
  if (op === "loot") {
    if (open.stage !== "crack") return rbcJson({ ok: true, heist: show(open) });
    if (!at(open.vault)) return rbcJson({ ok: false, error: "Stay at the vault while it's cracked." }, 409);
    if (now - Number(open.arrived_at) < RBE.HEIST_CRACK_S * 1000) return rbcJson({ ok: false, error: "Not open yet." }, 409);
    await set("stage = 'getaway', looted_at = ?", now);
    return rbcJson({ ok: true, heist: show({ ...open, stage: "getaway" }) });
  }
  if (op === "finish") {
    if (open.stage !== "getaway") return rbcJson({ ok: false, error: "Crack the vault first." }, 409);
    if (!at(open.drop_node)) return rbcJson({ ok: false, error: "Get the money to the drop." }, 409);
    const r = await env.DB.prepare("UPDATE world_heists SET status = 'done', stage = 'done', done_at = ? WHERE id = ? AND status = 'open'").bind(now, open.id).run();
    if (!r.meta.changes) return rbcJson({ ok: false, error: "That job is over." }, 409);
    await env.DB.batch([worldSettle(env, pid, open.pay, 25, "💰 Heist done"), worldEvent(env, pid, "heist", `Pulled off a heist at ${RBE.nodeById(open.vault).name}`, null, open.vault, open.pay)]);
    return rbcJson({ ok: true, heist: show({ ...open, stage: "done", status: "done" }), paid: open.pay });
  }
  return rbcJson({ ok: false, error: "Unknown action." }, 400);
}

// ---------------------------------------------------------------- deals: buy offers and hostile takeovers on lots
// POST /api/world/deal { id, name, op, lot, amount, deal }: op "offer" | "takeover" (to the lot's owner), "accept" |
// "decline" (by the owner), "cancel" (by the bidder), "list". Money moves through payouts: the buyer pays, the seller
// gets it (and the lot's waiting rent). A buyer has to have the money by their last beat when the deal is made and
// when it's accepted; a takeover nobody answers goes through after a day only if the lot is empty.
async function worldDeal(env, body) {
  const pid = String(body?.id || ""), op = String(body?.op || "list"), now = Date.now(), name = worldClean(body?.name, 24) || "Hustler";
  if (!WORLD_ID.test(pid)) return rbcJson({ ok: false, error: "Start the game again." }, 400);
  if (!(await worldRateOk(env, "d:" + pid, 20))) return rbcJson({ ok: false, error: "Slow down a little." }, 429);
  const active = worldActiveSince();
  const worthOf = async (id) => Number((await env.DB.prepare("SELECT net_worth FROM world_players WHERE id = ?").bind(id).first())?.net_worth) || 0;
  const lotsOf = async (id) => Number((await env.DB.prepare("SELECT count(*) AS n FROM world_lots l JOIN world_players p ON p.id = l.owner_id WHERE l.owner_id = ? AND p.seen_at >= ?").bind(id, active).first())?.n) || 0;
  // the lot goes to the buyer if the seller still has it; then the money, and the other bids on it close
  const transfer = async (d, status) => {
    const cur = await env.DB.prepare("SELECT rent_pending FROM world_lots WHERE lot = ? AND owner_id = ?").bind(d.lot, d.to_id).first();
    if (!cur) { await env.DB.prepare("UPDATE world_deals SET status = 'gone', done_at = ? WHERE id = ?").bind(now, d.id).run(); return "The lot changed hands already."; }
    if ((await lotsOf(d.from_id)) >= RBE.MAX_LOTS_PER_PLAYER) return `${d.from_name} already owns ${RBE.MAX_LOTS_PER_PLAYER} lots.`;
    if ((await worthOf(d.from_id)) < d.amount) return `${d.from_name} doesn't have the money any more.`;
    const r = await env.DB.prepare("UPDATE world_lots SET owner_id = ?, owner_name = ?, rent_pending = 0, updated_at = ? WHERE lot = ? AND owner_id = ?").bind(d.from_id, d.from_name, new Date(now).toISOString(), d.lot, d.to_id).run();
    if (!r.meta || r.meta.changes !== 1) return "The lot changed hands already.";
    await env.DB.batch([
      env.DB.prepare("UPDATE world_deals SET status = ?, done_at = ? WHERE id = ?").bind(status, now, d.id),
      env.DB.prepare("UPDATE world_deals SET status = 'closed', done_at = ? WHERE lot = ? AND status = 'open' AND id != ?").bind(now, d.lot, d.id),
      worldSettle(env, d.from_id, -d.amount, 0, `🤝 Lot ${d.lot} is yours: paid ${d.to_name || "the owner"}`),
      worldSettle(env, d.to_id, d.amount + (Number(cur.rent_pending) || 0), 0, `🤝 Sold lot ${d.lot} to ${d.from_name}`),
    ]);
    return null;
  };
  // takeovers nobody answered: through if the lot is still empty, otherwise they lapse; offers just lapse
  const old = (await env.DB.prepare("SELECT * FROM world_deals WHERE status = 'open' AND expires_at < ? AND (from_id = ? OR to_id = ?) LIMIT 10").bind(now, pid, pid).all()).results || [];
  for (const d of old) {
    const lot = await env.DB.prepare("SELECT business FROM world_lots WHERE lot = ? AND owner_id = ?").bind(d.lot, d.to_id).first();
    const why = d.kind === "takeover" && lot && !lot.business ? await transfer(d, "won") : "lapsed";
    if (why) await env.DB.prepare("UPDATE world_deals SET status = 'lapsed', done_at = ? WHERE id = ? AND status = 'open'").bind(now, d.id).run();
  }
  if (op === "list") {
    const rows = (await env.DB.prepare("SELECT * FROM world_deals WHERE (to_id = ? OR from_id = ?) AND (status = 'open' OR done_at > ?) ORDER BY created_at DESC LIMIT 30").bind(pid, pid, now - 3 * 864e5).all()).results || [];
    return rbcJson({ ok: true, deals: rows.map((d) => ({ id: d.id, kind: d.kind, lot: Number(d.lot), from: d.from_name, to: d.to_name, mine: d.from_id === pid, amount: Number(d.amount), status: d.status, expires: Number(d.expires_at) })) });
  }
  if (op === "offer" || op === "takeover") {
    const l = RBE.lotById(body?.lot), amount = Math.round(Number(body?.amount));
    if (!l) return rbcJson({ ok: false, error: "That lot isn't in the city." }, 400);
    if (!Number.isFinite(amount) || amount < 1000 || amount > 1e12) return rbcJson({ ok: false, error: "Offer at least $1,000." }, 400);
    const cur = await env.DB.prepare("SELECT l.*, (SELECT p.seen_at FROM world_players p WHERE p.id = l.owner_id) AS seen FROM world_lots l WHERE l.lot = ?").bind(l.id).first();
    if (!cur || !cur.owner_id || !(cur.seen >= active)) return rbcJson({ ok: false, error: "Nobody owns it: you can just buy it." }, 409);
    if (cur.owner_id === pid) return rbcJson({ ok: false, error: "It's already yours." }, 409);
    const min = op === "takeover" ? Math.ceil(RBE.lotValue(l.id, cur.business, cur.level) * RBE.TAKEOVER_MIN) : 1000;
    if (amount < min) return rbcJson({ ok: false, error: `A takeover bid starts at $${min.toLocaleString("en-US")} (1.5x what it's worth).` }, 400);
    if ((await worthOf(pid)) < amount) return rbcJson({ ok: false, error: "You don't have that much." }, 402);
    if ((await lotsOf(pid)) >= RBE.MAX_LOTS_PER_PLAYER) return rbcJson({ ok: false, error: `You already own ${RBE.MAX_LOTS_PER_PLAYER} lots.` }, 409);
    const open = (await env.DB.prepare("SELECT id, lot FROM world_deals WHERE from_id = ? AND status = 'open'").bind(pid).all()).results || [];
    if (open.some((d) => Number(d.lot) === l.id)) return rbcJson({ ok: false, error: "You already have a bid on that lot." }, 409);
    if (open.length >= RBE.DEALS_OPEN_MAX) return rbcJson({ ok: false, error: `You have ${RBE.DEALS_OPEN_MAX} bids open already.` }, 409);
    const id = rbcId("dl_", 12), h = op === "takeover" ? RBE.DEAL_TAKEOVER_H : RBE.DEAL_OFFER_H;
    await env.DB.prepare("INSERT INTO world_deals (id, kind, lot, from_id, from_name, to_id, to_name, amount, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)").bind(id, op, l.id, pid, name, cur.owner_id, cur.owner_name, amount, now, now + h * 3600e3).run();
    return rbcJson({ ok: true, deal: { id, kind: op, lot: l.id, to: cur.owner_name, amount, expires: now + h * 3600e3, auto: op === "takeover" && !cur.business } });
  }
  const d = await env.DB.prepare("SELECT * FROM world_deals WHERE id = ? AND status = 'open'").bind(String(body?.deal || "")).first();
  if (!d) return rbcJson({ ok: false, error: "That deal isn't open any more." }, 404);
  if (op === "cancel") { if (d.from_id !== pid) return rbcJson({ ok: false, error: "That isn't your bid." }, 403); await env.DB.prepare("UPDATE world_deals SET status = 'cancelled', done_at = ? WHERE id = ?").bind(now, d.id).run(); return rbcJson({ ok: true }); }
  if (d.to_id !== pid) return rbcJson({ ok: false, error: "That isn't your lot." }, 403);
  if (op === "decline") { await env.DB.prepare("UPDATE world_deals SET status = 'declined', done_at = ? WHERE id = ?").bind(now, d.id).run(); return rbcJson({ ok: true }); }
  if (op === "accept") { const why = await transfer({ ...d, amount: Number(d.amount) }, "accepted"); return why ? rbcJson({ ok: false, error: why }, 409) : rbcJson({ ok: true }); }
  return rbcJson({ ok: false, error: "Unknown action." }, 400);
}

// ---------------------------------------------------------------- the empire: lots and rent (empire_defs.js, as RBE)
function worldActiveSince() { return new Date(Date.now() - WORLD_OWNER_DAYS * 864e5).toISOString(); }
function worldLotsQuery(env) {
  return env.DB.prepare("SELECT l.lot, l.owner_id, l.owner_name, l.business, l.level, l.title FROM world_lots l JOIN world_players p ON p.id = l.owner_id WHERE p.seen_at >= ?").bind(worldActiveSince());
}
function worldLotOut(r) { return { lot: Number(r.lot), owner_id: r.owner_id, owner_name: r.owner_name, business: r.business || null, level: Number(r.level) || 0, name: r.title || null }; }

async function worldLot(env, body) {
  const pid = String(body?.id || ""), action = String(body?.action || ""), l = RBE.lotById(body?.lot);
  if (!WORLD_ID.test(pid)) return rbcJson({ ok: false, error: "Start the game again." }, 400);
  if (!l) return rbcJson({ ok: false, error: "That lot isn't in the city." }, 400);
  if (!(await worldRateOk(env, "l:" + pid, 20))) return rbcJson({ ok: false, error: "Slow down a little." }, 429);
  const name = worldClean(body?.name, 24) || "Hustler", now = new Date(Date.now()).toISOString(), active = worldActiveSince();
  const cur = await env.DB.prepare("SELECT l.*, (SELECT p.seen_at FROM world_players p WHERE p.id = l.owner_id) AS seen FROM world_lots l WHERE l.lot = ?").bind(l.id).first();
  const ownerActive = cur && cur.owner_id && cur.seen && cur.seen >= active;
  const read = async () => { const r = await env.DB.prepare("SELECT lot, owner_id, owner_name, business, level, title FROM world_lots WHERE lot = ?").bind(l.id).first(); return r && r.owner_id ? worldLotOut(r) : null; };
  if (action === "buy") {
    if (ownerActive) return rbcJson({ ok: false, error: cur.owner_id === pid ? "You already own it." : `${cur.owner_name} owns this lot.` }, 409);
    const mineN = Number((await env.DB.prepare("SELECT count(*) AS n FROM world_lots l JOIN world_players p ON p.id = l.owner_id WHERE l.owner_id = ? AND p.seen_at >= ?").bind(pid, active).first())?.n) || 0;
    if (mineN >= RBE.MAX_LOTS_PER_PLAYER) return rbcJson({ ok: false, error: `You already own ${RBE.MAX_LOTS_PER_PLAYER} lots, the most anyone can.` }, 409);
    // Taken only if it's still free (or its owner has been away WORLD_OWNER_DAYS), so two buyers can't both get it.
    await env.DB.prepare("INSERT INTO world_lots (lot, owner_id, owner_name, business, level, title, rent_pending, bought_at, updated_at) VALUES (?, ?, ?, NULL, 0, NULL, 0, ?, ?) ON CONFLICT(lot) DO UPDATE SET owner_id = excluded.owner_id, owner_name = excluded.owner_name, business = NULL, level = 0, title = NULL, rent_pending = 0, bought_at = excluded.bought_at, updated_at = excluded.updated_at WHERE world_lots.owner_id IS NULL OR coalesce((SELECT p.seen_at FROM world_players p WHERE p.id = world_lots.owner_id), '') < ?")
      .bind(l.id, pid, name, now, now, active).run();
    const after = await read();
    if (!after || after.owner_id !== pid) return rbcJson({ ok: false, error: "Someone else just bought it." }, 409);
    return rbcJson({ ok: true, lot: after });
  }
  if (!ownerActive || cur.owner_id !== pid) return rbcJson({ ok: false, error: "That isn't your lot." }, 403);
  if (action === "build") {
    const b = RBE.businessByKey(body?.business);
    if (!b) return rbcJson({ ok: false, error: "Pick a business." }, 400);
    if (cur.business) return rbcJson({ ok: false, error: "There's already a business here." }, 409);
    if (b.tier > RBE.DISTRICTS[l.district].tier) return rbcJson({ ok: false, error: "That business needs a pricier district." }, 400);
    await env.DB.prepare("UPDATE world_lots SET business = ?, level = 1, owner_name = ?, updated_at = ? WHERE lot = ? AND owner_id = ? AND business IS NULL").bind(b.key, name, now, l.id, pid).run();
  } else if (action === "upgrade") {
    const want = worldNum(body?.level);
    if (!cur.business || want !== Number(cur.level) + 1 || want > RBE.MAX_LEVEL) return rbcJson({ ok: false, error: "It can't go up from here." }, 409);
    await env.DB.prepare("UPDATE world_lots SET level = ?, updated_at = ? WHERE lot = ? AND owner_id = ? AND level = ?").bind(want, now, l.id, pid, Number(cur.level)).run();
  } else if (action === "rename") {
    const title = worldClean(body?.title, 28);
    if (!title || !cur.business) return rbcJson({ ok: false, error: "Type a name." }, 400);
    await env.DB.prepare("UPDATE world_lots SET title = ?, updated_at = ? WHERE lot = ? AND owner_id = ?").bind(title, now, l.id, pid).run();
  } else if (action === "sell") {
    const rent = Number(cur.rent_pending) || 0;
    await env.DB.prepare("DELETE FROM world_lots WHERE lot = ? AND owner_id = ?").bind(l.id, pid).run();
    return rbcJson({ ok: true, lot: null, rent });
  } else return rbcJson({ ok: false, error: "Unknown action." }, 400);
  return rbcJson({ ok: true, lot: await read() });
}

// Rent for stopping on someone else's lot: the amount comes from empire_defs.js, at most once a minute per lot.
async function worldRent(env, body) {
  const pid = String(body?.id || ""), l = RBE.lotById(body?.lot);
  if (!WORLD_ID.test(pid) || !l) return rbcJson({ ok: false, error: "Start the game again." }, 400);
  const cur = await env.DB.prepare("SELECT l.*, (SELECT p.seen_at FROM world_players p WHERE p.id = l.owner_id) AS seen FROM world_lots l WHERE l.lot = ?").bind(l.id).first();
  if (!cur || !cur.owner_id || cur.owner_id === pid || !(cur.seen >= worldActiveSince())) return rbcJson({ ok: true, paid: 0 });
  if (!(await worldRateOk(env, `r:${pid}:${l.id}`, 1))) return rbcJson({ ok: true, paid: 0 });
  const paid = RBE.rentFor(l.id, cur.level, cur.business);
  await env.DB.prepare("UPDATE world_lots SET rent_pending = min(rent_pending + ?, 1000000000000) WHERE lot = ? AND owner_id = ?").bind(paid, l.id, cur.owner_id).run();
  return rbcJson({ ok: true, paid, owner: cur.owner_name });
}

// ---------------------------------------------------------------- street races (tracks and limits: empire_defs.js, as RBE)
// The server keeps the clock: a race starts at start_at, each checkpoint is timed when its sync arrives, and a
// checkpoint only counts in order, within RACE_CP_RADIUS of it, and no sooner than RACE_MAX_SPEED allows from the last
// one. So times on the record board are the server's, not what a game says. Prizes are game money, paid by the game.
function worldRaceOut(race, entries, pid, ms) {
  return {
    ok: true, now: ms,
    race: { id: race.id, track: race.track, host: race.host_name, host_id: race.host_id, solo: !!Number(race.solo), start_at: Number(race.start_at), ends_at: Number(race.ends_at) },
    entries: entries.map((e) => ({ id: e.player_id, name: e.name, slot: Number(e.slot), cp: Number(e.cp), finish_ms: e.finish_ms == null ? null : Number(e.finish_ms), place: e.place == null ? null : Number(e.place),
      car: e.x == null ? null : [Number(e.x), Number(e.z), Number(e.h), Number(e.s)], you: e.player_id === pid })),
  };
}
async function worldRaceRead(env, raceId, pid, ms) {
  const [r, e] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM world_races WHERE id = ?").bind(raceId),
    env.DB.prepare("SELECT * FROM world_race_entries WHERE race_id = ? ORDER BY slot").bind(raceId),
  ]);
  const race = r.results?.[0];
  return race ? worldRaceOut(race, e.results || [], pid, ms) : null;
}
async function worldRace(env, body) {
  const pid = String(body?.id || ""), action = String(body?.action || ""), ms = Date.now();
  if (!WORLD_ID.test(pid)) return rbcJson({ ok: false, error: "Start the game again." }, 400);
  const name = worldClean(body?.name, 24) || "Hustler";
  if (action === "records") {
    const t = RBE.raceTrack(body?.track);
    if (!t) return rbcJson({ ok: false, error: "Pick a track." }, 400);
    const [top, mine] = await env.DB.batch([
      env.DB.prepare("SELECT player_id, name, ms, at FROM world_race_best WHERE track = ? ORDER BY ms, at LIMIT 10").bind(t.key),
      env.DB.prepare("SELECT ms, (SELECT count(*) FROM world_race_best b WHERE b.track = ? AND b.ms < m.ms) + 1 AS rank FROM world_race_best m WHERE track = ? AND player_id = ?").bind(t.key, t.key, pid),
    ]);
    const me = mine.results?.[0];
    return rbcJson({ ok: true, track: t.key, top: (top.results || []).map((r) => ({ id: r.player_id, name: r.name, ms: Number(r.ms), you: r.player_id === pid })), you: me ? { ms: Number(me.ms), rank: Number(me.rank) } : null });
  }
  if (action === "host" || action === "solo") {
    const t = RBE.raceTrack(body?.track);
    if (!t) return rbcJson({ ok: false, error: "Pick a track." }, 400);
    if (!(await worldRateOk(env, "rh:" + pid, 8))) return rbcJson({ ok: false, error: "Slow down a little before starting another race." }, 429);
    const solo = action === "solo", id = rbcId("race_"), start = ms + (solo ? RBE.RACE_SOLO_S : RBE.RACE_LOBBY_S) * 1000, ends = start + t.par * 3 * 1000;
    await env.DB.batch([
      // Old races go, and this player leaves any race they're still in.
      env.DB.prepare("DELETE FROM world_race_entries WHERE race_id IN (SELECT id FROM world_races WHERE ends_at < ?)").bind(ms - 3600e3),
      env.DB.prepare("DELETE FROM world_races WHERE ends_at < ?").bind(ms - 3600e3),
      env.DB.prepare("DELETE FROM world_race_entries WHERE player_id = ? AND finish_ms IS NULL AND race_id IN (SELECT id FROM world_races WHERE ends_at > ?)").bind(pid, ms),
      env.DB.prepare("INSERT INTO world_races (id, track, host_id, host_name, solo, start_at, ends_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id, t.key, pid, name, solo ? 1 : 0, start, ends, new Date(ms).toISOString()),
      env.DB.prepare("INSERT INTO world_race_entries (race_id, player_id, name, slot, cp, at) VALUES (?, ?, ?, 0, 0, ?)").bind(id, pid, name, ms),
    ]);
    return rbcJson(await worldRaceRead(env, id, pid, ms));
  }
  const raceId = String(body?.race || "");
  if (!/^race_[A-Za-z0-9_-]{4,60}$/.test(raceId)) return rbcJson({ ok: false, error: "That race isn't running." }, 400);
  const race = await env.DB.prepare("SELECT * FROM world_races WHERE id = ?").bind(raceId).first();
  if (!race) return rbcJson({ ok: false, error: "That race isn't running." }, 404);
  const t = RBE.raceTrack(race.track);
  if (action === "join") {
    if (Number(race.solo)) return rbcJson({ ok: false, error: "That's a solo time trial." }, 409);
    if (ms >= Number(race.start_at)) return rbcJson({ ok: false, error: "That race has already started." }, 409);
    if (!(await worldRateOk(env, "rj:" + pid, 12))) return rbcJson({ ok: false, error: "Slow down a little." }, 429);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM world_race_entries WHERE player_id = ? AND race_id != ? AND finish_ms IS NULL AND race_id IN (SELECT id FROM world_races WHERE ends_at > ?)").bind(pid, raceId, ms),
      // The next free grid slot, and only while there's room.
      env.DB.prepare("INSERT OR IGNORE INTO world_race_entries (race_id, player_id, name, slot, cp, at) SELECT ?, ?, ?, coalesce((SELECT max(slot) + 1 FROM world_race_entries WHERE race_id = ?), 0), 0, ? WHERE (SELECT count(*) FROM world_race_entries WHERE race_id = ?) < ?")
        .bind(raceId, pid, name, raceId, ms, raceId, RBE.RACE_MAX),
    ]);
    const out = await worldRaceRead(env, raceId, pid, ms);
    if (!out.entries.some((e) => e.you)) return rbcJson({ ok: false, error: `That race is full (${RBE.RACE_MAX} racers).` }, 409);
    return rbcJson(out);
  }
  const entry = await env.DB.prepare("SELECT * FROM world_race_entries WHERE race_id = ? AND player_id = ?").bind(raceId, pid).first();
  if (action === "leave") {
    if (entry && entry.finish_ms == null) await env.DB.prepare("DELETE FROM world_race_entries WHERE race_id = ? AND player_id = ? AND finish_ms IS NULL").bind(raceId, pid).run();
    return rbcJson({ ok: true });
  }
  if (action !== "sync") return rbcJson({ ok: false, error: "Unknown action." }, 400);
  if (!entry) return rbcJson({ ok: false, error: "You're not in that race." }, 404);
  if (!(await worldRateOk(env, "rs:" + pid, 150))) return rbcJson({ ok: false, error: "Too fast." }, 429);
  const pos = Array.isArray(body.car) ? body.car.slice(0, 4).map(Number) : [];
  const ok = pos.length === 4 && pos.every(Number.isFinite) && Math.abs(pos[0]) < 1500 && Math.abs(pos[1]) < 1500;
  const stmts = [];
  if (ok) stmts.push(env.DB.prepare("UPDATE world_race_entries SET x = ?, z = ?, h = ?, s = ?, at = ? WHERE race_id = ? AND player_id = ?").bind(pos[0], pos[1], pos[2], Math.max(-60, Math.min(60, pos[3])), ms, raceId, pid));
  const cp = Number(entry.cp), start = Number(race.start_at);
  if (ok && t && entry.finish_ms == null && ms >= start && ms <= Number(race.ends_at) && worldNum(body.cp) === cp + 1 && cp < t.cps.length) {
    // Where the car was when the game saw it pass (a sync can arrive a moment later, further on), else where it is now.
    const hit = Array.isArray(body.hit) && body.hit.length === 2 && body.hit.every((v) => Number.isFinite(Number(v))) ? body.hit.map(Number) : pos;
    const target = t.cps[cp], since = cp === 0 ? start : Number(entry.cp_at);
    const near = Math.hypot(hit[0] - target[0], hit[1] - target[1]) <= RBE.RACE_CP_RADIUS;
    const possible = ms - since >= (RBE.raceLeg(t, cp) / RBE.RACE_MAX_SPEED) * 1000;
    if (near && possible) {
      if (cp + 1 < t.cps.length) {
        stmts.push(env.DB.prepare("UPDATE world_race_entries SET cp = ?, cp_at = ? WHERE race_id = ? AND player_id = ? AND cp = ?").bind(cp + 1, ms, raceId, pid, cp));
      } else {
        const time = ms - start;
        stmts.push(env.DB.prepare("UPDATE world_race_entries SET cp = ?, cp_at = ?, finish_ms = ?, place = (SELECT count(*) FROM world_race_entries f WHERE f.race_id = ? AND f.finish_ms IS NOT NULL) + 1 WHERE race_id = ? AND player_id = ? AND cp = ? AND finish_ms IS NULL")
          .bind(cp + 1, ms, time, raceId, raceId, pid, cp));
        stmts.push(env.DB.prepare("INSERT INTO world_race_best (k, track, player_id, name, ms, race_id, at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(k) DO UPDATE SET name = excluded.name, ms = excluded.ms, race_id = excluded.race_id, at = excluded.at WHERE excluded.ms < world_race_best.ms")
          .bind(`${t.key}:${pid}`, t.key, pid, name, time, raceId, new Date(ms).toISOString()));
      }
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
  return rbcJson(await worldRaceRead(env, raceId, pid, ms));
}

async function worldChat(request, env, body) {
  const pid = String(body?.id || ""), text = worldClean(body?.text, 240), name = worldClean(body?.name, 24) || "Hustler";
  if (!WORLD_ID.test(pid)) return rbcJson({ ok: false, error: "Start the game again." }, 400);
  if (!text) return rbcJson({ ok: false, error: "Type a message." }, 400);
  if (!(await worldRateOk(env, "c:" + pid, 12)) || !(await worldRateOk(env, "ci:" + (await worldIpKey(request)), 30))) return rbcJson({ ok: false, error: "Slow down a little before sending more." }, 429);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO world_chat (player_id, name, text, created_at) VALUES (?, ?, ?, ?)").bind(pid, name, text, new Date(Date.now()).toISOString()),
    env.DB.prepare("DELETE FROM world_chat WHERE n <= (SELECT max(n) - 2000 FROM world_chat)"),
  ]);
  return rbcJson({ ok: true });
}

// The sponsors' ads on RB World's billboards and posters (src/world/ads.js): live ads from RB Command set to
// "Everywhere ads show" or "RB World only", with an image or a video, inside their dates. Clicks go through
// /go/ad/<id>?s=world, the same counted redirect as the website's ad slots.
async function worldBillboards(env) {
  const ok = (u) => { try { const x = new URL(String(u || "")); return x.protocol === "https:" ? x.href : ""; } catch { return ""; } };
  // ads that have used up a bought package (max_impressions) stop, where that column exists
  const base = "SELECT id, advertiser, headline, body, image_url, video_url, poster_url, format, click_url, cta, weight FROM ads WHERE status = 'live' AND surface IN ('all', 'world', 'game') AND (starts_at IS NULL OR starts_at = '' OR datetime(starts_at) <= datetime('now')) AND (ends_at IS NULL OR ends_at = '' OR datetime(ends_at) >= datetime('now'))";
  const tail = " ORDER BY coalesce(weight, 1) DESC, id DESC LIMIT 8";
  let rows = [];
  try { rows = (await env.DB.prepare(base + " AND (coalesce(max_impressions, 0) = 0 OR coalesce(impressions, 0) < max_impressions)" + tail).all()).results || []; }
  catch { try { rows = (await env.DB.prepare(base + tail).all()).results || []; } catch {} }
  const ads = rows.map((a) => {
    const video = a.format === "video" ? ok(a.video_url) : "", image = ok(a.image_url) || ok(a.poster_url);
    return { id: Number(a.id), advertiser: String(a.advertiser || "").slice(0, 120), headline: String(a.headline || "").slice(0, 140), body: String(a.body || "").slice(0, 200),
      image_url: image || null, video_url: video || null, format: video ? "video" : "image", cta: String(a.cta || "").slice(0, 24), click: ok(a.click_url) ? `/go/ad/${a.id}?s=world` : null };
  }).filter((a) => a.image_url || a.video_url || a.headline);
  return rbcJson({ ok: true, ads }, 200, { "Cache-Control": "public, max-age=60" });
}

// In-game views, kept apart from the website's (world_ad_stats): "imp" when an ad is on screen within range,
// "view" once it has stayed there 1 second (2 for video). The game sends each at most once per ad every 30 minutes;
// here a player can count at most 40 events a minute, and only for ads that are live.
async function worldAdEvent(request, env, body) {
  const pid = String(body?.id || "");
  if (!WORLD_ID.test(pid)) return rbcJson({ ok: false, error: "Start the game again." }, 400);
  if (/bot|crawl|spider|headless|lighthouse|preview/i.test(request.headers.get("User-Agent") || "")) return rbcJson({ ok: true, counted: 0 });
  if (!(await worldRateOk(env, "ad:" + pid, 40))) return rbcJson({ ok: false, error: "Too fast." }, 429);
  const want = [], seen = new Set();
  for (const e of (Array.isArray(body.events) ? body.events : []).slice(0, 24)) {
    const id = Number(e?.id), kind = e?.kind;
    if (!Number.isInteger(id) || id <= 0 || !["imp", "view"].includes(kind) || seen.has(id + kind)) continue;
    seen.add(id + kind); want.push([id, kind]);
  }
  if (!want.length) return rbcJson({ ok: true, counted: 0 });
  const ids = [...new Set(want.map((x) => x[0]))];
  const live = new Set(((await env.DB.prepare(`SELECT id FROM ads WHERE status = 'live' AND id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all()).results || []).map((x) => Number(x.id)));
  const day = new Date(Date.now()).toISOString().slice(0, 10), stmts = [];
  for (const [id, kind] of want) if (live.has(id)) {
    const col = kind === "imp" ? "impressions" : "viewable";
    stmts.push(env.DB.prepare(`INSERT INTO world_ad_stats (ad_id, day, ${col}) VALUES (?, ?, 1) ON CONFLICT(ad_id, day) DO UPDATE SET ${col} = ${col} + 1`).bind(id, day));
  }
  if (stmts.length) { try { await env.DB.batch(stmts); } catch (e) { console.error("world ad-event", e && e.message); return rbcJson({ ok: true, counted: 0 }); } }
  return rbcJson({ ok: true, counted: stmts.length });
}

async function worldAds(env, g) {
  const out = [];
  if (g && g.worldNotice) out.push({ id: "notice", status: "live", channel: "Ticker", title: "RB World", body: g.worldNotice });
  try {
    const r = await env.DB.prepare("SELECT id, advertiser, headline, body FROM ads WHERE status = 'live' AND surface IN ('all', 'game', 'world') AND (starts_at IS NULL OR starts_at = '' OR datetime(starts_at) <= datetime('now')) AND (ends_at IS NULL OR ends_at = '' OR datetime(ends_at) >= datetime('now')) ORDER BY weight DESC, id LIMIT 10").all();
    for (const a of r.results || []) out.push({ id: "ad" + a.id, status: "live", channel: "Ticker", title: a.headline || a.advertiser, body: a.body || a.advertiser || "" });
  } catch {}
  try {
    const r = await env.DB.prepare("SELECT id, title, starts_at, venue_name FROM rb_events WHERE status = 'live' AND datetime(starts_at) >= datetime('now', '-6 hours') ORDER BY datetime(starts_at) LIMIT 5").all();
    for (const e of r.results || []) out.push({ id: "ev" + e.id, status: "live", channel: "Ticker", title: e.title, body: `${String(e.starts_at).slice(0, 10)}${e.venue_name ? " · " + e.venue_name : ""} · relentlessbillionaire.com/events` });
  } catch {}
  return rbcJson({ ok: true, ads: out }, 200, { "Cache-Control": "public, max-age=60" });
}

const worldAudioCache = {};
function worldAudioBytes(name) {
  if (!worldAudioCache[name]) { const b = atob(RB_WORLD_AUDIO[name]), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); worldAudioCache[name] = u; }
  return worldAudioCache[name];
}

function worldCsp(env) {
  const fapi = rbcPublishableDomain(env.CLERK_PUBLISHABLE_KEY);
  const clerk = [...new Set([fapi ? "https://" + fapi : null, "https://clerk.relentlessbillionaire.com", "https://*.clerk.accounts.dev"].filter(Boolean))].join(" ");
  // The game builds its panels with inline handlers and styles, as it always has, so scripts allow 'unsafe-inline'.
  return ["default-src 'self'", `script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://relentlessbillionaire.com https://static.cloudflareinsights.com ${clerk} https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com", "font-src 'self' https://fonts.gstatic.com data:", "img-src 'self' data: blob: https:", "media-src 'self' https: blob:",
    `connect-src 'self' https://tiles.openfreemap.org https://cdn.jsdelivr.net https://unpkg.com https://*.basemaps.cartocdn.com https://tiles.basemaps.cartocdn.com https://relentlessbillionaire.com https://cloudflareinsights.com wss://rb-world-live.tge40000.workers.dev ${clerk} https://clerk-telemetry.com`,
    "worker-src 'self' blob:", `frame-src https://challenges.cloudflare.com ${clerk}`, "object-src 'none'", "base-uri 'self'", "frame-ancestors 'self'"].join("; ");
}

async function rbWorldRoute(request, env, url, path, method) {
  const page = method === "GET" || method === "HEAD";
  if (path === "/app/world" && page && !url.pathname.endsWith("/")) return new Response(null, { status: 301, headers: { Location: "/app/world/" + url.search } });
  const g = await rbbLoad(env);
  if (path === "/app/world" && page) {
    if (!g.worldOpen) {
      const nonce = rbcNonce();
      return new Response(request.method === "HEAD" ? null : RB_APP_HTML.replaceAll("__NONCE__", nonce).replace("__STATUS__", "off").replace("__CLERK_KEY__", '""').replace("__STATE__", () => rbcScriptJson(rbbPublicState(g))), { headers: rbcPageHeaders(env, nonce) });
    }
    const html = RB_WORLD_HTML.replace("__CLERK_KEY__", () => rbcScriptJson(String(env.CLERK_PUBLISHABLE_KEY || ""))).replaceAll("__VERSION__", WORLD_VERSION)
      .replace("__WORLD_CFG__", () => rbcScriptJson({ radio: g.worldRadio, notice: g.worldNotice, combat: g.worldCombat }));
    return new Response(request.method === "HEAD" ? null : html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": worldCsp(env), "X-Content-Type-Options": "nosniff", "X-Frame-Options": "SAMEORIGIN", "Referrer-Policy": "strict-origin-when-cross-origin" } });
  }
  const file = /^\/app\/world\/([a-z_]+\.js)$/.exec(path)?.[1];
  const files = file && Object.hasOwn(RB_WORLD_FILES, file) ? { [path]: RB_WORLD_FILES[file] } : {};
  if (Object.hasOwn(files, path) && page) {
    if (!g.worldOpen) return new Response("// RB World is coming soon.\n", { status: 404, headers: { "Content-Type": "application/javascript; charset=utf-8" } });
    return new Response(files[path], { headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } });
  }
  // The game's three sounds (theme, cash, alert), moved here from the old game's Worker (/game/assets/audio/) on
  // 23 Oct 2026 so that Worker and its InstantDB app can be retired. RB_WORLD_AUDIO holds them base64-encoded.
  const snd = /^\/app\/world\/audio\/([a-z-]+\.mp3)$/.exec(path)?.[1];
  if (snd && page && Object.hasOwn(RB_WORLD_AUDIO, snd)) {
    if (!g.worldOpen) return new Response("RB World is coming soon.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    const bytes = worldAudioBytes(snd);
    return new Response(request.method === "HEAD" ? null : bytes, { headers: { "Content-Type": "audio/mpeg", "Content-Length": String(bytes.length), "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" } });
  }
  if (!path.startsWith("/api/world/")) return null;
  if (!g.worldOpen) return rbcJson({ ok: false, error: "RB World is coming soon." }, 403);
  if (path === "/api/world/ads" && method === "GET") return await worldAds(env, g);
  if (path === "/api/world/billboards" && method === "GET") return await worldBillboards(env);
  if (["/api/world/beat", "/api/world/chat", "/api/world/lot", "/api/world/rent", "/api/world/race", "/api/world/ad-event", "/api/world/me", "/api/world/save", "/api/world/ticket", "/api/world/node", "/api/world/deal", "/api/world/empire", "/api/world/heist"].includes(path) && method === "POST") {
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) return rbcJson({ ok: false, error: "Not allowed from another site." }, 403);
    if (!/^application\/json/i.test(request.headers.get("Content-Type") || "")) return rbcJson({ ok: false, error: "Send JSON." }, 415);
    const body = await request.json().catch(() => ({}));
    if (path === "/api/world/me") return await worldMe(request, env, body);
    if (path !== "/api/world/ad-event" && WORLD_ID.test(String(body?.id || ""))) {
      const who = await worldWho(request, env, String(body.id));
      if (!who.ok) return rbcJson({ ok: false, error: who.account ? "This player is saved to an RB account. Sign in to play it." : "This player is saved on another device.", code: "account" }, 403);
      if (path !== "/api/world/beat" && who.banned) return rbcJson({ ok: false, error: "This player can't do that in RB World." }, 403);
    }
    if (path === "/api/world/save") return await worldSave(env, body);
    if (path === "/api/world/ticket") return await worldTicket(env, body);
    if (path === "/api/world/node") return await worldNode(env, g, body);
    if (path === "/api/world/empire") return await worldEmpire(env, body);
    if (path === "/api/world/heist") return await worldHeist(env, body);
    if (path === "/api/world/deal") return await worldDeal(env, body);
    if (path === "/api/world/ad-event") return await worldAdEvent(request, env, body);
    if (path === "/api/world/lot") return await worldLot(env, body);
    if (path === "/api/world/rent") return await worldRent(env, body);
    if (path === "/api/world/race") return await worldRace(env, body);
    return path === "/api/world/beat" ? await worldBeat(request, env, g, body) : await worldChat(request, env, body);
  }
  return rbcJson({ ok: false, error: "Not found" }, 404);
}
