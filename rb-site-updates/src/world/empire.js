// RB World empire: the city you drive, buy, build and collect in. Loaded by main.js after the 3D scene is up.
//   Drive (GTA): your car on a road grid, traffic, hustle jobs, heists that bring the cops and a wanted level.
//   Property (Monopoly): 32 lots in 8 colour districts, shared by every player (server); rent when you stop at someone
//     else's lot; own a whole district for the set bonus.
//   Collect (Pokémon Go): drops on the city streets and, with location on, near where you really are; talent cards.
//   Tycoon (Roller Coaster Tycoon): build a business on your lot, set its price, hire talent, upgrade, market it; it earns
//     while you play and a little while you're away.
// All of it is game money: it stays in RB World and is never RB Badge points.
import * as THREE from "three";
import { GRID, BLOCK, ROAD, PITCH, HALF, LOTS, DISTRICTS, BUSINESSES, MAX_LEVEL, MAX_LOTS_PER_PLAYER, RENT_COOLDOWN_S, businessByKey, lotById, rentFor, upgradeCost } from "./empire_defs.js";
import { api, onBeat } from "./rb_world.js";

const SAVE = "rb_empire_v1";
const GAME_MIN_PER_SEC = 2; // one real second is two game minutes: a game day lasts 12 real minutes
const ROLES = { chef: "Chef", barista: "Barista", stylist: "Stylist", trainer: "Trainer", producer: "Producer", dj: "DJ", manager: "Manager", concierge: "Concierge", engineer: "Engineer", promoter: "Promoter" };
const RARITY = [
  { key: "common", name: "Common", chance: 0.6, bonus: 0.1, wage: 20, css: "#B0B0B0" },
  { key: "rare", name: "Rare", chance: 0.28, bonus: 0.2, wage: 40, css: "#00BFFF" },
  { key: "epic", name: "Epic", chance: 0.1, bonus: 0.35, wage: 80, css: "#B36BFF" },
  { key: "legendary", name: "Legendary", chance: 0.02, bonus: 0.6, wage: 150, css: "#F5D547" },
];
const FIRST = ["Ace", "Bree", "Cam", "Dre", "Eli", "Fay", "Gio", "Hana", "Ivy", "Jax", "Kai", "Lux", "Milo", "Nia", "Omar", "Pia", "Quinn", "Rae", "Sol", "Tia", "Uma", "Vee", "Wes", "Xo", "Yara", "Zed"];
const JOBS = [
  { kind: "delivery", name: "Delivery run", icon: "📦", pay: 1, time: 1.6, wanted: 0, desc: "Pick up a package and drop it across town." },
  { kind: "vip", name: "VIP ride", icon: "🕶️", pay: 1.8, time: 1.1, wanted: 0, desc: "Get a client to their meeting. They tip for speed." },
  { kind: "heist", name: "The heist", icon: "💼", pay: 4, time: 1.4, wanted: 3, desc: "Grab the briefcase, then lose the cops on the way to the drop. Busted means a fine." },
];

let C = null; // what main.js hands over: scene, camera, controls, player, play, save, hud, mesh, minimap, gps
const S = { biz: {}, cards: [], picked: {}, lastTick: Date.now(), clock: 9 * 60, stats: { earned: 0, jobs: 0, busts: 0, drops: 0 } };
const lots = {}; // server: lot -> { owner_id, owner_name, business, level, name }
const car = { x: 0, z: -HALF - ROAD / 2, heading: 0, speed: 0, mesh: null };
const keys = {};
const joy = { x: 0, y: 0, on: false };
let lotMeshes = {}, traffic = [], cops = [], drops = [], gpsDrops = [], gpsMarkers = [], job = null, beacon = null;
let wanted = 0, bustT = 0, escapeT = 0, freeCam = false, lastRent = {}, nearLot = null, stopT = 0, toastBox = null, ui = {};
let dayLight = null, sun = null, windowMat = null, sky = null, stars = null, lampMat = null;
// What happened in the game, for progress.js (levels, quests, achievements, the tutorial) and the HUD.
const listeners = {};
export function on(name, cb) { (listeners[name] ||= []).push(cb); }
function emit(name, data) { (listeners[name] || []).forEach((cb) => { try { cb(data); } catch (e) { console.error(e); } }); }

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---------------------------------------------------------------- saving
function load() {
  try { Object.assign(S, JSON.parse(localStorage.getItem(SAVE) || "{}")); } catch (e) {}
  S.biz ||= {}; S.cards ||= []; S.picked ||= {}; S.stats ||= { earned: 0, jobs: 0, busts: 0, drops: 0 };
}
function save() { try { localStorage.setItem(SAVE, JSON.stringify(S)); } catch (e) {} }

// ---------------------------------------------------------------- the city
const roadLines = []; // road centre lines, the same on both axes
for (let k = 0; k <= GRID; k++) roadLines.push(-HALF - ROAD / 2 + k * PITCH);
const blockRect = (l) => ({ x0: l.x - BLOCK / 2, x1: l.x + BLOCK / 2, z0: l.z - BLOCK / 2, z1: l.z + BLOCK / 2 });
const ALL_BLOCKS = [];
for (let gz = 0; gz < GRID; gz++) for (let gx = 0; gx < GRID; gx++) ALL_BLOCKS.push({ x: -HALF + BLOCK / 2 + gx * PITCH, z: -HALF + BLOCK / 2 + gz * PITCH, id: gz * GRID + gx });

function label(text, opts = {}) {
  const cv = document.createElement("canvas"), w = opts.w || 512, h = opts.h || 128;
  cv.width = w; cv.height = h;
  const x = cv.getContext("2d");
  x.fillStyle = opts.bg || "rgba(0,0,0,0.75)"; x.fillRect(0, 0, w, h);
  if (opts.border) { x.strokeStyle = opts.border; x.lineWidth = 8; x.strokeRect(4, 4, w - 8, h - 8); }
  x.fillStyle = opts.color || "#F5E6A3"; x.font = `${opts.weight || 800} ${opts.size || 54}px Inter, system-ui, sans-serif`; x.textAlign = "center"; x.textBaseline = "middle";
  const lines = String(text).split("\n");
  lines.forEach((t, i) => x.fillText(t, w / 2, h / 2 + (i - (lines.length - 1) / 2) * (opts.size || 54) * 1.1));
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function sprite(text, opts) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: label(text, opts), transparent: true, depthWrite: false, color: opts?.tint ?? 0x9a9a9a }));
  s.scale.set(opts?.sx || 12, opts?.sy || 3, 1);
  return s;
}

