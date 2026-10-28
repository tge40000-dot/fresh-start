// Empire Nodes (🏛️ in the phone): real places on the real map, one every few hundred metres, the same for everyone
// (empire_defs.js). Go to one to claim it: walk there with your phone's location on, or drive there in the game. Once
// it's yours it earns money every hour, even while you're away (up to a day at a time), and after a few hours anyone
// who gets there can take it over for a quarter more, paying you half. Walking with your location on also counts
// towards a daily streak worth tokens. The server checks every claim (world-worker.js: distance, speed, price).
// Your location is only used while this is on: to find the nodes round you and to count walking. The server keeps your
// last position (for the speed check) and how far you walked each day, nothing else.
import * as THREE from "three";
import * as CITY from "./city.js";
import { api, onBeat } from "./rb_world.js";
import { NODE_RADIUS, NODE_SHIELD_H, NODE_INCOME, NODE_MAX, WALK_DAY_M, metresBetween } from "./empire_defs.js";

const MODE_KEY = "rb_world_nodes_mode";
const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function initNodes(E, ctx) {
  const car = E.car, P = ctx.player, scene = ctx.scene;
  let mode = "car"; try { mode = localStorage.getItem(MODE_KEY) === "gps" ? "gps" : "car"; } catch (e) {}
  const out = { nodes: [], walk: null, open, get mode() { return mode; } };
  let fix = null, watch = null, lastAsk = 0, lastAt = null, asking = false, earned = 0, earnedAt = Date.now();

  // ---------------------------------------------------------------- where you are
  function here() {
    if (mode === "gps") return fix ? { lat: fix.lat, lng: fix.lng, src: "gps" } : null;
    const [lng, lat] = CITY.toLngLat(car.x, car.z); return { lat, lng, src: "car" };
  }
  function useGps(on) {
    if (watch != null) { navigator.geolocation.clearWatch(watch); watch = null; }
    mode = on ? "gps" : "car"; try { localStorage.setItem(MODE_KEY, mode); } catch (e) {}
    if (on && navigator.geolocation) watch = navigator.geolocation.watchPosition(
      (p) => { fix = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }; },
      () => { E.toast("📍 No location: using your car instead. You can turn it on in your browser's settings.", true); useGps(false); },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 });
    lastAsk = 0;
  }
  if (mode === "gps") useGps(true);
  document.addEventListener("visibilitychange", () => { if (document.hidden && watch != null) { navigator.geolocation.clearWatch(watch); watch = null; } else if (!document.hidden && mode === "gps" && watch == null) useGps(true); });

  // ---------------------------------------------------------------- the server
  async function ask(force) {
    const h = here(); if (!h || asking) return;
    const moved = lastAt ? metresBetween(h.lat, h.lng, lastAt.lat, lastAt.lng) : Infinity;
    if (!force && performance.now() - lastAsk < 15000 && moved < 60) return;
    asking = true; lastAsk = performance.now(); lastAt = h;
    try { const d = await api("/api/world/node", { id: P.id, name: P.name, op: "near", ...h }); out.nodes = d.nodes || []; out.walk = d.walk || null; draw(); }
    catch (e) {} finally { asking = false; }
  }
  async function claim(n) {
    const h = here(); if (!h) return;
    try {
      const d = await api("/api/world/node", { id: P.id, name: P.name, op: "claim", node: n.id, ...h });
      P.netWorth = Math.max(0, P.netWorth - d.paid); ctx.sync && ctx.sync(); ctx.play && ctx.play("cash");
      E.toast(`🏛️ ${n.name} is yours (${money(d.paid)}). It earns about ${money(d.paid * NODE_INCOME)} an hour.`); E.emit("node-claim", n.id);
      if (d.node) { out.nodes = out.nodes.map((x) => (x.id === d.node.id ? d.node : x)); draw(); chipTick(); }
      ask(true);
    } catch (e) { E.toast(e.message, true); }
  }
  onBeat((d) => {
    if (d.nodeIncome > 0) { P.netWorth += d.nodeIncome; earned += d.nodeIncome; ctx.sync && ctx.sync(); }
    if (earned > 0 && Date.now() - earnedAt > 300000) { E.toast(`🏛️ Your Empire Nodes earned ${money(earned)}.`); earned = 0; earnedAt = Date.now(); }
  });

  // ---------------------------------------------------------------- on the map: gold columns, and a badge to claim
  const group = new THREE.Group(); scene.add(group);
  const mats = { mine: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xC9A84C).multiplyScalar(1.6) }), theirs: new THREE.MeshBasicMaterial({ color: 0x9aa0a8 }), free: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }) };
  const colGeo = new THREE.CylinderGeometry(0.9, 1.3, 7, 12), capGeo = new THREE.OctahedronGeometry(1.4);
  function label(text, color) {
    const c = document.createElement("canvas"); c.width = 512; c.height = 96; const g = c.getContext("2d");
    g.fillStyle = "rgba(0,0,0,.72)"; g.fillRect(0, 0, 512, 96); g.strokeStyle = color; g.lineWidth = 6; g.strokeRect(3, 3, 506, 90);
    g.fillStyle = color; g.font = "800 40px Inter, Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, 256, 50);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false })); s.scale.set(14, 2.6, 1); s.position.y = 11; return s;
  }
  function draw() {
    for (const o of [...group.children]) { group.remove(o); o.traverse((m) => { if (m.material && m.material.map) m.material.map.dispose(); }); }
    for (const n of out.nodes) {
      const [x, z] = CITY.fromLngLat(n.lng, n.lat), g = new THREE.Group(), m = n.mine ? mats.mine : n.owner ? mats.theirs : mats.free;
      const col = new THREE.Mesh(colGeo, m); col.position.y = 3.5; g.add(col);
      const cap = new THREE.Mesh(capGeo, m); cap.position.y = 8.2; cap.userData.spin = true; g.add(cap);
      g.add(label(n.mine ? "★ " + n.name : n.owner ? n.owner + "'s node" : n.name, n.mine ? "#F5E6A3" : n.owner ? "#d0d4da" : "#ffffff"));
      g.position.set(x, 0, z); g.userData.noAO = true; group.add(g);
    }
  }
  const chip = document.createElement("div"); chip.id = "rb-node";
  chip.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:calc(196px + env(safe-area-inset-bottom));z-index:7000;display:none;background:rgba(10,8,0,.9);border:1px solid #C9A84C;border-radius:12px;padding:8px 12px;color:#fff;font:700 12px/1.35 Inter,sans-serif;text-align:center;max-width:90vw";
  document.body.appendChild(chip);
  const css = document.createElement("style"); css.textContent = "#rb-node button{margin-left:8px;border:0;border-radius:8px;padding:6px 10px;background:#C9A84C;color:#000;font:900 11px Inter,sans-serif;cursor:pointer}#rb-node button:disabled{opacity:.5}body.rb-photo #rb-node,body:has(#rb-phone.open) #rb-node{display:none!important}";
  document.head.appendChild(css);
  function nearest() {
    const h = here(); if (!h) return null; let best = null, bd = Infinity;
    for (const n of out.nodes) { const d = metresBetween(h.lat, h.lng, n.lat, n.lng); if (d < bd) { bd = d; best = { ...n, d }; } }
    return best && best.d <= NODE_RADIUS ? best : null;
  }
  function chipTick() {
    const n = nearest();
    if (!n || n.mine) { chip.style.display = "none"; return; }
    const can = !n.shield && P.netWorth >= n.price;
    chip.style.display = "block";
    chip.innerHTML = `🏛️ <b>${esc(n.name)}</b> · ${n.owner ? `${esc(n.owner)}'s` : "free"} · ${n.shield ? `safe for ${Math.ceil(n.shield / 3600e3)} h` : `${n.owner ? "take over" : "claim"} for <b>${money(n.price)}</b>`}<button type="button" ${can ? "" : "disabled"}>${n.owner ? "TAKE OVER" : "CLAIM"}</button>`;
    chip.querySelector("button").onclick = () => claim(n);
  }

  // ---------------------------------------------------------------- the 🏛️ app
  function open() {
    ask(true);
    const w = out.walk, mine = out.nodes.filter((n) => n.mine), list = out.nodes.slice(0, 10);
    const rows = list.map((n) => `<div class="rb-card"><div><b>${n.mine ? "★ " : ""}${esc(n.name)}</b><div class="rb-muted">${n.d < 1000 ? n.d + " m" : (n.d / 1000).toFixed(1) + " km"} away · ${n.mine ? "yours" : n.owner ? esc(n.owner) + "'s" : "free"} · ${n.shield ? `safe for ${Math.ceil(n.shield / 3600e3)} h` : money(n.price)}</div></div></div>`).join("");
    E.panel(`<h2>🏛️ EMPIRE NODES</h2>
      <div class="rb-muted">Real places, the same for everyone. Get within ${NODE_RADIUS} m to claim one; it earns ${Math.round(NODE_INCOME * 100)}% of its price an hour, even while you're away. A new owner is safe for ${NODE_SHIELD_H} hours; after that anyone there can take it over for a quarter more, and you get half. Up to ${NODE_MAX} at a time.</div>
      <div class="rb-card" style="display:block"><b>Where you are</b><div class="rb-row" style="gap:6px;margin-top:6px">
        <button type="button" class="${mode === "gps" ? "rb-btn" : "btn-ghost"}" data-e="gps">📍 MY REAL LOCATION</button><button type="button" class="${mode === "car" ? "rb-btn" : "btn-ghost"}" data-e="car">🚗 MY CAR IN THE GAME</button></div>
        <div class="rb-muted" style="margin-top:6px">${mode === "gps" ? (fix ? `Using your phone's location (about ${Math.round(fix.acc || 0)} m accurate).` : "Waiting for your location…") : "Using where your car is in the game."} Your location is only used while this is on: to find nodes and count walking. RB keeps your last position (to check speed) and how far you walked each day.</div></div>
      ${w ? `<div class="rb-card" style="display:block"><b>🚶 Walking today</b><div class="rb-muted">${w.today.toLocaleString("en-US")} m of ${w.goal.toLocaleString("en-US")} m (about ${Math.round(w.today / 0.762).toLocaleString("en-US")} steps). Walk ${WALK_DAY_M / 1000} km a day with your location on for tokens; more days in a row, more tokens.</div></div>` : ""}
      <h3 style="font:800 11px Inter,sans-serif;color:var(--gold);letter-spacing:2px;margin:14px 0 6px">NEAREST (${mine.length} YOURS NEARBY)</h3>${rows || '<div class="rb-muted">Looking…</div>'}
      <button class="btn-ghost" data-e="x">CLOSE</button>`,
      { x: E.hidePanel, gps: () => { useGps(true); setTimeout(open, 1500); }, car: () => { useGps(false); setTimeout(open, 300); } });
  }

  // radar (hud.js): gold yours, grey others', white free
  let acc = 0;
  ctx.onFrame((dt) => {
    for (const g of group.children) { const c = g.children[1]; if (c) c.rotation.y += dt; }
    acc += dt; if (acc < 0.5) return; acc = 0;
    ask(false); chipTick();
    window.__rbBlips3 = out.nodes.map((n) => { const [x, z] = CITY.fromLngLat(n.lng, n.lat); return { x, z, c: n.mine ? "#C9A84C" : n.owner ? "#9aa0a8" : "#ffffff", r: 5 }; });
  });
  return out;
}
