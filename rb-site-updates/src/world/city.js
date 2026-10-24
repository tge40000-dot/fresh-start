// RB World's city on real streets (now downtown Vallejo, California), from OpenStreetMap (city_data.js, baked by
// rb-tools/bake_city.mjs; where the map has no building outlines the bake fills the blocks with houses, shops and
// warehouses that fit the area). This module reads the baked map and offers what the game needs (collision with real
// buildings, the road network for traffic and cops, street and neighbourhood names, real latitude/longitude for any
// point), and builds the 3D city: buildings with window facades and storefronts, asphalt roads with lane markings
// and crosswalks, sidewalks and lawns, the bay, parks, street lights, traffic lights, street trees, houses with pitched
// roofs, rooftop water towers, and RB's screens round RB Plaza. Map data © OpenStreetMap contributors (ODbL).
import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import D from "./city_data.js";

const dm = (v) => v / 10; // the bake stores decimetres
export const HALF = D.half; // [x, z]: the drivable city
export const ATTRIBUTION = D.attribution;
export const NAME = D.name || "RB City", SHORT = D.short || "Downtown", PLAZA_NAME = D.plazaName || "RB Plaza";
export const START = D.start || [0, 0, 0]; // [x, z, heading]: on the road by RB Plaza
export const PLAZA = D.plaza || [0, 0];

