// RB World's city on real streets: Midtown Manhattan round Times Square, from OpenStreetMap (city_data.js, baked by
// rb-tools/bake_city.mjs). This module reads the baked map and offers what the game needs (collision with real
// buildings, the road network for traffic and cops, street and neighbourhood names, real latitude/longitude for any
// point), and builds the 3D city: buildings with window facades and storefronts, asphalt roads with lane markings
// and crosswalks, sidewalks, parks, street lights, traffic lights, street trees, rooftop water towers, and the
// Times Square billboards. Map data © OpenStreetMap contributors (ODbL).
import * as THREE from "three";
import D from "./city_data.js";

const dm = (v) => v / 10; // the bake stores decimetres
export const HALF = D.half; // [x, z]: the drivable city
export const ATTRIBUTION = D.attribution;

// ---------------------------------------------------------------- the map, read once
export const buildings = D.buildings.map((b) => {
  const pts = []; for (let i = 4; i < b.length; i += 2) pts.push([dm(b[i]), dm(b[i + 1])]);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, cx = 0, cz = 0;
  for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); cx += x / pts.length; cz += z / pts.length; }
  return { h: b[0], min: b[1], colour: b[2] || null, core: !!b[3], pts, box: [x0, z0, x1, z1], c: [cx, cz] };
});
export const nodes = []; for (let i = 0; i < D.nodes.length; i += 2) nodes.push([dm(D.nodes[i]), dm(D.nodes[i + 1])]);
export const edges = [];
for (let i = 0; i < D.edges.length; i += 5) {
  const [a, b, c, oneway, name] = D.edges.slice(i, i + 5), A = nodes[a], B = nodes[b];
  edges.push({ a, b, cls: D.classes[c], w: D.widths[c], oneway, name: name >= 0 ? D.names[name] : null, len: Math.hypot(B[0] - A[0], B[1] - A[1]) });
}
// who connects to whom; one-way streets only the right way (traffic falls back to any way at a dead end)
export const links = nodes.map(() => []);
edges.forEach((e, i) => {
  if (e.oneway !== -1) links[e.a].push({ to: e.b, e: i });
  if (e.oneway !== 1) links[e.b].push({ to: e.a, e: i });
});
export const anyLinks = nodes.map(() => []);
edges.forEach((e, i) => { anyLinks[e.a].push({ to: e.b, e: i }); anyLinks[e.b].push({ to: e.a, e: i }); });
const places = D.places.map(([n, x, z]) => ({ name: n, x: dm(x), z: dm(z) }));
export const BOARDS = D.boards.map(([x, z, ang, w, h, y]) => ({ x: dm(x), z: dm(z), ang, w, h, y })); // Times Square screens
export const lotGeo = Object.fromEntries(Object.entries(D.lots).map(([id, l]) => [id, { building: buildings[l.b], door: l.door, face: l.face }]));

// ---------------------------------------------------------------- lookups
// A coarse grid of the drivable city's buildings, so collision only looks at the few nearby.
const CELL = 24, grid = new Map();
buildings.forEach((b, i) => {
  if (!b.core) return;
  for (let gx = Math.floor(b.box[0] / CELL); gx <= Math.floor(b.box[2] / CELL); gx++) for (let gz = Math.floor(b.box[1] / CELL); gz <= Math.floor(b.box[3] / CELL); gz++) {
    const k = gx * 100003 + gz; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i);
  }
});
function inside(pts, x, z) { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; }
function edgeDist(pts, x, z) { let d = Infinity; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) d = Math.min(d, segDist(x, z, pts[j], pts[i])); return d; }
export function segDist(x, z, a, b) { const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L)); return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz); }
// Is this spot inside a building (or within r of a wall), or off the edge of the city?
export function blocked(x, z, r = 1.1) {
  if (Math.abs(x) > HALF[0] + 25 || Math.abs(z) > HALF[1] + 25) return true;
  const list = grid.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
  if (!list) return false;
  for (const i of list) { const b = buildings[i]; if (x < b.box[0] - r || x > b.box[2] + r || z < b.box[1] - r || z > b.box[3] + r) continue; if (inside(b.pts, x, z) || edgeDist(b.pts, x, z) < r) return true; }
  return false;
}
// The road you're on (nearest edge), and the neighbourhood you're in (nearest named place).
export function nearestEdge(x, z) {
  let best = null, bd = Infinity;
  for (const e of edges) { const d = segDist(x, z, nodes[e.a], nodes[e.b]); if (d < bd) { bd = d; best = e; } }
  return { e: best, d: bd };
}
export function streetName(x, z) { const { e, d } = nearestEdge(x, z); return e && d < e.w / 2 + 10 ? e.name : null; }
export function areaName(x, z) { let best = null, bd = Infinity; for (const p of places) { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = p; } } return best ? best.name : "Midtown"; }
export function nodeNear(x, z) { let b = 0, bd = Infinity; nodes.forEach((n, i) => { const d = Math.hypot(n[0] - x, n[1] - z); if (d < bd && anyLinks[i].length) { bd = d; b = i; } }); return b; }
// A random spot on a drivable road (not a service lane), optionally at least `minFrom` metres from a point and
// within `maxFrom` of `near`.
export function roadPoint(opts = {}) {
  const drive = edges.filter((e) => e.cls !== "service");
  for (let k = 0; k < 80; k++) {
    const e = drive[Math.floor(Math.random() * drive.length)], t = 0.15 + Math.random() * 0.7, A = nodes[e.a], B = nodes[e.b];
    const p = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t];
    if (opts.away && Math.hypot(p[0] - opts.away[0], p[1] - opts.away[1]) < (opts.minFrom || 90)) continue;
    if (opts.near && Math.hypot(p[0] - opts.near[0], p[1] - opts.near[1]) > (opts.maxFrom || 300)) continue;
    return p;
  }
  return [nodes[0][0], nodes[0][1]];
}
// Real-world coordinates for any spot in the game, and back.
export function toLngLat(x, z) {
  const r = -D.rot, lx = x * Math.cos(r) - z * Math.sin(r), lz = x * Math.sin(r) + z * Math.cos(r);
  return [D.origin[0] + lx / D.kx, D.origin[1] - lz / D.kz];
}
export function fromLngLat(lng, lat) {
  const lx = (lng - D.origin[0]) * D.kx, lz = -(lat - D.origin[1]) * D.kz, r = D.rot;
  return [lx * Math.cos(r) - lz * Math.sin(r), lx * Math.sin(r) + lz * Math.cos(r)];
}
// The compass: a heading in the game (0 = +z) as a real bearing (degrees from north, clockwise).
export function bearing(heading) { const dx = Math.sin(heading), dz = Math.cos(heading), [a, b] = [toLngLat(0, 0), toLngLat(dx * 100, dz * 100)]; return ((Math.atan2((b[0] - a[0]) * D.kx, (b[1] - a[1]) * D.kz) * 180) / Math.PI + 360) % 360; }
export const ROT = D.rot;