function buildCity() {
  const scene = C.scene;
  // roads (one long plane per line) and gold lane dashes
  const asphalt = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.85, metalness: 0.2 });
  const span = 2 * HALF + 2 * ROAD;
  for (const r of roadLines) {
    const a = new THREE.Mesh(new THREE.PlaneGeometry(span, ROAD), asphalt); a.rotation.x = -Math.PI / 2; a.position.set(0, 0.03, r); a.receiveShadow = true; scene.add(a);
    const b = new THREE.Mesh(new THREE.PlaneGeometry(ROAD, span), asphalt); b.rotation.x = -Math.PI / 2; b.position.set(r, 0.031, 0); b.receiveShadow = true; scene.add(b);
  }
  const dash = new THREE.InstancedMesh(new THREE.PlaneGeometry(2.4, 0.22), new THREE.MeshBasicMaterial({ color: 0xC9A84C, transparent: true, opacity: 0.55 }), roadLines.length * 2 * 40);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  let n = 0;
  for (const r of roadLines) for (let i = 0; i < 40; i++) {
    const t = -span / 2 + (i + 0.5) * (span / 40);
    e.set(-Math.PI / 2, 0, 0); q.setFromEuler(e); m.compose(new THREE.Vector3(t, 0.05, r), q, new THREE.Vector3(1, 1, 1)); dash.setMatrixAt(n++, m);
    e.set(-Math.PI / 2, 0, Math.PI / 2); q.setFromEuler(e); m.compose(new THREE.Vector3(r, 0.05, t), q, new THREE.Vector3(1, 1, 1)); dash.setMatrixAt(n++, m);
  }
  scene.add(dash);
  // blocks: a kerb pad per block, with its district colour band along the road (like a Monopoly board)
  const pad = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7, metalness: 0.3 });
  for (const b of ALL_BLOCKS) {
    const k = new THREE.Mesh(new THREE.BoxGeometry(BLOCK, 0.4, BLOCK), pad); k.position.set(b.x, 0.2, b.z); k.receiveShadow = true; scene.add(k);
  }
  for (const l of LOTS) {
    const d = DISTRICTS[l.district];
    const band = new THREE.Mesh(new THREE.BoxGeometry(BLOCK, 0.5, 2.2), new THREE.MeshStandardMaterial({ color: d.color, emissive: d.color, emissiveIntensity: 0.35 }));
    band.position.set(l.x, 0.3, l.z + BLOCK / 2 - 1.1); scene.add(band);
  }
  // RB Plaza: the HQ tower and the billboard
  const hq = new THREE.Mesh(new THREE.BoxGeometry(18, 60, 18), new THREE.MeshStandardMaterial({ color: 0x0a0a0a, metalness: 0.9, roughness: 0.15, emissive: 0xC9A84C, emissiveIntensity: 0.06 }));
  hq.position.set(0, 30, 0); hq.castShadow = true; scene.add(hq);
  const crown = new THREE.Mesh(new THREE.BoxGeometry(19, 1.2, 19), new THREE.MeshBasicMaterial({ color: 0xC9A84C })); crown.position.set(0, 60.6, 0); scene.add(crown);
  const bb = sprite("RELENTLESS BILLIONAIRE\nRB WORLD", { w: 1024, h: 256, size: 70, sx: 30, sy: 7.5, border: "#C9A84C", bg: "rgba(0,0,0,0.9)" }); bb.position.set(0, 70, 0); scene.add(bb);
  const plazaSign = sprite("RB PLAZA", { size: 70, sx: 14, sy: 3.5, border: "#C9A84C" }); plazaSign.position.set(0, 6, 34); scene.add(plazaSign);
  // a skyline round the edge, with lit windows (one shared texture)
  const wcv = document.createElement("canvas"); wcv.width = 64; wcv.height = 128;
  const wx = wcv.getContext("2d"); wx.fillStyle = "#050505"; wx.fillRect(0, 0, 64, 128);
  for (let y = 4; y < 128; y += 10) for (let x = 4; x < 64; x += 10) if (Math.random() < 0.45) { wx.fillStyle = Math.random() < 0.85 ? "#C9A84C" : "#F5E6A3"; wx.fillRect(x, y, 5, 6); }
  const wtex = new THREE.CanvasTexture(wcv); wtex.wrapS = wtex.wrapT = THREE.RepeatWrapping; wtex.repeat.set(2, 4);
  windowMat = new THREE.MeshStandardMaterial({ color: 0x0b0b0b, metalness: 0.6, roughness: 0.4, emissive: 0xffffff, emissiveMap: wtex, emissiveIntensity: 0.6 });
  const towers = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), windowMat, 90);
  for (let i = 0; i < 90; i++) {
    const ang = (i / 90) * Math.PI * 2 + rnd(-0.03, 0.03), r = HALF + rnd(28, 70), h = rnd(20, 80), w = rnd(8, 16);
    m.compose(new THREE.Vector3(Math.cos(ang) * r, h / 2, Math.sin(ang) * r), new THREE.Quaternion(), new THREE.Vector3(w, h, w)); towers.setMatrixAt(i, m);
  }
  scene.add(towers);
  // the sky: a gradient dome that follows the time of day, with stars at night
  sky = new THREE.Mesh(new THREE.SphereGeometry(700, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x0b1a3a) }, bottom: { value: new THREE.Color(0xC9A84C) } },
    vertexShader: "varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "uniform vec3 top; uniform vec3 bottom; varying float h; void main(){ gl_FragColor = vec4(mix(bottom, top, smoothstep(-0.05, 0.45, h)), 1.0); }" }));
  scene.add(sky);
  const sp = new Float32Array(900 * 3);
  for (let i = 0; i < 900; i++) { const th = Math.random() * Math.PI * 2, ph = Math.random() * 1.3; sp.set([Math.cos(th) * Math.sin(ph) * 650, Math.cos(ph) * 650, Math.sin(th) * Math.sin(ph) * 650], i * 3); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(sp, 3));
  stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, transparent: true, opacity: 0, fog: false, depthWrite: false })); scene.add(stars);
  // street lights on every corner, lit at night
  lampMat = new THREE.MeshBasicMaterial({ color: 0xFFE2A0 });
  const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.16, 7, 6), new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8 }), roadLines.length ** 2);
  const lamps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.45, 10, 8), lampMat, roadLines.length ** 2);
  let li = 0;
  for (const rx of roadLines) for (const rz of roadLines) { m.makeTranslation(rx + ROAD / 2 + 0.6, 3.5, rz + ROAD / 2 + 0.6); poles.setMatrixAt(li, m); m.makeTranslation(rx + ROAD / 2 + 0.6, 7.1, rz + ROAD / 2 + 0.6); lamps.setMatrixAt(li++, m); }
  scene.add(poles); scene.add(lamps);
  // the plaza garden
  const trees = new THREE.InstancedMesh(new THREE.ConeGeometry(1.6, 5, 8), new THREE.MeshStandardMaterial({ color: 0x0f3d24, emissive: 0x06210f, emissiveIntensity: 0.4 }), 16);
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; m.makeTranslation(Math.cos(a) * 26, 2.9, Math.sin(a) * 26); trees.setMatrixAt(i, m); }
  scene.add(trees);
  const fountain = new THREE.Mesh(new THREE.CylinderGeometry(5, 5.5, 1, 32), new THREE.MeshStandardMaterial({ color: 0x14202a, metalness: 0.9, roughness: 0.1, emissive: 0x1d4f7a, emissiveIntensity: 0.4 })); fountain.position.set(0, 0.9, 22); scene.add(fountain);
  dayLight = new THREE.HemisphereLight(0xfff2d0, 0x101010, 0.0); scene.add(dayLight);
  sun = new THREE.DirectionalLight(0xffffff, 0.0); sun.position.set(-60, 120, 40); scene.add(sun);
}

// ---------------------------------------------------------------- lots on screen
function lotOwner(l) { const s = lots[l.id]; return s && s.owner_id ? s : null; }
function mine(l) { const s = lotOwner(l); return !!(s && s.owner_id === C.player.id); }
function myLots() { return LOTS.filter(mine); }
function ownsSet(d) { return LOTS.filter((l) => l.district === d).every(mine); }

function renderLot(l) {
  const scene = C.scene, old = lotMeshes[l.id];
  if (old) { scene.remove(old); old.traverse((o) => { o.geometry?.dispose?.(); if (o.material?.map) o.material.map.dispose(); }); }
  const g = new THREE.Group(); g.position.set(l.x, 0.4, l.z);
  const s = lotOwner(l), d = DISTRICTS[l.district], b = s && businessByKey(s.business);
  if (!s) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 5.5, 0.4), new THREE.MeshStandardMaterial({ color: 0x333333 })); post.position.set(0, 2.75, 0); g.add(post);
    const sign = sprite(`FOR SALE\n${money(l.price)}`, { size: 50, sx: 6, sy: 3, border: d.css, color: "#ffffff" }); sign.position.set(0, 7, 0); g.add(sign);
  } else if (!b) {
    const fence = new THREE.Mesh(new THREE.BoxGeometry(BLOCK - 4, 1.2, BLOCK - 4), new THREE.MeshStandardMaterial({ color: 0x222222, wireframe: true })); fence.position.y = 0.6; g.add(fence);
    const sign = sprite(`${s.owner_id === C.player.id ? "YOUR LOT" : esc(s.owner_name)}\nready to build`, { size: 44, sx: 9, sy: 3.4, border: d.css }); sign.position.set(0, 5, 0); g.add(sign);
  } else {
    const lvl = Math.max(1, Math.min(MAX_LEVEL, s.level || 1)), h = b.h * (0.7 + 0.3 * lvl), w = BLOCK - 10 + lvl;
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), windowMat);
    body.position.y = h / 2; body.castShadow = true; g.add(body);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.6, w + 0.4), new THREE.MeshBasicMaterial({ color: b.color })); trim.position.y = h; g.add(trim);
    for (let i = 0; i < lvl; i++) { const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.8), new THREE.MeshBasicMaterial({ color: 0xF5D547 })); star.position.set((i - (lvl - 1) / 2) * 2.2, h + 2, 0); g.add(star); }
    const name = s.name || b.name;
    const sign = sprite(`${b.icon} ${name}\n${s.owner_id === C.player.id ? "YOURS" : esc(s.owner_name)}`, { size: 46, sx: 12, sy: 3.6, border: d.css }); sign.position.set(0, h + 5, 0); g.add(sign);
    if (b.key === "park") { const ring = new THREE.Mesh(new THREE.TorusGeometry(6, 0.4, 8, 32), new THREE.MeshBasicMaterial({ color: 0xFF6B6B })); ring.position.set(0, h + 7, 0); ring.userData.spin = true; g.add(ring); }
    // customers walking in: a few dots that loop to the door (how many depends on how busy it is)
    const crowd = new THREE.InstancedMesh(new THREE.SphereGeometry(0.45, 6, 6), new THREE.MeshBasicMaterial({ color: 0xF5E6A3 }), 12);
    crowd.userData.crowd = true; crowd.count = 0; g.add(crowd);
  }
  scene.add(g);
  lotMeshes[l.id] = g;
}

// ---------------------------------------------------------------- driving
// A low wedge with a cabin, wheels that spin and steer, head and brake lights; cops get a light bar.
export function makeCar(color, cop, glow) {
  const g = new THREE.Group(), paint = new THREE.MeshStandardMaterial({ color, metalness: 0.7, roughness: 0.25, emissive: glow ? color : 0x000000, emissiveIntensity: glow ? 0.25 : 0 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 4.5), paint); body.position.y = 0.7; body.castShadow = true; g.add(body);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.35, 1.2), paint); nose.position.set(0, 1.05, 1.5); nose.rotation.x = 0.18; g.add(nose);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.65, 2.0), new THREE.MeshStandardMaterial({ color: 0x0a0d12, metalness: 0.95, roughness: 0.05 })); cab.position.set(0, 1.35, -0.35); g.add(cab);
  const spoiler = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.12, 0.5), paint); spoiler.position.set(0, 1.45, -2.05); g.add(spoiler);
  const wheelGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.42, 14), tyre = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.9 }), rim = new THREE.MeshStandardMaterial({ color: 0xC9A84C, metalness: 1, roughness: 0.2 });
  const wheels = [];
  for (const [x, z, front] of [[-1.12, 1.45, 1], [1.12, 1.45, 1], [-1.12, -1.45, 0], [1.12, -1.45, 0]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, 0.48, z);
    const w = new THREE.Mesh(wheelGeo, tyre); w.rotation.z = Math.PI / 2; pivot.add(w);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.44, 8), rim); hub.rotation.z = Math.PI / 2; w.add(hub);
    g.add(pivot); wheels.push({ pivot, w, front });
  }
  const head = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.16, 0.08), new THREE.MeshBasicMaterial({ color: 0xFFF6D0 })); head.position.set(0, 0.85, 2.27); g.add(head);
  const tailMat = new THREE.MeshBasicMaterial({ color: 0x550000 });
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.18, 0.08), tailMat); tail.position.set(0, 0.9, -2.27); g.add(tail);
  g.userData = { wheels, tailMat, paint };
  if (glow) {
    const under = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 5), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false })); under.rotation.x = -Math.PI / 2; under.position.y = 0.06; g.add(under);
    const flames = [-0.55, 0.55].map((x) => { const f = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.4, 8), new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.85 })); f.rotation.x = -Math.PI / 2; f.position.set(x, 0.55, -2.9); f.visible = false; g.add(f); return f; });
    g.userData.flames = flames;
  }
  if (cop) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.4), new THREE.MeshBasicMaterial({ color: 0xff2020 })); r.position.set(-0.4, 1.8, -0.35); g.add(r);
    const bl = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.4), new THREE.MeshBasicMaterial({ color: 0x2060ff })); bl.position.set(0.4, 1.8, -0.35); g.add(bl);
    g.userData.siren = [r, bl];
  }
  C.scene.add(g);
  return g;
}

