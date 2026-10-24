// Things that happen on the street while you play (game money only, on this device):
//   - Cash crates: every few minutes a crate lands somewhere near you, marked green. Get to it within three minutes.
//   - Speed cameras: four on long straight roads, yellow on the radar. Go past one at 120 km/h or more (nitro) for a
//     bonus that grows with your speed; your best at each is kept.
//   - Armored truck (combat on only): a cash van drives the streets now and then, orange on the radar. Ram it to stop
//     it, deal with the guards who get out, and pick up the cash bags. The police take an interest.
import * as THREE from "three";
import { buildCar } from "./cars.js";

const TRAPS_KEY = "rb_traps_v1";
const rnd = (a, b) => a + Math.random() * (b - a);

export function initEvents(E, ctx, foot, combat) {
  const car = E.car, CITY = E.city, P = ctx.player, scene = ctx.scene;
  const out = { crate: null, truck: null, traps: [], best: {}, dropCrate: () => dropCrate(), spawnTruck: () => spawnTruck() };
  try { out.best = JSON.parse(localStorage.getItem(TRAPS_KEY) || "{}") || {}; } catch (e) {}
  const pay = (v, text) => { P.netWorth += v; ctx.sync && ctx.sync(); ctx.play && ctx.play("cash"); E.toast(text); };

  // ---------------------------------------------------------------- cash crates
  const crateMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.8 }), strapMat = new THREE.MeshStandardMaterial({ color: 0xC9A84C, metalness: 0.8, roughness: 0.3 });
  let crateIn = 60;
  function dropCrate() {
    const at = CITY.roadPoint({ away: [car.x, car.z], minFrom: 150, near: [car.x, car.z], maxFrom: 450 });
    const g = new THREE.Group(), box = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), crateMat); box.castShadow = true; g.add(box);
    for (const r of [0, Math.PI / 2]) { const s = new THREE.Mesh(new THREE.BoxGeometry(1.24, 1.24, 0.12), strapMat); s.rotation.y = r; g.add(s); }
    const col = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 1.8, 60, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0x00E676, transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
    col.position.y = 30; col.userData.noAO = true; g.add(col);
    g.position.set(at[0], 0.6, at[1]); scene.add(g);
    out.crate = { at, g, t: 180, v: Math.round(rnd(15, 40)) * 100 };
    E.toast(`📦 A cash crate has landed ${Math.round(Math.hypot(at[0] - car.x, at[1] - car.z))} m away. Green on the radar, 3 minutes.`);
  }
  function crateTick(dt) {
    const c = out.crate;
    if (!c) { crateIn -= dt; if (crateIn <= 0) { crateIn = rnd(150, 270); dropCrate(); } return; }
    c.t -= dt; c.g.rotation.y += dt * 0.6;
    if (Math.hypot(c.at[0] - car.x, c.at[1] - car.z) < 4) { pay(c.v, `📦 Cash crate: +${E.money(c.v)}`); E.emit("crate", c.v); scene.remove(c.g); out.crate = null; }
    else if (c.t <= 0) { scene.remove(c.g); out.crate = null; E.toast("📦 The cash crate's gone."); }
  }

  // ---------------------------------------------------------------- speed cameras
  // the four longest straight roads, spread out (the same for everyone)
  const long = CITY.edges.map((e, i) => ({ e, i })).filter(({ e }) => e.cls !== "service" && e.len > 70).sort((a, b) => b.e.len - a.e.len);
  for (const { e, i } of long) {
    if (out.traps.length >= 4) break;
    const A = CITY.nodes[e.a], B = CITY.nodes[e.b], x = (A[0] + B[0]) / 2, z = (A[1] + B[1]) / 2;
    if (out.traps.some((t) => Math.hypot(t.x - x, t.z - z) < 350)) continue;
    const h = Math.atan2(B[0] - A[0], B[1] - A[1]), sx = Math.cos(h) * (e.w / 2 + 1.5), sz = -Math.sin(h) * (e.w / 2 + 1.5); // on the kerb
    const g = new THREE.Group(), pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4.2, 8), new THREE.MeshStandardMaterial({ color: 0x777777, metalness: 0.7, roughness: 0.4 }));
    pole.position.y = 2.1; g.add(pole);
    const cam = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.7), new THREE.MeshStandardMaterial({ color: 0xF5D547, roughness: 0.5 })); cam.position.set(0, 4.2, 0); g.add(cam);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a2a })); lamp.position.set(0, 4.45, 0.25); g.add(lamp);
    g.position.set(x + sx, 0, z + sz); g.rotation.y = h; scene.add(g);
    out.traps.push({ id: "t" + i, x, z, g, lamp, cool: 0, flash: 0 });
  }
  function trapsTick(dt) {
    const kmh = Math.abs(car.speed || 0) * 3.6;
    for (const t of out.traps) {
      t.cool -= dt; t.flash -= dt; t.lamp.material.color.setHex(t.flash > 0 ? 0xffffff : 0xff2a2a);
      if (foot.on || t.cool > 0 || Math.hypot(t.x - car.x, t.z - car.z) > 12 || kmh < 40) continue;
      t.cool = 20; t.flash = 0.25;
      const v = Math.round(kmh), best = out.best[t.id] || 0;
      if (v > best) { out.best[t.id] = v; try { localStorage.setItem(TRAPS_KEY, JSON.stringify(out.best)); } catch (e) {} }
      if (v >= 120) { const bonus = 500 + Math.round(((v - 120) * 40) / 100) * 100; pay(bonus, `📸 Speed camera: ${v} km/h${v > best ? " (your best here)" : ""}. +${E.money(bonus)}`); E.emit("speed-trap", v); }
      else E.toast(`📸 Speed camera: ${v} km/h. Hit 120+ for a bonus.`);
    }
  }

  // ---------------------------------------------------------------- the armored truck
  let truckIn = rnd(240, 360);
  function spawnTruck() {
    // a junction 150-350 m away, driving off along the streets
    const ok = [];
    for (let i = 0; i < CITY.nodes.length; i++) { const d = Math.hypot(CITY.nodes[i][0] - car.x, CITY.nodes[i][1] - car.z); if (d > 150 && d < 350 && CITY.links[i].length) ok.push(i); }
    if (!ok.length) return;
    const n = ok[Math.floor(Math.random() * ok.length)];
    const mesh = buildCar(0x2b2f36, { kind: "van" }); scene.add(mesh);
    const [x, z] = CITY.nodes[n];
    out.truck = { mesh, x, z, h: 0, from: n, to: CITY.links[n][0].to, stage: "drive", t: 240, guards: [], bags: 0 };
    E.toast("🚚 An armored truck is on the move (orange on the radar). Ram it to stop it.", true);
  }
  function truckTick(dt) {
    const k = out.truck;
    if (!k) { if (combat && combat.on && !combat.mission) { truckIn -= dt; if (truckIn <= 0) { truckIn = rnd(300, 480); spawnTruck(); } } return; }
    if (!combat || !combat.on) return endTruck();
    k.t -= dt;
    const d = Math.hypot(k.x - car.x, k.z - car.z);
    if (k.stage === "drive") {
      const T = CITY.nodes[k.to], dx = T[0] - k.x, dz = T[1] - k.z, dd = Math.hypot(dx, dz), step = 11 * dt;
      if (dd < step + 0.5) { const nx = CITY.links[k.to].filter((l) => l.to !== k.from); const pick = (nx.length ? nx : CITY.links[k.to])[Math.floor(Math.random() * (nx.length || CITY.links[k.to].length))]; k.from = k.to; k.to = pick ? pick.to : k.from; }
      else { k.x += (dx / dd) * step; k.z += (dz / dd) * step; let dh = Math.atan2(dx, dz) - k.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); k.h += dh * Math.min(1, dt * 5); }
      k.mesh.position.set(k.x, 0, k.z); k.mesh.rotation.y = k.h;
      if (!foot.on && d < 4.2 && Math.abs(car.speed || 0) > 5) {
        k.stage = "guards"; car.speed *= 0.3; E.setWanted(Math.max(E.wanted(), 2));
        for (const s of [-1, 1, 0]) { const gx = k.x + Math.cos(k.h) * s * 2.2 - Math.sin(k.h) * (s ? 0 : 3.5), gz = k.z - Math.sin(k.h) * s * 2.2 - Math.cos(k.h) * (s ? 0 : 3.5); const e = combat.spawnEnemy(gx, gz, s ? "smg" : "rifle", true); e.alert = true; k.guards.push(e); }
        E.toast("🚚 Truck stopped. Guards! Take them out, then grab the cash.", true);
      }
      if (k.t <= 0 || d > 900) { E.toast("🚚 The armored truck got away."); return endTruck(); }
    } else if (k.stage === "guards" && k.guards.every((e) => e.dead)) {
      k.stage = "cash"; k.t = 60;
      for (let i = 0; i < 3; i++) combat.dropCash(k.x - Math.sin(k.h) * (3.4 + i * 0.4) + rnd(-0.6, 0.6), k.z - Math.cos(k.h) * (3.4 + i * 0.4) + rnd(-0.6, 0.6), Math.round(rnd(20, 35)) * 100);
      E.toast("💵 The back's open. Get out (F) and pick up the cash bags.");
      E.emit("truck");
    } else if (k.stage === "cash" && k.t <= 0) endTruck();
    else if (k.stage === "guards" && k.t <= -120) endTruck();
  }
  function endTruck() { const k = out.truck; if (!k) return; scene.remove(k.mesh); for (const e of k.guards) if (!e.dead) { e.dead = true; e.deadT = 13.5; } out.truck = null; }

  // ---------------------------------------------------------------- radar and every frame
  ctx.onFrame((dt) => {
    dt = Math.min(dt, 0.1);
    crateTick(dt); trapsTick(dt); truckTick(dt);
    const b = [];
    if (out.crate) b.push({ x: out.crate.at[0], z: out.crate.at[1], c: "#00E676", r: 6 });
    for (const t of out.traps) b.push({ x: t.x, z: t.z, c: "#F5D547", r: 3.5 });
    if (out.truck) b.push({ x: out.truck.x, z: out.truck.z, c: "#ff8a3b", r: 6 });
    window.__rbBlips2 = b;
  });
  return out;
}
