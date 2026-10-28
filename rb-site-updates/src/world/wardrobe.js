// The wardrobe (👕 in the phone): choose your top, jacket, trousers, hair style and colour, cap, beard and skin
// tone. Saved on this device, and other players see it (live.js sends the look with your moves).
import { LOOK, DEFAULT_LOOK } from "./char.js";

const swatch = (c) => typeof c === "number" ? "#" + c.toString(16).padStart(6, "0") : null;
const NAMES = { s: { short: "Short", buzz: "Buzz", afro: "Afro", cap: "Cap", tail: "Ponytail" }, b: { false: "None", true: "Beard" }, j: { null: "None" } };

export function initWardrobe(E, ctx, foot) {
  const parse = (str) => Object.fromEntries(String(str || DEFAULT_LOOK).split(",").map((p) => [p[0], Number(p.slice(1)) || 0]));
  const stringify = (o) => Object.keys(LOOK).map((k) => k + (o[k] || 0)).join(",");
  function open() {
    const cur = parse(foot.look());
    const rows = Object.entries(LOOK).map(([k, def]) => `<div style="margin:10px 0 4px;font:800 10px Inter,sans-serif;color:var(--gold);letter-spacing:2px">${def.name.toUpperCase()}</div>
      <div class="rb-row" style="flex-wrap:wrap;gap:6px">${def.list.map((v, i) => {
        const sw = swatch(v), label = NAMES[k] && NAMES[k][String(v)] != null ? NAMES[k][String(v)] : "";
        return `<button type="button" data-e="${k}${i}" aria-label="${def.name} ${label || i + 1}" style="min-width:${sw ? 34 : 64}px;height:34px;border-radius:9px;cursor:pointer;border:2px solid ${cur[k] === i ? "#F5E6A3" : "rgba(255,255,255,.15)"};background:${sw || "rgba(255,255,255,.06)"};color:#fff;font:700 11px Inter,sans-serif">${sw ? "" : label}</button>`;
      }).join("")}</div>`).join("");
    const acts = { x: E.hidePanel };
    for (const [k, def] of Object.entries(LOOK)) def.list.forEach((_, i) => { acts[k + i] = () => { cur[k] = i; foot.setLook(stringify(cur)); if (window.RBCombat && window.RBCombat.reequip) window.RBCombat.reequip(); open(); }; });
    E.panel(`<h2>👕 WARDROBE</h2><div class="rb-muted">Get out of the car (F) to see yourself. Other players see your look too.</div>${rows}<button class="btn-ghost" data-e="x" style="margin-top:12px">DONE</button>`, acts);
  }
  return { open };
}