function blocked(x, z) {
  if (Math.abs(x) > HALF + ROAD || Math.abs(z) > HALF + ROAD) return true;
  for (const b of ALL_BLOCKS) if (Math.abs(x - b.x) < BLOCK / 2 + 1.2 && Math.abs(z - b.z) < BLOCK / 2 + 1.2) return true;
  return false;
}

// Keyboard, touch (stick + pedals) and any standard game controller.
export const pad = { gas: false, brake: false, boost: false, hand: false };
let padWas = {};
function driveInput() {
  let t = 0, s = 0, boost = !!(keys.ShiftLeft || keys.ShiftRight || keys.KeyN || pad.boost), hand = !!(keys.Space || pad.hand);
  if (keys.ArrowUp || keys.KeyW || pad.gas) t += 1;
  if (keys.ArrowDown || keys.KeyS || pad.brake) t -= 1;
  if (keys.ArrowLeft || keys.KeyA) s += 1;
  if (keys.ArrowRight || keys.KeyD) s -= 1;
  if (joy.on) { s = -joy.x; if (!pad.gas && !pad.brake) t = Math.abs(joy.y) > 0.2 ? -joy.y : 0; }
  const gp = navigator.getGamepads ? [...navigator.getGamepads()].find((g) => g && g.connected) : null;
  if (gp) {
    const ax = gp.axes[0] || 0, rt = gp.buttons[7]?.value || 0, lt = gp.buttons[6]?.value || 0;
    if (Math.abs(ax) > 0.15) s = -ax;
    if (rt > 0.05 || lt > 0.05) t = rt - lt;
    if (gp.buttons[0]?.pressed) boost = true;
    if (gp.buttons[1]?.pressed) hand = true;
    const y = gp.buttons[3]?.pressed, start = gp.buttons[9]?.pressed, sel = gp.buttons[8]?.pressed;
    if (y && !padWas.y && nearLot) openLot(nearLot);
    if (sel && !padWas.sel) cycleCam();
    if (start && !padWas.start && C.help) C.help();
    padWas = { y, start, sel };
  }
  return { t, s, boost, hand };
}

// Arcade physics: velocity is separate from where the nose points, so the handbrake lets the back slide out.
const CAMS = ["chase", "far", "hood", "free"];
let camMode = 0, shake = 0;
function cycleCam() {
  camMode = (camMode + 1) % CAMS.length; freeCam = CAMS[camMode] === "free";
  const b = document.getElementById("btn-pov"); if (b) b.innerText = ["🎮", "🛰️", "🚘", "🖐️"][camMode];
  toast({ chase: "Camera: chase", far: "Camera: high", hood: "Camera: bonnet", free: "Camera: free (drag to look round)" }[CAMS[camMode]]);
}
car.vx = 0; car.vz = 0; car.boost = 1; car.steer = 0;
function driveCar(dt) {
  let { t, s, boost, hand } = driveInput();
  if (car.lock) { t = 0; boost = false; car.vx = car.vz = 0; } // held on the grid during a race countdown
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  let fwd = car.vx * fx + car.vz * fz, side = car.vx * fz - car.vz * fx;
  const boosting = boost && car.boost > 0.02 && t > 0;
  car.boost = Math.max(0, Math.min(1, car.boost + (boosting ? -0.35 : 0.09) * dt));
  const max = (boosting ? 44 : 30) + (car.draft || 0), accel = boosting ? 34 : 19; // draft: a slipstream bonus in races
  if (t > 0) fwd += accel * dt * (fwd < max ? 1 : 0);
  else if (t < 0) fwd -= (fwd > 0 ? 42 : 14) * dt;
  else fwd *= Math.pow(0.45, dt);
  fwd = Math.max(-12, Math.min(max, fwd));
  // steering: easier at low speed, a little less sharp flat out; the handbrake tightens it and lets the back go
  car.steer += (s - car.steer) * Math.min(1, dt * 8);
  const grip = hand ? 1.4 : 9, turn = car.steer * dt * (hand ? 3.2 : 2.3) * Math.min(1, Math.abs(fwd) / 7) * (1 - Math.min(0.35, Math.abs(fwd) / 120)) * Math.sign(fwd || 1);
  car.heading += turn;
  side *= Math.pow(0.5, dt * grip);
  if (hand) fwd *= Math.pow(0.7, dt);
  const nfx = Math.sin(car.heading), nfz = Math.cos(car.heading);
  car.vx = nfx * fwd + nfz * side; car.vz = nfz * fwd - nfx * side;
  car.speed = fwd; car.drift = Math.abs(side);
  const nx = car.x + car.vx * dt, nz = car.z + car.vz * dt;
  if (!blocked(nx, nz)) { car.x = nx; car.z = nz; }
  else {
    const hit = Math.hypot(car.vx, car.vz);
    if (!blocked(nx, car.z)) { car.x = nx; car.vz *= -0.2; }
    else if (!blocked(car.x, nz)) { car.z = nz; car.vx *= -0.2; }
    else { car.vx *= -0.3; car.vz *= -0.3; }
    if (hit > 12) { shake = Math.min(1, hit / 30); C.play("alert", 0.25); }
  }
  // the car on screen
  const m = car.mesh, u = m.userData;
  m.position.set(car.x, 0, car.z); m.rotation.y = car.heading; m.rotation.z = -car.steer * Math.min(1, Math.abs(fwd) / 30) * 0.05;
  for (const w of u.wheels) { w.w.rotation.x += fwd * dt / 0.48; if (w.front) w.pivot.rotation.y = car.steer * 0.45; }
  u.tailMat.color.setHex(t < 0 || hand ? 0xff2020 : 0x550000);
  if (u.flames) u.flames.forEach((f) => { f.visible = boosting; f.scale.set(1, 0.8 + Math.random() * 0.6, 1); });
  if (car.drift > 6 && Math.abs(fwd) > 10) skid(car.x - nfx * 1.6, car.z - nfz * 1.6, car.heading);
  if (C.mesh()) C.mesh().position.set(car.x, 0, car.z);
  // camera
  const cam = C.camera, ctl = C.controls(), mode = CAMS[camMode], speed = Math.abs(fwd);
  cam.fov += ((boosting ? 74 : 55 + Math.min(12, speed * 0.35)) - cam.fov) * Math.min(1, dt * 3); cam.updateProjectionMatrix();
  shake *= Math.pow(0.02, dt);
  if (mode !== "free") {
    ctl.enabled = false;
    const tall = cam.aspect < 1 ? 1.45 : 1;
    const back = mode === "far" ? 30 * tall : mode === "hood" ? -0.4 : (12 + speed * 0.12) * tall, up = mode === "far" ? 22 * tall : mode === "hood" ? 1.7 : (6 + speed * 0.04) * tall;
    const want = new THREE.Vector3(car.x - nfx * back, up, car.z - nfz * back);
    if (mode === "hood") cam.position.copy(want); else cam.position.lerp(want, 1 - Math.pow(0.015, dt));
    if (shake > 0.01) cam.position.add(new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(shake * 0.6));
    const ahead = mode === "hood" ? 30 : 6;
    cam.lookAt(car.x + nfx * ahead, mode === "hood" ? 1.4 : 1.5, car.z + nfz * ahead);
  } else { ctl.enabled = true; ctl.target.set(car.x, 2, car.z); }
}
// tyre marks that fade
const skids = [];
let skidGeo = null, skidMat = null;
function skid(x, z, h) {
  skidGeo ||= new THREE.PlaneGeometry(2.2, 0.5); skidMat ||= new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false });
  if (skids.length && Math.hypot(skids[skids.length - 1].position.x - x, skids[skids.length - 1].position.z - z) < 0.6) return;
  const k = new THREE.Mesh(skidGeo, skidMat.clone()); k.rotation.set(-Math.PI / 2, 0, h); k.position.set(x, 0.06, z); C.scene.add(k); skids.push(k);
  if (skids.length > 160) { const o = skids.shift(); C.scene.remove(o); o.material.dispose(); }
}
function skidsTick(dt) { for (const k of skids) k.material.opacity = Math.max(0, k.material.opacity - dt * 0.03); }