// ---------------------------------------------------------------- textures, drawn once
const rand = (() => { let s = 1234567; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
function canvas(w, h, draw) { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); return c; }
function tex(c, repeat = true) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; }
function noise(g, w, h, a, base) { const img = g.getImageData(0, 0, w, h); for (let i = 0; i < img.data.length; i += 4) { const n = (rand() - 0.5) * a; img.data[i] = Math.max(0, Math.min(255, (base ? base[0] : img.data[i]) + n)); img.data[i + 1] = Math.max(0, Math.min(255, (base ? base[1] : img.data[i + 1]) + n)); img.data[i + 2] = Math.max(0, Math.min(255, (base ? base[2] : img.data[i + 2]) + n)); } g.putImageData(img, 0, 0); }
// One facade tile is 8 window columns (3 m) by 8 floors (3.5 m): 24 m by 28 m.
const COLS = 8, FLOORS = 8, COL_M = 3, FLOOR_M = 3.5, TILE_W = COLS * COL_M, TILE_H = FLOORS * FLOOR_M;
function facade(style) {
  const W = 512, H = 512, cw = W / COLS, fh = H / FLOORS;
  const map = canvas(W, H, (g) => {
    if (style === "glass") {
      const grd = g.createLinearGradient(0, 0, W, H); grd.addColorStop(0, "#5f7d93"); grd.addColorStop(0.5, "#2e4558"); grd.addColorStop(1, "#6b8aa0");
      g.fillStyle = grd; g.fillRect(0, 0, W, H);
      g.fillStyle = "rgba(20,28,36,.9)"; for (let f = 0; f < FLOORS; f++) g.fillRect(0, f * fh + fh - 7, W, 7);
      g.fillStyle = "rgba(200,215,225,.25)"; for (let c = 0; c <= COLS; c++) g.fillRect(c * cw - 1, 0, 2, H);
      noise(g, W, H, 10);
    } else {
      const base = style === "brick" ? [168, 150, 140] : style === "dark" ? [70, 72, 76] : [214, 206, 192];
      g.fillStyle = `rgb(${base})`; g.fillRect(0, 0, W, H); noise(g, W, H, 26, base);
      if (style === "brick") { g.strokeStyle = "rgba(255,255,255,.08)"; for (let y = 0; y < H; y += 6) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); } }
      for (let f = 0; f < FLOORS; f++) for (let c = 0; c < COLS; c++) {
        const x = c * cw + cw * 0.18, y = f * fh + fh * 0.18, w = cw * 0.64, h = fh * 0.6;
        g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(x - 3, y - 3, w + 6, h + 8); // the frame's shadow
        const grd = g.createLinearGradient(x, y, x + w, y + h); grd.addColorStop(0, "#3c4c5a"); grd.addColorStop(1, "#141b22");
        g.fillStyle = grd; g.fillRect(x, y, w, h);
        g.fillStyle = style === "dark" ? "#555" : "rgba(240,235,225,.8)"; g.fillRect(x - 2, y + h, w + 4, 3); // the sill
        g.fillStyle = "rgba(0,0,0,.4)"; g.fillRect(x + w / 2 - 1, y, 2, h);
      }
      if (style !== "dark") { g.fillStyle = "rgba(0,0,0,.08)"; for (let f = 0; f < FLOORS; f++) g.fillRect(0, f * fh, W, 3); }
    }
  });
  // which windows have the lights on at night
  const glow = canvas(W, H, (g) => {
    g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
    for (let f = 0; f < FLOORS; f++) for (let c = 0; c < COLS; c++) {
      if (rand() > (style === "glass" ? 0.5 : 0.38)) continue;
      const warm = rand() < 0.8; g.fillStyle = warm ? `hsl(${38 + rand() * 12},${70 + rand() * 20}%,${55 + rand() * 20}%)` : `hsl(200,40%,${60 + rand() * 20}%)`;
      if (style === "glass") g.fillRect(c * cw + 2, f * fh + 2, cw - 4, fh - 10); else g.fillRect(c * cw + cw * 0.18, f * fh + fh * 0.18, cw * 0.64, fh * 0.6);
    }
  });
  return { map: tex(map), glow: tex(glow) };
}
function shopfront() { // the ground floor: shop windows, doors and a sign band, 6 m wide by 4.5 m
  const W = 256, H = 192;
  const map = canvas(W, H, (g) => {
    g.fillStyle = "#2a2622"; g.fillRect(0, 0, W, H);
    const awn = ["#7a1f1f", "#1f3d7a", "#1f5a3a", "#5a4a1f", "#333"][Math.floor(rand() * 5)];
    g.fillStyle = "#111"; g.fillRect(0, 0, W, 40); // sign band
    g.fillStyle = awn; g.fillRect(6, 40, W - 12, 18);
    const grd = g.createLinearGradient(0, 60, 0, H); grd.addColorStop(0, "#41505c"); grd.addColorStop(1, "#1b2228");
    g.fillStyle = grd; g.fillRect(12, 62, W - 24, H - 74);
    g.fillStyle = "#0c0c0c"; g.fillRect(W / 2 - 22, 62, 44, H - 66); // the door
    g.fillStyle = "#777"; g.fillRect(0, H - 10, W, 10);
  });
  const glow = canvas(W, H, (g) => {
    g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
    g.fillStyle = "#ffe3a8"; g.fillRect(12, 62, W / 2 - 34, H - 74); g.fillRect(W / 2 + 22, 62, W / 2 - 34, H - 74);
    g.fillStyle = `hsl(${rand() * 360},80%,60%)`; g.fillRect(30, 12, W - 60, 16); // a lit sign
  });
  return { map: tex(map), glow: tex(glow) };
}
function ground(kind) {
  return tex(canvas(512, 512, (g, W, H) => {
    if (kind === "asphalt") { g.fillStyle = "#2b2c2e"; g.fillRect(0, 0, W, H); noise(g, W, H, 22); g.fillStyle = "rgba(0,0,0,.25)"; for (let i = 0; i < 18; i++) { g.beginPath(); g.ellipse(rand() * W, rand() * H, 10 + rand() * 40, 4 + rand() * 12, rand() * 3, 0, 7); g.fill(); } }
    else if (kind === "sidewalk") { g.fillStyle = "#8d8a84"; g.fillRect(0, 0, W, H); noise(g, W, H, 18); g.strokeStyle = "rgba(0,0,0,.25)"; g.lineWidth = 2; for (let i = 0; i <= W; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, H); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(W, i); g.stroke(); } }
    else if (kind === "grass") { g.fillStyle = "#3d5a2a"; g.fillRect(0, 0, W, H); noise(g, W, H, 34); }
    else if (kind === "plaza") { g.fillStyle = "#7d6a62"; g.fillRect(0, 0, W, H); noise(g, W, H, 16); g.strokeStyle = "rgba(255,255,255,.08)"; for (let i = 0; i <= W; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, H); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(W, i); g.stroke(); } }
    else if (kind === "roof") { g.fillStyle = "#59595a"; g.fillRect(0, 0, W, H); noise(g, W, H, 30); }
  }));
}

