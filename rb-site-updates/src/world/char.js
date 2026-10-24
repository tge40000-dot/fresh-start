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
  geo.sole = new THREE.BoxGeometry(0.106, 0.025, 0.25); geo.sole.translate(0, -0.07, 0.04);
  // the face: eyes, brows, nose and mouth; hair styles; clothes over the body
  geo.eye = new THREE.SphereGeometry(0.016, 8, 6); geo.pupil = new THREE.SphereGeometry(0.009, 6, 5);
  geo.brow = new THREE.BoxGeometry(0.038, 0.009, 0.01); geo.nose = new THREE.ConeGeometry(0.016, 0.04, 6); geo.mouth = new THREE.BoxGeometry(0.04, 0.007, 0.008);
  geo.beard = new THREE.SphereGeometry(0.105, 14, 8, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.32); geo.beard.scale(1, 1.1, 1.05);
  geo.afro = new THREE.SphereGeometry(0.16, 14, 10); geo.afro.scale(1, 0.9, 1);
  geo.cap = new THREE.SphereGeometry(0.124, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.45); geo.capBrim = new THREE.CylinderGeometry(0.1, 0.1, 0.012, 16, 1, false, -Math.PI / 2, Math.PI);
  geo.tail = new THREE.CapsuleGeometry(0.03, 0.12, 4, 8);
  geo.hood = new THREE.TorusGeometry(0.1, 0.04, 8, 16); geo.belt = new THREE.CylinderGeometry(0.17, 0.17, 0.035, 16); geo.belt.scale(1.12, 1, 0.72);
  geo.jacket = new THREE.CapsuleGeometry(0.178, 0.25, 6, 14, 1); geo.jacket.scale(1.17, 1, 0.71);
  return geo;
}
// cloth has a soft sheen at grazing angles; skin and hard things are plain
function mat(color, rough = 0.8, cloth = false) {
  const k = color + ":" + rough + ":" + cloth;
  if (!mats.has(k)) mats.set(k, cloth ? new THREE.MeshPhysicalMaterial({ color, roughness: rough, sheen: 0.6, sheenRoughness: 0.7, sheenColor: new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.35) }) : new THREE.MeshStandardMaterial({ color, roughness: rough }));
  return mats.get(k);
}
// a soft shadow on the ground under each person (with or without the sun's shadows)
let blobMat = null;
function blob() {
  if (!blobMat) { const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d"), r = g.createRadialGradient(32, 32, 2, 32, 32, 31); r.addColorStop(0, "rgba(0,0,0,.55)"); r.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = r; g.fillRect(0, 0, 64, 64); blobMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }); }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95), blobMat); m.rotation.x = -Math.PI / 2; m.position.y = 0.025; m.userData.noAO = true; m.renderOrder = 1;
  return m;
}
const SKIN = [0x5c3a21, 0x8d5524, 0xa16e4b, 0xc68642, 0xe0ac69, 0xf1c27d, 0xffdbac];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const HAIRS = ["short", "short", "buzz", "afro", "cap", "tail"];
// A person. o: { skin, top, pants, shoes, hair (colour), style ("short" | "buzz" | "afro" | "cap" | "tail"), beard,
//   jacket (a colour for an open jacket over the top), hood, vest (body armour) }
export function person(o = {}) {
  const g = G();
  const skin = mat(o.skin ?? pick(SKIN), 0.6), top = mat(o.top ?? 0x1a1a1a, 0.85, true), pants = mat(o.pants ?? 0x23262e, 0.85, true), shoes = mat(o.shoes ?? 0x111111, 0.5), hair = mat(o.hair ?? 0x111111, 0.9);
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body); root.add(blob());
  const part = (geom, m, parent, x = 0, y = 0, z = 0) => { const mesh = new THREE.Mesh(geom, m); mesh.position.set(x, y, z); mesh.castShadow = true; parent.add(mesh); return mesh; };
  const joint = (parent, x, y, z) => { const j = new THREE.Group(); j.position.set(x, y, z); parent.add(j); return j; };
  // hips at 0.95 m; everything hangs off them
  const hips = joint(body, 0, 0.95, 0); part(g.hips, pants, hips, 0, 0.02, 0);
  const spine = joint(hips, 0, 0.1, 0); part(g.chest, top, spine, 0, 0.22, 0);
  if (o.vest) { const v = part(new THREE.BoxGeometry(0.36, 0.34, 0.25), mat(0x2b2f24, 0.9), spine, 0, 0.24, 0); v.scale.set(1, 1, 1); }
  else if (o.jacket != null) { const jm = mat(o.jacket, 0.75, true); for (const s of [1, -1]) { const j = part(g.jacket, jm, spine, 0.07 * s, 0.22, 0); j.scale.set(0.55, 1, 1); } }
  if (o.hood) { const h = part(g.hood, top, spine, 0, 0.44, -0.07); h.rotation.x = Math.PI / 2.4; }
  part(g.belt, mat(0x15120f, 0.5), hips, 0, 0.09, 0);
  const neck = joint(spine, 0, 0.47, 0); part(g.neck, skin, neck, 0, 0.03, 0);
  const head = joint(neck, 0, 0.16, 0); part(g.head, skin, head);
  // face (looking along +z)
  const white = mat(0xf2f2f2, 0.4), dark = mat(0x1a1410, 0.5);
  for (const s of [1, -1]) { part(g.eye, white, head, 0.042 * s, 0.022, 0.1); part(g.pupil, dark, head, 0.042 * s, 0.022, 0.114); part(g.brow, hair, head, 0.042 * s, 0.05, 0.106); }
  const nose = part(g.nose, skin, head, 0, -0.005, 0.12); nose.rotation.x = Math.PI / 2;
  part(g.mouth, mat(0x6b2a2a, 0.6), head, 0, -0.05, 0.106);
  if (o.beard ?? Math.random() < 0.3) part(g.beard, hair, head, 0, -0.01, 0.005);
  const style = o.style || pick(HAIRS);
  if (style === "afro") part(g.afro, hair, head, 0, 0.05, -0.02);
  else if (style === "cap") { part(g.cap, mat(o.capColor ?? pick([0x111111, 0xb03030, 0x1f3b6a, 0xC9A84C]), 0.7), head, 0, 0.018, -0.006); part(g.capBrim, mat(0x111111, 0.7), head, 0, 0.045, 0.08); }
  else if (style !== "buzz") part(g.hair, hair, head, 0, 0.012, -0.008);
  if (style === "tail") { const t = part(g.tail, hair, head, 0, 0.0, -0.13); t.rotation.x = 0.4; }
  if (style === "buzz") { const b = part(g.hair, hair, head, 0, 0.004, -0.004); b.scale.setScalar(0.97); }
  const sleeve = o.jacket != null && !o.vest ? mat(o.jacket, 0.75, true) : top;
  const arm = (s) => { const sh = joint(spine, 0.215 * s, 0.38, 0); part(g.upper, sleeve, sh); const el = joint(sh, 0, -0.3, 0); part(g.fore, skin, el); const hd = joint(el, 0, -0.29, 0); part(g.hand, skin, hd); return { sh, el, hd }; };
  const leg = (s) => { const hp = joint(hips, 0.095 * s, -0.04, 0); part(g.thigh, pants, hp); const kn = joint(hp, 0, -0.42, 0); part(g.shin, pants, kn); const an = joint(kn, 0, -0.43, 0); part(g.shoe, shoes, an); part(g.sole, mat(0xe8e4dc, 0.6), an); return { hp, kn, an }; };
  const L = arm(1), R = arm(-1), LL = leg(1), RL = leg(-1);
  root.userData = { body, hips, spine, neck, head, L, R, LL, RL, t: 0, k: { walk: 0, run: 0, aim: 0, down: 0 }, gun: null, scale: o.scale || 1 };
  if (o.scale) root.scale.setScalar(o.scale);
  return root;
}