// cars on the road network: they move between intersections
function nodeNear(x, z) { const f = (v) => roadLines.reduce((a, r) => (Math.abs(r - v) < Math.abs(a - v) ? r : a), roadLines[0]); return [f(x), f(z)]; }
function neighbours(nx, nz) {
  const i = roadLines.indexOf(nx), j = roadLines.indexOf(nz), out = [];
  if (i > 0) out.push([roadLines[i - 1], nz]); if (i < roadLines.length - 1) out.push([roadLines[i + 1], nz]);
  if (j > 0) out.push([nx, roadLines[j - 1]]); if (j < roadLines.length - 1) out.push([nx, roadLines[j + 1]]);
  return out;
}
function spawnRoadCar(color, cop, far) {
  let p;
  for (let k = 0; k < 20; k++) { p = [pick(roadLines), pick(roadLines)]; if (!far || Math.hypot(p[0] - car.x, p[1] - car.z) > 70) break; }
  const mesh = makeCar(color, cop);
  return { x: p[0], z: p[1], to: pick(neighbours(p[0], p[1])), from: p, speed: cop ? 17 + wanted * 2.5 : rnd(8, 13), mesh, cop };
}
function moveRoadCar(c, dt, chase) {
  const dx = c.to[0] - c.x, dz = c.to[1] - c.z, d = Math.hypot(dx, dz);
  if (d < 0.6) {
    const opts = neighbours(c.to[0], c.to[1]).filter((p) => !(p[0] === c.from[0] && p[1] === c.from[1]));
    let next = pick(opts.length ? opts : neighbours(c.to[0], c.to[1]));
    if (chase) next = opts.concat([]).sort((a, b) => Math.hypot(a[0] - car.x, a[1] - car.z) - Math.hypot(b[0] - car.x, b[1] - car.z))[0] || next;
    c.from = c.to; c.to = next;
    return;
  }
  // a cop that's close leaves the road grid and comes straight at you
  let tx = c.to[0], tz = c.to[1];
  if (chase && Math.hypot(car.x - c.x, car.z - c.z) < 22) { tx = car.x; tz = car.z; }
  const ax = tx - c.x, az = tz - c.z, ad = Math.hypot(ax, az) || 1, step = Math.min(ad, c.speed * dt);
  c.x += (ax / ad) * step; c.z += (az / ad) * step;
  // keep right of the centre line
  const side = 1.8, hx = ax / ad, hz = az / ad;
  c.mesh.position.set(c.x - hz * side * (chase ? 0 : 1), 0, c.z + hx * side * (chase ? 0 : 1));
  c.mesh.rotation.y = Math.atan2(hx, hz);
  if (c.mesh.userData.siren) { const on = Math.floor(performance.now() / 180) % 2; c.mesh.userData.siren[0].visible = !!on; c.mesh.userData.siren[1].visible = !on; }
  if (!chase && Math.hypot(c.x - car.x, c.z - car.z) < 3.2) { car.vx *= 0.4; car.vz *= 0.4; shake = Math.max(shake, 0.4); }
}

// ---------------------------------------------------------------- cops and the wanted level
function setWanted(n) {
  wanted = Math.max(0, Math.min(5, n)); escapeT = 0; bustT = 0;
  while (cops.length > Math.min(4, wanted)) { const c = cops.pop(); C.scene.remove(c.mesh); }
  while (cops.length < Math.min(4, wanted)) cops.push(spawnRoadCar(0xf0f0f0, true, true));
  window.__rbWanted = wanted;
  const el = document.getElementById("wanted-val"); if (el) el.innerText = "★".repeat(wanted) + "☆".repeat(5 - wanted);
  ui.wanted.style.display = wanted ? "block" : "none";
  ui.wanted.innerHTML = wanted ? `<b>${"★".repeat(wanted)}</b><span>WANTED · lose them: <i id="rb-escape"></i></span>` : "";
}
function copsTick(dt) {
  if (!wanted) return;
  let near = Infinity;
  for (const c of cops) { c.speed = 17 + wanted * 2.5; moveRoadCar(c, dt, true); near = Math.min(near, Math.hypot(c.x - car.x, c.z - car.z)); }
  if (near < 3.6) { bustT += dt; if (bustT > 1.2) return busted(); } else bustT = Math.max(0, bustT - dt);
  if (near > 32) escapeT += dt; else escapeT = Math.max(0, escapeT - dt * 0.5);
  const e = document.getElementById("rb-escape"); if (e) e.textContent = Math.round(Math.min(100, (escapeT / 18) * 100)) + "%";
  if (escapeT > 18) { toast(wanted > 1 ? "Lost them for now. One star down." : "You lost the cops."); if (wanted === 1) emit("escaped"); setWanted(wanted - 1); }
}
function busted() {
  const fine = Math.max(2000, Math.round(C.player.netWorth * 0.1));
  C.player.netWorth = Math.max(0, C.player.netWorth - fine); S.stats.busts++;
  if (job && job.kind === "heist") endJob(false, "Busted. The briefcase is gone.");
  setWanted(0); car.speed = 0; car.vx = car.vz = 0; C.play("alert"); emit("busted"); toast(`BUSTED. Fine: ${money(fine)}.`, true); C.sync(); save();
}

// ---------------------------------------------------------------- hustle jobs
function roadPoint(minFrom) {
  for (let k = 0; k < 40; k++) {
    const a = pick(roadLines), b = rnd(-HALF, HALF), p = Math.random() < 0.5 ? [a, b] : [b, a];
    if (!minFrom || Math.hypot(p[0] - minFrom[0], p[1] - minFrom[1]) > 90) return p;
  }
  return [roadLines[0], 0];
}
function setBeacon(p, color) {
  if (beacon) C.scene.remove(beacon);
  if (!p) { beacon = null; return; }
  beacon = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 60, 16, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
  beacon.position.set(p[0], 30, p[1]); C.scene.add(beacon);
}
function openJobs() {
  if (job) return panel(`<h2>${job.icon} ${esc(job.name)}</h2><div class="subtitle">${job.stage === 0 ? "Drive to the pickup (the gold light)." : "Drive to the drop (the green light)."} ${Math.ceil(job.left)}s left.</div>
    <button class="btn-ghost" data-e="quit">GIVE UP</button>`, { quit: () => { endJob(false, "You walked away from the job."); hidePanel(); } });
  const offers = JOBS.map((j) => { const a = roadPoint([car.x, car.z]), b = roadPoint(a), dist = Math.hypot(a[0] - car.x, a[1] - car.z) + Math.hypot(b[0] - a[0], b[1] - a[1]); return { ...j, a, b, dist, reward: Math.round((dist * 18 * j.pay) / 100) * 100, limit: Math.round(dist / 14 * j.time + 15) }; });
  const acts = {};
  const rows = offers.map((o, i) => { acts["j" + i] = () => startJob(o); return `<div class="rb-card"><div><b>${o.icon} ${esc(o.name)}</b> ${o.wanted ? '<span class="rb-red">★★★</span>' : ""}<div class="rb-muted">${esc(o.desc)}</div><div class="rb-muted">${Math.round(o.dist)} m · ${o.limit}s</div></div><button class="rb-btn" data-e="j${i}">${money(o.reward)}</button></div>`; }).join("");
  panel(`<h2 style="color:var(--red)">HUSTLE</h2><div class="subtitle">Pick a job. Faster jobs pay more; heists pay most and bring the cops.</div>${rows}<button class="btn-ghost" data-e="close">CLOSE</button>`, { ...acts, close: hidePanel });
}
function startJob(o) {
  hidePanel(); job = { ...o, stage: 0, left: o.limit }; setBeacon(o.a, 0xC9A84C); C.play("alert");
  toast(`${o.icon} ${o.name}: head for the gold light.`);
}
function jobTick(dt) {
  if (!job) return;
  job.left -= dt;
  ui.job.style.display = "block";
  ui.job.textContent = `${job.icon} ${job.stage === 0 ? "PICKUP" : "DROP"} · ${Math.max(0, Math.ceil(job.left))}s · ${Math.round(Math.hypot((job.stage ? job.b : job.a)[0] - car.x, (job.stage ? job.b : job.a)[1] - car.z))} m`;
  if (job.left <= 0) return endJob(false, "Out of time.");
  const p = job.stage ? job.b : job.a;
  if (Math.hypot(p[0] - car.x, p[1] - car.z) < 5) {
    if (job.stage === 0) {
      job.stage = 1; job.left += 10; setBeacon(job.b, 0x00E676); C.play("cash");
      if (job.wanted) { setWanted(job.wanted); toast("You've got the case. Cops are on you!", true); } else toast("Picked up. Now the drop.");
    } else endJob(true);
  }
}
function endJob(ok, why) {
  if (!job) return;
  if (ok) {
    const tip = job.kind === "vip" ? Math.round(job.reward * Math.max(0, job.left / job.limit) * 0.5) : 0;
    C.player.netWorth += job.reward + tip; C.player.tokens += Math.round(job.reward / 400); S.stats.jobs++; S.stats.earned += job.reward + tip;
    C.play("cash"); toast(`${job.icon} Done: +${money(job.reward + tip)}${tip ? " (tip " + money(tip) + ")" : ""}`); emit("job", { kind: job.kind, reward: job.reward + tip });
    if (Math.random() < 0.25) giveCard("job");
  } else toast(why || "Job failed.", true);
  job = null; setBeacon(null); ui.job.style.display = "none"; C.sync(); save();
}

