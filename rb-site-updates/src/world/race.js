// RB World multiplayer: street races against other players, everyone's cars in the city, and the live leaderboard.
//   Races: host one (others in the city get an invite and have RACE_LOBBY_S to join), or run a solo time trial. The
//   server keeps the clock and checks every checkpoint (world-worker.js), so the record board holds real times.
//   On the track: a starting grid, countdown lights, checkpoint rings, an arrow to the next one, nitro canisters,
//   a slipstream behind other racers, live positions, and a podium at the end. Prizes are game money only.
//   In the city: other players' cars with their name and level, and a live leaderboard (net worth, level, lots, records).
//   Paint shop: colours for your car (some unlock with your level); others see your colour.
import * as THREE from "three";
import { on, makeCar } from "./empire.js";
import { api, onBeat, beatExtra } from "./rb_world.js";
import { RACE_TRACKS, RACE_PRIZES, RACE_MAX, raceTrack } from "./empire_defs.js";

let E = null, C = null, G = null;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
const secs = (ms) => (ms / 1000).toFixed(2) + "s";
const BEST = "rb_race_best_v1", PAINT = "rb_paint_v1";
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
const keep = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const best = load(BEST, {});
const level = () => (G && G.state && G.state.level) || 1;

// ---------------------------------------------------------------- paint shop
const PAINTS = [
  { k: "gold", n: "RB Gold", c: "#C9A84C", lv: 1 }, { k: "black", n: "Midnight", c: "#15171c", lv: 1 }, { k: "white", n: "Pearl", c: "#e9e6df", lv: 1 },
  { k: "red", n: "Rosso", c: "#d42a2a", lv: 2 }, { k: "blue", n: "Royal Blue", c: "#2F55D4", lv: 3 }, { k: "green", n: "Money Green", c: "#2EB872", lv: 4 },
  { k: "pink", n: "Arts Pink", c: "#E05AA8", lv: 5 }, { k: "cyan", n: "Ice", c: "#7FD3F7", lv: 6 }, { k: "orange", n: "Sunset", c: "#F39C34", lv: 8 },
  { k: "violet", n: "Velvet", c: "#9B59B6", lv: 10 },
];
let paint = load(PAINT, "gold");
function paintHex() { return (PAINTS.find((p) => p.k === paint) || PAINTS[0]).c; }
function applyPaint() {
  const u = E.car.mesh && E.car.mesh.userData;
  if (u && u.paint) { u.paint.color.set(paintHex()); if (u.paint.emissiveIntensity > 0) u.paint.emissive.set(paintHex()); }
}

// ---------------------------------------------------------------- other players' cars
const ghosts = new Map(); // id -> { mesh, label, x, z, h, s, at, tx, tz, racer, name, level }
function label(text, sub) {
  const cv = document.createElement("canvas"); cv.width = 256; cv.height = 72;
  const g = cv.getContext("2d");
  g.fillStyle = "rgba(0,0,0,.7)"; g.beginPath(); g.roundRect(4, 6, 248, 60, 14); g.fill();
  g.strokeStyle = "#C9A84C"; g.lineWidth = 2; g.stroke();
  g.fillStyle = "#F5E6A3"; g.font = "bold 26px Inter, sans-serif"; g.textAlign = "center"; g.fillText(text.slice(0, 16), 128, 36);
  g.fillStyle = "#fff"; g.font = "bold 16px Inter, sans-serif"; g.fillText(sub, 128, 58);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true }));
  s.scale.set(4.2, 1.2, 1); s.position.y = 3.6; s.renderOrder = 10;
  return s;
}
function ghost(id, name, lvl, color) {
  let g = ghosts.get(id);
  if (!g) {
    const mesh = makeCar(color ? new THREE.Color(color).getHex() : 0xbfc4cc, false, false, "sport");
    g = { mesh, name, level: lvl, color, x: 0, z: 0, h: 0, s: 0, at: 0, fresh: true };
    g.label = label(name, `LV ${lvl}`); mesh.add(g.label);
    ghosts.set(id, g);
  }
  if (g.name !== name || g.level !== lvl) { g.mesh.remove(g.label); g.label = label(name, `LV ${lvl}`); g.mesh.add(g.label); g.name = name; g.level = lvl; }
  if (color && g.color !== color) { g.color = color; g.mesh.userData.paint.color.set(color); }
  return g;
}
function seeGhost(id, name, lvl, color, car, racer) {
  if (!car) return;
  const g = ghost(id, name, lvl, color);
  Object.assign(g, { tx: car[0], tz: car[1], h: car[2], s: car[3], at: performance.now(), racer: !!racer });
  if (g.fresh) { g.x = car[0]; g.z = car[1]; g.fresh = false; }
}
function dropGhost(id) { const g = ghosts.get(id); if (g) { C.scene.remove(g.mesh); ghosts.delete(id); } }
function ghostsTick(dt) {
  const now = performance.now();
  for (const [id, g] of ghosts) {
    const age = Math.min(1.5, (now - g.at) / 1000);
    // where it should be by now (heading and speed from its last report), eased towards so it doesn't jump
    const px = g.tx + Math.sin(g.h) * g.s * age, pz = g.tz + Math.cos(g.h) * g.s * age;
    const k = Math.min(1, dt * 6);
    g.x += (px - g.x) * k; g.z += (pz - g.z) * k;
    g.mesh.position.set(g.x, 0, g.z);
    let dh = g.h - g.mesh.rotation.y; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); g.mesh.rotation.y += dh * k;
    for (const w of g.mesh.userData.wheels) w.w.rotation.x += g.s * dt / (g.mesh.userData.wheelR || 0.48);
    if (now - g.at > 25000) dropGhost(id);
  }
  window.__rbGhosts = [...ghosts.values()].map((g) => ({ x: g.x, z: g.z, racer: g.racer }));
}