// ---------------------------------------------------------------- geometry helpers (one merged mesh per material)
class Batch {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.i = []; }
  quad(a, b, c, d, nrm, uvs, col) { const o = this.p.length / 3; for (const v of [a, b, c, d]) this.p.push(...v); for (let k = 0; k < 4; k++) { this.n.push(...nrm); this.c.push(...col); } this.uv.push(...uvs); this.i.push(o, o + 1, o + 2, o, o + 2, o + 3); }
  tri(a, b, c, nrm, uvs, col) { const o = this.p.length / 3; for (const v of [a, b, c]) this.p.push(...v); for (let k = 0; k < 3; k++) { this.n.push(...nrm); this.c.push(...col); } this.uv.push(...uvs); this.i.push(o, o + 1, o + 2); }
  mesh(mat, shadow = true) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2)); g.setAttribute("color", new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.i, 1) : new THREE.Uint16BufferAttribute(this.i, 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat); m.castShadow = shadow; m.receiveShadow = true; m.matrixAutoUpdate = false; return m;
  }
}
// A flat polygon at height y, as triangles, with world-space UVs (metres / scale).
function flat(batch, pts, y, scale, col, up = true) {
  const contour = pts.map(([x, z]) => new THREE.Vector2(x, z));
  if (contour.length < 3) return;
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  for (const [a, b, c] of tris) {
    const A = pts[a], B = pts[b], C = pts[c];
    const ny = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]); // >0: the triangle faces down in three.js (z south)
    const [p, q, r] = (ny > 0) === up ? [A, C, B] : [A, B, C];
    batch.tri([p[0], y, p[1]], [q[0], y, q[1]], [r[0], y, r[1]], [0, up ? 1 : -1, 0], [p[0] / scale, p[1] / scale, q[0] / scale, q[1] / scale, r[0] / scale, r[1] / scale], col);
  }
}
function styleOf(b) {
  if (!b.core) return "far";
  if (b.h > 90) return rand() < 0.75 ? "glass" : "dark";
  if (b.h > 45) return rand() < 0.45 ? "glass" : rand() < 0.5 ? "stone" : "dark";
  const c = new THREE.Color(b.colour || "#c8b8a8"), hsl = {}; c.getHSL(hsl);
  return hsl.s > 0.2 && hsl.h < 0.08 && hsl.l < 0.5 ? "brick" : rand() < 0.3 ? "brick" : "stone";
}
function tintOf(b, style) {
  const c = new THREE.Color(b.colour || "#bfb5a8"); c.lerp(new THREE.Color(0xffffff), style === "glass" ? 0.85 : 0.45);
  const k = 0.85 + rand() * 0.25; return [c.r * k, c.g * k, c.b * k];
}