// ---------------------------------------------------------------- collecting (city drops and real-world drops)
// Common 60%, rare 28%, epic 10%, legendary 2%; drops found out in the real world are a little luckier.
function rollRarity(boost = 0) {
  const r = Math.random();
  if (r < 0.02 + boost / 4) return RARITY[3];
  if (r < 0.12 + boost / 2) return RARITY[2];
  if (r < 0.4 + boost) return RARITY[1];
  return RARITY[0];
}
function giveCard(source, rarity) {
  const rar = rarity || rollRarity(source === "gps" ? 0.05 : 0);
  const role = pick(Object.keys(ROLES));
  const card = { id: Math.random().toString(36).slice(2, 10), role, rarity: rar.key, name: `${pick(FIRST)} the ${ROLES[role]}`, at: Date.now() };
  S.cards.push(card); save(); emit("card", card);
  toast(`🃏 New talent: ${card.name} (${rar.name})`, false, rar.css);
  return card;
}
function dropMesh(kind) {
  const g = new THREE.Group();
  const col = kind === "cash" ? 0x00E676 : kind === "token" ? 0x00BFFF : 0xF5D547;
  const core = new THREE.Mesh(kind === "card" ? new THREE.BoxGeometry(1.6, 2.2, 0.2) : new THREE.OctahedronGeometry(1.1), new THREE.MeshBasicMaterial({ color: col }));
  core.position.y = 2; g.add(core);
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.4, 1.9, 24), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.5, side: THREE.DoubleSide })); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.1; g.add(ring);
  g.userData.core = core; C.scene.add(g); return g;
}
function spawnDrop() {
  const p = roadPoint(), roll = Math.random(), kind = roll < 0.5 ? "cash" : roll < 0.8 ? "token" : "card";
  const d = { x: p[0], z: p[1], kind, mesh: dropMesh(kind) }; d.mesh.position.set(d.x, 0, d.z); drops.push(d);
}
function collect(kind, source) {
  S.stats.drops++; emit("drop", { kind, source });
  if (kind === "cash") { const v = Math.round(rnd(5, 30)) * 100 * (source === "gps" ? 2 : 1); C.player.netWorth += v; C.play("cash"); toast(`💰 +${money(v)}`); }
  else if (kind === "token") { const v = Math.round(rnd(5, 20)) * (source === "gps" ? 2 : 1); C.player.tokens += v; C.play("cash"); toast(`💎 +${v} tokens`); }
  else giveCard(source);
  C.sync(); save();
}
function dropsTick(dt, t) {
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i]; d.mesh.userData.core.rotation.y = t * 2; d.mesh.userData.core.position.y = 2 + Math.sin(t * 3 + i) * 0.3;
    if (Math.hypot(d.x - car.x, d.z - car.z) < 3.8) { collect(d.kind, "city"); C.scene.remove(d.mesh); drops.splice(i, 1); setTimeout(spawnDrop, 8000); }
  }
}
// Real-world drops: the same for everyone standing in the same place, from the map cell and the quarter hour.
function hash32(a, b, c) { let h = 2166136261 ^ a; h = Math.imul(h ^ b, 16777619); h = Math.imul(h ^ c, 16777619); h ^= h >>> 13; h = Math.imul(h, 2246822507); return (h ^ (h >>> 16)) >>> 0; }
function gpsSpawns(lng, lat) {
  const CELL = 0.0015, cx = Math.floor(lng / CELL), cy = Math.floor(lat / CELL), slot = Math.floor(Date.now() / 900000), out = [];
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const h = hash32(cx + i, cy + j, slot), count = h % 3;
    for (let k = 0; k < count; k++) {
      const hh = hash32(h, k, 7), kindRoll = (hh % 100) / 100;
      out.push({ id: `${cx + i}:${cy + j}:${slot}:${k}`, lng: (cx + i + ((hh >>> 8) % 1000) / 1000) * CELL, lat: (cy + j + ((hh >>> 18) % 1000) / 1000) * CELL, kind: kindRoll < 0.35 ? "cash" : kindRoll < 0.55 ? "token" : "card" });
    }
  }
  return out;
}
function metres(a, b) { const R = 6371000, toR = Math.PI / 180, dLat = (b[1] - a[1]) * toR, dLng = (b[0] - a[0]) * toR; const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toR) * Math.cos(b[1] * toR) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); }
function gpsTick() {
  const fix = C.gps();
  if (!fix) { ui.near.style.display = "none"; return; }
  const here = C.player.pos;
  gpsDrops = gpsSpawns(here[0], here[1]).filter((d) => !S.picked[d.id]);
  for (const d of gpsDrops) {
    const m = metres(here, [d.lng, d.lat]);
    if (m < 40) { S.picked[d.id] = Date.now(); collect(d.kind, "gps"); toast("📍 Collected a drop where you are!"); }
  }
  // forget picks older than a day
  for (const [k, v] of Object.entries(S.picked)) if (Date.now() - v > 864e5) delete S.picked[k];
  const left = gpsDrops.filter((d) => !S.picked[d.id]).map((d) => ({ ...d, m: metres(here, [d.lng, d.lat]) })).sort((a, b) => a.m - b.m);
  ui.near.style.display = "block";
  ui.near.textContent = left.length ? `📍 ${left.length} drop${left.length > 1 ? "s" : ""} near you · closest ${Math.round(left[0].m)} m` : "📍 No drops right here. Walk around: new ones every 15 minutes.";
  const map = C.minimap();
  if (map && window.maplibregl) {
    gpsMarkers.forEach((mk) => mk.remove());
    gpsMarkers = left.slice(0, 12).map((d) => { const el = document.createElement("div"); el.textContent = d.kind === "cash" ? "💰" : d.kind === "token" ? "💎" : "🃏"; el.style.fontSize = "16px"; return new window.maplibregl.Marker({ element: el }).setLngLat([d.lng, d.lat]).addTo(map); });
  }
}

// ---------------------------------------------------------------- the tycoon
function bizState(id) { return (S.biz[id] ||= { price: null, staff: [], rep: 1, sat: 0.8, mkt: 0, made: 0 }); }
function hourOfDay() { return Math.floor(S.clock / 60) % 24; }
function isNight() { const h = hourOfDay(); return h < 6 || h >= 20; }
function figures(l) {
  const s = lots[l.id], b = s && businessByKey(s.business);
  if (!b) return null;
  const st = bizState(l.id), lvl = Math.max(1, Math.min(MAX_LEVEL, s.level || 1)), price = st.price ?? b.fair, r = price / b.fair;
  const demand = Math.max(0, Math.min(1.2, 1.5 - 0.75 * r));
  const h = hourOfDay(), day = isNight() ? b.night : b.key === "coffee" && h >= 6 && h < 11 ? 1.6 : 1;
  const set = ownsSet(l.district) ? 1.5 : 1;
  const staff = 1 + st.staff.map((cid) => S.cards.find((c) => c.id === cid)).filter(Boolean).reduce((a, c) => a + (c.role === b.role ? RARITY.find((x) => x.key === c.rarity).bonus : 0.03), 0);
  const wages = st.staff.map((cid) => S.cards.find((c) => c.id === cid)).filter(Boolean).reduce((a, c) => a + RARITY.find((x) => x.key === c.rarity).wage, 0);
  const mkt = st.mkt > Date.now() ? 1.3 : 1;
  const customers = b.cap * (1 + 0.5 * (lvl - 1)) * demand * day * set * staff * mkt * st.rep;
  const revenue = customers * price, cost = b.upkeep * (1 + 0.4 * (lvl - 1)) + wages;
  return { b, lvl, price, r, demand, customers, revenue, cost, profit: revenue - cost, set, staff, mkt, wages };
}
function tycoonTick(dt) {
  S.clock = (S.clock + dt * GAME_MIN_PER_SEC) % (24 * 60);
  let total = 0;
  for (const l of myLots()) {
    const f = figures(l); if (!f) continue;
    const st = bizState(l.id), gameHours = (dt * GAME_MIN_PER_SEC) / 60, earned = f.profit * gameHours;
    total += earned; st.made += earned;
    // satisfaction follows value for money; reputation follows satisfaction, slowly
    const target = Math.max(0.1, Math.min(1, 1.15 - 0.5 * (f.r - 0.8)));
    st.sat += (target - st.sat) * Math.min(1, dt * 0.05);
    st.rep = Math.max(0.5, Math.min(1.5, st.rep + (st.sat - 0.7) * dt * 0.004));
    // crowd on screen
    const g = lotMeshes[l.id], crowd = g && g.children.find((o) => o.userData.crowd);
    if (crowd) {
      const n = Math.max(0, Math.min(12, Math.round(f.customers / (f.b.cap * 0.25)))); crowd.count = n;
      const m = new THREE.Matrix4(), t = performance.now() / 1000;
      for (let i = 0; i < n; i++) { const p = ((t * 0.25 + i / n) % 1); m.makeTranslation(-6 + i * 1.1, 0.6, BLOCK / 2 - 1 - p * 8); crowd.setMatrixAt(i, m); }
      crowd.instanceMatrix.needsUpdate = true;
    }
  }
  C.player.netWorth = Math.max(0, C.player.netWorth + total);
  if (total > 0) { S.stats.earned += total; emit("income", total); }
  C.player.empireValue = myLots().reduce((a, l) => { const s = lots[l.id], b = businessByKey(s.business); return a + l.price + (b ? b.cost + Array.from({ length: (s.level || 1) - 1 }, (_, i) => upgradeCost(b, i + 1)).reduce((x, y) => x + y, 0) : 0); }, 0);
  // day and night
  const h = S.clock / 60, sunUp = Math.max(0, Math.sin(((h - 6) / 12) * Math.PI));
  dayLight.intensity = 0.35 + sunUp * 1.3; sun.intensity = 0.15 + sunUp * 1.6; windowMat.emissiveIntensity = 0.2 + (1 - sunUp) * 0.8;
  C.scene.fog.density = 0.003 + (1 - sunUp) * 0.004;
  const dusk = Math.max(0, 1 - Math.abs(sunUp - 0.25) * 4);
  sky.material.uniforms.top.value.setRGB(0.02 + sunUp * 0.18, 0.03 + sunUp * 0.32, 0.08 + sunUp * 0.55);
  sky.material.uniforms.bottom.value.setRGB(0.05 + sunUp * 0.45 + dusk * 0.5, 0.04 + sunUp * 0.4 + dusk * 0.2, 0.03 + sunUp * 0.45);
  C.scene.fog.color.setRGB(0.03 + sunUp * 0.25, 0.03 + sunUp * 0.25, 0.04 + sunUp * 0.3);
  stars.material.opacity = Math.max(0, 1 - sunUp * 3); lampMat.color.setHex(sunUp > 0.35 ? 0x555044 : 0xFFE2A0);
  ui.clock.textContent = `${sunUp > 0.05 ? "☀️" : "🌙"} ${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor(S.clock % 60)).padStart(2, "0")} · ${Math.round(Math.abs(car.speed) * 3.6)} km/h`;
}
// While you were away: a quarter of the rate, for up to four hours.
function offlineEarnings() {
  const away = Math.min(4 * 3600, (Date.now() - (S.lastTick || Date.now())) / 1000);
  if (away < 120) return;
  let perSec = 0;
  for (const l of myLots()) { const f = figures(l); if (f && f.profit > 0) perSec += (f.profit * GAME_MIN_PER_SEC) / 60; }
  const v = Math.round(perSec * away * 0.25);
  if (v > 0) { C.player.netWorth += v; S.stats.earned += v; C.sync(); toast(`While you were away your businesses made ${money(v)}.`); }
}

