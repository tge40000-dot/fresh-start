// RB World pedestrians: people walking the sidewalks round you, like GTA's.
//   They walk along the sidewalk beside every road, turn at the corners, and now and then cross at the crosswalk,
//   waiting for the cars' red light where there are traffic lights (traffic stops for anyone on the road).
//   Drive at them and they jump out of the way; hit one and they're knocked down, get back up, and the cops take an
//   interest (one wanted star). They're drawn as instanced figures (body, head, legs and arms that swing), so a crowd
//   of a hundred costs a handful of draw calls.
import * as THREE from "three";
import { on, walkers } from "./empire.js";

let E = null, C = null, CITY = null;
const COUNT = 110, NEAR = 230, WALK_OFF = 1.6; // people, how far round you they live, metres from the kerb
const peds = [];
const SKIN = [0x8d5524, 0xc68642, 0xe0ac69, 0xf1c27d, 0xffdbac, 0x5c3a21, 0xa16e4b];
const TOPS = [0x2b3d5c, 0xb03030, 0xf2f2f2, 0x1a1a1a, 0x2e7d32, 0xe0a030, 0x6a4c93, 0x3f8fbf, 0xc06090, 0x777777];
const PANTS = [0x1f2a44, 0x2a2a2a, 0x4a4a4a, 0x6b5b45, 0x223344, 0x8a7a60];
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// ---------------------------------------------------------------- where people can walk
// A sidewalk is one side of one road: from the corner at one end to the corner at the other.
function corner(n, e, side, fromEnd) {
  const ed = CITY.edges[e], A = CITY.nodes[ed.a], B = CITY.nodes[ed.b], ux = (B[0] - A[0]) / ed.len, uz = (B[1] - A[1]) / ed.len;
  const junc = Math.max(...CITY.anyLinks[n].map((l) => CITY.edges[l.e].w)) / 2 + 1.4, off = ed.w / 2 + WALK_OFF;
  const s = n === ed.a ? junc : ed.len - junc; // along the road from A
  return [A[0] + ux * s - uz * off * side, A[1] + uz * s + ux * off * side];
}
function walkable(e) { const c = CITY.edges[e].cls; return c !== "motorway" && c !== "trunk" && c !== "service" && CITY.edges[e].len > 14; }
// Start a walk along road e, on one side, heading away from node `from`.
function setLeg(p, e, side, from) {
  const ed = CITY.edges[e], to = from === ed.a ? ed.b : ed.a;
  p.e = e; p.side = side; p.from = from; p.to = to;
  p.path = [corner(from, e, side), corner(to, e, side)];
}
// At the corner: turn onto another road on the same corner (most of the time), or cross this road at the crosswalk.
function nextLeg(p) {
  const n = p.to, here = [p.x, p.z];
  const opts = CITY.anyLinks[n].filter((l) => l.e !== p.e && walkable(l.e));
  if (!opts.length || Math.random() < 0.12) {
    // turn back, or cross to the other side of the road we're on (at the crosswalk by this corner)
    const other = corner(n, p.e, -p.side);
    p.crossing = { axis: axisOf(p.e), node: n, waiting: CITY.anyLinks[n].length >= 3 && E.signalAt(n) };
    p.path = [other];
    p.after = () => setLeg(p, p.e, -p.side, n);
    return;
  }
  const l = pick(opts);
  // the side of the new road nearest where we're standing is the one round this corner
  const a = corner(n, l.e, 1), b = corner(n, l.e, -1);
  const side = Math.hypot(a[0] - here[0], a[1] - here[1]) < Math.hypot(b[0] - here[0], b[1] - here[1]) ? 1 : -1;
  if (Math.random() < 0.22) {
    // cross the new road first, at its crosswalk
    const far = side === 1 ? b : a, near = side === 1 ? a : b;
    p.path = [near, far];
    p.crossing = { axis: axisOf(l.e), node: n, waiting: CITY.anyLinks[n].length >= 3 && E.signalAt(n), fromIdx: 1 };
    p.after = () => setLeg(p, l.e, -side, n);
    return;
  }
  setLeg(p, l.e, side, n);
}
function axisOf(e) { const ed = CITY.edges[e], A = CITY.nodes[ed.a], B = CITY.nodes[ed.b]; return Math.abs(B[1] - A[1]) > Math.abs(B[0] - A[0]) ? 0 : 1; }

