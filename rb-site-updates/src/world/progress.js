// RB World progress: what keeps people coming back in the best-loved games, all in game money.
//   Levels and XP from everything you do · a daily login reward with a 7-day streak · three daily quests ·
//   achievements · a first-time tutorial · street races (time trials through checkpoint gates, best times kept).
// Listens to empire.js events; saved in this browser (rb_progress_v1).
import * as THREE from "three";
import { on } from "./empire.js";
import { HALF, ROAD, PITCH } from "./empire_defs.js";

const SAVE = "rb_progress_v1";
let E = null, C = null;
const P = { xp: 0, level: 1, daily: { last: "", streak: 0 }, quests: { day: "", list: [] }, ach: {}, tut: 0, races: {}, dist: 0, counts: {} };
const today = () => new Date().toLocaleDateString("en-CA");
const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
function load() { try { Object.assign(P, JSON.parse(localStorage.getItem(SAVE) || "{}")); } catch (e) {} P.counts ||= {}; P.ach ||= {}; P.races ||= {}; }
function save() { try { localStorage.setItem(SAVE, JSON.stringify(P)); } catch (e) {} }
const count = (k, n = 1) => { P.counts[k] = (P.counts[k] || 0) + n; };

// ---------------------------------------------------------------- levels
const need = (lvl) => Math.round(250 * Math.pow(lvl, 1.45));
function xp(n, why) {
  if (!(n > 0)) return;
  P.xp += n;
  while (P.xp >= need(P.level)) {
    P.xp -= need(P.level); P.level++;
    const cash = 2000 * P.level, tok = 10 * P.level;
    C.player.netWorth += cash; C.player.tokens += tok; C.sync(); C.play("cash");
    celebrate(`LEVEL ${P.level}`, `+${money(cash)} · +${tok} tokens`);
    check();
  }
  renderBadge(); save();
}
function renderBadge() {
  const el = document.getElementById("rb-level");
  if (!el) return;
  const pct = Math.round((P.xp / need(P.level)) * 100);
  el.innerHTML = `<b>LV ${P.level}</b><span><i style="width:${pct}%"></i></span>`;
  el.title = `${P.xp} / ${need(P.level)} XP to level ${P.level + 1}`;
}
function celebrate(title, sub) {
  const d = document.createElement("div"); d.className = "rb-celebrate";
  d.innerHTML = `<b>${title}</b><span>${sub}</span>`;
  for (let i = 0; i < 26; i++) { const c = document.createElement("i"); c.style.cssText = `left:${50 + (Math.random() - 0.5) * 70}%;background:${["#C9A84C", "#F5E6A3", "#00E676", "#00BFFF", "#E05AA8"][i % 5]};animation-delay:${Math.random() * 0.3}s;--dx:${(Math.random() - 0.5) * 300}px`; d.appendChild(c); }
  document.body.appendChild(d); setTimeout(() => d.remove(), 2600);
}

