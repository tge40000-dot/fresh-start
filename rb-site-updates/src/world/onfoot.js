// RB World on foot (GTA-style): get out of the car with F (or the GET OUT button), walk, jog and sprint the
// streets, and get back in with F next to your car, or take any car from the traffic (the driver jumps out and runs).
//   - While you're out, `E.car` follows you (so lots, drops, jobs, cops and the radar all work on foot); the car you
//     left stays parked where it was (`out.parked`).
//   - Camera: behind your shoulder; turn it with the mouse (click the game to lock the pointer, Esc to let go) or by
//     dragging, or by dragging on the right half of a phone screen. The stick or WASD moves you relative to it.
//   - Shift sprints, Space jumps. Not during a race, a race countdown or photo mode.
// combat.js adds aiming and shooting on top (out.aim, out.onShoot), for players who've opted in to 18+ combat.
import * as THREE from "three";
import { person, pose, tag } from "./char.js";
import { joy } from "./empire.js";

const WALK = 1.9, JOG = 4.2, SPRINT = 7.2, GRAVITY = 22;
const keys = {};
const typing = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");

export function initFoot(E, ctx) {
  const car = E.car, CITY = E.city, cam = E.camera;
  const me = person({ top: 0xf2f2f2, jacket: 0x121212, pants: 0x1c2a44, shoes: 0x0b0b0b, skin: 0x8d5524, hair: 0x0d0d0d, style: "short", beard: true }); // white tee, black jacket, dark denim
  me.visible = false; ctx.scene.add(me);
  const out = {
    on: false, me, yaw: 0, pitch: -0.12, h: 0, speed: 0, y: 0, vy: 0, parked: null, aim: false, sprint: false,
    vehicle: () => (out.on && out.parked ? [out.parked.x, out.parked.z, out.parked.h, 0] : [car.x, car.z, car.heading, car.speed]),
    exit, enter, onShoot: null, onEnter: [], onExit: [],
  };
  const blocked = (x, z) => CITY.blocked(x, z, 0.32);
  const busy = () => car.lock || car.photo || (window.RBRace && window.RBRace.state && window.RBRace.state.race);

  // ------------------------------------------------------------ getting out
  function exit() {
    if (out.on || busy()) return false;
    if (Math.abs(car.speed) > 9) { E.toast("Slow down to get out."); return false; }
    const h = car.heading, lx = Math.cos(h), lz = -Math.sin(h); // the driver's door is on the left
    let px = car.x + lx * 1.5, pz = car.z + lz * 1.5;
    if (blocked(px, pz)) { px = car.x - lx * 1.5; pz = car.z - lz * 1.5; }
    if (blocked(px, pz)) { px = car.x - Math.sin(h) * 3.2; pz = car.z - Math.cos(h) * 3.2; }
    out.parked = { mesh: car.mesh, x: car.x, z: car.z, h };
    car.vx = car.vz = 0; car.speed = 0; car.boosting = false; car.drift = 0;
    car.x = px; car.z = pz; car.onFoot = true;
    out.on = true; out.h = h; out.yaw = h; out.pitch = -0.12; out.y = 0; out.vy = 0;
    me.position.set(px, 0, pz); me.rotation.y = h; me.visible = true;
    document.body.classList.add("rb-onfoot");
    out.onExit.forEach((f) => f());
    E.emit("on-foot", true);
    return true;
  }

  // ------------------------------------------------------------ getting in: your car, or one from the traffic
  function nearestCar() {
    let best = null, bd = 3.6;
    if (out.parked) { const d = Math.hypot(out.parked.x - car.x, out.parked.z - car.z); if (d < bd) { bd = d; best = { own: true }; } }
    for (const c of E.traffic()) { const d = Math.hypot(c.x - car.x, c.z - car.z); if (d < bd) { bd = d; best = { traffic: c }; } }
    return best;
  }
  function enter() {
    if (!out.on) return false;
    const n = nearestCar();
    if (!n) { E.toast("No car close enough. Walk up to one and press F."); return false; }
    if (n.own) { car.x = out.parked.x; car.z = out.parked.z; car.heading = out.parked.h; }
    else {
      const c = E.takeTraffic(n.traffic); if (!c) return false;
      // the driver gets out and runs for it; your own car stays parked where you left it
      driverBails(c);
      const old = E.useCarMesh(c.mesh);
      if (old && old !== c.mesh) left.push(old);
      out.parked = null;
      car.x = c.x; car.z = c.z; car.heading = Math.atan2(Math.sin(c.mesh.rotation.y), Math.cos(c.mesh.rotation.y));
      E.toast("🚗 You took the car. Your own is still parked where you left it.");
      E.emit("carjack");
    }
    if (n.own && out.parked.mesh !== car.mesh) { const old = E.useCarMesh(out.parked.mesh); if (old && !left.includes(old)) left.push(old); }
    car.vx = car.vz = 0; car.speed = 0; car.onFoot = false;
    out.on = false; out.parked = null; out.aim = false; me.visible = false;
    document.body.classList.remove("rb-onfoot");
    if (document.pointerLockElement) document.exitPointerLock();
    out.onEnter.forEach((f) => f());
    E.emit("on-foot", false);
    return true;
  }
  // cars you've left behind (your own after taking another): back to your own with F, or gone once far away
  const left = [];
  setInterval(() => { for (let i = left.length - 1; i >= 0; i--) { const m = left[i]; if (m === car.mesh || (out.parked && out.parked.mesh === m)) { left.splice(i, 1); continue; } if (Math.hypot(m.position.x - car.x, m.position.z - car.z) > 600) { ctx.scene.remove(m); left.splice(i, 1); } } }, 3000);
  // ... and while they're near you can get back into them
  const nearLeft = () => left.find((m) => Math.hypot(m.position.x - car.x, m.position.z - car.z) < 3.6);
  // F on foot: the closest of your parked car, a car you left earlier, or one from the traffic
  function getIn() {
    const m = nearLeft(), n = nearestCar();
    const dm = m ? Math.hypot(m.position.x - car.x, m.position.z - car.z) : Infinity;
    const dn = n ? (n.own ? Math.hypot(out.parked.x - car.x, out.parked.z - car.z) : Math.hypot(n.traffic.x - car.x, n.traffic.z - car.z)) : Infinity;
    if (m && dm < dn) {
      left.splice(left.indexOf(m), 1);
      if (out.parked && out.parked.mesh !== m) left.push(out.parked.mesh);
      out.parked = { mesh: m, x: m.position.x, z: m.position.z, h: m.rotation.y };
    }
    return enter();
  }
  const runners = [];
  function driverBails(c) {
    const p = person({ top: [0x2b3d5c, 0xb03030, 0xf2f2f2, 0x6a4c93][Math.floor(Math.random() * 4)] });
    const h = Math.atan2(Math.sin(c.mesh.rotation.y), Math.cos(c.mesh.rotation.y)), lx = Math.cos(h), lz = -Math.sin(h);
    p.position.set(c.x + lx * 1.4, 0, c.z + lz * 1.4); p.rotation.y = Math.atan2(lx, lz); ctx.scene.add(p);
    runners.push({ p, t: 6, dx: lx, dz: lz });
  }

  // ------------------------------------------------------------ input
  window.addEventListener("keydown", (e) => {
    if (typing()) return;
    keys[e.code] = true;
    if (e.code === "KeyF" && !e.repeat) {
      if (!out.on) exit(); else getIn();
    }
    if (out.on && e.code === "Space") { e.preventDefault(); if (out.y <= 0.01) out.vy = 6.2; }
  });
  window.addEventListener("keyup", (e) => { keys[e.code] = false; });
  const canvas = document.getElementById("three-canvas");
  const look = (dx, dy, k) => { out.yaw -= dx * k; out.pitch = Math.max(-1.1, Math.min(0.75, out.pitch - dy * k)); };
  canvas.addEventListener("click", () => { if (out.on && matchMedia("(pointer:fine)").matches && !document.pointerLockElement && canvas.requestPointerLock) { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) {} } });
  let drag = null;
  canvas.addEventListener("mousedown", (e) => { if (out.on && !document.pointerLockElement) drag = { x: e.clientX, y: e.clientY }; });
  window.addEventListener("mouseup", () => { drag = null; });
  window.addEventListener("mousemove", (e) => {
    if (!out.on) return;
    if (document.pointerLockElement === canvas) look(e.movementX, e.movementY, 0.0024 * (out.aim ? 0.55 : 1));
    else if (drag) { look(e.clientX - drag.x, e.clientY - drag.y, 0.005); drag = { x: e.clientX, y: e.clientY }; }
  });
  // phones: drag on the right half of the screen to look round (not on a button or the stick)
  let tl = null;
  canvas.addEventListener("touchstart", (e) => { if (!out.on) return; for (const t of e.changedTouches) if (t.clientX > innerWidth * 0.4 && !tl) tl = { id: t.identifier, x: t.clientX, y: t.clientY }; }, { passive: true });
  canvas.addEventListener("touchmove", (e) => { if (!tl) return; for (const t of e.changedTouches) if (t.identifier === tl.id) { look(t.clientX - tl.x, t.clientY - tl.y, 0.006); tl.x = t.clientX; tl.y = t.clientY; } }, { passive: true });
  const tEnd = (e) => { if (tl) for (const t of e.changedTouches) if (t.identifier === tl.id) tl = null; };
  canvas.addEventListener("touchend", tEnd); canvas.addEventListener("touchcancel", tEnd);

  // the GET OUT / GET IN button (phones and anyone who prefers it) and the sprint / jump buttons on phones
  const css = document.createElement("style");
  css.textContent = `#rb-door{position:fixed;right:14px;bottom:calc(430px + env(safe-area-inset-bottom));z-index:6900;height:44px;padding:0 14px;border-radius:14px;border:1px solid rgba(201,168,76,.6);background:rgba(0,0,0,.65);color:#F5E6A3;font:900 11px/1 Inter,sans-serif;letter-spacing:1px;cursor:pointer}
body:not(.rb-touch) #rb-door{bottom:calc(300px + env(safe-area-inset-bottom))}
.rb-footpad{position:fixed;right:14px;bottom:calc(282px + env(safe-area-inset-bottom));z-index:6900;display:none;grid-template-columns:64px 64px;gap:10px;touch-action:none;user-select:none;-webkit-user-select:none}
.rb-footpad button{height:64px;border-radius:18px;border:1px solid rgba(201,168,76,.5);background:rgba(0,0,0,.55);color:#F5E6A3;font:900 11px/1.1 Inter,sans-serif;letter-spacing:1px;touch-action:none}.rb-footpad button.on{background:rgba(201,168,76,.55);color:#000}
body.rb-onfoot.rb-touch .rb-footpad{display:grid}body.rb-onfoot .rb-pedals{display:none!important}
body.rb-photo #rb-door,body.rb-photo .rb-footpad{display:none!important}
/* out of the way while a panel or the phone is open */
body:has(.overlay[style*="flex"]) #rb-door,body:has(.overlay[style*="flex"]) .rb-footpad,body:has(#rb-phone.open) #rb-door,body:has(#rb-phone.open) .rb-footpad{display:none!important}`;
  document.head.appendChild(css);
  const door = document.createElement("button"); door.id = "rb-door"; door.type = "button"; door.textContent = "🚶 GET OUT (F)"; document.body.appendChild(door);
  door.addEventListener("click", () => { if (!out.on) exit(); else getIn(); });
  const fp = document.createElement("div"); fp.className = "rb-footpad"; fp.innerHTML = '<button data-k="sprint">SPRINT</button><button data-k="jump">JUMP</button>'; document.body.appendChild(fp);
  const tpad = { sprint: false };
  fp.querySelectorAll("button").forEach((b) => {
    const k = b.dataset.k, set = (v, e) => { e.preventDefault(); if (k === "jump") { if (v && out.y <= 0.01) out.vy = 6.2; } else tpad[k] = v; b.classList.toggle("on", v); };
    b.addEventListener("touchstart", (e) => set(true, e), { passive: false }); b.addEventListener("touchend", (e) => set(false, e)); b.addEventListener("touchcancel", (e) => set(false, e));
  });
  let doorLabel = "";
  const setDoor = (t) => { if (t !== doorLabel) { doorLabel = t; door.textContent = t; } };

  // ------------------------------------------------------------ every frame on foot
  const v3 = new THREE.Vector3();
  E.setFoot((dt) => {
    if (out.down && out.down()) { pose(me, "down", dt); me.position.set(car.x, 0, car.z); car.speed = 0; E.sunAt(car.x, car.z); return; } // wasted (combat.js)
    // movement relative to where the camera looks
    let mx = 0, mz = 0;
    if (keys.KeyW || keys.ArrowUp) mz += 1;
    if (keys.KeyS || keys.ArrowDown) mz -= 1;
    if (keys.KeyA || keys.ArrowLeft) mx += 1;
    if (keys.KeyD || keys.ArrowRight) mx -= 1;
    if (joy.on) { mx = -joy.x; mz = -joy.y; }
    const gp = navigator.getGamepads ? [...navigator.getGamepads()].find((g) => g && g.connected) : null;
    if (gp) { const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0, rx = gp.axes[2] || 0, ry = gp.axes[3] || 0; if (Math.abs(ax) > 0.15 || Math.abs(ay) > 0.15) { mx = -ax; mz = -ay; } if (Math.abs(rx) > 0.15 || Math.abs(ry) > 0.15) look(rx * 9, ry * 6, 0.004); }
    const mag = Math.min(1, Math.hypot(mx, mz));
    out.sprint = !!(keys.ShiftLeft || keys.ShiftRight || tpad.sprint || (gp && gp.buttons[10]?.pressed));
    const top = out.aim ? WALK * 1.1 : out.sprint ? SPRINT : mag < 0.5 && joy.on ? WALK : JOG;
    const want = mag * top;
    out.speed += (want - out.speed) * Math.min(1, dt * (want > out.speed ? 7 : 10));
    if (mag > 0.05) {
      const fx = Math.sin(out.yaw), fz = Math.cos(out.yaw), rx = Math.cos(out.yaw), rz = -Math.sin(out.yaw);
      const dx = (fx * mz + rx * mx) / (mag || 1), dz = (fz * mz + rz * mx) / (mag || 1);
      const tgtH = out.aim ? out.yaw : Math.atan2(dx, dz);
      let dh = tgtH - out.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); out.h += dh * Math.min(1, dt * 12);
      const nx = car.x + dx * out.speed * dt, nz = car.z + dz * out.speed * dt;
      if (!blocked(nx, nz)) { car.x = nx; car.z = nz; }
      else if (!blocked(nx, car.z)) car.x = nx;
      else if (!blocked(car.x, nz)) car.z = nz;
    } else if (out.aim) { let dh = out.yaw - out.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); out.h += dh * Math.min(1, dt * 14); }
    car.speed = out.speed; car.heading = out.h;
    // a jump
    out.vy -= GRAVITY * dt; out.y = Math.max(0, out.y + out.vy * dt); if (out.y === 0 && out.vy < 0) out.vy = 0;
    // you on screen
    me.position.set(car.x, out.y, car.z); me.rotation.y = out.h;
    me.userData.aiming = out.aim; me.userData.pitch = out.pitch;
    pose(me, out.y > 0.05 ? "walk" : out.speed > 5 ? "run" : out.speed > 0.4 ? "walk" : "idle", dt, out.speed);
    // camera: over the right shoulder; closer while aiming; pulled in if a wall is in the way
    const dist = out.aim ? 2.3 : 4.4, side = out.aim ? 0.75 : 0.45, height = 1.65;
    const cx = Math.sin(out.yaw), cz = Math.cos(out.yaw), rx = -Math.cos(out.yaw), rz = Math.sin(out.yaw);
    const back = dist * Math.cos(out.pitch), up = height - dist * Math.sin(out.pitch) + out.y;
    let k = 1; for (let i = 1; i <= 8; i++) { const f = i / 8; if (CITY.blocked(car.x - cx * back * f + rx * side * f, car.z - cz * back * f + rz * side * f, 0.25)) { k = Math.max(0.18, (i - 1) / 8); break; } }
    v3.set(car.x - cx * back * k + rx * side, Math.max(0.5, up * (0.6 + 0.4 * k)), car.z - cz * back * k + rz * side);
    cam.position.lerp(v3, 1 - Math.pow(0.0005, dt));
    // a wall right behind you: the camera comes in close, so you fade out rather than fill the screen
    me.visible = k > 0.4 || Math.hypot(cam.position.x - car.x, cam.position.z - car.z) > 1.4;
    cam.fov += ((out.aim ? 46 : 58) - cam.fov) * Math.min(1, dt * 8); cam.updateProjectionMatrix();
    cam.lookAt(car.x + cx * 10 * Math.cos(out.pitch) + rx * side, height + out.y + Math.sin(out.pitch) * 10, car.z + cz * 10 * Math.cos(out.pitch) + rz * side);
    if (ctx.fx) ctx.fx.speed = 0;
    E.sunAt(car.x, car.z);
    // the button says what F does here
    setDoor(nearestCar() || nearLeft() ? "🚗 GET IN (F)" : "🚶 ON FOOT");
  });
  ctx.onFrame((dt) => {
    for (let i = runners.length - 1; i >= 0; i--) {
      const r = runners[i]; r.t -= dt;
      const nx = r.p.position.x + r.dx * 6 * dt, nz = r.p.position.z + r.dz * 6 * dt;
      if (!CITY.blocked(nx, nz, 0.3)) { r.p.position.x = nx; r.p.position.z = nz; } else { const t = r.dx; r.dx = -r.dz; r.dz = t; }
      pose(r.p, "run", dt, 6);
      if (r.t <= 0) { ctx.scene.remove(r.p); runners.splice(i, 1); }
    }
    if (!out.on) setDoor(busy() ? "" : "🚶 GET OUT (F)");
    door.style.display = doorLabel ? "" : "none";
  });
  out.tag = (text) => tag(me, text);
  return out;
}
