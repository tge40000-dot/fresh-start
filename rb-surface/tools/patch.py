import sys
src, dst = sys.argv[1], sys.argv[2]
s = open(src, encoding="utf-8").read()
def rep(old, new):
    global s
    n = s.count(old)
    if n != 1: raise SystemExit(f"anchor found {n} times: {old[:80]!r}")
    s = s.replace(old, new)

# 1. Surface helper next to the slot definitions.
rep('''var AD_SLOTS = { rail: "(placement='sidebar' OR placement='both')", spotlight: "placement='spotlight'" };''',
'''var AD_SLOTS = { rail: "(placement='sidebar' OR placement='both')", spotlight: "placement='spotlight'" };
// Surface targeting: /api/ads?surface=home|radio|tv returns ads set to that surface or to 'all'. No surface (or 'all') returns every ad.
var AD_SURFACES = ["home", "radio", "tv", "all"];
function adSurface(v) {
  const s = String(v == null ? "" : v).trim().toLowerCase() || "all";
  return AD_SURFACES.includes(s) ? s : null;
}''')

# 2. Schema: surface column, applied once via the schema version bump.
rep('''  await run("ALTER TABLE signups ADD COLUMN source TEXT");''',
'''  await run("ALTER TABLE signups ADD COLUMN source TEXT");
  await run("ALTER TABLE ads ADD COLUMN surface TEXT NOT NULL DEFAULT 'all'");''')
rep('var RB_SCHEMA_VERSION = "artist-router-v14.2";', 'var RB_SCHEMA_VERSION = "artist-router-v14.3";')

# 3. /go/ad keeps hyphenated slots such as radio-rail in utm_content.
rep('''.replace(/[^a-z]/g, "").slice(0, 12) || "site"''', '''.replace(/[^a-z-]/g, "").slice(0, 24) || "site"''')

# 4. GET /api/ads: surface filter, click slot and surface field.
rep('''        const slot = url.searchParams.get("slot") === "spotlight" ? "spotlight" : "rail";
''', '''        const slot = url.searchParams.get("slot") === "spotlight" ? "spotlight" : "rail";
        const surface = adSurface(url.searchParams.get("surface"));
        if (!surface) return json({ ok: false, error: "surface must be home, radio, tv, or all" }, 400, { "Cache-Control": "no-store" });
        const clickSlot = surface === "all" ? slot : surface + "-" + slot;
''')
rep('''`SELECT id,advertiser,headline,body,image_url,click_url,weight,format,video_url,poster_url,cta,freq_cap FROM ads WHERE status='live' AND ${AD_SLOTS[slot]}''',
    '''`SELECT id,advertiser,headline,body,image_url,click_url,weight,format,video_url,poster_url,cta,freq_cap,surface FROM ads WHERE status='live' AND ${AD_SLOTS[slot]}''')
rep('''OR COALESCE(impressions, 0) < max_impressions)`
        ).all();''', '''OR COALESCE(impressions, 0) < max_impressions)${surface === "all" ? "" : " AND (surface IS NULL OR surface = 'all' OR surface = ?)"}`
        ).bind(...(surface === "all" ? [] : [surface])).all();''')
rep('''click: adHttp(a.click_url) ? `/go/ad/${a.id}?s=${slot}` : null''', '''click: adHttp(a.click_url) ? `/go/ad/${a.id}?s=${clickSlot}` : null''')
rep('''freq_cap: Number(a.freq_cap) > 0 ? Number(a.freq_cap) : 0 };''', '''freq_cap: Number(a.freq_cap) > 0 ? Number(a.freq_cap) : 0, surface: a.surface || "all" };''')
rep('''        return json({ ads }, 200, { "Cache-Control": "no-store" });
      }''', '''        return json({ ads, surface }, 200, { "Cache-Control": "no-store" });
      }
      if (path === "/api/ads" && request.method === "POST") {
        if (!await isAdmin()) return needAdmin();
        let b;
        try { b = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }
        const id = Number(b && b.id);
        const surface = b && b.surface != null && String(b.surface).trim() ? adSurface(b.surface) : null;
        if (!Number.isInteger(id) || id <= 0 || !surface) return json({ ok: false, error: "id and surface (home, radio, tv, or all) are required" }, 400);
        const res = await env.DB.prepare("UPDATE ads SET surface = ? WHERE id = ?").bind(surface, id).run();
        if (!res.meta?.changes) return json({ ok: false, error: "No ad with that id" }, 404);
        return json({ ok: true, id, surface });
      }''')
open(dst, "w", encoding="utf-8").write(s)
print("patched ok")
