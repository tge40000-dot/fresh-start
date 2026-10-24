// RB World people you control or fight: a jointed figure built in code (no downloaded models), with hips, chest,
// head, two-part arms and legs, hands and shoes, so it can walk, run, aim, fall and get up. Used for you on foot
// (onfoot.js), other players on foot (live.js) and the crews in combat missions (combat.js).
//   pose(p, state, dt): "idle" | "walk" | "run" | "aim" | "down" (fallen), blended smoothly; speed drives the stride.
//   gun(p, model): puts a weapon model (combat.js) in the right hand, or takes it away with null.
import * as THREE from "three";

const geo = {}, mats = new Map();
function G() {
  if (geo.head) return geo;
  geo.head = new THREE.SphereGeometry(0.115, 18, 14); geo.head.scale(1, 1.14, 1.05);
  geo.hair = new THREE.SphereGeometry(0.121, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55); geo.hair.scale(1, 1.14, 1.08);
  geo.neck = new THREE.CylinderGeometry(0.05, 0.06, 0.1, 10);
  geo.chest = new THREE.CapsuleGeometry(0.17, 0.26, 6, 14); geo.chest.scale(1.15, 1, 0.68);
  geo.hips = new THREE.CapsuleGeometry(0.15, 0.08, 6, 14); geo.hips.scale(1.12, 1, 0.72);
  geo.upper = new THREE.CapsuleGeometry(0.052, 0.22, 4, 10); geo.upper.translate(0, -0.15, 0);
  geo.fore = new THREE.CapsuleGeometry(0.044, 0.21, 4, 10); geo.fore.translate(0, -0.14, 0);
  geo.hand = new THREE.SphereGeometry(0.045, 10, 8); geo.hand.scale(0.8, 1.2, 0.6);
  geo.thigh = new THREE.CapsuleGeometry(0.075, 0.3, 4, 10); geo.thigh.translate(0, -0.21, 0);
  geo.shin = new THREE.CapsuleGeometry(0.06, 0.32, 4, 10); geo.shin.translate(0, -0.21, 0);
  geo.shoe = new THREE.BoxGeometry(0.1, 0.07, 0.24); geo.shoe.translate(0, -0.03, 0.04);
  return geo;
}
function mat(color, rough = 0.8) {
  const k = color + ":" + rough;
  if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ color, roughness: rough }));
  return mats.get(k);
}
const SKIN = [0x5c3a21, 0x8d5524, 0xa16e4b, 0xc68642, 0xe0ac69, 0xf1c27d, 0xffdbac];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// A person. o: { skin, top, pants, shoes, hair, vest (true for a body-armour look) }
export function person(o = {}) {
  const g = G();
  const skin = mat(o.skin ?? pick(SKIN), 0.6), top = mat(o.top ?? 0x1a1a1a), pants = mat(o.pants ?? 0x23262e), shoes = mat(o.shoes ?? 0x111111, 0.5), hair = mat(o.hair ?? 0x111111, 0.9);
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const part = (geom, m, parent, x = 0, y = 0, z = 0) => { const mesh = new THREE.Mesh(geom, m); mesh.position.set(x, y, z); mesh.castShadow = true; parent.add(mesh); return mesh; };
  const joint = (parent, x, y, z) => { const j = new THREE.Group(); j.position.set(x, y, z); parent.add(j); return j; };
  // hips at 0.95 m; everything hangs off them
  const hips = joint(body, 0, 0.95, 0); part(g.hips, pants, hips, 0, 0.02, 0);
  const spine = joint(hips, 0, 0.1, 0); part(g.chest, top, spine, 0, 0.22, 0);
  if (o.vest) { const v = part(new THREE.BoxGeometry(0.36, 0.34, 0.25), mat(0x2b2f24, 0.9), spine, 0, 0.24, 0); v.scale.set(1, 1, 1); }
  const neck = joint(spine, 0, 0.47, 0); part(g.neck, skin, neck, 0, 0.03, 0);
  const head = joint(neck, 0, 0.16, 0); part(g.head, skin, head); part(g.hair, hair, head, 0, 0.012, -0.008);
  const arm = (s) => { const sh = joint(spine, 0.215 * s, 0.38, 0); part(g.upper, top, sh); const el = joint(sh, 0, -0.3, 0); part(g.fore, skin, el); const hd = joint(el, 0, -0.29, 0); part(g.hand, skin, hd); return { sh, el, hd }; };
  const leg = (s) => { const hp = joint(hips, 0.095 * s, -0.04, 0); part(g.thigh, pants, hp); const kn = joint(hp, 0, -0.42, 0); part(g.shin, pants, kn); const an = joint(kn, 0, -0.43, 0); part(g.shoe, shoes, an); return { hp, kn, an }; };
  const L = arm(1), R = arm(-1), LL = leg(1), RL = leg(-1);
  root.userData = { body, hips, spine, neck, head, L, R, LL, RL, t: 0, k: { walk: 0, run: 0, aim: 0, down: 0 }, gun: null, scale: o.scale || 1 };
  if (o.scale) root.scale.setScalar(o.scale);
  return root;
}

