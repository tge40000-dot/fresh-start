// rb-daw: RB Studio, the in-browser recording studio, on studio.relentlessbillionaire.com/ and relentlessbillionaire.com/record/.
// Serves the app, its cloud saves (D1 + R2, keyed by a device cookie shared across *.relentlessbillionaire.com), RB beats
// for recording on, and passes everything else to the earlier apps (relentless-studio and recording-studio), which
// stay reachable at /classic and /record/classic.
import { ASSETS, BUILD, SHELL } from "./assets.js";

const MAIN = "relentlessbillionaire.com";
const CANONICAL = "https://studio.relentlessbillionaire.com/";
const STORE = "https://beatstore.relentlessbillionaire.com/#beats";
const COOKIE = "rbdaw_owner";
const MAX_PROJECT = 1024 * 1024;           // project JSON
const MAX_FILE = 95 * 1024 * 1024;         // one recording or import
const QUOTA = 1024 * 1024 * 1024;          // all files for one browser
const MAX_PROJECTS = 300;
const BEAT_HOSTS = ["studio.relentlessbillionaire.vip", "media.relentlessbillionaire.com", "beatstore.relentlessbillionaire.com"];
// media.relentlessbillionaire.com is another Worker on this zone, which this Worker's fetch() can't run (only a copy already in
// the edge cache answers, so uncached beats failed with 502). The browser is sent there instead (it allows any origin, and ranges).
const BEAT_MEDIA = "https://media.relentlessbillionaire.com";
const ID = /^[a-z][a-z0-9]{5,31}$/;

export default {
  async fetch(req, env, ctx) {
    try { return await handle(req, env, ctx); }
    catch (e) { console.error("rb-daw", req.method, new URL(req.url).pathname, e && e.stack || e); return json({ error: "The studio server hit a problem. Try again." }, 500); }
  },
};

async function handle(req, env, ctx) {
  const url = new URL(req.url), path = url.pathname;
  const main = url.hostname === MAIN || url.hostname === "www." + MAIN || (env.DEV === "1" && path.startsWith("/record"));
  const base = main ? "/record/" : "/";
  if (main) {
    if (path === "/record") return redirect(url, "/record/");
    if (path === "/record/classic" || path === "/record/classic/") return legacy(env.LEGACY_RECORD, req, url, "/record/");
    const sm = path.match(/^\/record\/s\/([a-z0-9]{10})(\/audio|\/report)?$/);
    if (sm) return share(req, env, ctx, url, sm[1], sm[2] || "", "/record/");
    if (path !== "/record/" && !path.startsWith("/record/daw/")) return legacy(env.LEGACY_RECORD, req, url);
  } else {
    if (path === "/classic" || path === "/classic/") return legacy(env.LEGACY_STUDIO, req, url, "/");
    const sm = path.match(/^\/s\/([a-z0-9]{10})(\/audio|\/report)?$/);
    if (sm) return share(req, env, ctx, url, sm[1], sm[2] || "", "/");
    if (path !== "/" && !path.startsWith("/daw/")) return legacy(env.LEGACY_STUDIO, req, url);
  }
  if (path === base) return shell(req, env, base);
  const res = await api(req, env, ctx, url, path.slice(base.length + 4)); // after "<base>daw/"
  // Read what's left of a small refused body so the connection closes cleanly.
  if (req.body && !req.bodyUsed && Number(req.headers.get("Content-Length") || 0) <= MAX_PROJECT * 2) await req.arrayBuffer().catch(() => {});
  return res;
}

// ---------------------------------------------------------------- earlier apps
function legacy(svc, req, url, rewrite) {
  if (!svc) return new Response("Not found", { status: 404 });
  if (!rewrite) return svc.fetch(req);
  const u = new URL(url); u.pathname = rewrite;
  return svc.fetch(new Request(u, req));
}
function redirect(url, to) { const u = new URL(url); u.pathname = to; return new Response(null, { status: 301, headers: { Location: u.pathname + u.search } }); }