// ---------------------------------------------------------------- achievements
const ACH = [
  { k: "first_lot", n: "Landlord", d: "Buy your first lot", t: () => (P.counts.buy || 0) >= 1 },
  { k: "first_biz", n: "Open for business", d: "Build your first business", t: () => (P.counts.build || 0) >= 1 },
  { k: "five_star", n: "Five stars", d: "Upgrade a business to ★★★★★", t: () => (P.counts.maxlvl || 0) >= 1 },
  { k: "monopoly", n: "Monopoly", d: "Own a whole district", t: () => (P.counts.set || 0) >= 1 },
  { k: "tycoon", n: "Tycoon", d: "Own 8 lots at once", t: () => E.radar && LOTS_MINE() >= 8 },
  { k: "hustler", n: "Hustler", d: "Finish 10 jobs", t: () => (P.counts.job || 0) >= 10 },
  { k: "heist", n: "The big score", d: "Pull off a heist", t: () => (P.counts.heist || 0) >= 1 },
  { k: "ghost", n: "Ghost", d: "Lose the cops", t: () => (P.counts.escaped || 0) >= 1 },
  { k: "collector", n: "Collector", d: "Collect 50 drops", t: () => (P.counts.drop || 0) >= 50 },
  { k: "explorer", n: "Out and about", d: "Collect a drop where you really are", t: () => (P.counts.gps || 0) >= 1 },
  { k: "legend", n: "Legendary find", d: "Find a Legendary talent card", t: () => (P.counts.legendary || 0) >= 1 },
  { k: "racer", n: "Street racer", d: "Finish a street race", t: () => (P.counts.race || 0) >= 1 },
  { k: "speed", n: "Speed demon", d: "Hit 150 km/h", t: () => (P.counts.topspeed || 0) >= 150 },
  { k: "road", n: "Road trip", d: "Drive 25 km in all", t: () => P.dist >= 25000 },
  { k: "millionaire", n: "Millionaire", d: "Reach $1,000,000 net worth", t: () => C.player.netWorth >= 1e6 },
  { k: "streak", n: "Regular", d: "Claim the daily reward 7 days in a row", t: () => P.daily.streak >= 7 },
  { k: "lvl10", n: "Big shot", d: "Reach level 10", t: () => P.level >= 10 },
  { k: "billion", n: "Billionaire", d: "Reach $1,000,000,000", t: () => C.player.netWorth >= 1e9 },
];
function LOTS_MINE() { const R = E.radar(); return Object.keys(R.lots).filter((id) => R.lots[id] && R.lots[id].owner_id === C.player.id).length; }
function check() {
  for (const a of ACH) if (!P.ach[a.k] && a.t()) { P.ach[a.k] = Date.now(); celebrate("🏆 " + a.n, a.d); xp(150); }
  save();
}

