// Bakes RB World's city from real map data: OpenStreetMap, as vector tiles from OpenFreeMap (OpenMapTiles schema).
//   RB_CITY=vallejo node rb-tools/bake_city.mjs <tiles dir> [out file]      (vallejo is the default; or manhattan)
// The tiles dir holds z14 .pbf tiles named 14_<x>_<y>.pbf covering the area (rb-tools/bake_city.mjs --fetch <dir>
// downloads them). Writes rb-site-updates/src/world/city_data.js: buildings (footprint, height, colour), the road
// network (a graph with classes, widths, one-way and street names), parks and plazas, neighbourhood names, the lots
// (real buildings, one per RB lot id), the RB HQ and Times Square billboard spots, and the race tracks, which it also
// writes into empire_defs.js between the BAKED TRACKS markers (the server checks races against them).
// Everything is in metres in a local frame: x east-ish, z south-ish, turned so the street grid runs along the axes.
// Where OpenStreetMap has few building outlines (most of Vallejo), the blocks are filled with buildings made up to fit
// the place (seeded, so every bake is the same): shopfronts downtown, warehouses on industrial land, houses with
// front yards and pitched roofs on the residential streets. The real outlines that exist are kept as they are.
// Needs @mapbox/vector-tile and pbf (npm i @mapbox/vector-tile@2.0.3 pbf@4.0.1 in a scratch folder, then run with
// NODE_PATH pointing at its node_modules).
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(process.env.NODE_PATH ? join(process.env.NODE_PATH, "x.js") : import.meta.url);
const { VectorTile } = require("@mapbox/vector-tile");
const Protobuf = require("pbf").default || require("pbf");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// The cities RB World can be. plaza: RB Plaza (the dearest lots are round it, the HQ and screens are by it).
const CITIES = {
  vallejo: {
    name: "Vallejo, California", short: "Vallejo", key: "v", fill: true, ground: "grass",
    // downtown Vallejo between the waterfront (Mare Island Way) and Sonoma Boulevard, Georgia Street through the middle
    origin: [-122.2592, 38.1028], half: [520, 620], sky: 900, skyMinH: 12, plaza: [-122.2563, 38.1010], plazaName: "RB Plaza (Georgia & Marin)",
    lotMinA: 70, lotMinH: 3, lotGap: 13, board: { radius: 300, minH: 7, max: 14, w: 12, h: 6, y: 3 },
    places: [["Downtown Vallejo", -122.2565, 38.1012], ["Vallejo Waterfront", -122.2640, 38.1035], ["Heritage District", -122.2560, 38.1075], ["Sonoma Boulevard", -122.2545, 38.1060]],
    tracks: { loop: "Downtown Loop", zig: "Heritage District Zigzag", ring: "Vallejo Ring", gp: "RB Grand Prix (2 laps)" },
  },
  manhattan: {
    name: "Midtown Manhattan, New York", short: "Midtown", key: "", fill: false, ground: "sidewalk",
    origin: [-73.98545, 40.75790], half: [470, 600], sky: 950, skyMinH: 32, plaza: [-73.98550, 40.75800], plazaName: "RB Plaza (Times Square)",
    lotMinA: 250, lotMinH: 8, lotGap: 7, board: { radius: 230, minH: 22, max: 36, w: 26, h: 22, y: 5 },
    places: [], tracks: { loop: "Times Square Loop", zig: "Theater District Zigzag", ring: "Midtown Ring", gp: "RB Grand Prix (2 laps)" },
  },
};
const CFG = CITIES[process.env.RB_CITY || "vallejo"];
if (!CFG) throw new Error("RB_CITY must be one of " + Object.keys(CITIES).join(", "));
const ORIGIN = CFG.origin;
const [HALF_X, HALF_Z] = CFG.half, SKY = CFG.sky;
const Z = 14, EXT = 4096;

if (process.argv[2] === "--fetch") {
  const dir = process.argv[3]; mkdirSync(dir, { recursive: true });
  const tj = await (await fetch("https://tiles.openfreemap.org/planet")).json();
  const lon2x = (lon) => Math.floor(((lon + 180) / 360) * 2 ** Z), lat2y = (lat) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z); };
  const d = 0.02;
  for (let x = lon2x(ORIGIN[0] - d); x <= lon2x(ORIGIN[0] + d); x++) for (let y = lat2y(ORIGIN[1] + d); y <= lat2y(ORIGIN[1] - d); y++) {
    const f = join(dir, `${Z}_${x}_${y}.pbf`); if (existsSync(f)) continue;
    const r = await fetch(tj.tiles[0].replace("{z}", Z).replace("{x}", x).replace("{y}", y));
    if (!r.ok) throw new Error(`${f}: ${r.status}`);
    writeFileSync(f, Buffer.from(await r.arrayBuffer())); console.log("fetched", f);
  }
  process.exit(0);
}
const TILES = process.argv[2], OUT = process.argv[3] || join(ROOT, "rb-site-updates/src/world/city_data.js");

// ---------------------------------------------------------------- projection
const KX = 111320 * Math.cos((ORIGIN[1] * Math.PI) / 180), KZ = 110574; // metres per degree
function tileToLngLat(tx, ty, px, py) {
  const n = 2 ** Z, lng = ((tx + px / EXT) / n) * 360 - 180, yy = Math.PI * (1 - (2 * (ty + py / EXT)) / n);
  return [lng, (Math.atan(Math.sinh(yy)) * 180) / Math.PI];
}
let ROT = 0; // set from the street grid below
const local0 = ([lng, lat]) => [(lng - ORIGIN[0]) * KX, -(lat - ORIGIN[1]) * KZ];
const turn = ([x, z]) => [x * Math.cos(ROT) - z * Math.sin(ROT), x * Math.sin(ROT) + z * Math.cos(ROT)];
const local = (ll) => turn(local0(ll));