// ---------------------------------------------------------------- app shell
function shell(req, env, base) {
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  const nonce = b64(crypto.getRandomValues(new Uint8Array(16)));
  // RB site theme (RB Command > Site colours): same-origin on /record, absolute on the studio subdomain; none in local tests.
  const theme = env.DEV === "1" ? "" : `\n<link rel="stylesheet" href="${base === "/" ? "https://relentlessbillionaire.com" : ""}/api/content/theme.css?site=studio">`;
  const html = SHELL.replaceAll("{{BASE}}", base).replaceAll("{{CANONICAL}}", CANONICAL).replaceAll("{{BUILD}}", BUILD).replaceAll("{{THEME_LINK}}", theme);
  return new Response(req.method === "HEAD" ? null : html, { headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache",
    "Content-Security-Policy": [
      "default-src 'self'", `script-src 'self' 'nonce-${nonce}'`, "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://relentlessbillionaire.com", "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:", `media-src 'self' blob: ${BEAT_MEDIA}`, `connect-src 'self' ${BEAT_MEDIA}`, "worker-src 'self' blob:",
      "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'"].join("; "),
    "Permissions-Policy": "microphone=(self), midi=(self), camera=(), geolocation=(), payment=()", "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "strict-origin-when-cross-origin", "X-Content-Type-Options": "nosniff", "Cross-Origin-Opener-Policy": "same-origin",
    "X-RB-DAW": BUILD,
  } });
}

// ---------------------------------------------------------------- API: <base>daw/...
async function api(req, env, ctx, url, rest) {
  const m = req.method;
  let parts; try { parts = rest.split("/").filter(Boolean).map(decodeURIComponent); } catch { return json({ error: "Bad address." }, 400); }
  if (parts[0] === "assets" && parts.length === 2) return asset(req, url, parts[1]);
  if (parts[0] === "beats") {
    if (m !== "GET" && m !== "HEAD") return json({ error: "Method not allowed" }, 405);
    if (parts.length === 1) return beats(env, ctx, url);
    if (parts.length === 3 && parts[2] === "audio" && /^\d{1,9}$/.test(parts[1])) return beatAudio(req, env, parts[1]);
    return json({ error: "Not found" }, 404);
  }
  if (parts[0] !== "me" && parts[0] !== "projects" && parts[0] !== "shares") return json({ error: "Not found" }, 404);

  // Writes need the app's header (a cross-site form or image can't send it) and, when the browser says, our own origin.
  if (m !== "GET" && m !== "HEAD") {
    if (req.headers.get("X-RB-DAW") !== "1") return json({ error: "Missing studio header." }, 403);
    const origin = req.headers.get("Origin");
    if (origin && origin !== url.origin) return json({ error: "Cross-site request refused." }, 403);
  }
  const who = await owner(req, url);
  const done = (res) => { if (who.set) res.headers.append("Set-Cookie", who.set); res.headers.set("Cache-Control", "private, no-store"); return res; };

  if (parts[0] === "me") {
    const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM daw_projects WHERE owner = ?").bind(who.id).first();
    const f = await env.DB.prepare("SELECT COALESCE(SUM(bytes),0) AS b FROM daw_files WHERE owner = ?").bind(who.id).first();
    return done(json({ projects: r.n, bytes: f.b, quota: QUOTA, build: BUILD }));
  }
  if (parts[0] === "shares") return done(await shares(req, env, url, who.id, parts));
  const pid = parts[1];
  if (parts.length === 1) {
    if (m !== "GET") return done(json({ error: "Method not allowed" }, 405));
    const { results } = await env.DB.prepare("SELECT id, name, bpm, updated FROM daw_projects WHERE owner = ? ORDER BY updated DESC LIMIT 200").bind(who.id).all();
    return done(json({ projects: results }));
  }
  if (!ID.test(pid)) return done(json({ error: "Bad project id." }, 400));
  if (parts.length === 2) {
    if (m === "GET") {
      const r = await env.DB.prepare("SELECT data FROM daw_projects WHERE owner = ? AND id = ?").bind(who.id, pid).first();
      return done(r ? new Response(`{"project":${r.data}}`, { headers: { "Content-Type": "application/json; charset=utf-8" } }) : json({ error: "That song isn't in the cloud for this browser." }, 404));
    }
    if (m === "POST") return done(await saveProject(req, env, who.id, pid));
    if (m === "DELETE") return done(await deleteProject(env, who.id, pid));
    return done(json({ error: "Method not allowed" }, 405));
  }
  if (parts.length === 4 && parts[2] === "files" && ID.test(parts[3])) {
    const key = `daw/${who.id}/${pid}/${parts[3]}`;
    if (m === "GET" || m === "HEAD") {
      const o = await env.MEDIA.get(key);
      if (!o) return done(json({ error: "That recording isn't in the cloud." }, 404));
      return done(new Response(m === "HEAD" ? null : o.body, { headers: { "Content-Type": o.httpMetadata?.contentType || "application/octet-stream", "Content-Length": String(o.size), ETag: o.httpEtag } }));
    }
    if (m === "PUT") return done(await putFile(req, env, who.id, pid, parts[3], key));
    return done(json({ error: "Method not allowed" }, 405));
  }
  return done(json({ error: "Not found" }, 404));
}

