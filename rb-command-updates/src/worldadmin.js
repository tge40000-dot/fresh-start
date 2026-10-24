/**
 * RB World (team.relentlessbillionaire.com/world): the controls for the 3D city game at relentlessbillionaire.com/app/world
 * (and /game, which sends players there). The game's "Enter as Admin" opens this page.
 *
 * - Switches: RB World open or closed, the car radio (RB Radio live in every car), a notice players see when they start
 *   and on the city ticker, and the RB Badge points for play time. All of them are badge_config rows, the same ones the
 *   game reads, so a change shows in the game within a minute.
 * - On the radio now: what RB Radio is playing (the car radio plays the same), or the live show.
 * - Players: online now, today, this week, and the richest players (what each player's game reports).
 * - Moderation: delete chat messages; block a player (no chat, no races, off the leaderboard and other players' maps;
 *   they can still drive). Blocks are by the game's player id. Unblock any time.
 * - The city: owned lots (release one to put it back on sale), recent races and the best time on each track.
 * Seeing it: Badges view. Changing anything: Badges edit. Every change is in command_log.
 */
import { HttpError } from "./tables.js";

const RADIO_NOW = "https://relentlessbillionaire.com/radio/api/now";
const LOTS = 32;
const POINTS = { world_points_block: [0, 100], world_block_minutes: [1, 1440], world_points_daily: [0, 1000] };
const ID = /^[A-Za-z0-9_-]{4,64}$/;
const log = (env, who, action, target, detail) => env.DB.prepare("INSERT INTO command_log (actor, action, target, detail) VALUES (?, ?, ?, ?)").bind(who.email, action, String(target).slice(0, 200), String(detail).slice(0, 900)).run().catch(() => {});
const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const onOff = (v) => String(v ?? "").trim().toLowerCase() !== "off";
const n = (v) => Number(v) || 0;

async function rows(env, sql, ...a) { try { return (await env.DB.prepare(sql).bind(...a).all()).results || []; } catch { return []; } }
async function one(env, sql, ...a) { try { return await env.DB.prepare(sql).bind(...a).first(); } catch { return null; } }
async function ensure(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS world_bans (id TEXT PRIMARY KEY, name TEXT, reason TEXT, by TEXT, created_at TEXT NOT NULL)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS world_ad_stats (ad_id INTEGER NOT NULL, day TEXT NOT NULL, impressions INTEGER NOT NULL DEFAULT 0, viewable INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (ad_id, day))").run();
}
async function config(env) {
  const out = {};
  for (const r of await rows(env, "SELECT key, value FROM badge_config WHERE key IN ('enabled', 'world_open', 'world_radio', 'world_notice', 'world_points_block', 'world_block_minutes', 'world_points_daily')")) out[r.key] = r.value;
  return out;
}

/** What RB Radio is playing (the car radio in RB World plays the same), or null when it can't be reached. */
export async function radioNow(fetcher = fetch) {
  try {
    const r = await fetcher(RADIO_NOW, { signal: AbortSignal.timeout(4000), headers: { "User-Agent": "RB-Command/1.0" } });
    if (!r.ok) return null;
    const d = await r.json();
    if (d.live) return { live: true, title: clean(d.live.title, 120) || "Live show", artist: clean(d.live.host, 80) };
    const a = d.on_air;
    return a ? { live: false, title: clean(a.title, 120), artist: clean(a.artist, 80), ends_at: n(a.starts_at) + n(a.duration_ms) } : { live: false, title: "", artist: "" };
  } catch { return null; }
}