// Ground-level layers sit a few centimetres apart; polygon offset makes them draw in order even on GPUs with a coarse
// depth buffer (some phones), where those few centimetres alone would flicker.
function layer(mat, n) { mat.polygonOffset = true; mat.polygonOffsetFactor = -n; mat.polygonOffsetUnits = -n * 2; return mat; }

// ---------------------------------------------------------------- building the city
export function buildCity(scene, opts = {}) {
  const out = { night: [], boards: [], lampMat: null, signalMats: null, tick: () => {} };
  const fac = { glass: facade("glass"), stone: facade("stone"), brick: facade("brick"), dark: facade("dark") };
  const shops = [shopfront(), shopfront(), shopfront()];
  const mats = {}, batches = {}, CH = 220;
  const batch = (key, b) => { const k = b ? `${key}@${Math.floor(b.c[0] / CH)},${Math.floor(b.c[1] / CH)}` : key; return (batches[k] ||= Object.assign(new Batch(), { key })); };
  for (const [k, f] of Object.entries(fac)) {
    mats[k] = new THREE.MeshStandardMaterial({ map: f.map, emissive: 0xffffff, emissiveMap: f.glow, emissiveIntensity: 0, vertexColors: true, roughness: k === "glass" ? 0.12 : 0.85, metalness: k === "glass" ? 0.55 : 0.05, envMapIntensity: k === "glass" ? 1.4 : 0.4 });
    out.night.push(mats[k]);
  }
  shops.forEach((s, i) => { mats["shop" + i] = new THREE.MeshStandardMaterial({ map: s.map, emissive: 0xffffff, emissiveMap: s.glow, emissiveIntensity: 0, vertexColors: true, roughness: 0.5, metalness: 0.2 }); mats["shop" + i].userData.shop = true; out.night.push(mats["shop" + i]); });
  mats.far = new THREE.MeshStandardMaterial({ map: fac.dark.map, emissive: 0xffffff, emissiveMap: fac.glass.glow, emissiveIntensity: 0, vertexColors: true, roughness: 0.6, metalness: 0.3 }); out.night.push(mats.far);
  mats.roof = new THREE.MeshStandardMaterial({ map: ground("roof"), vertexColors: true, roughness: 0.95 });
  // walls and roofs
  const SHOP_H = 4.5;
  buildings.forEach((b, bi) => {
    if (opts.skip && opts.skip.has(bi)) return;
    const style = styleOf(b), tint = tintOf(b, style), shop = "shop" + (bi % 3), pts = b.pts, n = pts.length;
    const uOff = Math.floor(rand() * COLS) * COL_M, vOff = Math.floor(rand() * FLOORS) * FLOOR_M; // so neighbours don't light the same windows
    let along = 0;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n], dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz); if (L < 0.05) continue;
      let nx = dz / L, nz = -dx / L;
      const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2;
      if (inside(pts, mx + nx * 0.3, mz + nz * 0.3)) { nx = -nx; nz = -nz; } // outward
      const front = -dz * nx + dx * nz > 0; // the winding that faces out
      const wall = (y0, y1, key, uS, vS, v0) => {
        const a = [p[0], y0, p[1]], bb = [q[0], y0, q[1]], c = [q[0], y1, q[1]], d = [p[0], y1, p[1]];
        const u0 = (along + uOff) / uS, u1 = (along + L + uOff) / uS, va = (y0 - v0 + vOff) / vS, vb = (y1 - v0 + vOff) / vS;
        const bt = batch(key, b);
        if (front) bt.quad(a, bb, c, d, [nx, 0, nz], [u0, va, u1, va, u1, vb, u0, vb], tint);
        else bt.quad(bb, a, d, c, [nx, 0, nz], [u1, va, u0, va, u0, vb, u1, vb], tint);
      };
      if (style !== "far" && b.min < 0.5 && b.h > 7 && L > 3) { wall(0, SHOP_H, shop, 6, SHOP_H, 0); wall(SHOP_H, b.h, style, TILE_W, TILE_H, SHOP_H); }
      else wall(b.min, b.h, style, TILE_W, TILE_H, 0);
      along += L;
    }
    flat(batch("roof", b), pts, b.h, 6, tint.map((v) => v * 0.8));
  });
  for (const bt of Object.values(batches)) if (bt.p.length) scene.add(bt.mesh(mats[bt.key], bt.key !== "far"));

  // the ground: sidewalk everywhere, then parks, plazas and the roads on top
  const side = ground("sidewalk"); side.repeat.set(4800 / 12, 4800 / 12); // slabs of 1.5 m
  const g0 = new THREE.Mesh(new THREE.PlaneGeometry(4800, 4800), new THREE.MeshStandardMaterial({ map: side, roughness: 0.92 }));
  g0.rotation.x = -Math.PI / 2; g0.receiveShadow = true; scene.add(g0);
  const area = (list, y, kind, scale, col) => { const bt = new Batch(); for (const a of list) { const pts = []; for (let i = 0; i < a.length; i += 2) pts.push([dm(a[i]), dm(a[i + 1])]); flat(bt, pts, y, scale, col); } if (bt.p.length) { const m = bt.mesh(layer(new THREE.MeshStandardMaterial({ map: ground(kind), vertexColors: true, roughness: 0.95 }), 1), false); scene.add(m); } };
  area(D.green, 0.012, "grass", 8, [1, 1, 1]); area(D.plazas, 0.014, "plaza", 6, [1, 1, 1]);
  if (D.water.length) area(D.water, 0.01, "plaza", 20, [0.15, 0.25, 0.35]);
  // roads: a strip per segment, a patch at each junction, world-space texture so the overlaps don't show
  const road = new Batch(), mark = new Batch(), yellow = new Batch();
  const W1 = [1, 1, 1];
  const strip = (bt, A, B, w, y, uvScale) => {
    const dx = B[0] - A[0], dz = B[1] - A[1], L = Math.hypot(dx, dz) || 1, px = (-dz / L) * (w / 2), pz = (dx / L) * (w / 2);
    const a = [A[0] + px, y, A[1] + pz], b = [B[0] + px, y, B[1] + pz], c = [B[0] - px, y, B[1] - pz], d = [A[0] - px, y, A[1] - pz];
    const uv = (v) => [v[0] / uvScale, v[2] / uvScale];
    const up = (b[0] - a[0]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[0] - a[0]) < 0;
    if (up) bt.quad(a, b, c, d, [0, 1, 0], [...uv(a), ...uv(b), ...uv(c), ...uv(d)], W1); else bt.quad(a, d, c, b, [0, 1, 0], [...uv(a), ...uv(d), ...uv(c), ...uv(b)], W1);
  };
  const junction = nodes.map((_, i) => Math.max(0, ...anyLinks[i].map((l) => edges[l.e].w)));
  for (const e of edges) strip(road, nodes[e.a], nodes[e.b], e.w, 0.02, 8);
  nodes.forEach((n, i) => { const r = junction[i] / 2; if (!r) return; const pts = []; for (let k = 0; k < 16; k++) pts.push([n[0] + Math.cos((k / 16) * Math.PI * 2) * r, n[1] + Math.sin((k / 16) * Math.PI * 2) * r]); flat(road, pts, 0.021, 8, W1); });
  for (let i = 0; i < D.vroads.length; i += 5) strip(road, [dm(D.vroads[i]), dm(D.vroads[i + 1])], [dm(D.vroads[i + 2]), dm(D.vroads[i + 3])], D.widths[D.classes.indexOf(["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service"][D.vroads[i + 4]])] || 9, 0.02, 8);
  const asphalt = ground("asphalt"); scene.add(road.mesh(layer(new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.9, metalness: 0.05 }), 2), false));
  // lane lines (white dashes on one-way avenues, a double yellow down two-way roads), stop lines and crosswalks
  for (const e of edges) {
    if (e.cls === "service") continue;
    const A = nodes[e.a], B = nodes[e.b], dx = B[0] - A[0], dz = B[1] - A[1], L = e.len; if (L < 20) continue;
    const ux = dx / L, uz = dz / L, px = -uz, pz = ux, ca = junction[e.a] / 2 + 4, cb = junction[e.b] / 2 + 4;
    if (L - ca - cb < 6) continue;
    const lanes = Math.max(1, Math.round(e.w / 3.4));
    if (e.oneway) {
      for (let k = 1; k < lanes; k++) { const off = -e.w / 2 + (k * e.w) / lanes; for (let s = ca; s < L - cb - 3; s += 9) strip(mark, [A[0] + ux * s + px * off, A[1] + uz * s + pz * off], [A[0] + ux * (s + 3) + px * off, A[1] + uz * (s + 3) + pz * off], 0.14, 0.03, 4); }
    } else {
      for (const off of [-0.12, 0.12]) strip(yellow, [A[0] + ux * ca + px * off, A[1] + uz * ca + pz * off], [A[0] + ux * (L - cb) + px * off, A[1] + uz * (L - cb) + pz * off], 0.1, 0.03, 4);
    }
    // crosswalk stripes at both ends where it meets a junction
    for (const [end, cut, sgn] of [[A, ca - 4, 1], [B, cb - 4, -1]]) {
      if ((sgn === 1 ? anyLinks[e.a] : anyLinks[e.b]).length < 3) continue;
      const cx = end[0] + ux * sgn * (cut + 1.6), cz = end[1] + uz * sgn * (cut + 1.6);
      for (let o = -e.w / 2 + 0.6; o < e.w / 2 - 0.4; o += 1.2) strip(mark, [cx + px * o - ux * 1.4, cz + pz * o - uz * 1.4], [cx + px * o + ux * 1.4, cz + pz * o + uz * 1.4], 0.55, 0.031, 4);
    }
  }
  scene.add(mark.mesh(layer(new THREE.MeshStandardMaterial({ color: 0xb9b9b2, roughness: 0.85 }), 3), false));
  if (yellow.p.length) scene.add(yellow.mesh(layer(new THREE.MeshStandardMaterial({ color: 0xd9b23a, roughness: 0.7 }), 3), false));

  // street furniture: lights along the kerbs, traffic lights at the bigger junctions, trees on the side streets
  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  const lamps = [], trees = [];
  for (const e of edges) {
    if (e.cls === "service") continue;
    const A = nodes[e.a], B = nodes[e.b], ux = (B[0] - A[0]) / e.len, uz = (B[1] - A[1]) / e.len, px = -uz, pz = ux;
    for (let s = 14; s < e.len - 14; s += 34) for (const side of [-1, 1]) {
      const off = e.w / 2 + 1.1, x = A[0] + ux * s + px * off * side, z = A[1] + uz * s + pz * off * side;
      if (!blocked(x, z, 0.6)) lamps.push([x, z, Math.atan2(-px * side, -pz * side)]);
    }
    if (e.cls === "minor" || e.cls === "tertiary") for (let s = 22; s < e.len - 22; s += 17) for (const side of [-1, 1]) {
      if (rand() < 0.35) continue;
      const off = e.w / 2 + 2.4, x = A[0] + ux * (s + 8) + px * off * side, z = A[1] + uz * (s + 8) + pz * off * side;
      if (!blocked(x, z, 1.6)) trees.push([x, z, 0.8 + rand() * 0.5]);
    }
  }
  // park trees
  for (const a of D.green) { const pts = []; for (let i = 0; i < a.length; i += 2) pts.push([dm(a[i]), dm(a[i + 1])]); let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } const n = Math.min(60, Math.floor(((x1 - x0) * (z1 - z0)) / 180)); for (let k = 0; k < n; k++) { const x = x0 + rand() * (x1 - x0), z = z0 + rand() * (z1 - z0); if (inside(pts, x, z) && Math.abs(x) < 1100 && Math.abs(z) < 1100) trees.push([x, z, 1 + rand() * 0.7]); } }
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2c3136, metalness: 0.7, roughness: 0.4 });
  out.lampMat = new THREE.MeshBasicMaterial({ color: 0x777060 });
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.13, 8, 6); poleGeo.translate(0, 4, 0);
  const armGeo = new THREE.BoxGeometry(0.1, 0.1, 1.8); armGeo.translate(0, 8, 0.8);
  const headGeo = new THREE.BoxGeometry(0.45, 0.16, 0.8); headGeo.translate(0, 7.9, 1.6);
  const P = new THREE.InstancedMesh(poleGeo, poleMat, lamps.length), Ar = new THREE.InstancedMesh(armGeo, poleMat, lamps.length), Hd = new THREE.InstancedMesh(headGeo, out.lampMat, lamps.length);
  lamps.forEach(([x, z, r], i) => { q4.setFromAxisAngle(up, r); m4.compose(v3.set(x, 0, z), q4, s3); P.setMatrixAt(i, m4); Ar.setMatrixAt(i, m4); Hd.setMatrixAt(i, m4); });
  P.castShadow = true; scene.add(P, Ar, Hd);
  const trunk = new THREE.CylinderGeometry(0.14, 0.2, 3, 6); trunk.translate(0, 1.5, 0);
  const crown = new THREE.IcosahedronGeometry(2.1, 1); crown.translate(0, 4.4, 0);
  const T = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 }), trees.length);
  const Cr = new THREE.InstancedMesh(crown, new THREE.MeshStandardMaterial({ color: 0x3f6b33, roughness: 0.9, flatShading: true }), trees.length);
  const col = new THREE.Color();
  trees.forEach(([x, z, s], i) => { q4.setFromAxisAngle(up, rand() * 6); m4.compose(v3.set(x, 0, z), q4, new THREE.Vector3(s, s, s)); T.setMatrixAt(i, m4); Cr.setMatrixAt(i, m4); Cr.setColorAt(i, col.setHSL(0.25 + rand() * 0.06, 0.45, 0.25 + rand() * 0.1)); });
  T.castShadow = Cr.castShadow = true; scene.add(T, Cr);
  // traffic lights: avenues (running along z) and streets take turns
  const signals = [];
  nodes.forEach((n, i) => {
    const ls = anyLinks[i]; if (ls.length < 3 || junction[i] < 9) return;
    const r = junction[i] / 2 + 1.4;
    for (const l of ls) { const e = edges[l.e], o = nodes[l.to], dx = o[0] - n[0], dz = o[1] - n[1], L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L; const x = n[0] + ux * r + -uz * (e.w / 2 + 0.8), z = n[1] + uz * r + ux * (e.w / 2 + 0.8); if (!blocked(x, z, 0.4)) signals.push([x, z, Math.atan2(-ux, -uz), Math.abs(uz) > Math.abs(ux) ? 0 : 1]); }
  });
  const sPole = new THREE.CylinderGeometry(0.1, 0.12, 4.2, 6); sPole.translate(0, 2.1, 0);
  const sBox = new THREE.BoxGeometry(0.45, 1.3, 0.4); sBox.translate(0, 4.5, 0);
  const sLamp = new THREE.SphereGeometry(0.15, 8, 6); sLamp.translate(0, 4.5, 0.22);
  const SP = new THREE.InstancedMesh(sPole, poleMat, signals.length), SB = new THREE.InstancedMesh(sBox, new THREE.MeshStandardMaterial({ color: 0x1d2a1d, roughness: 0.6 }), signals.length);
  out.signalMats = [new THREE.MeshBasicMaterial({ color: 0x00ff66 }), new THREE.MeshBasicMaterial({ color: 0xff2222 })];
  const groups = [[], []];
  signals.forEach((s) => groups[s[3]].push(s));
  const heads = groups.map((gs, gi) => { const im = new THREE.InstancedMesh(sLamp, out.signalMats[gi], gs.length); gs.forEach(([x, z, r], i) => { q4.setFromAxisAngle(up, r); m4.compose(v3.set(x, 0, z), q4, s3); im.setMatrixAt(i, m4); }); scene.add(im); return im; });
  signals.forEach(([x, z, r], i) => { q4.setFromAxisAngle(up, r); m4.compose(v3.set(x, 0, z), q4, s3); SP.setMatrixAt(i, m4); SB.setMatrixAt(i, m4); });
  scene.add(SP, SB);
  // the cycle: 14 s green for the avenues, 3 s all red, 10 s green for the streets, 3 s all red
  out.signal = (t) => { const c = t % 30; return c < 14 ? 0 : c < 17 ? -1 : c < 27 ? 1 : -1; };
  out.tick = (t) => { const ph = out.signal(t); out.signalMats[0].color.setHex(ph === 0 ? 0x00ff66 : 0xff2222); out.signalMats[1].color.setHex(ph === 1 ? 0x00ff66 : 0xff2222); for (const b of out.boards) b.tick(t); };
  // rooftop water towers and AC units, the New York skyline's furniture
  const towers = [], acs = [];
  buildings.forEach((b) => { if (!b.core || b.h < 14 || b.h > 70) return; const a = (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]); if (a < 150) return; const r = rand(); if (r < 0.22) towers.push(b); else if (r < 0.6) acs.push(b); });
  const wt = new THREE.CylinderGeometry(1.6, 1.6, 3.2, 12); wt.translate(0, 3.4, 0);
  const wtr = new THREE.ConeGeometry(1.8, 1.2, 12); wtr.translate(0, 5.6, 0);
  const legs = new THREE.BoxGeometry(2.6, 1.8, 2.6); legs.translate(0, 0.9, 0);
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4d36, roughness: 0.95 }), steel = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.8, metalness: 0.5 });
  const W_ = [new THREE.InstancedMesh(wt, wood, towers.length), new THREE.InstancedMesh(wtr, steel, towers.length), new THREE.InstancedMesh(legs, new THREE.MeshStandardMaterial({ color: 0x2a2a2a, wireframe: true }), towers.length)];
  towers.forEach((b, i) => { const x = b.c[0] + (rand() - 0.5) * 3, z = b.c[1] + (rand() - 0.5) * 3; m4.makeTranslation(x, b.h, z); W_.forEach((im) => im.setMatrixAt(i, m4)); });
  W_.forEach((im) => { im.castShadow = true; scene.add(im); });
  const acg = new THREE.BoxGeometry(2.4, 1.3, 1.6); acg.translate(0, 0.65, 0);
  const AC = new THREE.InstancedMesh(acg, new THREE.MeshStandardMaterial({ color: 0x9a9a98, roughness: 0.7, metalness: 0.3 }), acs.length * 2);
  acs.forEach((b, i) => { for (let k = 0; k < 2; k++) { m4.compose(v3.set(b.c[0] + (rand() - 0.5) * 5, b.h, b.c[1] + (rand() - 0.5) * 5), q4.setFromAxisAngle(up, rand() * 3), s3); AC.setMatrixAt(i * 2 + k, m4); } });
  AC.castShadow = true; scene.add(AC);
  // road closed: barricades where the drivable city ends
  const bar = new THREE.BoxGeometry(1, 1, 1);
  const stripes = tex(canvas(128, 32, (g) => { for (let i = -2; i < 10; i++) { g.fillStyle = i % 2 ? "#f2f2f2" : "#e2571e"; g.beginPath(); g.moveTo(i * 16, 32); g.lineTo(i * 16 + 16, 32); g.lineTo(i * 16 + 32, 0); g.lineTo(i * 16 + 16, 0); g.fill(); } }));
  const barMat = new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.6 });
  nodes.forEach((n, i) => {
    if (anyLinks[i].length !== 1 || (Math.abs(n[0]) < HALF[0] - 5 && Math.abs(n[1]) < HALF[1] - 5)) return;
    const l = anyLinks[i][0], o = nodes[l.to], e = edges[l.e], h = Math.atan2(o[0] - n[0], o[1] - n[1]);
    const b = new THREE.Mesh(bar, barMat); b.scale.set(e.w, 1.1, 0.35); b.position.set(n[0], 0.9, n[1]); b.rotation.y = h; b.castShadow = true; scene.add(b);
  });
  out.lamps = lamps; out.signals = signals;
  return out;
}