// ---------------------------------------------------------------- reading the tiles
function clipPoly(ring) { // Sutherland–Hodgman against the tile square, so a building cut by a tile edge isn't doubled
  let out = ring;
  for (const [axis, lim, keep] of [[0, 0, (a, l) => a >= l], [0, EXT, (a, l) => a <= l], [1, 0, (a, l) => a >= l], [1, EXT, (a, l) => a <= l]]) {
    const inp = out; out = [];
    for (let i = 0; i < inp.length; i++) {
      const a = inp[i], b = inp[(i + 1) % inp.length], ai = keep(a[axis], lim), bi = keep(b[axis], lim);
      if (ai) out.push(a);
      if (ai !== bi) { const t = (lim - a[axis]) / (b[axis] - a[axis]); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
    }
    if (!out.length) break;
  }
  return out;
}
function clipLine(line) { // keep the parts of a line inside the tile square
  const parts = []; let cur = [];
  const inside = (p) => p[0] >= 0 && p[0] <= EXT && p[1] >= 0 && p[1] <= EXT;
  for (let i = 0; i < line.length - 1; i++) {
    let [a, b] = [line[i], line[i + 1]], t0 = 0, t1 = 1;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    let ok = true;
    for (const [p, q] of [[-dx, a[0]], [dx, EXT - a[0]], [-dy, a[1]], [dy, EXT - a[1]]]) {
      if (p === 0) { if (q < 0) ok = false; continue; }
      const r = q / p; if (p < 0) { if (r > t1) ok = false; else if (r > t0) t0 = r; } else { if (r < t0) ok = false; else if (r < t1) t1 = r; }
    }
    if (!ok) { if (cur.length > 1) parts.push(cur); cur = []; continue; }
    const pa = [a[0] + dx * t0, a[1] + dy * t0], pb = [a[0] + dx * t1, a[1] + dy * t1];
    if (!cur.length) cur.push(pa);
    cur.push(pb);
    if (t1 < 1) { parts.push(cur); cur = []; }
  }
  if (cur.length > 1) parts.push(cur);
  return parts;
}
const CLS0 = ["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service"];
const feats = { building: [], road: [], name: [], green: [], plaza: [], water: [], place: [], zone: [] };
const DRIVE = { motorway: 16, trunk: 16, primary: 16, secondary: 14, tertiary: 12, minor: 9, service: 6 };
for (const f of readdirSync(TILES).filter((x) => x.endsWith(".pbf"))) {
  const [, tx, ty] = f.replace(".pbf", "").split("_").map(Number);
  const vt = new VectorTile(new Protobuf(readFileSync(join(TILES, f))));
  const ll = (p) => tileToLngLat(tx, ty, p.x ?? p[0], p.y ?? p[1]);
  const each = (name, fn) => { const l = vt.layers[name]; if (l) for (let i = 0; i < l.length; i++) fn(l.feature(i)); };
  each("building", (ft) => {
    const p = ft.properties; if (p.hide_3d) return;
    for (const ring of ft.loadGeometry()) {
      const pts = clipPoly(ring.map((q) => [q.x, q.y])); if (pts.length < 3) continue;
      if (area(pts) < 0) continue; // outer rings have positive area in tile space (clockwise with y down); holes are skipped
      feats.building.push({ ll: pts.map(ll), h: Number(p.render_height) || 10, min: Number(p.render_min_height) || 0, colour: p.colour || null });
    }
  });
  each("transportation", (ft) => {
    const p = ft.properties, w = DRIVE[p.class];
    if (ft.type === 3) { if (p.class === "pedestrian" || p.class === "path" || p.class === "footway") for (const ring of ft.loadGeometry()) { const pts = clipPoly(ring.map((q) => [q.x, q.y])); if (pts.length > 2 && area(pts) > 0) feats.plaza.push(pts.map(ll)); } return; }
    if (!w || p.brunnel === "tunnel" || p.class === "service" && p.service === "parking_aisle") return;
    for (const line of ft.loadGeometry()) for (const part of clipLine(line.map((q) => [q.x, q.y]))) feats.road.push({ ll: part.map(ll), cls: p.class, w, oneway: Number(p.oneway) || 0 });
  });
  each("transportation_name", (ft) => {
    const p = ft.properties; if (!p.name || !DRIVE[p.class]) return;
    for (const line of ft.loadGeometry()) for (const part of clipLine(line.map((q) => [q.x, q.y]))) feats.name.push({ ll: part.map(ll), name: String(p.name_en || p.name) });
  });
  for (const layer of ["landcover", "park", "landuse"]) each(layer, (ft) => {
    const c = ft.properties.class, s = ft.properties.subclass;
    if (ft.type === 3 && layer === "landuse" && ["retail", "commercial", "industrial", "residential", "school", "hospital"].includes(c)) for (const ring of ft.loadGeometry()) { const pts = clipPoly(ring.map((q) => [q.x, q.y])); if (pts.length > 2 && area(pts) > 0) feats.zone.push({ cls: c, ll: pts.map(ll) }); }
    if (ft.type !== 3 || !(c === "grass" || c === "park" || s === "park" || s === "garden" || c === "playground" || c === "pitch")) return;
    for (const ring of ft.loadGeometry()) { const pts = clipPoly(ring.map((q) => [q.x, q.y])); if (pts.length > 2 && area(pts) > 0) feats.green.push(pts.map(ll)); }
  });
  each("water", (ft) => { for (const ring of ft.loadGeometry()) { const pts = clipPoly(ring.map((q) => [q.x, q.y])); if (pts.length > 2 && area(pts) > 0) feats.water.push(pts.map(ll)); } });
  each("place", (ft) => { const p = ft.properties; if (["neighbourhood", "quarter"].includes(p.class)) { const g = ft.loadGeometry()[0][0]; if (g.x >= 0 && g.x <= EXT && g.y >= 0 && g.y <= EXT) feats.place.push({ ll: ll(g), name: String(p.name_en || p.name), cls: p.class }); } });
}
function simplify(pts, tol) { // Douglas–Peucker on a closed ring
  if (pts.length < 5) return pts;
  const keep = new Array(pts.length).fill(false); keep[0] = true; const far = pts.reduce((b, p, i) => (Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) > Math.hypot(pts[b][0] - pts[0][0], pts[b][1] - pts[0][1]) ? i : b), 0); keep[far] = true;
  const dp = (i, j) => { let m = -1, md = tol; for (let k = i + 1; k < j; k++) { const d = segDistP(pts[k], pts[i], pts[j]); if (d > md) { md = d; m = k; } } if (m >= 0) { keep[m] = true; dp(i, m); dp(m, j); } };
  dp(0, far); const ext = [...pts, pts[0]]; const k2 = [...keep, true]; const dp2 = (i, j) => { let m = -1, md = tol; for (let k = i + 1; k < j; k++) { const d = segDistP(ext[k], ext[i], ext[j]); if (d > md) { md = d; m = k; } } if (m >= 0) { k2[m] = true; dp2(i, m); dp2(m, j); } };
  dp2(far, pts.length);
  return pts.filter((_, i) => keep[i] || k2[i]);
}
function segDistP(p, a, b) { const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz); }
function pointIn(pts, x, z) { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, zi] = pts[i], [xj, zj] = pts[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; }
function area(pts) { let a = 0; for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; a += x1 * y2 - x2 * y1; } return a / 2; }

