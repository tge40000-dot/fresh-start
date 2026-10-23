// RB World's cars: modelled bodies instead of boxes. Each car is a side profile with real wheel arches, extruded and
// rounded at the edges, with clearcoat paint, a glass cabin, LED head and tail lights, a grille, mirrors, exhausts, a
// plate and 5-spoke wheels with brake discs. Four shapes: "sport" (yours and racers'), "sedan" (most traffic, taxis,
// cops), "suv" and "van". Geometry is built once per shape and shared; a car is 9 draw calls (paint, glass, details,
// tail lights, plate and the four wheels). makeCar() keeps the interface the game uses: userData.wheels
// [{ pivot, w, front }], tailMat, paint, flames (yours), siren (cops), wheelR.
import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

// ---------------------------------------------------------------- the shapes (metres; z forward, y up)
// body: the side outline, rear bottom round to rear bumper, with the two arches cut in the bottom edge
// cabin: the glass, roof: the painted roof panel on it; wb: the wheel centres along z; r: wheel radius
const SHAPES = {
  sport: { w: 2.0, len: 4.5, r: 0.36, wb: [-1.42, 1.38], ride: 0.34, cabW: 1.56,
    body: [[-2.25, 0.36], [2.18, 0.34], ["q", 2.32, 0.4, 2.3, 0.6], ["q", 2.24, 0.8, 2.0, 0.84], ["q", 1.4, 0.95, 0.9, 0.98], [-1.3, 1.0], ["q", -1.95, 1.04, -2.18, 1.0], ["q", -2.32, 0.9, -2.28, 0.6], [-2.25, 0.36]],
    cabin: [[0.98, 0.95], ["q", 0.55, 1.18, 0.1, 1.33], ["q", -0.4, 1.4, -0.9, 1.33], ["q", -1.45, 1.2, -1.85, 1.0]],
    roof: [[0.14, 1.3], [-0.92, 1.3], [-0.88, 1.37], ["q", -0.4, 1.43, 0.1, 1.37]] },
  sedan: { w: 1.9, len: 4.7, r: 0.35, wb: [-1.45, 1.45], ride: 0.32, cabW: 1.62,
    body: [[-2.32, 0.34], [2.3, 0.32], ["q", 2.42, 0.42, 2.4, 0.66], ["q", 2.36, 0.86, 2.1, 0.9], ["q", 1.5, 0.98, 1.05, 1.0], [-1.55, 1.02], ["q", -2.2, 1.05, -2.3, 0.95], ["q", -2.4, 0.84, -2.36, 0.6], [-2.32, 0.34]],
    cabin: [[1.1, 0.98], ["q", 0.75, 1.3, 0.35, 1.45], [-0.95, 1.47], ["q", -1.45, 1.35, -1.72, 1.01]],
    roof: [[0.36, 1.42], [-0.97, 1.43], [-0.94, 1.5], [0.32, 1.49]] },
  suv: { w: 2.0, len: 4.75, r: 0.42, wb: [-1.48, 1.45], ride: 0.42, cabW: 1.78,
    body: [[-2.32, 0.44], [2.3, 0.44], ["q", 2.42, 0.6, 2.4, 0.86], ["q", 2.34, 1.08, 2.0, 1.12], [1.2, 1.16], [-2.2, 1.2], ["q", -2.38, 1.16, -2.38, 0.9], [-2.32, 0.44]],
    cabin: [[1.22, 1.14], ["q", 0.9, 1.6, 0.5, 1.8], [-1.95, 1.82], ["q", -2.2, 1.6, -2.22, 1.2]],
    roof: [[0.5, 1.76], [-1.98, 1.78], [-1.96, 1.87], [0.46, 1.86]] },
  van: { w: 2.0, len: 5.2, r: 0.38, wb: [-1.8, 1.7], ride: 0.38, cabW: 1.86,
    body: [[-2.55, 0.4], [2.5, 0.4], ["q", 2.62, 0.56, 2.6, 0.82], ["q", 2.5, 1.02, 2.2, 1.06], [1.9, 1.1], [1.9, 2.3], [-2.5, 2.3], ["q", -2.6, 2.28, -2.6, 2.1], [-2.6, 0.6], [-2.55, 0.4]],
    cabin: [[2.0, 1.08], ["q", 1.7, 1.6, 1.25, 2.02], [1.0, 2.05], [1.0, 1.1]],
    roof: [[1.3, 1.98], [-2.5, 1.98], [-2.5, 2.32], [1.2, 2.32]] },
};
const CELLS = { trim: 0, chrome: 1, lamp: 2, accent: 3 }; // the details atlas: one texel per finish

