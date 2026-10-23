// RB World HUD: the city radar (GTA-style: lots by owner, your car, cops, traffic, drops, the job or race target), the
// speedometer with the nitro gauge, touch pedals, the help screen and a tidier layout. The real-world map (MapLibre)
// is still there for location drops: tap the radar to swap to it.
import { HALF, ROAD, BLOCK, LOTS, DISTRICTS } from "./empire_defs.js";
import { pad } from "./empire.js";

let E = null, C = null, cv = null, cx = null, showReal = false, last = 0;
const EXT = HALF + ROAD; // world units from the centre to the edge of the radar

function css() {
  const s = document.createElement("style");
  s.textContent = `
#rb-radar{position:fixed;right:12px;bottom:calc(74px + env(safe-area-inset-bottom));width:168px;height:196px;z-index:6950;border-radius:16px;overflow:hidden;background:rgba(0,0,0,.82);border:1px solid rgba(201,168,76,.55);box-shadow:0 10px 30px rgba(0,0,0,.6);cursor:pointer}
#rb-radar canvas{display:block;width:168px;height:168px}
#rb-speed{display:flex;align-items:center;gap:8px;height:28px;padding:0 10px;font:900 13px/1 Orbitron,Inter,sans-serif;color:#F5E6A3;border-top:1px solid rgba(201,168,76,.25)}
#rb-speed small{font:700 9px Inter,sans-serif;color:rgba(255,255,255,.5);letter-spacing:1px}
#rb-nitro{flex:1;height:6px;border-radius:4px;background:rgba(255,255,255,.08);overflow:hidden}#rb-nitro i{display:block;height:100%;width:100%;background:linear-gradient(90deg,#00BFFF,#66ccff)}
body.rb-real #minimap{display:block!important;z-index:6960}body:not(.rb-real) #minimap{display:none!important}
#combat-hud,#events-bar{display:none!important}
#btn-combat,#btn-vr{display:none!important}
#hud-stats .stat-card{padding:8px 12px!important}#hud-stats .stat-value{font-size:15px!important}
.rb-pedals{position:fixed;right:14px;bottom:calc(282px + env(safe-area-inset-bottom));z-index:6900;display:grid;grid-template-columns:64px 64px;gap:10px;touch-action:none;user-select:none;-webkit-user-select:none}
.rb-pedals button{height:64px;border-radius:18px;border:1px solid rgba(201,168,76,.5);background:rgba(0,0,0,.55);color:#F5E6A3;font:900 11px/1.1 Inter,sans-serif;letter-spacing:1px;touch-action:none}
.rb-pedals button.on{background:rgba(201,168,76,.55);color:#000}
.rb-pedals .gas{grid-column:2;grid-row:1 / span 2;height:138px;font-size:13px}
body:not(.rb-touch) .rb-pedals{display:none}
@media (max-width:640px){#leaderboard{display:none!important}#rb-radar{top:calc(var(--rb-under,140px));bottom:auto;width:132px;height:156px}#rb-radar canvas{width:132px;height:132px}#rb-speed{height:24px;font-size:11px}.rb-pedals{bottom:calc(86px + env(safe-area-inset-bottom))}}
.rb-help h3{font:800 11px Inter,sans-serif;color:var(--gold);letter-spacing:2px;margin:14px 0 6px}.rb-help table{width:100%;font-size:12px;border-collapse:collapse}.rb-help td{padding:5px 4px;border-bottom:1px solid rgba(255,255,255,.06)}.rb-help td:first-child{color:#F5E6A3;font-weight:800;white-space:nowrap;width:40%}
.rb-help kbd{border:1px solid rgba(255,255,255,.25);border-radius:5px;padding:1px 5px;font:700 10px Inter,sans-serif}`;
  document.head.appendChild(s);
}

function radar() {
  const box = document.createElement("div"); box.id = "rb-radar"; box.title = "City map (tap for the real-world map when location is on)";
  cv = document.createElement("canvas"); cv.width = 336; cv.height = 336; cx = cv.getContext("2d");
  const sp = document.createElement("div"); sp.id = "rb-speed"; sp.innerHTML = `<span id="rb-kmh">0</span><small>KM/H</small><div id="rb-nitro" title="Nitro"><i></i></div>`;
  box.append(cv, sp); document.body.appendChild(box);
  box.addEventListener("click", () => {
    if (!C.gps()) { E.toast("Turn on location (⚙️ Navigation: GPS) to see the real-world map with drops near you."); return; }
    showReal = !showReal; document.body.classList.toggle("rb-real", showReal); E.toast(showReal ? "Real-world map: drops near where you are. Tap again for the city." : "City map.");
  });
}