// ---------------------------------------------------------------- server: shared lots and rent
async function lotAction(lot, action, extra = {}) {
  try {
    const d = await api("/api/world/lot", { id: C.player.id, name: C.player.name, lot, action, ...extra });
    if (d.lot) { lots[lot] = d.lot; renderLot(lotById(lot)); }
    return d;
  } catch (e) { toast(e.message, true); return null; }
}
function applyLots(list) {
  const seen = new Set();
  for (const s of list || []) {
    seen.add(s.lot);
    const old = lots[s.lot], key = JSON.stringify(s);
    if (!old || JSON.stringify(old) !== key) {
      const wasMine = old && old.owner_id === C.player.id;
      lots[s.lot] = s;
      if (wasMine && s.owner_id !== C.player.id) toast(`You no longer own lot ${s.lot}.`, true);
      renderLot(lotById(s.lot));
    }
  }
  for (const l of LOTS) if (!seen.has(l.id) && lots[l.id]) { delete lots[l.id]; renderLot(l); }
}
async function payRent(l) {
  if (Date.now() - (lastRent[l.id] || 0) < RENT_COOLDOWN_S * 1000) return;
  lastRent[l.id] = Date.now();
  try {
    const d = await api("/api/world/rent", { id: C.player.id, lot: l.id });
    if (d.paid > 0) { C.player.netWorth = Math.max(0, C.player.netWorth - d.paid); C.sync(); C.play("alert"); emit("rent-paid", d.paid); toast(`🏠 Rent: paid ${money(d.paid)} to ${d.owner} for stopping on their lot.`, true); }
  } catch (e) {}
}

// ---------------------------------------------------------------- the lot you're next to
function adjacentLot() {
  let best = null, bd = Infinity;
  for (const l of LOTS) { const r = blockRect(l), dx = Math.max(r.x0 - car.x, 0, car.x - r.x1), dz = Math.max(r.z0 - car.z, 0, car.z - r.z1), d = Math.hypot(dx, dz); if (d < bd) { bd = d; best = l; } }
  return bd < 5.5 ? best : null;
}
function lotTick(dt) {
  const l = adjacentLot();
  if (l !== nearLot) { nearLot = l; stopT = 0; }
  if (!l) { ui.ctx.style.display = "none"; return; }
  const s = lotOwner(l), d = DISTRICTS[l.district], b = s && businessByKey(s.business);
  let text, btn;
  if (!s) { text = `<b style="color:${d.css}">${esc(d.name)}</b> · lot ${l.id} · FOR SALE ${money(l.price)}`; btn = "BUY"; }
  else if (s.owner_id === C.player.id) { const f = figures(l); text = `<b style="color:${d.css}">${esc(d.name)}</b> · ${b ? `${b.icon} ${esc(s.name || b.name)} ${"★".repeat(s.level || 1)} · ${money(f.profit)}/h` : "Your empty lot"}`; btn = b ? "MANAGE" : "BUILD"; }
  else { text = `<b style="color:${d.css}">${esc(d.name)}</b> · ${b ? `${b.icon} ${esc(s.name || b.name)}` : "Empty lot"} · owner ${esc(s.owner_name)} · rent ${money(rentFor(l.id, s.level, s.business))}`; btn = "VIEW"; }
  ui.ctx.style.display = "flex";
  if (ui.ctx.dataset.k !== text) { ui.ctx.dataset.k = text; ui.ctx.innerHTML = `<span>${text}</span><button class="rb-btn" id="rb-ctx-go">${btn}</button>`; document.getElementById("rb-ctx-go").onclick = () => openLot(l); }
  // stopping on someone else's lot costs rent (Monopoly)
  if (s && s.owner_id !== C.player.id && Math.abs(car.speed) < 2) { stopT += dt; if (stopT > 1.2) { payRent(l); stopT = -999; } }
}

// ---------------------------------------------------------------- panels
function panel(html, actions) {
  ui.panel.querySelector(".overlay-panel").innerHTML = html;
  ui.panel.style.display = "flex";
  ui.panel.querySelectorAll("[data-e]").forEach((el) => { const f = actions[el.dataset.e]; if (f) el.addEventListener(el.tagName === "INPUT" || el.tagName === "SELECT" ? "change" : "click", (ev) => f(ev, el)); });
}
function hidePanel() { ui.panel.style.display = "none"; }

