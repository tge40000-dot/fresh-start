// RB World: the 3D city game (rb-site-updates/src/world/), served at relentlessbillionaire.com/app/world/ and run on
// RB's own backend instead of InstantDB. Embedded into artist-router-v14.js by patch_badge.py after the RB Badge code,
// whose helpers it uses (rbbLoad, rbbMember, rbcJson, rbcId, rbcLaDay, rbcLaInstant, rbcPublishableDomain).
//   GET  /app/world/            the game (RB_WORLD_HTML), /app/world/main.js and /app/world/rb_world.js
//   POST /api/world/beat        a player's state in; players seen in the last WORLD_PEER_SECONDS, the top 10, new chat
//                               and, for signed-in members, play-time RB Badge points out
//   POST /api/world/chat        a message (240 characters, rate limited)
//   GET  /api/world/ads         the ticker: live RB ads for the game and upcoming RB Events
// Play time: a signed-in member's beats add up the seconds between them (at most WORLD_BEAT_CREDIT each, so several
// tabs or a stalled tab don't count extra); every world_block_minutes of play gives world_points_block points, up to
// world_points_daily a day. Net worth and the rest of the game stay in the player's browser, as before; the
// leaderboard shows what each player's game reports. RB World is open on its own (setting world_open, default on, so
// relentlessbillionaire.com/game/ keeps working); play-time points only start once RB Badge itself is switched on.
const WORLD_PEER_SECONDS = 20;
const WORLD_BEAT_CREDIT = 10;
const WORLD_VERSION = "w5";
const WORLD_OWNER_DAYS = 14; // a lot whose owner hasn't played for this long is for sale again

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
  const now = new Date(Date.now()).toISOString(), since = Math.max(0, worldNum(body.since));
  const [, peers, board, chat] = await env.DB.batch([
    env.DB.prepare("INSERT INTO world_players (id, name, clerk_user_id, net_worth, tokens, kills, deaths, health, lng, lat, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, clerk_user_id = coalesce(excluded.clerk_user_id, world_players.clerk_user_id), net_worth = excluded.net_worth, tokens = excluded.tokens, kills = excluded.kills, deaths = excluded.deaths, health = excluded.health, lng = coalesce(excluded.lng, world_players.lng), lat = coalesce(excluded.lat, world_players.lat), seen_at = excluded.seen_at")
      .bind(pid, name, clerkId, worldNum(body.netWorth), worldNum(body.tokens), worldNum(body.kills, 1e9), worldNum(body.deaths, 1e9), Math.max(0, Math.min(1000, worldNum(body.health, 1e6))), lng, lat, now),
    env.DB.prepare("SELECT id, name, net_worth, health, lng, lat FROM world_players WHERE seen_at >= ? AND id != ? ORDER BY seen_at DESC LIMIT 50").bind(new Date(Date.now() - WORLD_PEER_SECONDS * 1000).toISOString(), pid),
    env.DB.prepare("SELECT id, name, net_worth FROM world_players WHERE seen_at >= ? ORDER BY net_worth DESC LIMIT 10").bind(new Date(Date.now() - 30 * 864e5).toISOString()),
    since > 0
      ? env.DB.prepare("SELECT n, player_id, name, text, created_at FROM world_chat WHERE n > ? ORDER BY n LIMIT 30").bind(since)
      : env.DB.prepare("SELECT * FROM (SELECT n, player_id, name, text, created_at FROM world_chat WHERE created_at >= ? ORDER BY n DESC LIMIT 20) ORDER BY n").bind(new Date(Date.now() - 6 * 3600e3).toISOString()),
  ]);
  // The shared city: who owns which lot, and rent others paid this player since the last beat.
  const [ownLots, rentDue] = await env.DB.batch([
    worldLotsQuery(env),
    env.DB.prepare("SELECT coalesce(sum(rent_pending), 0) AS n FROM world_lots WHERE owner_id = ?").bind(pid),
  ]);
  const rent = Number(rentDue.results?.[0]?.n) || 0;
  if (rent > 0) await env.DB.prepare("UPDATE world_lots SET rent_pending = 0 WHERE owner_id = ?").bind(pid).run();
  return rbcJson({
    ok: true,
    peers: (peers.results || []).map((p) => ({ id: p.id, name: p.name, netWorth: Number(p.net_worth), health: Number(p.health), pos: p.lng == null ? null : [Number(p.lng), Number(p.lat)] })),
    board: (board.results || []).map((u) => ({ id: u.id, name: u.name, netWorth: Number(u.net_worth) })),
    chat: (chat.results || []).map((c) => ({ n: Number(c.n), id: "c" + c.n, senderId: c.player_id, author: c.name, text: c.text, ts: Date.parse(c.created_at) })),
    points,
    lots: (ownLots.results || []).map(worldLotOut),
    rent,
  });
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

