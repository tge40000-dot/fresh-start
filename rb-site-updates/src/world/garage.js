// RB Customs: upgrade your own car (the gold one) with game money, and every car drives like what it is.
//   - Classes: a sports car is quick and grippy, a sedan is the all-rounder, an SUV is heavier and slower to turn,
//     a van is slow and soft. Taking a car from the traffic means driving what you took.
//   - Upgrades (your own car only, three levels each): Engine (top speed and pick-up), Brakes, Grip, Nitro (lasts
//     longer, refills faster) and Armour (less crash damage and fewer bullets through, see damage.js and combat.js).
//   - Open it from 🔧 in the phone, or next to one of your own lots. Saved on this device.
const SAVE = "rb_customs_v1";
const CLASS = { sport: { max: 1.08, accel: 1.15, grip: 1.12, brake: 1.1, name: "Sports car" }, sedan: { max: 1, accel: 1, grip: 1, brake: 1, name: "Sedan" },
  suv: { max: 0.93, accel: 0.9, grip: 0.92, brake: 0.95, name: "SUV" }, van: { max: 0.85, accel: 0.78, grip: 0.84, brake: 0.88, name: "Van" } };
export const PARTS = [
  { k: "engine", icon: "⚙️", name: "Engine", what: "Top speed and pick-up", cost: [6000, 15000, 35000], fx: (l) => ({ max: 1 + l * 0.06, accel: 1 + l * 0.12 }) },
  { k: "brakes", icon: "🛑", name: "Brakes", what: "Stops shorter", cost: [3000, 7000, 15000], fx: (l) => ({ brake: 1 + l * 0.18 }) },
  { k: "grip", icon: "🛞", name: "Tyres and suspension", what: "Corners harder, slides less", cost: [4000, 10000, 22000], fx: (l) => ({ grip: 1 + l * 0.12 }) },
  { k: "nitro", icon: "🔥", name: "Nitro", what: "Lasts longer, refills faster", cost: [5000, 12000, 28000], fx: (l) => ({ nitro: 1 + l * 0.3 }) },
  { k: "armour", icon: "🛡️", name: "Armour", what: "Less crash damage, stops more bullets", cost: [8000, 20000, 45000], fx: (l) => ({ armour: l }) },
];
const load = () => { try { return JSON.parse(localStorage.getItem(SAVE) || "{}"); } catch (e) { return {}; } };

export function initGarage(E, ctx) {
  const car = E.car, P = ctx.player;
  const lv = load();
  const out = { levels: lv, open, tune: () => car.tune };
  function tune() {
    const m = car.mesh, cls = CLASS[(m && m.userData.kind) || "sedan"] || CLASS.sedan, own = !!(m && m.userData.personal);
    const t = { max: cls.max, accel: cls.accel, grip: cls.grip, brake: cls.brake, nitro: 1, armour: 0, cls: cls.name, own };
    if (own) for (const p of PARTS) { const f = p.fx(lv[p.k] || 0); for (const k in f) t[k] = k === "armour" ? f[k] : t[k] * f[k]; }
    car.tune = t;
  }
  function open() {
    tune();
    const t = car.tune, own = t.own, money = E.money;
    const rows = PARTS.map((p) => {
      const l = lv[p.k] || 0, next = p.cost[l];
      return `<div class="rb-card"><div><b>${p.icon} ${p.name}</b> <span class="rb-tag" style="border-color:var(--gold);color:var(--gold)">${"■".repeat(l)}${"□".repeat(3 - l)}</span><div class="rb-muted">${p.what}</div></div>
        <button class="rb-btn" data-e="up-${p.k}" ${!own || next == null || P.netWorth < next ? "disabled" : ""}>${next == null ? "MAXED" : "UPGRADE " + money(next)}</button></div>`;
    }).join("");
    E.panel(`<h2>🔧 RB CUSTOMS</h2><div class="rb-muted">You're driving: <b>${t.cls}</b>${own ? " (your own car)" : ". Upgrades go on your own car: get back in it to buy them."}</div>
      <div class="rb-grid"><div><span>TOP SPEED</span><b>${Math.round(108 * t.max)} km/h</b></div><div><span>PICK-UP</span><b>${Math.round(t.accel * 100)}%</b></div><div><span>GRIP</span><b>${Math.round(t.grip * 100)}%</b></div><div><span>ARMOUR</span><b>${["None", "Light", "Medium", "Heavy"][t.armour || 0]}</b></div></div>
      ${rows}<button class="btn-ghost" data-e="x">CLOSE</button>`,
      { x: E.hidePanel, ...Object.fromEntries(PARTS.map((p) => ["up-" + p.k, () => buy(p)])) });
  }
  function buy(p) {
    const l = lv[p.k] || 0, c = p.cost[l]; if (c == null || P.netWorth < c || !(car.mesh && car.mesh.userData.personal)) return;
    P.netWorth -= c; lv[p.k] = l + 1;
    try { localStorage.setItem(SAVE, JSON.stringify(lv)); } catch (e) {}
    ctx.sync && ctx.sync(); ctx.play && ctx.play("cash"); E.toast(`🔧 ${p.name} level ${l + 1} fitted.`); tune(); open();
  }
  // the class changes when you change cars; recheck a few times a second
  setInterval(tune, 400); tune();
  return out;
}