function openLot(l) {
  const s = lotOwner(l), d = DISTRICTS[l.district], b = s && businessByKey(s.business), set = LOTS.filter((x) => x.district === l.district);
  const setLine = `<div class="rb-set">${set.map((x) => { const o = lotOwner(x); return `<span title="lot ${x.id}" style="background:${o ? (o.owner_id === C.player.id ? d.css : "#555") : "transparent"};border-color:${d.css}"></span>`; }).join("")}<em>${ownsSet(l.district) ? "Full set: +50% customers" : "Own all 4 for +50% customers"}</em></div>`;
  const head = `<h2 style="color:${d.css}">${esc(d.name)} · LOT ${l.id}</h2>${setLine}`;
  if (!s) {
    const count = myLots().length;
    return panel(`${head}<div class="subtitle">Deed ${money(l.price)}. Build a business here, collect rent from anyone who stops on it.</div>
      <button class="btn-gold" data-e="buy" ${C.player.netWorth < l.price || count >= MAX_LOTS_PER_PLAYER ? "disabled" : ""}>BUY FOR ${money(l.price)}</button>
      ${count >= MAX_LOTS_PER_PLAYER ? `<div class="rb-muted">You own ${MAX_LOTS_PER_PLAYER} lots, the most anyone can.</div>` : C.player.netWorth < l.price ? `<div class="rb-muted">You need ${money(l.price - C.player.netWorth)} more. Run some jobs.</div>` : ""}
      <button class="btn-ghost" data-e="close">CLOSE</button>`, {
      close: hidePanel,
      buy: async () => { if (C.player.netWorth < l.price) return; const r = await lotAction(l.id, "buy"); if (r && r.ok) { C.player.netWorth -= l.price; C.sync(); C.play("cash"); toast(`🏠 You bought lot ${l.id} in ${d.name}.`); emit("buy", l); if (ownsSet(l.district)) { toast(`🎉 MONOPOLY! You own all of ${d.name}.`); emit("set", l.district); } save(); openLot(l); } },
    });
  }
  if (s.owner_id !== C.player.id) {
    return panel(`${head}<div class="subtitle">${b ? `${b.icon} ${esc(s.name || b.name)} ${"★".repeat(s.level || 1)}` : "An empty lot"}, owned by <b>${esc(s.owner_name)}</b>. Stopping here costs ${money(rentFor(l.id, s.level, s.business))} rent.</div><button class="btn-ghost" data-e="close">CLOSE</button>`, { close: hidePanel });
  }
  if (!b) {
    const tier = d.tier, acts = { close: hidePanel, sell: () => sellLot(l) };
    const rows = BUSINESSES.map((x) => { const ok = x.tier <= tier, afford = C.player.netWorth >= x.cost; acts["b_" + x.key] = async () => { if (!ok || !afford) return; const r = await lotAction(l.id, "build", { business: x.key }); if (r && r.ok) { C.player.netWorth -= x.cost; bizState(l.id).price = x.fair; C.sync(); C.play("cash"); toast(`${x.icon} ${x.name} is open!`); emit("build", x.key); save(); openLot(l); } };
      return `<div class="rb-card ${ok ? "" : "rb-off"}"><div><b>${x.icon} ${x.name}</b><div class="rb-muted">${ok ? `about ${money(x.cap * 0.75 * x.fair - x.upkeep)}/h at a fair ${money(x.fair)} · ${x.night > 1.2 ? "busiest at night" : x.night < 0.6 ? "a daytime business" : "steady all day"}` : `needs a ${["", "", "Arts or Market", "Midtown or Uptown", "Financial or Billionaire Row"][x.tier]} lot or better`}</div></div><button class="rb-btn" data-e="b_${x.key}" ${ok && afford ? "" : "disabled"}>${money(x.cost)}</button></div>`; }).join("");
    return panel(`${head}<div class="subtitle">Build a business. Pricier districts unlock bigger ones.</div>${rows}<button class="btn-ghost" data-e="sell">SELL THE LOT (half back)</button><button class="btn-ghost" data-e="close">CLOSE</button>`, acts);
  }
  // your business
  const f = figures(l), st = bizState(l.id), lvl = f.lvl, up = lvl < MAX_LEVEL ? upgradeCost(b, lvl) : 0;
  const staffCards = st.staff.map((cid) => S.cards.find((c) => c.id === cid)).filter(Boolean);
  const free = S.cards.filter((c) => !Object.values(S.biz).some((x) => x.staff.includes(c.id)));
  const bar = (v, col) => `<div class="rb-bar"><i style="width:${Math.round(Math.max(0, Math.min(1, v)) * 100)}%;background:${col}"></i></div>`;
  const acts = {
    close: hidePanel,
    price: (ev, el) => { st.price = Math.max(1, Math.round(Number(el.value))); save(); openLot(l); },
    up: async () => { if (lvl >= MAX_LEVEL || C.player.netWorth < up) return; const r = await lotAction(l.id, "upgrade", { level: lvl + 1 }); if (r && r.ok) { C.player.netWorth -= up; C.sync(); C.play("cash"); toast(`${b.icon} Upgraded to ${"★".repeat(lvl + 1)}`); emit("upgrade", lvl + 1); save(); openLot(l); } },
    mkt: () => { const c = Math.round(b.cost * 0.05); if (C.player.netWorth < c) return; C.player.netWorth -= c; st.mkt = Date.now() + 5 * 60000; C.sync(); toast(`📣 Marketing campaign running: +30% customers for 5 minutes.`); save(); openLot(l); },
    hire: (ev, el) => { if (!el.value || st.staff.length >= 2) return; st.staff.push(el.value); save(); openLot(l); },
    rename: () => { const n = prompt("Name your business", s.name || b.name); if (n && n.trim()) lotAction(l.id, "rename", { title: n.trim().slice(0, 28) }).then(() => openLot(l)); },
    sell: () => sellLot(l),
  };
  staffCards.forEach((c) => { acts["fire_" + c.id] = () => { st.staff = st.staff.filter((x) => x !== c.id); save(); openLot(l); }; });
  panel(`${head}<h2 style="font-size:14px">${b.icon} ${esc(s.name || b.name)} ${"★".repeat(lvl)}${"☆".repeat(MAX_LEVEL - lvl)} <a href="#" data-e="rename" style="font-size:10px;color:var(--gold)">rename</a></h2>
    <div class="rb-grid">
      <div><span>Customers</span><b>${Math.round(f.customers)}/h</b></div><div><span>Revenue</span><b>${money(f.revenue)}/h</b></div>
      <div><span>Costs</span><b>${money(f.cost)}/h</b></div><div><span>Profit</span><b style="color:${f.profit >= 0 ? "var(--green)" : "var(--red)"}">${money(f.profit)}/h</b></div>
    </div>
    <div class="rb-muted">Satisfaction</div>${bar(st.sat, "#00E676")}<div class="rb-muted">Reputation</div>${bar((st.rep - 0.5), "#C9A84C")}
    <label class="rb-muted">Price per customer: <b>${money(f.price)}</b> (fair is about ${money(b.fair)})</label>
    <input type="range" min="${Math.max(1, Math.round(b.fair * 0.3))}" max="${Math.round(b.fair * 2.2)}" value="${Math.round(f.price)}" data-e="price" style="width:100%">
    <div class="rb-muted">${f.r > 1.3 ? "Customers think it's too dear: fewer of them, and they're less happy." : f.r < 0.7 ? "Cheap: busy and happy, but thin margins." : "A fair price."}${isNight() ? " It's night now." : ""}${f.set > 1 ? " Full district set: +50%." : ""}${f.mkt > 1 ? " Marketing: +30%." : ""}</div>
    <div class="rb-muted" style="margin-top:8px">Staff (up to 2; a ${ROLES[b.role]} fits best)</div>
    ${staffCards.map((c) => `<div class="rb-card"><div><b style="color:${RARITY.find((r) => r.key === c.rarity).css}">${esc(c.name)}</b><div class="rb-muted">${RARITY.find((r) => r.key === c.rarity).name} ${ROLES[c.role]} · ${c.role === b.role ? "+" + Math.round(RARITY.find((r) => r.key === c.rarity).bonus * 100) + "%" : "+3%"} · ${money(RARITY.find((r) => r.key === c.rarity).wage)}/h</div></div><button class="rb-btn" data-e="fire_${c.id}">LET GO</button></div>`).join("")}
    ${st.staff.length < 2 ? `<select data-e="hire" style="width:100%;padding:8px;background:#111;color:#fff;border:1px solid #333;border-radius:8px"><option value="">Hire from your talent cards…</option>${free.map((c) => `<option value="${c.id}">${esc(c.name)} · ${RARITY.find((r) => r.key === c.rarity).name}${c.role === b.role ? " ✓" : ""}</option>`).join("")}</select>` : ""}
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
      ${lvl < MAX_LEVEL ? `<button class="btn-gold" style="flex:1" data-e="up" ${C.player.netWorth < up ? "disabled" : ""}>UPGRADE ${money(up)}</button>` : ""}
      <button class="btn-gold" style="flex:1" data-e="mkt" ${st.mkt > Date.now() ? "disabled" : ""}>MARKETING ${money(b.cost * 0.05)}</button>
    </div>
    <div class="rb-muted">Made so far: ${money(st.made)}</div>
    <button class="btn-ghost" data-e="sell">SELL (half back)</button><button class="btn-ghost" data-e="close">CLOSE</button>`, acts);
}
async function sellLot(l) {
  const s = lots[l.id], b = s && businessByKey(s.business);
  const value = Math.round((l.price + (b ? b.cost : 0)) * 0.5);
  if (!confirm(`Sell lot ${l.id} for ${money(value)}?`)) return;
  const r = await lotAction(l.id, "sell");
  if (r && r.ok) { C.player.netWorth += value; delete S.biz[l.id]; C.sync(); C.play("cash"); toast(`Sold lot ${l.id} for ${money(value)}.`); save(); hidePanel(); }
}