async function worldAds(env) {
  const out = [];
  try {
    const r = await env.DB.prepare("SELECT id, advertiser, headline, body FROM ads WHERE status = 'live' AND surface IN ('all', 'game') AND (starts_at IS NULL OR starts_at = '' OR datetime(starts_at) <= datetime('now')) AND (ends_at IS NULL OR ends_at = '' OR datetime(ends_at) >= datetime('now')) ORDER BY weight DESC, id LIMIT 10").all();
    for (const a of r.results || []) out.push({ id: "ad" + a.id, status: "live", channel: "Ticker", title: a.headline || a.advertiser, body: a.body || a.advertiser || "" });
  } catch {}
  try {
    const r = await env.DB.prepare("SELECT id, title, starts_at, venue_name FROM rb_events WHERE status = 'live' AND datetime(starts_at) >= datetime('now', '-6 hours') ORDER BY datetime(starts_at) LIMIT 5").all();
    for (const e of r.results || []) out.push({ id: "ev" + e.id, status: "live", channel: "Ticker", title: e.title, body: `${String(e.starts_at).slice(0, 10)}${e.venue_name ? " · " + e.venue_name : ""} · relentlessbillionaire.com/events` });
  } catch {}
  return rbcJson({ ok: true, ads: out }, 200, { "Cache-Control": "public, max-age=60" });
}

function worldCsp(env) {
  const fapi = rbcPublishableDomain(env.CLERK_PUBLISHABLE_KEY);
  const clerk = [...new Set([fapi ? "https://" + fapi : null, "https://clerk.relentlessbillionaire.com", "https://*.clerk.accounts.dev"].filter(Boolean))].join(" ");
  // The game builds its panels with inline handlers and styles, as it always has, so scripts allow 'unsafe-inline'.
  return ["default-src 'self'", `script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://relentlessbillionaire.com https://static.cloudflareinsights.com ${clerk} https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com", "font-src 'self' https://fonts.gstatic.com data:", "img-src 'self' data: blob: https:", "media-src 'self' https: blob:",
    `connect-src 'self' https://cdn.jsdelivr.net https://unpkg.com https://*.basemaps.cartocdn.com https://tiles.basemaps.cartocdn.com https://relentlessbillionaire.com https://cloudflareinsights.com ${clerk} https://clerk-telemetry.com`,
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
    const html = RB_WORLD_HTML.replace("__CLERK_KEY__", () => rbcScriptJson(String(env.CLERK_PUBLISHABLE_KEY || ""))).replaceAll("__VERSION__", WORLD_VERSION);
    return new Response(request.method === "HEAD" ? null : html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": worldCsp(env), "X-Content-Type-Options": "nosniff", "X-Frame-Options": "SAMEORIGIN", "Referrer-Policy": "strict-origin-when-cross-origin" } });
  }
  const file = /^\/app\/world\/([a-z_]+\.js)$/.exec(path)?.[1];
  const files = file && Object.hasOwn(RB_WORLD_FILES, file) ? { [path]: RB_WORLD_FILES[file] } : {};
  if (Object.hasOwn(files, path) && page) {
    if (!g.worldOpen) return new Response("// RB World is coming soon.\n", { status: 404, headers: { "Content-Type": "application/javascript; charset=utf-8" } });
    return new Response(files[path], { headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } });
  }
  if (!path.startsWith("/api/world/")) return null;
  if (!g.worldOpen) return rbcJson({ ok: false, error: "RB World is coming soon." }, 403);
  if (path === "/api/world/ads" && method === "GET") return await worldAds(env);
  if (["/api/world/beat", "/api/world/chat", "/api/world/lot", "/api/world/rent"].includes(path) && method === "POST") {
    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) return rbcJson({ ok: false, error: "Not allowed from another site." }, 403);
    if (!/^application\/json/i.test(request.headers.get("Content-Type") || "")) return rbcJson({ ok: false, error: "Send JSON." }, 415);
    const body = await request.json().catch(() => ({}));
    if (path === "/api/world/lot") return await worldLot(env, body);
    if (path === "/api/world/rent") return await worldRent(env, body);
    return path === "/api/world/beat" ? await worldBeat(request, env, g, body) : await worldChat(request, env, body);
  }
  return rbcJson({ ok: false, error: "Not found" }, 404);
}
