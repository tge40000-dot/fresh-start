// Builds one map tile of the Bay Area for stream.js, off the main thread: fetches the OpenFreeMap vector tile
// (OpenStreetMap data, OpenMapTiles schema, zoom 14, about 1.9 km across here), reads it (mvt.js) and turns it into
// ready-to-draw arrays in the game's own frame (the same projection as city.js, so it lines up with downtown Vallejo):
//   roads (ribbons by class; bridges a little higher), water, parks and buildings (walls and roofs from their real
//   heights), plus what the game needs to know: road segments (for the radar and for driving over water on bridges),
//   street names, a water mask (where you can't drive), building footprints (collision), place names and petrol
//   stations. Everything inside the baked city (downtown Vallejo, drawn by city.js) is left out, apart from stations.
// Positions come relative to the tile's centre (cx, cz) so they stay precise far from Vallejo.
import { decode } from "./mvt.js";
import earcut from "./earcut.js";

const W = { motorway: 15, trunk: 13, primary: 11, secondary: 10, tertiary: 9, minor: 7.5, service: 5, track: 4, raceway: 10, busway: 7 };
const COL = { motorway: [0.2, 0.21, 0.23], trunk: [0.22, 0.23, 0.25], primary: [0.25, 0.26, 0.28], bridge: [0.33, 0.34, 0.36] };
const MASK = 512; // water mask cells per side (about 3.8 m each)
const PALETTE = [[0.62, 0.6, 0.56], [0.7, 0.67, 0.6], [0.55, 0.56, 0.58], [0.66, 0.62, 0.55], [0.5, 0.52, 0.55], [0.74, 0.72, 0.68], [0.58, 0.53, 0.48]];

self.onmessage = async (ev) => {
  const q = ev.data;
  try {
    const res = await fetch(q.url);
    if (!res.ok) throw new Error("tile " + res.status);
    const out = build(decode(new Uint8Array(await res.arrayBuffer())), q);
    self.postMessage({ id: q.id, ok: true, ...out.data }, out.transfer);
  } catch (e) { self.postMessage({ id: q.id, ok: false, error: String(e && e.message || e) }); }
};