// ---------------------------------------------------------------- people
function spawn(p, near) {
  // a sidewalk somewhere round the car, out of the way of buildings
  const car = E.car;
  for (let k = 0; k < 60; k++) {
    const e = Math.floor(Math.random() * CITY.edges.length); if (!walkable(e)) continue;
    const ed = CITY.edges[e], side = Math.random() < 0.5 ? 1 : -1, from = Math.random() < 0.5 ? ed.a : ed.b;
    setLeg(p, e, side, from);
    const t = Math.random(), [a, b] = p.path, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
    const d = Math.hypot(x - car.x, z - car.z);
    if (d > NEAR || (near && d < 45) || CITY.blocked(x, z, 0.3)) continue;
    Object.assign(p, { x, z, path: [b], crossing: null, after: null, state: "walk", t0: 0, h: Math.atan2(b[0] - a[0], b[1] - a[1]), speed: rnd(1.1, 1.6), phase: Math.random() * 6, scale: rnd(0.9, 1.08) });
    return true;
  }
  return false;
}
function tick(dt, t) {
  const car = E.car, phase = E.phase(), carSp = Math.abs(car.speed);
  walkers.length = 0;
  for (const p of peds) {
    if (!p.path) { if (!spawn(p, true)) continue; }
    const dc = Math.hypot(p.x - car.x, p.z - car.z);
    if (dc > NEAR + 40) { spawn(p, true); continue; }
    if (p.state === "down") { p.t0 -= dt; if (p.t0 <= 0) p.state = "walk"; continue; }
    // a car coming at you: jump out of the way (sideways from the car's path)
    if (carSp > 6 && dc < 9 && p.state !== "dodge") {
      const fx = Math.sin(car.heading), fz = Math.cos(car.heading), rx = p.x - car.x, rz = p.z - car.z, ahead = rx * fx + rz * fz, lat = rx * fz - rz * fx;
      if (ahead > 0 && Math.abs(lat) < 3) { p.state = "dodge"; p.t0 = 0.6; p.dx = fz * Math.sign(lat || 1); p.dz = -fx * Math.sign(lat || 1); }
    }
    // hit
    if (carSp > 4 && dc < 1.9 && p.state !== "down") {
      p.state = "down"; p.t0 = 3.5; p.downH = car.heading;
      car.vx *= 0.85; car.vz *= 0.85;
      if (C.play) C.play("alert", 0.3);
      if (E.wanted() < 1) { E.setWanted(1); E.toast("🚨 You hit a pedestrian and someone called the cops.", true); }
      E.emit("ped-hit");
      continue;
    }
    if (p.state === "dodge") {
      p.t0 -= dt; const nx = p.x + p.dx * 5 * dt, nz = p.z + p.dz * 5 * dt;
      if (!CITY.blocked(nx, nz, 0.3)) { p.x = nx; p.z = nz; }
      if (p.t0 <= 0) { p.state = "walk"; p.path = [p.path[p.path.length - 1]]; }
      continue;
    }
    // waiting at the kerb for the cars' red light
    if (p.crossing && p.crossing.waiting && !p.crossing.go) {
      if (phase !== p.crossing.axis) p.crossing.go = true; else { p.waiting = true; continue; }
    }
    p.waiting = false;
    const tgt = p.path[0]; if (!tgt) { nextLeg(p); continue; }
    const dx = tgt[0] - p.x, dz = tgt[1] - p.z, d = Math.hypot(dx, dz);
    if (d < 0.25) {
      p.path.shift();
      if (!p.path.length) { const after = p.after; p.after = null; p.crossing = null; if (after) after(); else nextLeg(p); }
      continue;
    }
    const sp = p.crossing ? p.speed * 1.25 : p.speed, step = Math.min(d, sp * dt);
    p.x += (dx / d) * step; p.z += (dz / d) * step;
    let dh = Math.atan2(dx, dz) - p.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); p.h += dh * Math.min(1, dt * 8);
    p.phase += step * 3.2;
    if (p.crossing) walkers.push(p);
  }
  draw(t);
}

