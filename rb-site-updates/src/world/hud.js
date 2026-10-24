// RB World HUD: the radar (GTA-style: drawn from the real city map, turning with your car, with lots by owner, cops,
// drops, other players and the job or race target, which sits on the rim when it's off the radar), the street and
// neighbourhood you're in, the speedometer with the nitro gauge, touch pedals, the help screen and a tidier layout.
// Tap the radar for the real-world map (MapLibre) at your car's real spot in the city, then (with location on) at you.
import { LOTS, DISTRICTS } from "./empire_defs.js";
import { pad } from "./empire.js";
import * as CITY from "./city.js";

let E = null, C = null, cv = null, cx = null, realMode = 0, last = 0, map = null, lastStreet = 0;
const RANGE = 190, MAP_K = 0.8, MAP_EXT = 1000; // metres shown from the centre; map pixels per metre; the map's reach

function css() {
  const s = document.createElement("style");
  s.textContent = `
#rb-radar{position:fixed;right:12px;bottom:calc(74px + env(safe-area-inset-bottom));width:168px;height:214px;z-index:6950;border-radius:16px;overflow:hidden;background:rgba(0,0,0,.82);border:1px solid rgba(201,168,76,.55);box-shadow:0 10px 30px rgba(0,0,0,.6);cursor:pointer}
#rb-radar canvas{display:block;width:168px;height:168px}
#rb-speed{display:flex;align-items:center;gap:8px;height:28px;padding:0 10px;font:900 13px/1 Orbitron,Inter,sans-serif;color:#F5E6A3;border-top:1px solid rgba(201,168,76,.25)}
#rb-speed small{font:700 9px Inter,sans-serif;color:rgba(255,255,255,.5);letter-spacing:1px}
#rb-street{height:18px;padding:0 10px;font:800 9px/18px Inter,sans-serif;color:#fff;letter-spacing:.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:rgba(201,168,76,.12)}
#rb-osm{position:fixed;left:8px;bottom:4px;z-index:6950;font:600 9px Inter,sans-serif;color:rgba(255,255,255,.55);pointer-events:auto}#rb-osm a{color:inherit}
#rb-nitro{flex:1;height:6px;border-radius:4px;background:rgba(255,255,255,.08);overflow:hidden}#rb-nitro i{display:block;height:100%;width:100%;background:linear-gradient(90deg,#00BFFF,#66ccff)}
body.rb-real #minimap{display:block!important;position:fixed!important;z-index:6970!important;border-radius:16px 16px 0 0!important;opacity:1!important;border:0!important}body:not(.rb-real) #minimap{display:none!important}
#combat-hud,#events-bar{display:none!important}
#btn-vr{display:none!important}
#hud-stats .stat-card{padding:8px 12px!important}#hud-stats .stat-value{font-size:15px!important}
.rb-pedals{position:fixed;right:14px;bottom:calc(282px + env(safe-area-inset-bottom));z-index:6900;display:grid;grid-template-columns:64px 64px;gap:10px;touch-action:none;user-select:none;-webkit-user-select:none}
.rb-pedals button{height:64px;border-radius:18px;border:1px solid rgba(201,168,76,.5);background:rgba(0,0,0,.55);color:#F5E6A3;font:900 11px/1.1 Inter,sans-serif;letter-spacing:1px;touch-action:none}
.rb-pedals button.on{background:rgba(201,168,76,.55);color:#000}
.rb-pedals .gas{grid-column:2;grid-row:1 / span 2;height:138px;font-size:13px}
body:not(.rb-touch) .rb-pedals{display:none}
@media (max-width:640px){#leaderboard{display:none!important}#rb-radar{top:calc(var(--rb-under,140px));bottom:auto;width:132px;height:174px}#rb-street{font-size:8px}#rb-radar canvas{width:132px;height:132px}#rb-speed{height:24px;font-size:11px}.rb-pedals{bottom:calc(86px + env(safe-area-inset-bottom))}}
.rb-help h3{font:800 11px Inter,sans-serif;color:var(--gold);letter-spacing:2px;margin:14px 0 6px}.rb-help table{width:100%;font-size:12px;border-collapse:collapse}.rb-help td{padding:5px 4px;border-bottom:1px solid rgba(255,255,255,.06)}.rb-help td:first-child{color:#F5E6A3;font-weight:800;white-space:nowrap;width:40%}
.rb-help kbd{border:1px solid rgba(255,255,255,.25);border-radius:5px;padding:1px 5px;font:700 10px Inter,sans-serif}`;
  document.head.appendChild(s);
}

