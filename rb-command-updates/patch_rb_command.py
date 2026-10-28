"""Add the Affiliate ads screen to a pulled rb-command Worker, plus the "Shows on" (surface) field in the Ads editor.

Usage: python3 -I patch_rb_command.py <pulled rb-command dir>

Copies src/affiliate.js in as a new module, wires three routes into index.js (all need edit rights on Ads), adds the
screen, its nav entry and its styles to ui.js, and adds `surface` to the ads table in tables.js. Each anchor must
match exactly once; an edit already in place is skipped, so running it twice changes nothing.
"""
import pathlib
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
folder = pathlib.Path(sys.argv[1])


def edit(name, old, new):
    p = folder / name
    s = p.read_text(encoding="utf-8")
    # Already done? For an insertion, look for the inserted text on its own: another patch may have added its own
    # block next to the same anchor since, so "anchor + block" isn't side by side any more.
    added = new[len(old):] if new.startswith(old) else new[: len(new) - len(old)] if new.endswith(old) else None
    if added and s.count(added) > 1:
        # An earlier version of these scripts could add a block twice. Keep the first copy, drop the rest.
        first = s.index(added) + len(added)
        s = s[:first] + s[first:].replace(added, "")
        p.write_text(s, encoding="utf-8")
        print(f"{name}: removed a duplicate copy")
    # A later patch may have edited the block since (see patch_planner_links.py): its first line still marks it as done.
    # The whole first line, indentation included, so one block's first line can't match a look-alike line elsewhere.
    mark = next((ln for ln in added.split("\n") if ln.strip()), "") if added else ""
    if new in s or (added and added in s) or (len(mark.strip()) >= 25 and ("\n" + mark + "\n") in ("\n" + s)):
        return
    if s.count(old) != 1:
        raise SystemExit(f"{name}: anchor found {s.count(old)} times: {old[:70]!r}")
    p.write_text(s.replace(old, new), encoding="utf-8")
    print(f"{name}: edited")


shutil.copyfile(HERE / "src" / "affiliate.js", folder / "affiliate.js")
print("affiliate.js: copied")

# ---- index.js: module and routes
edit("index.js", 'import * as sitetheme from "./sitetheme.js";\n',
     'import * as sitetheme from "./sitetheme.js";\nimport * as affiliate from "./affiliate.js";\n')
edit("index.js",
     '  if (path === "/api/site-theme") { needs(user, "Content", "edit"); return json(await sitetheme.save(env, user, body)); }\n',
     '  if (path === "/api/site-theme") { needs(user, "Content", "edit"); return json(await sitetheme.save(env, user, body)); }\n'
     '  if (path === "/api/affiliate/preview") { needsTable(user, "ads", "edit"); return json(await affiliate.preview(env, body)); }\n'
     '  if (path === "/api/affiliate/card") { needsTable(user, "ads", "edit"); return json(await affiliate.card(env, body)); }\n'
     '  if (path === "/api/affiliate/create") { needsTable(user, "ads", "edit"); return json(await affiliate.create(env, user, body)); }\n')

# ---- tables.js: the ads table gets "Shows on"
# RB World joined the places an ad can show: an older "Shows on" line becomes the current one first.
_t = folder / "tables.js"
_old_surface = '      surface: f.pick("Shows on", ["all", "home", "radio", "tv"], { required: true, labels: { all: "Everywhere ads show", home: "Main site only", radio: "RB Radio only", tv: "RB TV only" }, help: "The main site (homepage, artist pages, agency page) shows ads set to Everywhere or Main site. RB Radio and RB TV pages don\'t show ads yet." }),\n'
_ts = _t.read_text(encoding="utf-8")
if _old_surface in _ts:
    _t.write_text(_ts.replace(_old_surface, '      surface: f.pick("Shows on", ["all", "home", "radio", "tv", "world"], { required: true, labels: { all: "Everywhere ads show", home: "Main site only", radio: "RB Radio only", tv: "RB TV only", world: "RB World only (billboards and posters)" }, help: "Everywhere: the main site (homepage, artist pages, agency page), the ad slots on RB Radio and RB TV, and the billboards and street posters in RB World. Each of the others shows the ad in that one place only. RB World needs an image or a video." }),\n'), encoding="utf-8")
    print("tables.js: Shows on now includes RB World")
_u = folder / "ui.js"
_us = _u.read_text(encoding="utf-8")
_old_af = r'''<option value="tv">RB TV only</option></select><div class="help">RB Radio and RB TV pages don\'t show ads yet.</div>'''
if _old_af in _us:
    _u.write_text(_us.replace(_old_af, r'''<option value="tv">RB TV only</option><option value="world">RB World only (billboards and posters)</option></select><div class="help">Everywhere includes the ad slots on RB Radio and RB TV and the billboards in RB World.</div>'''), encoding="utf-8")
    print("ui.js: the ad maker's Shows on includes RB World")
