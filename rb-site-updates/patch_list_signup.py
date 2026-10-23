"""The email list where people actually listen and watch: RB Radio and the end of the RB TV shorts feed.

Usage: python3 -I patch_list_signup.py <pulled rb-radio dir> <pulled rb-tv dir>

- RB Radio (/radio): a "Hear it first" card before the footer joins the RB list (POST /api/list on the main site,
  rb-site-updates/src/advertise.js) for "Beats and releases". Same origin, so the page's CSP already allows it.
- RB TV shorts (/tv/shorts): one more slide after the last short with RB TV's own signup box (POST /tv/api/signup,
  source "tv") and a way back to RB TV. Nothing else on the page moves: it's the same slide size as a short, and
  people who already joined see only the way back.
Running it twice changes nothing.
"""
import json
import pathlib
import sys

radio = pathlib.Path(sys.argv[1]) / "index.js"
tv_views = pathlib.Path(sys.argv[2]) / "views.js"
tv_assets = pathlib.Path(sys.argv[2]) / "assets.js"


def esc(html):
    """Text as it sits inside a JSON-encoded JS string."""
    return json.dumps(html)[1:-1]


# ---------------------------------------------------------------- RB Radio
s = radio.read_text(encoding="utf-8")
MARK = 'id=\\"rbl-radio\\"'
CARD = """<section class="card" id="rbl-radio" aria-labelledby="rbl-h"><h2 id="rbl-h">Hear it first</h2>
  <p class="note">Get an email when new songs and beats from RB artists come out. We only email you about what you pick.</p>
  <form id="rbl-form" class="rbl" novalidate><label><span>Name</span><input name="name" autocomplete="given-name" maxlength="100" required></label><label><span>Email</span><input name="email" type="email" autocomplete="email" maxlength="254" required></label><button class="btn2" type="submit">Join the RB list</button></form>
  <p class="status" id="rbl-msg" role="status" aria-live="polite"></p>
  <p class="note">You can pick more at <a href="/#rb-list">the RB list</a>. <a href="/privacy">Privacy</a>.</p>
</section>
<style>.rbl{display:flex;flex-wrap:wrap;gap:10px;align-items:end}.rbl label{display:grid;gap:4px;flex:1 1 200px;font-size:13px;color:var(--mute)}.rbl input{min-height:48px;padding:0 14px;border-radius:12px;border:1px solid var(--line);background:rgba(255,255,255,.04);color:inherit;font:inherit;min-width:0}#rbl-radio a{color:var(--gold2)}</style>
"""
SCRIPT = """<script nonce="%NONCE%">(function(){var f=document.getElementById("rbl-form");if(!f)return;var m=document.getElementById("rbl-msg");
f.addEventListener("submit",function(e){e.preventDefault();var b=f.querySelector("button"),name=f.elements.name.value.trim(),email=f.elements.email.value.trim();
if(!name){m.textContent="Please enter your name.";f.elements.name.focus();return}if(!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(email)){m.textContent="Please enter a valid email.";f.elements.email.focus();return}
b.disabled=true;m.textContent="Adding you\\u2026";fetch("/api/list",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:name,email:email,interests:["beats"]})})
.then(function(r){return r.json()}).then(function(d){b.disabled=false;if(!d.ok){m.textContent=d.error||"That didn\\u2019t work. Try again.";return}m.textContent=d.alreadyRegistered?"You were already on the RB list. New music is ticked now.":"You\\u2019re on the RB list.";f.hidden=true})
.catch(function(){b.disabled=false;m.textContent="That didn\\u2019t work. Try again."})})})();</script>
"""
if MARK not in s:
    a = esc("</main>\n<footer class=\"foot\">")
    assert s.count(a) == 1, "rb-radio: the end of <main> isn't where it was"
    s = s.replace(a, esc(CARD + "</main>\n<footer class=\"foot\">"), 1)
    z = esc("</script>\n</body>")
    assert s.count(z) == 1, "rb-radio: the end of <body> isn't where it was"
    s = s.replace(z, esc("</script>\n" + SCRIPT + "</body>"), 1)
    radio.write_text(s, encoding="utf-8")
    print("rb-radio: RB list card added")
else:
    print("rb-radio: RB list card already there")

# ---------------------------------------------------------------- RB TV shorts
v = tv_views.read_text(encoding="utf-8")
if 'class="short short-end"' not in v:
    old = """${v.source === "youtube" ? "" : `<button class="round" type="button" data-sound aria-label="${esc(L.t("sound_on"))}">${icon("sound")}<span>${esc(L.t("sound"))}</span></button>`}</div></div></section>`;
  }).join("")}</div>`;"""
    new = """${v.source === "youtube" ? "" : `<button class="round" type="button" data-sound aria-label="${esc(L.t("sound_on"))}">${icon("sound")}<span>${esc(L.t("sound"))}</span></button>`}</div></div></section>`;
  }).join("")}<section class="short short-end" aria-label="${esc(L.t("su_title"))}"><div class="sframe"><div class="send">${signupBox("shorts", true, L)}<a class="btn" href="${esc(L.u("/tv"))}">${esc(L.t("back_tv"))}</a></div></div></section></div>`;"""
    assert v.count(old) == 1, "rb-tv: the end of the shorts feed isn't where it was"
    tv_views.write_text(v.replace(old, new, 1), encoding="utf-8")
    a = tv_assets.read_text(encoding="utf-8")
    css_old = esc(".sframe{position:relative;height:100%;aspect-ratio:9/16;max-width:100%;border-radius:18px;overflow:hidden;background:#000}\n")
    assert a.count(css_old) == 1, "rb-tv: the shorts frame style isn't where it was"
    css_new = css_old + esc(".short-end .sframe{background:var(--panel);border:1px solid var(--line);overflow-y:auto}\n"
                            ".send{min-height:100%;display:flex;flex-direction:column;justify-content:center;align-items:stretch;gap:14px;padding:22px}\n"
                            ".send .signup{margin:0}\n.send>.btn{align-self:center}\n")
    tv_assets.write_text(a.replace(css_old, css_new, 1), encoding="utf-8")
    print("rb-tv: signup slide added after the last short")
else:
    print("rb-tv: signup slide already there")
