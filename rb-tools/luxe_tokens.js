
// ---------------------------------------------------------------- luxury tokens (Dark Luxury lock, 28 Oct 2026)
// One small set of names every RB site can rely on, whatever palette is chosen: --lux-bg, --lux-bg-elevated, --lux-gold,
// --lux-gold-highlight, --lux-gold-deep, --lux-crimson, --lux-text, --lux-text-muted, --lux-line (plus two helpers).
// They come from the same tones() every site already uses, so built-in palettes, the builder's custom palettes and
// the locked "Dark Luxury" palette all fill them the same way. Dark Luxury gives exactly the locked values:
//   --lux-bg #05040A, --lux-bg-elevated #0C0A10, --lux-gold #D4AF37, --lux-gold-highlight #F5E6C8, --lux-gold-deep #8B6914,
//   --lux-crimson #C41E3A, --lux-text #F5F0E6, --lux-text-muted #A89F8C, --lux-line #2A261C.
// Sites read them with the locked value as the fallback (var(--lux-gold,#D4AF37)), so a site with no theme chosen
// looks exactly as it does today. The same block is in every copy of theme.js (rb-tools/patch_luxe_tokens.py).
export const LUXE_LOCK = { bg: "#05040A", "bg-elevated": "#0C0A10", gold: "#D4AF37", "gold-highlight": "#F5E6C8", "gold-deep": "#8B6914",
  crimson: "#C41E3A", text: "#F5F0E6", "text-muted": "#A89F8C", line: "#2A261C" };

/** The luxury tokens for one palette: {name: colour}, names without the --lux- prefix. */
export function luxTokens(p) {
  const t = tones(p);
  const deep = p.deep && /^#[0-9A-F]{6}$/i.test(p.deep) ? p.deep.toUpperCase() : mix(t.accent, "#000000", 0.36);
  return {
    bg: p.void, "bg-elevated": p.dark, gold: t.accent, "gold-highlight": t.accent2, "gold-deep": deep,
    crimson: p.a1, text: t.text, "text-muted": t.muted, line: t.line,
    // helpers: crimson lifted until it reads as text on the panels, and a soft gold hairline
    "crimson-text": t.hot, "gold-line": rgba(t.accent, 0.26),
  };
}

/** `:root{--lux-…}` for one palette ("" for none). `imp` marks them !important for sites whose own sheet comes later. */
export function luxCss(p, imp = "") {
  if (!p) return "";
  return `:root{${Object.entries(luxTokens(p)).map(([k, v]) => `--lux-${k}:${v}${imp}`).join(";")}}\n`;
}