edit("tables.js",
     '      weight: f.int("Weight", { min: 1, max: 100, help: "Higher shows more often when several ads share a placement." }),\n',
     '      surface: f.pick("Shows on", ["all", "home", "radio", "tv", "world"], { required: true, labels: { all: "Everywhere ads show", home: "Main site only", radio: "RB Radio only", tv: "RB TV only", world: "RB World only (billboards and posters)" }, help: "Everywhere: the main site (homepage, artist pages, agency page), the ad slots on RB Radio and RB TV, and the billboards and street posters in RB World. Each of the others shows the ad in that one place only. RB World needs an image or a video." }),\n'
     '      weight: f.int("Weight", { min: 1, max: 100, help: "Higher shows more often when several ads share a placement." }),\n')
edit("tables.js",
     '      if (mode === "create" && v.freq_cap == null) v.freq_cap = 3;\n',
     '      if (mode === "create" && v.freq_cap == null) v.freq_cap = 3;\n'
     '      if (mode === "create" && !v.surface) v.surface = "all";\n')

# ---- ui.js: styles, nav, route, screen
CSS = r""".afgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.afopt{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--line2);border-radius:12px;background:var(--panel);color:var(--text);text-align:left;cursor:pointer;font-size:.86rem}
.afopt[aria-pressed=true]{border-color:var(--brass);box-shadow:0 0 0 2px var(--brass)}.afopt[disabled]{opacity:.5;cursor:default}
.afopt img,.afopt .afph{width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;background:#000;border:1px solid var(--line)}
.afopt .afph{display:grid;place-items:center;color:var(--muted);font-size:.8rem;padding:8px;text-align:center}
"""
edit("ui.js", ".tgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}\n",
     ".tgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}\n" + CSS)

edit("ui.js", '  if (CAPS.groups.Content) NAV_TOP.push(["colors", "Site colours"]);\n',
     '  if (CAPS.groups.Content) NAV_TOP.push(["colors", "Site colours"]);\n'
     '  if (T.ads && T.ads.canEdit && CFG.uploads) NAV_TOP.push(["affiliate", "Affiliate ads"]);\n')
edit("ui.js", '      else if (r.name === "colors") viewColors();\n',
     '      else if (r.name === "colors") viewColors();\n      else if (r.name === "affiliate") viewAffiliate();\n')

