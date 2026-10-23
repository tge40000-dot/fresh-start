/**
 * Waitlist API — Cloudflare Worker + D1
 * Endpoints:
 *   POST /signup   { name, email }  -> { ok, position, total, spotsLeft, name }
 *   GET  /stats                     -> { total, spotsLeft, totalSpots }
 *   GET  /export                    -> CSV of all signups
 *   GET  /health                    -> { ok: true }
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function hashIP(ip) {
  if (!ip) return null;
  const data = new TextEncoder().encode(ip + "waitlist-salt");
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (path === "/health") {
      return json({ ok: true });
    }

    if (path === "/stats" && request.method === "GET") {
      const totalSpots = parseInt(env.TOTAL_SPOTS || "500", 10);
      const row = await env.DB.prepare("SELECT COUNT(*) as count FROM signups").first();
      const total = row?.count ?? 0;
      return json({ total, totalSpots, spotsLeft: Math.max(0, totalSpots - total) });
    }

    if (path === "/signup" && request.method === "POST") {
      let body;
      try { body = await request.json(); } catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

      const name = (body?.name || "").trim();
      const email = (body?.email || "").trim().toLowerCase();

      if (!name || name.length > 100) return json({ ok: false, error: "Please enter your name." }, 400);
      if (!isValidEmail(email)) return json({ ok: false, error: "Please enter a valid email." }, 400);

      const totalSpots = parseInt(env.TOTAL_SPOTS || "500", 10);

      const existing = await env.DB.prepare("SELECT rowid FROM signups WHERE email = ?").bind(email).first();
      if (existing) {
        const posRow = await env.DB.prepare("SELECT COUNT(*) as position FROM signups WHERE rowid <= ?").bind(existing.rowid).first();
        const position = posRow?.position ?? 1;
        const countRow = await env.DB.prepare("SELECT COUNT(*) as count FROM signups").first();
        const total = countRow?.count ?? 0;
        return json({ ok: true, alreadyRegistered: true, name, position, total, spotsLeft: Math.max(0, totalSpots - total) });
      }

      const ipHash = await hashIP(request.headers.get("CF-Connecting-IP"));
      try {
        await env.DB.prepare("INSERT INTO signups (email, name, ip_hash) VALUES (?, ?, ?)").bind(email, name, ipHash).run();
      } catch (e) {
        if (e.message && e.message.includes("UNIQUE")) return json({ ok: false, error: "You're already on the list!" }, 409);
        throw e;
      }

      const countRow = await env.DB.prepare("SELECT COUNT(*) as count FROM signups").first();
      const total = countRow?.count ?? 1;
      const position = total;

      return json({ ok: true, name, position, total, spotsLeft: Math.max(0, totalSpots - total) });
    }

    // ---- CSV export of all signups ----
    if (path === "/export" && request.method === "GET") {
      const results = await env.DB.prepare("SELECT id, name, email, created_at FROM signups ORDER BY id ASC").all();
      const rows = results.results || [];
      const csvLines = ["id,name,email,created_at"];
      for (const r of rows) {
        const safeName = '"' + String(r.name || "").replace(/"/g, '""') + '"';
        const safeEmail = '"' + String(r.email || "").replace(/"/g, '""') + '"';
        csvLines.push([r.id, safeName, safeEmail, r.created_at].join(","));
      }
      const csv = csvLines.join("\n");
      return new Response(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": "attachment; filename=waitlist-export.csv",
          ...CORS_HEADERS,
        },
      });
    }

    return json({ ok: false, error: "Not found" }, 404);
  },
};