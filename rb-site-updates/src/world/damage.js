// RB World car damage and car-to-car crashes. Hit the traffic, a cop or a wall hard and your car takes damage: grey
// smoke from the bonnet past half, black smoke near the end, and at 100% the engine dies (get out with F and take
// another car, or get it fixed). Cars bump each other apart instead of driving through each other, and a car you hit
// stops for a moment.
//   Fixing it: stop next to one of your own lots (free), or pay at any time from the 🔧 chip ($250 + $15 per 1%).
//   A car you take from the traffic starts undamaged; the damage stays with each car.
// With combat on (18+), bullets and blasts damage cars too (shootCar, blast; combat.js calls them): traffic, police
// cars and your own, parked or with you in it. Past half they smoke, at 100% the engine dies, and a traffic or police
// car shot up past that catches fire and blows up a moment later (combat.js runs the blast). Your own car stops at a
// dead engine instead: fix it as usual.
import * as THREE from "three";
import { on } from "./empire.js";

export function initDamage(E, ctx) {
  const car = E.car, P = ctx.player, scene = ctx.scene;
  const dmg = () => (car.mesh && car.mesh.userData.dmg) || 0;
  const setDmg = (v) => { if (!car.mesh) return; car.mesh.userData.dmg = Math.max(0, Math.min(100, v)); car.stall = car.mesh.userData.dmg >= 100; chipNow(); };
  const out = { damage: dmg, repair: () => repair(true), set: setDmg, shootCar, blast };
  const cost = () => Math.round(250 + dmg() * 15);

  // the chip: how bad it is, and a button to fix it
  const chip = document.createElement("button"); chip.type = "button"; chip.id = "rb-dmg";
  chip.style.cssText = "position:fixed;left:12px;bottom:calc(40px + env(safe-area-inset-bottom));z-index:6960;display:none;padding:7px 12px;border-radius:12px;border:1px solid rgba(255,140,60,.7);background:rgba(0,0,0,.8);color:#ffd2a8;font:800 11px/1.2 Inter,system-ui,sans-serif;cursor:pointer";
  document.body.appendChild(chip);
  const st = document.createElement("style"); st.textContent = "body.rb-touch #rb-dmg{bottom:calc(216px + env(safe-area-inset-bottom))!important}body.rb-onfoot #rb-dmg,body.rb-photo #rb-dmg,body:has(.overlay[style*=\"flex\"]) #rb-dmg{display:none!important}"; document.head.appendChild(st);
  function chipNow() {
    const d = Math.round(dmg());
    chip.style.display = d >= 10 ? "block" : "none";
    chip.textContent = d >= 100 ? `🔧 Engine wrecked · fix ${E.money(cost())}` : `🔧 Car damage ${d}% · fix ${E.money(cost())}`;
  }
  chip.addEventListener("click", () => repair(true));
  function repair(paid) {
    if (dmg() < 1) return;
    if (paid) { const c = cost(); if (P.netWorth < c) { E.toast(`You need ${E.money(c)} to fix it.`, true); return; } P.netWorth -= c; ctx.sync && ctx.sync(); }
    setDmg(0); E.toast(paid ? "🔧 Fixed. Good as new." : "🔧 Fixed for free at your lot.");
    ctx.play && ctx.play("cash", 0.3);
  }
  function hurt(hit) {
    if (car.onFoot || !car.mesh) return;
    const before = dmg(); setDmg(before + Math.max(0, hit - 5) * 1.6 * (1 - ((car.tune && car.tune.armour) || 0) * 0.2)); // RB Customs armour takes the edge off
    if (before < 100 && dmg() >= 100) E.toast("💥 The engine's wrecked. Get out (F) and take another car, or fix it from the 🔧 chip.", true);
  }
  on("crash", hurt);

  // ---------------------------------------------------------------- shot up: bullets and blasts (combat.js)
  const WRECK = 100, BOOM = 160;
  const isOwn = (m) => m === car.mesh || !!(window.RBFoot && window.RBFoot.parked && window.RBFoot.parked.mesh === m);
  // c: a traffic or police car, your parked car (onfoot.js parked) or { mesh: car.mesh } for the one you're in
  function shootCar(c, n) {
    const m = c && c.mesh; if (!m || m.userData.burnt || !(n > 0)) return;
    const own = isOwn(m), before = m.userData.dmg || 0, soak = m === car.mesh && car.tune ? ((car.tune.armour || 0) * 0.2) : 0;
    m.userData.dmg = Math.min(own ? WRECK : BOOM, before + n * (1 - soak));
    if (m === car.mesh) { setDmg(m.userData.dmg); if (before < WRECK && dmg() >= WRECK) E.toast("💥 The engine's shot to pieces. Get out (F) and take another car, or fix it from the 🔧 chip.", true); return; }
    if (own) return;
    if (before < WRECK && m.userData.dmg >= WRECK) { c.wrecked = true; c.speed = 0; c.held = 1e9; }
    if (m.userData.dmg >= BOOM && !c.boomAt) c.boomAt = performance.now() + 700 + Math.random() * 900; // it burns for a moment first
  }
  // a blast at `at` (THREE.Vector3): every car within reach takes some of it, more the closer it is
  function blast(at, r, n) {
    const reach = r + 1.5, list = [...E.traffic(), ...E.cops()];
    const pk = window.RBFoot && window.RBFoot.parked; if (pk) list.push(pk);
    if (!car.onFoot && car.mesh) list.push({ mesh: car.mesh, x: car.x, z: car.z });
    for (const c of list) { const d = Math.hypot(c.x - at.x, c.z - at.z); if (d < reach) shootCar(c, n * (1 - d / reach) * 0.9); }
  }
  // burnt out: blackened, smoking, going nowhere until the traffic replaces it out of sight
  function burn(c) {
    const m = c.mesh; m.userData.burnt = true; c.wrecked = true; c.speed = 0; c.held = 1e9; c.burnT = 25;
    // matte charcoal: no clearcoat or reflections left
    m.traverse((o) => { if (!o.isMesh || !o.material || Array.isArray(o.material)) return; const k = o.material = o.material.clone();
      if (k.color) k.color.multiplyScalar(0.1).add(new THREE.Color(0x0d0b09)); if (k.emissive) k.emissive.setHex(0);
      if ("roughness" in k) k.roughness = 1; if ("metalness" in k) k.metalness = 0; if ("clearcoat" in k) k.clearcoat = 0; if ("envMapIntensity" in k) k.envMapIntensity = 0.1; if ("transmission" in k) k.transmission = 0; });
    if (window.RBCombat && window.RBCombat.carBoom) window.RBCombat.carBoom([c.x, c.z]);
  }

  // ---------------------------------------------------------------- smoke
  const smoke = [], geo = new THREE.SphereGeometry(0.35, 7, 5);
  let smokeT = 0;
  function puff(dark, at, fire) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: fire ? 0xff7a1a : dark ? 0x1a1a1a : 0x9a9a9a, transparent: true, opacity: 0.55, depthWrite: false }));
    if (at) m.position.set(at[0], at[1], at[2]);
    else { const h = car.heading, len = (car.mesh.userData.len || 4.4) / 2 - 0.4; m.position.set(car.x + Math.sin(h) * len, 1.1, car.z + Math.cos(h) * len); }
    m.userData.noAO = true; scene.add(m);
    smoke.push({ m, t: fire ? 0.6 : 1.6 });
  }
  // the other cars: smoke past half, flames once it's going to blow, then it does
  function shotCarsTick(dt) {
    const now = performance.now(), list = [...E.traffic(), ...E.cops()];
    const pk = window.RBFoot && window.RBFoot.parked; if (pk) list.push(pk);
    for (const c of list) {
      const m = c.mesh, d = (m && m.userData.dmg) || 0; if (!m || d <= 50 || Math.hypot(c.x - car.x, c.z - car.z) > 160) continue;
      if (c.boomAt && now >= c.boomAt && !m.userData.burnt) { c.boomAt = 0; burn(c); }
      const burning = !!c.boomAt, burnt = !!m.userData.burnt;
      if (burnt) { c.burnT -= dt; if (c.burnT <= 0) continue; }
      c.smokeT = (c.smokeT || 0) - dt * (burning ? 6 : d >= WRECK || burnt ? 3 : 1.4);
      if (c.smokeT <= 0) { c.smokeT = 0.2; const h = m.rotation.y, len = 1.6; puff(d >= 80 || burnt, [c.x + Math.sin(h) * len, 1.1, c.z + Math.cos(h) * len], burning && Math.random() < 0.6); }
    }
  }

  // ---------------------------------------------------------------- bumping into cars
  const R = 2.3, CITY = E.city;
  const MASS = { sport: 1.2, sedan: 1.4, suv: 1.9, van: 2.2 }; // tonnes, roughly
  ctx.onFrame((dt) => {
    dt = Math.min(dt, 0.1);
    if (!car.onFoot && car.mesh && !car.photo) {
      for (const c of [...E.traffic(), ...E.cops()]) {
        const dx = c.x - car.x, dz = c.z - car.z, d = Math.hypot(dx, dz);
        if (d > R || d < 0.01) continue;
        const nx = dx / d, nz = dz / d;
        // closing speed along the line between the two cars
        const cv = Math.max(0, c.speed || 0), cvx = Math.sin(c.mesh.rotation.y) * cv, cvz = Math.cos(c.mesh.rotation.y) * cv;
        const rel = (car.vx - cvx) * nx + (car.vz - cvz) * nz;
        // push apart (the lighter car moves more), then an impulse along the line between them: each car's
        // velocity changes by its share, and a hit off-centre sets both spinning
        const mP = MASS[car.mesh.userData.kind] || 1.3, mT = MASS[c.mesh.userData.kind] || 1.3, inv = 1 / mP + 1 / mT;
        const push = R - d; car.x -= nx * push * (1 / mP) / inv; car.z -= nz * push * (1 / mP) / inv; c.x += nx * push * (1 / mT) / inv; c.z += nz * push * (1 / mT) / inv;
        if (rel > 0) {
          const J = (1 + 0.35) * rel / inv;
          car.vx -= nx * J / mP; car.vz -= nz * J / mP;
          const fx = Math.sin(car.heading), fz = Math.cos(car.heading), side = fx * nz - fz * nx; // which side of your car took it
          car.spin = (car.spin || 0) + side * (J / mP) * 0.09;
          const kv = J / mT; c.knock = { vx: nx * kv, vz: nz * kv, spin: -side * kv * 0.9, t: 0.7 };
          c.speed = c.cop ? c.speed * 0.6 : 0; c.held = 2.5;
        }
        if (rel > 4) { E.emit("crash", rel); if (rel > 10) ctx.play && ctx.play("alert", 0.2); }
      }
    }
    // a car you hit is shoved and spun, then waits a moment before it drives on
    for (const c of [...E.traffic(), ...E.cops()]) {
      if (c.held > 0 && !c.cop) { c.held -= dt; c.speed = 0; }
      const k = c.knock; if (!k) continue;
      // the traffic code steers the body back towards the road, so the spin shows while it's knocked and then settles
      k.t -= dt; const nx = c.x + k.vx * dt, nz = c.z + k.vz * dt; if (!CITY.blocked(nx, nz, 1)) { c.x = nx; c.z = nz; }
      k.vx *= Math.pow(0.08, dt); k.vz *= Math.pow(0.08, dt); c.mesh.rotation.y += k.spin * dt; k.spin *= Math.pow(0.15, dt);
      if (k.t <= 0) c.knock = null;
    }
    shotCarsTick(dt);
    // smoke from a damaged car
    const d = dmg();
    if (!car.onFoot && car.mesh && d > 50) { smokeT -= dt * (d > 80 ? 3 : 1.4); if (smokeT <= 0) { smokeT = 0.18; puff(d > 80); } }
    for (let i = smoke.length - 1; i >= 0; i--) { const s = smoke[i]; s.t -= dt; s.m.position.y += dt * 1.6; s.m.scale.multiplyScalar(1 + dt * 0.9); s.m.material.opacity = Math.max(0, s.t / 1.6) * 0.55; if (s.t <= 0) { scene.remove(s.m); s.m.material.dispose(); smoke.splice(i, 1); } }
    // free fix next to one of your lots, once you've stopped
    if (d > 0 && !car.onFoot && Math.abs(car.speed) < 1 && E.nearMine && E.nearMine()) repair(false);
  });
  // the car changed (you took another, or got back in yours): show its own damage
  on("on-foot", () => { car.stall = dmg() >= 100; chipNow(); });
  on("carjack", () => { car.stall = dmg() >= 100; chipNow(); });
  chipNow();
  return out;
}
