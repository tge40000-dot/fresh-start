// RB World combat (18+, opt-in): realistic weapons on foot, armed crews in combat missions, and fights with other
// players who've opted in too (live.js). Nobody sees any of it until they turn combat on and confirm they're 18 or
// older (⚔️ in the phone, or the Combat button); RB Command can switch it off for everyone (world_combat).
//   Weapons: the ones bought in the Armory (main.js WEAPONS), drawn in code: pistol, SMG, shotgun, assault rifle,
//     sniper rifle and RPG, each with its own fire rate, damage, spread, range, magazine, reload, recoil and sound.
//     Right mouse (or AIM) aims over the shoulder, left mouse (or FIRE) shoots, R reloads, 1-6 or the mouse wheel
//     switches, holding Tab opens the weapon wheel, X puts the weapon away. A marker round the crosshair shows where
//     a hit came from.
//   Shots are hitscan from the crosshair (the RPG fires a rocket): buildings, the ground and cars stop them; head
//     shots do 2.5x. People on the street never get hurt: they run from gunfire. Shooting in the open city brings the
//     cops (two stars); inside a mission's area it doesn't.
//   Missions (game money and tokens): Turf war (clear a crew), Stash raid (clear it, take the case to the drop) and
//     Hold the block (three waves). Crews take cover, lean out to fire, reload behind walls and rush you now and then;
//     fallen crew drop cash. With 3+ wanted stars, police get out of their cars armed (shooting them adds stars).
//   You: health and armour (Armory security adds armour); health comes back to half if you aren't hit for a while.
//     Wasted: a clinic bill (10% of your cash, at most $5,000) and you're back by RB Plaza next to your car.
import * as THREE from "three";
import { person, pose, gun } from "./char.js";

const AGE_KEY = "rb_world_18", ON_KEY = "rb_world_combat";
const ARMS = {
  pistol: { name: "Street Pistol", auto: false, rpm: 320, dmg: 26, range: 70, spread: 0.010, mag: 12, reload: 1.3, kick: 0.03, snd: [1500, 0.13, 0.55] },
  smg: { name: "Tactical SMG", auto: true, rpm: 820, dmg: 16, range: 50, spread: 0.028, mag: 30, reload: 1.8, kick: 0.014, snd: [2100, 0.08, 0.45] },
  shotgun: { name: "Enforcer 12G", auto: false, rpm: 75, dmg: 13, pellets: 9, range: 30, spread: 0.075, mag: 6, reload: 2.6, kick: 0.09, snd: [700, 0.32, 0.9] },
  rifle: { name: "Assault Rifle", auto: true, rpm: 620, dmg: 29, range: 140, spread: 0.014, mag: 30, reload: 2.2, kick: 0.022, snd: [1200, 0.15, 0.7] },
  sniper: { name: "Executive Sniper", auto: false, rpm: 42, dmg: 130, range: 420, spread: 0.0008, mag: 5, reload: 3.0, kick: 0.13, zoom: 16, snd: [900, 0.45, 1] },
  rpg: { name: "Hostile RPG", auto: false, rpm: 28, dmg: 220, range: 320, spread: 0.004, mag: 1, reload: 3.2, kick: 0.16, rocket: true, blast: 7.5, snd: [380, 0.5, 0.9] },
};
const ORDER = ["pistol", "smg", "shotgun", "rifle", "sniper", "rpg"];
const MISSIONS = [
  { key: "turf", icon: "🎯", name: "Turf war", desc: "A crew has taken over a corner. Clear them out.", crew: [4, 6], pay: 6000, tokens: 40 },
  { key: "stash", icon: "💼", name: "Stash raid", desc: "Hit a stash house, grab the case and get it to the drop. Expect a fight, then the cops.", crew: [5, 7], pay: 12000, tokens: 70 },
  { key: "hold", icon: "🛡️", name: "Hold the block", desc: "Rivals are coming for RB territory. Hold the block through three waves.", waves: [4, 5, 6], pay: 15000, tokens: 90 },
];
const store = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} } };
// Attachments, bought with game money in the Combat panel and kept on this device. A red dot and the scope don't go
// together: fitting one takes the other off.
export const ATTACH = [
  { k: "sup", icon: "🔇", name: "Suppressor", what: "Quieter, and your shots don't bring the cops. 10% less damage.", cost: 2500, fits: ["pistol", "smg", "rifle", "sniper"] },
  { k: "ext", icon: "📦", name: "Extended magazine", what: "Half as many rounds again before you reload.", cost: 1500, fits: ["pistol", "smg", "shotgun", "rifle"] },
  { k: "dot", icon: "🔴", name: "Red dot sight", what: "Tighter shots when you aim.", cost: 1200, fits: ["pistol", "smg", "shotgun", "rifle"] },
  { k: "scope", icon: "🔭", name: "Scope", what: "Tighter shots, and it zooms in when you aim.", cost: 3000, fits: ["rifle"] },
];
const ATT_KEY = "rb_world_attach";
// Perks: unlocked with tokens in the Combat panel, one on at a time (kept on this device and in your saved game).
export const PERKS = [
  { k: "quick", icon: "⚡", name: "Quick hands", what: "Reload a third faster.", cost: 100 },
  { k: "steady", icon: "🎯", name: "Steady aim", what: "A quarter less spread on every weapon.", cost: 120 },
  { k: "kevlar", icon: "🦺", name: "Kevlar weave", what: "Armour soaks 85% of a hit instead of 70%.", cost: 150 },
  { k: "scavenger", icon: "💵", name: "Scavenger", what: "Fallen crew drop twice the cash.", cost: 150 },
  { k: "insured", icon: "🩺", name: "Insured", what: "No clinic bill when you're wasted.", cost: 200 },
];
const PERK_KEY = "rb_world_perks";
const perks = (() => { try { const v = JSON.parse(store.get(PERK_KEY) || "{}"); return { own: Array.isArray(v.own) ? v.own : [], on: v.on || null }; } catch (e) { return { own: [], on: null }; } })();
const perk = (k) => perks.on === k;
// Security: guards hired for game money fight crews beside you while you're on foot with combat on.
const GUARD_COST = 3000, GUARD_MIN = 10, GUARD_MAX = 2;
const att = (() => { try { const a = JSON.parse(store.get(ATT_KEY) || "{}"); return a && typeof a === "object" ? a : {}; } catch (e) { return {}; } })();
const has = (id, k) => !!(id && att[id] && att[id][k]);
const magOf = (id) => Math.round(ARMS[id].mag * (has(id, "ext") ? 1.5 : 1));
const zoomOf = (id) => (id && (ARMS[id].zoom || (has(id, "scope") ? 6 : 0))) || 0;
const rnd = (a, b) => a + Math.random() * (b - a);

// ---------------------------------------------------------------- weapon models (metres; the barrel along +z)
const steel = new THREE.MeshStandardMaterial({ color: 0x1b1d20, metalness: 0.75, roughness: 0.38 });
const poly = new THREE.MeshStandardMaterial({ color: 0x0e0e0e, metalness: 0.1, roughness: 0.7 });
const wood = new THREE.MeshStandardMaterial({ color: 0x5a3b22, roughness: 0.65 });
const olive = new THREE.MeshStandardMaterial({ color: 0x3d4a2c, roughness: 0.75 });
function box(g, m, w, h, d, x, y, z, rx = 0) { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.rotation.x = rx; o.castShadow = true; g.add(o); return o; }
function tube(g, m, r, len, x, y, z, seg = 12) { const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), m); o.rotation.x = Math.PI / 2; o.position.set(x, y, z + len / 2); o.castShadow = true; g.add(o); return o; }
export function model(id, a = {}) {
  const g = new THREE.Group(), tip = new THREE.Object3D();
  if (id === "pistol") { box(g, steel, 0.03, 0.035, 0.19, 0, 0.03, 0.06); box(g, poly, 0.028, 0.11, 0.045, 0, -0.03, -0.01, -0.25); box(g, steel, 0.006, 0.012, 0.008, 0, 0.054, 0.15); box(g, steel, 0.02, 0.01, 0.008, 0, 0.052, -0.025); box(g, steel, 0.008, 0.03, 0.05, 0, -0.005, 0.04); tip.position.set(0, 0.035, 0.16); } // slide, grip, front and rear sights, trigger guard
  else if (id === "smg") { box(g, steel, 0.045, 0.06, 0.26, 0, 0.03, 0.06); tube(g, steel, 0.012, 0.09, 0, 0.04, 0.19); box(g, poly, 0.03, 0.1, 0.04, 0, -0.04, 0.0, -0.2); box(g, steel, 0.025, 0.14, 0.03, 0, -0.06, 0.1); box(g, poly, 0.03, 0.03, 0.16, 0, 0.03, -0.14); box(g, steel, 0.012, 0.03, 0.012, 0, 0.075, 0.15); box(g, steel, 0.022, 0.025, 0.02, 0, 0.072, -0.02); tip.position.set(0, 0.04, 0.29); }
  else if (id === "shotgun") { tube(g, steel, 0.016, 0.62, 0, 0.04, 0.0); tube(g, wood, 0.022, 0.2, 0, 0.0, 0.25); box(g, steel, 0.05, 0.07, 0.2, 0, 0.02, -0.1); box(g, wood, 0.045, 0.1, 0.32, 0, -0.01, -0.36, 0.12); tip.position.set(0, 0.04, 0.62); }
  else if (id === "rifle") { box(g, steel, 0.05, 0.08, 0.36, 0, 0.03, 0.05); tube(g, steel, 0.011, 0.34, 0, 0.045, 0.22); box(g, poly, 0.055, 0.06, 0.24, 0, 0.04, 0.33); box(g, steel, 0.03, 0.16, 0.06, 0, -0.06, 0.1, 0.25); box(g, poly, 0.035, 0.11, 0.045, 0, -0.04, -0.06, -0.3); box(g, poly, 0.04, 0.09, 0.26, 0, 0.0, -0.25); box(g, steel, 0.02, 0.04, 0.12, 0, 0.1, 0.04); box(g, steel, 0.012, 0.06, 0.012, 0, 0.09, 0.43); tube(g, steel, 0.018, 0.04, 0, 0.045, 0.56); tip.position.set(0, 0.045, 0.6); } // front sight post and muzzle brake
  else if (id === "sniper") { tube(g, steel, 0.013, 0.78, 0, 0.045, 0.05); box(g, poly, 0.05, 0.08, 0.36, 0, 0.02, -0.02); box(g, poly, 0.05, 0.12, 0.34, 0, -0.01, -0.34, 0.1); tube(g, steel, 0.025, 0.3, 0, 0.12, -0.05, 16); box(g, steel, 0.03, 0.1, 0.05, 0, -0.06, 0.05); tip.position.set(0, 0.045, 0.83); }
  else if (id === "rpg") { tube(g, olive, 0.045, 1.0, 0, 0.06, -0.45, 16); const war = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.24, 14), olive); war.rotation.x = Math.PI / 2; war.position.set(0, 0.06, 0.66); g.add(war); box(g, poly, 0.03, 0.11, 0.04, 0, -0.03, 0.05, -0.2); box(g, steel, 0.03, 0.06, 0.1, -0.06, 0.1, 0.0); tip.position.set(0, 0.06, 0.78); }
  // attachments (your own weapons only; other players see the plain one)
  if (a.sup) { tube(g, poly, id === "pistol" ? 0.017 : 0.022, 0.17, 0, tip.position.y, tip.position.z); tip.position.z += 0.17; }
  if (a.scope) { tube(g, poly, 0.022, 0.22, 0, 0.15, -0.06, 14); box(g, steel, 0.02, 0.03, 0.03, 0, 0.12, 0.02); }
  else if (a.dot) box(g, poly, 0.03, 0.035, 0.045, 0, { pistol: 0.072, smg: 0.1, shotgun: 0.085, rifle: 0.135 }[id] || 0.1, { pistol: 0.0, smg: 0.02, shotgun: -0.08, rifle: 0.0 }[id] || 0);
  if (a.ext && id !== "shotgun") box(g, steel, id === "pistol" ? 0.026 : 0.03, 0.08, 0.035, 0, id === "pistol" ? -0.11 : -0.17, id === "pistol" ? -0.02 : 0.1);
  g.add(tip); g.userData.tip = tip;
  return g;
}

