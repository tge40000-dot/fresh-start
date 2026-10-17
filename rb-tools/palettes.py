"""Add the extra site-colour palettes to every copy of the RB palette table in a pulled Worker.

Usage: python3 -I palettes.py <dir-with-worker-modules>

Each copy of the table (rb-command, rb-public-content, rb-radio, and artist-router's THEMES and theme module) ends
with the `noir:` line; the new palettes go right after it, in the same one-line format. Lists of palette keys
(`"sand", "noir"]`) get the new keys too. Running it twice changes nothing.
"""
import pathlib
import re
import sys

# Dark bases like the original 13, but adding the blues, teals, cool greys and brights the set lacked.
# a2/a2b are the main accent (light and lighter), a1/a1s the second accent; tones() in theme.js lifts any that
# would be hard to read, so every palette passes the same 4.5:1 checks as the original ones.
NEW = [
    ("sapphire", "Sapphire", "#070B16", "#0F1628", "#1A2642", "#5B6A8C", "#F2A541", "#F7C98A", "#3E7BFA", "#8DB3FF", "#EEF2FA"),
    ("ocean", "Ocean", "#06121A", "#0C1F2B", "#153345", "#557587", "#FF7A6B", "#FFB3AA", "#1FA2C7", "#6FD3EE", "#EAF5F8"),
    ("teal", "Teal", "#071413", "#0E2321", "#173834", "#577A75", "#F2C14E", "#F7DB98", "#22A699", "#6FD9CC", "#ECF6F4"),
    ("mint", "Mint", "#0A1411", "#13221D", "#1F362E", "#62806F", "#E8619F", "#F2A5C4", "#4FD1A1", "#9BEBC9", "#EFF7F2"),
    ("indigo", "Indigo", "#0B0A1A", "#15132E", "#23204A", "#66628F", "#5EEAD4", "#A7F3E8", "#6C63FF", "#A9A4FF", "#EFEEFA"),
    ("arctic", "Arctic", "#0B1015", "#141C24", "#222E3A", "#6B7B8A", "#7DD3FC", "#BAE6FD", "#A5B4C4", "#D6E0EA", "#F3F6F9"),
    ("steel", "Steel & Silver", "#0D0E10", "#18191C", "#26282C", "#6F737A", "#4FC3F7", "#A1DEFB", "#C0C6CF", "#E3E7EC", "#F4F5F7"),
    ("lime", "Neon Lime", "#0B0F07", "#151C0E", "#233016", "#6A7A55", "#FF4FA3", "#FF9CCB", "#A6E22E", "#CFF27E", "#F3F7EA"),
    ("sunset", "Sunset", "#160A0E", "#261218", "#3E1C25", "#80585F", "#FF5E7E", "#FFA3B5", "#FF9F43", "#FFC98A", "#FBEFE8"),
    ("coral", "Coral", "#150C0C", "#241414", "#3B2020", "#7E5C58", "#2EC4B6", "#8FE3DA", "#FF7F66", "#FFB3A3", "#FAEFEA"),
    ("fuchsia", "Fuchsia", "#14081A", "#22102C", "#381A47", "#7A5A88", "#FFD166", "#FFE5A3", "#E040FB", "#F09BFF", "#F8EEFB"),
    ("ruby", "Ruby", "#14070B", "#230D14", "#3B1522", "#7F5562", "#F5C26B", "#F9DCA6", "#E0115F", "#FF6B9E", "#F9EBEF"),
    ("royal", "Royal Purple", "#100A1A", "#1C1230", "#2D1E4C", "#6D5F8E", "#B983FF", "#D8BFFF", "#E6B84C", "#F3D68A", "#F6F1E6"),
]
KEYS = [n[0] for n in NEW]


def line(indent, n):
    key, label, void, dark, mid, light, a1, a1s, a2, a2b, cream = n
    return (f'{indent}{key}: {{ label: "{label}", void: "{void}", dark: "{dark}", mid: "{mid}", light: "{light}", '
            f'a1: "{a1}", a1s: "{a1s}", a2: "{a2}", a2b: "{a2b}", cream: "{cream}" }},')


NOIR = re.compile(r'^(?P<indent>[ \t]*)noir: \{ label: "Noir",[^\n]*\},?[ \t]*$', re.M)
KEYLIST = re.compile(r'"sand", "noir"\]')


def patch(text):
    changed = 0
    if 'sapphire: { label: "Sapphire"' not in text:
        def add(m):
            nonlocal changed
            changed += 1
            noir = m.group(0) if m.group(0).rstrip().endswith(",") else m.group(0).rstrip() + ","
            return noir + "\n" + "\n".join(line(m.group("indent"), n) for n in NEW)
        text = NOIR.sub(add, text)
    if '"noir", "sapphire"' not in text:
        text, n = KEYLIST.subn('"sand", "noir", ' + ", ".join(f'"{k}"' for k in KEYS) + "]", text)
        changed += n
    text = text.replace("/** The 13 palettes the homepage already offers (same values as artist-router's THEMES). */",
                        "/** The 26 palettes (same values as artist-router's THEMES); the last 13 were added 16 Oct 2026. */")
    return text, changed


def main(folder):
    total = 0
    for p in sorted(pathlib.Path(folder).glob("*.js")):
        old = p.read_text(encoding="utf-8")
        new, n = patch(old)
        if new != old:
            p.write_text(new, encoding="utf-8")
            print(f"{p.name}: {n} change(s)")
            total += n
    print(f"palettes: {total} change(s) in {folder}")


if __name__ == "__main__":
    main(sys.argv[1])
