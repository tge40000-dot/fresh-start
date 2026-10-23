/**
 * Move outside files into RB media.
 *
 * Some player audio, homepage images, shop products and site settings still load from files.manuscdn.com, a service
 * RB doesn't control. This copies each of those files into RB's own media bucket (media.relentlessbillionaire.com) and
 * points every row that used it at the copy. A few files per request, so big audio files can't time out; the screen
 * calls it until nothing is left.
 *
 * Every row it changes is logged as a normal edit, so Activity's Undo puts the old link back. Files that fail (gone,
 * blocked, too big) are listed with the reason and retried on the next run, up to three times.
 */
import { HttpError } from "./tables.js";

export const OUTSIDE = /https?:\/\/files\.manuscdn\.com\/[^\s"'<>)\\]+/g;
const MAX_BYTES = 95 * 1024 * 1024;
const TRIES = 3;
const TYPES = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif", "image/svg+xml": "svg",
  "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/aac": "aac", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/flac": "flac", "audio/ogg": "ogg",
  "video/mp4": "mp4", "video/webm": "webm",
};
const BY_EXT = Object.fromEntries(Object.entries(TYPES).map(([t, e]) => [e, t]).concat([["jpeg", "image/jpeg"], ["mpeg", "audio/mpeg"]]));

/** Where outside links can be: each table, its key, the columns that hold links, and what to call a row. */
export const TARGETS = [
  { table: "tracks", pk: "id", cols: ["audio_url", "cover_url"], label: (r) => r.title || `track ${r.id}` },
  { table: "hero_slides", pk: "id", cols: ["image_url"], label: (r) => r.caption || `slide ${r.id}` },
  { table: "shop_products", pk: "id", cols: ["image_url", "audio_url"], label: (r) => r.title || `product ${r.id}` },
  { table: "site_settings", pk: "key", cols: ["value"], label: (r) => r.key },
];

let ready = null;
function ensure(env) {
  return (ready ||= env.DB.prepare(`CREATE TABLE IF NOT EXISTS media_rehost (src TEXT PRIMARY KEY, key TEXT, url TEXT, bytes INTEGER, type TEXT,
    tries INTEGER NOT NULL DEFAULT 0, error TEXT, at TEXT NOT NULL DEFAULT (datetime('now')))`).run().catch((e) => { ready = null; throw e; }));
}

const base = (env) => (env.MEDIA_PUBLIC_URL || "https://media.relentlessbillionaire.com").replace(/\/$/, "");
const urlsIn = (v) => [...new Set(String(v || "").match(OUTSIDE) || [])];

async function rowsWithLinks(env, can) {
  const out = [];
  for (const t of TARGETS) {
    if (can && !can(t.table)) continue;
    const where = t.cols.map((c) => `${c} LIKE '%files.manuscdn.com%'`).join(" OR ");
    const { results } = await env.DB.prepare(`SELECT * FROM ${t.table} WHERE ${where} LIMIT 500`).all().catch(() => ({ results: [] }));
    for (const r of results || []) out.push({ t, row: r, urls: [...new Set(t.cols.flatMap((c) => urlsIn(r[c])))] });
  }
  return out;
}

/** What's still outside: the rows, their files, and files that failed before. */
export async function scan(env, can) {
  await ensure(env);
  const rows = await rowsWithLinks(env, can);
  const urls = [...new Set(rows.flatMap((r) => r.urls))];
  const known = urls.length ? (await env.DB.prepare(`SELECT src, url, tries, error FROM media_rehost WHERE src IN (${urls.map(() => "?").join(",")})`).bind(...urls).all()).results || [] : [];
  const by = Object.fromEntries(known.map((k) => [k.src, k]));
  return {
    ok: true,
    files: urls.length,
    rows: rows.map((r) => ({ table: r.t.table, id: r.row[r.t.pk], label: String(r.t.label(r.row)).slice(0, 120), files: r.urls.length })),
    failed: urls.filter((u) => by[u]?.error && !by[u]?.url).map((u) => ({ src: u, error: by[u].error, tries: by[u].tries, gave_up: by[u].tries >= TRIES })),
  };
}