// ---------------------------------------------------------------- sound: a gunshot is a crack, a body and a tail
let actx = null, noise = null;
function shot(spec, dist = 0) {
  try {
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume();
    if (!noise) { noise = actx.createBuffer(1, actx.sampleRate * 0.6, actx.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const [f, len, vol] = spec, far = Math.max(0.04, 1 - dist / 260), t = actx.currentTime;
    const src = actx.createBufferSource(); src.buffer = noise;
    const lp = actx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.setValueAtTime(f * (dist > 60 ? 0.5 : 1.6), t); lp.frequency.exponentialRampToValueAtTime(140, t + len);
    const g = actx.createGain(); g.gain.setValueAtTime(vol * far * 0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + len * (dist > 60 ? 2 : 1));
    src.connect(lp).connect(g).connect(actx.destination); src.start(t); src.stop(t + len * 2 + 0.05);
    const o = actx.createOscillator(); o.type = "triangle"; o.frequency.setValueAtTime(90 + f / 30, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    const og = actx.createGain(); og.gain.setValueAtTime(vol * far * 0.6, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(og).connect(actx.destination); o.start(t); o.stop(t + 0.16);
  } catch (e) {}
}
function click(f = 2400, v = 0.08) { try { actx ||= new (window.AudioContext || window.webkitAudioContext)(); const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain(); o.type = "square"; o.frequency.value = f; g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05); o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.06); } catch (e) {} }

export function initCombat(E, ctx, foot) {
  const car = E.car, CITY = E.city, cam = E.camera, P = ctx.player, scene = ctx.scene;
  const cfg = window.RB_WORLD_CFG || {};
  const allowed = () => cfg.combat !== false;
  const out = {
    on: false, armed: null, ammo: {}, enemies: [], mission: null, remote: new Map(), onRemoteHit: null, onShot: null, onDeath: [],
    reequip: () => arm(out.armed), hurt, remoteHit, feed, remoteShot, open: openPanel, ARMS, isDead: () => dead, stats: { fired: 0, hits: 0, kills: 0 },
  };
  out.on = allowed() && store.get(AGE_KEY) === "yes" && store.get(ON_KEY) === "on";
  if (out.on && !(P.weapons || []).length) { P.weapons = ["pistol"]; P.equippedWeapon = "pistol"; } // the starter pistol
  for (const k of ORDER) out.ammo[k] = magOf(k);
  foot.down = () => dead;
  let grenades = 3, streak = 0; // grenades this life; kills in a row without going down
  let reloading = 0, cool = 0, firing = false, lastHit = 0, dead = false, recoil = 0;

  // ---------------------------------------------------------------- HUD
  const css = document.createElement("style");
  css.textContent = `#rb-xhair{position:fixed;left:50%;top:50%;width:26px;height:26px;margin:-13px 0 0 -13px;z-index:7050;pointer-events:none;display:none}
#rb-xhair i{position:absolute;background:#fff;box-shadow:0 0 2px #000}#rb-xhair i:nth-child(1){left:12px;top:0;width:2px;height:8px}#rb-xhair i:nth-child(2){left:12px;bottom:0;width:2px;height:8px}#rb-xhair i:nth-child(3){top:12px;left:0;width:8px;height:2px}#rb-xhair i:nth-child(4){top:12px;right:0;width:8px;height:2px}
#rb-xhair.hit i{background:#ff3b3b}#rb-xhair.scope{width:100vw;height:100vh;left:0;top:0;margin:0;background:radial-gradient(circle,transparent 0 28vmin,rgba(0,0,0,.94) 28.3vmin)}#rb-xhair.scope i{left:50%!important;top:50%!important}
#rb-xhair.scope i:nth-child(1),#rb-xhair.scope i:nth-child(2){width:1px;height:28vmin;margin-left:0}#rb-xhair.scope i:nth-child(1){top:calc(50% - 28vmin)!important}#rb-xhair.scope i:nth-child(3),#rb-xhair.scope i:nth-child(4){height:1px;width:28vmin}#rb-xhair.scope i:nth-child(3){left:calc(50% - 28vmin)!important}
#rb-vitals{position:fixed;left:12px;bottom:calc(40px + env(safe-area-inset-bottom));z-index:6960;width:200px;display:none;font:800 10px/1 Inter,sans-serif;color:#fff;letter-spacing:1px;pointer-events:none}
body.rb-touch #rb-vitals{bottom:calc(216px + env(safe-area-inset-bottom));width:150px}
#rb-vitals .b{height:7px;border-radius:4px;background:rgba(0,0,0,.6);overflow:hidden;margin:4px 0}#rb-vitals .b i{display:block;height:100%;transition:width .2s}
#rb-vitals .hp i{background:linear-gradient(90deg,#1f9d55,#38d27a)}#rb-vitals .ar i{background:linear-gradient(90deg,#2d6cdf,#5aa0ff)}#rb-vitals .w{display:flex;justify-content:space-between;margin-top:6px;color:#F5E6A3;text-shadow:0 1px 2px #000}
#rb-dmgdir{position:fixed;left:50%;top:50%;width:220px;height:220px;margin:-110px 0 0 -110px;z-index:7045;pointer-events:none;opacity:0;transition:opacity .4s}#rb-dmgdir i{position:absolute;left:80px;top:0;width:60px;height:14px;border-radius:50% 50% 0 0;background:radial-gradient(ellipse at 50% 100%,rgba(255,40,40,.9),rgba(255,40,40,0) 70%)}
#rb-wheel{position:fixed;inset:0;z-index:7900;display:none;background:radial-gradient(circle,rgba(0,0,0,.55),rgba(0,0,0,.25) 60%,transparent 75%)}#rb-wheel button{position:absolute;transform:translate(-50%,-50%);width:118px;padding:10px 8px;border-radius:14px;border:1px solid rgba(201,168,76,.45);background:rgba(10,10,10,.85);color:#fff;font:800 11px/1.25 Inter,sans-serif;cursor:pointer}#rb-wheel button span{display:block;font-weight:600;color:#F5E6A3;margin-top:3px}#rb-wheel button.on{border-color:#F5E6A3;background:rgba(201,168,76,.35)}#rb-wheel .mid{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font:900 12px Inter,sans-serif;letter-spacing:3px;color:#F5E6A3}
#rb-hurt{position:fixed;inset:0;z-index:7040;pointer-events:none;box-shadow:inset 0 0 140px rgba(190,0,0,.0);transition:box-shadow .15s}
#rb-feed{position:fixed;right:12px;top:120px;z-index:7000;display:grid;gap:4px;justify-items:end;pointer-events:none;font:700 11px/1.2 Inter,sans-serif}#rb-feed div{background:rgba(0,0,0,.7);color:#fff;border-radius:8px;padding:5px 9px}
#rb-wasted{position:fixed;inset:0;z-index:8500;display:none;align-items:center;justify-content:center;flex-direction:column;background:rgba(40,40,40,.55);backdrop-filter:grayscale(1);-webkit-backdrop-filter:grayscale(1);pointer-events:none}
#rb-wasted b{font:900 64px/1 Orbitron,Inter,sans-serif;color:#c33;letter-spacing:6px;text-shadow:0 3px 8px #000}#rb-wasted span{color:#fff;font:700 13px Inter,sans-serif;margin-top:12px;text-shadow:0 1px 4px #000}
#rb-mchip{position:fixed;left:50%;transform:translateX(-50%);top:calc(var(--rb-under,120px) + 40px);z-index:7000;display:none;background:rgba(40,0,0,.85);border:1px solid #ff3b3b;border-radius:12px;padding:6px 14px;color:#fff;font:800 12px/1.3 Inter,sans-serif;text-align:center;pointer-events:none}
.rb-cpad{position:fixed;right:162px;bottom:calc(282px + env(safe-area-inset-bottom));z-index:6900;display:none;grid-template-columns:64px 64px;gap:10px;touch-action:none;user-select:none;-webkit-user-select:none}
.rb-cpad button{height:64px;border-radius:18px;border:1px solid rgba(255,80,80,.6);background:rgba(0,0,0,.55);color:#fff;font:900 11px/1.1 Inter,sans-serif;letter-spacing:1px;touch-action:none}.rb-cpad button.on{background:rgba(220,40,40,.6)}
body.rb-onfoot.rb-touch.rb-armed .rb-cpad{display:grid}body.rb-photo .rb-cpad,body.rb-photo #rb-vitals,body.rb-photo #rb-xhair{display:none!important}
body:has(.overlay[style*="flex"]) .rb-cpad,body:has(.overlay[style*="flex"]) #rb-xhair,body:has(.overlay[style*="flex"]) #rb-mchip,body:has(#rb-phone.open) .rb-cpad,body:has(#rb-phone.open) #rb-xhair{display:none!important}
.rb-age{border:1px solid #ff3b3b;border-radius:12px;padding:12px;margin:10px 0;background:rgba(255,59,59,.08);font-size:12px;line-height:1.45}`;
  document.head.appendChild(css);
  const mk = (tag, id, html) => { const e = document.createElement(tag); if (id) e.id = id; if (html) e.innerHTML = html; document.body.appendChild(e); return e; };
  const xh = mk("div", "rb-xhair", "<i></i><i></i><i></i><i></i>");
  const vit = mk("div", "rb-vitals", '<div>HEALTH</div><div class="b hp"><i></i></div><div>ARMOUR</div><div class="b ar"><i></i></div><div class="w"><span id="rb-wname"></span><span id="rb-ammo"></span></div>');
  const dir = mk("div", "rb-dmgdir", "<i></i>");
  const hurtFx = mk("div", "rb-hurt"), feedBox = mk("div", "rb-feed"), wasted = mk("div", "rb-wasted", "<b>WASTED</b><span></span>"), mchip = mk("div", "rb-mchip");
  const pad = mk("div", null, '<button data-k="aim">AIM</button><button data-k="fire">FIRE</button><button data-k="reload">RELOAD</button><button data-k="next">NEXT</button><button data-k="nade">GRENADE</button><button data-k="view">VIEW</button>'); pad.className = "rb-cpad";
  function hud() {
    const show = out.on && foot.on && !dead;
    vit.style.display = out.on ? "block" : "none";
    vit.querySelector(".hp i").style.width = Math.max(0, P.health) + "%";
    vit.querySelector(".ar i").style.width = Math.min(100, P.armor || 0) + "%";
    const w = out.armed && ARMS[out.armed];
    document.getElementById("rb-wname").textContent = w ? w.name.toUpperCase() : out.on ? "UNARMED" : "";
    document.getElementById("rb-ammo").textContent = (w ? (reloading > 0 ? "RELOADING" : out.ammo[out.armed] + " / " + magOf(out.armed)) : "") + (out.on ? `  ·  💣 ${grenades}` : "");
    xh.style.display = show && w && (foot.aim || matchMedia("(pointer:fine)").matches) && !(foot.fp && foot.aim && !zoomOf(out.armed)) ? "block" : "none";
    xh.classList.toggle("scope", !!(show && w && zoomOf(out.armed) && foot.aim));
    document.body.classList.toggle("rb-armed", !!(show && w));
  }
  function feed(text) { const d = document.createElement("div"); d.textContent = text; feedBox.prepend(d); while (feedBox.children.length > 4) feedBox.lastChild.remove(); setTimeout(() => d.remove(), 7000); }

  // ---------------------------------------------------------------- the opt-in panel
  function owned() { const own = new Set(P.weapons || []); return ORDER.filter((k) => own.has(k)); }
  function openPanel() {
    if (!allowed()) { E.panel(`<h2>COMBAT</h2><p class="rb-muted">Combat is switched off in RB World right now.</p><button class="btn-ghost" data-e="x">CLOSE</button>`, { x: E.hidePanel }); return; }
    if (store.get(AGE_KEY) !== "yes") {
      E.panel(`<h2>COMBAT · 18+</h2><div class="rb-age"><b>This mode contains realistic gun violence.</b><br>It's for players aged 18 or older. Turn it on to carry the weapons you buy in the Armory, take combat missions and fight other players who've turned it on too. People on the street are never hurt, and you can turn it off at any time.</div>
        <button class="btn-gold" data-e="yes">I'M 18 OR OLDER · TURN IT ON</button><button class="btn-ghost" data-e="no">NOT NOW</button>`,
        { yes: () => { store.set(AGE_KEY, "yes"); setOn(true); openPanel(); }, no: E.hidePanel });
      return;
    }
    const own = owned(), m = out.mission, attActs = {};
    const H3 = (t) => `<h3 style="font:800 11px Inter,sans-serif;color:var(--gold);letter-spacing:2px;margin:14px 0 6px">${t}</h3>`;
    const perkRows = H3("PERK (ONE AT A TIME)") + PERKS.map((x) => { const got = perks.own.includes(x.k), on = perks.on === x.k; attActs["p-" + x.k] = () => setPerk(x);
      return `<div class="rb-card"><div><b>${x.icon} ${x.name}</b><div class="rb-muted">${x.what}</div></div><button class="rb-btn" data-e="p-${x.k}" ${on || (!got && (P.tokens || 0) < x.cost) ? "disabled" : ""}>${on ? "ON" : got ? "USE" : x.cost + " TOKENS"}</button></div>`; }).join("");
    const live = guards.filter((g) => g.until > Date.now());
    attActs.hire = hireGuard;
    const guardRows = H3("SECURITY") + `<div class="rb-card"><div><b>🕴️ Hire a guard</b><div class="rb-muted">${E.money(GUARD_COST)} for ${GUARD_MIN} minutes. Guards follow you on foot and fight crews beside you (not the police). Up to ${GUARD_MAX}. ${live.length ? `On duty: ${live.map((g) => Math.ceil((g.until - Date.now()) / 60000) + " min").join(", ")}.` : ""}</div></div><button class="rb-btn" data-e="hire" ${!out.on || live.length >= GUARD_MAX || P.netWorth < GUARD_COST ? "disabled" : ""}>HIRE</button></div>`;
    const attRows = own.length ? `<h3 style="font:800 11px Inter,sans-serif;color:var(--gold);letter-spacing:2px;margin:14px 0 6px">ATTACHMENTS</h3>` + own.map((id) => {
      const list = ATTACH.filter((a) => a.fits.includes(id)); if (!list.length) return "";
      return `<div class="rb-card" style="display:block"><b>${ARMS[id].name}</b>${list.map((a) => { attActs[`a-${id}-${a.k}`] = () => fit(id, a);
        return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:6px"><div class="rb-muted">${a.icon} <b>${a.name}</b>: ${a.what}</div><button class="rb-btn" data-e="a-${id}-${a.k}" ${has(id, a.k) || P.netWorth < a.cost ? "disabled" : ""}>${has(id, a.k) ? "FITTED" : E.money(a.cost)}</button></div>`; }).join("")}</div>`;
    }).join("") : "";
    const rows = MISSIONS.map((x) => `<div class="rb-card"><div><b>${x.icon} ${x.name}</b><div class="rb-muted">${x.desc}</div><div class="rb-muted">Pays ${E.money(x.pay)} + ${x.tokens} tokens</div></div><button class="rb-btn" data-e="m-${x.key}" ${!out.on || m ? "disabled" : ""}>START</button></div>`).join("");
    E.panel(`<h2>COMBAT · 18+</h2><div class="rb-muted">Combat is <b style="color:${out.on ? "var(--green)" : "var(--red)"}">${out.on ? "ON" : "OFF"}</b>. Weapons: ${own.length ? own.map((k) => ARMS[k].name).join(", ") : "none yet"}.</div>
      <div class="rb-muted">Get out of the car (F) to use them. Right mouse aims, left mouse fires, R reloads, 1-6 switch, X puts it away. On a phone: AIM, FIRE, RELOAD and NEXT.</div>
      <button class="btn-gold" data-e="toggle">${out.on ? "TURN COMBAT OFF" : "TURN COMBAT ON"}</button>
      <button class="btn-ghost" data-e="shop">ARMORY (BUY WEAPONS AND ARMOUR)</button>
      ${m ? `<div class="rb-card"><div><b>${m.def.icon} ${m.def.name}</b><div class="rb-muted">${m.say || ""}</div></div><button class="rb-btn" data-e="quit">GIVE UP</button></div>` : ""}
      <h3 style="font:800 11px Inter,sans-serif;color:var(--gold);letter-spacing:2px;margin:14px 0 6px">MISSIONS</h3>${rows}
      ${attRows}${perkRows}${guardRows}
      <button class="btn-ghost" data-e="x">CLOSE</button>`,
      { toggle: () => { setOn(!out.on); openPanel(); }, shop: () => { E.hidePanel(); const b = document.getElementById("btn-shop"); if (b) b.click(); }, x: E.hidePanel, quit: () => { endMission(false, "You gave up."); E.hidePanel(); },
        ...Object.fromEntries(MISSIONS.map((x) => ["m-" + x.key, () => { E.hidePanel(); startMission(x); }])), ...attActs });
  }
  function fit(id, a) {
    if (!(P.weapons || []).includes(id) || !a.fits.includes(id) || has(id, a.k) || P.netWorth < a.cost) return;
    P.netWorth -= a.cost; const w = (att[id] ||= {}); w[a.k] = 1;
    if (a.k === "scope") delete w.dot; if (a.k === "dot") delete w.scope;
    store.set(ATT_KEY, JSON.stringify(att)); ctx.sync && ctx.sync(); ctx.play && ctx.play("cash");
    delete models[id]; if (a.k === "ext") out.ammo[id] = magOf(id);
    if (out.armed === id) arm(id);
    E.toast(`${a.icon} ${a.name} fitted to the ${ARMS[id].name}.`); openPanel();
  }
  function setPerk(x) {
    if (!perks.own.includes(x.k)) { if ((P.tokens || 0) < x.cost) return; P.tokens -= x.cost; perks.own.push(x.k); ctx.sync && ctx.sync(); ctx.play && ctx.play("cash"); }
    perks.on = x.k; store.set(PERK_KEY, JSON.stringify(perks)); E.toast(`${x.icon} Perk on: ${x.name}.`); openPanel();
  }
  // ---------------------------------------------------------------- security guards
  const guards = [];
  function hireGuard() {
    const live = guards.filter((g) => g.until > Date.now());
    if (!out.on || live.length >= GUARD_MAX || P.netWorth < GUARD_COST) return;
    P.netWorth -= GUARD_COST; ctx.sync && ctx.sync(); ctx.play && ctx.play("cash");
    guards.push({ until: Date.now() + GUARD_MIN * 60000, mesh: null, x: car.x, z: car.z, h: 0, cool: 1, side: guards.length % 2 ? 1 : -1 });
    E.toast(`🕴️ A guard is on duty for ${GUARD_MIN} minutes. Get out of the car (F) and they're with you.`); openPanel();
  }
  function guardLOS(ax, az, bx, bz) { const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / 1.5); for (let i = 1; i < n; i++) { const t = i / n; if (CITY.blocked(ax + (bx - ax) * t, az + (bz - az) * t, 0)) return false; } return true; }
  function guardsTick(dt) {
    const now = Date.now();
    for (let i = guards.length - 1; i >= 0; i--) {
      const g = guards[i];
      if (g.until <= now || !out.on) { if (g.mesh) scene.remove(g.mesh); guards.splice(i, 1); if (out.on) feed("🕴️ A guard's shift ended"); continue; }
      if (!foot.on || dead) { if (g.mesh) g.mesh.visible = false; g.x = car.x; g.z = car.z; continue; }
      if (!g.mesh) { g.mesh = person({ top: 0x101010, jacket: 0x0b0b0b, pants: 0x111111, style: "buzz", beard: false }); gun(g.mesh, model(i % 2 ? "rifle" : "smg")); scene.add(g.mesh); }
      g.mesh.visible = true;
      // keep a step behind you, one either side
      const tx = car.x - Math.sin(foot.yaw) * 2.2 + Math.cos(foot.yaw) * 1.6 * g.side, tz = car.z - Math.cos(foot.yaw) * 2.2 - Math.sin(foot.yaw) * 1.6 * g.side;
      const dx = tx - g.x, dz = tz - g.z, d = Math.hypot(dx, dz);
      if (d > 25) { g.x = tx; g.z = tz; }
      else if (d > 0.6) { const sp = Math.min(d * 2, 6) * dt, nx = g.x + (dx / d) * sp, nz = g.z + (dz / d) * sp; if (!CITY.blocked(nx, nz, 0.3)) { g.x = nx; g.z = nz; } g.h = Math.atan2(dx, dz); }
      // the nearest crew member it can see
      let tgt = null, td = 40;
      for (const e of out.enemies) { if (e.dead || e.cop) continue; const ed = Math.hypot(e.x - g.x, e.z - g.z); if (ed < td && (e.alert || ed < 20) && guardLOS(g.x, g.z, e.x, e.z)) { td = ed; tgt = e; } }
      g.cool -= dt;
      if (tgt) {
        g.h = Math.atan2(tgt.x - g.x, tgt.z - g.z);
        if (g.cool <= 0) {
          g.cool = rnd(0.7, 1.3); out.guardShots = (out.guardShots || 0) + 1;
          const a = new THREE.Vector3(g.x, 1.4, g.z), b = new THREE.Vector3(tgt.x, 1.2, tgt.z); tracer(a, b); flash(a); shot(ARMS.rifle.snd, Math.hypot(g.x - car.x, g.z - car.z));
          if (Math.random() < 0.45) damageEnemy(tgt, 22, false, true);
          tgt.alert = true;
        }
      }
      g.mesh.position.set(g.x, 0, g.z); g.mesh.rotation.y = g.h; g.mesh.userData.aiming = !!tgt;
      pose(g.mesh, d > 0.6 && d <= 25 ? (d > 4 ? "run" : "walk") : "idle", dt, Math.min(6, d * 2));
    }
    window.__rbGuards = guards.length;
  }
  out.perks = perks; out.guards = guards; out.hireGuard = hireGuard;
  function setOn(v) {
    out.on = !!v && allowed(); store.set(ON_KEY, out.on ? "on" : "off");
    if (out.on && !(P.weapons || []).length) { P.weapons = ["pistol"]; P.equippedWeapon = "pistol"; feed("Starter pistol added. Buy more in the Armory."); }
    if (!out.on) { arm(null); if (out.mission) endMission(false, "Combat turned off."); } else if (foot.on) arm(P.equippedWeapon || owned()[0] || null);
    E.toast(out.on ? "⚔️ Combat on. Get out of the car (F) to draw your weapon." : "Combat off.");
    hud();
  }
  const btn = document.getElementById("btn-combat"); if (btn) btn.onclick = openPanel;

  // ---------------------------------------------------------------- weapons in hand
  const models = {};
  function arm(id) {
    if (id && !(P.weapons || []).includes(id)) return;
    out.armed = id; reloading = 0;
    if (id) P.equippedWeapon = id;
    gun(foot.me, id ? (models[id] ||= model(id, att[id])) : null);
    vmArm(id);
    if (!id) foot.aim = false;
    hud();
  }
  foot.onExit.push(() => { if (out.on) arm(P.equippedWeapon && (P.weapons || []).includes(P.equippedWeapon) ? P.equippedWeapon : owned()[0] || null); hud(); });
  foot.onEnter.push(() => { foot.aim = false; firing = false; hud(); });
  function cycle(dir) { const own = owned(); if (!own.length) return; const i = own.indexOf(out.armed); arm(own[(i + dir + own.length) % own.length]); click(1800, 0.05); }
  function reload() { const w = out.armed && ARMS[out.armed]; if (!w || reloading > 0 || out.ammo[out.armed] >= magOf(out.armed)) return; reloading = w.reload * (perk("quick") ? 0.65 : 1); click(900, 0.06); hud(); }

  // ---------------------------------------------------------------- input
  const typing = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "");
  const canvas = document.getElementById("three-canvas");
  // the weapon wheel: hold Tab, point at a weapon (or press its number), let go to take it
  const wheel = mk("div", "rb-wheel"); let wheelOn = false, wheelPick = null;
  function wheelShow(on) {
    wheelOn = on; wheel.style.display = on ? "block" : "none";
    if (!on) { if (wheelPick !== null) arm(wheelPick); return; }
    const own = owned(), all = [null, ...own], n = all.length; wheelPick = out.armed;
    wheel.innerHTML = all.map((k, i) => { const a = (i / n) * Math.PI * 2 - Math.PI / 2, x = Math.cos(a) * 120, y = Math.sin(a) * 120;
      return `<button type="button" data-k="${k || ""}" style="left:calc(50% + ${x}px);top:calc(50% + ${y}px)" class="${k === out.armed ? "on" : ""}"><b>${k ? ARMS[k].name : "Unarmed"}</b><span>${k ? out.ammo[k] + " / " + magOf(k) : "fists away"}</span></button>`; }).join("") + '<div class="mid">WEAPONS</div>';
    wheel.querySelectorAll("button").forEach((b) => { const pickIt = () => { wheelPick = b.dataset.k || null; wheel.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); }; b.addEventListener("mouseenter", pickIt); b.addEventListener("click", () => { pickIt(); wheelShow(false); }); });
  }
  window.addEventListener("keydown", (e) => {
    if (typing() || !out.on || !foot.on) return;
    if (e.code === "Tab") { e.preventDefault(); if (!e.repeat) { if (document.pointerLockElement) document.exitPointerLock(); wheelShow(true); } return; }
    if (e.code === "KeyR") reload();
    else if (e.code === "KeyX") arm(null);
    else if (/^Digit[1-6]$/.test(e.code)) { const k = ORDER[Number(e.code.slice(5)) - 1]; if ((P.weapons || []).includes(k)) arm(k); }
  });
  canvas.addEventListener("contextmenu", (e) => { if (foot.on) e.preventDefault(); });
  canvas.addEventListener("mousedown", (e) => {
    if (!out.on || !foot.on || !out.armed) return;
    if (e.button === 2) { foot.aim = true; hud(); }
    if (e.button === 0 && (document.pointerLockElement === canvas || foot.aim)) { firing = true; trigger(); }
  });
  window.addEventListener("keyup", (e) => { if (e.code === "Tab" && wheelOn) wheelShow(false); });
  window.addEventListener("mouseup", (e) => { if (e.button === 2) { foot.aim = false; hud(); } if (e.button === 0) firing = false; });
  canvas.addEventListener("wheel", (e) => { if (out.on && foot.on) cycle(e.deltaY > 0 ? 1 : -1); }, { passive: true });
  pad.querySelectorAll("button").forEach((b) => {
    const k = b.dataset.k;
    b.addEventListener("touchstart", (e) => { e.preventDefault(); if (k === "aim") { foot.aim = !foot.aim; b.classList.toggle("on", foot.aim); } else if (k === "fire") { firing = true; b.classList.add("on"); trigger(); } else if (k === "reload") reload(); else if (k === "next") cycle(1); else if (k === "nade") throwGrenade(); else if (k === "view") foot.view(); hud(); }, { passive: false });
    const up = (e) => { e.preventDefault(); if (k === "fire") { firing = false; b.classList.remove("on"); } };
    b.addEventListener("touchend", up); b.addEventListener("touchcancel", up);
  });

  // ---------------------------------------------------------------- shooting
  const ray = { o: new THREE.Vector3(), d: new THREE.Vector3() };
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  // ray against a standing person: a vertical cylinder, radius r, feet at y0, top at y1 → [t, head?] or null
  function hitPerson(o, d, x, z, y0, maxT) {
    const ox = o.x - x, oz = o.z - z, a = d.x * d.x + d.z * d.z, b = 2 * (ox * d.x + oz * d.z), c = ox * ox + oz * oz - 0.34 * 0.34;
    const disc = b * b - 4 * a * c; if (disc < 0 || a < 1e-6) return null;
    const t = (-b - Math.sqrt(disc)) / (2 * a); if (t < 0 || t > maxT) return null;
    const y = o.y + d.y * t - y0; if (y < 0 || y > 1.85) return null;
    return [t, y > 1.5];
  }
  // how far the shot goes before a building, the ground or a car stops it
  function worldHit(o, d, from, maxT) {
    for (let t = from; t < maxT; t += 0.6) {
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (y <= 0) return [t, "ground"];
      if (y < 14 && CITY.blocked(x, z, 0)) return [t, "wall"];
      if (y < 1.5) for (const c of E.traffic()) if (Math.abs(c.x - x) < 1.1 && Math.abs(c.z - z) < 1.1) return [t, "car"];
    }
    return [maxT, null];
  }
  function trigger() {
    if (!out.on || !foot.on || dead || !out.armed || cool > 0 || reloading > 0) return;
    const id = out.armed, w = ARMS[id];
    if (out.ammo[id] <= 0) { click(); reload(); return; }
    out.ammo[id]--; cool = 60 / w.rpm; out.stats.fired++;
    // from the camera through the crosshair; the shot starts level with you, not behind you
    cam.getWorldDirection(ray.d); ray.o.copy(cam.position);
    const chest = tmp.set(car.x, 1.4 + foot.y, car.z), from = Math.max(0, tmp2.copy(chest).sub(ray.o).dot(ray.d));
    const muzzle = new THREE.Vector3(); ((foot.fp && vm.gun ? vm.gun : models[id]).userData.tip).getWorldPosition(muzzle);
    let first = null;
    if (w.rocket) { rocket(muzzle, ray.d.clone(), from); first = muzzle.clone().addScaledVector(ray.d, 60); }
    else for (let i = 0; i < (w.pellets || 1); i++) {
      const sp = w.spread * (foot.aim ? (has(id, "dot") || has(id, "scope") ? 0.4 : 0.6) : 1.4) * (foot.speed > 1 ? 1.6 : 1) * (perk("steady") ? 0.75 : 1);
      const d = ray.d.clone().add(new THREE.Vector3(rnd(-sp, sp), rnd(-sp, sp), rnd(-sp, sp))).normalize();
      const end = bullet(ray.o, d, from, w, id, muzzle); first ||= end; suppress(ray.o, d, w.range);
    }
    if (out.onShot) out.onShot(muzzle, first, id); // live.js: other players see the shot
    const quiet = has(id, "sup"); if (!quiet) flash(muzzle); shot(quiet ? [w.snd[0] * 0.45, w.snd[1] * 0.6, w.snd[2] * 0.3] : w.snd); recoil += w.kick;
    foot.me.userData.recoil = (foot.me.userData.recoil || 0) + w.kick * 3; vm.kick += w.kick * 2.2;
    foot.pitch = Math.min(0.75, foot.pitch + w.kick * 0.6); foot.yaw += rnd(-w.kick, w.kick) * 0.3;
    gunfire(car.x, car.z, quiet ? 18 : 60, quiet);
    if (out.ammo[id] <= 0) setTimeout(reload, 250);
    hud();
  }
  function bullet(o, d, from, w, id, muzzle) {
    const base = w.dmg * (has(id, "sup") ? 0.9 : 1);
    let [best, what] = worldHit(o, d, from, w.range), target = null, head = false;
    for (const e of out.enemies) { if (e.dead) continue; const h = hitPerson(o, d, e.x, e.z, 0, best); if (h && h[0] > from) { best = h[0]; head = h[1]; target = e; what = "enemy"; } }
    for (const [rid, r] of out.remote) { if (!r.combat || !r.alive) continue; const h = hitPerson(o, d, r.x, r.z, r.y || 0, best); if (h && h[0] > from) { best = h[0]; head = h[1]; target = rid; what = "player"; } }
    const end = o.clone().addScaledVector(d, best);
    tracer(muzzle, end);
    if (what === "enemy" || what === "player") out.stats.hits++;
    if (what === "enemy") { damageEnemy(target, base * (head ? 2.5 : 1), head); marker(target.hp <= 0); }
    else if (what === "player") { if (out.onRemoteHit) out.onRemoteHit(target, Math.round(base * (head ? 2.5 : 1)), head, id); marker(false); }
    else if (what) puff(end, what === "car" ? 0xffcc66 : 0xbbb2a0);
    return end;
  }
  // ---------------------------------------------------------------- the RPG
  const rockets = [];
  function rocket(from, d, skip) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 8), new THREE.MeshBasicMaterial({ color: 0xffaa33 }));
    m.rotation.x = Math.PI / 2; const g = new THREE.Group(); g.add(m); g.position.copy(from); g.lookAt(from.clone().add(d)); scene.add(g);
    rockets.push({ g, d, t: 0, skip });
  }
  function rocketsTick(dt) {
    for (let i = rockets.length - 1; i >= 0; i--) {
      const r = rockets[i]; r.t += dt; const step = 70 * dt, p = r.g.position;
      const next = p.clone().addScaledVector(r.d, step);
      let boom = next.y <= 0 || (next.y < 14 && CITY.blocked(next.x, next.z, 0)) || r.t > 4.5;
      for (const e of out.enemies) if (!e.dead && Math.hypot(e.x - next.x, e.z - next.z) < 0.8 && next.y < 2) boom = true;
      for (const [, rp] of out.remote) if (rp.combat && rp.alive && Math.hypot(rp.x - next.x, rp.z - next.z) < 0.8 && next.y < 2) boom = true;
      if (boom) { explode(next); scene.remove(r.g); rockets.splice(i, 1); } else { p.copy(next); puff(p.clone(), 0x999999, 0.25, 0.6); }
    }
  }
  function explode(at, w = ARMS.rpg, kind = "rpg", what = "your own rocket") {
    shot([300, 0.9, 1]);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff8a2a).multiplyScalar(3), transparent: true, opacity: 0.9, depthWrite: false }));
    ball.position.copy(at); ball.userData.noAO = true; scene.add(ball); fxs.push({ o: ball, t: 0.6, grow: 9 });
    const light = new THREE.PointLight(0xff9a40, 400, 40); light.position.copy(at).add(new THREE.Vector3(0, 2, 0)); scene.add(light); fxs.push({ o: light, t: 0.35 });
    for (const e of out.enemies) { const d = Math.hypot(e.x - at.x, e.z - at.z); if (!e.dead && d < w.blast) damageEnemy(e, w.dmg * (1 - d / w.blast), false); }
    for (const [rid, rp] of out.remote) { const d = Math.hypot(rp.x - at.x, rp.z - at.z); if (rp.combat && rp.alive && d < w.blast && out.onRemoteHit) out.onRemoteHit(rid, Math.round(w.dmg * (1 - d / w.blast)), false, kind); }
    const me = Math.hypot(car.x - at.x, car.z - at.z); if (me < w.blast) hurt(Math.round(120 * (1 - me / w.blast)), what);
    gunfire(at.x, at.z, 90);
  }

  // ---------------------------------------------------------------- effects: tracers, muzzle flash, impacts
  const fxs = [];
  const tracerMat = new THREE.LineBasicMaterial({ color: 0xffe6a0, transparent: true, opacity: 0.85 });
  function tracer(a, b) { const g = new THREE.BufferGeometry().setFromPoints([a, b]); const l = new THREE.Line(g, tracerMat.clone()); l.userData.noAO = true; scene.add(l); fxs.push({ o: l, t: 0.07, geo: g }); }
  const flashMat = new THREE.SpriteMaterial({ color: new THREE.Color(0xffc060).multiplyScalar(4), transparent: true, depthWrite: false });
  function flash(at) {
    const s = new THREE.Sprite(flashMat); s.position.copy(at); s.scale.setScalar(rnd(0.35, 0.55)); s.userData.noAO = true; scene.add(s); fxs.push({ o: s, t: 0.05 });
    const l = new THREE.PointLight(0xffb050, 30, 9); l.position.copy(at); scene.add(l); fxs.push({ o: l, t: 0.05 });
  }
  const puffGeo = new THREE.SphereGeometry(0.12, 6, 5);
  function puff(at, color, size = 1, life = 0.35) { const m = new THREE.Mesh(puffGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false })); m.position.copy(at); m.scale.setScalar(size); m.userData.noAO = true; scene.add(m); fxs.push({ o: m, t: life, grow: 3 }); }
  function fxTick(dt) {
    for (let i = fxs.length - 1; i >= 0; i--) {
      const f = fxs[i]; f.t -= dt;
      if (f.grow) f.o.scale.multiplyScalar(1 + f.grow * dt);
      if (f.o.material && f.o.material.opacity != null && f.o.material !== flashMat) f.o.material.opacity = Math.max(0, f.o.material.opacity - dt * 2.5);
      if (f.t <= 0) { scene.remove(f.o); if (f.geo) f.geo.dispose(); if (f.o.material && f.o.material !== flashMat && f.o.material !== tracerMat) f.o.material.dispose?.(); fxs.splice(i, 1); }
    }
  }
  let markT = 0;
  function marker(kill) { xh.classList.add("hit"); markT = kill ? 0.35 : 0.15; click(kill ? 600 : 3200, 0.05); }
  function remoteShot(a, b, weapon) { const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b); tracer(A, B); flash(A); shot((ARMS[weapon] || ARMS.pistol).snd, Math.hypot(a[0] - car.x, a[2] - car.z)); }

  // gunfire: people scatter, crews hear it, and outside a mission area the cops come
  function gunfire(x, z, r = 60, quiet = false) {
    if (window.RBPeds && window.RBPeds.scare) window.RBPeds.scare(x, z, r);
    for (const e of out.enemies) if (!e.dead && Math.hypot(e.x - x, e.z - z) < r) e.alert = true;
    const m = out.mission, inside = m && m.at && Math.hypot(m.at[0] - x, m.at[1] - z) < 90;
    if (!quiet && !inside && E.wanted() < 2) { E.setWanted(2); E.toast("🚨 Shots fired. The cops are on their way.", true); }
  }

  // ---------------------------------------------------------------- you getting hurt
  function hurt(n, by, from) {
    if (dead || !out.on) return;
    let left = n;
    if ((P.armor || 0) > 0) { const a = Math.min(P.armor, Math.round(left * (perk("kevlar") ? 0.85 : 0.7))); P.armor -= a; left -= a; }
    P.health = Math.max(0, Math.round(P.health - left)); ouch(from);
    if (P.health <= 0) die(by);
    hud();
  }
  // a hit from another player: the live room has already worked out your health and armour
  function remoteHit(hp, ar, by, from) {
    if (dead || !out.on) return;
    P.health = Math.max(0, Math.round(hp)); P.armor = Math.max(0, Math.round(ar)); ouch(from);
    if (P.health <= 0) die(by);
    hud();
  }
  // the red flash, and a marker round the crosshair pointing at whoever shot you
  function ouch(from) {
    lastHit = performance.now();
    hurtFx.style.boxShadow = "inset 0 0 160px rgba(200,0,0,.75)"; setTimeout(() => (hurtFx.style.boxShadow = "inset 0 0 140px rgba(190,0,0,0)"), 160);
    if (from) {
      const view = foot.on ? foot.yaw : car.heading; let rel = Math.atan2(from[0] - car.x, from[1] - car.z) - view; rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      dir.style.transform = `rotate(${(-rel * 180) / Math.PI}deg)`; dir.style.opacity = "1"; clearTimeout(dir.t); dir.t = setTimeout(() => (dir.style.opacity = "0"), 900);
    }
  }
  function die(by) {
    if (dead) return; dead = true; streak = 0; grenades = 3; P.deaths = (P.deaths || 0) + 1; P.streak = 0;
    out.onDeath.forEach((f) => f(by));
    const bill = perk("insured") ? 0 : Math.min(5000, Math.round(P.netWorth * 0.1));
    P.netWorth = Math.max(0, P.netWorth - bill);
    wasted.querySelector("span").textContent = (by ? "Taken out by " + by + ". " : "") + "Clinic bill: " + E.money(bill);
    wasted.style.display = "flex"; firing = false; foot.aim = false;
    if (foot.on) foot.me.userData.k.down = 0;
    if (out.mission) endMission(false, "You were taken out.");
    E.setWanted(0);
    setTimeout(respawn, 3600);
    ctx.sync && ctx.sync();
  }
  function respawn() {
    const [x, z, h] = CITY.START;
    P.health = 100; dead = false; wasted.style.display = "none";
    // back by RB Plaza, next to your car
    const park = foot.on && foot.parked ? foot.parked : null;
    if (park) { park.x = x; park.z = z; park.h = h; park.mesh.position.set(x, 0, z); park.mesh.rotation.y = h; car.x = x + Math.cos(h) * 1.6; car.z = z - Math.sin(h) * 1.6; }
    else { car.x = x; car.z = z; car.heading = h; car.vx = car.vz = 0; car.speed = 0; if (car.mesh) { car.mesh.position.set(x, 0, z); car.mesh.rotation.y = h; } }
    hud(); feed("Patched up by RB Plaza.");
  }

  // ---------------------------------------------------------------- crews (combat missions) and armed police
  // Crews fight like people who want to live: each picks a spot behind a wall that hides it from you, crouches
  // there, leans out to fire a burst, ducks back to reload, and moves to new cover when you flank it or it's
  // pinned by your fire. One in three is a rusher who comes straight for you. With 3+ wanted stars and combat on,
  // cops who reach you get out with their weapons; shooting them adds stars. Fallen crew drop cash.
  const CREW_TOPS = [0x1d1d1d, 0x3a2a1a, 0x2a2f3a, 0x4a1a1a, 0x22331f];
  const MAGS = { pistol: 8, smg: 20, rifle: 18 };
  function spawnEnemy(x, z, kind = "pistol", vest = false, cop = false) {
    const p = person(cop ? { top: 0x1b2a4a, pants: 0x14161c, vest: true, hair: 0x111111, style: "cap", capColor: 0x14213d, beard: false }
      : { top: CREW_TOPS[Math.floor(Math.random() * CREW_TOPS.length)], pants: 0x1a1a1a, vest, hood: !vest && Math.random() < 0.5, jacket: !vest && Math.random() < 0.35 ? 0x2a2a2a : null });
    gun(p, model(kind)); p.position.set(x, 0, z); scene.add(p);
    const e = { p, x, z, h: Math.random() * 6.28, hp: vest || cop ? 150 : 100, kind, cop, alert: cop, dead: false, cool: rnd(0.5, 1.5), deadT: 0,
      rusher: !cop && Math.random() < 0.33, state: "move", cover: null, peek: null, t: 0, mag: MAGS[kind] || 10, pinned: 0 };
    out.enemies.push(e); return e;
  }
  function damageEnemy(e, n, head, guard) {
    if (e.dead) return; e.hp -= n; e.alert = true; e.pinned = 1.5;
    puff(new THREE.Vector3(e.x, head ? 1.65 : 1.15, e.z), 0x7a1010, 0.6, 0.25);
    if (e.hp > 0) return;
    e.dead = true; e.deadT = 0; if (!guard) { out.stats.kills++; P.npcKills = (P.npcKills || 0) + 1; streakUp(); } // your guards' kills don't count for your streak
    if (e.cop) { feed("💀 Officer down"); E.setWanted(Math.min(5, E.wanted() + 1)); return; }
    feed(head ? "💀 Headshot" : "💀 Crew member down"); E.emit("crew-down");
    drop(e.x, e.z, Math.round(rnd(100, 400) / 10) * 10 * (perk("scavenger") ? 2 : 1));
    missionCheck();
  }
  function clear(x0, z0, x1, z1) { const d = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(d / 1.5); for (let i = 1; i < n; i++) { const t = i / n; if (CITY.blocked(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, 0)) return false; } return true; }
  // a spot 6-16 m away that you can't see from where you are, with a wall between, and somewhere to lean out from
  function findCover(e) {
    let best = null, bs = -Infinity;
    for (let k = 0; k < 18; k++) {
      const a = Math.random() * 6.28, r = rnd(4, 16), x = e.x + Math.sin(a) * r, z = e.z + Math.cos(a) * r;
      const dp = Math.hypot(x - car.x, z - car.z);
      if (dp < 7 || dp > 40 || CITY.blocked(x, z, 0.45) || clear(x, z, car.x, car.z)) continue;
      const peek = leanOut(x, z); if (!peek) continue;
      const score = -Math.abs(dp - 16) - r * 0.3;
      if (score > bs) { bs = score; best = { x, z, peek }; }
    }
    return best;
  }
  function leanOut(x, z) {
    const ux = car.x - x, uz = car.z - z, d = Math.hypot(ux, uz) || 1, px = -uz / d, pz = ux / d;
    for (const s of [1.3, -1.3, 2.2, -2.2]) { const lx = x + px * s, lz = z + pz * s; if (!CITY.blocked(lx, lz, 0.35) && clear(lx, lz, car.x, car.z)) return { x: lx, z: lz }; }
    return null;
  }
  function stepTo(e, tx, tz, sp, dt) {
    const dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz); if (d < 0.25) return true;
    const st = Math.min(d, sp * dt), nx = e.x + (dx / d) * st, nz = e.z + (dz / d) * st;
    if (!CITY.blocked(nx, nz, 0.35)) { e.x = nx; e.z = nz; } else if (!CITY.blocked(nx, e.z, 0.35)) e.x = nx; else if (!CITY.blocked(e.x, nz, 0.35)) e.z = nz; else return true;
    return false;
  }
  const ENEMY = { pistol: { dmg: [5, 8], rate: 0.6, range: 45 }, smg: { dmg: [3, 6], rate: 0.12, range: 35 }, rifle: { dmg: [6, 10], rate: 0.18, range: 70 } };
  let volley = []; // when crew members fired: no more than three shoot in any one second, so a fight is hard but fair
  function fire(e, d) {
    const W = ENEMY[e.kind] || ENEMY.pistol, nowS = performance.now() / 1000;
    volley = volley.filter((t) => nowS - t < 1);
    if (e.cool > 0 || d > W.range || volley.length >= 3) return;
    e.cool = W.rate * rnd(0.8, 1.4); volley.push(nowS); e.mag--;
    const moving = foot.on ? foot.speed > 2 : Math.abs(car.speed) > 8;
    const chance = Math.max(0.05, Math.min(0.45, 0.45 - d / 90 - (moving ? 0.18 : 0) - (foot.on && foot.sprint ? 0.08 : 0) - (foot.on && foot.aim ? 0 : 0)));
    const hit = Math.random() < chance;
    const muzzle = new THREE.Vector3(); e.p.userData.gun.userData.tip.getWorldPosition(muzzle);
    const aimAt = new THREE.Vector3(car.x + (hit ? 0 : rnd(-1.6, 1.6)), (foot.on ? 1.2 : 1) + (hit ? 0 : rnd(-0.4, 0.9)), car.z + (hit ? 0 : rnd(-1.6, 1.6)));
    tracer(muzzle, aimAt); flash(muzzle); shot(ARMS[e.kind].snd, d);
    e.p.userData.recoil = 0.12;
    if (hit) hurt(Math.round(rnd(...W.dmg) * (foot.on ? 1 : 0.5 * (1 - ((car.tune && car.tune.armour) || 0) * 0.15))), e.cop ? "the police" : "a rival crew", [e.x, e.z]);
  }
  // armed police: with 3+ stars and combat on, a cop car that gets close lets out two officers (four at most)
  let copT = 0;
  function policeTick(dt) {
    copT -= dt; if (copT > 0) return; copT = 1;
    const cops = out.enemies.filter((e) => e.cop && !e.dead);
    if (!out.on || E.wanted() < 3 || !foot.on) { if (E.wanted() === 0) for (const c of cops) { c.dead = true; c.deadT = 13.6; } return; }
    if (cops.length >= 4) return;
    for (const c of E.cops()) {
      if (Math.hypot(c.x - car.x, c.z - car.z) > 32 || c.dropped) continue;
      c.dropped = true; c.speed = 0;
      for (const s of [1.6, -1.6]) { const h = c.mesh.rotation.y, x = c.x + Math.cos(h) * s, z = c.z - Math.sin(h) * s; if (!CITY.blocked(x, z, 0.4)) spawnEnemy(x, z, E.wanted() >= 4 ? "rifle" : "pistol", true, true); }
      feed("🚓 The police are out of the car"); break;
    }
  }
  // cash dropped by a fallen crew member: walk over it
  const drops = [];
  const cashMat = new THREE.MeshStandardMaterial({ color: 0x2e8b3a, roughness: 0.6, emissive: 0x0b3010 });
  function drop(x, z, amount) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.18), cashMat); m.position.set(x, 0.3, z); m.userData.noAO = true; scene.add(m); drops.push({ m, x, z, amount, t: 60 }); }
  function dropsTick(dt) {
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i]; d.t -= dt; d.m.rotation.y += dt * 2.5; d.m.position.y = 0.3 + Math.sin(d.t * 3) * 0.06;
      if (foot.on && Math.hypot(d.x - car.x, d.z - car.z) < 1.6) { P.netWorth += d.amount; ctx.play && ctx.play("cash", 0.35); feed(`💵 +${E.money(d.amount)}`); scene.remove(d.m); drops.splice(i, 1); ctx.sync && ctx.sync(); continue; }
      if (d.t <= 0) { scene.remove(d.m); drops.splice(i, 1); }
    }
  }
  function enemiesTick(dt) {
    policeTick(dt);
    for (let i = out.enemies.length - 1; i >= 0; i--) {
      const e = out.enemies[i];
      if (e.dead) { e.deadT += dt; pose(e.p, "down", dt); if (e.deadT > 14) { scene.remove(e.p); out.enemies.splice(i, 1); } continue; }
      const dx = car.x - e.x, dz = car.z - e.z, d = Math.hypot(dx, dz);
      if (d > 220) { if (e.cop) { e.dead = true; e.deadT = 13.6; } pose(e.p, "idle", dt); continue; }
      const see = d < 75 && clear(e.x, e.z, car.x, car.z);
      if (!e.alert && see && d < 30) e.alert = true;
      let sp = 0, crouch = false;
      e.cool -= dt; e.t -= dt; e.pinned = Math.max(0, e.pinned - dt);
      if (e.alert && !dead) {
        const face = () => { const want = Math.atan2(dx, dz); let dh = want - e.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); e.h += dh * Math.min(1, dt * 7); };
        if (e.rusher || e.cop && d > 30) {
          // straight at you, firing when it can see you; stops close
          face();
          if (d > 6 || !see) { sp = see ? 3.4 : 4.6; const ux = dx / d, uz = dz / d, side = Math.sin(performance.now() / 700 + i) * 0.6; stepTo(e, e.x + (ux + uz * side) * 3, e.z + (uz - ux * side) * 3, sp, dt); }
          if (see) fire(e, d);
          if (e.mag <= 0) { e.mag = MAGS[e.kind] || 10; e.cool = 2; }
        } else if (e.state === "move") {
          // to cover (or straight at you if there's none), firing on the way if it has a clear shot
          if (!e.cover || e.t <= 0) { e.cover = findCover(e); e.t = 6; }
          const tx = e.cover ? e.cover.x : car.x, tz = e.cover ? e.cover.z : car.z;
          sp = 4.4; const there = stepTo(e, tx, tz, sp, dt);
          e.h = Math.atan2(tx - e.x, tz - e.z);
          if (see && d < 25 && Math.random() < dt * 2) { face(); fire(e, d); }
          if (there || (!e.cover && d < 14)) { e.state = "hide"; e.t = rnd(0.8, 2); }
        } else if (e.state === "hide") {
          crouch = true; face();
          if (e.mag <= 0) { e.mag = MAGS[e.kind] || 10; e.t = Math.max(e.t, 2.2); } // reloading behind cover
          // flanked (you can see it where it hides) or the spot's gone stale: move on
          if (see && d < 20 && e.cover) { e.state = "move"; e.cover = null; }
          else if (e.t <= 0 && e.pinned <= 0) { e.peek = e.cover ? leanOut(e.cover.x, e.cover.z) : { x: e.x, z: e.z }; e.state = e.peek ? "peek" : "move"; e.t = rnd(1.4, 2.6); if (!e.peek) e.cover = null; }
        } else if (e.state === "peek") {
          // lean out, fire a burst, duck back
          face(); sp = stepTo(e, e.peek.x, e.peek.z, 3, dt) ? 0 : 2.5;
          if (see) fire(e, d);
          if (e.t <= 0 || e.mag <= 0 || e.pinned > 1.2) { e.state = "back"; }
        } else if (e.state === "back") {
          sp = 3.5; const c = e.cover || { x: e.x, z: e.z };
          if (stepTo(e, c.x, c.z, sp, dt)) { e.state = "hide"; e.t = rnd(1, 2.4); if (Math.random() < 0.25) { e.state = "move"; e.cover = null; } }
        }
      }
      e.p.userData.aiming = e.alert && e.state !== "move";
      e.p.position.set(e.x, 0, e.z); e.p.rotation.y = e.h;
      pose(e.p, crouch ? "crouch" : sp > 3 ? "run" : sp > 0.3 ? "walk" : "idle", dt, sp);
    }
  }
  // your shots near a crew member pin it down (it stays in cover longer)
  function suppress(o, d, upto) { for (const e of out.enemies) { if (e.dead) continue; const t = (e.x - o.x) * d.x + (e.z - o.z) * d.z; if (t < 0 || t > upto) continue; const px = o.x + d.x * t, pz = o.z + d.z * t; if (Math.hypot(px - e.x, pz - e.z) < 3) e.pinned = Math.max(e.pinned, 1.2); } }

  // ---------------------------------------------------------------- missions
  let beacon = null, caseMesh = null;
  function setBeacon(p, color = 0xff3b3b) {
    if (beacon) { scene.remove(beacon); beacon = null; }
    if (!p) return;
    beacon = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 70, 18, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false }));
    beacon.position.set(p[0], 35, p[1]); beacon.userData.noAO = true; scene.add(beacon);
  }
  function spotNear(at, r0, r1) { for (let k = 0; k < 40; k++) { const a = Math.random() * 6.28, r = rnd(r0, r1), x = at[0] + Math.sin(a) * r, z = at[1] + Math.cos(a) * r; if (!CITY.blocked(x, z, 0.6)) return [x, z]; } return [at[0], at[1]]; }
  function startMission(def) {
    if (!out.on) return openPanel();
    const at = CITY.roadPoint({ away: [car.x, car.z], minFrom: 220, near: [car.x, car.z], maxFrom: 650 });
    out.mission = { def, stage: "go", at, wave: 0, say: "Get to the marker." };
    setBeacon(at); E.toast(`${def.icon} ${def.name}: get to the red marker.`); hud();
  }
  function spawnCrew(m) {
    const n = Math.round(rnd(m.def.crew[0], m.def.crew[1] + 0.49));
    for (let i = 0; i < n; i++) { const [x, z] = spotNear(m.at, 6, 22); spawnEnemy(x, z, i % 3 === 2 ? "rifle" : i % 2 ? "smg" : "pistol", i === 0); }
  }
  function spawnWave(m) {
    const n = m.def.waves[m.wave], from = Math.random() * 6.28;
    for (let i = 0; i < n; i++) { const [x, z] = spotNear([m.at[0] + Math.sin(from + i * 0.4) * 45, m.at[1] + Math.cos(from + i * 0.4) * 45], 0, 10); const e = spawnEnemy(x, z, m.wave >= 1 && i % 2 ? "rifle" : "smg", m.wave === 2 && i === 0); e.alert = true; }
    feed(`🛡️ Wave ${m.wave + 1} of ${m.def.waves.length}`);
  }
  function alive() { return out.enemies.filter((e) => !e.dead && !e.cop).length; }
  function missionCheck() {
    const m = out.mission; if (!m || m.stage !== "fight" || alive()) return;
    if (m.def.key === "turf") endMission(true);
    else if (m.def.key === "stash") {
      m.stage = "case"; m.say = "Grab the case.";
      caseMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.15), new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.6, roughness: 0.3 }));
      caseMesh.position.set(m.at[0], 0.5, m.at[1]); scene.add(caseMesh); E.toast("💼 Crew down. Grab the case.");
    } else if (m.def.key === "hold") {
      m.wave++;
      if (m.wave >= m.def.waves.length) endMission(true); else setTimeout(() => out.mission === m && spawnWave(m), 4000);
    }
  }
  function endMission(ok, why) {
    const m = out.mission; if (!m) return;
    out.mission = null; setBeacon(null); if (caseMesh) { scene.remove(caseMesh); caseMesh = null; }
    mchip.style.display = "none";
    if (ok) { grenades++; P.netWorth += m.def.pay; P.tokens += m.def.tokens; ctx.play && ctx.play("cash"); E.toast(`✅ ${m.def.name} done: ${E.money(m.def.pay)} + ${m.def.tokens} tokens.`); E.emit("mission-done", m.def.key); ctx.sync && ctx.sync(); }
    else E.toast(`❌ ${m.def.name} failed. ${why || ""}`, true);
    // anyone left walks off
    setTimeout(() => { for (const e of out.enemies) if (!e.dead && !e.cop) { e.dead = true; e.deadT = 13.5; } }, ok ? 0 : 2000);
  }
  function missionTick(dt) {
    const m = out.mission; if (!m) return;
    const target = m.stage === "deliver" ? m.drop : m.at, d = Math.hypot(target[0] - car.x, target[1] - car.z);
    if (m.stage === "go" && d < 70) {
      m.stage = "fight"; m.say = m.def.key === "hold" ? "Hold the block." : "Take out the crew.";
      if (m.def.key === "hold") spawnWave(m); else spawnCrew(m);
      setBeacon(null); // the crew is right there; the marker would only be in the way
      E.toast(`${m.def.icon} ${m.say}`, true);
    }
    if (m.stage === "case" && d < 2.2 && foot.on) {
      if (caseMesh) { scene.remove(caseMesh); caseMesh = null; }
      m.stage = "deliver"; m.drop = CITY.roadPoint({ away: m.at, minFrom: 380, near: m.at, maxFrom: 800 }); m.say = "Get the case to the drop.";
      setBeacon(m.drop, 0x38d27a); E.setWanted(2); E.toast("💼 Got it. Get to the green marker. The cops know.", true);
    }
    if (m.stage === "deliver" && d < 9) endMission(true);
    if (caseMesh) caseMesh.rotation.y += dt * 2;
    // the chip: what to do, how far, and which way
    const ang = Math.atan2(target[0] - car.x, target[1] - car.z), view = foot.on ? foot.yaw : car.heading;
    let rel = ang - view; rel = Math.atan2(Math.sin(rel), Math.cos(rel));
    const left = m.stage === "fight" ? ` · ${alive()} left` : "";
    mchip.style.display = "block";
    mchip.innerHTML = `${m.def.icon} ${m.say}${left} · ${Math.round(d)} m <span style="display:inline-block;transform:rotate(${(-rel * 180) / Math.PI}deg)">⬆</span>`;
  }

  // ---------------------------------------------------------------- first person: the weapon in your hands
  // Drawn on top of everything (so it never sinks into a wall), with your forearms, a little sway when you turn,
  // bob when you walk and a kick when you fire; aiming brings it up to the middle.
  const vm = { g: new THREE.Group(), gun: null, kick: 0, sway: 0, lastYaw: 0, ads: 0 };
  vm.g.visible = false; vm.g.renderOrder = 999; scene.add(vm.g);
  const onTop = (o) => o.traverse((m) => { if (m.isMesh) { m.material = m.material.clone(); m.material.depthTest = false; m.material.depthWrite = false; m.renderOrder = 999; m.castShadow = false; m.userData.noAO = true; } });
  const armMat = new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.8 }), handMat = new THREE.MeshStandardMaterial({ color: 0x8d5524, roughness: 0.6 });
  for (const [x, len, rx] of [[0.07, 0.42, 1.35], [-0.12, 0.36, 1.1]]) { // right forearm on the grip, left one under the barrel
    const a = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, len, 4, 8), armMat); a.rotation.x = rx; a.position.set(x, -0.07, -0.08); vm.g.add(a);
    const h = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), handMat); h.position.set(x * 0.9, -0.04, x > 0 ? 0.1 : 0.2); vm.g.add(h);
  }
  onTop(vm.g);
  function vmArm(id) { if (vm.gun) { vm.g.remove(vm.gun); vm.gun = null; } if (id) { vm.gun = model(id, att[id]); vm.gun.rotation.y = Math.PI; onTop(vm.gun); vm.g.add(vm.gun); } }
  const qv = new THREE.Quaternion(), off = new THREE.Vector3();
  function vmTick(dt) {
    const show = foot.on && foot.fp && out.on && !!out.armed && !dead;
    vm.g.visible = show; if (!show) return;
    vm.ads += ((foot.aim ? 1 : 0) - vm.ads) * Math.min(1, dt * 12);
    let dy = foot.yaw - vm.lastYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); vm.lastYaw = foot.yaw;
    vm.sway += (dy * 6 - vm.sway) * Math.min(1, dt * 10); vm.kick *= Math.pow(0.0005, dt);
    const bob = Math.sin(foot.bob * 2) * 0.012 * Math.min(1, foot.speed / 4) * (1 - vm.ads), bx = Math.cos(foot.bob) * 0.01 * Math.min(1, foot.speed / 4) * (1 - vm.ads);
    // hip: low and to the right; aiming: centred under your eye
    off.set(0.2 * (1 - vm.ads) + bx - vm.sway * 0.05, -0.2 + 0.07 * vm.ads + bob, -0.42 + 0.1 * vm.ads + vm.kick * 0.6);
    off.applyQuaternion(cam.quaternion); vm.g.position.copy(cam.position).add(off);
    qv.setFromEuler(new THREE.Euler(vm.kick * 1.4, vm.sway * 0.3, 0)); vm.g.quaternion.copy(cam.quaternion).multiply(qv);
  }
  foot.onView.push(() => vmArm(out.armed));

  // ---------------------------------------------------------------- grenades (G, or GRENADE on a phone)
  // Three per life (and one more for each mission you finish): thrown where you're looking, they bounce and go off
  // after 2.5 seconds, like the RPG's blast but smaller.
  const GREN = { dmg: 160, blast: 6.5 };
  const gGeo = new THREE.SphereGeometry(0.07, 10, 8), gMat = new THREE.MeshStandardMaterial({ color: 0x3d4a2c, roughness: 0.6, metalness: 0.3 });
  const thrown = [];
  function throwGrenade() {
    if (!out.on || !foot.on || dead) return;
    if (grenades <= 0) { feed("No grenades left"); return; }
    grenades--; hud();
    const d = new THREE.Vector3(); cam.getWorldDirection(d);
    const m = new THREE.Mesh(gGeo, gMat); m.castShadow = true; m.position.set(car.x + d.x * 0.6, 1.5 + foot.y, car.z + d.z * 0.6); scene.add(m);
    thrown.push({ m, v: new THREE.Vector3(d.x * 15, d.y * 15 + 5, d.z * 15), t: 2.5 });
    foot.me.userData.recoil = 0.5; click(700, 0.06);
  }
  function grenadesTick(dt) {
    for (let i = thrown.length - 1; i >= 0; i--) {
      const g = thrown[i]; g.t -= dt; g.v.y -= 22 * dt;
      const n = g.m.position.clone().addScaledVector(g.v, dt);
      if (n.y < 0.07) { n.y = 0.07; g.v.y = -g.v.y * 0.35; g.v.x *= 0.6; g.v.z *= 0.6; if (Math.abs(g.v.y) > 1) click(300, 0.03); }
      if (n.y < 10 && CITY.blocked(n.x, n.z, 0.1)) { g.v.x = -g.v.x * 0.4; g.v.z = -g.v.z * 0.4; n.x = g.m.position.x; n.z = g.m.position.z; }
      g.m.position.copy(n); g.m.rotation.x += dt * 8;
      if (g.t <= 0) { scene.remove(g.m); thrown.splice(i, 1); explode(n, GREN, "grenade", "your own grenade"); }
    }
  }
  window.addEventListener("keydown", (e) => { if (e.code === "KeyG" && !e.repeat && foot.on && out.on && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "")) throwGrenade(); });
  out.throwGrenade = throwGrenade; out.grenades = () => grenades;

  // ---------------------------------------------------------------- kill streaks (crew and players, without going down)
  function streakUp() {
    streak++;
    if (streak === 3) { P.armor = Math.min(100, (P.armor || 0) + 50); feed("🔥 3 in a row: +50 armour"); }
    else if (streak === 5) { P.netWorth += 1000; ctx.sync && ctx.sync(); feed("🔥 5 in a row: +$1,000"); }
    else if (streak === 7) { P.health = 100; grenades += 2; feed("🔥 7 in a row: full health and 2 grenades"); }
    else if (streak > 7 && streak % 5 === 0) { P.netWorth += 2500; ctx.sync && ctx.sync(); feed(`🔥 ${streak} in a row: +$2,500`); }
    hud();
  }
  out.streakUp = streakUp; out.streak = () => streak;
  // for the story (story.js) and street events (events.js)
  out.startMission = (key) => { const d = MISSIONS.find((x) => x.key === key); if (d && out.on && !out.mission) { startMission(d); return true; } return false; };
  out.spawnEnemy = spawnEnemy; out.dropCash = drop; out.attachments = att;

  // on the radar (hud.js): crew red, police blue, cash green; the mission marker as the target
  function blips() {
    const b = []; for (const e of out.enemies) if (!e.dead) b.push({ x: e.x, z: e.z, c: e.cop ? "#2a6bff" : "#ff3b3b", r: 4 });
    for (const d of drops) b.push({ x: d.x, z: d.z, c: "#00E676", r: 3 });
    for (const [, r] of out.remote) if (r.alive) b.push({ x: r.x, z: r.z, c: r.combat ? "#ff8a3b" : "#ffffff", r: 4 });
    window.__rbBlips = b;
    const m = out.mission; window.__rbMissionTarget = m ? (m.stage === "deliver" ? m.drop : m.stage === "case" || m.stage === "go" ? m.at : null) : null;
  }
  // ---------------------------------------------------------------- every frame
  ctx.onFrame((dt) => {
    dt = Math.min(dt, 0.1);
    cool = Math.max(0, cool - dt);
    if (reloading > 0) { reloading -= dt; if (reloading <= 0) { out.ammo[out.armed] = magOf(out.armed); reloading = 0; click(1300, 0.06); hud(); } }
    if (firing && out.armed && ARMS[out.armed].auto) trigger();
    if (markT > 0) { markT -= dt; if (markT <= 0) xh.classList.remove("hit"); }
    // sniper scope: zoom in
    if (out.on && foot.on && out.armed && zoomOf(out.armed) && foot.aim) { cam.fov = 55 / (zoomOf(out.armed) / 4); cam.updateProjectionMatrix(); }
    // health comes back to half after a while without being hit
    if (out.on && !dead && P.health < 50 && performance.now() - lastHit > 6000) { P.health = Math.min(50, P.health + dt * 4); if (Math.random() < 0.05) hud(); }
    // touch aim assist: turn gently towards the nearest crew member or opted-in player near the crosshair
    if (foot.on && foot.aim && document.body.classList.contains("rb-touch")) {
      let best = null, bd = 0.26;
      const cands = [...out.enemies.filter((e) => !e.dead).map((e) => [e.x, e.z]), ...[...out.remote.values()].filter((r) => r.combat && r.alive).map((r) => [r.x, r.z])];
      for (const [x, z] of cands) { const a = Math.atan2(x - car.x, z - car.z); let rel = a - foot.yaw; rel = Math.atan2(Math.sin(rel), Math.cos(rel)); const d = Math.hypot(x - car.x, z - car.z); if (d < 80 && Math.abs(rel) < bd) { bd = Math.abs(rel); best = rel; } }
      if (best != null) foot.yaw += best * Math.min(1, dt * 4);
    }
    enemiesTick(dt); guardsTick(dt); dropsTick(dt); rocketsTick(dt); grenadesTick(dt); missionTick(dt); fxTick(dt); blips(); vmTick(dt);
    recoil *= Math.pow(0.001, dt);
  });
  setInterval(hud, 500);
  hud();
  return out;
}