// the outline as a THREE.Shape, with the wheel arches cut out of the bottom edge
function outline(pts, S, arches) {
  const sh = new THREE.Shape(), [x0, y0] = pts[0]; sh.moveTo(x0, y0);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (i === 1 && arches) { // the bottom edge, rear to front, round both arches
      const base = pts[0][1], ar = S.r + 0.09;
      for (const c of S.wb) { sh.lineTo(c - ar, base); sh.absarc(c, S.r, ar, Math.PI, 0, true); }
    }
    if (p[0] === "q") sh.quadraticCurveTo(p[1], p[2], p[3], p[4]); else sh.lineTo(p[0], p[1]);
  }
  return sh;
}
// extrude the outline across the car, round the edges, and smooth the curved sides (the flat side panels stay flat)
function body(pts, S, width, bevel, arches) {
  const depth = Math.max(0.05, width - bevel * 2);
  const g = new THREE.ExtrudeGeometry(outline(pts, S, arches), { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.7, bevelSegments: 4, curveSegments: 10, steps: 1 });
  g.rotateY(-Math.PI / 2); g.translate(depth / 2, 0, 0);
  const [caps, sides] = g.groups;
  const part = (gr, smooth) => {
    const out = new THREE.BufferGeometry();
    for (const k of ["position", "normal"]) { const a = g.attributes[k]; out.setAttribute(k, new THREE.BufferAttribute(a.array.slice(gr.start * 3, (gr.start + gr.count) * 3), 3)); }
    if (!smooth) return out;
    const m = mergeVertices(out, 1e-4); m.computeVertexNormals(); return m.toNonIndexed();
  };
  const r = [part(caps, false), part(sides, true)]; g.dispose(); return r;
}
// every vertex of a part points at one texel of the details atlas (so trim, chrome and lamps share one draw call)
function cell(geo, c) {
  geo = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(geo.attributes)) if (k !== "position" && k !== "normal") geo.deleteAttribute(k);
  const n = geo.attributes.position.count, uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { uv[i * 2] = (c + 0.5) / 4; uv[i * 2 + 1] = 0.5; }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); return geo;
}
const plain = (geo) => cell(geo, 0);
const at = (geo, x, y, z, ry = 0, rx = 0, rz = 0) => { geo.rotateX(rx); geo.rotateZ(rz); geo.rotateY(ry); geo.translate(x, y, z); return geo; };