export async function summary(env, fetcher = fetch) {
  await ensure(env);
  const now = Date.now(), iso = (ms) => new Date(now - ms).toISOString(), today = new Date(now).toISOString().slice(0, 10);
  const c = await config(env);
  const [counts, top, chat, bans, lots, races, bests, play, radio, boards, adViews] = await Promise.all([
    one(env, "SELECT count(*) AS total, sum(seen_at >= ?) AS online, sum(seen_at >= ?) AS day, sum(seen_at >= ?) AS week FROM world_players", iso(120e3), iso(864e5), iso(7 * 864e5)),
    rows(env, "SELECT p.id, p.name, p.net_worth, p.tokens, p.kills, p.deaths, p.seen_at, p.clerk_user_id IS NOT NULL AS account, b.id IS NOT NULL AS blocked FROM world_players p LEFT JOIN world_bans b ON b.id = p.id WHERE p.seen_at >= ? ORDER BY p.net_worth DESC LIMIT 15", iso(30 * 864e5)),
    rows(env, "SELECT c.n, c.player_id, c.name, c.text, c.created_at, b.id IS NOT NULL AS blocked FROM world_chat c LEFT JOIN world_bans b ON b.id = c.player_id ORDER BY c.n DESC LIMIT 40"),
    rows(env, "SELECT id, name, reason, by, created_at FROM world_bans ORDER BY created_at DESC LIMIT 100"),
    rows(env, "SELECT lot, owner_id, owner_name, business, level, title, updated_at FROM world_lots WHERE owner_id IS NOT NULL ORDER BY lot"),
    rows(env, "SELECT r.id, r.track, r.host_name, r.solo, r.start_at, (SELECT count(*) FROM world_race_entries e WHERE e.race_id = r.id) AS racers, (SELECT count(*) FROM world_race_entries e WHERE e.race_id = r.id AND e.finish_ms IS NOT NULL) AS finished FROM world_races r ORDER BY r.start_at DESC LIMIT 8"),
    rows(env, "SELECT track, name, min(ms) AS ms, at FROM world_race_best GROUP BY track ORDER BY track"),
    one(env, "SELECT count(*) AS members, coalesce(sum(seconds), 0) AS seconds, coalesce(sum(awarded), 0) AS awarded FROM world_play WHERE day = ?", today),
    radioNow(fetcher),
    // the sponsors on the billboards and posters right now: the same rule as the game (/api/world/billboards)
    rows(env, "SELECT id, advertiser, headline, surface, format, image_url, video_url, ends_at FROM ads WHERE status = 'live' AND surface IN ('all', 'world', 'game') AND (starts_at IS NULL OR starts_at = '' OR datetime(starts_at) <= datetime('now')) AND (ends_at IS NULL OR ends_at = '' OR datetime(ends_at) >= datetime('now')) ORDER BY coalesce(weight, 1) DESC, id DESC LIMIT 8"),
    rows(env, "SELECT s.ad_id, a.advertiser, a.headline, a.status, sum(s.impressions) AS views, sum(s.viewable) AS viewable FROM world_ad_stats s LEFT JOIN ads a ON a.id = s.ad_id WHERE s.day >= ? GROUP BY s.ad_id ORDER BY views DESC LIMIT 20", iso(30 * 864e5).slice(0, 10)),
  ]);
  return {
    ok: true, generated_at: new Date(now).toISOString(),
    settings: { open: onOff(c.world_open), radio: onOff(c.world_radio), notice: c.world_notice || "", badge_on: String(c.enabled || "").trim().toLowerCase() === "on",
      points: { block: n(c.world_points_block ?? 5), minutes: n(c.world_block_minutes ?? 10), daily: n(c.world_points_daily ?? 30) } },
    players: { total: n(counts?.total), online: n(counts?.online), day: n(counts?.day), week: n(counts?.week),
      top: top.map((p) => ({ id: p.id, name: p.name, net_worth: n(p.net_worth), tokens: n(p.tokens), kills: n(p.kills), deaths: n(p.deaths), seen_at: p.seen_at, account: !!n(p.account), blocked: !!n(p.blocked) })) },
    play_today: { members: n(play?.members), minutes: Math.round(n(play?.seconds) / 60), points: n(play?.awarded) },
    chat: chat.map((m) => ({ n: n(m.n), player_id: m.player_id, name: m.name, text: m.text, created_at: m.created_at, blocked: !!n(m.blocked) })),
    bans, lots: { owned: lots.length, total: LOTS, list: lots },
    races: races.map((r) => ({ ...r, racers: n(r.racers), finished: n(r.finished) })), bests: bests.map((b) => ({ ...b, ms: n(b.ms) })),
    radio,
    billboards: { live: boards.map((a) => ({ id: n(a.id), advertiser: a.advertiser, headline: a.headline, surface: a.surface, video: a.format === "video" && !!a.video_url, image: !!a.image_url, ends_at: a.ends_at || null })),
      stats: adViews.map((a) => ({ id: n(a.ad_id), advertiser: a.advertiser || "Ad #" + a.ad_id, headline: a.headline || "", status: a.status || "deleted", views: n(a.views), viewable: n(a.viewable) })) },
  };
}

