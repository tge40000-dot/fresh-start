// ---- /advertise (media kit) and the RB list with interests (rb-site-updates/patch_advertise.py) ----
// /advertise shows advertisers real numbers only: the site's last 30 days (saved by RB Command from Cloudflare Web
// Analytics, totals only, bots left out) and what the ad slots delivered (ad_stats). No prices: rates are set per
// campaign by email. POST /api/list adds someone to the RB list (signups) with what they want to hear about.
var RB_LIST_INTERESTS = [
  ["beats", "Beats and releases"], ["comedy", "Comedy shows"], ["nightlife", "Nightlife and The Club"],
  ["studio", "Studio and mastering"], ["gaming", "Billionaire Empire"], ["jobs", "RB Jobs"]
];
var RB_AD_PLACEMENTS = { spotlight: "Homepage spotlight", sidebar: "Discovery rail and ad slots", both: "Rail and live ticker", ticker: "Live ticker" };

async function rbListJoin(request, env) {
  let b;
  try { b = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
  const name = String(b?.name || "").trim().slice(0, 100);
  const email = String(b?.email || "").trim().toLowerCase();
  const keys = RB_LIST_INTERESTS.map((x) => x[0]);
  const picks = [...new Set((Array.isArray(b?.interests) ? b.interests : []).map(String))].filter((k) => keys.includes(k));
  if (!name) return json({ ok: false, error: "Please enter your name." }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return json({ ok: false, error: "Please enter a valid email." }, 400);
  if (!picks.length) return json({ ok: false, error: "Pick at least one thing to hear about." }, 400);
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS signup_interests (email TEXT NOT NULL, interest TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (email, interest))").run();
  const existing = await env.DB.prepare("SELECT rowid FROM signups WHERE email = ?").bind(email).first();
  if (!existing) {
    const ipHash = await hashIP(request.headers.get("CF-Connecting-IP"));
    await env.DB.prepare("INSERT OR IGNORE INTO signups (email,name,ip_hash,source) VALUES (?,?,?,?)").bind(email, name, ipHash, "rb-list").run();
  }
  await env.DB.batch(picks.map((k) => env.DB.prepare("INSERT OR IGNORE INTO signup_interests (email, interest) VALUES (?, ?)").bind(email, k)));
  return json({ ok: true, alreadyRegistered: !!existing, interests: picks });
}

async function rbAdvertisePage(env) {
  const n = (v) => Number(v || 0).toLocaleString("en-US");
  const pct = (a, b) => (b ? ((a / b) * 100).toFixed(a / b < 0.1 ? 2 : 1) + "%" : "—");
  let kit = null, kitAt = "", slots = [];
  try {
    const row = await env.DB.prepare("SELECT json, updated_at FROM site_stats WHERE key = 'media_kit_30d'").first();
    if (row) { kit = JSON.parse(row.json); kitAt = row.updated_at; }
  } catch {}
  try {
    const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    slots = (await env.DB.prepare("SELECT a.placement AS placement, SUM(s.impressions) AS views, SUM(s.viewable) AS viewable, SUM(s.clicks) AS clicks FROM ad_stats s JOIN ads a ON a.id = s.ad_id WHERE s.day >= ? GROUP BY a.placement ORDER BY views DESC").bind(since).all()).results || [];
  } catch {}
  const day = (t) => { try { return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); } catch { return ""; } };
  const tile = (label, value) => `<div class="tile"><b>${value}</b><span>${label}</span></div>`;
  const shares = (list) => (list || []).map((x) => `<li><span>${esc(x.name)}</span><b>${x.pct}%</b></li>`).join("");
  const traffic = kit
    ? `<p class="note">${esc(day(kit.from))} to ${esc(day(kit.to))}, measured by Cloudflare Web Analytics. Bots and site checks are left out. Updated ${esc(day(kitAt))}.</p>
<div class="tiles">${tile("Visits", n(kit.visits))}${tile("Page views", n(kit.views))}${tile("Pages per visit", kit.visits ? (kit.views / kit.visits).toFixed(1) : "—")}</div>
${kit.sites && kit.sites.length ? `<h3>By site</h3><div class="scroll"><table><thead><tr><th>Site</th><th>Visits</th><th>Page views</th></tr></thead><tbody>${kit.sites.map((s) => `<tr><td>${esc(s.host)}</td><td>${n(s.visits)}</td><td>${n(s.views)}</td></tr>`).join("")}</tbody></table></div>` : ""}
<div class="split">${kit.devices && kit.devices.length ? `<div><h3>Devices</h3><ul class="shares">${shares(kit.devices)}</ul></div>` : ""}${kit.countries && kit.countries.length ? `<div><h3>Top countries</h3><ul class="shares">${shares(kit.countries)}</ul></div>` : ""}</div>`
    : `<p class="note">The traffic numbers appear here after RB Command's next daily update.</p>`;
  const ads = slots.length
    ? `<div class="scroll"><table><thead><tr><th>Placement</th><th>Views</th><th>Viewable</th><th>Clicks</th><th>Click rate</th></tr></thead><tbody>${slots.map((s) => `<tr><td>${esc(RB_AD_PLACEMENTS[s.placement] || s.placement || "Other")}</td><td>${n(s.views)}</td><td>${pct(s.viewable, s.views)}</td><td>${n(s.clicks)}</td><td>${pct(s.clicks, s.views)}</td></tr>`).join("")}</tbody></table></div>`
    : `<p class="note">No ads have run in the last 30 days, so there are no slot numbers yet.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Advertise | Relentless Billionaire</title><meta name="description" content="Advertise on Relentless Billionaire: real traffic for the last 30 days and what each ad slot delivered.">
<link rel="canonical" href="https://relentlessbillionaire.com/advertise">
<style>
:root{--bg:#0b0a09;--panel:rgba(255,255,255,.035);--line:rgba(212,175,55,.22);--text:#f3ede4;--muted:#b9b0a8;--gold:#d4af37}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:920px;margin:0 auto;padding:28px 16px 64px}a{color:var(--gold)}
.top{display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:.85rem}.top a{text-decoration:none}
h1{font-family:Georgia,"Times New Roman",serif;font-weight:400;font-size:clamp(2rem,6vw,3rem);line-height:1.05;margin:28px 0 8px}h1 em{color:var(--gold)}
h2{font-size:1.05rem;letter-spacing:.08em;text-transform:uppercase;color:var(--gold);margin:36px 0 10px}h3{font-size:.95rem;margin:20px 0 8px}
.lead{color:var(--muted);max-width:640px}.note{color:var(--muted);font-size:.85rem}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}
.tile{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px}.tile b{display:block;font-size:1.7rem;font-weight:600}.tile span{color:var(--muted);font-size:.8rem}
.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:12px}table{width:100%;border-collapse:collapse;font-size:.88rem}
th,td{padding:9px 12px;text-align:left;border-bottom:1px solid rgba(255,255,255,.06);white-space:nowrap}th{color:var(--muted);font-weight:500}tr:last-child td{border-bottom:0}td:not(:first-child),th:not(:first-child){text-align:right}
.split{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:18px}.shares{list-style:none;margin:0;padding:0}.shares li{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.06)}
.inv{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;padding:0;list-style:none}.inv li{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px}.inv b{display:block}.inv span{color:var(--muted);font-size:.82rem}
.cta{display:inline-block;margin-top:14px;padding:12px 20px;border-radius:999px;background:var(--gold);color:#111;font-weight:700;text-decoration:none}
</style></head><body><main>
<div class="top"><a href="/">&larr; Relentless Billionaire</a><a href="mailto:advertise@relentlessbillionaire.com?subject=Relentless%20Billionaire%20Advertising%20Inquiry">advertise@relentlessbillionaire.com</a></div>
<h1>Put your brand <em>in the signal.</em></h1>
<p class="lead">Music, comedy, nightlife and culture from the Bay, across one set of sites. These are the real numbers, straight from our analytics and ad counters.</p>
<h2>Audience, last 30 days</h2>${traffic}
<h2>Ad slots, last 30 days</h2>${ads}
<p class="note">A view counts when the ad is drawn on the page. It is viewable once half of it has been on screen for 1 second (2 for video). Bots and link previews don't count.</p>
<h2>Where ads run</h2>
<ul class="inv"><li><b>Homepage spotlight</b><span>Image or video, at the top of the homepage.</span></li><li><b>Live ticker mention</b><span>A line in the homepage's live ticker.</span></li><li><b>Sponsored discovery rail</b><span>Cards in the homepage rails on desktop.</span></li><li><b>RB Radio and RB TV slots</b><span>Sponsored cards on the radio and TV pages.</span></li></ul>
<p class="note">Every ad is marked Sponsored. Each campaign gets a private live report with its views, viewable views and clicks.</p>
<h2>Rates</h2>
<p>Rates are set per campaign. Email us your dates, the placements you want and your budget, and we'll reply with a quote.</p>
<a class="cta" href="mailto:advertise@relentlessbillionaire.com?subject=Relentless%20Billionaire%20Advertising%20Placement">Request placement &rarr;</a>
</main></body></html>`;
}

// The RB list block on the homepage: one signup, with what each person wants to hear about.
function rbListSection() {
  const boxes = RB_LIST_INTERESTS.map((x) => `<label class="rbl-pick"><input type="checkbox" name="interest" value="${x[0]}"> ${esc(x[1])}</label>`).join("");
  return `<section class="rb-sec rbl" id="rb-list" aria-labelledby="rb-list-title">
    <div class="rb-sec-head"><div><p class="rb-kicker">One list, every house</p><h2 id="rb-list-title" class="rb-h2">Join the <em>RB list.</em></h2></div></div>
    <form class="rbl-form" id="rbl-form" novalidate>
      <div class="rbl-row"><label class="rbl-field"><span>Name</span><input name="name" autocomplete="name" maxlength="100" required></label><label class="rbl-field"><span>Email</span><input name="email" type="email" autocomplete="email" maxlength="254" required></label></div>
      <fieldset class="rbl-picks"><legend>What do you want to hear about?</legend>${boxes}</fieldset>
      <button class="rbl-go" type="submit">Join the list</button>
      <p class="rbl-msg" id="rbl-msg" role="status" aria-live="polite"></p>
      <p class="rbl-fine">We only email you about what you tick. For job alerts by state and keyword, use <a href="/jobs">RB Jobs</a>. <a href="/privacy">Privacy</a>.</p>
    </form>
  </section>
  <style>.rbl-form{max-width:720px}.rbl-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}.rbl-field{display:flex;flex-direction:column;gap:4px;font-size:.8rem;color:var(--muted,#b9b0a8)}.rbl-field input{min-width:0;padding:11px 12px;border-radius:10px;border:1px solid rgba(212,175,55,.35);background:rgba(255,255,255,.04);color:inherit;font:inherit}.rbl-picks{border:0;margin:14px 0;padding:0;display:flex;flex-wrap:wrap;gap:8px}.rbl-picks legend{font-size:.85rem;margin-bottom:8px}.rbl-pick{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;border:1px solid rgba(212,175,55,.35);font-size:.85rem;cursor:pointer}.rbl-go{appearance:none;border:0;border-radius:999px;padding:12px 22px;background:var(--rb-gold,#d4af37);color:#111;font:700 .9rem/1 inherit;cursor:pointer}.rbl-go:disabled{opacity:.6}.rbl-fine a{color:var(--rb-gold,#d4af37)}.rbl-msg{min-height:1.2em;margin:10px 0 0;font-size:.85rem}.rbl-msg.bad{color:#ffb0bd}.rbl-fine{font-size:.75rem;color:var(--muted,#b9b0a8);margin:6px 0 0}</style>
  <script>(function(){var f=document.getElementById('rbl-form');if(!f)return;var m=document.getElementById('rbl-msg');f.addEventListener('submit',function(e){e.preventDefault();var picks=[].slice.call(f.querySelectorAll('input[name=interest]:checked')).map(function(x){return x.value});m.className='rbl-msg';m.textContent='Adding you\\u2026';var b=f.querySelector('button');b.disabled=true;fetch('/api/list',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:f.elements['name'].value,email:f.elements['email'].value,interests:picks})}).then(function(r){return r.json()}).then(function(d){b.disabled=false;if(!d.ok){m.className='rbl-msg bad';m.textContent=d.error||'That didn\\u2019t work. Try again.';return}m.textContent=d.alreadyRegistered?'You were already on the list. We added what you ticked.':'You\\u2019re on the RB list.';f.reset()}).catch(function(){b.disabled=false;m.className='rbl-msg bad';m.textContent='That didn\\u2019t work. Try again.'})})})();</script>`;
}