async function saveProject(req, env, who, pid) {
  if (!(req.headers.get("Content-Type") || "").includes("application/json")) return json({ error: "Send JSON." }, 415);
  const text = await readText(req, MAX_PROJECT);
  if (text == null) return json({ error: "That song file is too big to save (1 MB of song data)." }, 413);
  let p; try { p = JSON.parse(text); } catch { return json({ error: "That song data isn't valid." }, 400); }
  if (!p || typeof p !== "object" || p.id !== pid || !Array.isArray(p.tracks) || typeof p.files !== "object") return json({ error: "That song data isn't valid." }, 400);
  const exists = await env.DB.prepare("SELECT 1 FROM daw_projects WHERE owner = ? AND id = ?").bind(who, pid).first();
  if (!exists) {
    const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM daw_projects WHERE owner = ?").bind(who).first();
    if (c.n >= MAX_PROJECTS) return json({ error: `You have ${MAX_PROJECTS} songs in the cloud. Delete some first.` }, 409);
  }
  const name = String(p.name || "Untitled song").slice(0, 80), bpm = Math.round(Number(p.bpm)) || null, now = Date.now();
  await env.DB.prepare(`INSERT INTO daw_projects (owner, id, name, bpm, data, bytes, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (owner, id) DO UPDATE SET name = excluded.name, bpm = excluded.bpm, data = excluded.data, bytes = excluded.bytes, updated = excluded.updated`)
    .bind(who, pid, name, bpm, text, text.length, now, now).run();
  return json({ ok: true, updated: now });
}

async function deleteProject(env, who, pid) {
  const { results } = await env.DB.prepare("SELECT id FROM daw_files WHERE owner = ? AND project_id = ?").bind(who, pid).all();
  if (results.length) await env.MEDIA.delete(results.map((f) => `daw/${who}/${pid}/${f.id}`));
  await env.DB.batch([
    env.DB.prepare("DELETE FROM daw_files WHERE owner = ? AND project_id = ?").bind(who, pid),
    env.DB.prepare("DELETE FROM daw_projects WHERE owner = ? AND id = ?").bind(who, pid),
  ]);
  return json({ ok: true });
}