export async function saveSettings(env, who, body) {
  const changes = [], set = [];
  const put = (key, value, label) => { set.push(env.DB.prepare("UPDATE badge_config SET value = ? WHERE key = ?").bind(String(value), key)); changes.push(`${label}: ${value === "" ? "(none)" : value}`); };
  const c = await config(env);
  if (body.open !== undefined && onOff(c.world_open) !== !!body.open) put("world_open", body.open ? "on" : "off", "RB World");
  if (body.radio !== undefined && onOff(c.world_radio) !== !!body.radio) put("world_radio", body.radio ? "on" : "off", "car radio");
  if (body.notice !== undefined) { const t = clean(body.notice, 200); if (t !== (c.world_notice || "")) put("world_notice", t, "notice"); }
  for (const [key, [lo, hi]] of Object.entries(POINTS)) {
    const field = { world_points_block: "block", world_block_minutes: "minutes", world_points_daily: "daily" }[key];
    if (body.points?.[field] === undefined) continue;
    const v = Number(body.points[field]);
    if (!Number.isInteger(v) || v < lo || v > hi) throw new HttpError(400, `${field === "block" ? "Points per stretch" : field === "minutes" ? "Minutes per stretch" : "Points a day"} must be a whole number from ${lo} to ${hi}.`);
    if (String(v) !== String(c[key] ?? "")) put(key, v, key.replace("world_", "").replace(/_/g, " "));
  }
  if (!set.length) return { ok: true, changed: [] };
  // rows that a database from before these settings doesn't have yet
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO badge_config (key, value) VALUES ('world_radio', 'on')"),
    env.DB.prepare("INSERT OR IGNORE INTO badge_config (key, value) VALUES ('world_notice', '')"),
    ...set]);
  await log(env, who, "world.settings", "RB World", changes.join(", "));
  return { ok: true, changed: changes };
}

export async function deleteChat(env, who, body) {
  const id = Number(body.n);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, "Pick a message.");
  const m = await one(env, "SELECT name, text FROM world_chat WHERE n = ?", id);
  if (!m) throw new HttpError(404, "That message is already gone.");
  await env.DB.prepare("DELETE FROM world_chat WHERE n = ?").bind(id).run();
  await log(env, who, "world.chat_delete", m.name, `Deleted: "${clean(m.text, 200)}"`);
  return { ok: true };
}

export async function block(env, who, body) {
  await ensure(env);
  const id = String(body.id || "");
  if (!ID.test(id)) throw new HttpError(400, "Pick a player.");
  const p = await one(env, "SELECT name FROM world_players WHERE id = ?", id), name = clean(body.name || p?.name || "", 40) || id, reason = clean(body.reason, 200);
  const stmts = [env.DB.prepare("INSERT INTO world_bans (id, name, reason, by, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET reason = excluded.reason, by = excluded.by")
    .bind(id, name, reason || null, who.email, new Date().toISOString())];
  if (body.delete_chat) stmts.push(env.DB.prepare("DELETE FROM world_chat WHERE player_id = ?").bind(id));
  await env.DB.batch(stmts);
  await log(env, who, "world.block", name, `Blocked in RB World${reason ? `: ${reason}` : ""}${body.delete_chat ? " (their chat deleted)" : ""}`);
  return { ok: true };
}

export async function unblock(env, who, body) {
  await ensure(env);
  const id = String(body.id || "");
  if (!ID.test(id)) throw new HttpError(400, "Pick a player.");
  const b = await one(env, "SELECT name FROM world_bans WHERE id = ?", id);
  if (!b) throw new HttpError(404, "That player isn't blocked.");
  await env.DB.prepare("DELETE FROM world_bans WHERE id = ?").bind(id).run();
  await log(env, who, "world.unblock", b.name || id, "Unblocked in RB World");
  return { ok: true };
}