// ---------------------------------------------------------------- turn the frame so the avenues run along z
{
  let best = 0, bestScore = -1;
  const segs = [];
  for (const r of feats.road) if (r.cls === "primary" || r.cls === "secondary") for (let i = 0; i < r.ll.length - 1; i++) { const a = local0(r.ll[i]), b = local0(r.ll[i + 1]); segs.push([b[0] - a[0], b[1] - a[1]]); }
  for (let deg = 0; deg < 90; deg += 0.25) {
    const t = (deg * Math.PI) / 180; let s = 0;
    for (const [dx, dz] of segs) { const L = Math.hypot(dx, dz); if (L < 5) continue; const ang = Math.atan2(dz, dx) + t; s += L * Math.max(0, Math.cos(4 * ang)) ** 8; } // 1 when a segment runs along an axis, 0 at 45°
    if (s > bestScore) { bestScore = s; best = t; }
  }
  // of the two axis choices, the one where the longer roads (avenues) run along z
  ROT = best;
  let alongZ = 0, alongX = 0;
  for (const [dx, dz] of segs) { const [x, z] = turn([dx, dz]); if (Math.abs(z) > Math.abs(x)) alongZ += Math.hypot(x, z); else alongX += Math.hypot(x, z); }
  if (alongX > alongZ) ROT = best + Math.PI / 2;
  if (turn([0, -1])[1] > 0) ROT += Math.PI; // north up the screen (towards -z)
  ROT = Math.atan2(Math.sin(ROT), Math.cos(ROT));
  console.log("rotation", ((ROT * 180) / Math.PI).toFixed(2), "deg");
}

// ---------------------------------------------------------------- buildings
const inRect = ([x, z], hx, hz) => Math.abs(x) <= hx && Math.abs(z) <= hz;
const q = (v) => Math.round(v * 10); // decimetres
const buildings = [];
for (const b of feats.building) {
  let pts = b.ll.map(local);
  // drop repeated points and keep it tidy
  pts = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 0.3);
  if (pts.length > 3 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 0.3) pts.pop();
  pts = simplify(pts, 0.4);
  if (pts.length < 3) continue;
  const a = Math.abs(area(pts)); if (a < 12) continue;
  const c = pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length], [0, 0]);
  const core = inRect(c, HALF_X + 25, HALF_Z + 25);
  if (!inRect(c, SKY, SKY)) continue;
  if (!core && b.h < CFG.skyMinH) continue; // beyond the streets: only the taller ones
  if (area(pts) > 0) pts.reverse(); // one winding for all (counter-clockwise seen from above, with z south)
  buildings.push({ pts, h: Math.max(3, Math.min(480, b.h)), min: Math.max(0, b.min), colour: b.colour, c, a, core, kind: 0 });
}
console.log("buildings", buildings.length, "core", buildings.filter((b) => b.core).length);