function openEmpire() {
  const my = myLots();
  const rows = my.map((l) => { const s = lots[l.id], b = businessByKey(s.business), f = figures(l), d = DISTRICTS[l.district]; return `<div class="rb-card"><div><b style="color:${d.css}">${b ? b.icon + " " + esc(s.name || b.name) + " " + "★".repeat(s.level || 1) : "Empty lot"}</b><div class="rb-muted">${esc(d.name)} · lot ${l.id}${f ? ` · ${Math.round(f.customers)} customers/h` : ""}</div></div><b style="color:${f && f.profit >= 0 ? "var(--green)" : "var(--gold)"}">${f ? money(f.profit) + "/h" : "build"}</b></div>`; }).join("") || `<div class="rb-muted">You don't own anything yet. Drive up to a lot with a FOR SALE sign and buy it.</div>`;
  const total = my.reduce((a, l) => a + (figures(l)?.profit || 0), 0);
  const board = DISTRICTS.map((d, i) => `<div class="rb-row"><span style="color:${d.css};min-width:130px">${esc(d.name)}</span>${LOTS.filter((l) => l.district === i).map((l) => { const o = lotOwner(l); return `<span class="rb-dot" title="lot ${l.id}" style="background:${o ? (o.owner_id === C.player.id ? d.css : "#555") : "transparent"};border-color:${d.css}"></span>`; }).join("")}${ownsSet(i) ? "🎉" : ""}</div>`).join("");
  panel(`<h2 style="color:var(--green)">YOUR EMPIRE</h2><div class="subtitle">${my.length} of ${MAX_LOTS_PER_PLAYER} lots · ${money(total)}/h · empire worth ${money(C.player.empireValue)} · earned in all ${money(S.stats.earned)}</div>
    ${rows}<div class="rb-muted" style="margin:12px 0 6px">THE BOARD (filled = yours, grey = another player's)</div>${board}
    <div class="rb-muted" style="margin-top:10px">Jobs done ${S.stats.jobs} · drops collected ${S.stats.drops} · busted ${S.stats.busts} times</div>
    <button class="btn-ghost" data-e="close">CLOSE</button>`, { close: hidePanel });
}
function openCards() {
  const byRole = Object.keys(ROLES).map((r) => { const cs = S.cards.filter((c) => c.role === r); return `<div class="rb-row"><span style="min-width:90px">${ROLES[r]}</span>${RARITY.map((x) => { const n = cs.filter((c) => c.rarity === x.key).length; return `<span class="rb-tag" style="border-color:${x.css};color:${n ? x.css : "#444"}">${x.name[0]}${n ? "×" + n : ""}</span>`; }).join("")}</div>`; }).join("");
  const uniq = new Set(S.cards.map((c) => c.role + c.rarity)).size;
  panel(`<h2>🃏 TALENT</h2><div class="subtitle">Collect talent from drops on the street, near where you really are (turn on location) and from jobs. Hire them in your businesses. ${uniq} of ${Object.keys(ROLES).length * RARITY.length} kinds found.</div>${byRole}<button class="btn-ghost" data-e="close">CLOSE</button>`, { close: hidePanel });
}

// ---------------------------------------------------------------- on-screen bits
function toast(text, bad, color) {
  const t = document.createElement("div"); t.className = "rb-toast"; t.textContent = text;
  if (bad) t.style.borderColor = "var(--red)"; if (color) t.style.borderColor = color;
  toastBox.appendChild(t); setTimeout(() => t.remove(), 4200);
}
function buildUi() {
  const css = document.createElement("style");
  css.textContent = `.rb-toasts{position:fixed;top:150px;left:50%;transform:translateX(-50%);z-index:8000;display:grid;gap:6px;pointer-events:none;width:min(92vw,420px)}
.rb-toast{background:rgba(0,0,0,.88);border:1px solid var(--gold);color:#fff;padding:9px 14px;border-radius:12px;font:700 12px/1.35 Inter,system-ui,sans-serif;text-align:center;animation:rbin .25s ease}
@keyframes rbin{from{opacity:0;transform:translateY(-6px)}}
.rb-ctx{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(74px + env(safe-area-inset-bottom));z-index:7000;display:none;gap:10px;align-items:center;background:rgba(0,0,0,.88);border:1px solid var(--gold);border-radius:14px;padding:8px 10px 8px 14px;color:#fff;font:600 12px/1.3 Inter,system-ui,sans-serif;max-width:94vw}
.rb-btn{background:linear-gradient(135deg,#6B4F0F,#C9A84C);color:#000;border:0;border-radius:9px;padding:8px 12px;font:900 11px/1 Inter,sans-serif;letter-spacing:1px;cursor:pointer;white-space:nowrap}.rb-btn[disabled]{opacity:.35;cursor:default}
.rb-chip{position:fixed;z-index:7000;background:rgba(0,0,0,.8);border:1px solid rgba(201,168,76,.5);color:#F5E6A3;border-radius:10px;padding:6px 10px;font:700 11px/1.2 Inter,sans-serif;pointer-events:none}
.rb-wanted{position:fixed;top:118px;left:50%;transform:translateX(-50%);z-index:7600;display:none;text-align:center;background:rgba(40,0,0,.85);border:1px solid var(--red);border-radius:12px;padding:6px 14px;color:#fff;font:700 11px/1.3 Inter,sans-serif}.rb-wanted b{display:block;color:var(--red);font-size:20px;letter-spacing:4px}
.rb-card{display:flex;justify-content:space-between;gap:10px;align-items:center;background:rgba(255,255,255,.03);border:1px solid rgba(201,168,76,.15);border-radius:10px;padding:10px;margin-bottom:8px;font-size:12px}.rb-card.rb-off{opacity:.45}
.rb-muted{color:rgba(255,255,255,.5);font-size:11px;margin:4px 0}.rb-red{color:var(--red)}
.rb-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0}.rb-grid div{background:rgba(255,255,255,.04);border-radius:8px;padding:8px}.rb-grid span{display:block;font-size:9px;color:rgba(255,255,255,.5);letter-spacing:1px}.rb-grid b{font-size:15px}
.rb-bar{height:6px;border-radius:4px;background:rgba(255,255,255,.08);overflow:hidden;margin-bottom:6px}.rb-bar i{display:block;height:100%}
.rb-set{display:flex;gap:6px;align-items:center;margin:6px 0 10px}.rb-set span,.rb-dot{width:18px;height:18px;border-radius:4px;border:2px solid;display:inline-block}.rb-set em{font-size:10px;color:rgba(255,255,255,.55);font-style:normal}
.rb-row{display:flex;gap:6px;align-items:center;margin:4px 0;font-size:11px}.rb-tag{border:1px solid;border-radius:6px;padding:2px 6px;font-size:10px;font-weight:800}
.rb-joy{position:fixed;left:18px;bottom:calc(86px + env(safe-area-inset-bottom));width:120px;height:120px;border-radius:50%;border:2px solid rgba(201,168,76,.45);background:rgba(0,0,0,.35);z-index:6900;touch-action:none}.rb-joy i{position:absolute;left:35px;top:35px;width:50px;height:50px;border-radius:50%;background:rgba(201,168,76,.6)}
@media (hover:hover) and (pointer:fine){.rb-joy{display:none}}
@media (max-width:640px){#controls{left:0!important;right:0!important;transform:none!important;width:100vw!important;max-width:100vw!important;overflow-x:auto!important;justify-content:flex-start!important;flex-wrap:nowrap!important;padding:0 8px!important;scrollbar-width:none}#controls::-webkit-scrollbar{display:none}#controls .ctrl-btn{flex:0 0 auto}}`;
  document.head.appendChild(css);
  toastBox = Object.assign(document.createElement("div"), { className: "rb-toasts" }); document.body.appendChild(toastBox);
  ui.ctx = Object.assign(document.createElement("div"), { className: "rb-ctx" }); document.body.appendChild(ui.ctx);
  ui.clock = Object.assign(document.createElement("div"), { className: "rb-chip" }); ui.clock.style.cssText += "top:120px;left:12px"; document.body.appendChild(ui.clock);
  ui.near = Object.assign(document.createElement("div"), { className: "rb-chip" }); ui.near.style.cssText += "top:146px;left:12px;display:none;max-width:60vw"; document.body.appendChild(ui.near);
  ui.job = Object.assign(document.createElement("div"), { className: "rb-chip" }); ui.job.style.cssText += "top:172px;left:12px;display:none;border-color:var(--red)"; document.body.appendChild(ui.job);
  ui.wanted = Object.assign(document.createElement("div"), { className: "rb-wanted" }); document.body.appendChild(ui.wanted);
  ui.panel = document.createElement("div"); ui.panel.className = "overlay"; ui.panel.id = "ov-empire"; ui.panel.innerHTML = '<div class="overlay-panel" style="max-height:86vh;overflow:auto"></div>';
  ui.panel.addEventListener("click", (e) => { if (e.target === ui.panel) hidePanel(); }); document.body.appendChild(ui.panel);
  // touch joystick
  const j = Object.assign(document.createElement("div"), { className: "rb-joy" }); j.innerHTML = "<i></i>"; document.body.appendChild(j);
  const knob = j.firstChild, move = (e) => { const r = j.getBoundingClientRect(), t = e.touches ? e.touches[0] : e; let x = (t.clientX - r.left - 60) / 50, y = (t.clientY - r.top - 60) / 50; const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; } joy.x = x; joy.y = y; joy.on = true; knob.style.transform = `translate(${x * 35}px,${y * 35}px)`; e.preventDefault(); };
  const end = () => { joy.on = false; joy.x = joy.y = 0; knob.style.transform = ""; };
  j.addEventListener("touchstart", move, { passive: false }); j.addEventListener("touchmove", move, { passive: false }); j.addEventListener("touchend", end); j.addEventListener("touchcancel", end);
  window.addEventListener("keydown", (e) => { if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "")) return; keys[e.code] = true; if (e.code === "KeyE" && nearLot) openLot(nearLot); if (e.code === "KeyC") cycleCam(); if (e.code === "KeyH" && C.help) C.help(); if (e.code === "KeyR") emit("race-key"); if (e.code === "Escape") hidePanel(); if (/Arrow|Space/.test(e.code)) e.preventDefault(); });
  window.addEventListener("keyup", (e) => { keys[e.code] = false; });
  // the existing buttons get the new systems; two new ones for the empire and the talent book
  const ctr = document.getElementById("controls");
  const add = (id, icon, title, fn) => { const b = document.createElement("button"); b.className = "ctrl-btn"; b.id = id; b.textContent = icon; b.title = title; b.setAttribute("aria-label", title); b.onclick = fn; ctr.insertBefore(b, ctr.firstChild); };
  add("btn-cards", "🃏", "Talent cards", openCards);
  add("btn-empire", "🏢", "Your empire", openEmpire);
  document.getElementById("btn-hustle").onclick = openJobs;
  document.getElementById("btn-hustle").title = "Hustle: jobs and heists";
  document.getElementById("btn-invest").onclick = openEmpire;
  document.getElementById("btn-pov").onclick = cycleCam;
  document.getElementById("btn-pov").title = "Camera view";
  const hint = window.matchMedia("(pointer:fine)").matches ? "Drive with WASD or the arrow keys, Space to brake, E at a lot." : "Drive with the stick bottom-left. Stop by a lot to buy or build.";
  // The chips sit just under the stats, wherever those end (two rows on a phone).
  const place = () => {
    const hud = document.getElementById("hud-stats") || document.getElementById("hud"), top = hud ? Math.round(hud.getBoundingClientRect().bottom) + 10 : 120;
    [ui.clock, ui.near, ui.job].forEach((el, i) => { el.style.top = top + i * 26 + "px"; });
    const chip = document.getElementById("rb-badge-chip"); if (chip) chip.style.top = top + 3 * 26 + "px";
    ui.wanted.style.top = top + "px"; toastBox.style.top = top + 34 + "px";
  };
  place(); window.addEventListener("resize", place); setInterval(place, 3000);
  setTimeout(() => toast(`🚗 ${hint}`), 1500);
  setTimeout(() => toast("🏠 Buy lots, build businesses, run jobs from 🔥, collect 💰💎🃏 drops."), 5000);
}

// ---------------------------------------------------------------- start
export function initEmpire(ctx) {
  C = ctx;
  load();
  buildUi();
  buildCity();
  for (const l of LOTS) renderLot(l);
  car.mesh = makeCar(0xC9A84C, false, true);
  const under = new THREE.PointLight(0xC9A84C, 2, 14); under.position.y = 3; car.mesh.add(under);
  if (C.mesh()) C.mesh().visible = false;
  for (let i = 0; i < 10; i++) traffic.push(spawnRoadCar(pick([0x7FD3F7, 0xE53935, 0x2EB872, 0xF5F5F5, 0x8B5A2B, 0xE05AA8]), false, false));
  for (let i = 0; i < 12; i++) spawnDrop();
  onBeat((d) => {
    if (d.lots) applyLots(d.lots);
    if (d.rent > 0) { C.player.netWorth += d.rent; C.sync(); C.play("cash"); toast(`🏠 You collected ${money(d.rent)} rent from players who stopped on your lots.`); }
  });
  setTimeout(offlineEarnings, 6000); // once the lots have arrived
  let acc = 0, gpsAcc = 9;
  C.onFrame((dt, t) => {
    dt = Math.min(dt, 0.1);
    driveCar(dt);
    for (const c of traffic) moveRoadCar(c, dt, false);
    copsTick(dt); jobTick(dt); dropsTick(dt, t); lotTick(dt); skidsTick(dt); emit("frame", dt);
    for (const g of Object.values(lotMeshes)) for (const o of g.children) if (o.userData.spin) o.rotation.y += dt;
    acc += dt; if (acc >= 1) { tycoonTick(acc); acc = 0; S.lastTick = Date.now(); }
    gpsAcc += dt; if (gpsAcc >= 5) { gpsAcc = 0; gpsTick(); save(); }
  });
  window.addEventListener("beforeunload", () => { S.lastTick = Date.now(); save(); });
  return { openLot, openEmpire, openJobs, setWanted, state: S, lots, car, toast, panel, hidePanel, emit, money,
    radar: () => ({ car, cops, traffic, drops, job, lots, wanted, roadLines, mine: (l) => mine(l), lotOwner }), camName: () => CAMS[camMode], save,
    giveCard: (key) => giveCard("reward", RARITY.find((r) => r.key === key)) };
}
