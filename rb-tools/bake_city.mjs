// Bakes RB World's city from real map data: OpenStreetMap, as vector tiles from OpenFreeMap (OpenMapTiles schema).
//   node rb-tools/bake_city.mjs <tiles dir> [out file]
// The tiles dir holds z14 .pbf tiles named 14_<x>_<y>.pbf covering the area (rb-tools/bake_city.mjs --fetch <dir>
// downloads them). Writes rb-site-updates/src/world/city_data.js: buildings (footprint, height, colour), the road
// network (a graph with classes, widths, one-way and street names), parks and plazas, neighbourhood names, the lots
// (real buildings, one per RB lot id), the RB HQ and Times Square billboard spots, and the race tracks, which it also
// writes into empire_defs.js between the BAKED TRACKS markers (the server checks races against them).
// Everything is in metres in a local frame: x east-ish, z south-ish, turned so Manhattan's avenues run along z.
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
// Times Square, between 7th Avenue and Broadway at 45th Street. The drivable city is ±HALF_X across the avenues
// (about 9th to 5th Avenue) and ±HALF_Z along them (about 38th to 52nd Street); buildings out to ±SKY are the skyline.
const ORIGIN = [-73.98545, 40.75790];
const HALF_X = 470, HALF_Z = 600, SKY = 950;
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
const feats = { building: [], road: [], name: [], green: [], plaza: [], water: [], place: [] };
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
    if (ft.type !== 3 || !(c === "grass" || c === "park" || s === "park" || s === "garden" || c === "playground")) return;
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
  if (!core && b.h < 32) continue; // the skyline beyond the streets: only the taller ones
  if (area(pts) > 0) pts.reverse(); // one winding for all (counter-clockwise seen from above, with z south)
  buildings.push({ pts, h: Math.max(3, Math.min(480, b.h)), min: Math.max(0, b.min), colour: b.colour, c, a, core });
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

// ---------------------------------------------------------------- parks, plazas, water, neighbourhoods
const poly = (list) => list.map((ll) => ll.map(local)).filter((p) => p.some((x) => inRect(x, SKY, SKY))).map((p) => p.flatMap(([x, z]) => [q(x), q(z)]));
const places = feats.place.map((p) => ({ name: p.name, p: local(p.ll), cls: p.cls })).filter((p) => inRect(p.p, 2500, 2500));
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
const MX = HALF_X - 60, MZ = HALF_Z - 60;
const core = buildings.filter((b) => b.core);
LAYOUT.forEach((d, i) => {
  if (d < 0) return;
  const gx = i % GRID, gz = Math.floor(i / GRID), target = [-MX + (gx + 0.5) * ((2 * MX) / GRID), -MZ + (gz + 0.5) * ((2 * MZ) / GRID)];
  const cands = core.filter((b) => !taken.has(b) && b.a > 250 && b.a < 4500 && b.h >= 8 && b.h <= 120 && Math.hypot(b.c[0] - target[0], b.c[1] - target[1]) < 120)
    .map((b) => ({ b, d: Math.hypot(b.c[0] - target[0], b.c[1] - target[1]) })).sort((x, y) => x.d - y.d);
  for (const { b } of cands) {
    const r = roadGap(b); if (r.gap > 7) continue;
    taken.add(b);
    // the door: on the road edge in front of the building, where a car stops
    const dir = [r.at[0] - b.c[0], r.at[1] - b.c[1]], L = Math.hypot(...dir) || 1;
    lots[i] = { b: buildings.indexOf(b), door: [Math.round(r.at[0] * 10) / 10, Math.round(r.at[1] * 10) / 10], face: Math.round(Math.atan2(dir[0] / L, dir[1] / L) * 1000) / 1000 };
    break;
  }
  if (!lots[i]) throw new Error(`no building for lot ${i} near ${target}`);
});
console.log("lots", Object.keys(lots).length);