// ---------------------------------------------------------------- roads: a graph, with intersections found
const SNAP = 1.2;
const nodes = [], nodeKey = new Map();
function node(p) {
  const k = `${Math.round(p[0] / SNAP)},${Math.round(p[1] / SNAP)}`;
  for (const dx of [-1, 0, 1]) for (const dz of [-1, 0, 1]) { const kk = `${Math.round(p[0] / SNAP) + dx},${Math.round(p[1] / SNAP) + dz}`; const n = nodeKey.get(kk); if (n != null && Math.hypot(nodes[n][0] - p[0], nodes[n][1] - p[1]) < SNAP) return n; }
  nodes.push([p[0], p[1]]); nodeKey.set(k, nodes.length - 1); return nodes.length - 1;
}
let segs = [];
const RH = [HALF_X + 30, HALF_Z + 30];
for (const r of feats.road) {
  const pts = r.ll.map(local);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (!inRect(a, ...RH) && !inRect(b, ...RH)) continue;
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.2) continue;
    segs.push({ a, b, cls: r.cls, w: r.w, oneway: r.oneway });
  }
}
// roads beyond the driving area, drawn only (the skyline's streets)
const vroads = [];
for (const r of feats.road) {
  if (r.cls === "service") continue;
  const pts = r.ll.map(local);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if ((inRect(a, ...RH) && inRect(b, ...RH)) || (!inRect(a, SKY, SKY) && !inRect(b, SKY, SKY))) continue;
    vroads.push([q(a[0]), q(a[1]), q(b[0]), q(b[1]), CLS0.indexOf(r.cls)]);
  }
}
// split segments where they cross each other (tile data doesn't always keep the shared node)
function cross(p, p2, q1, q2) {
  const r = [p2[0] - p[0], p2[1] - p[1]], s = [q2[0] - q1[0], q2[1] - q1[1]], d = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(d) < 1e-9) return null;
  const t = ((q1[0] - p[0]) * s[1] - (q1[1] - p[1]) * s[0]) / d, u = ((q1[0] - p[0]) * r[1] - (q1[1] - p[1]) * r[0]) / d;
  return t > 0.02 && t < 0.98 && u > -0.02 && u < 1.02 ? t : null;
}
{
  const cuts = segs.map(() => []);
  for (let i = 0; i < segs.length; i++) for (let j = 0; j < segs.length; j++) {
    if (i === j) continue;
    const A = segs[i], B = segs[j];
    if (Math.max(A.a[0], A.b[0]) < Math.min(B.a[0], B.b[0]) - 1 || Math.min(A.a[0], A.b[0]) > Math.max(B.a[0], B.b[0]) + 1 || Math.max(A.a[1], A.b[1]) < Math.min(B.a[1], B.b[1]) - 1 || Math.min(A.a[1], A.b[1]) > Math.max(B.a[1], B.b[1]) + 1) continue;
    const t = cross(A.a, A.b, B.a, B.b); if (t != null) cuts[i].push(t);
  }
  const out = [];
  segs.forEach((s, i) => {
    const ts = [0, ...cuts[i].sort((a, b) => a - b), 1];
    for (let k = 0; k < ts.length - 1; k++) {
      if (ts[k + 1] - ts[k] < 1e-6) continue;
      const pa = [s.a[0] + (s.b[0] - s.a[0]) * ts[k], s.a[1] + (s.b[1] - s.a[1]) * ts[k]], pb = [s.a[0] + (s.b[0] - s.a[0]) * ts[k + 1], s.a[1] + (s.b[1] - s.a[1]) * ts[k + 1]];
      out.push({ ...s, a: pa, b: pb });
    }
  });
  segs = out;
}
const edges = [], seen = new Set();
const CLS = Object.keys(DRIVE);
for (const s of segs) {
  const a = node(s.a), b = node(s.b); if (a === b) continue;
  const k = a < b ? `${a}-${b}` : `${b}-${a}`; if (seen.has(k)) continue; seen.add(k);
  edges.push({ a, b, cls: s.cls, w: s.w, oneway: s.oneway, name: -1 });
}
console.log("segments", segs.length, "edges before pruning", edges.length, "nodes", nodes.length);
// keep the biggest connected network (stray service roads and bits cut off at the edge go)
{
  const adj = nodes.map(() => []); edges.forEach((e, i) => { adj[e.a].push(i); adj[e.b].push(i); });
  const comp = new Array(nodes.length).fill(-1); let best = -1, bestN = 0;
  for (let s = 0; s < nodes.length; s++) {
    if (comp[s] !== -1 || !adj[s].length) continue;
    const st = [s]; comp[s] = s; let n = 0;
    while (st.length) { const v = st.pop(); n++; for (const ei of adj[v]) { const e = edges[ei], w = e.a === v ? e.b : e.a; if (comp[w] === -1) { comp[w] = s; st.push(w); } } }
    if (n > bestN) { bestN = n; best = s; }
    if (n > 20) console.log("component", n);
  }
  for (let i = edges.length - 1; i >= 0; i--) if (comp[edges[i].a] !== best) edges.splice(i, 1);
}
// street names: the name line nearest each edge, running the same way
const names = [], nameIdx = new Map();
const nameSegs = [];
for (const n of feats.name) { const pts = n.ll.map(local); for (let i = 0; i < pts.length - 1; i++) nameSegs.push({ a: pts[i], b: pts[i + 1], name: n.name }); }
function segDist(p, a, b) { const dx = b[0] - a[0], dz = b[1] - a[1], L = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz); }
for (const e of edges) {
  const A = nodes[e.a], B = nodes[e.b], mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], dir = Math.atan2(B[1] - A[1], B[0] - A[0]);
  let best = null, bd = 8;
  for (const s of nameSegs) {
    const d = segDist(mid, s.a, s.b); if (d >= bd) continue;
    const sd = Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]); if (Math.abs(Math.sin(sd - dir)) > 0.35) continue;
    bd = d; best = s.name;
  }
  if (best) { if (!nameIdx.has(best)) { nameIdx.set(best, names.length); names.push(best); } e.name = nameIdx.get(best); }
}
// renumber the nodes that are left
const used = [...new Set(edges.flatMap((e) => [e.a, e.b]))], remap = new Map(used.map((n, i) => [n, i]));
const N = used.map((n) => nodes[n]);
edges.forEach((e) => { e.a = remap.get(e.a); e.b = remap.get(e.b); });
console.log("road nodes", N.length, "edges", edges.length, "named", edges.filter((e) => e.name >= 0).length, "names", names.length);

