// Bank jobs (🏦 in the phone): a timed heist for big money, checked by the server step by step (world-worker.js
// worldHeist). Start one and a vault comes up a few hundred metres away: get there, stay while it's cracked, then get
// the money to the drop before the time runs out, with three stars on you. Where you are is your car in the game, or
// your phone's location if Empire Nodes uses it (nodes.js). The pay comes in with the next beat; it's game money.
import * as THREE from "three";
import * as CITY from "./city.js";
import { api } from "./rb_world.js";
import { HEIST_PAY, HEIST_LEN_S, HEIST_CRACK_S, HEIST_NEAR, HEIST_COOLDOWN_MIN, HEIST_DAY_MAX, metresBetween } from "./empire_defs.js";

const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const STAGE = { vault: "Get to the vault.", crack: "Cracking the vault: stay here.", getaway: "Get the money to the drop." };

export function initHeist(E, ctx) {
  const P = ctx.player, car = E.car, scene = ctx.scene;
  const out = { h: null, cooldown: 0, open, refresh };
  let busy = false;
  const where = () => (window.RBNodes && window.RBNodes.here()) || (() => { const [lng, lat] = CITY.toLngLat(car.x, car.z); return { lat, lng, src: "car" }; })();
  // quiet: a step the game takes by itself (at the vault, at the drop); what went wrong shows on the chip instead
  let note = "";
  async function call(op, quiet) {
    if (busy) return null; busy = true;
    try { const d = await api("/api/world/heist", { id: P.id, name: P.name, op, ...where() }); note = ""; if ("heist" in d) set(d.heist); return d; }
    catch (e) { if (quiet) note = e.message; else if (op !== "status") E.toast(e.message, true); return null; }
    finally { busy = false; }
  }
  async function refresh() { const d = await call("status"); if (d) out.cooldown = d.cooldown || 0; }
  setTimeout(refresh, 9000);

  // the vault (gold) and the drop (green): a tall light you can see from streets away
  const beams = {};
  function beam(key, p, color) {
    if (beams[key]) { scene.remove(beams[key]); beams[key] = null; }
    if (!p) return;
    const [x, z] = CITY.fromLngLat(p.lng, p.lat), m = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 90, 18, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }));
    m.position.set(x, 45, z); m.userData.noAO = true; scene.add(m); beams[key] = m;
  }
  function set(h) {
    const was = out.h; out.h = h && h.status === "open" ? h : null;
    if (out.h && out.h.crackLeft != null) out.h.crackAt = Date.now() + out.h.crackLeft * 1000;
    if (h && was && was.id === h.id && was.status === "open" && h.status !== "open") {
      if (h.status === "done") E.toast(`💰 Bank job done: ${money(h.pay)} + 25 tokens come in with the next update.`);
      else if (h.status === "failed") E.toast("❌ Bank job failed: time ran out.", true);
    }
    if (h && was && was.id === h.id && was.stage !== h.stage && h.stage === "getaway") { E.setWanted && E.setWanted(3); ctx.play && ctx.play("alert"); E.toast("🚨 Vault open. The cops are coming: get the money to the green light.", true); }
    beam("vault", out.h && out.h.stage !== "getaway" ? out.h.vault : null, 0xC9A84C);
    beam("drop", out.h && out.h.stage === "getaway" ? out.h.drop : null, 0x38d27a);
  }

  // the chip: what to do, how far, which way, and the time left
  const chip = document.createElement("div"); chip.id = "rb-heist";
  chip.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:calc(244px + env(safe-area-inset-bottom));z-index:7000;display:none;background:rgba(10,8,0,.9);border:1px solid #C9A84C;border-radius:12px;padding:7px 12px;color:#fff;font:700 12px/1.35 Inter,sans-serif;text-align:center;max-width:90vw";
  document.body.appendChild(chip);
  const css = document.createElement("style"); css.textContent = "body.rb-photo #rb-heist,body:has(#rb-phone.open) #rb-heist{display:none!important}";
  document.head.appendChild(css);

  let acc = 0, stepAt = 0;
  const step = (op) => { if (performance.now() - stepAt < 3000) return; stepAt = performance.now(); call(op, true); };
  ctx.onFrame((dt) => {
    for (const k in beams) if (beams[k]) beams[k].rotation.y += dt * 0.6;
    acc += dt; if (acc < 0.5) return; acc = 0;
    const h = out.h;
    if (!h) { chip.style.display = "none"; window.__rbHeistTarget = null; return; }
    const left = Math.max(0, Math.round((h.ends - Date.now()) / 1000));
    if (left <= 0) { chip.style.display = "none"; refresh(); return; }
    const p = where(), target = h.stage === "getaway" ? h.drop : h.vault, d = Math.round(metresBetween(p.lat, p.lng, target.lat, target.lng));
    const [tx, tz] = CITY.fromLngLat(target.lng, target.lat); window.__rbHeistTarget = [tx, tz];
    if (h.stage === "vault" && d <= HEIST_NEAR - 10) step("arrive");
    const crack = h.stage === "crack" ? Math.max(0, Math.ceil(((h.crackAt || 0) - Date.now()) / 1000)) : 0;
    if (h.stage === "crack" && d <= HEIST_NEAR && !crack) step("loot");
    if (h.stage === "getaway" && d <= HEIST_NEAR - 10) step("finish");
    const ang = Math.atan2(tx - car.x, tz - car.z), foot = window.RBFoot, view = foot && foot.on ? foot.yaw : car.heading;
    let rel = ang - view; rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    const say = h.stage === "crack" ? (d > HEIST_NEAR ? "Get back to the vault!" : `${STAGE.crack} ${crack} s`) : STAGE[h.stage] || "";
    chip.style.display = "block";
    chip.innerHTML = `🏦 ${esc(say)} · ${d} m <span style="display:inline-block;transform:rotate(${(-rel * 180) / Math.PI}deg)">⬆</span> · ⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} · ${money(h.pay)}${note ? `<div style="color:#ffb000;font-size:11px">${esc(note)}</div>` : ""}`;
  });

  // the 🏦 app
  async function open() {
    await refresh();
    const h = out.h, cool = Math.ceil((out.cooldown || 0) / 60000);
    E.panel(`<h2>🏦 BANK JOBS</h2>
      <div class="rb-muted">A vault comes up a few hundred metres away. Get there, stay ${HEIST_CRACK_S} seconds while it's cracked, then get the money to the drop, with three stars on you, all inside ${HEIST_LEN_S / 60} minutes. Pays ${money(HEIST_PAY[0])} to ${money(HEIST_PAY[1])} and 25 tokens. One every ${HEIST_COOLDOWN_MIN} minutes, up to ${HEIST_DAY_MAX} a day.</div>
      ${h ? `<div class="rb-card" style="display:block"><b>On a job: ${money(h.pay)}</b><div class="rb-muted">${esc(STAGE[h.stage] || h.stage)} · ${Math.max(0, Math.ceil((h.ends - Date.now()) / 60000))} min left</div></div>
        <button class="btn-ghost" data-e="cancel">CALL IT OFF</button>`
        : `<button class="btn-gold" data-e="start" ${cool > 0 ? "disabled" : ""}>${cool > 0 ? `LIE LOW: ${cool} MIN` : "START A JOB"}</button>`}
      <div class="rb-muted" style="font-size:10px">Game money. The server checks where you are at each step and how fast you got there.</div>
      <button class="btn-ghost" data-e="x">CLOSE</button>`,
      { x: E.hidePanel,
        start: async () => { const d = await call("start"); if (d && d.heist) { E.hidePanel(); E.toast(`🏦 Bank job: get to the gold light (${d.heist.vault.name}). ${money(d.heist.pay)} if you pull it off.`, true); } else open(); },
        cancel: async () => { await call("cancel"); out.h = null; set(null); E.toast("Called it off."); E.hidePanel(); } });
  }
  return out;
}