// ---------------------------------------------------------------- daily reward and quests
const DAILY = [
  { cash: 2000, tok: 0, txt: "$2,000" }, { cash: 3000, tok: 10, txt: "$3,000 + 10 💎" }, { card: "rare", txt: "Rare talent 🃏" },
  { cash: 6000, tok: 15, txt: "$6,000 + 15 💎" }, { card: "rare", cash: 4000, txt: "Rare 🃏 + $4,000" }, { cash: 10000, tok: 50, txt: "$10,000 + 50 💎" },
  { card: "epic", cash: 25000, txt: "Epic 🃏 + $25,000" },
];
function dailyDue() { return P.daily.last !== today(); }
function claimDaily() {
  const y = new Date(Date.now() - 864e5).toLocaleDateString("en-CA");
  P.daily.streak = P.daily.last === y ? P.daily.streak + 1 : 1;
  P.daily.last = today();
  const r = DAILY[(P.daily.streak - 1) % 7];
  if (r.cash) C.player.netWorth += r.cash; if (r.tok) C.player.tokens += r.tok;
  if (r.card) E.giveCard(r.card);
  C.sync(); C.play("cash"); celebrate(`DAY ${P.daily.streak}`, r.txt); xp(50); check(); save();
}
const QUESTS = [
  { k: "income", n: (g) => `Earn ${money(g)} from your businesses`, goal: () => 5000 * Math.max(1, Math.round(P.level / 2)), cash: 4000 },
  { k: "job", n: (g) => `Finish ${g} jobs`, goal: () => 3, cash: 5000 },
  { k: "drop", n: (g) => `Collect ${g} drops`, goal: () => 8, cash: 3000 },
  { k: "km", n: (g) => `Drive ${g} km`, goal: () => 3, cash: 3000 },
  { k: "race", n: () => `Finish a street race`, goal: () => 1, cash: 6000 },
  { k: "escaped", n: () => `Lose the cops`, goal: () => 1, cash: 6000 },
  { k: "upgrade", n: () => `Upgrade a business`, goal: () => 1, cash: 5000 },
  { k: "buy", n: () => `Buy a lot`, goal: () => 1, cash: 4000 },
];
function rollQuests() {
  if (P.quests.day === today()) return;
  const pool = QUESTS.slice().sort(() => Math.random() - 0.5).slice(0, 3);
  P.quests = { day: today(), list: pool.map((q) => ({ k: q.k, goal: q.goal(), have: 0, done: false, cash: q.cash })) };
  save();
}
function quest(k, n = 1) {
  rollQuests();
  for (const q of P.quests.list) if (q.k === k && !q.done) {
    q.have = Math.min(q.goal, q.have + n);
    if (q.have >= q.goal) { q.done = true; C.player.netWorth += q.cash; C.sync(); C.play("cash"); celebrate("QUEST DONE", `${QUESTS.find((x) => x.k === q.k).n(q.goal)} · +${money(q.cash)}`); xp(120); }
  }
  renderTracker(); save();
}
function renderTracker() {
  const el = document.getElementById("rb-tracker"); if (!el) return;
  if (P.tut < TUT.length) { el.innerHTML = `<b>TUTORIAL ${P.tut + 1}/${TUT.length}</b> ${TUT[P.tut].t} <a href="#" id="rb-tut-skip">skip</a>`; el.style.display = "block"; const s = document.getElementById("rb-tut-skip"); if (s) s.onclick = (e) => { e.preventDefault(); P.tut = TUT.length; save(); renderTracker(); }; return; }
  const q = (P.quests.list || []).find((x) => !x.done);
  if (!q) { el.style.display = "none"; return; }
  const def = QUESTS.find((x) => x.k === q.k);
  el.style.display = "block";
  el.innerHTML = `<b>QUEST</b> ${def.n(q.goal)} · ${q.k === "income" ? money(q.have) + " / " + money(q.goal) : q.k === "km" ? q.have.toFixed(1) + " / " + q.goal : q.have + " / " + q.goal}`;
}
function openGoals(tab = "quests") {
  rollQuests();
  const tabs = `<div style="display:flex;gap:6px;margin-bottom:10px">${["quests", "daily", "achievements", "races"].map((t) => `<button class="${t === tab ? "btn-gold" : "btn-ghost"}" style="flex:1;margin:0;padding:8px 4px;font-size:9px" data-e="t_${t}">${t.toUpperCase()}</button>`).join("")}</div>`;
  let body = "";
  if (tab === "quests") body = P.quests.list.map((q) => { const d = QUESTS.find((x) => x.k === q.k); return `<div class="rb-card"><div><b>${q.done ? "✅ " : ""}${d.n(q.goal)}</b><div class="rb-bar" style="margin-top:6px"><i style="width:${Math.round((q.have / q.goal) * 100)}%;background:#00E676"></i></div></div><b style="color:var(--green)">${money(q.cash)}</b></div>`; }).join("") + `<div class="rb-muted">New quests every day at midnight.</div>`;
  if (tab === "daily") body = `<div class="rb-row" style="flex-wrap:wrap;gap:6px">${DAILY.map((r, i) => { const n = (P.daily.streak % 7) || (P.daily.last ? 7 : 0), got = dailyDue() ? i < (P.daily.last === new Date(Date.now() - 864e5).toLocaleDateString("en-CA") ? n % 7 : 0) : i < n; return `<div class="rb-card" style="flex:1 1 30%;flex-direction:column;align-items:flex-start;margin:0;${got ? "opacity:.45" : ""}"><b>DAY ${i + 1}</b><span class="rb-muted">${r.txt}</span></div>`; }).join("")}</div>
    ${dailyDue() ? `<button class="btn-gold" data-e="claim">CLAIM TODAY'S REWARD</button>` : `<div class="rb-muted">Come back tomorrow for day ${(P.daily.streak % 7) + 1}. Streak: ${P.daily.streak} day${P.daily.streak === 1 ? "" : "s"}.</div>`}`;
  if (tab === "achievements") body = ACH.map((a) => `<div class="rb-card ${P.ach[a.k] ? "" : "rb-off"}"><div><b>${P.ach[a.k] ? "🏆" : "🔒"} ${a.n}</b><div class="rb-muted">${a.d}</div></div></div>`).join("");
  if (tab === "races") body = RACES.map((r, i) => `<div class="rb-card"><div><b>🏁 ${r.name}</b><div class="rb-muted">${r.cps.length} checkpoints · par ${r.par}s · best ${P.races[r.key] ? P.races[r.key].toFixed(2) + "s" : "none yet"}</div></div><button class="rb-btn" data-e="race_${i}">RACE</button></div>`).join("");
  const acts = { close: E.hidePanel, claim: () => { claimDaily(); openGoals("daily"); } };
  ["quests", "daily", "achievements", "races"].forEach((t) => { acts["t_" + t] = () => openGoals(t); });
  RACES.forEach((r, i) => { acts["race_" + i] = () => { E.hidePanel(); startRace(r); }; });
  E.panel(`<h2>📋 GOALS · LEVEL ${P.level}</h2><div class="subtitle">${P.xp} / ${need(P.level)} XP to level ${P.level + 1}. Every level pays out.</div>${tabs}${body}<button class="btn-ghost" data-e="close">CLOSE</button>`, acts);
}