// The map under the radar, drawn once: sidewalks, roads, parks, plazas and every building's footprint.
let mapCv = null;
function drawMap() {
  const S = Math.round(MAP_EXT * 2 * MAP_K); mapCv = document.createElement("canvas"); mapCv.width = mapCv.height = S;
  const g = mapCv.getContext("2d"), P = (x, z) => [(x + MAP_EXT) * MAP_K, (z + MAP_EXT) * MAP_K];
  g.fillStyle = "#1c1f24"; g.fillRect(0, 0, S, S);
  // roads, wide by class
  g.lineCap = "round"; g.strokeStyle = "#4b4f57";
  for (const e of CITY.edges) { const [ax, az] = P(...CITY.nodes[e.a]), [bx, bz] = P(...CITY.nodes[e.b]); g.lineWidth = e.w * MAP_K; g.beginPath(); g.moveTo(ax, az); g.lineTo(bx, bz); g.stroke(); }
  // buildings: the drivable city's in grey, the skyline's darker
  for (const b of CITY.buildings) { g.fillStyle = b.core ? "#2c3038" : "#24272d"; g.beginPath(); b.pts.forEach(([x, z], i) => { const [px, pz] = P(x, z); i ? g.lineTo(px, pz) : g.moveTo(px, pz); }); g.closePath(); g.fill(); }
  // the edge of the drivable city
  const [x0, z0] = P(-CITY.HALF[0], -CITY.HALF[1]); g.strokeStyle = "rgba(226,87,30,.6)"; g.lineWidth = 2; g.setLineDash([6, 6]); g.strokeRect(x0, z0, CITY.HALF[0] * 2 * MAP_K, CITY.HALF[1] * 2 * MAP_K); g.setLineDash([]);
}
function radar() {
  const box = document.createElement("div"); box.id = "rb-radar"; box.title = "Radar (tap for the real-world map)";
  cv = document.createElement("canvas"); cv.width = 336; cv.height = 336; cx = cv.getContext("2d");
  const st = document.createElement("div"); st.id = "rb-street"; st.textContent = CITY.SHORT;
  const sp = document.createElement("div"); sp.id = "rb-speed"; sp.innerHTML = `<span id="rb-kmh">0</span><small>KM/H</small><div id="rb-nitro" title="Nitro"><i></i></div>`;
  box.append(cv, st, sp); document.body.appendChild(box);
  const osm = document.createElement("div"); osm.id = "rb-osm"; osm.innerHTML = `Map data <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> · OpenMapTiles · OpenFreeMap`; document.body.appendChild(osm);
  drawMap();
  // tap: the real map where your car is in the city, then (location on) where you are, then back to the radar
  box.addEventListener("click", () => {
    realMode = (realMode + 1) % (C.gps() ? 3 : 2);
    document.body.classList.toggle("rb-real", realMode > 0);
    E.toast(realMode === 1 ? "Real map: your car's spot in " + CITY.NAME + ". Tap again for " + (C.gps() ? "where you are." : "the radar.") : realMode === 2 ? "Real map: where you are, with drops near you." : "Radar.");
    placeMap();
  });
  window.addEventListener("resize", placeMap);
}
// The real map goes exactly where the radar's picture is (on the page itself, above the game's layers).
function placeMap() {
  const mm = document.getElementById("minimap"); if (!mm) return;
  if (mm.parentElement !== document.body) document.body.appendChild(mm);
  const r = cv.getBoundingClientRect();
  Object.assign(mm.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px", right: "auto", bottom: "auto" });
  const m = C.minimap && C.minimap(); if (m) setTimeout(() => m.resize(), 60);
}

function drawRadar(t) {
  const R = E.radar(), W = cv.width, c = R.car, mid = W / 2, k = mid / RANGE;
  // the view turns with the car: its nose points up
  const th = -Math.PI / 2 - Math.atan2(Math.cos(c.heading), Math.sin(c.heading));
  const cos = Math.cos(th), sin = Math.sin(th);
  const at = (x, z) => { const dx = (x - c.x) * k, dz = (z - c.z) * k; return [mid + dx * cos - dz * sin, mid + dx * sin + dz * cos]; };
  cx.save();
  cx.fillStyle = "#14161a"; cx.fillRect(0, 0, W, W);
  cx.translate(mid, mid); cx.rotate(th); const sc = k / MAP_K; cx.scale(sc, sc);
  cx.drawImage(mapCv, -(c.x + MAP_EXT) * MAP_K, -(c.z + MAP_EXT) * MAP_K);
  cx.restore();
  // lots by owner: yours in the district colour, other players' grey, for sale outlined in the district colour
  for (const l of LOTS) {
    if (!l.building) continue;
    const d = DISTRICTS[l.district], o = R.lotOwner(l);
    cx.beginPath(); l.building.pts.forEach(([x, z], i) => { const [px, pz] = at(x, z); i ? cx.lineTo(px, pz) : cx.moveTo(px, pz); }); cx.closePath();
    if (o && R.mine(l)) { cx.fillStyle = d.css; cx.fill(); } else if (o) { cx.fillStyle = "#5a5a64"; cx.fill(); } else { cx.strokeStyle = d.css; cx.lineWidth = 2.5; cx.stroke(); }
  }
  const dot = (x, z, r, fill, ring) => { const [px, pz] = at(x, z); if (px < -10 || pz < -10 || px > W + 10 || pz > W + 10) return; cx.fillStyle = fill; cx.beginPath(); cx.arc(px, pz, r, 0, 7); cx.fill(); if (ring) { cx.strokeStyle = ring; cx.lineWidth = 1.5; cx.stroke(); } };
  for (const d of R.drops) dot(d.x, d.z, 4.5, d.kind === "cash" ? "#00E676" : d.kind === "token" ? "#00BFFF" : "#F5D547", "#000");
  for (const tc of R.traffic) dot(tc.x, tc.z, 2.2, "#7d828a");
  for (const g of window.__rbGhosts || []) dot(g.x, g.z, 5, g.racer ? "#F5D547" : "#ffffff", "#000");
  const blink = Math.floor(t * 4) % 2;
  for (const cp of R.cops) dot(cp.x, cp.z, 6.5, blink ? "#ff2a2a" : "#2a6bff", "#fff");
  // combat.js: crews, police on foot, dropped cash and other players on foot
  for (const b of window.__rbBlips || []) dot(b.x, b.z, b.r || 4, b.c, "#000");
  // the target: job or race checkpoint, on the rim with an arrow when it's out of range
  const tgt = R.job ? R.job.stops[R.job.stage].at : window.__rbRaceTarget || window.__rbMissionTarget || null;
  if (tgt) {
    let [px, pz] = at(tgt[0], tgt[1]); const col = R.job && R.job.stage ? "#00E676" : "#F5D547";
    const dx = px - mid, dz = pz - mid, dd = Math.hypot(dx, dz), lim = mid - 14;
    if (dd > lim) { px = mid + (dx / dd) * lim; pz = mid + (dz / dd) * lim; cx.save(); cx.translate(px, pz); cx.rotate(Math.atan2(dz, dx) + Math.PI / 2); cx.fillStyle = col; cx.beginPath(); cx.moveTo(0, -12); cx.lineTo(9, 6); cx.lineTo(-9, 6); cx.closePath(); cx.fill(); cx.restore(); }
    else { const pulse = 8 + (t * 20) % 14; cx.strokeStyle = col; cx.lineWidth = 3; cx.beginPath(); cx.arc(px, pz, pulse, 0, 7); cx.stroke(); cx.fillStyle = col; cx.beginPath(); cx.arc(px, pz, 6, 0, 7); cx.fill(); }
  }
  // north on the rim
  const [nx, nz] = CITY.fromLngLat(CITY.toLngLat(c.x, c.z)[0], CITY.toLngLat(c.x, c.z)[1] + 0.001), [ax0, az0] = at(c.x, c.z), [ax1, az1] = at(nx, nz), na = Math.atan2(az1 - az0, ax1 - ax0);
  cx.fillStyle = "#000"; cx.beginPath(); cx.arc(mid + Math.cos(na) * (mid - 16), mid + Math.sin(na) * (mid - 16), 12, 0, 7); cx.fill();
  cx.fillStyle = "#fff"; cx.font = "900 15px Inter,sans-serif"; cx.textAlign = "center"; cx.textBaseline = "middle"; cx.fillText("N", mid + Math.cos(na) * (mid - 16), mid + Math.sin(na) * (mid - 16) + 1);
  // you, in the middle, nose up
  cx.fillStyle = "#F5E6A3"; cx.strokeStyle = "#000"; cx.lineWidth = 2; cx.beginPath(); cx.moveTo(mid, mid - 12); cx.lineTo(mid + 9, mid + 10); cx.lineTo(mid, mid + 5); cx.lineTo(mid - 9, mid + 10); cx.closePath(); cx.fill(); cx.stroke();
  // speed and nitro; the street and neighbourhood a few times a second
  document.getElementById("rb-kmh").textContent = Math.round(Math.abs(c.speed) * 3.6);
  document.querySelector("#rb-nitro i").style.width = Math.round((c.boost ?? 1) * 100) + "%";
  if (t - lastStreet > 0.4) {
    lastStreet = t;
    const street = CITY.streetName(c.x, c.z), area = CITY.areaName(c.x, c.z);
    document.getElementById("rb-street").textContent = street ? `${street.replace(/^West /, "W ").replace(/^East /, "E ").replace(" Street", " St").replace(" Avenue", " Ave")} · ${area}` : area;
    // the real map follows your car (or you)
    const m = C.minimap && C.minimap();
    if (m && realMode === 1) m.jumpTo({ center: CITY.toLngLat(c.x, c.z), bearing: CITY.bearing(c.heading), zoom: 16.4 });
    else if (m && realMode === 2 && C.player && C.player.pos) m.jumpTo({ center: C.player.pos, bearing: 0, zoom: 15.5 });
  }
}

function pedals() {
  if (navigator.maxTouchPoints > 0 || matchMedia("(pointer:coarse)").matches) document.body.classList.add("rb-touch");
  window.addEventListener("touchstart", () => document.body.classList.add("rb-touch"), { once: true, passive: true });
  const box = document.createElement("div"); box.className = "rb-pedals";
  box.innerHTML = `<button class="nitro" data-k="boost">NITRO</button><button class="gas" data-k="gas">GAS</button><button class="brake" data-k="brake">BRAKE</button><button class="hand" data-k="hand">DRIFT</button>`;
  box.querySelectorAll("button").forEach((b) => {
    const k = b.dataset.k, down = (e) => { pad[k] = true; b.classList.add("on"); e.preventDefault(); }, up = (e) => { pad[k] = false; b.classList.remove("on"); e.preventDefault(); };
    b.addEventListener("touchstart", down, { passive: false }); b.addEventListener("touchend", up, { passive: false }); b.addEventListener("touchcancel", up, { passive: false });
    b.addEventListener("mousedown", down); b.addEventListener("mouseup", up); b.addEventListener("mouseleave", up);
  });
  document.body.appendChild(box);
}

export function help() {
  E.panel(`<div class="rb-help"><h2>HOW TO PLAY</h2><div class="subtitle">Build an empire in RB World: drive the city, buy lots, run businesses, collect talent, and race to $1B.</div>
  <h3>DRIVING</h3><table>
    <tr><td><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / arrows</td><td>Drive and steer</td></tr>
    <tr><td><kbd>Space</kbd></td><td>Handbrake: drift round corners</td></tr>
    <tr><td><kbd>G</kbd></td><td>Horn</td></tr>
    <tr><td><kbd>M</kbd> or 📻</td><td>Car radio: RB Radio live, the same song as everyone</td></tr>
    <tr><td><kbd>T</kbd> or 📱</td><td>Your phone: jobs, empire, races, goals, messages, radio, leaders, events and settings</td></tr>
    <tr><td><kbd>F</kbd> or GET OUT</td><td>Get out and walk; next to a car, get in (yours, or take one from the traffic)</td></tr>
    <tr><td>On foot</td><td><kbd>WASD</kbd> move, mouse looks (click to lock it, <kbd>Esc</kbd> to let go), <kbd>Shift</kbd> sprint, <kbd>Space</kbd> jump, <kbd>V</kbd> first or third person</td></tr>
    <tr><td>Combat (18+, ⚔️)</td><td>Right mouse aims, left mouse fires, <kbd>R</kbd> reloads, <kbd>1</kbd>-<kbd>6</kbd> or the mouse wheel switch, hold <kbd>Tab</kbd> for the weapon wheel, <kbd>X</kbd> puts it away, <kbd>G</kbd> throws a grenade (3 a life); kills in a row earn armour, cash and health</td></tr>
    <tr><td><kbd>P</kbd></td><td>Photo mode: the HUD hides, orbit the car, set the blur and a filter, save the picture</td></tr>
    <tr><td><kbd>Shift</kbd> or <kbd>N</kbd></td><td>Nitro (the blue gauge refills)</td></tr>
    <tr><td><kbd>E</kbd></td><td>The lot you're next to: buy, build, manage</td></tr>
    <tr><td><kbd>C</kbd></td><td>Camera: chase, high, bonnet, free</td></tr>
    <tr><td><kbd>R</kbd></td><td>Street races: host, join or race the clock</td></tr>
    <tr><td><kbd>L</kbd></td><td>Live leaderboard (🏆 on phones)</td></tr>
    <tr><td><kbd>H</kbd> / <kbd>Esc</kbd></td><td>This help / close a panel</td></tr>
    <tr><td>Phone</td><td>Stick to steer, GAS / BRAKE / DRIFT / NITRO on the right</td></tr>
    <tr><td>Phone, on foot</td><td>Stick to walk, drag the right side to look, SPRINT / JUMP; with combat on, AIM / FIRE / RELOAD / NEXT / GRENADE / VIEW</td></tr>
    <tr><td>Controller</td><td>Left stick steer, RT gas, LT brake, A nitro, B drift, Y lot, Back camera, Start help</td></tr>
  </table>
  <h3>MAKING MONEY</h3><table>
    <tr><td>🔥 Hustle</td><td>Jobs: deliveries, VIP rides and heists. Heists bring the cops; stay away from them to lose your stars.</td></tr>
    <tr><td>🏠 Lots</td><td>Stop by a FOR SALE sign. Own all four of a colour for +50% customers. Others pay you rent when they stop on yours.</td></tr>
    <tr><td>🏢 Businesses</td><td>Build on your lot, set the price, hire talent, upgrade to ★★★★★, run marketing. They earn while you play, and a little while you're away.</td></tr>
    <tr><td>💰💎🃏 Drops</td><td>Drive through them. With location on, drops appear near where you really are too.</td></tr>
    <tr><td>🗺️ The city</td><td>Real ${CITY.NAME}, from OpenStreetMap: real streets, the waterfront and street names; RB Plaza is ${CITY.PLAZA_NAME.replace(/^RB Plaza \(|\)$/g, "")}. Where the map has no building outlines, the blocks are filled with houses, shops and warehouses that fit the area. Taxis keep to the one-way streets and stop at red lights. Tap the radar for the real map at your car's spot (and, with location on, where you are).</td></tr>
    <tr><td>🏁 Races</td><td>Host a race and everyone in the city gets an invite, or join one. Podium places win $25,000 / $15,000 / $8,000. Blue canisters fill your nitro; driving close behind another racer (slipstream) refills it and adds speed.</td></tr>
    <tr><td>🎨 Paint</td><td>In the race menu: colours for your car. Other players see it, with your name and level.</td></tr>
    <tr><td>📋 Goals</td><td>Daily rewards, three daily quests, achievements and your level.</td></tr>
  </table>
  <div class="rb-muted" style="margin-top:12px">Everything here is game money. Signed in with your RB account, your play time can also earn RB Badge points.</div>
  <button class="btn-ghost" data-e="close">CLOSE</button></div>`, { close: E.hidePanel });
}

export function initHud(empire, ctx) {
  E = empire; C = ctx;
  css(); radar(); pedals();
  const ctr = document.getElementById("controls");
  const b = document.createElement("button"); b.className = "ctrl-btn"; b.id = "btn-help"; b.textContent = "❔"; b.title = "How to play"; b.setAttribute("aria-label", "How to play"); b.onclick = help; ctr.appendChild(b);
  // put the phone radar under the stats
  const place = () => { const st = document.getElementById("hud-stats"); if (st) document.documentElement.style.setProperty("--rb-under", Math.round(st.getBoundingClientRect().bottom + 10) + "px"); };
  place(); window.addEventListener("resize", place);
  C.onFrame((dt, t) => { if (t - last > 1 / 15) { last = t; drawRadar(t); } });
  try { if (!localStorage.getItem("rb_help_seen")) { localStorage.setItem("rb_help_seen", "1"); setTimeout(help, 2500); } } catch (e) {}
  return { help };
}
