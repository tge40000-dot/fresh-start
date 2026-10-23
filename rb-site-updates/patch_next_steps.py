"""Next steps after a purchase or a download, linking products that already exist (no new prices, nothing in Stripe).

Usage: python3 -I patch_next_steps.py <pulled artist-router dir | pulled rb-mastering-studio dir>

- artist-router, /store after a paid beat license: under the downloads, "What's next": record on it (/record/),
  master your song (/studio/), release it and submit it to Global Radio (/release).
- rb-mastering-studio, after a WAV or MP3 download: "Next: release it" (/release), the license and Global Radio
  submission form.
- The browser studio (rb-daw) does the same after an export from its own source, workers/rb-daw.

Each link says what the page it opens does. Running it twice changes nothing.
"""
import pathlib
import sys

d = pathlib.Path(sys.argv[1])


def patch(path, edits, label):
    s = path.read_text(encoding="utf-8")
    if all(new in s for _, new in edits):
        print(f"{label}: next steps already in place")
        return
    for old, new in edits:
        if new in s:
            continue
        if s.count(old) != 1:
            raise SystemExit(f"{label}: anchor found {s.count(old)} times: {old[:70]!r}")
        s = s.replace(old, new)
    path.write_text(s, encoding="utf-8")
    print(f"{label}: next steps added")


router = d / "artist-router-v14.js"
if router.exists():
    old = "      box.appendChild(el('p', 'Bookmark this page: your files and license stay here. Your Stripe receipt has the license terms too.', 'margin:.7rem 0 0;font-size:.75rem;color:var(--muted, #b9b0a8)'));\n"
    new = old + (
        "      // What's next: the products that follow a beat, in order (rb next steps).\n"
        "      var next = el('div', '', 'margin:.9rem 0 0;padding-top:.75rem;border-top:1px solid rgba(212,175,55,.25)');\n"
        "      next.className = 'rb-next';\n"
        "      next.appendChild(el('strong', 'What\\u2019s next', 'display:block;font-size:.85rem;margin-bottom:.45rem'));\n"
        "      var steps = el('div', '', 'display:flex;gap:.45rem;justify-content:center;flex-wrap:wrap');\n"
        "      [['/record/', 'Record on it'], ['/studio/', 'Master your song'], ['/release', 'Release + submit to radio']].forEach(function(s, i){\n"
        "        var a = el('a', (i + 1) + '. ' + s[1], 'display:inline-block;padding:.4rem .8rem;border-radius:999px;border:1px solid rgba(212,175,55,.55);color:var(--a2b, #d4af37);text-decoration:none;font-size:.76rem;font-weight:600');\n"
        "        a.href = s[0]; steps.appendChild(a);\n"
        "      });\n"
        "      next.appendChild(steps); box.appendChild(next);\n"
    )
    patch(router, [(old, new)], "artist-router")

app = next(iter(sorted(d.glob("*-app.html"))), None)
if app is not None:
    edits = [
        ('Distributors want the WAV.</div>',
         'Distributors want the WAV.</div>\n'
         '    <p class="sub hide" id="rb-next" style="margin:.6rem 0 0">Next: <a href="/release" style="color:var(--gold, #d4af37);font-weight:600">release it</a>. Upload the master for a multi-use license and submit it to Global Radio.</p>'),
        ('b.disabled = false; $("x-status").textContent = "Downloaded " + outName(bits) + " (" + (blob.size / 1048576).toFixed(1) + " MB).";',
         'b.disabled = false; $("x-status").textContent = "Downloaded " + outName(bits) + " (" + (blob.size / 1048576).toFixed(1) + " MB)."; $("rb-next").classList.remove("hide");'),
        ('b.disabled = false; $("x-status").textContent = "Downloaded " + name + " (" + (blob.size / 1048576).toFixed(1) + " MB, 320 kbps).";',
         'b.disabled = false; $("x-status").textContent = "Downloaded " + name + " (" + (blob.size / 1048576).toFixed(1) + " MB, 320 kbps)."; $("rb-next").classList.remove("hide");'),
    ]
    patch(app, edits, "rb-mastering-studio")

if not router.exists() and app is None:
    raise SystemExit("no artist-router or rb-mastering-studio files in " + str(d))