// ---------------------------------------------------------------- RB HQ (One Times Square) and the Times Square billboards
const TSQ = local([-73.98615, 40.75680]); // the south end of Times Square, by One Times Square
const hq = core.filter((b) => b.h > 60).sort((x, y) => Math.hypot(x.c[0] - TSQ[0], x.c[1] - TSQ[1]) - Math.hypot(y.c[0] - TSQ[0], y.c[1] - TSQ[1]))[0];
const centre = local([-73.98550, 40.75800]);
const boards = [];
// a wall with street or plaza in front of it (Manhattan buildings share party walls)
const open = (x, z) => !core.some((o) => x >= Math.min(...o.pts.map((p) => p[0])) && x <= Math.max(...o.pts.map((p) => p[0])) && z >= Math.min(...o.pts.map((p) => p[1])) && z <= Math.max(...o.pts.map((p) => p[1])) && pointIn(o.pts, x, z));
for (const b of core) {
  const dc = Math.hypot(b.c[0] - centre[0], b.c[1] - centre[1]); if (dc > 230 || b.h < 22 || taken.has(b)) continue;
  // the wall that faces the square most squarely
  let best = null;
  for (let i = 0; i < b.pts.length; i++) {
    const p = b.pts[i], p2 = b.pts[(i + 1) % b.pts.length], len = Math.hypot(p2[0] - p[0], p2[1] - p[1]); if (len < 12) continue;
    const mid = [(p[0] + p2[0]) / 2, (p[1] + p2[1]) / 2]; let nx = (p2[1] - p[1]) / len, nz = -(p2[0] - p[0]) / len;
    if (pointIn(b.pts, mid[0] + nx * 0.5, mid[1] + nz * 0.5)) { nx = -nx; nz = -nz; } // outward
    const to = [centre[0] - mid[0], centre[1] - mid[1]], tl = Math.hypot(...to) || 1, dot = (nx * to[0] + nz * to[1]) / tl;
    if (dot > 0.55 && (!best || dot * len > best.s) && open(mid[0] + nx * 2, mid[1] + nz * 2) && open(mid[0] + nx * 9, mid[1] + nz * 9)) best = { s: dot * len, mid, nx, nz, len };
  }
  if (best && boards.length < 400) boards.push([dc, q(best.mid[0] + best.nx * 0.4), q(best.mid[1] + best.nz * 0.4), Math.round(Math.atan2(best.nx, best.nz) * 1000) / 1000, Math.round(Math.min(best.len * 0.8, 26)), Math.round(Math.min(b.h * 0.45, 22)), Math.round(Math.min(b.h - 4, 5 + ((boards.length * 37) % 5)))]);
}
boards.sort((a, b) => a[0] - b[0]); boards.splice(36); boards.forEach((x) => x.shift());
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
// corners named by real avenue and street ("7th Avenue" x "West 42nd Street")
const at = (ave, st) => { const a = AV.find((x) => x[2] === ave), b = ST.find((x) => x[2] === st); if (!a || !b) throw new Error(`no ${ave} / ${st}`); return [a[0], b[0]]; };
const A6 = "6th Avenue", A7 = "7th Avenue", A8 = "8th Avenue", S = (n) => `West ${n}th Street`.replace("1th", n === 41 ? "1st" : "1th").replace("2th", n === 42 || n === 52 ? "2nd" : "2th").replace("3th", n === 43 ? "3rd" : "3th");
const TR = [
  track("loop", "Times Square Loop", [at(A7, S(42)), at(A7, S(47)), at(A6, S(47)), at(A6, S(42))]),
  track("zig", "Theater District Zigzag", [at(A8, S(52)), at(A8, S(48)), at(A7, S(48)), at(A7, S(44)), at(A6, S(44)), at(A6, S(40))], 1, true),
  track("ring", "Midtown Ring", [at(A8, S(52)), at(A6, S(52)), at(A6, S(38)), at(A8, S(38))]),
  track("gp", "RB Grand Prix (2 laps)", [at(A8, S(48)), at(A6, S(48)), at(A6, S(42)), at(A8, S(42))], 2),
];
for (const t of TR) console.log("track", t.key, t.m + " m", "par", t.par, "cps", t.cps.length);

// ---------------------------------------------------------------- write it out
const pick = (b) => [b.h, b.min, b.colour || "", b.core ? 1 : 0, ...b.pts.flatMap(([x, z]) => [q(x), q(z)])];
const data = {
  v: 1,
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
writeFileSync(OUT, `// RB World's city: Midtown Manhattan round Times Square, baked from OpenStreetMap by rb-tools/bake_city.mjs.
// Map data © OpenStreetMap contributors, available under the Open Database License (ODbL 1.0,
// https://opendatacommons.org/licenses/odbl/); this file is a derived database and is likewise under the ODbL.
// Tiles: OpenFreeMap (https://openfreemap.org), OpenMapTiles schema © OpenMapTiles (CC-BY 4.0).
// Lengths are decimetres in a local frame (x across the avenues, z along them); see rb-tools/bake_city.mjs.
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