// ---------------------------------------------------------------- tutorial
const TUT = [
  { t: "Drive 150 m: W / arrows, or the stick and GAS.", k: "km", n: 0.15 },
  { t: "Drive through a 💰 💎 or 🃏 drop.", k: "drop" },
  { t: "Stop next to a FOR SALE sign and BUY a lot.", k: "buy" },
  { t: "Build a business on your lot (a Food Truck is cheap).", k: "build" },
  { t: "Tap 🔥 and finish a job.", k: "job" },
];
let tutKm = 0;
function tut(k, n = 1) {
  if (P.tut >= TUT.length) return;
  const s = TUT[P.tut];
  if (s.k !== k) return;
  if (k === "km") { tutKm += n; if (tutKm < s.n) return; }
  P.tut++; C.play("cash");
  if (P.tut >= TUT.length) { C.player.netWorth += 10000; C.sync(); celebrate("TUTORIAL DONE", "+$10,000 to grow your empire"); xp(200); }
  else E.toast(`✅ Next: ${TUT[P.tut].t}`);
  renderTracker(); save();
}

// ---------------------------------------------------------------- street races
const L = (i) => -HALF - ROAD / 2 + i * PITCH; // road line i
const RACES = [
  { key: "loop", name: "Plaza Loop", par: 38, cps: [[L(2), L(1)], [L(4), L(1)], [L(4), L(5)], [L(2), L(5)], [L(2), L(3)]] },
  { key: "ring", name: "City Ring", par: 62, cps: [[L(0), L(0)], [L(6), L(0)], [L(6), L(6)], [L(0), L(6)], [L(0), L(3)]] },
  { key: "zig", name: "Downtown Zigzag", par: 55, cps: [[L(1), L(0)], [L(1), L(2)], [L(3), L(2)], [L(3), L(4)], [L(5), L(4)], [L(5), L(6)]] },
];
let race = null, gates = [];
function clearGates() { gates.forEach((g) => C.scene.remove(g)); gates = []; window.__rbRaceTarget = null; }
function startRace(r) {
  clearGates();
  gates = r.cps.map((p, i) => { const g = new THREE.Mesh(new THREE.TorusGeometry(5.5, 0.45, 8, 32), new THREE.MeshBasicMaterial({ color: i === r.cps.length - 1 ? 0x00E676 : 0xF5D547, transparent: true, opacity: 0.85 })); g.position.set(p[0], 5.5, p[1]); C.scene.add(g); return g; });
  race = { r, i: 0, t: -3, t0: performance.now() + 3000, started: false };
  window.__rbRaceTarget = r.cps[0];
  E.toast(`🏁 ${r.name}: ${r.cps.length} checkpoints. Par ${r.par}s. Ready…`);
}
function raceTick(dt) {
  if (!race) return;
  race.t = (performance.now() - race.t0) / 1000; // real time, not the capped frame step
  const el = document.getElementById("rb-race");
  el.style.display = "block";
  if (race.t < 0) { el.innerHTML = `<b>${Math.ceil(-race.t)}</b>`; return; }
  if (!race.started) { race.started = true; C.play("alert"); }
  const car = E.radar().car, p = race.r.cps[race.i];
  gates.forEach((g, i) => { g.rotation.y += dt; g.visible = i >= race.i; g.material.opacity = i === race.i ? 0.95 : 0.3; });
  el.innerHTML = `<b>${race.t.toFixed(1)}s</b><span>CHECKPOINT ${race.i + 1}/${race.r.cps.length} · par ${race.r.par}s${P.races[race.r.key] ? " · best " + P.races[race.r.key].toFixed(2) + "s" : ""}</span>`;
  if (Math.hypot(car.x - p[0], car.z - p[1]) < 7) {
    race.i++; C.play("cash");
    if (race.i >= race.r.cps.length) return finishRace();
    window.__rbRaceTarget = race.r.cps[race.i];
  }
  if (race.t > race.r.par * 3) { E.toast("Race timed out.", true); race = null; clearGates(); el.style.display = "none"; }
}
function finishRace() {
  const r = race.r, time = race.t, best = P.races[r.key], pb = !best || time < best;
  if (pb) P.races[r.key] = time;
  const prize = Math.round((time <= r.par ? 8000 : 3000) * (pb ? 1.5 : 1));
  C.player.netWorth += prize; C.sync();
  celebrate(time <= r.par ? "🏁 UNDER PAR!" : "🏁 FINISHED", `${time.toFixed(2)}s${pb ? " · new best" : ""} · +${money(prize)}`);
  count("race"); quest("race"); xp(time <= r.par ? 180 : 100); check();
  race = null; clearGates(); document.getElementById("rb-race").style.display = "none"; save();
}