// ---------------------------------------------------------------- the map, read once
export const buildings = D.buildings.map((b) => {
  const pts = []; for (let i = 4; i < b.length; i += 2) pts.push([dm(b[i]), dm(b[i + 1])]);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, cx = 0, cz = 0;
  for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); cx += x / pts.length; cz += z / pts.length; }
  return { h: b[0], min: b[1], colour: b[2] || null, core: !!(b[3] & 1), kind: b[3] >> 1, pts, box: [x0, z0, x1, z1], c: [cx, cz] }; // kind: 0 real outline, 1 shop, 2 house, 3 warehouse
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
// Public landmarks from OpenStreetMap (civic places, transport, parks and sights; never businesses): where jobs drop off
// and the sightseeing run goes. at = the road point in front, where a car stops; p = the place itself.
export const LANDMARKS = (D.landmarks || []).map(([name, kind, x, z, px, pz]) => ({ name, kind, at: [dm(x), dm(z)], p: [dm(px), dm(pz)] }));
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
// the water (the bay, the strait), in the same grid: you can't drive into it
const water = D.water.map((a) => { const pts = []; for (let i = 0; i < a.length; i += 2) pts.push([dm(a[i]), dm(a[i + 1])]); let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return { pts, box: [x0, z0, x1, z1] }; });
export function inWater(x, z) { for (const w of water) if (x >= w.box[0] && x <= w.box[2] && z >= w.box[1] && z <= w.box[3] && inside(w.pts, x, z)) return true; return false; }
// Is this spot inside a building (or within r of a wall), in the water, or off the edge of the city?
export function blocked(x, z, r = 1.1) {
  if (Math.abs(x) > HALF[0] + 25 || Math.abs(z) > HALF[1] + 25) return true;
  if (water.length && inWater(x, z)) return true;
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
export function areaName(x, z) { let best = null, bd = Infinity; for (const p of places) { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = p; } } return best ? best.name : SHORT; }
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
// Every surface gets a colour map, a normal map (the relief: window recesses, frames, brick joints, slab grooves,
// clapboards, the grain of the asphalt) and a roughness/metalness map (glossy glass, matte stone, satin paint), drawn
// on canvases here, so there are no image files to download.
const rand = (() => { let s = 1234567; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
function canvas(w, h, draw) { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d", { willReadFrequently: true }), w, h); return c; }
function tex(c, repeat = true) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; }
function dataTex(c, repeat = true) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; }
function noise(g, w, h, a, base) { const img = g.getImageData(0, 0, w, h); for (let i = 0; i < img.data.length; i += 4) { const n = (rand() - 0.5) * a; img.data[i] = Math.max(0, Math.min(255, (base ? base[0] : img.data[i]) + n)); img.data[i + 1] = Math.max(0, Math.min(255, (base ? base[1] : img.data[i + 1]) + n)); img.data[i + 2] = Math.max(0, Math.min(255, (base ? base[2] : img.data[i + 2]) + n)); } g.putImageData(img, 0, 0); }
// noise in one channel only (0 R, 1 G, 2 B): for roughness variation without touching metalness
function noiseCh(g, w, h, a, ch) { const img = g.getImageData(0, 0, w, h); for (let i = ch; i < img.data.length; i += 4) img.data[i] = Math.max(0, Math.min(255, img.data[i] + (rand() - 0.5) * a)); g.putImageData(img, 0, 0); }
// a normal map from a height map (grey, light = raised), wrapping round the edges so it tiles
function normalFrom(hc, strength) {
  const w = hc.width, h = hc.height, src = hc.getContext("2d").getImageData(0, 0, w, h).data;
  return dataTex(canvas(w, h, (g) => {
    const img = g.createImageData(w, h), d = img.data, H = (x, y) => src[((((y + h) % h) * w + ((x + w) % w)) * 4)] / 255;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const nx = -(H(x + 1, y) - H(x - 1, y)) * strength, ny = (H(x, y + 1) - H(x, y - 1)) * strength, L = Math.hypot(nx, ny, 1), i = (y * w + x) * 4;
      d[i] = (nx / L * 0.5 + 0.5) * 255; d[i + 1] = (ny / L * 0.5 + 0.5) * 255; d[i + 2] = (1 / L * 0.5 + 0.5) * 255; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }));
}
// draw the colour, height and roughness/metalness (G = roughness, B = metalness) of a surface in one go
function surface(W, H, draw, strength = 3) {
  const col = canvas(W, H, () => {}), hgt = canvas(W, H, (g) => { g.fillStyle = "#808080"; g.fillRect(0, 0, W, H); }), orm = canvas(W, H, (g) => { g.fillStyle = "rgb(255,220,0)"; g.fillRect(0, 0, W, H); });
  draw(col.getContext("2d"), hgt.getContext("2d"), orm.getContext("2d"), W, H);
  return { map: tex(col), normal: normalFrom(hgt, strength), orm: dataTex(orm) };
}
const RM = (r, m) => `rgb(255,${Math.round(r * 255)},${Math.round(m * 255)})`; // a roughness/metalness colour
// One facade tile is 8 window columns (3 m) by 8 floors (3.5 m): 24 m by 28 m.
const COLS = 8, FLOORS = 8, COL_M = 3, FLOOR_M = 3.5, TILE_W = COLS * COL_M, TILE_H = FLOORS * FLOOR_M;
function facade(style) {
  const W = 512, H = 512, cw = W / COLS, fh = H / FLOORS;
  const s = surface(W, H, (g, hg, o) => {
    if (style === "glass") {
      const grd = g.createLinearGradient(0, 0, W, H); grd.addColorStop(0, "#6f8ea4"); grd.addColorStop(0.5, "#3a5468"); grd.addColorStop(1, "#7a98ac");
      g.fillStyle = grd; g.fillRect(0, 0, W, H); o.fillStyle = RM(0.05, 0.8); o.fillRect(0, 0, W, H); hg.fillStyle = "#707070"; hg.fillRect(0, 0, W, H);
      for (let f = 0; f < FLOORS; f++) { // spandrel bands between the floors
        g.fillStyle = "rgba(20,28,36,.92)"; g.fillRect(0, f * fh + fh - 9, W, 9); o.fillStyle = RM(0.3, 0.6); o.fillRect(0, f * fh + fh - 9, W, 9); hg.fillStyle = "#a0a0a0"; hg.fillRect(0, f * fh + fh - 9, W, 9);
      }
      for (let c = 0; c <= COLS; c++) { g.fillStyle = "rgba(210,222,232,.5)"; g.fillRect(c * cw - 2, 0, 4, H); o.fillStyle = RM(0.35, 1); o.fillRect(c * cw - 2, 0, 4, H); hg.fillStyle = "#e0e0e0"; hg.fillRect(c * cw - 2, 0, 4, H); }
      noise(g, W, H, 8);
    } else {
      const base = style === "brick" ? [168, 150, 140] : style === "dark" ? [70, 72, 76] : [214, 206, 192];
      g.fillStyle = `rgb(${base})`; g.fillRect(0, 0, W, H); noise(g, W, H, 26, base);
      o.fillStyle = RM(style === "dark" ? 0.55 : 0.88, style === "dark" ? 0.25 : 0); o.fillRect(0, 0, W, H);
      if (style === "brick") { // courses and joints
        for (let y = 0; y < H; y += 6) { g.fillStyle = "rgba(255,255,255,.08)"; g.fillRect(0, y, W, 1); hg.fillStyle = "#585858"; hg.fillRect(0, y, W, 1); for (let x = (y / 6) % 2 ? 0 : 7; x < W; x += 14) hg.fillRect(x, y, 1, 6); }
      } else if (style === "stone") { for (let y = 0; y < H; y += fh / 2) { hg.fillStyle = "#606060"; hg.fillRect(0, y, W, 2); } }
      for (let f = 0; f < FLOORS; f++) for (let c = 0; c < COLS; c++) {
        const x = c * cw + cw * 0.18, y = f * fh + fh * 0.18, w = cw * 0.64, h = fh * 0.6;
        g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(x - 3, y - 3, w + 6, h + 8); // the frame's shadow
        hg.fillStyle = "#c0c0c0"; hg.fillRect(x - 4, y - 4, w + 8, h + 8); hg.fillStyle = "#303030"; hg.fillRect(x, y, w, h); // the frame stands out, the glass is set back
        const grd = g.createLinearGradient(x, y, x + w, y + h); grd.addColorStop(0, "#4a5d6c"); grd.addColorStop(1, "#151c23");
        g.fillStyle = grd; g.fillRect(x, y, w, h); o.fillStyle = RM(0.04, 0.6); o.fillRect(x, y, w, h);
        g.fillStyle = style === "dark" ? "#555" : "rgba(240,235,225,.85)"; g.fillRect(x - 2, y + h, w + 4, 3); hg.fillStyle = "#f0f0f0"; hg.fillRect(x - 3, y + h, w + 6, 4); // the sill
        g.fillStyle = "rgba(0,0,0,.4)"; g.fillRect(x + w / 2 - 1, y, 2, h); hg.fillStyle = "#909090"; hg.fillRect(x + w / 2 - 1, y, 2, h); o.fillStyle = RM(0.5, 0.2); o.fillRect(x + w / 2 - 1, y, 2, h);
      }
      if (style !== "dark") { g.fillStyle = "rgba(0,0,0,.08)"; for (let f = 0; f < FLOORS; f++) g.fillRect(0, f * fh, W, 3); }
      noiseCh(o, W, H, 30, 1);
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
  return { ...s, glow: tex(glow) };
}
// A wooden house: clapboard siding, windows with white trim, painted in the house's colour (the vertex colour).
function siding() {
  const W = 512, H = 512, cw = W / COLS, fh = H / FLOORS;
  const s = surface(W, H, (g, hg, o) => {
    g.fillStyle = "#e8e4dc"; g.fillRect(0, 0, W, H); o.fillStyle = RM(0.7, 0); o.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 8) { g.fillStyle = "rgba(0,0,0,.10)"; g.fillRect(0, y + 6, W, 2); g.fillStyle = "rgba(255,255,255,.12)"; g.fillRect(0, y, W, 1); const gr = hg.createLinearGradient(0, y, 0, y + 8); gr.addColorStop(0, "#606060"); gr.addColorStop(1, "#b0b0b0"); hg.fillStyle = gr; hg.fillRect(0, y, W, 8); }
    noise(g, W, H, 10);
    for (let f = 0; f < FLOORS; f++) for (let c = 0; c < COLS; c++) {
      if ((c + f) % 2) continue; // houses have fewer windows than offices
      const x = c * cw + cw * 0.2, y = f * fh + fh * 0.2, w = cw * 0.6, h = fh * 0.55;
      g.fillStyle = "#fbfaf6"; g.fillRect(x - 5, y - 5, w + 10, h + 10); hg.fillStyle = "#d0d0d0"; hg.fillRect(x - 5, y - 5, w + 10, h + 10); o.fillStyle = RM(0.45, 0); o.fillRect(x - 5, y - 5, w + 10, h + 10);
      const grd = g.createLinearGradient(x, y, x + w, y + h); grd.addColorStop(0, "#4a5a66"); grd.addColorStop(1, "#151b20"); g.fillStyle = grd; g.fillRect(x, y, w, h);
      hg.fillStyle = "#404040"; hg.fillRect(x, y, w, h); o.fillStyle = RM(0.04, 0.55); o.fillRect(x, y, w, h);
      g.fillStyle = "#fbfaf6"; g.fillRect(x + w / 2 - 2, y, 4, h); g.fillRect(x, y + h / 2 - 2, w, 4); hg.fillStyle = "#c0c0c0"; hg.fillRect(x + w / 2 - 2, y, 4, h); hg.fillRect(x, y + h / 2 - 2, w, 4);
    }
  }, 2.5);
  const glow = canvas(W, H, (g) => { g.fillStyle = "#000"; g.fillRect(0, 0, W, H); for (let f = 0; f < FLOORS; f++) for (let c = 0; c < COLS; c++) { if ((c + f) % 2 || rand() > 0.45) continue; g.fillStyle = `hsl(${36 + rand() * 10},80%,${55 + rand() * 15}%)`; g.fillRect(c * cw + cw * 0.2, f * fh + fh * 0.2, cw * 0.6, fh * 0.55); } });
  return { ...s, glow: tex(glow) };
}
// Corrugated metal for warehouses, with a band of high windows.
function metal() {
  const W = 512, H = 512, fh = H / FLOORS;
  const s = surface(W, H, (g, hg, o) => {
    g.fillStyle = "#c9ccd0"; g.fillRect(0, 0, W, H); o.fillStyle = RM(0.45, 0.65); o.fillRect(0, 0, W, H);
    for (let x = 0; x < W; x += 6) { g.fillStyle = "rgba(0,0,0,.12)"; g.fillRect(x, 0, 2, H); g.fillStyle = "rgba(255,255,255,.15)"; g.fillRect(x + 3, 0, 1, H); const gr = hg.createLinearGradient(x, 0, x + 6, 0); gr.addColorStop(0, "#505050"); gr.addColorStop(0.5, "#c0c0c0"); gr.addColorStop(1, "#505050"); hg.fillStyle = gr; hg.fillRect(x, 0, 6, H); }
    noise(g, W, H, 12); noiseCh(o, W, H, 40, 1);
    for (let f = 0; f < FLOORS; f += 2) { g.fillStyle = "rgba(30,40,50,.85)"; g.fillRect(0, f * fh + fh * 0.15, W, fh * 0.25); o.fillStyle = RM(0.06, 0.5); o.fillRect(0, f * fh + fh * 0.15, W, fh * 0.25); hg.fillStyle = "#606060"; hg.fillRect(0, f * fh + fh * 0.15, W, fh * 0.25); }
  }, 2);
  const glow = canvas(W, H, (g) => { g.fillStyle = "#000"; g.fillRect(0, 0, W, H); for (let f = 0; f < FLOORS; f += 2) if (rand() < 0.5) { g.fillStyle = "#cfe0ff"; g.fillRect(0, f * fh + fh * 0.15, W, fh * 0.25); } });
  return { ...s, glow: tex(glow) };
}
function shopfront() { // the ground floor: shop windows, doors and a sign band, 6 m wide by 4.5 m
  const W = 256, H = 192;
  const s = surface(W, H, (g, hg, o) => {
    g.fillStyle = "#2a2622"; g.fillRect(0, 0, W, H); o.fillStyle = RM(0.6, 0.2); o.fillRect(0, 0, W, H);
    const awn = ["#7a1f1f", "#1f3d7a", "#1f5a3a", "#5a4a1f", "#333"][Math.floor(rand() * 5)];
    g.fillStyle = "#111"; g.fillRect(0, 0, W, 40); hg.fillStyle = "#b0b0b0"; hg.fillRect(0, 0, W, 40); // sign band
    g.fillStyle = awn; g.fillRect(6, 40, W - 12, 18); hg.fillStyle = "#e0e0e0"; hg.fillRect(6, 40, W - 12, 18); o.fillStyle = RM(0.95, 0); o.fillRect(6, 40, W - 12, 18);
    const grd = g.createLinearGradient(0, 60, 0, H); grd.addColorStop(0, "#4a5a68"); grd.addColorStop(1, "#1b2228");
    g.fillStyle = grd; g.fillRect(12, 62, W - 24, H - 74); hg.fillStyle = "#404040"; hg.fillRect(12, 62, W - 24, H - 74); o.fillStyle = RM(0.03, 0.4); o.fillRect(12, 62, W - 24, H - 74);
    g.fillStyle = "#0c0c0c"; g.fillRect(W / 2 - 22, 62, 44, H - 66); hg.fillStyle = "#303030"; hg.fillRect(W / 2 - 22, 62, 44, H - 66); // the door
    g.fillStyle = "#777"; g.fillRect(0, H - 10, W, 10); hg.fillStyle = "#c0c0c0"; hg.fillRect(0, H - 10, W, 10); o.fillStyle = RM(0.85, 0); o.fillRect(0, H - 10, W, 10);
  }, 2.5);
  const glow = canvas(W, H, (g) => {
    g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
    g.fillStyle = "#ffe3a8"; g.fillRect(12, 62, W / 2 - 34, H - 74); g.fillRect(W / 2 + 22, 62, W / 2 - 34, H - 74);
    g.fillStyle = `hsl(${rand() * 360},90%,62%)`; g.fillRect(30, 12, W - 60, 16); // a lit sign
  });
  return { ...s, glow: tex(glow) };
}
function ground(kind) {
  return surface(512, 512, (g, hg, o, W, H) => {
    if (kind === "asphalt") {
      g.fillStyle = "#2b2c2e"; g.fillRect(0, 0, W, H); noise(g, W, H, 22); noise(hg, W, H, 70); o.fillStyle = RM(0.86, 0); o.fillRect(0, 0, W, H); noiseCh(o, W, H, 50, 1);
      g.fillStyle = "rgba(0,0,0,.25)"; for (let i = 0; i < 18; i++) { g.beginPath(); g.ellipse(rand() * W, rand() * H, 10 + rand() * 40, 4 + rand() * 12, rand() * 3, 0, 7); g.fill(); }
      hg.strokeStyle = "#303030"; hg.lineWidth = 2; g.strokeStyle = "rgba(0,0,0,.45)"; g.lineWidth = 1.5; // cracks
      for (let i = 0; i < 6; i++) { let x = rand() * W, y = rand() * H; hg.beginPath(); g.beginPath(); hg.moveTo(x, y); g.moveTo(x, y); for (let k = 0; k < 8; k++) { x += (rand() - 0.5) * 40; y += (rand() - 0.5) * 40; hg.lineTo(x, y); g.lineTo(x, y); } hg.stroke(); g.stroke(); }
    } else if (kind === "sidewalk") {
      g.fillStyle = "#8d8a84"; g.fillRect(0, 0, W, H); noise(g, W, H, 18); noise(hg, W, H, 30); o.fillStyle = RM(0.9, 0); o.fillRect(0, 0, W, H); noiseCh(o, W, H, 30, 1);
      g.strokeStyle = "rgba(0,0,0,.25)"; g.lineWidth = 2; hg.fillStyle = "#202020";
      for (let i = 0; i <= W; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, H); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(W, i); g.stroke(); hg.fillRect(i - 2, 0, 4, H); hg.fillRect(0, i - 2, W, 4); }
    } else if (kind === "grass") { g.fillStyle = "#3d5a2a"; g.fillRect(0, 0, W, H); noise(g, W, H, 34); noise(hg, W, H, 90); o.fillStyle = RM(0.97, 0); o.fillRect(0, 0, W, H); }
    else if (kind === "plaza") {
      g.fillStyle = "#7d6a62"; g.fillRect(0, 0, W, H); noise(g, W, H, 16); o.fillStyle = RM(0.7, 0); o.fillRect(0, 0, W, H); noiseCh(o, W, H, 40, 1);
      g.strokeStyle = "rgba(255,255,255,.08)"; hg.fillStyle = "#303030"; for (let i = 0; i <= W; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, H); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(W, i); g.stroke(); hg.fillRect(i - 1, 0, 2, H); hg.fillRect(0, i - 1, W, 2); }
    } else if (kind === "roof") { g.fillStyle = "#59595a"; g.fillRect(0, 0, W, H); noise(g, W, H, 30); noise(hg, W, H, 80); o.fillStyle = RM(0.95, 0); o.fillRect(0, 0, W, H); }
    else if (kind === "shingle") {
      g.fillStyle = "#4a4440"; g.fillRect(0, 0, W, H); o.fillStyle = RM(0.85, 0); o.fillRect(0, 0, W, H);
      for (let y = 0; y < H; y += 16) for (let x = (y / 16) % 2 ? 0 : 12; x < W; x += 24) { g.fillStyle = `rgb(${60 + rand() * 30},${54 + rand() * 24},${50 + rand() * 20})`; g.fillRect(x, y, 22, 14); const gr = hg.createLinearGradient(0, y, 0, y + 16); gr.addColorStop(0, "#c0c0c0"); gr.addColorStop(1, "#404040"); hg.fillStyle = gr; hg.fillRect(x, y, 22, 16); }
    } else if (kind === "lawn") {
      g.fillStyle = "#556b34"; g.fillRect(0, 0, W, H); noise(g, W, H, 30); noise(hg, W, H, 100); o.fillStyle = RM(0.96, 0); o.fillRect(0, 0, W, H);
      g.fillStyle = "rgba(120,100,60,.12)"; for (let i = 0; i < 30; i++) { g.beginPath(); g.ellipse(rand() * W, rand() * H, 20 + rand() * 60, 10 + rand() * 30, rand() * 3, 0, 7); g.fill(); }
    } else if (kind === "leaves") {
      g.fillStyle = "#5d7f3e"; g.fillRect(0, 0, W, H); o.fillStyle = RM(0.75, 0); o.fillRect(0, 0, W, H);
      for (let i = 0; i < 2600; i++) { const x = rand() * W, y = rand() * H, r = 3 + rand() * 7, l = 30 + rand() * 45; g.fillStyle = `hsl(${85 + rand() * 30},${35 + rand() * 25}%,${l}%)`; g.beginPath(); g.ellipse(x, y, r, r * 0.55, rand() * 3, 0, 7); g.fill(); hg.fillStyle = `rgb(${l * 3},${l * 3},${l * 3})`; hg.beginPath(); hg.ellipse(x, y, r, r * 0.55, rand() * 3, 0, 7); hg.fill(); }
    } else if (kind === "water") {
      g.fillStyle = "#1b3646"; g.fillRect(0, 0, W, H);
      hg.fillStyle = "#808080"; hg.fillRect(0, 0, W, H); // waves: soft blobs that wrap round the edges, so it tiles
      for (let i = 0; i < 220; i++) { const x = rand() * W, y = rand() * H, r = 8 + rand() * 40, up = rand() < 0.5; for (const ox of [-W, 0, W]) for (const oy of [-H, 0, H]) { const gr = hg.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r); gr.addColorStop(0, up ? "rgba(255,255,255,.25)" : "rgba(0,0,0,.25)"); gr.addColorStop(1, "rgba(128,128,128,0)"); hg.fillStyle = gr; hg.fillRect(x + ox - r, y + oy - r, r * 2, r * 2); } }
    }
  }, kind === "water" ? 6 : kind === "asphalt" ? 1.6 : kind === "leaves" ? 2.5 : 2.2);
}
// where puddles form when it rains (a soft mask, tiling)
function puddles() {
  return dataTex(canvas(256, 256, (g, W, H) => {
    g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 26; i++) { const x = rand() * W, y = rand() * H, r = 6 + rand() * 30; for (const ox of [-W, 0, W]) for (const oy of [-H, 0, H]) { const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.6, "rgba(255,255,255,.7)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.beginPath(); g.ellipse(x + ox, y + oy, r, r * (0.4 + rand() * 0.5), rand() * 3, 0, 7); g.fill(); } }
  }));
}
// Shared values the shaders read: how wet the streets are (fx.js sets it from the weather), and the time (for wind).
export const WET = { value: 0 }, TIME = { value: 0 };
// Wet streets: darker, glossy, and flat mirror-like puddles where the mask says so. Needs a material with a map.
function wettable(mat, pud, scale = 0.37) {
  mat.onBeforeCompile = (s) => {
    s.uniforms.uWet = WET; s.uniforms.tPuddle = { value: pud };
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uWet; uniform sampler2D tPuddle; float rbPud;")
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>
        rbPud = smoothstep(0.25, 0.75, texture2D(tPuddle, vMapUv * ${scale.toFixed(3)}).r) * smoothstep(0.35, 0.9, uWet);
        roughnessFactor = mix(roughnessFactor, 0.22, uWet * 0.85); roughnessFactor = mix(roughnessFactor, 0.02, rbPud);
        diffuseColor.rgb *= mix(1.0, 0.55, uWet) * mix(1.0, 0.6, rbPud);`)
      .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\n normal = normalize(mix(normal, nonPerturbedNormal, rbPud));");
  };
  mat.customProgramCacheKey = () => "rbwet" + scale;
  return mat;
}
// A soft cone of light (street lamps at night, headlight beams): additive, brightest at the lamp, fading out.
export function lightConeMaterial(color, strength) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    uniforms: { uOn: { value: 0 }, uCol: { value: new THREE.Color(color) }, uK: { value: strength } },
    vertexShader: `varying float vY; varying vec3 vN, vV;
      void main() {
        vec4 w = modelMatrix * ${"#ifdef USE_INSTANCING\n instanceMatrix *\n#endif\n"} vec4(position, 1.0);
        vY = uv.y; vN = normalize(mat3(modelMatrix) * ${"#ifdef USE_INSTANCING\n mat3(instanceMatrix) *\n#endif\n"} normal); vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uOn, uK; uniform vec3 uCol; varying float vY; varying vec3 vN, vV;
      void main() { float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.5); gl_FragColor = vec4(uCol * uOn * uK * edge * vY * vY, 1.0); }`,
  });
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
// A pitched roof on a four-cornered house: the ridge runs the long way, with gable ends in the walls' siding.
function gable(b, tint, roofB, wallB) {
  const P = b.pts, l01 = Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]), l12 = Math.hypot(P[2][0] - P[1][0], P[2][1] - P[1][1]);
  const [a, bb, c, d] = l01 >= l12 ? [P[0], P[1], P[2], P[3]] : [P[1], P[2], P[3], P[0]]; // a-b and c-d are the long eaves
  const span = Math.min(l01, l12), rise = span * 0.38, h = b.h, top = h + rise;
  const m1 = [(bb[0] + c[0]) / 2, (bb[1] + c[1]) / 2], m0 = [(d[0] + a[0]) / 2, (d[1] + a[1]) / 2]; // ridge ends over the short sides
  const rc = [0.55, 0.5, 0.47];
  const slope = (p, q, r1, r0) => { // eave p-q up to ridge r1-r0
    const v = [[p[0], h, p[1]], [q[0], h, q[1]], [r1[0], top, r1[1]], [r0[0], top, r0[1]]];
    const e1 = [v[1][0] - v[0][0], 0, v[1][2] - v[0][2]], e2 = [v[3][0] - v[0][0], rise, v[3][2] - v[0][2]];
    let nn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; const L = Math.hypot(...nn) || 1; nn = nn.map((x) => x / L);
    if (nn[1] < 0) { roofB.quad(v[1], v[0], v[3], v[2], nn.map((x) => -x), [1, 0, 0, 0, 0, 1, 1, 1], rc); } else roofB.quad(v[0], v[1], v[2], v[3], nn, [0, 0, 1, 0, 1, 1, 0, 1], rc);
  };
  slope(a, bb, m1, m0); slope(c, d, m0, m1);
  // the two triangles under the ridge, in siding
  for (const [p, q, r] of [[bb, c, m1], [d, a, m0]]) {
    const nx = -(q[1] - p[1]), nz = q[0] - p[0], L = Math.hypot(nx, nz) || 1, mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2;
    let n = [nx / L, 0, nz / L]; if (inside(b.pts, mx + n[0] * 0.3, mz + n[2] * 0.3)) n = n.map((x) => -x);
    const A = [p[0], h, p[1]], B = [q[0], h, q[1]], Cc = [r[0], top, r[1]];
    const face = -(q[1] - p[1]) * n[0] + (q[0] - p[0]) * n[2] > 0;
    const uv = [0, h / FLOOR_M, L / COL_M, h / FLOOR_M, L / COL_M / 2, top / FLOOR_M];
    if (face) wallB.tri(A, B, Cc, n, uv, tint); else wallB.tri(B, A, Cc, n, uv, tint);
  }
}
function styleOf(b) {
  if (b.kind === 2) return "siding";
  if (b.kind === 3) return "metal";
  if (b.kind === 1) return rand() < 0.5 ? "brick" : "stone";
  if (!b.core) return "far";
  if (b.h > 90) return rand() < 0.75 ? "glass" : "dark";
  if (b.h > 45) return rand() < 0.45 ? "glass" : rand() < 0.5 ? "stone" : "dark";
  const c = new THREE.Color(b.colour || "#c8b8a8"), hsl = {}; c.getHSL(hsl);
  return hsl.s > 0.2 && hsl.h < 0.08 && hsl.l < 0.5 ? "brick" : rand() < 0.3 ? "brick" : "stone";
}
function tintOf(b, style) {
  const c = new THREE.Color(b.colour || "#bfb5a8"); c.lerp(new THREE.Color(0xffffff), style === "glass" ? 0.85 : style === "siding" ? 0.05 : 0.45);
  const k = 0.85 + rand() * 0.25; return [c.r * k, c.g * k, c.b * k];
}

// Ground-level layers sit a few centimetres apart; polygon offset makes them draw in order even on GPUs with a coarse
// depth buffer (some phones), where those few centimetres alone would flicker.
function layer(mat, n) { mat.polygonOffset = true; mat.polygonOffsetFactor = -n; mat.polygonOffsetUnits = -n * 2; return mat; }

// ---------------------------------------------------------------- building the city
export function buildCity(scene, opts = {}) {
  const out = { night: [], boards: [], lampMat: null, signalMats: null, tick: () => {} };
  const fac = { glass: facade("glass"), stone: facade("stone"), brick: facade("brick"), dark: facade("dark"), siding: siding(), metal: metal() };
  const shops = [shopfront(), shopfront(), shopfront()];
  const mats = {}, batches = {}, CH = 220;
  const batch = (key, b) => { const k = b ? `${key}@${Math.floor(b.c[0] / CH)},${Math.floor(b.c[1] / CH)}` : key; return (batches[k] ||= Object.assign(new Batch(), { key })); };
  for (const [k, f] of Object.entries(fac)) {
    mats[k] = new THREE.MeshStandardMaterial({ map: f.map, normalMap: f.normal, roughnessMap: f.orm, metalnessMap: f.orm, roughness: 1, metalness: 1, emissive: 0xffffff, emissiveMap: f.glow, emissiveIntensity: 0, vertexColors: true, envMapIntensity: k === "glass" ? 1.3 : 1 });
    out.night.push(mats[k]);
  }
  shops.forEach((s, i) => { mats["shop" + i] = new THREE.MeshStandardMaterial({ map: s.map, normalMap: s.normal, roughnessMap: s.orm, metalnessMap: s.orm, roughness: 1, metalness: 1, emissive: 0xffffff, emissiveMap: s.glow, emissiveIntensity: 0, vertexColors: true }); mats["shop" + i].userData.shop = true; out.night.push(mats["shop" + i]); });
  mats.far = new THREE.MeshStandardMaterial({ map: fac.dark.map, roughnessMap: fac.dark.orm, metalnessMap: fac.dark.orm, roughness: 1, metalness: 1, emissive: 0xffffff, emissiveMap: fac.glass.glow, emissiveIntensity: 0, vertexColors: true }); out.night.push(mats.far);
  const roofT = ground("roof"), shingleT = ground("shingle");
  mats.roof = new THREE.MeshStandardMaterial({ map: roofT.map, normalMap: roofT.normal, roughness: 0.95, vertexColors: true });
  mats.shingle = new THREE.MeshStandardMaterial({ map: shingleT.map, normalMap: shingleT.normal, roughnessMap: shingleT.orm, roughness: 1, vertexColors: true, side: THREE.DoubleSide });
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
      const shopBand = style !== "far" && style !== "siding" && style !== "metal" && b.min < 0.5 && L > 3 && (b.kind === 1 ? b.h >= 4.4 : b.h > 7);
      if (shopBand) { wall(0, SHOP_H, shop, 6, SHOP_H, 0); if (b.h > SHOP_H + 0.2) wall(SHOP_H, b.h, style, TILE_W, TILE_H, SHOP_H); }
      else wall(b.min, b.h, style, TILE_W, TILE_H, 0);
      along += L;
    }
    if (b.kind === 2 && n === 4) gable(b, tint, batch("shingle", b), batch(style, b));
    else flat(batch("roof", b), pts, b.h, 6, tint.map((v) => v * 0.8));
  });
  for (const bt of Object.values(batches)) if (bt.p.length) scene.add(bt.mesh(mats[bt.key], bt.key !== "far"));

  // the ground: sidewalk everywhere, then parks, plazas and the roads on top
  const pud = puddles();
  const lawn = D.ground === "grass", side = ground(lawn ? "lawn" : "sidewalk"); for (const t of [side.map, side.normal, side.orm]) t.repeat.set(4800 / (lawn ? 24 : 12), 4800 / (lawn ? 24 : 12)); // sidewalk slabs of 1.5 m
  const g0m = new THREE.MeshStandardMaterial({ map: side.map, normalMap: side.normal, roughnessMap: side.orm, roughness: 1 }); if (!lawn) wettable(g0m, pud, 0.5);
  const g0 = new THREE.Mesh(new THREE.PlaneGeometry(4800, 4800), g0m);
  g0.rotation.x = -Math.PI / 2; g0.receiveShadow = true; scene.add(g0);
  const area = (list, y, kind, scale, col) => { const bt = new Batch(); for (const a of list) { const pts = []; for (let i = 0; i < a.length; i += 2) pts.push([dm(a[i]), dm(a[i + 1])]); flat(bt, pts, y, scale, col); } if (bt.p.length) { const t = ground(kind), mt = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normal, roughnessMap: t.orm, roughness: 1, vertexColors: true }); if (kind === "plaza") wettable(mt, pud); const m = bt.mesh(layer(mt, 1), false); scene.add(m); } };
  area(D.green, 0.012, "grass", 8, [1, 1, 1]); area(D.plazas, 0.014, "plaza", 6, [1, 1, 1]);
  if (D.water.length) { const bt = new Batch(); for (const a of D.water) { const pts = []; for (let i = 0; i < a.length; i += 2) pts.push([dm(a[i]), dm(a[i + 1])]); flat(bt, pts, 0.016, 30, [1, 1, 1]); } const wt = ground("water"), n2 = wt.normal.clone(); n2.repeat.set(0.6, 0.6); // two layers of waves, drifting different ways
    const wm = layer(new THREE.MeshPhysicalMaterial({ color: 0x9fb4c0, map: wt.map, normalMap: wt.normal, normalScale: new THREE.Vector2(0.55, 0.55), clearcoat: 1, clearcoatRoughness: 0.04, clearcoatNormalMap: n2, clearcoatNormalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.12, metalness: 0, ior: 1.33, envMapIntensity: 1.25, vertexColors: true }), 1);
    out.water = wm; out.waterTick = (dt) => { wt.normal.offset.x += dt * 0.004; wt.normal.offset.y += dt * 0.0025; n2.offset.x -= dt * 0.0018; n2.offset.y += dt * 0.003; }; scene.add(bt.mesh(wm, false)); }
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
  // sidewalks: a concrete strip each side of every road, under the asphalt (on lawns and lots it's what you walk on)
  const walk = new Batch();
  for (const e of edges) if (e.cls !== "service" && e.cls !== "motorway") strip(walk, nodes[e.a], nodes[e.b], e.w + 6.4, 0.017, 12);
  for (let i = 0; i < D.vroads.length; i += 5) strip(walk, [dm(D.vroads[i]), dm(D.vroads[i + 1])], [dm(D.vroads[i + 2]), dm(D.vroads[i + 3])], 15, 0.017, 12);
  nodes.forEach((n, i) => { const r = junction[i] / 2 + 3.2; if (!junction[i]) return; const pts = []; for (let k = 0; k < 16; k++) pts.push([n[0] + Math.cos((k / 16) * Math.PI * 2) * r, n[1] + Math.sin((k / 16) * Math.PI * 2) * r]); flat(walk, pts, 0.0175, 12, W1); });
  if (lawn) { const st = ground("sidewalk"); scene.add(walk.mesh(layer(wettable(new THREE.MeshStandardMaterial({ map: st.map, normalMap: st.normal, roughnessMap: st.orm, roughness: 1 }), pud, 0.5), 1), false)); }
  const asphalt = ground("asphalt"); scene.add(road.mesh(layer(wettable(new THREE.MeshStandardMaterial({ map: asphalt.map, normalMap: asphalt.normal, normalScale: new THREE.Vector2(0.8, 0.8), roughnessMap: asphalt.orm, roughness: 1, metalness: 0 }), pud), 2), false));
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
  // at night each lamp throws a soft cone of light down to the pavement
  const coneGeo = new THREE.CylinderGeometry(0.22, 3.6, 7.6, 18, 1, true); coneGeo.translate(0, 7.9 - 3.8, 1.6);
  out.coneMat = lightConeMaterial(0xffc98a, 0.9);
  const Cn = new THREE.InstancedMesh(coneGeo, out.coneMat, lamps.length); Cn.instanceMatrix = Hd.instanceMatrix; Cn.userData.noAO = true; Cn.frustumCulled = false; Cn.visible = false; scene.add(Cn); out.cones = Cn;
  const trunk = new THREE.CylinderGeometry(0.14, 0.2, 3, 6); trunk.translate(0, 1.5, 0);
  // a crown of leaves: a few lumpy clumps merged into one shape, with a leaf texture, swaying in the wind
  const lumps = [[0, 4.5, 0, 1.9], [0.9, 4.1, 0.4, 1.35], [-0.8, 4.2, -0.5, 1.4], [0.2, 5.4, -0.2, 1.3], [-0.3, 3.7, 0.8, 1.2]].map(([x, y, z, r]) => {
    const gg = new THREE.IcosahedronGeometry(r, 2), pa = gg.attributes.position;
    for (let i = 0; i < pa.count; i++) { const k = 0.82 + 0.3 * Math.abs(Math.sin(pa.getX(i) * 3.1 + pa.getY(i) * 2.3) * Math.cos(pa.getZ(i) * 2.7)); pa.setXYZ(i, pa.getX(i) * k, pa.getY(i) * k * 0.9, pa.getZ(i) * k); }
    gg.translate(x, y, z); gg.deleteAttribute("normal"); return gg;
  });
  const crown = mergeVertices(mergeGeometries(lumps)); crown.computeVertexNormals();
  const leaf = ground("leaves");
  const leafMat = new THREE.MeshStandardMaterial({ map: leaf.map, normalMap: leaf.normal, roughnessMap: leaf.orm, roughness: 1, color: 0xffffff });
  leafMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = TIME;
    sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\nuniform float uTime;").replace("#include <begin_vertex>", `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
      #else
        vec2 ip = vec2(0.0);
      #endif
      float sway = max(0.0, position.y - 2.6);
      transformed.x += sin(uTime * 1.7 + ip.x * 0.31 + ip.y * 0.17) * 0.07 * sway;
      transformed.z += cos(uTime * 1.3 + ip.y * 0.29) * 0.05 * sway;`);
  };
  const T = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 }), trees.length);
  const Cr = new THREE.InstancedMesh(crown, leafMat, trees.length);
  const col = new THREE.Color();
  trees.forEach(([x, z, s], i) => { q4.setFromAxisAngle(up, rand() * 6); m4.compose(v3.set(x, 0, z), q4, new THREE.Vector3(s, s, s)); T.setMatrixAt(i, m4); Cr.setMatrixAt(i, m4); Cr.setColorAt(i, col.setHSL(0.2 + rand() * 0.08, 0.35 + rand() * 0.2, 0.55 + rand() * 0.2)); });
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
  const lampCol = (m, hex) => m.color.setHex(hex).multiplyScalar(3.2); // bright enough to glow
  const groups = [[], []];
  signals.forEach((s) => groups[s[3]].push(s));
  const heads = groups.map((gs, gi) => { const im = new THREE.InstancedMesh(sLamp, out.signalMats[gi], gs.length); gs.forEach(([x, z, r], i) => { q4.setFromAxisAngle(up, r); m4.compose(v3.set(x, 0, z), q4, s3); im.setMatrixAt(i, m4); }); scene.add(im); return im; });
  signals.forEach(([x, z, r], i) => { q4.setFromAxisAngle(up, r); m4.compose(v3.set(x, 0, z), q4, s3); SP.setMatrixAt(i, m4); SB.setMatrixAt(i, m4); });
  scene.add(SP, SB);
  // the cycle: 14 s green for the avenues, 3 s all red, 10 s green for the streets, 3 s all red
  out.signal = (t) => { const c = t % 30; return c < 14 ? 0 : c < 17 ? -1 : c < 27 ? 1 : -1; };
  let last = 0;
  out.tick = (t) => { const ph = out.signal(t); lampCol(out.signalMats[0], ph === 0 ? 0x00ff66 : 0xff2222); lampCol(out.signalMats[1], ph === 1 ? 0x00ff66 : 0xff2222); for (const b of out.boards) b.tick(t); TIME.value = t; if (out.waterTick) out.waterTick(Math.min(0.1, t - last)); last = t; };
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

// ---------------------------------------------------------------- RB Plaza: RB's screens and the HQ
// Animated screens on the buildings round RB Plaza, all RB's own: RB Radio, RB Studio, RB TV, RB Badge, RB World.
export function timesSquare(scene, out) {
  const ADS = [
    ["RELENTLESS", "BILLIONAIRE", "#C9A84C", "#000"], ["RB RADIO", "LIVE 24/7", "#ff3366", "#14000a"], ["RB STUDIO", "RECORD · MIX · MASTER", "#00e0ff", "#001018"],
    ["RB WORLD", "BUILD YOUR EMPIRE", "#F5E6A3", "#1a1200"], ["RB TV", "WATCH NOW", "#ffffff", "#2a0050"], ["RB BADGE", "EARN · LEVEL UP", "#00E676", "#001a0c"],
    ["RB EVENTS", "SEE YOU THERE", "#ffb000", "#1a0800"], ["CREATE", "OWN · ELEVATE", "#C9A84C", "#0a0a0a"],
  ];
  // RB's own screen art, drawn at 8:3 like the sponsors' (ads.js), with the words inside the 2:1 middle that every
  // screen shows whatever its shape
  const textures = ADS.map(([a, b, fg, bg], k) => {
    const c = canvas(1024, 384, (g, W, H) => {
      const grd = g.createLinearGradient(0, 0, W, H); grd.addColorStop(0, bg); grd.addColorStop(1, "#000"); g.fillStyle = grd; g.fillRect(0, 0, W, H);
      const sw = H * 0.9 * 2, sx = (W - sw) / 2;
      g.strokeStyle = fg; g.lineWidth = 8; g.strokeRect(sx + 6, H * 0.05 + 6, sw - 12, H * 0.9 - 12);
      g.fillStyle = fg; g.textAlign = "center"; g.font = "900 104px Inter, Arial, sans-serif"; g.fillText(a, W / 2, H * 0.5);
      g.fillStyle = "#fff"; g.font = "700 44px Inter, Arial, sans-serif"; g.fillText(b, W / 2, H * 0.74);
    });
    const t = tex(c, false); t.anisotropy = 16; t.userData.avg = new THREE.Color(fg).multiplyScalar(0.6); return t;
  });
  const ART = 8 / 3; // the art's shape; each screen shows the middle of it that matches its own shape
  // Sponsors' ads from RB Command (ads.js fills out.adPool) take turns with RB's own on every screen; with none live,
  // the screens show RB's own as before.
  out.adPool = out.adPool || { wide: [], tall: [] };
  const turn = (i, t, house, sponsors) => {
    if (!sponsors.length) return { tex: house[(i + Math.floor(t / 7)) % house.length], ad: null };
    const n = (i + Math.floor(t / 9)) % (sponsors.length * 2); // sponsor, RB, sponsor, RB...
    return n % 2 === 0 ? sponsors[(n / 2) % sponsors.length] : { tex: house[((n - 1) / 2 + i) % house.length], ad: null };
  };
  out.adSpots = [];
  D.boards.forEach(([x, z, ang, w, h, y], i) => {
    const mat = new THREE.MeshBasicMaterial({ map: textures[i % textures.length], color: new THREE.Color(1.6, 1.6, 1.6), fog: false }); // LED screens: bright, and clear through the haze
    const geo = new THREE.PlaneGeometry(w, h), uv = geo.attributes.uv, ku = Math.min(1, w / h / ART), kv = Math.min(1, ART / (w / h));
    for (let j = 0; j < uv.count; j++) uv.setXY(j, 0.5 + (uv.getX(j) - 0.5) * ku, 0.5 + (uv.getY(j) - 0.5) * kv); // no stretching
    const m = new THREE.Mesh(geo, mat); m.userData.noAO = true;
    m.position.set(dm(x), y + h / 2, dm(z)); m.rotation.y = ang; scene.add(m);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, h + 0.6, 0.3), new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.6 }));
    frame.position.copy(m.position); frame.rotation.y = ang; frame.translateZ(-0.2); scene.add(frame);
    const spot = { kind: "board", mesh: m, x: m.position.x, y: m.position.y, z: m.position.z, ang, w, h, twoSided: false, ad: null, range: 160 };
    out.adSpots.push(spot);
    out.boards.push({ tick: (t) => { const c = turn(i, t, textures, out.adPool.wide); spot.ad = c.ad; if (mat.map !== c.tex) mat.map = c.tex; } });
  });
  // Street posters: lit two-sided panels on the sidewalks of the main streets round RB Plaza, facing the traffic.
  const houseTall = ADS.map(([a, b, fg, bg]) => tex(canvas(512, 768, (g, W, H) => {
    const grd = g.createLinearGradient(0, 0, 0, H); grd.addColorStop(0, bg); grd.addColorStop(1, "#000"); g.fillStyle = grd; g.fillRect(0, 0, W, H);
    g.strokeStyle = fg; g.lineWidth = 8; g.strokeRect(14, 14, W - 28, H - 28);
    g.fillStyle = fg; g.textAlign = "center"; g.font = "900 74px Inter, Arial, sans-serif"; a.split(" ").forEach((wd, k, all) => g.fillText(wd, W / 2, H / 2 - (all.length - 1) * 44 + k * 88 - 40));
    g.fillStyle = "#fff"; g.font = "700 30px Inter, Arial, sans-serif"; g.fillText(b, W / 2, H - 120);
  }), false));
  const post = new THREE.MeshStandardMaterial({ color: 0x1b1b1f, metalness: 0.7, roughness: 0.35 });
  const placed = [], P0 = PLAZA, wanted = 16;
  const cand = edges.filter((e) => e.cls !== "service" && e.cls !== "motorway" && e.len > 30)
    .map((e) => { const A = nodes[e.a], B = nodes[e.b]; return { e, A, B, d: Math.hypot((A[0] + B[0]) / 2 - P0[0], (A[1] + B[1]) / 2 - P0[1]) }; })
    .filter((c) => c.d < 520).sort((p, q) => p.d - q.d);
  for (const { e, A, B } of cand) {
    if (placed.length >= wanted) break;
    const dx = B[0] - A[0], dz = B[1] - A[1], L = Math.hypot(dx, dz), nx = -dz / L, nz = dx / L, side = placed.length % 2 ? 1 : -1, off = e.w / 2 + 2.4;
    const px = (A[0] + B[0]) / 2 + nx * off * side, pz = (A[1] + B[1]) / 2 + nz * off * side;
    if (blocked(px, pz, 1.4) || placed.some((q) => Math.hypot(q[0] - px, q[1] - pz) < 55)) continue;
    placed.push([px, pz, Math.atan2(dx, dz)]);
  }
  placed.forEach(([px, pz, along], i) => {
    const W = 1.9, H = 2.85, Y = 0.55;
    const mat = new THREE.MeshBasicMaterial({ map: houseTall[i % houseTall.length], color: new THREE.Color(1.3, 1.3, 1.3), side: THREE.DoubleSide, fog: false });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat); face.userData.noAO = true;
    face.position.set(px, Y + H / 2, pz); face.rotation.y = along; scene.add(face); // faces up and down the street
    const box = new THREE.Mesh(new THREE.BoxGeometry(W + 0.24, H + 0.24, 0.16), post); box.position.copy(face.position); box.rotation.y = along; box.scale.z = 0.9; scene.add(box);
    face.position.x += Math.sin(along) * 0.09; face.position.z += Math.cos(along) * 0.09;
    const back = face.clone(); back.position.set(px - Math.sin(along) * 0.09, Y + H / 2, pz - Math.cos(along) * 0.09); back.rotation.y = along + Math.PI; scene.add(back);
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.16, Y, 0.16), post); leg.position.set(px, Y / 2, pz); scene.add(leg);
    const spot = { kind: "poster", mesh: face, x: px, y: Y + H / 2, z: pz, ang: along, w: W, h: H, twoSided: true, ad: null, range: 70 };
    out.adSpots.push(spot);
    out.boards.push({ tick: (t) => { const c = turn(i + 3, t, houseTall, out.adPool.tall); spot.ad = c.ad; if (mat.map !== c.tex) { mat.map = c.tex; back.material = mat; } } });
  });
  // RB HQ: One Times Square, with a gold crown and the big RB screen
  if (D.hq >= 0) {
    const b = buildings[D.hq];
    const crown = new THREE.Mesh(new THREE.BoxGeometry(b.box[2] - b.box[0] + 1, 2, b.box[3] - b.box[1] + 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xC9A84C).multiplyScalar(2.2) }));
    crown.position.set((b.box[0] + b.box[2]) / 2, b.h + 1, (b.box[1] + b.box[3]) / 2); scene.add(crown);
    // a lit RB sign on the roof, seen from down the street
    const sc = canvas(512, 160, (g, W, H) => { g.fillStyle = "#000"; g.fillRect(0, 0, W, H); g.strokeStyle = "#C9A84C"; g.lineWidth = 8; g.strokeRect(6, 6, W - 12, H - 12); g.fillStyle = "#F5E6A3"; g.font = "900 96px Inter, Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("RB HQ", W / 2, H / 2 + 4); });
    const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex(sc, false), color: new THREE.Color(2, 2, 2) })); sign.scale.set(16, 5, 1); sign.position.set(crown.position.x, b.h + 6.5, crown.position.z); scene.add(sign);
    out.hq = { x: crown.position.x, z: crown.position.z, h: b.h };
  }
}