// Pose for this frame. speed in m/s moves the stride; state picks the pose; it blends over ~0.2 s.
export function pose(p, state, dt, speed = 0) {
  const u = p.userData, k = u.k, want = { walk: state === "walk" ? 1 : 0, run: state === "run" ? 1 : 0, aim: u.aiming ? 1 : 0, down: state === "down" ? 1 : 0 };
  const b = Math.min(1, dt * 8);
  for (const n in k) k[n] += (want[n] - k[n]) * (n === "down" ? Math.min(1, dt * 5) : b);
  u.t += dt * (2.2 + speed * 1.15);
  const s = Math.sin(u.t), c = Math.cos(u.t), mv = k.walk + k.run, swing = k.walk * 0.55 + k.run * 0.95;
  // legs: hip swing and a knee that bends on the way forward
  u.LL.hp.rotation.x = s * swing; u.RL.hp.rotation.x = -s * swing;
  u.LL.kn.rotation.x = Math.max(0, -c) * (0.4 + k.run * 0.9) * mv + 0.05; u.RL.kn.rotation.x = Math.max(0, c) * (0.4 + k.run * 0.9) * mv + 0.05;
  // body: bob, a lean into a run, breathing at rest
  u.hips.position.y = 0.95 + Math.abs(c) * 0.035 * mv + Math.sin(u.t * 0.35) * 0.004 * (1 - mv);
  u.spine.rotation.x = k.run * 0.22 + k.walk * 0.05; u.spine.rotation.y = s * 0.12 * mv * (1 - k.aim);
  // arms: swing opposite the legs, or up holding the gun when aiming
  const armSwing = swing * 0.9 * (1 - k.aim);
  u.L.sh.rotation.x = -s * armSwing + k.run * -0.15; u.R.sh.rotation.x = s * armSwing + k.run * -0.15;
  u.L.el.rotation.x = -(0.25 + k.run * 0.9) * (1 - k.aim); u.R.el.rotation.x = -(0.25 + k.run * 0.9) * (1 - k.aim);
  u.L.sh.rotation.z = 0.08; u.R.sh.rotation.z = -0.08;
  if (k.aim > 0.01) {
    // both hands forward on the weapon, the head and chest turned with it
    u.R.sh.rotation.x += (-1.5 - u.R.sh.rotation.x) * k.aim; u.R.el.rotation.x += (-0.1 - u.R.el.rotation.x) * k.aim; u.R.sh.rotation.z += (-0.05 - u.R.sh.rotation.z) * k.aim;
    u.L.sh.rotation.x += (-1.45 - u.L.sh.rotation.x) * k.aim; u.L.el.rotation.x += (-0.45 - u.L.el.rotation.x) * k.aim; u.L.sh.rotation.z += (-0.55 - u.L.sh.rotation.z) * k.aim;
    u.spine.rotation.x += ((u.pitch || 0) * 0.5 - u.spine.rotation.x) * k.aim;
    u.neck.rotation.x = (u.pitch || 0) * 0.5 * k.aim;
  } else u.neck.rotation.x = 0;
  if (u.recoil) { u.R.sh.rotation.x -= u.recoil; u.L.sh.rotation.x -= u.recoil * 0.8; u.recoil *= Math.pow(0.0005, dt); }
  // fallen: tip over backwards onto the ground
  u.body.rotation.x = -k.down * Math.PI / 2; u.body.position.y = k.down * 0.16;
}

// A weapon model in the right hand (null takes it out).
export function gun(p, model) {
  const u = p.userData;
  if (u.gun) u.R.hd.remove(u.gun);
  u.gun = model || null;
  // the barrel along the hand, so it points forward when the arm is raised to aim
  if (model) { model.position.set(0, -0.05, 0.02); model.rotation.set(Math.PI / 2, 0, 0); u.R.hd.add(model); }
}

// A floating name tag over someone's head (other players).
export function tag(p, text, color = "#F5E6A3") {
  const cv = document.createElement("canvas"); cv.width = 256; cv.height = 64;
  const g = cv.getContext("2d"); g.font = "800 28px Inter, Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillStyle = "rgba(0,0,0,.55)"; const w = Math.min(250, g.measureText(text).width + 24); g.fillRect(128 - w / 2, 10, w, 44);
  g.fillStyle = color; g.fillText(String(text).slice(0, 18), 128, 33);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true })); s.scale.set(1.6, 0.4, 1); s.position.y = 2.15; s.userData.noAO = true;
  if (p.userData.tag) p.remove(p.userData.tag);
  p.userData.tag = s; p.add(s);
  return s;
}
