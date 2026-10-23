"""A simpler /memberships that shows what every RB page and plan includes (rb-memberships).

Usage: python3 -I patch_memberships.py <pulled rb-memberships dir>

/memberships had nine plans in three rows of equal weight, and said nothing about the RB pages that need no
membership at all. Now it reads top to bottom:
1. Free for everyone: every RB house (Radio, TV, Record, Studio mastering, Jobs, Events, Game, Book RB) with
   what you can do there and a link. Beats are pay per license; Fund is optional support, not a membership.
2. Three ways in: Passport (free), Just Starting ($5/month, waitlist) and RB Studio (from the studio's live
   pricing). Put Me In Coach is a single line linking to its application; business plans are one line linking to
   their own page.
3. What each membership includes: the member portal table comes from RB Command's member features
   (portal_features), the RB Studio table from the studio's live plans, so neither can drift from what's sold.
/memberships/business lists Business Starter, Pro and Elite. Every plan, price and join flow is unchanged.
Running it twice changes nothing.
"""
import pathlib
import sys

folder = pathlib.Path(sys.argv[1])
p = folder / "index.js"
s = p.read_text(encoding="utf-8")
changed = []


def rep(old, new, what):
    global s
    if new in s:
        return
    if s.count(old) != 1:
        raise SystemExit(f"rb-memberships: {what}: anchor found {s.count(old)} times")
    s = s.replace(old, new)
    changed.append(what)