function drawRadar(t) {
  const R = E.radar(), W = cv.width, k = W / (2 * EXT), X = (x) => (x + EXT) * k, Z = (z) => (z + EXT) * k;
  cx.fillStyle = "#06070a"; cx.fillRect(0, 0, W, W);
  // roads
  cx.fillStyle = "#2a2a2e";
  for (const r of R.roadLines) { cx.fillRect(0, Z(r) - (ROAD / 2) * k, W, ROAD * k); cx.fillRect(X(r) - (ROAD / 2) * k, 0, ROAD * k, W); }
  // lots by owner: yours in the district colour, other players' grey, for sale outlined
  for (const l of LOTS) {
    const d = DISTRICTS[l.district], o = R.lotOwner(l), x = X(l.x - BLOCK / 2) + 2, z = Z(l.z - BLOCK / 2) + 2, s = BLOCK * k - 4;
    if (o && R.mine(l)) { cx.fillStyle = d.css; cx.fillRect(x, z, s, s); }
    else if (o) { cx.fillStyle = "#4a4a52"; cx.fillRect(x, z, s, s); }
    else { cx.strokeStyle = d.css; cx.lineWidth = 3; cx.strokeRect(x + 2, z + 2, s - 4, s - 4); }
  }
  cx.fillStyle = "rgba(201,168,76,.25)"; cx.fillRect(X(-33), Z(-33), 66 * k, 66 * k);
  cx.fillStyle = "#C9A84C"; cx.font = "bold 18px Inter,sans-serif"; cx.textAlign = "center"; cx.fillText("RB", X(0), Z(0) + 6);
  // drops, traffic, cops
  for (const d of R.drops) { cx.fillStyle = d.kind === "cash" ? "#00E676" : d.kind === "token" ? "#00BFFF" : "#F5D547"; cx.beginPath(); cx.arc(X(d.x), Z(d.z), 4, 0, 7); cx.fill(); }
  cx.fillStyle = "#8a8a8a"; for (const c of R.traffic) cx.fillRect(X(c.x) - 2, Z(c.z) - 2, 4, 4);
  const blink = Math.floor(t * 4) % 2;
  for (const c of R.cops) { cx.fillStyle = blink ? "#ff2a2a" : "#2a6bff"; cx.beginPath(); cx.arc(X(c.x), Z(c.z), 6, 0, 7); cx.fill(); }
  // the target: job or race checkpoint
  const tgt = R.job ? (R.job.stage ? R.job.b : R.job.a) : window.__rbRaceTarget || null;
  if (tgt) {
    const px = X(tgt[0]), pz = Z(tgt[1]), pulse = 8 + (t * 20) % 14;
    cx.strokeStyle = R.job && R.job.stage ? "#00E676" : "#F5D547"; cx.lineWidth = 3; cx.beginPath(); cx.arc(px, pz, pulse, 0, 7); cx.stroke();
    cx.fillStyle = cx.strokeStyle; cx.beginPath(); cx.arc(px, pz, 6, 0, 7); cx.fill();
  }
  // you: a gold arrow pointing where the car points
  const c = R.car, ax = X(c.x), az = Z(c.z), h = c.heading;
  cx.save(); cx.translate(ax, az); cx.rotate(-h + Math.PI);
  cx.fillStyle = "#F5E6A3"; cx.strokeStyle = "#000"; cx.lineWidth = 2; cx.beginPath(); cx.moveTo(0, -11); cx.lineTo(8, 9); cx.lineTo(0, 4); cx.lineTo(-8, 9); cx.closePath(); cx.fill(); cx.stroke();
  cx.restore();
  // speed and nitro
  document.getElementById("rb-kmh").textContent = Math.round(Math.abs(c.speed) * 3.6);
  document.querySelector("#rb-nitro i").style.width = Math.round((c.boost ?? 1) * 100) + "%";
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
    <tr><td><kbd>Shift</kbd> or <kbd>N</kbd></td><td>Nitro (the blue gauge refills)</td></tr>
    <tr><td><kbd>E</kbd></td><td>The lot you're next to: buy, build, manage</td></tr>
    <tr><td><kbd>C</kbd></td><td>Camera: chase, high, bonnet, free</td></tr>
    <tr><td><kbd>R</kbd></td><td>Start a street race</td></tr>
    <tr><td><kbd>H</kbd> / <kbd>Esc</kbd></td><td>This help / close a panel</td></tr>
    <tr><td>Phone</td><td>Stick to steer, GAS / BRAKE / DRIFT / NITRO on the right</td></tr>
    <tr><td>Controller</td><td>Left stick steer, RT gas, LT brake, A nitro, B drift, Y lot, Back camera, Start help</td></tr>
  </table>
  <h3>MAKING MONEY</h3><table>
    <tr><td>🔥 Hustle</td><td>Jobs: deliveries, VIP rides and heists. Heists bring the cops; stay away from them to lose your stars.</td></tr>
    <tr><td>🏠 Lots</td><td>Stop by a FOR SALE sign. Own all four of a colour for +50% customers. Others pay you rent when they stop on yours.</td></tr>
    <tr><td>🏢 Businesses</td><td>Build on your lot, set the price, hire talent, upgrade to ★★★★★, run marketing. They earn while you play, and a little while you're away.</td></tr>
    <tr><td>💰💎🃏 Drops</td><td>Drive through them. With location on, drops appear near where you really are too.</td></tr>
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
