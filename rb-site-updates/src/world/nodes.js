// Empire Nodes (🏛️ in the phone): real places on the real map, one every few hundred metres, the same for everyone
// (empire_defs.js). Go to one to claim it: walk there with your phone's location on, or drive there in the game. Once
// it's yours it earns money every hour, even while you're away (up to a day at a time), and after a few hours anyone
// who gets there can take it over for a quarter more, paying you half. Walking with your location on also counts
// towards a daily streak worth tokens. The server checks every claim (world-worker.js: distance, speed, price).
// Your location is only used while this is on: to find the nodes round you and to count walking. The server keeps your
// last position (for the speed check) and how far you walked each day, nothing else.
// Yours can be upgraded (each level earns more), and more of them in the same city earn more each (the city set). With
// combat on you can fight for another player's node (a raid: its crew guards it), and you can give one of yours to
// another player. The app shows what your whole empire is worth and what happened to it.
import * as THREE from "three";
import * as CITY from "./city.js";
import { api, onBeat } from "./rb_world.js";
import { NODE_RADIUS, NODE_SHIELD_H, NODE_INCOME, NODE_MAX, NODE_UP_MAX, NODE_UP_RATE, WALK_DAY_M, RAID_REWARD, metresBetween } from "./empire_defs.js";

const MODE_KEY = "rb_world_nodes_mode";
const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function initNodes(E, ctx) {
  const car = E.car, P = ctx.player, scene = ctx.scene;
  let mode = "car"; try { mode = localStorage.getItem(MODE_KEY) === "gps" ? "gps" : "car"; } catch (e) {}
  const out = { nodes: [], walk: null, empire: null, raid: null, open, here: () => here(), get mode() { return mode; } };
  let fix = null, watch = null, lastAsk = 0, lastAt = null, asking = false, earned = 0, earnedAt = Date.now(), peers = [];

  // ---------------------------------------------------------------- where you are
  function here() {
    if (mode === "gps") return fix ? { lat: fix.lat, lng: fix.lng, src: "gps" } : null;
    const [lng, lat] = CITY.toLngLat(car.x, car.z), a = window.RBBay && window.RBBay.area; return { lat, lng, src: "car", town: a && a.town };
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
  async function upgrade(id) {
    try {
      const d = await api("/api/world/node", { id: P.id, name: P.name, op: "upgrade", node: id, ...(here() || { lat: 0, lng: 0 }) });
      P.netWorth = Math.max(0, P.netWorth - d.paid); ctx.sync && ctx.sync(); ctx.play && ctx.play("cash"); E.emit("build", id);
      E.toast(`🏗️ ${d.node.name} is level ${d.node.level}: about ${money(d.node.incomeH)} an hour now.`);
      out.nodes = out.nodes.map((x) => (x.id === d.node.id ? d.node : x)); draw();
    } catch (e) { E.toast(e.message, true); }
    open();
  }
  async function give(n, to) {
    try { const d = await api("/api/world/node", { id: P.id, name: P.name, op: "give", node: n.id, to: to.id, ...(here() || { lat: 0, lng: 0 }) }); E.toast(`🎁 ${n.name} is ${d.to}'s now.`); ask(true); }
    catch (e) { E.toast(e.message, true); }
    open();
  }
  function givePanel(n) {
    const list = peers.filter((p) => p.id !== P.id).slice(0, 12), acts = { x: open };
    const rows = list.map((p, i) => { acts["g" + i] = () => give(n, p); return `<div class="rb-card"><div><b>${esc(p.name)}</b><div class="rb-muted">${money(p.netWorth || 0)}</div></div><button class="rb-btn" data-e="g${i}">GIVE</button></div>`; }).join("");
    E.panel(`<h2>🎁 GIVE ${esc(n.name)}</h2><div class="rb-muted">To another player who's in the city now: for a trade you agreed in chat, or to a friend. It's theirs straight away (safe for ${NODE_SHIELD_H} hours); nothing is paid.</div>${rows || '<div class="rb-muted">Nobody else is playing right now.</div>'}<button class="btn-ghost" data-e="x">BACK</button>`, acts);
  }
  // a raid: fight the crew guarding another player's node (combat.js runs the fight), then the server's verdict
  async function raid(n) {
    const C = window.RBCombat, h = here(); if (!h) return;
    if (!C || !C.on) return E.toast("⚔️ Turn combat on (⚔️) to fight for a node.", true);
    if (C.mission) return E.toast("Finish what you're doing first.", true);
    try {
      const d = await api("/api/world/node", { id: P.id, name: P.name, op: "raid", node: n.id, weapon: C.armed || P.equippedWeapon || "unarmed", ...h });
      const r = d.raid, [x, z] = CITY.fromLngLat(n.lng, n.lat); out.raid = r;
      E.toast(`⚔️ ${r.owner}'s crew of ${r.crew} guards ${n.name}. Take them out: the node is yours and ${money(r.reward)}.`, true);
      C.startRaid({ name: `Raid on ${n.name}`, desc: "", crew: [r.crew, r.crew], onEnd: (ok, why) => raidEnd(r, ok, why) }, [x, z]);
    } catch (e) { E.toast(e.message, true); }
  }
  async function raidEnd(r, ok, why, tries = 0) {
    const h = here() || { lat: 0, lng: 0 };
    try {
      const d = await api("/api/world/node", { id: P.id, name: P.name, op: "raid-end", raid: r.id, won: ok, ...h });
      out.raid = null;
      if (d.raid.status === "won") { E.toast(`⚔️ ${r.name} is yours. ${money(d.raid.reward)} comes in with the next update.`); E.emit("node-claim", r.node); ctx.play && ctx.play("cash"); }
      else if (ok) E.toast(`⚔️ The fight for ${r.name} didn't count (${d.raid.status}).`, true);
      else E.toast(`❌ Lost the fight for ${r.name}. ${why || ""}`, true);
      ask(true);
    } catch (e) {
      // too quick to count: wait out the rest of the minimum and ask again
      if (ok && tries < 3 && /too quick/.test(e.message)) return setTimeout(() => raidEnd(r, ok, why, tries + 1), 8000);
      out.raid = null; E.toast(e.message, true);
    }
  }
  onBeat((d) => {
    if (d.peers) peers = d.peers;
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
      const lv = n.level ? ` · L${n.level}` : "";
      g.add(label(n.mine ? "★ " + n.name + lv : n.owner ? n.owner + "'s node" + lv : n.name + lv, n.mine ? "#F5E6A3" : n.owner ? "#d0d4da" : "#ffffff"));
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
    const can = !n.shield && P.netWorth >= n.price, C = window.RBCombat, fight = n.owner && !n.shield && C && C.on && !C.mission && !out.raid;
    chip.style.display = "block";
    chip.innerHTML = `🏛️ <b>${esc(n.name)}</b>${n.level ? ` L${n.level}` : ""} · ${n.owner ? `${esc(n.owner)}'s` : "free"} · ${n.shield ? `safe for ${Math.ceil(n.shield / 3600e3)} h` : `${n.owner ? "take over" : "claim"} for <b>${money(n.price)}</b>`}<button type="button" data-k="c" ${can ? "" : "disabled"}>${n.owner ? "TAKE OVER" : "CLAIM"}</button>${fight ? '<button type="button" data-k="r">⚔️ RAID</button>' : ""}`;
    chip.querySelector('[data-k="c"]').onclick = () => claim(n);
    const rb = chip.querySelector('[data-k="r"]'); if (rb) rb.onclick = () => raid(n);
  }

  // ---------------------------------------------------------------- the 🏛️ app
  async function open() {
    ask(true);
    try { out.empire = await api("/api/world/empire", { id: P.id, name: P.name }); } catch (e) {}
    const em = out.empire, acts = {};
    const own = (em && em.nodes) || [];
    const ownRows = own.map((n, i) => {
      acts["u" + i] = () => upgrade(n.id); acts["v" + i] = () => givePanel(n);
      const city = n.city && !/^Area /.test(n.city) ? n.city : "this area", set = em.cities[n.city];
      return `<div class="rb-card"><div><b>★ ${esc(n.name)} · level ${n.level}</b><div class="rb-muted">${esc(city)}${set && set.count > 1 ? ` · set of ${set.count}: ×${set.bonus}` : ""} · ${money(n.incomeH)} an hour · worth ${money(n.value)}</div></div>
        <div>${n.upCost != null ? `<button class="rb-btn" data-e="u${i}" ${P.netWorth >= n.upCost ? "" : "disabled"}>UPGRADE ${money(n.upCost)}</button>` : '<span class="rb-muted">top level</span>'} <button class="btn-ghost" data-e="v${i}">GIVE</button></div></div>`;
    }).join("");
    const evRows = ((em && em.events) || []).slice(0, 6).map((e) => `<div class="rb-muted">· ${esc(e.text)}${e.amount ? ` (${e.amount > 0 ? "+" : "−"}${money(Math.abs(e.amount))})` : ""}</div>`).join("");
    const w = out.walk, mine = out.nodes.filter((n) => n.mine), list = out.nodes.slice(0, 10);
    const rows = list.map((n) => `<div class="rb-card"><div><b>${n.mine ? "★ " : ""}${esc(n.name)}${n.level ? ` · L${n.level}` : ""}</b><div class="rb-muted">${n.d < 1000 ? n.d + " m" : (n.d / 1000).toFixed(1) + " km"} away · ${n.mine ? "yours" : n.owner ? esc(n.owner) + "'s" : "free"} · ${n.shield ? `safe for ${Math.ceil(n.shield / 3600e3)} h` : money(n.price)} · ${money(n.incomeH)}/h</div></div></div>`).join("");
    E.panel(`<h2>🏛️ EMPIRE NODES</h2>
      <div class="rb-muted">Real places, the same for everyone. Get within ${NODE_RADIUS} m to claim one; it earns ${Math.round(NODE_INCOME * 100)}% of its price an hour, even while you're away. A new owner is safe for ${NODE_SHIELD_H} hours; after that anyone there can take it over for a quarter more (you get half), or, with combat on, fight its crew for it. Up to ${NODE_MAX} at a time.</div>
      ${em ? `<div class="rb-card" style="display:block"><b>👑 Your empire: ${money(em.value)}</b><div class="rb-muted">Money ${money(em.cash)} · ${em.lots.count} lot${em.lots.count === 1 ? "" : "s"} ${money(em.lots.value)} · ${own.length} node${own.length === 1 ? "" : "s"} ${money(em.nodesValue)} · nodes earn ${money(em.incomeH)} an hour</div>
        <div class="rb-muted" style="font-size:10px;margin-top:4px">Each upgrade adds ${Math.round(NODE_UP_RATE * 100)}% to a node's income (up to level ${NODE_UP_MAX}). Nodes in the same city earn more each: 2 ×1.1, 3 ×1.25, 4 or more ×1.5. A raid you win pays ${Math.round(RAID_REWARD * 100)}% of the node's worth.</div></div>` : ""}
      ${ownRows ? `<h3 style="font:800 11px Inter,sans-serif;color:var(--gold);letter-spacing:2px;margin:14px 0 6px">YOURS</h3>${ownRows}` : ""}
      ${evRows ? `<h3 style="font:800 11px Inter,sans-serif;color:var(--gold);letter-spacing:2px;margin:14px 0 6px">LATELY</h3>${evRows}` : ""}
      <div class="rb-card" style="display:block"><b>Where you are</b><div class="rb-row" style="gap:6px;margin-top:6px">
        <button type="button" class="${mode === "gps" ? "rb-btn" : "btn-ghost"}" data-e="gps">📍 MY REAL LOCATION</button><button type="button" class="${mode === "car" ? "rb-btn" : "btn-ghost"}" data-e="car">🚗 MY CAR IN THE GAME</button></div>
        <div class="rb-muted" style="margin-top:6px">${mode === "gps" ? (fix ? `Using your phone's location (about ${Math.round(fix.acc || 0)} m accurate).` : "Waiting for your location…") : "Using where your car is in the game."} Your location is only used while this is on: to find nodes and count walking. RB keeps your last position (to check speed) and how far you walked each day.</div></div>
      ${w ? `<div class="rb-card" style="display:block"><b>🚶 Walking today</b><div class="rb-muted">${w.today.toLocaleString("en-US")} m of ${w.goal.toLocaleString("en-US")} m (about ${Math.round(w.today / 0.762).toLocaleString("en-US")} steps). Walk ${WALK_DAY_M / 1000} km a day with your location on for tokens; more days in a row, more tokens.</div></div>` : ""}
      <h3 style="font:800 11px Inter,sans-serif;color:var(--gold);letter-spacing:2px;margin:14px 0 6px">NEAREST (${mine.length} YOURS NEARBY)</h3>${rows || '<div class="rb-muted">Looking…</div>'}
      <button class="btn-ghost" data-e="x">CLOSE</button>`,
      { ...acts, x: E.hidePanel, gps: () => { useGps(true); setTimeout(open, 1500); }, car: () => { useGps(false); setTimeout(open, 300); } });
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