// ---------------------------------------------------------------- filling the blocks where the map has no outlines
const seeded = (seed) => () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const rnd = seeded(20261023);
const R = (a, b) => a + rnd() * (b - a);
const KIND = { real: 0, shop: 1, house: 2, warehouse: 3 };
if (CFG.fill) {
  const zones = feats.zone.map((z) => { const pts = z.ll.map(local); return { cls: z.cls, pts, box: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))] }; });
  const zoneAt = (x, z) => { for (const zn of zones) if (x >= zn.box[0] && x <= zn.box[2] && z >= zn.box[1] && z <= zn.box[3] && pointIn(zn.pts, x, z)) return zn.cls; return "residential"; };
  const blockers = [...feats.water, ...feats.green].map((ll) => { const pts = ll.map(local); return { pts, box: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))] }; });
  const inBlocker = (x, z) => blockers.some((b) => x >= b.box[0] && x <= b.box[2] && z >= b.box[1] && z <= b.box[3] && pointIn(b.pts, x, z));
  // roads (all of them, drawn ones too) in a coarse grid, for keeping buildings off them
  const RC = 40, rgrid = new Map(), addR = (a, b, w) => { const x0 = Math.floor(Math.min(a[0], b[0]) / RC) - 1, x1 = Math.floor(Math.max(a[0], b[0]) / RC) + 1, z0 = Math.floor(Math.min(a[1], b[1]) / RC) - 1, z1 = Math.floor(Math.max(a[1], b[1]) / RC) + 1; for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) { const k = gx * 100003 + gz; if (!rgrid.has(k)) rgrid.set(k, []); rgrid.get(k).push({ a, b, w }); } };
  for (const e of edges) addR(N[e.a], N[e.b], e.w);
  for (let i = 0; i < vroads.length; i++) { const [ax, az, bx, bz, c] = vroads[i]; addR([ax / 10, az / 10], [bx / 10, bz / 10], DRIVE[CLS0[c]] || 9); }
  const roadClear = (x, z, m) => { const l = rgrid.get(Math.floor(x / RC) * 100003 + Math.floor(z / RC)); if (!l) return true; for (const r of l) if (segDist([x, z], r.a, r.b) - r.w / 2 < m) return false; return true; };
  // buildings already placed, in a grid
  const BC = 30, bgrid = new Map();
  const addB = (b) => { const xs = b.pts.map((p) => p[0]), zs = b.pts.map((p) => p[1]); b.box = [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)]; for (let gx = Math.floor(b.box[0] / BC); gx <= Math.floor(b.box[2] / BC); gx++) for (let gz = Math.floor(b.box[1] / BC); gz <= Math.floor(b.box[3] / BC); gz++) { const k = gx * 100003 + gz; if (!bgrid.has(k)) bgrid.set(k, []); bgrid.get(k).push(b); } };
  buildings.forEach(addB);
  const overlaps = (pts) => {
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]), box = [Math.min(...xs) - 0.8, Math.min(...zs) - 0.8, Math.max(...xs) + 0.8, Math.max(...zs) + 0.8];
    for (let gx = Math.floor(box[0] / BC); gx <= Math.floor(box[2] / BC); gx++) for (let gz = Math.floor(box[1] / BC); gz <= Math.floor(box[3] / BC); gz++) for (const o of bgrid.get(gx * 100003 + gz) || []) {
      if (o.box[2] < box[0] || o.box[0] > box[2] || o.box[3] < box[1] || o.box[1] > box[3]) continue;
      if (pts.some((p) => pointIn(o.pts, p[0], p[1])) || o.pts.some((p) => pointIn(pts, p[0], p[1]))) return true;
      const c = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]; if (pointIn(o.pts, c[0], c[1])) return true;
    }
    return false;
  };
  const plaza = local(CFG.plaza);
  const HOUSE = ["#d9c8a9", "#b8c9c2", "#e3d3b5", "#c9a9a0", "#a9b9c9", "#e8e2d0", "#9fb39a", "#d6b99a", "#c7b7d0", "#e0c090"];
  const SHOP = ["#c8b8a0", "#b0a090", "#d0c0b0", "#a08070", "#c0c8c8", "#b89a7a", "#9a8a7a"];
  const SHED = ["#9aa0a6", "#b0b4b8", "#8a8f94", "#a8a090"];
  const FILL = Math.max(HALF_X, HALF_Z) + 160;
  let made = 0;
  for (const e of edges.concat(vroads.map((v) => ({ v })))) {
    let A, B, w, cls;
    if (e.v) { A = [e.v[0] / 10, e.v[1] / 10]; B = [e.v[2] / 10, e.v[3] / 10]; cls = CLS0[e.v[4]]; w = DRIVE[cls] || 9; } else { A = N[e.a]; B = N[e.b]; w = e.w; cls = e.cls; }
    if (cls === "motorway" || cls === "trunk" || cls === "service") continue;
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]); if (L < 18) continue;
    if (!inRect(A, FILL, FILL) && !inRect(B, FILL, FILL)) continue;
    const ux = (B[0] - A[0]) / L, uz = (B[1] - A[1]) / L, px = -uz, pz = ux;
    for (const side of [-1, 1]) {
      let sAt = 9;
      while (sAt < L - 9) {
        const fx = A[0] + ux * sAt + px * side * (w / 2 + 8), fz = A[1] + uz * sAt + pz * side * (w / 2 + 8);
        const zone = zoneAt(fx, fz), dd = Math.hypot(fx - plaza[0], fz - plaza[1]);
        const kind = zone === "industrial" ? "warehouse" : zone === "retail" || zone === "commercial" || dd < 260 ? "shop" : zone === "school" || zone === "hospital" ? "shop" : "house";
        const P = kind === "shop" ? { fw: R(9, 18), d: R(14, 26), back: R(0.2, 0.8), gap: R(0, 1.2), h: 4.5 + Math.floor(R(0, dd < 140 ? 4 : 2.6)) * 3.5 }
          : kind === "warehouse" ? { fw: R(20, 38), d: R(18, 32), back: R(4, 8), gap: R(4, 10), h: R(6, 9.5) }
            : { fw: R(8, 11), d: R(9, 13), back: R(5, 8), gap: R(3, 6), h: rnd() < 0.35 ? 6.2 : 3.4 };
        if (sAt + P.fw > L - 9) break;
        const off = w / 2 + 3.2 + P.back, cx = A[0] + ux * (sAt + P.fw / 2) + px * side * (off + P.d / 2), cz = A[1] + uz * (sAt + P.fw / 2) + pz * side * (off + P.d / 2);
        const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [cx + ux * (a * P.fw) / 2 + px * side * (b * P.d) / 2, cz + uz * (a * P.fw) / 2 + pz * side * (b * P.d) / 2]);
        const samples = [...pts, [cx, cz], ...pts.map((p, i) => [(p[0] + pts[(i + 1) % 4][0]) / 2, (p[1] + pts[(i + 1) % 4][1]) / 2])];
        const ok = inRect([cx, cz], FILL, FILL) && samples.every(([x, z]) => roadClear(x, z, 3) && !inBlocker(x, z)) && !overlaps(pts);
        if (!ok) { sAt += 3; continue; }
        if (area(pts) > 0) pts.reverse();
        const b = { pts, h: Math.round(P.h * 10) / 10, min: 0, colour: (kind === "house" ? HOUSE : kind === "shop" ? SHOP : SHED)[Math.floor(rnd() * 7.99) % (kind === "house" ? HOUSE.length : kind === "shop" ? SHOP.length : SHED.length)], c: [cx, cz], a: P.fw * P.d, core: inRect([cx, cz], HALF_X + 25, HALF_Z + 25), kind: KIND[kind] };
        buildings.push(b); addB(b); made++;
        sAt += P.fw + P.gap;
      }
    }
  }
  console.log("filled in", made, "buildings;", buildings.length, "in all");
}