NEW_OVERVIEW = r'''// Every RB house, and what anyone can do there without a membership.
const HOUSES = [
  { name: "RB Radio", href: "/radio", what: "One station, live around the clock. Listen and send requests." },
  { name: "RB TV", href: "/tv", what: "Music videos, originals, shorts and events." },
  { name: "Record", href: "/record/", what: "Record vocals over RB beats, build drums and melodies, mix and export in your browser." },
  { name: "RB Studio", href: "/studio/", what: "Upload a mix, hear it mastered and download the WAV or MP3." },
  { name: "RB Jobs", href: "/jobs", what: "Search jobs, get new ones by email and make a resume." },
  { name: "Events", href: "/events", what: "See what's on. Tickets are priced per event." },
  { name: "Game", href: "/game/", what: "Build your empire, in your browser." },
  { name: "Book RB", href: "/book", what: "Ask for services, events or tables. RB replies with a quote." },
];
const YES = `<span aria-hidden="true">✓</span><span class="vh">Included</span>`, NO = `<span aria-hidden="true" class="no">–</span><span class="vh">Not included</span>`;
function freeSection() {
  const list = HOUSES.map((h) => `<li><a href="${h.href}"><b>${esc(h.name)}</b><span>${esc(h.what)}</span></a></li>`).join("");
  return `<section class="set" aria-labelledby="free-h"><div class="set-head"><h2 id="free-h">Free for everyone</h2><p>No membership needed for any of these.</p></div>
<ul class="houses">${list}</ul>
<p class="aside">Beats are licensed one at a time on <a href="https://beatstore.relentlessbillionaire.com/">the beat store</a>, from a $1 sample to exclusive rights. <a href="/fund">Backing the vision</a> is optional support, not a membership.</p></section>`;
}
function studioCard(d) {
  const plan = (id) => d && d.plans.find((x) => x.id === id && x.regular > 0);
  const artist = plan("artist_month"), pro = plan("pro_month"), year = plan("artist_year"), single = plan("single");
  if (!artist) return `<article class="card"><p class="kicker">RB Studio</p><h3>RB Studio</h3><p>Mastering is free. Memberships add pro tools for every master.</p><p class="how"></p><a class="btn" href="/studio/pricing">See RB Studio plans</a></article>`;
  const open = d.live === true;
  const more = [pro && `Pro: ${usd(pro.regular)}/${pro.interval}, adds RB Cloud`, year && `Artist yearly: ${usd(year.regular)}/year`, single && `One song: ${usd(single.regular)} for a single master`].filter(Boolean);
  return `<article class="card"><p class="kicker">${open ? "Open now" : "Opening soon"}</p><h3>RB Studio</h3><p class="price">${esc(usd(artist.regular))} <small>/ ${esc(artist.interval)}</small></p><p>For artists releasing music: ${esc(artist.blurb.charAt(0).toLowerCase() + artist.blurb.slice(1))}.</p>
<ul class="perks">${more.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
<p class="how">${open ? "Mastering and downloads stay free. Cancel anytime online." : "Join the RB Studio list to hear when checkout opens."}</p>
<a class="btn" href="/studio/pricing${open ? "#plan-artist_month" : ""}">${open ? "Choose Artist" : "See plans"}</a></article>`;
}
function memberTable(feats) {
  if (!feats.length) return "";
  const cols = ["passport", "just-starting", "coach"];
  const head = cols.map((id) => `<th scope="col">${esc(TIERS[id].name)}<small>${TIERS[id].per ? `${esc(TIERS[id].price)}/${esc(TIERS[id].per)}` : esc(TIERS[id].price)}</small></th>`).join("");
  const rows = feats.map((f) => `<tr><th scope="row">${esc(featLabel(f))}</th>${cols.map((id) => `<td>${Number(f[TIERS[id].col]) === 1 ? YES : NO}</td>`).join("")}</tr>`).join("");
  return `<div class="cmp-wrap"><table class="cmp"><caption>RB member portal</caption><thead><tr><td></td>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}
function studioTable(d) {
  const plan = (id) => d && d.plans.find((x) => x.id === id && x.regular > 0);
  const artist = plan("artist_month"), pro = plan("pro_month");
  if (!artist || !pro) return "";
  const proOnly = (pro.features || []).filter((f) => !/^Everything in /.test(f));
  const rows = [["Mastering, level-matched compare, WAV and MP3 downloads", 1, 1, 1]]
    .concat((artist.features || []).map((f) => [f, 0, 1, 1]), proOnly.map((f) => [f, 0, 0, 1]));
  const cell = (on) => `<td>${on ? YES : NO}</td>`;
  return `<div class="cmp-wrap"><table class="cmp"><caption>RB Studio</caption><thead><tr><td></td><th scope="col">Free<small>$0</small></th><th scope="col">${esc(artist.name)}<small>${esc(usd(artist.regular))}/${esc(artist.interval)}</small></th><th scope="col">${esc(pro.name)}<small>${esc(usd(pro.regular))}/${esc(pro.interval)}</small></th></tr></thead>
<tbody>${rows.map(([f, a, b, c]) => `<tr><th scope="row">${esc(f)}</th>${cell(a)}${cell(b)}${cell(c)}</tr>`).join("")}</tbody></table></div>`;
}
function overview(d, feats) {
  const coach = TIERS.coach;
  const tables = memberTable(feats) + studioTable(d);
  return layout({
    title: "Memberships", canonical: SITE + "/memberships",
    description: "Most of Relentless Billionaire is free. Memberships: Passport (free), Just Starting, RB Studio for artists, Put Me In Coach, and business plans.",
    body: `<section class="hero"><p class="kicker">Relentless Billionaire</p><h1>Memberships</h1><p class="lead">Most of RB is free. A membership adds your own space and tools. Nothing is charged until you choose to join.</p></section>
${freeSection()}
<section class="set" aria-labelledby="ways-h"><div class="set-head"><h2 id="ways-h">Three ways in</h2><p>Start free with Passport. Creators can add a page of their own, or pro tools for their masters.</p></div>
<div class="cards">${tierCard("passport", feats)}${tierCard("just-starting", feats)}${studioCard(d)}</div>
<ul class="also"><li><b>Want one-on-one coaching?</b> ${esc(coach.name)} is ${esc(coach.price)}/${esc(coach.per)}, by application. <a href="/memberships/coach">Apply</a></li>
<li><b>Running a business?</b> Business plans from ${esc(TIERS["business-starter"].price)}/month add savings on RB services and priority booking. <a href="/memberships/business">See business plans</a></li></ul></section>
${tables ? `<section class="set" aria-labelledby="cmp-h"><div class="set-head"><h2 id="cmp-h">What each membership includes</h2><p>Passport, Just Starting and Coach share the RB member portal. RB Studio plans are for mastering.</p></div>${tables}</section>` : ""}`,
  });
}
function businessPage() {
  const cards = Object.keys(TIERS).filter((id) => TIERS[id].group === "business").map((id) => tierCard(id, [])).join("");
  return layout({
    title: "Business memberships", canonical: SITE + "/memberships/business",
    description: "Relentless Billionaire business memberships: Business Starter, Pro and Elite. Savings on RB services, priority booking and direct time with RB.",
    body: `<p class="back"><a href="/memberships">← All memberships</a></p>
<section class="hero"><p class="kicker">For businesses</p><h1>Business memberships</h1><p class="lead">Savings on RB services, priority booking and direct time with RB. Every plan is by application, and nothing is charged before the call.</p></section>
<div class="cards">${cards}</div>`,
  });
}

function field('''