VIEW = r"""
  // ---------- affiliate ads (paste a link, get an ad on the sites)
  function viewAffiliate(){
    setTitle("Affiliate ads");
    if (!(T.ads && T.ads.canEdit && CFG.uploads)) { view.innerHTML = '<p class="empty">Your role can\'t add ads.</p>'; return; }
    var st = { d: null, creative: "", upload: "", cardTimer: null };
    view.innerHTML =
      '<p class="note">Paste an affiliate link. RB Command reads the product page and builds an ad from it, with your own picture, the page\'s picture or a card in the site colours. Publishing puts it into the ad rotation straight away, marked Sponsored. Clicks go to your link exactly as pasted, so the network still credits you. Views and clicks show under <a href="#/t/ads">Ads</a>.</p>' +
      '<section><h2>1. The link</h2><form class="panel form" id="af-get" novalidate>' +
        '<div class="field wide"><label class="lbl" for="af-url">Affiliate link</label><input type="text" inputmode="url" id="af-url" placeholder="https://…" autocomplete="off"></div>' +
        '<div class="formbar"><button class="btn primary" type="submit" id="af-read">Read the page</button><span class="muted" id="af-note" role="status"></span></div></form></section>' +
      '<div id="af-rest" hidden>' +
      '<section><h2>2. The words</h2><div class="panel form">' +
        '<div class="field"><label class="lbl" for="af-adv">Advertiser</label><input type="text" id="af-adv" maxlength="120"></div>' +
        '<div class="field"><label class="lbl" for="af-cta">Button text</label><input type="text" id="af-cta" maxlength="24"></div>' +
        '<div class="field wide"><label class="lbl" for="af-head">Headline</label><input type="text" id="af-head" maxlength="140"></div>' +
        '<div class="field wide"><label class="lbl" for="af-body">Line of text <small>optional</small></label><textarea id="af-body" maxlength="600"></textarea><div class="help">Only what the product page says. No prices, results or promises it doesn\'t make.</div></div>' +
      '</div></section>' +
      '<section><h2>3. The picture</h2><div class="afgrid" id="af-pics">' +
        '<button type="button" class="afopt" data-creative="page" aria-pressed="false"><span class="afph" id="af-page-ph">The page has no picture</span><img id="af-page-img" alt="" hidden><b>The page\'s picture</b><span class="muted">Copied into RB media.</span></button>' +
        '<button type="button" class="afopt" data-creative="upload" aria-pressed="false"><span class="afph" id="af-up-ph">Choose a JPG, PNG or WebP. Square works best.</span><img id="af-up-img" alt="" hidden><b>Upload my own</b><span class="muted" id="af-up-status">Up to 15 MB. Click again to replace.</span></button>' +
        '<button type="button" class="afopt" data-creative="card" aria-pressed="false"><span class="afph" id="af-card-ph">A card with the headline</span><img id="af-card-img" alt="" hidden><b>Make a card for me</b><span class="muted">Drawn in the homepage colours.</span></button>' +
      '</div><input type="file" id="af-file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" hidden></section>' +
      '<section><h2>4. Where it shows</h2><div class="panel form">' +
        '<div class="field"><label class="lbl" for="af-place">Placement</label><select id="af-place"><option value="sidebar">Discovery rails</option><option value="spotlight">Homepage spotlight</option><option value="both">Rails and live ticker</option></select></div>' +
        '<div class="field"><label class="lbl" for="af-surf">Shows on</label><select id="af-surf"><option value="all">Everywhere ads show</option><option value="home">Main site only</option><option value="radio">RB Radio only</option><option value="tv">RB TV only</option><option value="world">RB World only (billboards and posters)</option></select><div class="help">Everywhere includes the ad slots on RB Radio and RB TV and the billboards in RB World.</div></div>' +
        '<div class="formbar"><button class="btn primary" type="button" id="af-pub">Publish ad</button><button class="btn" type="button" id="af-pause">Save it paused</button><span class="muted">Shows up to 3 times a day per visitor. Edit, pause or delete it any time under Ads.</span></div>' +
      '</div></section></div>';
    var val = function(id){ return $(id).value.trim(); };
    var words = function(){ return { url: st.d ? st.d.url : val("af-url"), domain: st.d ? st.d.domain : "", advertiser: val("af-adv"), headline: val("af-head"), body: val("af-body"), cta: val("af-cta") }; };
    var choose = function(c){
      st.creative = c;
      view.querySelectorAll("[data-creative]").forEach(function(b){ b.setAttribute("aria-pressed", String(b.dataset.creative === c)); });
      if (c === "card") drawCard();
    };
    var drawCard = function(){
      clearTimeout(st.cardTimer);
      st.cardTimer = setTimeout(function(){
        api("affiliate/card", words()).then(function(r){
          $("af-card-img").src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(r.svg); $("af-card-img").hidden = false; $("af-card-ph").hidden = true;
        }).catch(function(){});
      }, 250);
    };
    $("af-get").addEventListener("submit", function(e){
      e.preventDefault();
      var btn = $("af-read"); btn.disabled = true; $("af-note").textContent = "Reading the page…";
      api("affiliate/preview", { url: val("af-url") }).then(function(d){
        st.d = d; S.dirty = true;
        $("af-adv").value = d.advertiser || ""; $("af-head").value = d.headline || ""; $("af-body").value = d.body || ""; $("af-cta").value = d.cta || "Shop now";
        var hasPic = !!d.image, pb = view.querySelector('[data-creative="page"]');
        pb.disabled = !hasPic; $("af-page-img").hidden = !hasPic; $("af-page-ph").hidden = hasPic;
        if (hasPic) $("af-page-img").src = d.image;
        $("af-rest").hidden = false;
        $("af-note").textContent = d.note || ("Read " + d.domain + ". Check the words, then pick a picture.");
        choose(hasPic ? "page" : "card");
        drawCard();
      }).catch(function(err){ $("af-note").textContent = err.message; }).then(function(){ btn.disabled = false; });
    });
    $("af-file").addEventListener("change", function(){
      var f = this.files && this.files[0]; if (!f) return;
      $("af-up-status").textContent = "Uploading…";
      uploadFile(f, "ads").then(function(u){
        st.upload = u.url; $("af-up-img").src = u.url; $("af-up-img").hidden = false; $("af-up-ph").hidden = true; $("af-up-status").textContent = "Uploaded.";
        choose("upload");
      }).catch(function(err){ $("af-up-status").textContent = err.message; });
      this.value = "";
    });
    view.oninput = function(e){ if (st.creative === "card" && /^af-(adv|head|body|cta)$/.test(e.target.id)) drawCard(); };
    view.onclick = function(e){
      if (e.target.id === "af-file") return;
      var opt = e.target.closest("[data-creative]");
      if (opt && !opt.disabled) {
        if (opt.dataset.creative === "upload" && (!st.upload || st.creative === "upload")) { $("af-file").click(); return; }
        choose(opt.dataset.creative); return;
      }
      if (e.target.id !== "af-pub" && e.target.id !== "af-pause") return;
      if (!st.creative) { toast("Pick a picture first"); return; }
      if (st.creative === "upload" && !st.upload) { toast("Upload the picture first"); return; }
      var body = words();
      body.creative = st.creative; body.image_url = st.upload; body.page_image = st.d ? st.d.image : "";
      body.placement = $("af-place").value; body.surface = $("af-surf").value; body.status = e.target.id === "af-pause" ? "paused" : "live";
      var btns = [$("af-pub"), $("af-pause")]; btns.forEach(function(b){ b.disabled = true; });
      api("affiliate/create", body).then(function(r){
        S.dirty = false;
        toast(body.status === "live" ? "Ad published: " + clip(r.ad.headline || r.ad.advertiser, 60) : "Ad saved, paused", r.log_id);
        go("#/t/ads/" + r.id);
      }).catch(function(err){ btns.forEach(function(b){ b.disabled = false; }); toast(err.message); });
    };
  }
"""
edit("ui.js", "  // ---------- site colours (one theme for every RB site)\n", VIEW.lstrip("\n") + "\n  // ---------- site colours (one theme for every RB site)\n")
print("rb-command patched")