// ---------------------------------------------------------------- parks, plazas, water, neighbourhoods
const poly = (list) => list.map((ll) => ll.map(local)).filter((p) => p.some((x) => inRect(x, SKY, SKY))).map((p) => p.flatMap(([x, z]) => [q(x), q(z)]));
const places = feats.place.map((p) => ({ name: p.name, p: local(p.ll), cls: p.cls })).filter((p) => inRect(p.p, 2500, 2500));
for (const [n, lng, lat] of CFG.places) places.unshift({ name: n, p: local([lng, lat]), cls: "rb" });
const uniqPlaces = []; for (const p of places) if (!uniqPlaces.some((u) => u.name === p.name)) uniqPlaces.push(p);
console.log("places", uniqPlaces.map((p) => p.name).join(", "));

// ---------------------------------------------------------------- the lots: one real building per RB lot id
// The board keeps its layout (empire_defs.js LAYOUT): cheap round the edge, dear by the plaza; the plaza is Times Square.
const GRID = 6, LAYOUT = [0, 0, 1, 1, 2, 2, 0, 7, 6, 6, 7, 2, 1, 5, -1, -1, 6, 3, 1, 5, -1, -1, 7, 3, 0, 5, 4, 4, 7, 3, 2, 4, 5, 4, 6, 3];
const edgeSegs = edges.filter((e) => e.cls !== "service").map((e) => ({ a: N[e.a], b: N[e.b], w: e.w }));
function roadGap(b) { // metres from the building's wall to the edge of the nearest road, and the nearest road point
  let best = Infinity, at = null, seg = null;
  for (const p of b.pts) for (const s of edgeSegs) {
    const d = segDist(p, s.a, s.b) - s.w / 2;
    if (d < best) { best = d; seg = s; const dx = s.b[0] - s.a[0], dz = s.b[1] - s.a[1], L = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((p[0] - s.a[0]) * dx + (p[1] - s.a[1]) * dz) / L)); at = [s.a[0] + t * dx, s.a[1] + t * dz]; }
  }
  return { gap: best, at, seg };
}
const lots = {}, taken = new Set();
const MX = HALF_X - 90, MZ = HALF_Z - 90;
const core = buildings.filter((b) => b.core);
LAYOUT.forEach((d, i) => {
  if (d < 0) return;
  // the board's grid centred on RB Plaza (kept inside the drivable city), so the dear lots are round it
  const gx = i % GRID, gz = Math.floor(i / GRID), pc = local(CFG.plaza), cx0 = Math.max(-HALF_X + MX, Math.min(HALF_X - MX, pc[0])) * 0 + pc[0], cz0 = pc[1];
  const target = [Math.max(-HALF_X + 30, Math.min(HALF_X - 30, cx0 - MX + (gx + 0.5) * ((2 * MX) / GRID))), Math.max(-HALF_Z + 30, Math.min(HALF_Z - 30, cz0 - MZ + (gz + 0.5) * ((2 * MZ) / GRID)))];
  // the building nearest the spot (further out if the spot is in the water or a park)
  const cands = core.filter((b) => !taken.has(b) && b.a > CFG.lotMinA && b.a < 4500 && b.h >= CFG.lotMinH && b.h <= 120 && Math.hypot(b.c[0] - target[0], b.c[1] - target[1]) < 420)
    .map((b) => ({ b, d: Math.hypot(b.c[0] - target[0], b.c[1] - target[1]) })).sort((x, y) => x.d - y.d);
  for (const { b } of cands) {
    const r = roadGap(b); if (r.gap > CFG.lotGap) continue;
    taken.add(b);
    // the door: on the road edge in front of the building, where a car stops
    const dir = [r.at[0] - b.c[0], r.at[1] - b.c[1]], L = Math.hypot(...dir) || 1;
    lots[i] = { b: buildings.indexOf(b), door: [Math.round(r.at[0] * 10) / 10, Math.round(r.at[1] * 10) / 10], face: Math.round(Math.atan2(dir[0] / L, dir[1] / L) * 1000) / 1000 };
    break;
  }
  if (!lots[i]) throw new Error(`no building for lot ${i} near ${target}`);
});
console.log("lots", Object.keys(lots).length);

