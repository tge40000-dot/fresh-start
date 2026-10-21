"""The media kit at /advertise and the RB list with interests, in a pulled artist-router Worker.

Usage: python3 -I patch_advertise.py <pulled artist-router dir>

Adds src/advertise.js to artist-router-v14.js, then:
- GET /advertise: real numbers for advertisers. The last 30 days of traffic (saved by RB Command, see
  rb-command-updates/patch_media_kit.py), what each ad placement delivered, where ads run, and "rates set per campaign"
  with the existing advertise@ email. No prices are shown.
- POST /api/list: joins the RB list (the existing signups table, source "rb-list" for new people) and records what each
  person wants to hear about in signup_interests (beats, comedy, nightlife, studio, gaming, jobs).
- Homepage: a "See the numbers" link next to "Request placement", the "Join the RB list" block after the ad
  spotlight, and the footer's "Advertise" opens /advertise.
- The admin waitlist CSV export gets an interests column.
Running it twice changes nothing.
"""
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
p = pathlib.Path(sys.argv[1]) / "artist-router-v14.js"
s = p.read_text(encoding="utf-8")
block = (HERE / "src" / "advertise.js").read_text(encoding="utf-8")
MARK = "// ---- /advertise (media kit) and the RB list with interests"

edits = [
    ("async function hubPage(env) {", block + "\nasync function hubPage(env) {"),
    ('    if (path === "/beats" || path === "/beats/") {\n',
     '    if (path === "/advertise" || path === "/advertise/") {\n'
     '      return new Response(await rbAdvertisePage(env), { status: 200, headers: DYNAMIC_HTML_HEADERS });\n'
     '    }\n'
     '    if (path === "/beats" || path === "/beats/") {\n'),
    ('      if (path === "/api/signup" && request.method === "POST") {\n',
     '      if (path === "/api/list" && request.method === "POST") return rbListJoin(request, env);\n'
     '      if (path === "/api/signup" && request.method === "POST") {\n'),
    ('href="mailto:advertise@relentlessbillionaire.com?subject=Relentless%20Billionaire%20Advertising%20Placement">Request placement ${RB_ARROW}</a></div>\n  </section></div>\n',
     'href="mailto:advertise@relentlessbillionaire.com?subject=Relentless%20Billionaire%20Advertising%20Placement">Request placement ${RB_ARROW}</a> <a class="glass-cta" href="/advertise">See the numbers ${RB_ARROW}</a></div>\n  </section></div>\n\n  ${rbListSection()}\n'),
    ('const r = h ? await env.DB.prepare("SELECT id,name,email,source,created_at FROM signups WHERE source=? ORDER BY id ASC").bind(h).all() : await env.DB.prepare("SELECT id,name,email,source,created_at FROM signups ORDER BY id ASC").all();',
     'await env.DB.prepare("CREATE TABLE IF NOT EXISTS signup_interests (email TEXT NOT NULL, interest TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime(\'now\')), PRIMARY KEY (email, interest))").run();\n'
     '        const IQ = "(SELECT group_concat(interest, \' \') FROM signup_interests i WHERE i.email = signups.email) AS interests";\n'
     '        const r = h ? await env.DB.prepare("SELECT id,name,email,source,created_at," + IQ + " FROM signups WHERE source=? ORDER BY id ASC").bind(h).all() : await env.DB.prepare("SELECT id,name,email,source,created_at," + IQ + " FROM signups ORDER BY id ASC").all();'),
    ('const lines = ["id,name,email,source,created_at"];\n        for (const row of r.results || []) lines.push([row.id, q(row.name), q(row.email), q(row.source), row.created_at].join(","));',
     'const lines = ["id,name,email,source,created_at,interests"];\n        for (const row of r.results || []) lines.push([row.id, q(row.name), q(row.email), q(row.source), row.created_at, q(row.interests)].join(","));'),
]
# The footer's "Advertise" goes to the media kit (it has the email address), since a live ad can replace the spotlight.
edits.append(('href="mailto:advertise@relentlessbillionaire.com?subject=Relentless%20Billionaire%20Advertising%20Inquiry">Advertise</a>',
              'href="/advertise">Advertise</a>'))
done = 0
if MARK in s:
    # Already added: bring an older copy of the block up to date with src/advertise.js.
    start = s.index(MARK)
    end = s.index("\nasync function hubPage(env) {", start)
    if s[start:end] != block:
        s = s[:start] + block + s[end:]
        done += 1
for i, (old, new) in enumerate(edits):
    if (MARK in s) if i == 0 else (new in s):
        continue
    if s.count(old) != 1:
        raise SystemExit(f"artist-router: anchor found {s.count(old)} times: {old[:80]!r}")
    s = s.replace(old, new)
    done += 1
if done:
    p.write_text(s, encoding="utf-8")
print(f"artist-router: /advertise and the RB list: {done} edit(s) made" if done else "artist-router: /advertise and the RB list already in place")