export async function releaseLot(env, who, body) {
  const lot = Number(body.lot);
  if (!Number.isInteger(lot) || lot < 0 || lot >= 1000) throw new HttpError(400, "Pick a lot.");
  const l = await one(env, "SELECT owner_name, title FROM world_lots WHERE lot = ?", lot);
  if (!l) throw new HttpError(404, "Nobody owns that lot.");
  await env.DB.prepare("DELETE FROM world_lots WHERE lot = ?").bind(lot).run();
  await log(env, who, "world.lot_release", `lot ${lot}`, `Put back on sale (was ${l.owner_name || "someone"}'s${l.title ? `, "${l.title}"` : ""})`);
  return { ok: true };
}

export function csp(nonce) {
  return ["default-src 'none'", `script-src 'nonce-${nonce}'`, `style-src 'nonce-${nonce}'`, "font-src https://fonts.gstatic.com",
    "img-src 'self' https: data:", "connect-src 'self'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'"].join("; ");
}

const STYLE = `
@font-face{font-family:"RB Cinzel";src:url(https://fonts.gstatic.com/s/cinzel/v26/8vIJ7ww63mVu7gt79mT7.woff2) format("woff2");font-weight:400 900;font-display:swap}
@font-face{font-family:"RB Cormorant";src:url(https://fonts.gstatic.com/s/cormorantgaramond/v21/co3bmX5slCNuHLi8bLeY9MK7whWMhyjYqXtK.woff2) format("woff2");font-weight:300 700;font-display:swap}
:root{--bg:#07060A;--panel:#100E0B;--line:#2A251C;--line2:#3B3426;--gold:#C9A227;--gold2:#E9CF83;--text:#EFE8D8;--muted:#9C9380;--bad:#E0674A;--ok:#7CC48A;--live:#FF5A6E;
  --caps:"RB Cinzel",Cinzel,"Times New Roman",serif;--serif:"RB Cormorant","Cormorant Garamond",Georgia,serif;--sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
*{box-sizing:border-box}html{color-scheme:dark}[hidden]{display:none!important}
body{margin:0;min-height:100vh;background:radial-gradient(1200px 600px at 70% -10%,rgba(201,162,39,.10),transparent 60%),var(--bg);color:var(--text);font:15px/1.5 var(--sans)}
a{color:var(--gold2)}
.top{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 28px;border-bottom:1px solid var(--line);flex-wrap:wrap}
.brand{font:600 12px/1 var(--caps);letter-spacing:.32em;color:var(--gold)}.brand b{display:block;margin-top:6px;font:400 11px/1 var(--sans);letter-spacing:.08em;color:var(--muted)}
.back{color:var(--muted);text-decoration:none;font-size:13px;border:1px solid var(--line2);padding:8px 14px;border-radius:999px}
main{max-width:1180px;margin:0 auto;padding:22px 28px 80px}@media (max-width:700px){main,.top{padding-left:16px;padding-right:16px}}
h1{margin:0;font:500 clamp(30px,5vw,44px)/1.05 var(--serif)}.lead{color:var(--muted);max-width:760px;margin:8px 0 0}
.grid{display:grid;gap:14px;margin-top:18px}@media (min-width:900px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.wide{grid-column:1/-1}}
.card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px;min-width:0}
.card h2{margin:0 0 12px;font:600 12px/1 var(--caps);letter-spacing:.24em;color:var(--gold)}.muted{color:var(--muted);font-size:13px}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.mt{margin-top:12px}
label.sw{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--line);cursor:pointer}label.sw:last-of-type{border-bottom:0}
label.sw input{width:20px;height:20px;accent-color:var(--gold)}label.sw span{flex:1}label.sw small{display:block;color:var(--muted);font-size:12px}
input[type=text],input[type=number],textarea{min-width:0;max-width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--line2);background:#0B0A08;color:var(--text);font:inherit}
textarea{width:100%;min-height:64px;resize:vertical}input.num{width:96px}
.btn{appearance:none;border:1px solid var(--gold);background:transparent;color:var(--gold2);border-radius:999px;padding:9px 15px;font:600 13px/1 var(--sans);cursor:pointer;min-height:38px;text-decoration:none;display:inline-flex;align-items:center}
.btn.primary{background:linear-gradient(135deg,#F2D98A,#C9A227);color:#111;border-color:transparent}.btn.sm{min-height:30px;padding:6px 11px;font-size:12px}.btn.bad{border-color:var(--bad);color:var(--bad)}.btn:disabled{opacity:.5;cursor:default}
.nums{display:flex;flex-wrap:wrap;gap:12px 28px}.nums b{display:block;font:700 28px/1 var(--caps);color:var(--gold2)}.nums span{font-size:12px;color:var(--muted)}
.onair{display:flex;gap:14px;align-items:center}.onair .dot{width:12px;height:12px;border-radius:50%;background:var(--gold);box-shadow:0 0 0 4px rgba(201,162,39,.18);flex:none}.onair.live .dot{background:var(--live);box-shadow:0 0 0 4px rgba(255,90,110,.2)}
.onair b{display:block;font:600 20px/1.2 var(--serif);overflow-wrap:anywhere}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{padding:8px 6px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{color:var(--muted);font-weight:500;font-size:12px}
.scroll{overflow-x:auto}.tag{display:inline-block;margin-left:8px;border:1px solid var(--line2);border-radius:999px;padding:2px 8px;font-size:11px;color:var(--muted)}.tag.bad{border-color:var(--bad);color:var(--bad)}.tag.ok{border-color:var(--ok);color:var(--ok)}
.chat li{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--line)}.chat ul{list-style:none;margin:0;padding:0;max-height:420px;overflow:auto}.chat p{margin:0;flex:1;overflow-wrap:anywhere}
.msg{font-size:13px;min-height:1.4em}.msg.bad{color:var(--bad)}.msg.ok{color:var(--ok)}
`;