// ---------------------------------------------------------------- RB HQ and the screens round RB Plaza
// HQ: the tallest building near RB Plaza (in Manhattan, One Times Square). Screens: on the walls that face the plaza.
const centre = local(CFG.plaza);
const hq = core.filter((b) => Math.hypot(b.c[0] - centre[0], b.c[1] - centre[1]) < 320).sort((x, y) => y.h - x.h)[0];
const boards = [];
// a wall with street or plaza in front of it (Manhattan buildings share party walls)
const open = (x, z) => !core.some((o) => x >= Math.min(...o.pts.map((p) => p[0])) && x <= Math.max(...o.pts.map((p) => p[0])) && z >= Math.min(...o.pts.map((p) => p[1])) && z <= Math.max(...o.pts.map((p) => p[1])) && pointIn(o.pts, x, z));
for (const b of core) {
  const dc = Math.hypot(b.c[0] - centre[0], b.c[1] - centre[1]); if (dc > CFG.board.radius || b.h < CFG.board.minH || taken.has(b) || b === hq) continue;
  // the wall that faces the square most squarely
  let best = null;
  for (let i = 0; i < b.pts.length; i++) {
    const p = b.pts[i], p2 = b.pts[(i + 1) % b.pts.length], len = Math.hypot(p2[0] - p[0], p2[1] - p[1]); if (len < 12) continue;
    const mid = [(p[0] + p2[0]) / 2, (p[1] + p2[1]) / 2]; let nx = (p2[1] - p[1]) / len, nz = -(p2[0] - p[0]) / len;
    if (pointIn(b.pts, mid[0] + nx * 0.5, mid[1] + nz * 0.5)) { nx = -nx; nz = -nz; } // outward
    const to = [centre[0] - mid[0], centre[1] - mid[1]], tl = Math.hypot(...to) || 1, dot = (nx * to[0] + nz * to[1]) / tl;
    if (dot > 0.55 && (!best || dot * len > best.s) && open(mid[0] + nx * 2, mid[1] + nz * 2) && open(mid[0] + nx * 9, mid[1] + nz * 9)) best = { s: dot * len, mid, nx, nz, len };
  }
  if (best && boards.length < 400) { const bh = Math.round(Math.min(b.h * 0.45, CFG.board.h)), by = Math.round(Math.max(1.5, Math.min(b.h - bh - 0.5, CFG.board.y + ((boards.length * 37) % 5)))); boards.push([dc, q(best.mid[0] + best.nx * 0.4), q(best.mid[1] + best.nz * 0.4), Math.round(Math.atan2(best.nx, best.nz) * 1000) / 1000, Math.round(Math.min(best.len * 0.8, CFG.board.w)), bh, by]); }
}
boards.sort((a, b) => a[0] - b[0]); boards.splice(CFG.board.max); boards.forEach((x) => x.shift());
console.log("billboards", boards.length, "hq height", hq && hq.h);

// the avenue (along z) and street (along x) lines, for the race tracks
const lines = (along) => { const v = []; edges.forEach((e) => { const A = N[e.a], B = N[e.b], dx = B[0] - A[0], dz = B[1] - A[1], L = Math.hypot(dx, dz); if (L < 30) return; if (along === "z" ? Math.abs(dz) > 4 * Math.abs(dx) : Math.abs(dx) > 4 * Math.abs(dz)) v.push([along === "z" ? (A[0] + B[0]) / 2 : (A[1] + B[1]) / 2, L, names[e.name] || "?"]); }); v.sort((a, b) => a[0] - b[0]); const out = []; for (const [c, L, n] of v) { const g = out.find((o) => Math.abs(o.c - c) < 12); if (g) { g.L += L; g.n[n] = (g.n[n] || 0) + L; } else out.push({ c, L, n: { [n]: L } }); } return out.filter((o) => o.L > 150).map((o) => [Math.round(o.c), Math.round(o.L), Object.entries(o.n).sort((a, b) => b[1] - a[1])[0][0]]); };
const AV = lines("z"), ST = lines("x");
console.log("avenues", JSON.stringify(AV)); console.log("streets", JSON.stringify(ST));
// ---------------------------------------------------------------- race tracks on real streets
// The intersection nearest each target point, and a route between them along the roads (the checkpoints are the turns).
const adj = N.map(() => []); edges.forEach((e) => { const L = Math.hypot(N[e.a][0] - N[e.b][0], N[e.a][1] - N[e.b][1]); adj[e.a].push([e.b, L]); adj[e.b].push([e.a, L]); });
const nearNode = (p) => { let b = 0, bd = Infinity; N.forEach((n, i) => { const d = Math.hypot(n[0] - p[0], n[1] - p[1]); if (d < bd && adj[i].length >= 3) { bd = d; b = i; } }); return b; };
function route(a, b) { // Dijkstra
  const dist = new Map([[a, 0]]), prev = new Map(), open = [[0, a]];
  while (open.length) { open.sort((x, y) => x[0] - y[0]); const [d, v] = open.shift(); if (v === b) break; if (d > dist.get(v)) continue; for (const [w, L] of adj[v]) { const nd = d + L; if (nd < (dist.get(w) ?? Infinity)) { dist.set(w, nd); prev.set(w, v); open.push([nd, w]); } } }
  const path = [b]; while (path[0] !== a) { const p = prev.get(path[0]); if (p == null) throw new Error("no route"); path.unshift(p); }
  return { path, d: dist.get(b) };
}
function track(key, name, corners, laps = 1, open = false) { // open: a sprint from the first corner to the last
  const ns = corners.map((c) => nearNode(c));
  let cps = [], dist = 0;
  for (let lap = 0; lap < laps; lap++) for (let i = 0; i < ns.length - (open ? 1 : 0); i++) {
    const r = route(ns[i], ns[(i + 1) % ns.length]); dist += r.d;
    cps.push(N[ns[(i + 1) % ns.length]].map((v) => Math.round(v * 10) / 10));
  }
  const start0 = N[ns[0]], first = N[ns[1]], h = Math.atan2(first[0] - start0[0], first[1] - start0[1]);
  const start = [Math.round((start0[0] + Math.sin(h) * 12) * 10) / 10, Math.round((start0[1] + Math.cos(h) * 12) * 10) / 10];
  return { key, name, par: Math.round(dist / 21 + corners.length * laps * 2), start, cps, m: Math.round(dist) };
}
// Corners where the city's long straight roads cross: N-S lines (along z) and E-W lines (along x) that run most of the
// way across, picked by where they fall (0 = west / north edge, 1 = east / south edge).
const long = (ls, span) => { for (const f of [0.6, 0.45, 0.3]) { const l = ls.filter((x) => x[1] > f * span); if (l.length >= 4) return l; } return ls; };
const NS = long(AV, 2 * HALF_Z), EW = long(ST, 2 * HALF_X);
const ns = (f) => NS[Math.round(f * (NS.length - 1))][0], ew = (f) => EW[Math.round(f * (EW.length - 1))][0];
const P = (fx, fz) => [ns(fx), ew(fz)];
const K = CFG.key, T = CFG.tracks;
const TR = [
  track(K + "loop", T.loop, [P(0.35, 0.55), P(0.35, 0.8), P(0.65, 0.8), P(0.65, 0.55)]),
  track(K + "zig", T.zig, [P(0, 0), P(0, 0.2), P(0.33, 0.2), P(0.33, 0.45), P(0.66, 0.45), P(0.66, 0.7), P(1, 0.7)], 1, true),
  track(K + "ring", T.ring, [P(0, 0), P(1, 0), P(1, 1), P(0, 1)]),
  track(K + "gp", T.gp, [P(0.15, 0.2), P(0.85, 0.2), P(0.85, 0.8), P(0.15, 0.8)], 2),
];
for (const t of TR) console.log("track", t.key, t.m + " m", "par", t.par, "cps", t.cps.length);