const built = {};
function shape(kind) {
  if (built[kind]) return built[kind];
  const S = SHAPES[kind], W = S.w;
  // where the outline's front (sign 1) or back (-1) is at height y, plus the rounded edge
  const flatPts = outline(S.body, S, false).getPoints(10);
  const edgeAt = (y, sign) => { let best = -Infinity; for (let i = 0; i < flatPts.length; i++) { const a = flatPts[i], b = flatPts[(i + 1) % flatPts.length]; if ((a.y - y) * (b.y - y) > 0 || a.y === b.y) continue; const x = a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x); best = Math.max(best, x * sign); } return best * sign + sign * 0.084; };
  // paint: the body and the roof
  const paint = mergeGeometries([...body(S.body, S, W, 0.12, true), ...body(S.roof, S, S.cabW - 0.04, 0.05, false)].map(plain));
  // glass: the cabin, a little narrower than the body
  const glass = mergeGeometries(body(S.cabin, S, S.cabW, 0.08, false).map(plain));
  // details: wheel-well liners, grille, splitter, skirts, diffuser, mirrors, exhausts, calipers, headlights
  const d = [];
  const add = (geo, c) => d.push(cell(geo, CELLS[c]));
  for (const z of S.wb) { const liner = new THREE.CylinderGeometry(S.r + 0.08, S.r + 0.08, W - 0.1, 16, 1, true, 0, Math.PI); liner.scale(1, 1, -1); add(at(liner, 0, S.r, z, 0, 0, Math.PI / 2), "trim"); } // wheel wells
  const gy = S.ride + 0.2, noseZ = edgeAt(gy, 1), tailZ = edgeAt(S.ride + 0.2, -1);
  add(at(new THREE.BoxGeometry(W * 0.55, 0.16, 0.08), 0, gy, noseZ - 0.02), "trim"); // grille
  add(at(new THREE.BoxGeometry(W * 0.9, 0.05, 0.3), 0, S.ride + 0.02, edgeAt(S.ride + 0.05, 1) - 0.1), "trim"); // splitter
  for (const s of [-1, 1]) add(at(new THREE.BoxGeometry(0.06, 0.1, S.wb[1] - S.wb[0] - S.r * 2 - 0.2), s * (W / 2 + 0.04), S.ride + 0.08, (S.wb[0] + S.wb[1]) / 2), "trim"); // skirts
  add(at(new THREE.BoxGeometry(W * 0.7, 0.14, 0.12), 0, S.ride + 0.06, edgeAt(S.ride + 0.06, -1) + 0.04), "trim"); // diffuser
  const mz = (S.cabin[0][0] + (kind === "van" ? -0.15 : -0.12)), my = S.cabin[0][1] + 0.08;
  for (const s of [-1, 1]) { add(at(new THREE.BoxGeometry(0.22, 0.12, 0.08), s * (S.cabW / 2 + 0.16), my, mz), "trim"); add(at(new THREE.BoxGeometry(0.06, 0.04, 0.1), s * (S.cabW / 2 + 0.05), my - 0.04, mz), "trim"); }
  if (kind === "sport") for (const s of [-1, 1]) add(at(new THREE.CylinderGeometry(0.055, 0.06, 0.16, 12), s * 0.4, S.ride + 0.12, edgeAt(S.ride + 0.12, -1), 0, Math.PI / 2), "chrome");
  for (const z of S.wb) for (const s of [-1, 1]) add(at(new THREE.BoxGeometry(0.08, S.r * 0.55, S.r * 0.4), s * (W / 2 - 0.22), S.r + S.r * 0.25, z + S.r * 0.3), "accent"); // calipers
  // headlights: a lamp each side and a daytime running strip
  const hy = S.ride + (kind === "van" || kind === "suv" ? 0.5 : 0.36);
  const hz = edgeAt(hy, 1);
  for (const s of [-1, 1]) { add(at(new THREE.BoxGeometry(0.42, 0.1, 0.06), s * (W / 2 - 0.32), hy, hz - 0.015), "lamp"); add(at(new THREE.BoxGeometry(0.36, 0.025, 0.05), s * (W / 2 - 0.34), hy - 0.08, edgeAt(hy - 0.08, 1) - 0.01), "lamp"); }
  const details = mergeGeometries(d);
  // tail lights: a full-width LED bar and a cluster each side
  const ty = S.ride + (kind === "van" ? 0.7 : kind === "suv" ? 0.62 : 0.46);
  const tz = edgeAt(ty, -1) + 0.012;
  const tl = [plain(at(new THREE.BoxGeometry(W * 0.82, 0.05, 0.04), 0, ty, tz))];
  for (const s of [-1, 1]) tl.push(plain(at(new THREE.BoxGeometry(0.34, 0.12, 0.05), s * (W / 2 - 0.3), ty - 0.02, tz)));
  const tail = mergeGeometries(tl);
  // the plate
  const plate = new THREE.PlaneGeometry(0.52, 0.12); plate.rotateY(Math.PI); plate.translate(0, S.ride + 0.25, edgeAt(S.ride + 0.25, -1) - 0.02);
  // a wheel: the tyre (a lathe with rounded sidewalls), the rim with five spokes and the brake disc, in one mesh
  const R = S.r, tw = 0.25, prof = [];
  for (let k = 0; k <= 8; k++) { const a = -Math.PI / 2 + (k / 8) * Math.PI; prof.push(new THREE.Vector2(R - 0.07 + Math.cos(a) * 0.07, (tw / 2) * Math.sin(a))); }
  prof.unshift(new THREE.Vector2(R * 0.72, -tw / 2)); prof.push(new THREE.Vector2(R * 0.72, tw / 2));
  const tyre = new THREE.LatheGeometry(prof, 28); tyre.rotateZ(Math.PI / 2);
  const wparts = [cell(tyre, CELLS.trim)];
  const rim = new THREE.CylinderGeometry(R * 0.74, R * 0.74, tw * 0.9, 24, 1, true); rim.rotateZ(Math.PI / 2); wparts.push(cell(rim, CELLS.chrome));
  for (let k = 0; k < 5; k++) { const sp = new THREE.BoxGeometry(0.035, R * 0.66, 0.07); sp.translate(0, R * 0.33, 0); sp.rotateX((k / 5) * Math.PI * 2); sp.translate(0.1, 0, 0); wparts.push(cell(sp.clone(), CELLS.chrome)); sp.translate(-0.2, 0, 0); wparts.push(cell(sp, CELLS.chrome)); }
  const hub = new THREE.CylinderGeometry(0.06, 0.06, tw * 0.95, 12); hub.rotateZ(Math.PI / 2); wparts.push(cell(hub, CELLS.chrome));
  const disc = new THREE.CylinderGeometry(R * 0.6, R * 0.6, 0.03, 20); disc.rotateZ(Math.PI / 2); wparts.push(cell(disc, CELLS.trim));
  const wheel = mergeGeometries(wparts);
  return (built[kind] = { S, paint, glass, details, tail, plate, wheel });
}