function build(L, q) {
  const { z, x, y, frame, core, lod } = q, N = 2 ** z;
  const cosR = Math.cos(frame.rot), sinR = Math.sin(frame.rot);
  // tile units -> the game's frame
  const local = (tx, ty, ext) => {
    const lng = ((x + tx / ext) / N) * 360 - 180, n = Math.PI - (2 * Math.PI * (y + ty / ext)) / N, lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    const lx = (lng - frame.origin[0]) * frame.kx, lz = -(lat - frame.origin[1]) * frame.kz;
    return [lx * cosR - lz * sinR, lx * sinR + lz * cosR];
  };
  const [cx, cz] = local(2048, 2048, 4096);
  // the baked city draws its own roads out to its edge and its skyline a little further: leave those out
  const inCore = (px, pz) => Math.abs(px) < core.road[0] && Math.abs(pz) < core.road[1], inSkyline = (px, pz) => Math.abs(px) < core.bld[0] && Math.abs(pz) < core.bld[1];
  // metres per tile unit (for road widths in the mask)
  const [ax, az] = local(0, 2048, 4096), [bx, bz] = local(4096, 2048, 4096), mPerUnit = Math.hypot(bx - ax, bz - az) / 4096;

  // ---------------------------------------------------------------- roads
  const road = { p: [], c: [] }, segs = [], T = L.transportation;
  const mask = new Uint8Array(MASK * MASK);
  if (T) for (const f of T.features) {
    const cls = f.props.class, w = W[cls]; if (!w || f.type !== 2 || f.props.brunnel === "tunnel") continue;
    const bridge = f.props.brunnel === "bridge", col = bridge ? COL.bridge : COL[cls] || [0.27, 0.28, 0.3], yy = bridge ? 0.07 : cls === "motorway" || cls === "trunk" ? 0.045 : 0.035;
    for (const line of f.geom) {
      let prev = null;
      for (const [tx, ty] of line) {
        const p = local(tx, ty, T.extent);
        if (prev) {
          const mx = (prev[0] + p[0]) / 2, mz = (prev[1] + p[1]) / 2;
          if (!inCore(mx, mz)) { ribbon(road, prev, p, w, yy, col, cx, cz); segs.push(prev[0], prev[1], p[0], p[1], w, (bridge ? 1 : 0) | (cls === "motorway" || cls === "trunk" ? 2 : 0)); }
        }
        prev = p;
      }
    }
  }
  // street names
  const names = [], nameSegs = [], nameIdx = [], NL = L.transportation_name;
  if (NL) for (const f of NL.features) {
    const nm = f.props.name || f.props["name:en"]; if (!nm || f.type !== 2) continue;
    let k = names.indexOf(nm); if (k < 0) { k = names.length; names.push(nm); }
    for (const line of f.geom) for (let i = 1; i < line.length; i++) { const a = local(line[i - 1][0], line[i - 1][1], NL.extent), b = local(line[i][0], line[i][1], NL.extent); nameSegs.push(a[0], a[1], b[0], b[1]); nameIdx.push(k); }
  }

  // ---------------------------------------------------------------- water and parks
  const water = { p: [] }, park = { p: [] };
  const fillPolys = (layer, target, yy, test) => {
    if (!layer) return;
    for (const f of layer.features) {
      if (f.type !== 3 || (test && !test(f.props))) continue;
      for (const poly of polygons(f.geom)) {
        const flat = [], holes = [];
        for (let r = 0; r < poly.length; r++) { if (r) holes.push(flat.length / 2); for (const [tx, ty] of poly[r]) { const p = local(tx, ty, layer.extent); flat.push(p[0] - cx, p[1] - cz); } }
        const tri = earcut(flat, holes);
        for (const i of tri) target.p.push(flat[i * 2], yy, flat[i * 2 + 1]);
        if (target === water) rasterize(mask, poly, layer.extent);
      }
    }
  };
  fillPolys(L.water, water, 0.008);
  fillPolys(L.park, park, 0.02);
  fillPolys(L.landcover, park, 0.018, (p) => p.class === "grass" || p.class === "wood");
  // roads (bridges, causeways) cut through the water: you can drive on them
  clearAlong(mask, L.transportation, mPerUnit);

  // ---------------------------------------------------------------- buildings
  const bld = { p: [], n: [], c: [] }, foot = [], footOff = [0], B = L.building;
  if (B) for (const f of B.features) {
    if (f.type !== 3) continue;
    const h = Math.max(3, Number(f.props.render_height) || 6), h0 = Math.max(0, Number(f.props.render_min_height) || 0);
    for (const poly of polygons(f.geom)) {
      const ring = poly[0].map(([tx, ty]) => local(tx, ty, B.extent));
      let mx = 0, mz = 0; for (const p of ring) { mx += p[0]; mz += p[1]; } mx /= ring.length; mz /= ring.length;
      if (inSkyline(mx, mz)) continue;
      const area = Math.abs(ringArea(ring)); if (lod === "low" && area < 30) continue;
      const col = PALETTE[Math.abs(Math.round(mx * 7 + mz * 13)) % PALETTE.length].map((v) => Math.min(1, v * (h > 40 ? 1.12 : 1)));
      // roof
      const flat = [], holes = [];
      for (let r = 0; r < poly.length; r++) { if (r) holes.push(flat.length / 2); for (const [tx, ty] of poly[r]) { const p = local(tx, ty, B.extent); flat.push(p[0] - cx, p[1] - cz); } }
      for (const i of earcut(flat, holes)) { bld.p.push(flat[i * 2], h, flat[i * 2 + 1]); bld.n.push(0, 1, 0); bld.c.push(col[0] * 0.8, col[1] * 0.8, col[2] * 0.8); }
      // walls
      for (const rr of poly) {
        const pts = rr.map(([tx, ty]) => local(tx, ty, B.extent));
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz); if (len < 0.01) continue;
          const nx = dz / len, nz = -dx / len, A = [a[0] - cx, a[1] - cz], Bp = [b[0] - cx, b[1] - cz];
          const v = [[A[0], h0, A[1]], [Bp[0], h0, Bp[1]], [Bp[0], h, Bp[1]], [A[0], h0, A[1]], [Bp[0], h, Bp[1]], [A[0], h, A[1]]];
          const shade = 0.85 + 0.15 * Math.abs(nx);
          for (const q of v) { bld.p.push(q[0], q[1], q[2]); bld.n.push(nx, 0, nz); bld.c.push(col[0] * shade, col[1] * shade, col[2] * shade); }
        }
      }
      if (h0 < 3) { for (const p of ring) foot.push(p[0], p[1]); footOff.push(foot.length / 2); }
    }
  }

  // ---------------------------------------------------------------- places and petrol stations
  const places = [], fuel = [];
  if (L.place) for (const f of L.place.features) {
    const nm = f.props.name || f.props["name:en"]; if (!nm || !f.geom[0]) continue;
    const p = local(f.geom[0][0][0], f.geom[0][0][1], L.place.extent);
    places.push({ name: nm, cls: f.props.class, x: p[0], z: p[1] });
  }
  if (L.poi) for (const f of L.poi.features) {
    if (f.props.class !== "fuel" || f.props.subclass !== "fuel" || !f.geom[0]) continue; // petrol, not EV chargers
    const p = local(f.geom[0][0][0], f.geom[0][0][1], L.poi.extent);
    fuel.push({ name: f.props.name || "Gas station", x: p[0], z: p[1] });
  }

  const F = (a) => new Float32Array(a);
  const data = {
    cx, cz, road: { p: F(road.p), c: F(road.c) }, water: { p: F(water.p) }, park: { p: F(park.p) }, bld: { p: F(bld.p), n: F(bld.n), c: F(bld.c) },
    segs: F(segs), names, nameSegs: F(nameSegs), nameIdx: new Uint16Array(nameIdx), mask, foot: F(foot), footOff: new Uint32Array(footOff), places, fuel,
  };
  const transfer = [data.road.p.buffer, data.road.c.buffer, data.water.p.buffer, data.park.p.buffer, data.bld.p.buffer, data.bld.n.buffer, data.bld.c.buffer, data.segs.buffer, data.nameSegs.buffer, data.nameIdx.buffer, data.mask.buffer, data.foot.buffer, data.footOff.buffer];
  return { data, transfer };
}