// ---------------------------------------------------------------- drawing: a few instanced meshes for everyone
let M = null;
const o3 = new THREE.Object3D(), mat4 = new THREE.Matrix4(), part = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), xAxis = new THREE.Vector3(1, 0, 0);
function build(scene) {
  const g = (geo, y) => { geo.translate(0, y, 0); return geo; };
  const std = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 });
  const torso = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.2, 0.42, 3, 8), std(0xffffff), COUNT);
  const head = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 10, 8), std(0xffffff), COUNT);
  const hair = new THREE.InstancedMesh(g(new THREE.SphereGeometry(0.135, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0.02), std(0x1a1410), COUNT);
  const legL = new THREE.InstancedMesh(g(new THREE.BoxGeometry(0.13, 0.82, 0.15), -0.41), std(0xffffff), COUNT);
  const legR = new THREE.InstancedMesh(legL.geometry, legL.material, COUNT);
  const armL = new THREE.InstancedMesh(g(new THREE.BoxGeometry(0.09, 0.6, 0.1), -0.3), std(0xffffff), COUNT);
  const armR = new THREE.InstancedMesh(armL.geometry, armL.material, COUNT);
  M = { torso, head, hair, legL, legR, armL, armR };
  const col = new THREE.Color();
  peds.forEach((p, i) => {
    torso.setColorAt(i, col.setHex(p.top)); head.setColorAt(i, col.setHex(p.skin));
    legL.setColorAt(i, col.setHex(p.pants)); legR.setColorAt(i, col.setHex(p.pants));
    armL.setColorAt(i, col.setHex(p.skin)); armR.setColorAt(i, col.setHex(p.skin));
  });
  for (const m of Object.values(M)) { m.castShadow = true; m.frustumCulled = false; scene.add(m); }
}
function put(mesh, i, base, x, y, z, rx) {
  part.compose(v.set(x, y, z), q.setFromAxisAngle(xAxis, rx || 0), one);
  mesh.setMatrixAt(i, mat4.multiplyMatrices(base, part));
}
function draw() {
  const base = new THREE.Matrix4();
  peds.forEach((p, i) => {
    if (!p.path && p.x == null) { base.makeScale(0, 0, 0); for (const m of Object.values(M)) m.setMatrixAt(i, base); return; }
    const s = p.scale, down = p.state === "down";
    o3.position.set(p.x, 0, p.z); o3.rotation.set(0, down ? p.downH : p.h, 0); o3.scale.set(s, s, s); o3.updateMatrix(); base.copy(o3.matrix);
    if (down) base.multiply(part.compose(v.set(0, 0.2, 0), q.setFromAxisAngle(xAxis, -Math.PI / 2), one)); // flat on the ground
    const moving = !p.waiting && !down, sw = moving ? Math.sin(p.phase) * 0.55 : 0, bob = moving ? Math.abs(Math.cos(p.phase)) * 0.04 : 0;
    put(M.torso, i, base, 0, 1.12 + bob, 0); put(M.head, i, base, 0, 1.58 + bob, 0); put(M.hair, i, base, 0, 1.6 + bob, 0);
    put(M.legL, i, base, -0.09, 0.84 + bob, 0, sw); put(M.legR, i, base, 0.09, 0.84 + bob, 0, -sw);
    put(M.armL, i, base, -0.27, 1.38 + bob, 0, -sw * 0.8); put(M.armR, i, base, 0.27, 1.38 + bob, 0, sw * 0.8);
  });
  for (const m of Object.values(M)) m.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- start
export function initPeds(empire, ctx) {
  E = empire; C = ctx; CITY = empire.city;
  for (let i = 0; i < COUNT; i++) peds.push({ top: pick(TOPS), pants: pick(PANTS), skin: pick(SKIN), x: null, z: null, path: null });
  for (const p of peds) spawn(p, false);
  build(ctx.scene);
  on("frame", (dt) => tick(Math.min(dt, 0.1), 0));
  return { peds };
}