// ---------------------------------------------------------------- the live leaderboard
const B = { tab: "worth", data: { worth: [], level: [], lots: [] }, records: {}, recTrack: 0, prev: {}, online: new Set(), races: [] };
function boardRows() {
  const me = C.player.id;
  if (B.tab === "records") {
    const t = RACE_TRACKS[B.recTrack], r = B.records[t.key];
    const rows = r ? r.top.map((x, i) => ({ id: x.id, name: x.name, v: secs(x.ms), i })) : [];
    return { title: `🏁 ${t.name}`, rows, foot: r && r.you && !r.top.some((x) => x.you) ? `You · #${r.you.rank} · ${secs(r.you.ms)}` : !r ? "Loading…" : !rows.length ? "No times yet: be the first." : "" };
  }
  const list = B.data[B.tab] || [];
  const v = { worth: (u) => (u.netWorth >= 1e6 ? "$" + (u.netWorth / 1e6).toFixed(1) + "M" : "$" + Math.floor(u.netWorth / 1000) + "k"), level: (u) => "LV " + u.level, lots: (u) => u.lots + " lot" + (u.lots === 1 ? "" : "s") }[B.tab];
  const rows = list.map((u, i) => ({ id: u.id, name: u.name, v: v(u), i }));
  const mine = rows.find((r) => r.id === me);
  const foot = mine ? "" : B.tab === "worth" ? `You · ${money(C.player.netWorth)}` : B.tab === "level" ? `You · LV ${level()}` : "";
  return { title: { worth: "💰 NET WORTH", level: "⭐ LEVEL", lots: "🏠 MOST LOTS" }[B.tab], rows, foot };
}
function renderBoard() {
  const el = document.getElementById("rb-board"); if (!el) return;
  if (R.race) return renderStandings(el);
  const { title, rows, foot } = boardRows(), me = C.player.id, prev = B.prev[B.tab] || {};
  const tabs = ["worth", "level", "lots", "records"].map((t) => `<button data-t="${t}" class="${t === B.tab ? "on" : ""}">${{ worth: "💰", level: "⭐", lots: "🏠", records: "🏁" }[t]}</button>`).join("");
  el.innerHTML = `<div class="rbb-tabs">${tabs}</div><div class="rbb-title">${title}${B.tab === "records" ? ' <button data-n="1" title="Next track">›</button>' : ""}<span class="rbb-live">● LIVE</span></div>
    ${rows.map((r) => { const was = prev[r.id], mv = was == null ? "" : was > r.i ? '<em class="up">▲</em>' : was < r.i ? '<em class="dn">▼</em>' : ""; return `<div class="rbb-row${r.id === me ? " me" : ""}"><span class="rbb-rank">${r.i + 1}</span><span class="rbb-name">${B.online.has(r.id) || r.id === me ? '<i class="dot"></i>' : ""}${esc(r.name)}${r.id === me ? " (you)" : ""}</span>${mv}<b>${r.v}</b></div>`; }).join("")}
    ${foot ? `<div class="rbb-foot">${esc(foot)}</div>` : ""}`;
  el.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => { B.tab = b.dataset.t; if (B.tab === "records") records(); renderBoard(); }));
  const n = el.querySelector("[data-n]"); if (n) n.onclick = () => { B.recTrack = (B.recTrack + 1) % RACE_TRACKS.length; records(); renderBoard(); };
  if (B.tab !== "records") B.prev[B.tab] = Object.fromEntries(rows.map((r) => [r.id, r.i]));
  const rank = (B.data.worth || []).findIndex((u) => u.id === me);
  const sr = document.getElementById("s-rank"); if (sr && rank >= 0) sr.innerText = "#" + (rank + 1);
}
async function records(track) {
  const t = track ? raceTrack(track) : RACE_TRACKS[B.recTrack];
  try { const d = await api("/api/world/race", { id: C.player.id, action: "records", track: t.key }); B.records[t.key] = d; renderBoard(); return d; } catch (e) { return null; }
}
function openBoard() {
  // the full leaderboard as a panel (phones hide the corner one)
  const tab = B.tab;
  const acts = { close: E.hidePanel };
  const tabs = ["worth", "level", "lots", "records"];
  tabs.forEach((t) => (acts["t_" + t] = () => { B.tab = t; if (t === "records") records().then(() => B.tab === "records" && openBoard()); openBoard(); }));
  acts.next = () => { B.recTrack = (B.recTrack + 1) % RACE_TRACKS.length; records().then(openBoard); openBoard(); };
  const { title, rows, foot } = boardRows();
  E.panel(`<h2>🏆 LEADERBOARD</h2><div class="subtitle">Live: updates every few seconds. ● = playing now.</div>
    <div style="display:flex;gap:6px;margin-bottom:10px">${tabs.map((t) => `<button class="${t === tab ? "btn-gold" : "btn-ghost"}" style="flex:1;margin:0;padding:8px 4px;font-size:9px" data-e="t_${t}">${{ worth: "NET WORTH", level: "LEVEL", lots: "LOTS", records: "RECORDS" }[t]}</button>`).join("")}</div>
    <div class="rb-row" style="justify-content:space-between"><b>${title}</b>${tab === "records" ? '<button class="rb-btn" data-e="next">NEXT TRACK ›</button>' : ""}</div>
    ${rows.map((r) => `<div class="rb-card"${r.id === C.player.id ? ' style="border-color:var(--green)"' : ""}><div><b>#${r.i + 1} ${B.online.has(r.id) ? "● " : ""}${esc(r.name)}${r.id === C.player.id ? " (you)" : ""}</b></div><b>${r.v}</b></div>`).join("") || '<div class="rb-muted">Nobody yet.</div>'}
    ${foot ? `<div class="rb-muted">${esc(foot)}</div>` : ""}<button class="btn-ghost" data-e="close">CLOSE</button>`, acts);
}

// ---------------------------------------------------------------- races
const R = { race: null, entries: [], track: null, offset: 0, cp: 0, sent: 0, hits: [], gates: [], cans: [], arrow: null, paid: false, syncAt: 0, busy: false, started: false, lastLight: 99, finishedLocal: false, n: 1, invited: new Set() };
const serverNow = () => Date.now() + R.offset;
// The server's clock, from each reply: eased in, so a slow reply doesn't make the countdown jump back.
function clock(now) { const o = now - Date.now(); R.offset = R.clockSet ? R.offset * 0.8 + o * 0.2 : o; R.clockSet = true; }
function raceT() { return R.race ? (serverNow() - R.race.start_at) / 1000 : 0; }
async function raceCall(action, extra = {}) {
  const d = await api("/api/world/race", { id: C.player.id, name: C.player.name, action, ...extra });
  if (d.now) clock(d.now);
  return d;
}
function gridSpot(t, slot) {
  const [sx, sz] = t.start, [nx, nz] = t.cps[0], h = Math.atan2(nx - sx, nz - sz);
  const back = 9 + Math.floor(slot / 2) * 8, side = slot % 2 ? -2.6 : 2.6;
  return { x: sx - Math.sin(h) * back + Math.cos(h) * side, z: sz - Math.cos(h) * back - Math.sin(h) * side, h };
}
function enter(d) {
  leaveScene();
  R.race = d.race; R.track = raceTrack(d.race.track); R.entries = d.entries; R.cp = 0; R.sent = 0; R.hits = []; R.paid = false; R.started = false; R.finishedLocal = false; R.lastLight = 99;
  const t = R.track, me = d.entries.find((e) => e.you), spot = gridSpot(t, me ? me.slot : 0), car = E.car;
  car.x = spot.x; car.z = spot.z; car.heading = spot.h; car.speed = 0; car.vx = car.vz = 0; car.lock = true; car.boost = 1;
  if (E.setWanted) E.setWanted(0);
  E.hidePanel();
  R.gates = t.cps.map((p, i) => {
    const last = i === t.cps.length - 1, g = new THREE.Mesh(new THREE.TorusGeometry(5.5, 0.45, 8, 32), new THREE.MeshBasicMaterial({ color: last ? 0x00E676 : 0xF5D547, transparent: true, opacity: 0.85 }));
    g.position.set(p[0], 5.5, p[1]); C.scene.add(g); return g;
  });
  // a nitro canister halfway along each leg
  R.cans = t.cps.map((p, i) => {
    const a = i === 0 ? t.start : t.cps[i - 1], m = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1.6, 12), new THREE.MeshBasicMaterial({ color: 0x33b6ff }));
    m.position.set((a[0] + p[0]) / 2, 1.4, (a[1] + p[1]) / 2); C.scene.add(m); return m;
  });
  R.arrow = new THREE.Mesh(new THREE.ConeGeometry(0.8, 2.2, 10), new THREE.MeshBasicMaterial({ color: 0x00E676, transparent: true, opacity: 0.85 }));
  R.arrow.rotation.x = Math.PI / 2; const holder = new THREE.Group(); holder.add(R.arrow); R.arrowHolder = holder; C.scene.add(holder);
  window.__rbRaceTarget = t.cps[0];
  hideInvite();
  document.getElementById("rb-racehud").style.display = "block";
  document.getElementById("rb-leave").style.display = "block";
  document.body.classList.add("rb-racing");
  renderBoard(); sync(true);
}
function leaveScene() {
  for (const m of [...R.gates, ...R.cans]) C.scene.remove(m);
  if (R.arrowHolder) C.scene.remove(R.arrowHolder);
  R.gates = []; R.cans = []; R.arrowHolder = null; window.__rbRaceTarget = null;
  if (E.car) { E.car.lock = false; E.car.draft = 0; }
}
function exitRace(silent) {
  const r = R.race; R.race = null; R.entries = []; leaveScene();
  document.getElementById("rb-racehud").style.display = "none";
  document.getElementById("rb-lights").style.display = "none";
  document.getElementById("rb-leave").style.display = "none";
  document.body.classList.remove("rb-racing");
  for (const [id, g] of ghosts) g.racer = false;
  if (r && !silent) raceCall("leave", { race: r.id }).catch(() => {});
  renderBoard();
}
async function sync(force) {
  if (!R.race || R.busy) return;
  const now = performance.now();
  if (!force && now - R.syncAt < 650) return;
  R.busy = true; R.syncAt = now;
  const car = E.car, cp = Math.min(R.cp, R.sent + 1);
  try {
    const d = await raceCall("sync", { race: R.race.id, cp, hit: R.hits[cp - 1] || null, car: [car.x, car.z, car.heading, car.speed] });
    if (!R.race || d.race.id !== R.race.id) return;
    R.entries = d.entries;
    const me = d.entries.find((e) => e.you);
    if (!me) { E.toast("You left the race.", true); return exitRace(true); }
    R.sent = me.cp;
    if (R.cp > R.sent + 1) setTimeout(() => sync(true), 120); // more than one checkpoint to report
    if (!R.started) R.n = d.entries.length;
    for (const e of d.entries) if (!e.you) seeGhost(e.id, e.name, ghosts.get(e.id)?.level || 1, ghosts.get(e.id)?.color, e.car, true);
    if (me.finish_ms != null && !R.paid) paid(me);
    if (R.paid && d.entries.every((e) => e.finish_ms != null)) setTimeout(() => R.race && results(true), 400);
  } catch (e) {
    if (/isn't running|not in that race/.test(e.message)) { E.toast(e.message, true); exitRace(true); }
  } finally { R.busy = false; }
}
function standings() {
  const t = R.track, me = C.player.id;
  return R.entries.map((e) => {
    const g = ghosts.get(e.id), pos = e.you ? [E.car.x, E.car.z] : g ? [g.x, g.z] : e.car || t.start;
    const cp = e.you ? Math.max(e.cp, R.cp) : e.cp, next = t.cps[Math.min(cp, t.cps.length - 1)];
    return { ...e, cp, left: e.finish_ms != null ? -1 : Math.hypot(pos[0] - next[0], pos[1] - next[1]), me: e.id === me };
  }).sort((a, b) => (a.finish_ms != null) !== (b.finish_ms != null) ? (a.finish_ms != null ? -1 : 1) : a.finish_ms != null ? a.place - b.place : b.cp - a.cp || a.left - b.left);
}
function renderStandings(el) {
  const s = standings(), t = R.track;
  el.innerHTML = `<div class="rbb-title">🏁 ${esc(t.name)}<span class="rbb-live">● LIVE</span></div>${s.map((e, i) => `<div class="rbb-row${e.me ? " me" : ""}"><span class="rbb-rank">P${i + 1}</span><span class="rbb-name">${esc(e.name)}${e.me ? " (you)" : ""}</span><b>${e.finish_ms != null ? secs(e.finish_ms) : `${e.cp}/${t.cps.length}`}</b></div>`).join("")}`;
}
function lights(n) {
  const el = document.getElementById("rb-lights");
  el.style.display = "flex";
  el.innerHTML = [0, 1, 2].map((i) => `<i class="${n === 0 ? "go" : i < 3 - n + 1 && n <= 3 ? "on" : ""}"></i>`).join("") + (n === 0 ? "<b>GO!</b>" : "");
  if (n === 0) setTimeout(() => (el.style.display = "none"), 900);
}
function raceTick(dt) {
  if (!R.race) return;
  const t = R.track, T = raceT(), car = E.car, hud = document.getElementById("rb-racehud");
  const s = standings(), myPos = s.findIndex((e) => e.me) + 1;
  R.gates.forEach((g, i) => { g.rotation.y += dt; g.visible = i >= R.cp; g.material.opacity = i === R.cp ? 0.95 : 0.25; });
  R.cans.forEach((m) => { m.rotation.y += dt * 2; m.position.y = 1.4 + Math.sin(performance.now() / 300) * 0.3; });
  if (T < 0 && !R.started) {
    car.lock = true;
    const n = Math.ceil(-T);
    if (n <= 3 && n !== R.lastLight) { R.lastLight = n; lights(n); C.play("alert", 0.4); }
    hud.innerHTML = n > 3 ? `<b>${R.race.solo ? "GET READY" : "ON THE GRID"}</b><span>${esc(t.name)} · ${R.entries.length}/${RACE_MAX} racers · starts in ${n}s${R.race.solo ? "" : " · others can still join"}</span>` : `<b>${n}</b><span>${esc(t.name)}</span>`;
  } else {
    if (!R.started) { R.started = true; car.lock = false; lights(0); C.play("cash"); R.n = R.entries.length; }
    // checkpoints, seen here straight away; the server confirms them
    if (R.cp < t.cps.length) {
      const p = t.cps[R.cp];
      if (Math.hypot(car.x - p[0], car.z - p[1]) < 7) {
        R.hits[R.cp] = [car.x, car.z]; R.cp++; C.play("cash", 0.5);
        if (R.cp >= t.cps.length) { R.finishedLocal = true; window.__rbRaceTarget = null; E.toast("🏁 Finished! Waiting for the official time…"); }
        else window.__rbRaceTarget = t.cps[R.cp];
        sync(true);
      }
    }
    // nitro canisters
    R.cans.forEach((m) => { if (m.visible && Math.hypot(car.x - m.position.x, car.z - m.position.z) < 4) { m.visible = false; car.boost = 1; C.play("cash", 0.3); E.toast("⚡ Nitro full"); } });
    // slipstream: close behind another racer at speed refills nitro and adds a little top speed
    let draft = false;
    if (Math.abs(car.speed) > 15) for (const g of ghosts.values()) {
      if (!g.racer) continue;
      const dx = g.x - car.x, dz = g.z - car.z, d = Math.hypot(dx, dz);
      if (d > 3 && d < 16 && (dx * Math.sin(car.heading) + dz * Math.cos(car.heading)) / d > 0.9) { draft = true; break; }
    }
    car.draft = draft ? 3 : 0; if (draft) car.boost = Math.min(1, car.boost + dt * 0.25);
    const fin = R.entries.find((e) => e.you)?.finish_ms;
    hud.innerHTML = `<b>${fin != null ? secs(fin) : Math.max(0, T).toFixed(1) + "s"}</b><span>${R.n > 1 ? `P${myPos}/${R.entries.length} · ` : ""}CHECKPOINT ${Math.min(R.cp + 1, t.cps.length)}/${t.cps.length} · par ${t.par}s${best[t.key] ? " · best " + secs(best[t.key]) : ""}${draft ? ' · <em>SLIPSTREAM</em>' : ""}</span>`;
    if (T > t.par * 3 && !R.paid) { E.toast("Race over: out of time.", true); exitRace(); return; }
    if (serverNow() > R.race.ends_at + 1500) { results(true); return; }
  }
  // arrow to the next checkpoint
  if (R.arrowHolder) {
    const p = t.cps[Math.min(R.cp, t.cps.length - 1)];
    R.arrowHolder.position.set(car.x, 4.6, car.z); R.arrowHolder.rotation.y = Math.atan2(p[0] - car.x, p[1] - car.z);
    R.arrowHolder.visible = R.cp < t.cps.length && T > -3;
  }
  sync();
  if (performance.now() - (R.drawn || 0) > 250) { R.drawn = performance.now(); renderStandings(document.getElementById("rb-board")); }
}
function paid(me) {
  R.paid = true;
  const t = R.track, time = me.finish_ms, pb = !best[t.key] || time < best[t.key];
  if (pb) { best[t.key] = time; keep(BEST, best); }
  const multi = R.n > 1;
  const prize = multi ? (RACE_PRIZES[me.place - 1] || 3000) : Math.round((time <= t.par * 1000 ? 8000 : 3000) * (pb ? 1.5 : 1));
  C.player.netWorth += prize; C.sync();
  const head = multi ? (me.place === 1 ? "🏆 YOU WIN!" : `🏁 P${me.place}`) : time <= t.par * 1000 ? "🏁 UNDER PAR!" : "🏁 FINISHED";
  if (G && G.celebrate) G.celebrate(head, `${secs(time)}${pb ? " · new best" : ""} · +${money(prize)}`);
  E.emit("race-done", { track: t.key, ms: time, place: me.place, n: R.n, par: t.par, pb, multi, prize });
  R.prize = prize;
  if (!multi) setTimeout(() => R.race && results(true), 1800);
}
function results(final) {
  if (!R.race) return;
  const race = R.race, t = R.track, s = standings(), multi = R.n > 1;
  exitRace(true);
  const rows = s.map((e, i) => `<div class="rb-card"${e.me ? ' style="border-color:var(--green)"' : ""}><div><b>${e.finish_ms != null ? ["🥇", "🥈", "🥉"][e.place - 1] || "P" + e.place : "DNF"} ${esc(e.name)}${e.me ? " (you)" : ""}</b></div><b>${e.finish_ms != null ? secs(e.finish_ms) : `${e.cp}/${t.cps.length}`}</b></div>`).join("");
  E.panel(`<h2>🏁 ${esc(t.name)}: RESULTS</h2><div class="subtitle">${multi ? `${s.length} racers. Prizes: ${RACE_PRIZES.map(money).join(" / ")}, ${money(3000)} for finishing.` : "Solo time trial."} Times are the server's.${R.prize ? " You won " + money(R.prize) + "." : ""}</div>${rows}
    <button class="btn-gold" data-e="again">${multi ? "HOST A REMATCH" : "TRY AGAIN"}</button><button class="btn-ghost" data-e="records">RECORDS</button><button class="btn-ghost" data-e="close">CLOSE</button>`,
    { again: () => start(multi ? "host" : "solo", t.key), records: () => showRecords(t.key), close: E.hidePanel });
  R.prize = 0;
}
async function start(kind, track) {
  if (R.race) exitRace();
  try { enter(await raceCall(kind, { track })); } catch (e) { E.toast(e.message, true); }
}
async function join(id) {
  if (R.race && R.race.id === id) return;
  if (R.race) exitRace();
  try { enter(await raceCall("join", { race: id })); } catch (e) { E.toast(e.message, true); }
}
async function showRecords(key) {
  const t = raceTrack(key), d = await records(key);
  E.panel(`<h2>🏁 ${esc(t.name)}: RECORDS</h2><div class="subtitle">Best times on the server's clock. Par ${t.par}s.</div>
    ${d && d.top.length ? d.top.map((r, i) => `<div class="rb-card"${r.you ? ' style="border-color:var(--green)"' : ""}><div><b>${["🥇", "🥈", "🥉"][i] || "#" + (i + 1)} ${esc(r.name)}${r.you ? " (you)" : ""}</b></div><b>${secs(r.ms)}</b></div>`).join("") : '<div class="rb-muted">No times yet. Set the first one.</div>'}
    ${d && d.you && !d.top.some((r) => r.you) ? `<div class="rb-muted">Your best: ${secs(d.you.ms)}, #${d.you.rank}.</div>` : ""}
    <button class="btn-gold" data-e="solo">RACE IT SOLO</button><button class="btn-ghost" data-e="back">BACK</button>`, { solo: () => start("solo", key), back: openHub });
}
function openHub() {
  const now = serverNow(), lobbies = B.races.filter((r) => r.start_at > now + 1500);
  const acts = { close: E.hidePanel, paint: openPaint };
  lobbies.forEach((r, i) => (acts["j" + i] = () => join(r.id)));
  RACE_TRACKS.forEach((t, i) => { acts["s" + i] = () => start("solo", t.key); acts["h" + i] = () => start("host", t.key); acts["r" + i] = () => showRecords(t.key); });
  E.panel(`<h2>🏁 STREET RACES</h2><div class="subtitle">Race other players live, or run a solo time trial. The server keeps the time, so the records are real. Prizes are game money: ${RACE_PRIZES.map(money).join(" / ")} for the podium in a race of two or more.</div>
    ${lobbies.length ? `<h3 style="margin:8px 0">OPEN TO JOIN</h3>${lobbies.map((r, i) => `<div class="rb-card"><div><b>${esc(raceTrack(r.track)?.name || r.track)}</b><div class="rb-muted">Hosted by ${esc(r.host)} · ${r.n}/${RACE_MAX} racers · starts in ${Math.ceil((r.start_at - now) / 1000)}s</div></div><button class="rb-btn" data-e="j${i}">${r.mine ? "IN" : "JOIN"}</button></div>`).join("")}` : '<div class="rb-muted" style="margin:6px 0 10px">No races open right now. Host one and everyone in the city gets an invite.</div>'}
    <h3 style="margin:8px 0">TRACKS</h3>
    ${RACE_TRACKS.map((t, i) => `<div class="rb-card" style="flex-wrap:wrap;gap:8px"><div style="flex:1 1 160px"><b>${esc(t.name)}</b><div class="rb-muted">${t.cps.length} checkpoints · par ${t.par}s · your best ${best[t.key] ? secs(best[t.key]) : "none yet"}</div></div><div style="display:flex;gap:6px"><button class="rb-btn" data-e="h${i}">HOST</button><button class="rb-btn" data-e="s${i}">SOLO</button><button class="rb-btn" data-e="r${i}">🏆</button></div></div>`).join("")}
    <div class="rb-muted">On the track: ⚡ blue canisters fill your nitro, and driving close behind another racer (slipstream) refills it and adds speed.</div>
    <button class="btn-ghost" data-e="paint">🎨 PAINT SHOP</button><button class="btn-ghost" data-e="close">CLOSE</button>`, acts);
}
function openPaint() {
  const lv = level(), acts = { back: openHub };
  PAINTS.forEach((p) => (acts["p_" + p.k] = () => { if (lv < p.lv) return; paint = p.k; keep(PAINT, paint); applyPaint(); openPaint(); }));
  E.panel(`<h2>🎨 PAINT SHOP</h2><div class="subtitle">Free. More colours unlock as you level up. Other players see your colour.</div>
    <div class="rb-row" style="flex-wrap:wrap;gap:8px">${PAINTS.map((p) => `<button class="rb-card" data-e="p_${p.k}" style="flex:1 1 30%;margin:0;flex-direction:column;align-items:flex-start;cursor:pointer;${p.k === paint ? "border-color:var(--green)" : ""}${lv < p.lv ? ";opacity:.4" : ""}"><span style="display:block;width:100%;height:22px;border-radius:6px;background:${p.c};border:1px solid rgba(255,255,255,.2)"></span><b style="margin-top:6px">${p.k === paint ? "✓ " : ""}${p.n}</b><span class="rb-muted">${lv < p.lv ? "🔒 Level " + p.lv : "Unlocked"}</span></button>`).join("")}</div>
    <button class="btn-ghost" data-e="back">BACK</button>`, acts);
}

// invites: someone hosted a race while you're in the city
function showInvite(r) {
  const el = document.getElementById("rb-invite");
  const left = Math.ceil((r.start_at - serverNow()) / 1000);
  if (left < 3) return hideInvite();
  el.style.display = "flex";
  // built once per race (so a tap never lands on a button that was just replaced); then only the text changes
  if (el.dataset.id !== r.id) {
    el.dataset.id = r.id;
    el.innerHTML = `<span></span><button data-j="1">JOIN</button><button data-x="1" aria-label="Dismiss">✕</button>`;
    el.querySelector("[data-j]").onclick = () => join(r.id);
    el.querySelector("[data-x]").onclick = () => { R.invited.add(r.id + ":x"); hideInvite(); };
  }
  el.querySelector("span").innerHTML = `🏁 <b>${esc(r.host)}</b> is hosting <b>${esc(raceTrack(r.track)?.name || r.track)}</b> · ${r.n}/${RACE_MAX} · starts in ${left}s`;
}
function hideInvite() { const el = document.getElementById("rb-invite"); if (el) el.style.display = "none"; }
function inviteTick() {
  if (R.race) return hideInvite();
  const now = serverNow(), r = B.races.find((x) => !x.mine && x.start_at > now + 3000 && !R.invited.has(x.id + ":x"));
  if (!r) return hideInvite();
  if (!R.invited.has(r.id)) { R.invited.add(r.id); C.play("alert", 0.3); }
  showInvite(r);
}

// ---------------------------------------------------------------- start
export function initRace(empire, ctx, progress) {
  E = empire; C = ctx; G = progress;
  const s = document.createElement("style");
  s.textContent = `#leaderboard{display:none!important}
#rb-board{position:fixed;z-index:7000;right:12px;width:250px;background:rgba(0,0,0,.82);border:1px solid rgba(201,168,76,.45);border-radius:14px;padding:8px 10px;font:600 11px/1.3 Inter,sans-serif;color:#fff;backdrop-filter:blur(6px)}
#rb-board .rbb-tabs{display:flex;gap:4px;margin-bottom:6px}#rb-board .rbb-tabs button{flex:1;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:#fff;padding:4px 0;cursor:pointer;font-size:13px}#rb-board .rbb-tabs button.on{border-color:var(--gold);background:rgba(201,168,76,.25)}
#rb-board .rbb-title{display:flex;align-items:center;gap:6px;font:800 10px Inter,sans-serif;letter-spacing:1px;color:#F5E6A3;margin-bottom:4px}#rb-board .rbb-title button{background:none;border:1px solid rgba(201,168,76,.5);color:#F5E6A3;border-radius:6px;cursor:pointer;padding:0 6px}
#rb-board .rbb-live{margin-left:auto;color:#00E676;font-size:9px;animation:rbblink 1.6s infinite}@keyframes rbblink{50%{opacity:.35}}
#rb-board .rbb-row{display:flex;align-items:center;gap:6px;padding:3px 0;border-top:1px solid rgba(255,255,255,.05)}#rb-board .rbb-row.me{color:var(--green)}#rb-board .rbb-rank{width:22px;color:#C9A84C;font-weight:900}#rb-board .rbb-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#rb-board .dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#00E676;margin-right:5px;vertical-align:middle}#rb-board em{font-style:normal;font-size:9px}#rb-board em.up{color:#00E676}#rb-board em.dn{color:#ff5a5a}
#rb-board .rbb-foot{margin-top:4px;color:rgba(255,255,255,.6)}#rb-board .rbb-foot button{width:100%;background:rgba(255,60,60,.15);border:1px solid rgba(255,90,90,.5);color:#fff;border-radius:8px;padding:5px;font:800 10px Inter,sans-serif;cursor:pointer}
#rb-racehud{position:fixed;z-index:7600;left:50%;transform:translateX(-50%);top:18%;display:none;text-align:center;pointer-events:none;text-shadow:0 2px 10px #000}#rb-racehud b{display:block;font:900 40px Orbitron,Inter,sans-serif;color:#F5E6A3}#rb-racehud span{font:800 11px Inter,sans-serif;color:#fff;letter-spacing:1px}#rb-racehud em{color:#33b6ff;font-style:normal}
#rb-lights{position:fixed;z-index:7700;left:50%;top:32%;transform:translateX(-50%);display:none;gap:14px;align-items:center;background:rgba(0,0,0,.8);padding:12px 18px;border-radius:18px;border:1px solid rgba(255,255,255,.2);pointer-events:none}#rb-lights i{width:34px;height:34px;border-radius:50%;background:#300}#rb-lights i.on{background:#ff2020;box-shadow:0 0 18px #ff2020}#rb-lights i.go{background:#00E676;box-shadow:0 0 18px #00E676}#rb-lights b{font:900 26px Orbitron,Inter,sans-serif;color:#00E676}
#rb-invite{position:fixed;z-index:7800;left:50%;transform:translateX(-50%);bottom:calc(150px + env(safe-area-inset-bottom));display:none;align-items:center;gap:10px;width:min(94vw,560px);box-sizing:border-box;background:rgba(0,0,0,.9);border:1px solid var(--gold);border-radius:14px;padding:9px 12px;font:600 12px/1.3 Inter,sans-serif;color:#fff;box-shadow:0 8px 30px rgba(0,0,0,.6)}#rb-invite span{flex:1;min-width:0;font-variant-numeric:tabular-nums}#rb-invite button{background:linear-gradient(135deg,#C9A84C,#F5E6A3);border:0;color:#000;font:900 11px Inter,sans-serif;border-radius:9px;padding:8px 12px;cursor:pointer}#rb-invite button[data-x]{background:none;color:#fff;padding:4px}
#rb-leave{position:fixed;z-index:7600;left:12px;bottom:calc(170px + env(safe-area-inset-bottom));display:none;background:rgba(0,0,0,.8);border:1px solid rgba(255,90,90,.6);color:#fff;border-radius:10px;padding:7px 12px;font:800 10px Inter,sans-serif;letter-spacing:1px;cursor:pointer}
body.rb-racing #rb-tracker,body.rb-racing .rb-ctx{display:none!important}
body:has(#ov-empire[style*="flex"]) #rb-leave,body:has(#ov-empire[style*="flex"]) #rb-board,body:has(#ov-empire[style*="flex"]) #rb-racehud{display:none!important}
@media (max-width:640px){#rb-board{display:none}#rb-leave{bottom:auto;top:calc(var(--rb-under,140px) + 164px);left:auto;right:12px}#rb-racehud{top:auto;bottom:calc(330px + env(safe-area-inset-bottom))}#rb-racehud b{font-size:30px}#rb-invite{bottom:calc(300px + env(safe-area-inset-bottom))}}`;
  document.head.appendChild(s);
  for (const id of ["rb-board", "rb-racehud", "rb-lights", "rb-invite"]) { const d = document.createElement("div"); d.id = id; document.body.appendChild(d); }
  const lv = document.createElement("button"); lv.id = "rb-leave"; lv.textContent = "✕ LEAVE RACE"; lv.onclick = () => { exitRace(); E.toast("You left the race."); }; document.body.appendChild(lv);
  const place = () => { const st = document.getElementById("hud-stats"), b = document.getElementById("rb-board"); b.style.top = (st ? Math.round(st.getBoundingClientRect().bottom) + 10 : 120) + "px"; };
  place(); window.addEventListener("resize", place); setInterval(place, 3000);
  // phones: the 🏆 button opens the full board
  const ctr = document.getElementById("controls");
  const b = document.createElement("button"); b.className = "ctrl-btn"; b.id = "btn-board"; b.textContent = "🏆"; b.title = "Live leaderboard"; b.setAttribute("aria-label", "Live leaderboard"); b.onclick = openBoard;
  ctr.insertBefore(b, ctr.children[3] || null);
  applyPaint();
  // on foot, others see your car parked where you left it (and you, through live.js)
  beatExtra(() => ({ car: window.RBFoot ? window.RBFoot.vehicle() : [E.car.x, E.car.z, E.car.heading, E.car.speed], level: level(), color: paintHex() }));
  onBeat((d) => {
    if (d.now) clock(d.now);
    B.data.worth = d.board || []; B.data.level = d.boards?.level || []; B.data.lots = d.boards?.lots || []; B.races = d.races || [];
    B.online = new Set((d.peers || []).map((p) => p.id));
    const inRace = new Set(R.entries.map((e) => e.id));
    for (const p of d.peers || []) {
      if (inRace.has(p.id)) { ghost(p.id, p.name, p.level || 1, p.color); continue; } // its position comes from the race
      if (window.RBLive && window.RBLive.fresh(p.id)) continue; // live.js has newer news of this one
      if (p.car) seeGhost(p.id, p.name, p.level || 1, p.color, p.car, false); else dropGhost(p.id);
    }
    for (const id of [...ghosts.keys()]) if (!B.online.has(id) && !inRace.has(id)) dropGhost(id);
    inviteTick(); renderBoard();
  });
  setInterval(inviteTick, 1000);
  setInterval(() => { if (B.tab === "records" && !R.race) records(); }, 30000);
  on("frame", (dt) => { ghostsTick(dt); raceTick(dt); });
  on("race-key", openHub);
  window.addEventListener("keydown", (e) => { if (e.code === "KeyL" && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || "")) openBoard(); });
  renderBoard();
  return { openHub, openBoard, start, join, state: R, board: B, ghosts, see: seeGhost, ghost };
}