/** Copy one outside file into RB media. Returns { key, url, bytes, type } or throws with a reason a person can read. */
export async function copyFile(env, src, fetcher = fetch) {
  let res;
  try { res = await fetcher(src, { redirect: "follow", signal: AbortSignal.timeout(25000), headers: { "User-Agent": "RB Command (moving RB's own files to media.relentlessbillionaire.com)" } }); }
  catch { throw new Error("couldn't reach the file"); }
  if (!res.ok) { await res.body?.cancel(); throw new Error(`the file answered ${res.status}${res.status === 404 || res.status === 410 ? " (it's gone)" : ""}`); }
  const ext0 = (new URL(src).pathname.match(/\.([a-z0-9]{2,5})$/i) || [])[1]?.toLowerCase();
  let type = String(res.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (!TYPES[type]) type = BY_EXT[ext0] || type;
  const ext = TYPES[type];
  if (!ext) { await res.body?.cancel(); throw new Error(`it isn't an image, audio or video file (${type || "no type"})`); }
  const len = Number(res.headers.get("Content-Length") || 0);
  if (len > MAX_BYTES) { await res.body?.cancel(); throw new Error(`it's ${(len / 1048576).toFixed(0)} MB, over the 95 MB limit`); }
  const body = new Uint8Array(await res.arrayBuffer());
  if (body.byteLength > MAX_BYTES) throw new Error("it's over the 95 MB limit");
  if (!body.byteLength) throw new Error("the file is empty");
  const key = `admin/rehosted/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
  await env.MEDIA.put(key, body, { httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" }, customMetadata: { source: src.slice(0, 500) } });
  return { key, url: `${base(env)}/${key}`, bytes: body.byteLength, type };
}

/**
 * One step: copy up to `max` files that haven't been copied, then point every row at the copies.
 * `can(table)` says whether this person may edit that table.
 */
export async function run(env, user, body, can, fetcher = fetch) {
  if (!env.MEDIA) throw new HttpError(503, "Media storage isn't connected to RB Command.");
  await ensure(env);
  const max = Math.max(1, Math.min(Number(body.max) || 3, 6));
  const rows = await rowsWithLinks(env, can);
  const urls = [...new Set(rows.flatMap((r) => r.urls))];
  const known = urls.length ? (await env.DB.prepare(`SELECT * FROM media_rehost WHERE src IN (${urls.map(() => "?").join(",")})`).bind(...urls).all()).results || [] : [];
  const map = Object.fromEntries(known.filter((k) => k.url).map((k) => [k.src, k.url]));
  const tries = Object.fromEntries(known.map((k) => [k.src, k.tries]));
  const todo = urls.filter((u) => !map[u] && (tries[u] || 0) < TRIES).slice(0, max);
  const copied = [], failed = [];
  for (const src of todo) {
    try {
      const f = await copyFile(env, src, fetcher);
      await env.DB.prepare("INSERT INTO media_rehost (src, key, url, bytes, type, tries, error, at) VALUES (?,?,?,?,?,?,NULL,datetime('now')) ON CONFLICT(src) DO UPDATE SET key=excluded.key, url=excluded.url, bytes=excluded.bytes, type=excluded.type, tries=media_rehost.tries+1, error=NULL, at=excluded.at")
        .bind(src, f.key, f.url, f.bytes, f.type, 1).run();
      map[src] = f.url; copied.push({ src, url: f.url, bytes: f.bytes });
    } catch (e) {
      const reason = String(e.message || e).slice(0, 200);
      await env.DB.prepare("INSERT INTO media_rehost (src, tries, error) VALUES (?, 1, ?) ON CONFLICT(src) DO UPDATE SET tries = media_rehost.tries + 1, error = excluded.error, at = datetime('now')").bind(src, reason).run();
      failed.push({ src, error: reason });
    }
  }
  // Point rows at every copy made so far (this run or earlier), one logged edit per row so Undo works.
  let updated = 0;
  for (const { t, row, urls: u } of rows) {
    if (!u.some((x) => map[x])) continue;
    const before = {}, after = {};
    for (const c of t.cols) {
      const v = row[c];
      if (v == null) continue;
      const nv = String(v).replace(OUTSIDE, (m) => map[m] || m);
      if (nv !== String(v)) { before[c] = v; after[c] = nv; }
    }
    const cols = Object.keys(after);
    if (!cols.length) continue;
    const id = row[t.pk];
    const label = String(t.label(row)).slice(0, 80);
    await env.DB.batch([
      env.DB.prepare(`UPDATE ${t.table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE ${t.pk} = ? AND ${cols.map((c) => `${c} = ?`).join(" AND ")}`).bind(...cols.map((c) => after[c]), id, ...cols.map((c) => before[c])),
      env.DB.prepare("INSERT INTO command_log (actor, action, target, detail) VALUES (?, 'row.update', ?, ?)").bind(user.email, `${t.table}:${id}`,
        JSON.stringify({ summary: `Moved outside files into RB media: ${label} (${cols.join(", ")})`, table: t.table, id, before, after })),
    ]);
    updated++;
  }
  const left = urls.filter((u) => !map[u] && (tries[u] || 0) + (failed.some((f) => f.src === u) ? 1 : 0) < TRIES).length;
  return { ok: true, copied, failed, updated, remaining: left, total: urls.length };
}