// ---------------------------------------------------------------- Times Square: RB's billboards and the HQ
// Animated screens on the buildings round the square, all RB's own: RB Radio, RB Studio, RB TV, RB Badge, RB World.
export function timesSquare(scene, out) {
  const ADS = [
    ["RELENTLESS", "BILLIONAIRE", "#C9A84C", "#000"], ["RB RADIO", "LIVE 24/7", "#ff3366", "#14000a"], ["RB STUDIO", "RECORD · MIX · MASTER", "#00e0ff", "#001018"],
    ["RB WORLD", "BUILD YOUR EMPIRE", "#F5E6A3", "#1a1200"], ["RB TV", "WATCH NOW", "#ffffff", "#2a0050"], ["RB BADGE", "EARN · LEVEL UP", "#00E676", "#001a0c"],
    ["RB EVENTS", "SEE YOU THERE", "#ffb000", "#1a0800"], ["CREATE", "OWN · ELEVATE", "#C9A84C", "#0a0a0a"],
  ];
  const textures = ADS.map(([a, b, fg, bg], k) => {
    const c = canvas(512, 256, (g, W, H) => {
      const grd = g.createLinearGradient(0, 0, W, H); grd.addColorStop(0, bg); grd.addColorStop(1, "#000"); g.fillStyle = grd; g.fillRect(0, 0, W, H);
      g.strokeStyle = fg; g.lineWidth = 6; g.strokeRect(8, 8, W - 16, H - 16);
      g.fillStyle = fg; g.textAlign = "center"; g.font = "900 78px Inter, Arial, sans-serif"; g.fillText(a, W / 2, 120);
      g.fillStyle = "#fff"; g.font = "700 34px Inter, Arial, sans-serif"; g.fillText(b, W / 2, 190);
    });
    return tex(c, false);
  });
  D.boards.forEach(([x, z, ang, w, h, y], i) => {
    const mat = new THREE.MeshBasicMaterial({ map: textures[i % textures.length], toneMapped: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(dm(x), y + h / 2, dm(z)); m.rotation.y = ang; scene.add(m);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, h + 0.6, 0.3), new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.6 }));
    frame.position.copy(m.position); frame.rotation.y = ang; frame.translateZ(-0.2); scene.add(frame);
    let k = i % textures.length;
    out.boards.push({ tick: (t) => { const n = (i + Math.floor(t / 7)) % textures.length; if (n !== k) { k = n; mat.map = textures[n]; } } });
  });
  // RB HQ: One Times Square, with a gold crown and the big RB screen
  if (D.hq >= 0) {
    const b = buildings[D.hq];
    const crown = new THREE.Mesh(new THREE.BoxGeometry(b.box[2] - b.box[0] + 1, 2, b.box[3] - b.box[1] + 1), new THREE.MeshBasicMaterial({ color: 0xC9A84C, toneMapped: false }));
    crown.position.set((b.box[0] + b.box[2]) / 2, b.h + 1, (b.box[1] + b.box[3]) / 2); scene.add(crown);
    out.hq = { x: crown.position.x, z: crown.position.z, h: b.h };
  }
}
