// The rest of the Bay Area, streamed in round you as you drive (downtown Vallejo stays the detailed baked city from
// city.js). Map tiles from OpenFreeMap (OpenStreetMap data) are built in a worker (stream_worker.js) and drawn here:
// real roads, bridges, water, parks and buildings with their real heights, for about 2 km round you (one tile each way
// on phones). This module also tells city.js what's solid out there (buildings, the bay; roads and bridges over the
// water are drivable), the street and the place you're in, the roads near you for the radar, and where the petrol
// stations are. Tiles further away are dropped to keep memory down.
import * as THREE from "three";
import * as CITY from "./city.js";

const Z = 14, MASK = 512;
export function initStream(E, ctx) {
  const car = E.car, scene = ctx.scene, F = CITY.FRAME;
  const touch = document.body.classList.contains("rb-touch") || matchMedia("(pointer:coarse)").matches;
  const RADIUS = touch ? 1 : 2, KEEP = RADIUS + 1, N = 2 ** Z;
  const tiles = new Map(); // "x_y" -> { state, group, data }
  const out = { tiles, ready: false, blocked, street, place, roadsNear, fuelNear, placesNear, inCore, loaded: () => [...tiles.values()].filter((t) => t.state === "ready").length };
  let urlT = null, worker = null, seq = 0, inflight = 0;
  const pending = new Map();

  // ---------------------------------------------------------------- where things are
  const core = { road: [CITY.HALF[0] + 25, CITY.HALF[1] + 25], bld: [CITY.HALF[0] + 180, CITY.HALF[1] + 180] };
  function inCore(x, z) { return Math.abs(x) < core.road[0] && Math.abs(z) < core.road[1]; }
  function tileXY(x, z) { const [lng, lat] = CITY.toLngLat(x, z), r = (lat * Math.PI) / 180; return [((lng + 180) / 360) * N, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * N]; }
  function tileAt(x, z) { const [tx, ty] = tileXY(x, z), t = tiles.get(Math.floor(tx) + "_" + Math.floor(ty)); return t && t.state === "ready" ? { t, u: tx - Math.floor(tx), v: ty - Math.floor(ty) } : null; }

  // ---------------------------------------------------------------- materials
  const mats = {
    // two-sided: the flat shapes come in either winding from the tiles
    road: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, side: THREE.DoubleSide }),
    water: new THREE.MeshStandardMaterial({ color: 0x1d4a60, roughness: 0.15, metalness: 0.2, side: THREE.DoubleSide }),
    park: new THREE.MeshStandardMaterial({ color: 0x4c6638, roughness: 1, side: THREE.DoubleSide }),
    bld: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide }),
  };
  // land under everything outside the baked city (the baked city has its own ground)
  const land = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000), new THREE.MeshStandardMaterial({ color: 0x6b7356, roughness: 1 }));
  land.rotation.x = -Math.PI / 2; land.position.y = -0.04; land.receiveShadow = true; scene.add(land);

  // ---------------------------------------------------------------- loading
  async function start() {
    try { const tj = await (await fetch("https://tiles.openfreemap.org/planet")).json(); urlT = tj.tiles[0]; }
    catch (e) { setTimeout(start, 15000); return; }
    worker = new Worker(new URL("./stream_worker.js", import.meta.url), { type: "module" });
    worker.onmessage = (ev) => { const m = ev.data, t = pending.get(m.id); pending.delete(m.id); inflight--; if (!t) return; if (!m.ok) { t.state = "failed"; t.retry = performance.now() + 20000; return; } show(t, m); };
    out.ready = true;
  }
  function want(x, y) {
    const k = x + "_" + y; let t = tiles.get(k);
    if (t && (t.state !== "failed" || performance.now() < t.retry)) return;
    if (inflight >= 2) return;
    t = t || { x, y, k, state: "loading" }; t.state = "loading"; tiles.set(k, t);
    const id = ++seq; pending.set(id, t); inflight++;
    worker.postMessage({ id, z: Z, x, y, url: urlT.replace("{z}", Z).replace("{x}", x).replace("{y}", y), frame: { origin: F.origin, kx: F.kx, kz: F.kz, rot: F.rot }, core, lod: touch ? "low" : "high" });
  }
  function mesh(p, mat, n, c, shadow) {
    if (!p.length) return null;
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    if (n) g.setAttribute("normal", new THREE.BufferAttribute(n, 3)); else { const nn = new Float32Array(p.length); for (let i = 1; i < nn.length; i += 3) nn[i] = 1; g.setAttribute("normal", new THREE.BufferAttribute(nn, 3)); }
    if (c) g.setAttribute("color", new THREE.BufferAttribute(c, 3));
    const m = new THREE.Mesh(g, mat); m.receiveShadow = true; m.castShadow = !!shadow; m.matrixAutoUpdate = false; return m;
  }
  function show(t, d) {
    const g = new THREE.Group(); g.position.set(d.cx, 0, d.cz);
    for (const m of [mesh(d.water.p, mats.water), mesh(d.park.p, mats.park), mesh(d.road.p, mats.road, null, d.road.c), mesh(d.bld.p, mats.bld, d.bld.n, d.bld.c, !touch)]) if (m) { g.add(m); m.updateMatrix(); }
    g.userData.noAO = false; scene.add(g);
    // building footprints in a coarse grid for collision
    const grid = new Map(), C = 32, foot = d.foot, off = d.footOff, boxes = [];
    for (let i = 0; i + 1 < off.length; i++) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let j = off[i]; j < off[i + 1]; j++) { const x = foot[j * 2], z = foot[j * 2 + 1]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      boxes.push([x0, z0, x1, z1]);
      for (let gx = Math.floor(x0 / C); gx <= Math.floor(x1 / C); gx++) for (let gz = Math.floor(z0 / C); gz <= Math.floor(z1 / C); gz++) { const k = gx * 100003 + gz; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); }
    }
    Object.assign(t, { state: "ready", group: g, data: d, grid, boxes });
  }
  function drop(t) {
    if (t.group) { scene.remove(t.group); t.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
    tiles.delete(t.k);
  }

  // ---------------------------------------------------------------- what's solid
  function insidePoly(foot, a, b, x, z) { let c = false; for (let i = a, j = b - 1; i < b; j = i++) { const xi = foot[i * 2], zi = foot[i * 2 + 1], xj = foot[j * 2], zj = foot[j * 2 + 1]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; }
  function blocked(x, z, r = 1.1) {
    const at = tileAt(x, z); if (!at) return false; // not loaded yet: open road
    const { t, u, v } = at, d = t.data;
    if (d.mask[Math.min(MASK - 1, Math.floor(v * MASK)) * MASK + Math.min(MASK - 1, Math.floor(u * MASK))] === 1) return true; // the bay
    const list = t.grid.get(Math.floor(x / 32) * 100003 + Math.floor(z / 32)); if (!list) return false;
    for (const i of list) { const b = t.boxes[i]; if (x < b[0] - r || x > b[2] + r || z < b[1] - r || z > b[3] + r) continue; if (insidePoly(d.foot, d.footOff[i], d.footOff[i + 1], x, z)) return true; }
    return false;
  }
  // ---------------------------------------------------------------- names and nearby things
  function street(x, z) {
    const at = tileAt(x, z); if (!at) return null;
    const d = at.t.data, s = d.nameSegs; let best = -1, bd = 18;
    for (let i = 0; i < d.nameIdx.length; i++) { const dd = CITY.segDist(x, z, [s[i * 4], s[i * 4 + 1]], [s[i * 4 + 2], s[i * 4 + 3]]); if (dd < bd) { bd = dd; best = i; } }
    return best >= 0 ? d.names[d.nameIdx[best]] : null;
  }
  function placesNear() { const all = []; for (const t of tiles.values()) if (t.state === "ready") all.push(...t.data.places); return all; }
  // the town you're in (nearest city, town or village label), and the neighbourhood
  function place(x, z) {
    let town = null, td = Infinity, hood = null, hd = Infinity;
    for (const p of placesNear()) {
      const dd = Math.hypot(p.x - x, p.z - z);
      if (/^(city|town|village)$/.test(p.cls)) { if (dd < td) { td = dd; town = p.name; } } else if (dd < hd && dd < 1500) { hd = dd; hood = p.name; }
    }
    return { town, hood };
  }
  function roadsNear(x, z, R) {
    const res = [];
    for (const t of tiles.values()) { if (t.state !== "ready") continue; const s = t.data.segs; for (let i = 0; i < s.length; i += 6) if (Math.min(s[i], s[i + 2]) < x + R && Math.max(s[i], s[i + 2]) > x - R && Math.min(s[i + 1], s[i + 3]) < z + R && Math.max(s[i + 1], s[i + 3]) > z - R) res.push(s[i], s[i + 1], s[i + 2], s[i + 3], s[i + 4], s[i + 5]); }
    return res;
  }
  function fuelNear(x, z, R) { let best = null, bd = R; for (const t of tiles.values()) { if (t.state !== "ready") continue; for (const f of t.data.fuel) { const dd = Math.hypot(f.x - x, f.z - z); if (dd < bd) { bd = dd; best = { ...f, d: dd }; } } } return best; }

  // ---------------------------------------------------------------- every half second: load round you, drop far tiles
  let acc = 0;
  ctx.onFrame((dt) => {
    acc += dt; if (acc < 0.5) return; acc = 0;
    land.position.set(Math.round(car.x / 100) * 100, -0.04, Math.round(car.z / 100) * 100);
    if (!worker) return;
    const [tx, ty] = tileXY(car.x, car.z), cx = Math.floor(tx), cy = Math.floor(ty);
    // nearest first
    const order = [];
    for (let dx = -RADIUS; dx <= RADIUS; dx++) for (let dy = -RADIUS; dy <= RADIUS; dy++) order.push([Math.hypot(cx + dx + 0.5 - tx, cy + dy + 0.5 - ty), cx + dx, cy + dy]);
    order.sort((a, b) => a[0] - b[0]); for (const [, x, y] of order) want(x, y);
    for (const t of [...tiles.values()]) if (t.state !== "loading" && (Math.abs(t.x - cx) > KEEP || Math.abs(t.y - cy) > KEEP)) drop(t);
  });
  CITY.ext.blocked = blocked; CITY.ext.street = street; CITY.ext.area = (x, z) => { const p = place(x, z); return p.hood && p.town ? p.hood + ", " + p.town : p.town || p.hood || "Bay Area"; };
  start();
  return out;
}
