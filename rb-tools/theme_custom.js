
// ---------------------------------------------------------------- custom palettes (RB Command's palette builder, 17 Oct 2026)
// The setting can carry the owner's own palettes: {"theme":"c_ab12cd","sites":{},"custom":{"c_ab12cd":{label,void,…}}}.
// Each one is checked (nine #RRGGBB colours, a dark base, every text and accent tone at 4.5:1) and then registered in
// PALETTES under its key, so every site renders it exactly like a built-in palette. One that fails is ignored, and a
// site pointing at it keeps its own colours: it never breaks a page. The same block is in every copy of theme.js.
export const CUSTOM_KEY = /^c_[a-z0-9]{6,12}$/;
export const MAX_CUSTOM = 80;
const PKEYS = ["void", "dark", "mid", "light", "a1", "a1s", "a2", "a2b", "cream"];
const HEXRE = /^#[0-9A-F]{6}$/i;

/** A clean copy of a palette ({label, nine colours}), or null if any colour is missing or malformed. */
export function cleanPalette(p) {
  if (!p || typeof p !== "object") return null;
  const out = { label: String(p.label || "Custom").replace(/[<>"]/g, "").trim().slice(0, 40) || "Custom" };
  for (const k of PKEYS) { if (typeof p[k] !== "string" || !HEXRE.test(p[k])) return null; out[k] = p[k].toUpperCase(); }
  return out;
}

/** Whether a palette is safe for every site: {ok, errors, report}. report holds each check's ratio. */
export function checkPalette(p) {
  const c = cleanPalette(p);
  if (!c) return { ok: false, errors: ["Every colour must be a full hex value like #C9A227."], report: {} };
  const t = tones(c), errors = [], report = {};
  const need = (name, a, b, min) => { const r = contrast(a, b); report[name] = Math.round(r * 100) / 100; if (r < min) errors.push(`${name} is ${r.toFixed(2)}:1, needs ${min}:1`); };
  need("text on panels", t.text, t.panel2, 7);
  need("muted text", t.muted, t.panel2, 4.5);
  need("accent", t.accent, t.panel2, 4.5);
  need("second accent", t.hot, t.panel2, 4.5);
  need("button text on accent", c.void, t.accent, 4.5);
  if (contrast(c.void, "#000000") > 2.2) errors.push("The background must be dark (the sites are built for a dark base).");
  return { ok: errors.length === 0, errors, report };
}

/** Register the setting's custom palettes in PALETTES. Returns the clean, checked set (key -> palette). */
export function registerCustom(custom) {
  const out = {};
  if (!custom || typeof custom !== "object") return out;
  for (const [k, v] of Object.entries(custom).slice(0, MAX_CUSTOM)) {
    if (!CUSTOM_KEY.test(k)) continue;
    const p = cleanPalette(v);
    if (!p || !checkPalette(p).ok) continue;
    PALETTES[k] = p;
    out[k] = p;
  }
  return out;
}
