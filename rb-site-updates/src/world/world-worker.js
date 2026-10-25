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
const WORLD_VERSION = "w16";
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
  const carOk = car.length === 4 && car.every(Number.isFinite) && Math.abs(car[0]) < 1500 && Math.abs(car[1]) < 1500;
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
    `connect-src 'self' https://cdn.jsdelivr.net https://unpkg.com https://*.basemaps.cartocdn.com https://tiles.basemaps.cartocdn.com https://relentlessbillionaire.com https://cloudflareinsights.com wss://rb-world-live.tge40000.workers.dev ${clerk} https://clerk-telemetry.com`,
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
  if (["/api/world/beat", "/api/world/chat", "/api/world/lot", "/api/world/rent", "/api/world/race", "/api/world/ad-event", "/api/world/me", "/api/world/save", "/api/world/ticket"].includes(path) && method === "POST") {
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
    if (path === "/api/world/ad-event") return await worldAdEvent(request, env, body);
    if (path === "/api/world/lot") return await worldLot(env, body);
    if (path === "/api/world/rent") return await worldRent(env, body);
    if (path === "/api/world/race") return await worldRace(env, body);
    return path === "/api/world/beat" ? await worldBeat(request, env, g, body) : await worldChat(request, env, body);
  }
  return rbcJson({ ok: false, error: "Not found" }, 404);
}
