// The Bay Area's real costs of getting round, in game money (bay_data.js has every figure with its source and date):
//   - Bridge tolls: all eight toll bridges charge what they really charge, in the direction they really charge
//     (crossing the middle of the bridge going that way), by FasTrak, licence plate (pay as you go) or invoice; pick
//     which in 🌉 Bay Area in the phone. The game has no passengers, so no carpool rate.
//   - Fuel: every car has a tank and a typical fuel economy for its class; nitro burns more. Out of fuel, the engine
//     stops. Fill up at a real petrol station from the map (stop next to it): the price is AAA's average for that
//     area (San Francisco, Oakland, San Jose, Contra Costa County) or the California average elsewhere, and says so.
//   - Where you are: the town, its typical home value and rent (Zillow), shown when you arrive and in the app.
import * as CITY from "./city.js";
import { AS_OF, COUNTIES, CITIES, GAS, BRIDGES } from "./bay_data.js";

const SAVE = "rb_bay_v1", FUEL_SAVE = "rb_fuel_v1";
// typical tank (US gallons) and combined fuel economy (mpg) for each class of car in the game
const TANK = { sport: { gal: 16, mpg: 21 }, sedan: { gal: 14, mpg: 30 }, suv: { gal: 19, mpg: 22 }, van: { gal: 22, mpg: 17 } };
const PAY = { fastrak: "FasTrak", plate: "Licence plate (pay as you go)", invoice: "Toll invoice" };
const usd = (n) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = (n) => "$" + Math.round(n).toLocaleString("en-US");
const load = (k, d) => { try { return Object.assign(d, JSON.parse(localStorage.getItem(k) || "{}")); } catch (e) { return d; } };
const keep = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