// ---------------------------------------------------------------- start
export function initProgress(empire, ctx) {
  E = empire; C = ctx; load(); rollQuests();
  const s = document.createElement("style");
  s.textContent = `#rb-level{position:fixed;z-index:7000;left:12px;display:flex;align-items:center;gap:8px;background:rgba(0,0,0,.8);border:1px solid var(--gold);border-radius:999px;padding:5px 10px 5px 8px;font:900 11px Orbitron,Inter,sans-serif;color:#F5E6A3;cursor:pointer}
#rb-level span{width:70px;height:6px;border-radius:4px;background:rgba(255,255,255,.1);overflow:hidden}#rb-level i{display:block;height:100%;background:linear-gradient(90deg,#C9A84C,#F5E6A3)}
#rb-tracker{position:fixed;z-index:7000;left:50%;transform:translateX(-50%);display:none;max-width:min(92vw,520px);background:rgba(0,0,0,.82);border:1px solid rgba(0,230,118,.5);border-radius:12px;padding:7px 12px;font:600 11px/1.3 Inter,sans-serif;color:#fff;text-align:center}#rb-tracker b{color:var(--green);margin-right:6px;font-size:10px;letter-spacing:1px}#rb-tracker a{color:rgba(255,255,255,.5);margin-left:8px}
#rb-race{position:fixed;z-index:7600;left:50%;transform:translateX(-50%);top:40%;display:none;text-align:center;pointer-events:none;text-shadow:0 2px 10px #000}#rb-race b{display:block;font:900 44px Orbitron,Inter,sans-serif;color:#F5E6A3}#rb-race span{font:800 11px Inter,sans-serif;color:#fff;letter-spacing:1px}
.rb-celebrate{position:fixed;inset:0;z-index:9500;pointer-events:none;display:flex;flex-direction:column;align-items:center;justify-content:center;animation:rbcel 2.6s ease forwards}.rb-celebrate b{font:900 clamp(30px,7vw,56px) Orbitron,Inter,sans-serif;color:#F5E6A3;text-shadow:0 0 30px rgba(201,168,76,.8)}.rb-celebrate span{font:800 14px Inter,sans-serif;color:#fff;margin-top:6px}
.rb-celebrate i{position:absolute;top:45%;width:8px;height:14px;border-radius:2px;animation:rbconf 1.8s ease-out forwards}
body:has(#ov-empire[style*="flex"]) #rb-tracker,body:has(#ov-empire[style*="flex"]) #rb-race,body:has(#ov-empire[style*="flex"]) #rb-radar,body:has(#ov-empire[style*="flex"]) #rb-level,body:has(#ov-empire[style*="flex"]) #rb-badge-chip,body:has(#ov-empire[style*="flex"]) .rb-pedals,body:has(#ov-empire[style*="flex"]) .rb-ctx,body:has(#ov-empire[style*="flex"]) .rb-chip,body:has(#ov-empire[style*="flex"]) .rb-joy,body:has(#ov-empire[style*="flex"]) .rb-wanted{display:none!important}
@media (max-width:640px){#rb-tracker{left:12px;transform:none;max-width:calc(100vw - 172px);text-align:left;font-size:10px}}
@keyframes rbcel{0%{opacity:0;transform:scale(.8)}12%{opacity:1;transform:scale(1)}80%{opacity:1}100%{opacity:0}}@keyframes rbconf{to{transform:translate(var(--dx),60vh) rotate(720deg);opacity:0}}`;
  document.head.appendChild(s);
  const lv = document.createElement("div"); lv.id = "rb-level"; lv.onclick = () => openGoals("quests"); document.body.appendChild(lv);
  const tr = document.createElement("div"); tr.id = "rb-tracker"; document.body.appendChild(tr);
  const rc = document.createElement("div"); rc.id = "rb-race"; document.body.appendChild(rc);
  const place = () => {
    const st = document.getElementById("hud-stats"), top = st ? Math.round(st.getBoundingClientRect().bottom) + 10 : 120;
    const lt = top + 4 * 26 + 4; lv.style.top = lt + "px"; tr.style.top = (innerWidth <= 640 ? lt + 34 : top) + "px";
  };
  place(); window.addEventListener("resize", place); setInterval(place, 3000);
  const ctr = document.getElementById("controls");
  const add = (id, icon, title, fn) => { const b = document.createElement("button"); b.className = "ctrl-btn"; b.id = id; b.textContent = icon; b.title = title; b.setAttribute("aria-label", title); b.onclick = fn; ctr.insertBefore(b, ctr.children[2] || null); };
  add("btn-goals", "📋", "Goals: quests, daily reward, achievements, races", () => openGoals("quests"));
  add("btn-race", "🏁", "Street race", () => openGoals("races"));
  // what counts for what
  on("job", (d) => { count("job"); if (d.kind === "heist") count("heist"); quest("job"); tut("job"); xp(d.kind === "heist" ? 160 : 70); check(); });
  on("drop", (d) => { count("drop"); if (d.source === "gps") count("gps"); quest("drop"); tut("drop"); xp(d.source === "gps" ? 30 : 10); check(); });
  on("card", (c) => { if (c.rarity === "legendary") count("legendary"); xp({ common: 10, rare: 25, epic: 60, legendary: 150 }[c.rarity] || 10); check(); });
  on("buy", () => { count("buy"); quest("buy"); tut("buy"); xp(80); check(); });
  on("build", () => { count("build"); tut("build"); xp(120); check(); });
  on("upgrade", (lvl) => { quest("upgrade"); if (lvl >= 5) count("maxlvl"); xp(60 * lvl); check(); });
  on("set", () => { count("set"); xp(500); check(); });
  on("escaped", () => { count("escaped"); quest("escaped"); xp(120); check(); });
  let incomeXp = 0;
  on("income", (v) => { quest("income", v); incomeXp += v; if (incomeXp >= 500) { xp(Math.floor(incomeXp / 500)); incomeXp %= 500; } });
  let distAcc = 0, chk = 0;
  on("frame", (dt) => {
    const car = E.radar().car, d = Math.abs(car.speed) * dt;
    P.dist += d; distAcc += d;
    const kmh = Math.abs(car.speed) * 3.6; if (kmh > (P.counts.topspeed || 0)) P.counts.topspeed = Math.round(kmh);
    if (distAcc > 100) { quest("km", distAcc / 1000); tut("km", distAcc / 1000); distAcc = 0; }
    raceTick(dt);
    chk += dt; if (chk > 5) { chk = 0; check(); }
  });
  on("race-key", () => openGoals("races"));
  renderBadge(); renderTracker();
  // the daily reward, once help (first visit) or any other panel is out of the way
  const tryDaily = () => { const busy = document.getElementById("ov-empire")?.style.display === "flex"; if (!dailyDue()) return; if (busy) return setTimeout(tryDaily, 4000); openGoals("daily"); };
  setTimeout(tryDaily, 7000);
  return { openGoals, state: P };
}