export function page(nonce, canEdit) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RB World · RB Command</title>
<style nonce="${nonce}">${STYLE}</style></head><body>
<header class="top"><div class="brand">RB COMMAND<b>RB World</b></div><div class="row"><a class="back" href="https://relentlessbillionaire.com/app/world/" target="_blank" rel="noopener">Open RB World ↗</a><a class="back" href="/">← Overview</a></div></header>
<main>
<h1>RB World</h1>
<p class="lead">The 3D city game at relentlessbillionaire.com/app/world (and /game). Switches here reach every player within a minute.${canEdit ? "" : " You can look; changing things needs Badges edit."}</p>
<p class="msg" id="msg" role="status" aria-live="polite"></p>
<div class="grid">
  <section class="card"><h2>Switches</h2>
    <label class="sw"><input type="checkbox" id="s-open"><span>RB World open<small>Off: players see "coming soon" and nothing can be played.</small></span></label>
    <label class="sw"><input type="checkbox" id="s-radio"><span>Car radio<small>RB Radio live in every car: the same song as everyone, and live shows when RB goes on air.</small></span></label>
    <div class="mt"><label for="s-notice" class="muted">Notice for players (when they start, and on the city ticker; up to 200 characters)</label><textarea id="s-notice" maxlength="200" placeholder="For example: Comedy night Friday at 8, see /events"></textarea></div>
    <div class="mt muted">RB Badge points for play time <span id="badge-state"></span></div>
    <div class="row mt"><label class="muted">Points <input class="num" type="number" id="p-block" min="0" max="100"></label><label class="muted">every <input class="num" type="number" id="p-min" min="1" max="1440"> min</label><label class="muted">up to <input class="num" type="number" id="p-day" min="0" max="1000"> a day</label></div>
    <div class="row mt"><button class="btn primary" id="save" type="button">Save switches</button></div>
  </section>
  <section class="card"><h2>On the car radio now</h2>
    <div class="onair" id="onair"><span class="dot"></span><div><b id="r-title">…</b><span class="muted" id="r-artist"></span></div></div>
    <p class="muted mt">The car radio in RB World plays RB Radio, so what's on here is what every driver hears.</p>
    <div class="row"><a class="btn sm" href="/radio-hub">RB Radio hub</a><a class="btn sm" href="https://relentlessbillionaire.com/radio" target="_blank" rel="noopener">Listen ↗</a></div>
  </section>
  <section class="card"><h2>Players</h2>
    <div class="nums"><div><b id="n-online">0</b><span>online now</span></div><div><b id="n-day">0</b><span>today</span></div><div><b id="n-week">0</b><span>this week</span></div><div><b id="n-total">0</b><span>ever</span></div></div>
    <p class="muted mt" id="play-today"></p>
  </section>
  <section class="card"><h2>The city</h2>
    <div class="nums"><div><b id="n-lots">0</b><span>lots owned</span></div><div><b id="n-races">0</b><span>recent races</span></div><div><b id="n-blocked">0</b><span>blocked players</span></div></div>
  </section>
  <section class="card wide"><h2>Richest players (last 30 days)</h2><div class="scroll"><table><thead><tr><th>Player</th><th>Net worth</th><th>Tokens</th><th>K / D</th><th>Last seen</th><th></th></tr></thead><tbody id="top"></tbody></table></div>
    <p class="muted">Net worth is what each player's game reports. Block someone who cheats or abuses chat: they can still drive, but not chat, race or show on the leaderboard.</p></section>
  <section class="card wide chat"><h2>City chat</h2><ul id="chat"></ul></section>
  <section class="card"><h2>Owned lots</h2><div class="scroll"><table><thead><tr><th>Lot</th><th>Owner</th><th>Business</th><th></th></tr></thead><tbody id="lots"></tbody></table></div></section>
  <section class="card"><h2>Races</h2><div class="scroll"><table><thead><tr><th>Track</th><th>Host</th><th>Racers</th><th>When</th></tr></thead><tbody id="races"></tbody></table></div>
    <h2 class="mt">Best times</h2><div class="scroll"><table><tbody id="bests"></tbody></table></div></section>
  <section class="card wide"><h2>Billboards and posters</h2><p class="muted">Live ads from Money &gt; Ads set to Everywhere or RB World only take turns with RB's own on the 11 screens round RB Plaza and the street posters, with a Sponsored label. Up to 8 at a time; a new or paused ad shows in the game within five minutes.</p>
    <div class="scroll"><table><thead><tr><th>On now</th><th>Shows on</th><th>Art</th><th>Ends</th></tr></thead><tbody id="boards"></tbody></table></div>
    <h2 class="mt">In-game views (last 30 days)</h2><div class="scroll"><table><thead><tr><th>Ad</th><th>Views</th><th>Seen 1 s or more</th></tr></thead><tbody id="adviews"></tbody></table></div>
    <p class="muted">Counted when an ad is on a player's screen and close enough to read, at most once per ad every 30 minutes for a player; kept apart from the website's numbers. Clicks from the game count with the ad's other clicks under Ads (tagged utm_content=world for the advertiser).</p></section>
  <section class="card wide"><h2>Blocked players</h2><div class="scroll"><table><thead><tr><th>Player</th><th>Why</th><th>By</th><th>When</th><th></th></tr></thead><tbody id="bans"></tbody></table></div></section>