export function initBay(E, ctx, foot, stream) {
  const car = E.car, P = ctx.player;
  const S = load(SAVE, { pay: "fastrak", paid: 0, trips: [] });
  const fuel = load(FUEL_SAVE, { own: null });
  const out = { S, fuel, area: { town: "Vallejo", county: "Solano" }, open, gasHere, cityInfo, tollFor: (b) => b[S.pay] };

  // ---------------------------------------------------------------- where you are
  function cityInfo(name) { const c = name && CITIES[name]; return c ? { name, county: COUNTIES[c[0]], home: c[1], rent: c[2] } : null; }
  function gasHere() { const g = GAS[out.area.county] || GAS.california; return g; }
  let lastTown = null, townAt = 0;
  function whereAmI() {
    let town = null;
    if (stream && !stream.inCore(car.x, car.z)) { const p = stream.place(car.x, car.z); town = p.town; }
    else town = "Vallejo";
    const info = cityInfo(town);
    out.area = { town: town || out.area.town, county: info ? info.county : out.area.county, info };
    if (town && town !== lastTown && performance.now() - townAt > 8000) {
      townAt = performance.now();
      if (lastTown && info) E.toast(`📍 ${town} · typical home ${whole(info.home)}${info.rent ? ` · rent ${whole(info.rent)}/mo` : ""} (Zillow, ${AS_OF.homes})`);
      lastTown = town;
    }
  }

  // ---------------------------------------------------------------- tolls
  const spans = BRIDGES.map((b) => { const A = CITY.fromLngLat(b.a[1], b.a[0]), B = CITY.fromLngLat(b.b[1], b.b[0]); return { b, A, B, L: Math.hypot(B[0] - A[0], B[1] - A[1]), tol: b.key === "bay" ? 800 : 160, last: null }; });
  function tolls() {
    if (foot.on) { for (const s of spans) s.last = null; return; }
    for (const s of spans) {
      const dx = s.B[0] - s.A[0], dz = s.B[1] - s.A[1], px = car.x - s.A[0], pz = car.z - s.A[1];
      const t = (px * dx + pz * dz) / (s.L * s.L), lat = Math.abs(px * dz - pz * dx) / s.L;
      if (lat > s.tol || t < -0.05 || t > 1.05) { s.last = null; continue; }
      if (s.last != null && s.last < 0.5 && t >= 0.5) charge(s.b);
      s.last = t;
    }
  }
  function charge(b) {
    const rate = b[S.pay], paid = Math.min(rate, Math.max(0, P.netWorth));
    P.netWorth -= paid; S.paid = Math.round((S.paid + paid) * 100) / 100;
    S.trips.unshift({ k: b.key, at: Date.now(), r: rate }); S.trips = S.trips.slice(0, 12); keep(SAVE, S);
    ctx.sync && ctx.sync(); ctx.play && ctx.play("cash", 0.3);
    E.toast(`🌉 ${b.name} toll: ${usd(rate)} (${PAY[S.pay]}, ${b.dir})`);
    E.emit("toll", { bridge: b.key, rate });
  }

  // ---------------------------------------------------------------- fuel
  let meshNow = null;
  const spec = () => TANK[(car.mesh && car.mesh.userData.kind) || "sedan"] || TANK.sedan;
  function fuelTick(dt) {
    // a different car: yours keeps its own tank; one taken from the traffic has whatever was in it
    if (car.mesh !== meshNow) {
      if (meshNow && meshNow.userData.personal) fuel.own = car.fuelGal;
      meshNow = car.mesh;
      const own = !!(car.mesh && car.mesh.userData.personal);
      car.fuelGal = own ? (fuel.own != null ? fuel.own : spec().gal * 0.75) : spec().gal * (0.3 + Math.random() * 0.6);
    }
    if (foot.on) return;
    const sp = spec(), miles = (Math.abs(car.speed || 0) * dt) / 1609.34;
    const idle = Math.abs(car.speed || 0) < 0.5 ? 0.25 / 3600 * dt : 0; // about a quarter of a gallon an hour at a standstill
    car.fuelGal = Math.max(0, car.fuelGal - (miles / sp.mpg) * (car.boosting ? 1.8 : 1) - idle);
    car.empty = car.fuelGal <= 0.001;
    if (car.mesh && car.mesh.userData.personal) fuel.own = car.fuelGal;
    const pct = car.fuelGal / sp.gal, bar = document.querySelector("#rb-fuel i");
    if (bar) { bar.style.width = Math.round(pct * 100) + "%"; bar.style.background = pct < 0.12 ? "#ff5252" : "#F5D547"; }
    if (pct < 0.1 && !warned) { warned = true; E.toast("⛽ Low on fuel. Find a petrol station (the ⛽ on the street)."); }
    if (pct > 0.2) warned = false;
  }
  let warned = false;
  setInterval(() => keep(FUEL_SAVE, fuel), 10000);

  // the station you've stopped at
  const chip = document.createElement("div"); chip.id = "rb-gas";
  chip.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:calc(150px + env(safe-area-inset-bottom));z-index:7000;display:none;background:rgba(10,10,10,.88);border:1px solid #F5D547;border-radius:12px;padding:8px 12px;color:#fff;font:700 12px/1.35 Inter,sans-serif;text-align:center;max-width:90vw";
  document.body.appendChild(chip);
  const css = document.createElement("style");
  css.textContent = "#rb-fuel{height:4px;border-radius:3px;background:rgba(255,255,255,.15);overflow:hidden;margin-top:3px}#rb-fuel i{display:block;height:100%;background:#F5D547}#rb-gas button{margin-left:8px;border:0;border-radius:8px;padding:6px 10px;background:#F5D547;color:#000;font:900 11px Inter,sans-serif;cursor:pointer}body.rb-photo #rb-gas,body:has(#rb-phone.open) #rb-gas{display:none!important}";
  document.head.appendChild(css);
  const sp0 = document.getElementById("rb-speed"); if (sp0 && !document.getElementById("rb-fuel")) { const f = document.createElement("div"); f.id = "rb-fuel"; f.title = "Fuel"; f.innerHTML = "<i></i>"; sp0.appendChild(f); }
  let station = null;
  function stationTick() {
    station = !foot.on && Math.abs(car.speed || 0) < 1.5 && stream ? stream.fuelNear(car.x, car.z, 28) : null;
    if (!station) { chip.style.display = "none"; return; }
    const g = gasHere(), need = Math.max(0, spec().gal - car.fuelGal), cost = need * g.price;
    chip.style.display = "block";
    chip.innerHTML = `⛽ <b>${esc(station.name)}</b> · ${usd(g.price)}/gal <span style="color:#bbb">(AAA average, ${g.where}, ${AS_OF.gas})</span>` +
      (need < 0.05 ? " · Tank full" : `<br>Fill ${need.toFixed(1)} gal for <b>${usd(cost)}</b><button type="button" data-fill>FILL UP (U)</button>`);
    const b = chip.querySelector("[data-fill]"); if (b) b.onclick = fill;
  }
  function fill() {
    if (!station) return;
    const g = gasHere(), need = Math.max(0, spec().gal - car.fuelGal);
    let gal = need; if (need * g.price > P.netWorth) gal = Math.max(0, P.netWorth / g.price);
    if (gal < 0.05) { E.toast("Not enough money for fuel."); return; }
    P.netWorth -= gal * g.price; car.fuelGal += gal; car.empty = false; if (car.mesh && car.mesh.userData.personal) fuel.own = car.fuelGal; keep(FUEL_SAVE, fuel);
    ctx.sync && ctx.sync(); ctx.play && ctx.play("cash", 0.4);
    E.toast(`⛽ ${gal.toFixed(1)} gal at ${usd(g.price)}: ${usd(gal * g.price)}`); E.emit("fuel", gal);
  }
  window.addEventListener("keydown", (e) => { if (e.code === "KeyU" && station && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "")) fill(); });
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ---------------------------------------------------------------- the 🌉 Bay Area app
  function open() {
    whereAmI();
    const a = out.area, i = a.info, g = gasHere(), sp = spec();
    const rows = BRIDGES.map((b) => `<tr><td>${b.name}</td><td style="text-align:right"><b>${usd(b[S.pay])}</b></td><td class="rb-muted">${b.dir}</td></tr>`).join("");
    const opts = Object.entries(PAY).map(([k, v]) => `<button type="button" class="${S.pay === k ? "rb-btn" : "btn-ghost"}" data-e="pay-${k}" style="margin:3px">${v}</button>`).join("");
    E.panel(`<h2>🌉 BAY AREA</h2>
      <div class="rb-card" style="display:block"><b>📍 ${esc(a.town)}</b>${a.county ? ` · ${a.county} County` : ""}
        ${i ? `<div class="rb-muted">Typical home value <b>${whole(i.home)}</b>${i.rent ? ` · typical rent <b>${whole(i.rent)}</b>/month` : ""} (Zillow, ${AS_OF.homes})</div>` : `<div class="rb-muted">No Zillow figures for this place.</div>`}
        <div class="rb-muted">Regular gas <b>${usd(g.price)}</b>/gal (AAA average, ${g.where}, ${AS_OF.gas})</div>
        <div class="rb-muted">Your tank: ${(car.fuelGal || 0).toFixed(1)} of ${sp.gal} gal · about ${sp.mpg} mpg</div></div>
      <h3 style="font:800 11px Inter,sans-serif;color:var(--gold);letter-spacing:2px;margin:14px 0 6px">BRIDGE TOLLS · YOU PAY BY</h3><div>${opts}</div>
      <table style="width:100%;font-size:12px;margin-top:6px">${rows}</table>
      <div class="rb-muted" style="margin-top:6px">Charged one way only, the way shown. Tolls paid so far: <b>${usd(S.paid)}</b>.</div>
      <div class="rb-muted" style="margin-top:10px;font-size:10px">Sources: Bay Area Toll Authority and Golden Gate Bridge District (2026 tolls), 511.org (directions), AAA (gas, ${AS_OF.gas}), Zillow Home Value and Observed Rent Indexes (${AS_OF.homes}). Map © OpenStreetMap contributors. All money in the game is game money.</div>
      <button class="btn-ghost" data-e="x">CLOSE</button>`,
      { x: E.hidePanel, ...Object.fromEntries(Object.keys(PAY).map((k) => ["pay-" + k, () => { S.pay = k; keep(SAVE, S); open(); }])) });
  }

  let acc = 0;
  ctx.onFrame((dt) => {
    dt = Math.min(dt, 0.1);
    fuelTick(dt); tolls();
    acc += dt; if (acc > 0.5) { acc = 0; whereAmI(); stationTick(); }
  });
  return out;
}