// Pose for this frame. speed in m/s moves the stride; state picks the pose; it blends over ~0.2 s.
export function pose(p, state, dt, speed = 0) {
  const u = p.userData, k = u.k, want = { walk: state === "walk" ? 1 : 0, run: state === "run" ? 1 : 0, aim: u.aiming ? 1 : 0, down: state === "down" ? 1 : 0, crouch: state === "crouch" ? 1 : 0 };
  k.crouch ??= 0;
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
  // crouched behind cover: knees bent, hips low, leaning forward
  if (k.crouch > 0.01) {
    u.hips.position.y -= 0.38 * k.crouch;
    u.LL.hp.rotation.x -= 1.15 * k.crouch; u.RL.hp.rotation.x -= 0.7 * k.crouch;
    u.LL.kn.rotation.x += 1.9 * k.crouch; u.RL.kn.rotation.x += 1.5 * k.crouch;
    u.spine.rotation.x += 0.35 * k.crouch;
  }
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

// ---------------------------------------------------------------- looks (wardrobe.js), shared with other players
// A look is a short string of choices ("t2,j1,p0,s3,h0,c2,b1,k4"), so it travels in the live room's messages.
export const LOOK = {
  t: { name: "Top", list: [0xf2f2f2, 0x111111, 0xb03030, 0x1f3b6a, 0x2e7d32, 0xC9A84C, 0x6a4c93, 0xe0a030, 0x777777] },
  j: { name: "Jacket", list: [null, 0x121212, 0x5a3b22, 0x1f2a44, 0x8a1c1c, 0xC9A84C, 0xe9e6df] },
  p: { name: "Trousers", list: [0x1c2a44, 0x111111, 0x4a4a4a, 0x6b5b45, 0x223344, 0xe9e6df] },
  s: { name: "Hair", list: ["short", "buzz", "afro", "cap", "tail"] },
  h: { name: "Hair colour", list: [0x0d0d0d, 0x3b2414, 0x7a4a24, 0xd9b27a, 0x9a9a9a, 0xb03030] },
  c: { name: "Cap colour", list: [0x111111, 0xb03030, 0x1f3b6a, 0xC9A84C, 0xf2f2f2] },
  b: { name: "Beard", list: [false, true] },
  k: { name: "Skin", list: SKIN },
};
export const DEFAULT_LOOK = "t0,j1,p0,s0,h0,c0,b1,k1";
export function fromLook(str) {
  const pick = {}; for (const part of String(str || DEFAULT_LOOK).split(",")) { const k = part[0], i = Number(part.slice(1)); if (LOOK[k] && Number.isInteger(i) && i >= 0 && i < LOOK[k].list.length) pick[k] = i; }
  const v = (k, d) => LOOK[k].list[pick[k] ?? d];
  return { top: v("t", 0), jacket: v("j", 1), pants: v("p", 0), style: v("s", 0), hair: v("h", 0), capColor: v("c", 0), beard: v("b", 1), skin: v("k", 1), shoes: 0x0b0b0b };
}
