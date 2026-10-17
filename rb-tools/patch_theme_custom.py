"""Teach a pulled Worker's theme.js (and artist-router's homepage lookup) about custom palettes from the builder.

Usage: python3 -I patch_theme_custom.py <pulled worker dir>

Works on every copy: rb-command, rb-public-content, rb-radio and artist-router. It
- appends rb-tools/theme_custom.js (checkPalette, registerCustom, …) to theme.js;
- makes parseSetting register the setting's custom palettes (and keep them in the parsed setting);
- makes validateSetting accept and check custom palettes from RB Command;
- in artist-router, lets rbTheme() fall back to PALETTES for a custom key (its THEMES table has only the presets).
A custom palette that fails a check is ignored, so the site keeps its own colours. Running it twice changes nothing.
"""
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
folder = pathlib.Path(sys.argv[1])
p = folder / "theme.js"
s = p.read_text(encoding="utf-8")
block = (HERE / "theme_custom.js").read_text(encoding="utf-8")
MARK = "// ---------------------------------------------------------------- custom palettes (RB Command's palette builder"
changed = []


def rep(old, new, what):
    global s
    if new in s:
        return
    if s.count(old) != 1:
        raise SystemExit(f"{folder.name}/theme.js: {what}: anchor found {s.count(old)} times")
    s = s.replace(old, new)
    changed.append(what)


if MARK not in s:
    s = s.rstrip("\n") + "\n" + block
    changed.append("custom block")
rep('  if (!raw || typeof raw !== "object") return out;\n',
    '  if (!raw || typeof raw !== "object") return out;\n  out.custom = registerCustom(raw.custom);\n', "parseSetting")
rep('  if (!body || typeof body !== "object") return { ok: false, error: "Send a theme." };\n',
    '  if (!body || typeof body !== "object") return { ok: false, error: "Send a theme." };\n'
    '  const custom = {};\n'
    '  for (const [k, v] of Object.entries(body.custom && typeof body.custom === "object" ? body.custom : {})) {\n'
    '    if (!CUSTOM_KEY.test(k)) return { ok: false, error: `Bad custom palette name: ${k}.` };\n'
    '    const chk = checkPalette(v);\n'
    '    if (!chk.ok) return { ok: false, error: `${String((v && v.label) || k).slice(0, 40)}: ${chk.errors[0]}.` };\n'
    '    custom[k] = cleanPalette(v);\n'
    '  }\n'
    '  if (Object.keys(custom).length > MAX_CUSTOM) return { ok: false, error: `Up to ${MAX_CUSTOM} custom palettes.` };\n'
    '  const missing = [body.theme, ...Object.values(body.sites || {})].find((x) => typeof x === "string" && CUSTOM_KEY.test(x) && !custom[x]);\n'
    '  if (missing) return { ok: false, error: "A site uses a custom palette that wasn\'t sent with the save." };\n'
    '  Object.assign(PALETTES, custom);\n', "validateSetting")
rep('  return { ok: true, setting: { theme: body.theme || null, sites } };\n',
    '  return { ok: true, setting: { theme: body.theme || null, sites, custom } };\n', "validateSetting return")
p.write_text(s, encoding="utf-8")

# artist-router: its homepage lookup uses its own THEMES table (presets only)
for f in folder.glob("artist-router*.js"):
    a = f.read_text(encoding="utf-8")
    old_imp = 'import { parseSetting, themeFor } from "./theme.js";\n'
    new_imp = 'import { parseSetting, themeFor, PALETTES } from "./theme.js";\n'
    old_fn = "  return key && THEMES[key] || fallback;\n"
    new_fn = "  return key && (THEMES[key] || PALETTES[key]) || fallback;\n"
    for old, new in ((old_imp, new_imp), (old_fn, new_fn)):
        if new in a:
            continue
        if a.count(old) != 1:
            raise SystemExit(f"{f.name}: anchor found {a.count(old)} times: {old.strip()[:60]}")
        a = a.replace(old, new)
        changed.append(f.name)
    f.write_text(a, encoding="utf-8")

print(f"{folder.name}: " + (", ".join(changed) + " updated" if changed else "custom palettes already in place"))