START = "function overview(d, feats) {\n"
END = "\nfunction field("
if "function businessPage()" not in s:
    if s.count(START) != 1 or s.count(END) != 1:
        raise SystemExit("rb-memberships: overview: anchor not found once")
    a = s.index(START)
    b = s.index(END, a) + len(END)
    s = s[:a] + NEW_OVERVIEW + s[b:]
    changed.append("overview")

rep('      const tm = path.match(/^\\/memberships\\/([a-z-]+)$/);\n',
    '      if (path === "/memberships/business") return page(businessPage());\n      const tm = path.match(/^\\/memberships\\/([a-z-]+)$/);\n',
    "business page route")
rep('    body: `<p class="back"><a href="/memberships">← All memberships</a></p>\n<section class="tier">',
    '    body: `<p class="back"><a href="/memberships${t.group === "business" ? "/business" : ""}">← ${t.group === "business" ? "Business plans" : "All memberships"}</a></p>\n<section class="tier">',
    "business back link")
rep('const CSS_VERSION = "5";', 'const CSS_VERSION = "6";', "css version")
rep("\n@media (prefers-reduced-motion:reduce){*{transition:none!important}}`;",
    "\n.vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}"
    "\n.houses{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,230px),1fr));gap:12px}"
    "\n.houses a{display:grid;gap:4px;height:100%;padding:16px 18px;border:1px solid var(--line);border-radius:14px;background:rgba(36,21,40,.55);text-decoration:none;color:var(--cream)}"
    "\n.houses a:hover{border-color:var(--a2)}.houses b{color:var(--a2b);font-weight:700}.houses span{color:var(--light);font-size:14px}"
    "\n.aside{color:var(--light);font-size:14px;max-width:70ch}"
    "\n.also{list-style:none;margin:0;padding:0;display:grid;gap:10px}.also li{padding:14px 18px;border:1px solid var(--line);border-radius:14px;color:var(--light);font-size:15px}.also b{color:var(--cream)}"
    "\n.set{min-width:0}.cmp-wrap{overflow-x:auto;max-width:100%;border:1px solid var(--line);border-radius:14px}"
    "\n.cmp{width:100%;border-collapse:collapse;font-size:14px}"
    "\n.cmp caption{text-align:left;padding:14px 16px 6px;font:500 20px/1.2 \"Bodoni Moda\",Georgia,serif}"
    "\n.cmp th,.cmp td{padding:10px 8px;border-top:1px solid var(--line);text-align:center;vertical-align:top}"
    "\n.cmp thead th,.cmp thead td{border-top:0}.cmp thead th{font-weight:700}.cmp thead small{display:block;font-weight:400;color:var(--dim);font-size:12px}"
    "\n.cmp tbody th{text-align:left;font-weight:500;color:var(--light);width:44%}.cmp td{color:var(--a2b);font-weight:700}.cmp .no{color:var(--dim)}"
    "\n.cmp-wrap + .cmp-wrap{margin-top:16px}"
    "\n@media (prefers-reduced-motion:reduce){*{transition:none!important}}`;",
    "styles")

p.write_text(s, encoding="utf-8")
print("rb-memberships: " + (", ".join(changed) + " updated" if changed else "memberships page already simplified"))