</div>
</main>
<script nonce="${nonce}">
(function(){
var EDIT = ${canEdit ? "true" : "false"}, D = null;
function $(id){ return document.getElementById(id); }
function el(t, cls, txt){ var e = document.createElement(t); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
function say(t, bad){ var m = $("msg"); m.textContent = t || ""; m.className = "msg" + (t ? (bad ? " bad" : " ok") : ""); }
function fmt(n){ return Number(n || 0).toLocaleString("en-US"); }
function ago(s){ if (!s) return ""; var m = Math.round((Date.now() - Date.parse(s)) / 60000); return m < 1 ? "just now" : m < 60 ? m + " min ago" : m < 1440 ? Math.round(m / 60) + " h ago" : Math.round(m / 1440) + " d ago"; }
function api(path, body){ return fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}).then(function(r){ return r.json().then(function(d){ if (!r.ok || d.ok === false) throw new Error(d.error || d.detail || ("Error " + r.status)); return d; }); }); }
function btn(label, cls, fn){ var b = el("button", "btn sm" + (cls ? " " + cls : ""), label); b.type = "button"; b.disabled = !EDIT; b.addEventListener("click", function(){ b.disabled = true; fn().then(load, function(e){ say(e.message, true); b.disabled = false; }); }); return b; }
function cell(tr, v){ var td = el("td"); if (v instanceof Node) td.appendChild(v); else td.textContent = v == null ? "" : String(v); tr.appendChild(td); return td; }
function empty(tb, cols, t){ var tr = el("tr"), td = el("td", "muted", t); td.colSpan = cols; tr.appendChild(td); tb.appendChild(tr); }
function block(id, name){ var why = prompt("Block " + name + " in RB World? They can still drive, but not chat, race or show on the leaderboard.\\n\\nWhy (optional):", ""); if (why === null) return Promise.reject(new Error("Not blocked.")); return api("/api/world-admin/block", { id: id, name: name, reason: why, delete_chat: confirm("Also delete their chat messages?") }).then(function(){ say("Blocked " + name + "."); }); }
function render(d){
  D = d; var s = d.settings;
  $("s-open").checked = s.open; $("s-radio").checked = s.radio; $("s-notice").value = s.notice;
  $("p-block").value = s.points.block; $("p-min").value = s.points.minutes; $("p-day").value = s.points.daily;
  $("badge-state").textContent = s.badge_on ? "(RB Badge is on, so these count)" : "(RB Badge is off, so these don't count yet)";
  ["s-open","s-radio","s-notice","p-block","p-min","p-day","save"].forEach(function(id){ $(id).disabled = !EDIT; });
  var r = d.radio, oa = $("onair"); oa.classList.toggle("live", !!(r && r.live));
  $("r-title").textContent = !r ? "RB Radio can't be reached right now" : r.live ? "LIVE: " + r.title : (r.title || "Getting the next song ready");
  $("r-artist").textContent = r ? (r.artist || "") : "";
  $("n-online").textContent = fmt(d.players.online); $("n-day").textContent = fmt(d.players.day); $("n-week").textContent = fmt(d.players.week); $("n-total").textContent = fmt(d.players.total);
  $("play-today").textContent = d.play_today.members ? "Signed-in players today: " + fmt(d.play_today.members) + ", " + fmt(d.play_today.minutes) + " minutes, " + fmt(d.play_today.points) + " RB Badge points." : "No signed-in play today yet.";
  $("n-lots").textContent = d.lots.owned + " / " + d.lots.total; $("n-races").textContent = fmt(d.races.length); $("n-blocked").textContent = fmt(d.bans.length);
  var tb = $("top"); tb.textContent = ""; if (!d.players.top.length) empty(tb, 6, "No players in the last 30 days.");
  d.players.top.forEach(function(p){ var tr = el("tr"), nm = el("span", null, p.name); if (p.account) nm.appendChild(el("span", "tag ok", "RB account")); if (p.blocked) nm.appendChild(el("span", "tag bad", "blocked"));
    cell(tr, nm); cell(tr, "$" + fmt(p.net_worth)); cell(tr, fmt(p.tokens)); cell(tr, fmt(p.kills) + " / " + fmt(p.deaths)); cell(tr, ago(p.seen_at));
    cell(tr, p.blocked ? btn("Unblock", "", function(){ return api("/api/world-admin/unblock", { id: p.id }); }) : btn("Block", "bad", function(){ return block(p.id, p.name); })); tb.appendChild(tr); });
  var ul = $("chat"); ul.textContent = ""; if (!d.chat.length) ul.appendChild(el("li", "muted", "No chat yet."));
  d.chat.forEach(function(m){ var li = el("li"), p = el("p"); p.appendChild(el("b", null, m.name + ": ")); p.appendChild(document.createTextNode(m.text)); p.appendChild(el("span", "muted", "  " + ago(m.created_at)));
    li.appendChild(p); li.appendChild(btn("Delete", "", function(){ return api("/api/world-admin/chat-delete", { n: m.n }).then(function(){ say("Message deleted."); }); }));
    if (!m.blocked) li.appendChild(btn("Block", "bad", function(){ return block(m.player_id, m.name); })); ul.appendChild(li); });
  var lt = $("lots"); lt.textContent = ""; if (!d.lots.list.length) empty(lt, 4, "Every lot is for sale.");
  d.lots.list.forEach(function(l){ var tr = el("tr"); cell(tr, "#" + l.lot + (l.title ? " " + l.title : "")); cell(tr, l.owner_name || ""); cell(tr, (l.business || "") + (l.level ? " (level " + l.level + ")" : ""));
    cell(tr, btn("Release", "", function(){ return confirm("Put lot #" + l.lot + " back on sale? " + (l.owner_name || "The owner") + " loses it.") ? api("/api/world-admin/lot-release", { lot: l.lot }).then(function(){ say("Lot #" + l.lot + " is for sale again."); }) : Promise.reject(new Error("Kept.")); })); lt.appendChild(tr); });
  var rt = $("races"); rt.textContent = ""; if (!d.races.length) empty(rt, 4, "No races yet.");
  d.races.forEach(function(r){ var tr = el("tr"); cell(tr, r.track); cell(tr, r.solo ? "Solo" : (r.host_name || "")); cell(tr, r.finished + " of " + r.racers + " finished"); cell(tr, ago(new Date(Number(r.start_at)).toISOString())); rt.appendChild(tr); });
  var bt = $("bests"); bt.textContent = ""; if (!d.bests.length) empty(bt, 3, "No best times yet.");
  d.bests.forEach(function(b){ var tr = el("tr"); cell(tr, b.track); cell(tr, b.name); cell(tr, (b.ms / 1000).toFixed(2) + " s"); bt.appendChild(tr); });
  var bb = $("boards"); bb.textContent = ""; if (!d.billboards.live.length) empty(bb, 4, "No sponsor ads on the billboards: RB's own show. Add one under Money > Ads and set Shows on to Everywhere or RB World only.");
  d.billboards.live.forEach(function(a){ var tr = el("tr"), nm = el("span", null, a.advertiser || ("Ad #" + a.id)); if (a.headline) nm.appendChild(el("span", "muted", "  " + a.headline));
    cell(tr, nm); cell(tr, a.surface === "world" ? "RB World only" : "Everywhere"); cell(tr, a.video ? "Video" : a.image ? "Image" : "Words only"); cell(tr, a.ends_at ? String(a.ends_at).slice(0, 10) : "No end date"); bb.appendChild(tr); });
  var av = $("adviews"); av.textContent = ""; if (!d.billboards.stats.length) empty(av, 3, "No in-game views yet.");
  d.billboards.stats.forEach(function(a){ var tr = el("tr"), nm = el("span", null, a.advertiser); if (a.status !== "live") nm.appendChild(el("span", "tag", a.status));
    cell(tr, nm); cell(tr, fmt(a.views)); cell(tr, fmt(a.viewable)); av.appendChild(tr); });
  var bn = $("bans"); bn.textContent = ""; if (!d.bans.length) empty(bn, 5, "Nobody is blocked.");
  d.bans.forEach(function(b){ var tr = el("tr"); cell(tr, b.name || b.id); cell(tr, b.reason || ""); cell(tr, b.by || ""); cell(tr, ago(b.created_at)); cell(tr, btn("Unblock", "", function(){ return api("/api/world-admin/unblock", { id: b.id }).then(function(){ say("Unblocked."); }); })); bn.appendChild(tr); });
}
function load(){ return api("/api/world-admin").then(render).catch(function(e){ say(e.message, true); }); }
$("save").addEventListener("click", function(){ var b = this; b.disabled = true;
  api("/api/world-admin/settings", { open: $("s-open").checked, radio: $("s-radio").checked, notice: $("s-notice").value, points: { block: Number($("p-block").value), minutes: Number($("p-min").value), daily: Number($("p-day").value) } })
    .then(function(r){ say(r.changed.length ? "Saved: " + r.changed.join(", ") + "." : "Nothing changed."); return load(); }, function(e){ say(e.message, true); }).then(function(){ b.disabled = !EDIT; }); });
load(); setInterval(function(){ if (!document.hidden) load(); }, 30000);
})();
</script></body></html>`;
}