// ---------------------------------------------------------------- write it out
const pick = (b) => [b.h, b.min, b.colour || "", (b.core ? 1 : 0) | ((b.kind || 0) << 1), ...b.pts.flatMap(([x, z]) => [q(x), q(z)])];
// where the car starts: on the drivable road nearest RB Plaza, pointing along it
const startEdge = edges.filter((e) => e.cls !== "service").map((e) => ({ e, d: segDist(centre, N[e.a], N[e.b]) })).sort((a, b) => a.d - b.d)[0].e;
const sA = N[startEdge.a], sB = N[startEdge.b], sMid = [(sA[0] + sB[0]) / 2, (sA[1] + sB[1]) / 2];
const START = [Math.round(sMid[0] * 10) / 10, Math.round(sMid[1] * 10) / 10, Math.round(Math.atan2(sB[0] - sA[0], sB[1] - sA[1]) * 1000) / 1000];
const data = {
  v: 2, name: CFG.name, short: CFG.short, plazaName: CFG.plazaName, ground: CFG.ground, start: START, plaza: [Math.round(centre[0]), Math.round(centre[1])],
  attribution: "© OpenStreetMap contributors (ODbL) · © OpenMapTiles · OpenFreeMap",
  origin: ORIGIN, kx: KX, kz: KZ, rot: Math.round(ROT * 1e6) / 1e6, half: [HALF_X, HALF_Z],
  buildings: buildings.map(pick),
  nodes: N.flatMap(([x, z]) => [q(x), q(z)]),
  edges: edges.flatMap((e) => [e.a, e.b, CLS.indexOf(e.cls), e.oneway, e.name]),
  vroads: vroads.flat(),
  classes: CLS, widths: CLS.map((c) => DRIVE[c]), names,
  green: poly(feats.green), plazas: poly(feats.plaza), water: poly(feats.water),
  places: uniqPlaces.map((p) => [p.name, q(p.p[0]), q(p.p[1])]),
  lots, hq: hq ? buildings.indexOf(hq) : -1, boards,
};
const json = JSON.stringify(data);
writeFileSync(OUT, `// RB World's city: ${CFG.name}, baked from OpenStreetMap by rb-tools/bake_city.mjs${CFG.fill ? " (blocks without\n// outlines in OpenStreetMap filled with made-up buildings that fit the area)" : ""}.
// Map data © OpenStreetMap contributors, available under the Open Database License (ODbL 1.0,
// https://opendatacommons.org/licenses/odbl/); this file is a derived database and is likewise under the ODbL.
// Tiles: OpenFreeMap (https://openfreemap.org), OpenMapTiles schema © OpenMapTiles (CC-BY 4.0).
// Lengths are decimetres in a local frame (x east-ish, z south-ish, along the street grid); see rb-tools/bake_city.mjs.
export default ${json};
`);
console.log("wrote", OUT, (json.length / 1024).toFixed(0) + " KB");
// the race tracks go into empire_defs.js too, for the server's checks
const defs = join(ROOT, "rb-site-updates/src/world/empire_defs.js");
const s = readFileSync(defs, "utf8"), A = "// BEGIN BAKED TRACKS (rb-tools/bake_city.mjs)\n", B = "// END BAKED TRACKS\n";
if (s.includes(A)) {
  const body = "export const RACE_TRACKS = [\n" + TR.map((t) => `  ${JSON.stringify({ key: t.key, name: t.name, par: t.par, start: t.start, cps: t.cps })},`).join("\n") + "\n];\n";
  writeFileSync(defs, s.slice(0, s.indexOf(A) + A.length) + body + s.slice(s.indexOf(B)));
  console.log("tracks written to empire_defs.js");
} else console.log("empire_defs.js has no BAKED TRACKS markers; tracks not written");