// ---------------------------------------------------------------- shared materials
let MATS = null;
function mats() {
  if (MATS) return MATS;
  const atlas = (cols) => { const c = document.createElement("canvas"); c.width = 4; c.height = 1; const g = c.getContext("2d"); cols.forEach((v, i) => { g.fillStyle = v; g.fillRect(i, 0, 1, 1); }); const t = new THREE.CanvasTexture(c); t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; return t; };
  const map = atlas(["#0c0d0f", "#d8dade", "#f4f6ff", "#c9a84c"]); map.colorSpace = THREE.SRGBColorSpace;
  const orm = atlas(["rgb(255,170,0)", "rgb(255,40,255)", "rgb(255,30,0)", "rgb(255,70,230)"]); // G roughness, B metalness
  const emi = atlas(["#000", "#000", "#fff", "#000"]); emi.colorSpace = THREE.SRGBColorSpace;
  const plateC = document.createElement("canvas"); plateC.width = 256; plateC.height = 64;
  const g = plateC.getContext("2d"); g.fillStyle = "#f2f0e8"; g.fillRect(0, 0, 256, 64); g.strokeStyle = "#1a2a5a"; g.lineWidth = 4; g.strokeRect(3, 3, 250, 58);
  g.fillStyle = "#1a2a5a"; g.font = "900 38px Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("RB WORLD", 128, 35);
  const plateT = new THREE.CanvasTexture(plateC); plateT.colorSpace = THREE.SRGBColorSpace;
  MATS = {
    glass: new THREE.MeshPhysicalMaterial({ color: 0x10161d, metalness: 0.2, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.8 }),
    details: new THREE.MeshStandardMaterial({ map, roughnessMap: orm, metalnessMap: orm, emissive: 0xffffff, emissiveMap: emi, emissiveIntensity: 0.6, roughness: 1, metalness: 1, envMapIntensity: 1.3 }),
    plate: new THREE.MeshStandardMaterial({ map: plateT, roughness: 0.4 }),
  };
  return MATS;
}
// how bright the headlights are (DRLs by day, full beam at night): set by the day and night cycle
export function headlights(level) { mats().details.emissiveIntensity = level; }

// ---------------------------------------------------------------- a car
// kind: "sport" | "sedan" | "suv" | "van". Returns a group whose userData drives the wheels and lights.
export function buildCar(color, opts = {}) {
  const kind = SHAPES[opts.kind] ? opts.kind : "sedan", G = shape(kind), M = mats(), S = G.S;
  const g = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: opts.glow ? 0.85 : 0.5, roughness: opts.glow ? 0.26 : 0.34, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: opts.glow ? 1.0 : 1.15, emissive: opts.glow ? color : 0x000000, emissiveIntensity: opts.glow ? 0.03 : 0 });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0x550000 });
  for (const [geo, mat] of [[G.paint, paint], [G.glass, M.glass], [G.details, M.details], [G.tail, tailMat], [G.plate, M.plate]]) { const m = new THREE.Mesh(geo, mat); m.castShadow = mat !== tailMat && mat !== M.plate; m.receiveShadow = true; g.add(m); }
  const wheels = [];
  for (const z of S.wb) for (const s of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(s * (S.w / 2 - 0.16), S.r, z);
    const w = new THREE.Mesh(G.wheel, M.details); w.castShadow = true; if (s < 0) w.rotation.y = Math.PI; // the spokes face out on both sides
    const spin = new THREE.Group(); spin.add(w); pivot.add(spin); g.add(pivot);
    wheels.push({ pivot, w: spin, front: z > 0 ? 1 : 0 });
  }
  g.userData = { wheels, tailMat, paint, wheelR: S.r, kind, len: S.len, roofY: Math.max(...S.roof.map((q) => (q[0] === "q" ? q[4] : q[1]))) };
  return g;
}