/** Stream one audio file into R2 after checking its size, the browser's quota and that it starts like audio. */
async function putFile(req, env, who, pid, fid, key) {
  const len = Number(req.headers.get("Content-Length"));
  if (!req.body || !Number.isFinite(len) || len <= 0) return json({ error: "Send the file with its length." }, 411);
  if (len > MAX_FILE) return json({ error: "That recording is over 95 MB. Split it into shorter takes." }, 413);
  const used = await env.DB.prepare("SELECT COALESCE(SUM(bytes),0) AS b FROM daw_files WHERE owner = ? AND NOT (project_id = ? AND id = ?)").bind(who, pid, fid).first();
  if (used.b + len > QUOTA) return json({ error: "This browser's 1 GB of cloud space is full. Delete old songs from Projects." }, 413);

  const up = await streamAudio(req, env, key, len);
  if (up.error) return up.error;
  const type = up.type;
  await env.DB.prepare(`INSERT INTO daw_files (owner, project_id, id, bytes, type, created) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (owner, project_id, id) DO UPDATE SET bytes = excluded.bytes, type = excluded.type`).bind(who, pid, fid, len, type, Date.now()).run();
  return json({ ok: true, bytes: len });
}
/** Stream a request body (length known) into R2 after checking it starts like audio. Returns {type} or {error: Response}. */
async function streamAudio(req, env, key, len) {
  const reader = req.body.getReader(), head = [];
  let got = 0;
  while (got < 12) { const r = await reader.read(); if (r.done) break; head.push(r.value); got += r.value.byteLength; }
  const first = new Uint8Array(Math.min(got, 16)); { let o = 0; for (const c of head) { const n = Math.min(c.byteLength, first.length - o); first.set(c.subarray(0, n), o); o += n; if (o >= first.length) break; } }
  const type = sniff(first);
  if (!type) { reader.cancel().catch(() => {}); return { error: json({ error: "Only audio files can be saved (WAV, MP3, M4A, OGG, FLAC, WebM, AIFF)." }, 415) }; }
  const { readable, writable } = new FixedLengthStream(len);
  const pump = (async () => {
    const w = writable.getWriter();
    for (const c of head) await w.write(c);
    for (;;) { const r = await reader.read(); if (r.done) break; await w.write(r.value); }
    await w.close();
  })();
  await Promise.all([env.MEDIA.put(key, readable, { httpMetadata: { contentType: type } }), pump]);
  return { type };
}
function sniff(b) {
  const s = (o, t) => [...t].every((ch, i) => b[o + i] === ch.charCodeAt(0));
  if (s(0, "RIFF") && s(8, "WAVE")) return "audio/wav";
  if (s(0, "ID3") || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return (b[1] & 0x06) === 0 ? "audio/aac" : "audio/mpeg";
  if (s(4, "ftyp")) return "audio/mp4";
  if (s(0, "OggS")) return "audio/ogg";
  if (s(0, "fLaC")) return "audio/flac";
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "audio/webm";
  if (s(0, "FORM") && (s(8, "AIFF") || s(8, "AIFC"))) return "audio/aiff";
  return null;
}

// ---------------------------------------------------------------- RB beats (live in the beat store)
async function beats(env, ctx, url) {
  const cache = caches.default, key = new Request(`${url.origin}/__rb-daw-cache/beats/v2`);
  let res = await cache.match(key);
  if (!res) {
    const { results } = await env.BEATS_DB.prepare("SELECT id, title, genre, bpm, song_key, price, image_url, audio_url FROM shop_products WHERE status = 'live' AND kind = 'beat' AND audio_url IS NOT NULL AND audio_url != '' ORDER BY featured DESC, sort_order ASC, id ASC LIMIT 120").all();
    const list = results.filter((b) => beatHost(b.audio_url)).map((b) => ({
      id: b.id, title: b.title, genre: b.genre && !/\$\s*\d/.test(b.genre) ? b.genre : null, bpm: b.bpm || null, key: b.song_key || null,
      image: /^https:\/\//.test(b.image_url || "") ? b.image_url : null, store: STORE,
      // The store's own price for the beat (its $1 demo license); leases are priced in rb-store-payments.
      price: /^\$?\d{1,4}(\.\d\d)?$/.test(String(b.price || "").trim()) ? "$" + String(b.price).trim().replace(/^\$/, "") : null,
    }));
    res = json({ beats: list }); res.headers.set("Cache-Control", "public, max-age=300");
    ctx.waitUntil(cache.put(key, res.clone()));
  }
  return res;
}
function beatHost(u) { try { const x = new URL(u); return x.protocol === "https:" && (BEAT_HOSTS.includes(x.hostname) || /^pub-[0-9a-f]{32}\.r2\.dev$/.test(x.hostname)); } catch { return false; } }
async function beatAudio(req, env, id) {
  const b = await env.BEATS_DB.prepare("SELECT audio_url FROM shop_products WHERE id = ? AND status = 'live' AND kind = 'beat'").bind(Number(id)).first();
  if (!b || !beatHost(b.audio_url)) return json({ error: "That beat isn't available." }, 404);
  if (new URL(b.audio_url).origin === BEAT_MEDIA) return new Response(null, { status: 302, headers: { Location: b.audio_url, "Cache-Control": "public, max-age=300" } });
  const h = new Headers(); const range = req.headers.get("Range"); if (range) h.set("Range", range);
  const src = env.DEV === "1" && env.BEAT_TEST_ORIGIN ? env.BEAT_TEST_ORIGIN + new URL(b.audio_url).pathname : b.audio_url; // local tests only
  const up = await fetch(src, { headers: h, cf: { cacheEverything: true, cacheTtl: 86400 } });
  // A missing file is a 404 (the app retries 502-504, so a 502 here meant four failed downloads).
  if (!up.ok && up.status !== 206) return json({ error: "That beat couldn't be loaded." }, up.status === 404 || up.status === 410 ? 404 : 502);
  const out = new Headers({ "Content-Type": up.headers.get("Content-Type") || "audio/mpeg", "Cache-Control": "public, max-age=86400", "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff" });
  for (const k of ["Content-Length", "Content-Range", "ETag", "Last-Modified"]) { const v = up.headers.get(k); if (v) out.set(k, v); }
  return new Response(req.method === "HEAD" ? null : up.body, { status: up.status, headers: out });
}

// ---------------------------------------------------------------- static assets
function asset(req, url, name) {
  const a = Object.hasOwn(ASSETS, name) && ASSETS[name];
  if (!a) return new Response("Not found", { status: 404 });
  if (req.method !== "GET" && req.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
  const etag = `"${BUILD}"`;
  const headers = { "Content-Type": a.type, ETag: etag, "X-Content-Type-Options": "nosniff",
    "Cache-Control": url.searchParams.get("v") === BUILD ? "public, max-age=31536000, immutable" : "public, max-age=300" };
  if (req.headers.get("If-None-Match") === etag) return new Response(null, { status: 304, headers });
  return new Response(req.method === "HEAD" ? null : a.body, { headers });
}

// ---------------------------------------------------------------- device owner cookie
async function owner(req, url) {
  const m = (req.headers.get("Cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{32,64})`));
  let token = m && m[1], set = null;
  if (!token) {
    token = b64(crypto.getRandomValues(new Uint8Array(32)));
    const domain = url.hostname === MAIN || url.hostname.endsWith("." + MAIN) ? `; Domain=.${MAIN}` : "";
    set = `${COOKIE}=${token}; Path=/; Max-Age=34560000; HttpOnly; Secure; SameSite=Lax${domain}`;
  }
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return { id: [...d.slice(0, 16)].map((x) => x.toString(16).padStart(2, "0")).join(""), set };
}

// ---------------------------------------------------------------- helpers
function json(o, status = 200) { return new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff" } }); }
function b64(bytes) { let s = ""; for (const x of bytes) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
async function readText(req, max) {
  const len = Number(req.headers.get("Content-Length")); if (len > max) return null;
  const reader = req.body.getReader(), chunks = []; let n = 0;
  for (;;) { const r = await reader.read(); if (r.done) break; n += r.value.byteLength; if (n > max) { reader.cancel().catch(() => {}); return null; } chunks.push(r.value); }
  const all = new Uint8Array(n); let o = 0; for (const c of chunks) { all.set(c, o); o += c.byteLength; }
  return new TextDecoder().decode(all);
}

// ---------------------------------------------------------------- shared songs (public pages at /s/<id>)
const SHARE_ORIGIN = "https://studio.relentlessbillionaire.com";
const MAX_SHARES = 30;
const clean = (v, max) => String(v || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Owner side: POST daw/shares?title=&artist=&beat=&seconds= with the mix as the body; GET daw/shares; DELETE daw/shares/<id>. */
async function shares(req, env, url, who, parts) {
  const db = env.SITE_DB, m = req.method;
  if (!db) return json({ error: "Sharing isn't set up." }, 503);
  if (parts.length === 1 && m === "GET") {
    const { results } = await db.prepare("SELECT id, title, artist, beat_title, plays, status, created_at FROM daw_shares WHERE owner = ? ORDER BY created_at DESC LIMIT 50").bind(who).all();
    return json({ shares: results.map((r) => ({ ...r, url: `${SHARE_ORIGIN}/s/${r.id}` })) });
  }
  if (parts.length === 1 && m === "POST") {
    const title = clean(url.searchParams.get("title"), 80), artist = clean(url.searchParams.get("artist"), 60) || null;
    if (!title) return json({ error: "Give the song a title." }, 400);
    const len = Number(req.headers.get("Content-Length"));
    if (!req.body || !Number.isFinite(len) || len <= 0) return json({ error: "Send the song with its length." }, 411);
    if (len > MAX_FILE) return json({ error: "That song is over 95 MB. Export a shorter version." }, 413);
    const c = await db.prepare("SELECT COUNT(*) AS n FROM daw_shares WHERE owner = ?").bind(who).first();
    if (c.n >= MAX_SHARES) return json({ error: `You've shared ${MAX_SHARES} songs. Delete one in Projects to share another.` }, 409);
    let beatId = /^\d{1,9}$/.test(url.searchParams.get("beat") || "") ? Number(url.searchParams.get("beat")) : null, beatTitle = null;
    if (beatId) { const b = await env.BEATS_DB.prepare("SELECT title FROM shop_products WHERE id = ? AND status = 'live' AND kind = 'beat'").bind(beatId).first(); if (b) beatTitle = b.title; else beatId = null; }
    const seconds = Math.max(0, Math.min(3600, Number(url.searchParams.get("seconds")) || 0)) || null;
    const id = [...crypto.getRandomValues(new Uint8Array(10))].map((x) => "abcdefghijkmnopqrstuvwxyz23456789"[x % 33]).join("");
    const up = await streamAudio(req, env, `shares/${id}`, len);
    if (up.error) return up.error;
    await db.prepare("INSERT INTO daw_shares (id, owner, title, artist, beat_id, beat_title, bytes, seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(id, who, title, artist, beatId, beatTitle, len, seconds).run();
    return json({ ok: true, id, url: `${SHARE_ORIGIN}/s/${id}` });
  }
  if (parts.length === 2 && m === "DELETE" && /^[a-z0-9]{10}$/.test(parts[1])) {
    const row = await db.prepare("SELECT id FROM daw_shares WHERE id = ? AND owner = ?").bind(parts[1], who).first();
    if (!row) return json({ error: "That shared song isn't yours or is already gone." }, 404);
    await env.MEDIA.delete(`shares/${row.id}`);
    await db.batch([db.prepare("DELETE FROM daw_share_reports WHERE share_id = ?").bind(row.id), db.prepare("DELETE FROM daw_shares WHERE id = ?").bind(row.id)]);
    return json({ ok: true });
  }
  return json({ error: "Not found" }, 404);
}

/** Public side: the song page, its audio, and "Report this song". Only live songs are shown. */
async function share(req, env, ctx, url, id, sub, base) {
  const db = env.SITE_DB, m = req.method;
  const row = db ? await db.prepare("SELECT id, title, artist, beat_id, beat_title, seconds, status, created_at FROM daw_shares WHERE id = ?").bind(id).first() : null;
  const live = row && row.status === "live";
  if (sub === "/audio") {
    if (m !== "GET" && m !== "HEAD") return new Response("Method not allowed", { status: 405 });
    if (!live) return new Response("Not found", { status: 404 });
    const range = parseRange(req.headers.get("Range"));
    const obj = await env.MEDIA.get(`shares/${id}`, range ? { range } : {});
    if (!obj) return new Response("Not found", { status: 404 });
    if (!range || range.offset === 0) ctx.waitUntil(db.prepare("UPDATE daw_shares SET plays = plays + 1 WHERE id = ?").bind(id).run().catch(() => {}));
    const h = new Headers({ "Content-Type": obj.httpMetadata?.contentType || "audio/wav", "Accept-Ranges": "bytes", "Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff", ETag: obj.httpEtag });
    if (range) {
      const start = range.offset, end = Math.min(obj.size - 1, range.length != null ? start + range.length - 1 : obj.size - 1);
      h.set("Content-Range", `bytes ${start}-${end}/${obj.size}`); h.set("Content-Length", String(end - start + 1));
      return new Response(m === "HEAD" ? null : obj.body, { status: 206, headers: h });
    }
    h.set("Content-Length", String(obj.size));
    return new Response(m === "HEAD" ? null : obj.body, { headers: h });
  }
  if (sub === "/report") {
    if (m !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
    await req.arrayBuffer().catch(() => {});
    if (row) {
      const ip = req.headers.get("CF-Connecting-IP") || "local";
      const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${ip}|${id}`)));
      const who = [...d.slice(0, 12)].map((x) => x.toString(16).padStart(2, "0")).join("");
      await db.batch([
        db.prepare("INSERT OR IGNORE INTO daw_share_reports (share_id, who) VALUES (?, ?)").bind(id, who),
        db.prepare("UPDATE daw_shares SET reports = (SELECT COUNT(*) FROM daw_share_reports WHERE share_id = ?1), status = CASE WHEN status = 'live' AND (SELECT COUNT(*) FROM daw_share_reports WHERE share_id = ?1) >= 3 THEN 'review' ELSE status END WHERE id = ?1").bind(id),
      ]);
    }
    return sharePage(req, env, base, null, "Thanks. Relentless Billionaire will review this song.", 200);
  }
  if (m !== "GET" && m !== "HEAD") return new Response("Method not allowed", { status: 405 });
  return sharePage(req, env, base, live ? row : null, live ? null : "This song isn't available.", live ? 200 : 404);
}
function parseRange(h) {
  const mm = /^bytes=(\d+)-(\d*)$/.exec(h || ""); if (!mm) return null;
  const offset = Number(mm[1]), end = mm[2] ? Number(mm[2]) : null;
  return end != null && end >= offset ? { offset, length: end - offset + 1 } : { offset };
}
function sharePage(req, env, base, row, message, status) {
  const nonce = b64(crypto.getRandomValues(new Uint8Array(16)));
  const theme = env.DEV === "1" ? "" : `<link rel="stylesheet" href="${base === "/" ? "https://relentlessbillionaire.com" : ""}/api/content/theme.css?site=studio">`;
  const title = row ? `${row.title}${row.artist ? " · " + row.artist : ""}` : "RB Studio";
  const desc = row ? `Listen to ${row.title}${row.artist ? " by " + row.artist : ""}, made in RB Studio${row.beat_title ? " on the RB beat " + row.beat_title : ""}.` : "Record, make beats and mix in your browser.";
  const recUrl = row && row.beat_id ? `${SHARE_ORIGIN}/?beat=${row.beat_id}` : `${SHARE_ORIGIN}/?new=1`;
  const body = row ? `
<p class="eyebrow">Made in RB Studio</p>
<h1>${esc(row.title)}</h1>${row.artist ? `<p class="by">${esc(row.artist)}</p>` : ""}
<audio controls preload="metadata" src="${esc(base)}s/${esc(row.id)}/audio"></audio>
<div class="cta">
  <a class="btn gold" href="${esc(recUrl)}">&#9679; ${row.beat_id ? "Record your own on this beat" : "Make a song in RB Studio"}</a>
  ${row.beat_id ? `<a class="btn" href="https://beatstore.relentlessbillionaire.com/#beats">License &ldquo;${esc(row.beat_title)}&rdquo;</a>` : ""}
</div>
${row.beat_title ? `<p class="fine">Beat: ${esc(row.beat_title)} by Relentless Billionaire.</p>` : ""}
<form method="post" action="${esc(base)}s/${esc(row.id)}/report" class="report"><button type="submit">Report this song</button></form>`
    : `<h1>${esc(message)}</h1><div class="cta"><a class="btn gold" href="${SHARE_ORIGIN}/?new=1">&#9679; Make a song in RB Studio</a></div>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · RB Studio</title><meta name="description" content="${esc(desc)}"><meta name="robots" content="noindex">
<meta property="og:type" content="music.song"><meta property="og:site_name" content="RB Studio"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta name="twitter:card" content="summary"><link rel="icon" href="https://relentlessbillionaire.com/brand/icon.svg?v=3" type="image/svg+xml"><link rel="icon" href="https://relentlessbillionaire.com/brand/favicon.ico?v=3" sizes="48x48"><link rel="apple-touch-icon" href="https://relentlessbillionaire.com/brand/apple-touch-icon.png?v=3">
<style>:root{--bg:#0E0810;--panel:#1B1020;--panel2:#241528;--line2:#4A2F52;--text:#F5ECE2;--muted:#B7A6B3;--gold:#D6AD65;--gold2:#E9C687;--pink:#E8619F}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 20% 0,var(--panel2),var(--bg) 60%);color:var(--text);font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;display:flex;flex-direction:column}
header{padding:16px 20px}header a{color:var(--text);text-decoration:none;font-weight:700;letter-spacing:.18em;font-size:13px}header b{display:inline-grid;place-items:center;width:28px;height:28px;border-radius:7px;background:var(--gold);color:#140B16;margin-right:8px;letter-spacing:0}
main{width:min(640px,calc(100% - 32px));margin:6vh auto;background:var(--panel);border:1px solid var(--line2);border-radius:18px;padding:28px}
.eyebrow{color:var(--gold2);font-size:12px;letter-spacing:.2em;text-transform:uppercase;margin:0}h1{font-size:clamp(26px,6vw,40px);line-height:1.15;margin:8px 0 4px;overflow-wrap:anywhere}.by{color:var(--muted);margin:0 0 18px}
audio{width:100%;margin:12px 0 18px}.cta{display:flex;flex-wrap:wrap;gap:10px}.btn{display:inline-block;padding:11px 16px;border-radius:999px;border:1px solid var(--line2);color:var(--text);text-decoration:none;font-weight:600;font-size:14px}
.btn.gold{background:var(--gold);border-color:var(--gold);color:#140B16}.fine{color:var(--muted);font-size:13px;margin:16px 0 0}.report{margin-top:18px}.report button{background:none;border:0;color:var(--muted);text-decoration:underline;cursor:pointer;font:inherit;font-size:12px;padding:0}
footer{margin-top:auto;padding:18px;color:var(--muted);font-size:12px;text-align:center}footer a{color:var(--muted)}</style>${theme}
</head><body><header><a href="${SHARE_ORIGIN}/"><b>RB</b>STUDIO</a></header><main>${body}</main>
<footer>Shared by its creator from <a href="${SHARE_ORIGIN}/">RB Studio</a>. Relentless Billionaire doesn't review songs before they're shared.</footer></body></html>`;
  return new Response(req.method === "HEAD" ? null : html, { status, headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": ["default-src 'self'", `script-src 'self' 'nonce-${nonce}'`, "style-src 'self' 'unsafe-inline' https://relentlessbillionaire.com", "img-src 'self' data: https:", "media-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"].join("; "),
  } });
}