// a flat strip for a road segment (with its ends pushed out half a width, so corners close)
function ribbon(o, a, b, w, y, col, cx, cz) {
  const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz); if (len < 0.01) return;
  const ux = dx / len, uz = dz / len, px = -uz * (w / 2), pz = ux * (w / 2), e = w / 2;
  const A = [a[0] - ux * e - cx, a[1] - uz * e - cz], B = [b[0] + ux * e - cx, b[1] + uz * e - cz];
  const v = [[A[0] + px, A[1] + pz], [A[0] - px, A[1] - pz], [B[0] - px, B[1] - pz], [A[0] + px, A[1] + pz], [B[0] - px, B[1] - pz], [B[0] + px, B[1] + pz]];
  for (const [vx, vz] of v) { o.p.push(vx, y, vz); o.c.push(col[0], col[1], col[2]); }
}
function ringArea(r) { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return s / 2; }
// MVT polygons: an outer ring (positive area in tile units, y down) followed by its holes
function polygons(rings) {
  const out = []; let cur = null;
  for (const r of rings) { if (r.length < 4) continue; const a = ringArea(r); if (a > 0 || !cur) { cur = [r]; out.push(cur); } else cur.push(r); }
  return out;
}
// water polygon -> mask cells = 1 (even-odd within the polygon)
function rasterize(mask, poly, ext) {
  for (let Y = 0; Y < MASK; Y++) {
    const yy = ((Y + 0.5) / MASK) * ext, xs = [];
    for (const r of poly) for (let i = 1; i < r.length; i++) { const [x1, y1] = r[i - 1], [x2, y2] = r[i]; if ((y1 > yy) !== (y2 > yy)) xs.push(x1 + ((yy - y1) * (x2 - x1)) / (y2 - y1)); }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) { const a = Math.max(0, Math.ceil((xs[k] / ext) * MASK - 0.5)), b = Math.min(MASK - 1, Math.floor((xs[k + 1] / ext) * MASK - 0.5)); for (let X = a; X <= b; X++) if (!mask[Y * MASK + X]) mask[Y * MASK + X] = 1; }
  }
}
// clear the water mask along every road (bridges over the bay, causeways), a road's width wide
function clearAlong(mask, T, mPerUnit) {
  if (!T) return;
  for (const f of T.features) {
    const w = W[f.props.class]; if (!w || f.type !== 2) continue;
    const r = Math.max(1, Math.ceil(((w / 2 + 1) / mPerUnit / T.extent) * MASK));
    for (const line of f.geom) for (let i = 1; i < line.length; i++) {
      const [x1, y1] = line[i - 1], [x2, y2] = line[i], steps = Math.max(1, Math.ceil((Math.hypot(x2 - x1, y2 - y1) / T.extent) * MASK));
      for (let s = 0; s <= steps; s++) {
        const u = (x1 + ((x2 - x1) * s) / steps) / T.extent, v = (y1 + ((y2 - y1) * s) / steps) / T.extent, mx = Math.floor(u * MASK), my = Math.floor(v * MASK);
        for (let j = -r; j <= r; j++) for (let k = -r; k <= r; k++) { const X = mx + k, Y = my + j; if (X >= 0 && Y >= 0 && X < MASK && Y < MASK && mask[Y * MASK + X] === 1) mask[Y * MASK + X] = 2; }
      }
    }
  }
}
