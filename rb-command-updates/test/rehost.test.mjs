// Usage: node --no-warnings rb-command-updates/test/rehost.test.mjs <patched rb-command dir>
// Runs "Move outside files" against an in-memory copy of the tables that hold links, a fake R2 bucket and fake
// downloads, then undoes one change with RB Command's own Undo, and checks the page script parses.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { writeFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const dir = process.argv[2];
const rh = await import(join(dir, "rehost.js"));
const { undo } = await import(join(dir, "tables.js"));
const { renderPage } = await import(join(dir, "ui.js"));

const db = new DatabaseSync(":memory:");
db.exec(`
CREATE TABLE tracks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, artist_name TEXT, artist_handle TEXT, audio_url TEXT, cover_url TEXT, sort_order INTEGER DEFAULT 0, status TEXT DEFAULT 'live');
CREATE TABLE hero_slides (id INTEGER PRIMARY KEY AUTOINCREMENT, image_url TEXT, caption TEXT, link_url TEXT, scope TEXT, handle TEXT, blur INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0, status TEXT DEFAULT 'live');
CREATE TABLE shop_products (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, image_url TEXT, audio_url TEXT, status TEXT DEFAULT 'live');
CREATE TABLE site_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
CREATE TABLE command_log (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, action TEXT, target TEXT, detail TEXT, at TEXT DEFAULT (datetime('now')));
INSERT INTO tracks (title, audio_url, cover_url) VALUES
 ('Midnight Gold', 'https://files.manuscdn.com/user_upload/a/song1.mp3', 'https://media.relentlessbillionaire.com/covers/1.jpg'),
 ('Lake Merritt', 'https://files.manuscdn.com/user_upload/a/song2.mp3', 'https://files.manuscdn.com/user_upload/a/cover2.webp'),
 ('Gone Song', 'https://files.manuscdn.com/user_upload/a/gone.mp3', NULL),
 ('Own Song', 'https://media.relentlessbillionaire.com/tracks/own.mp3', NULL);
INSERT INTO hero_slides (image_url, caption) VALUES ('https://files.manuscdn.com/user_upload/a/cover2.webp', 'Homepage hero');
INSERT INTO shop_products (title, image_url) VALUES ('Page', 'https://files.manuscdn.com/user_upload/a/page.html');
INSERT INTO site_settings VALUES ('hub_hero_image', '{"src":"https://files.manuscdn.com/user_upload/a/hero.jpg","alt":"RB"}', datetime('now'));
`);
class Stmt {
  constructor(sql, args = []) { this.sql = sql; this.args = args; }
  bind(...a) { return new Stmt(this.sql, a.map((v) => (v === undefined ? null : v))); }
  async first() { return db.prepare(this.sql).get(...this.args) ?? null; }
  async all() { return { results: db.prepare(this.sql).all(...this.args) }; }
  async run() { const r = db.prepare(this.sql).run(...this.args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; }
}
const bucket = new Map();
const env = {
  DB: { prepare: (s) => new Stmt(s), batch: async (l) => { db.exec("BEGIN"); try { const out = []; for (const s of l) out.push(/^\s*(SELECT|INSERT .* RETURNING)/is.test(s.sql) ? await s.all() : await s.run()); db.exec("COMMIT"); return out; } catch (e) { db.exec("ROLLBACK"); throw e; } } },
  MEDIA: { put: async (k, v, o) => { bucket.set(k, { v, o }); } },
};
const user = { email: "owner@example.com", role: "owner" };
const MP3 = new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0]);
const downloads = [];
const fakeFetch = async (url) => {
  downloads.push(url);
  if (url.endsWith("gone.mp3")) return new Response("missing", { status: 404 });
  if (url.endsWith("page.html")) return new Response("<html>", { headers: { "Content-Type": "text/html" } });
  if (url.endsWith(".mp3")) return new Response(MP3, { headers: { "Content-Type": "application/octet-stream", "Content-Length": String(MP3.length) } });
  if (url.endsWith(".webp")) return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/webp" } });
  if (url.endsWith(".jpg")) return new Response(new Uint8Array([4, 5, 6]), { headers: { "Content-Type": "image/jpeg" } });
  throw new TypeError("network");
};

// ---------------------------------------------------------------- what's outside
let s = await rh.scan(env);
assert.equal(s.files, 6, "six distinct outside files (cover2 is used twice)");
assert.equal(s.rows.length, 6);
assert.ok(!s.rows.some((r) => r.label === "Own Song"), "rows already on RB media aren't listed");

// ---------------------------------------------------------------- moving, a few at a time
let r, steps = 0;
do { r = await rh.run(env, user, { max: 2 }, () => true, fakeFetch); steps++; } while (r.remaining && steps < 20);
assert.ok(steps >= 3, "two files per step");
const t1 = db.prepare("SELECT * FROM tracks WHERE title = 'Midnight Gold'").get();
assert.match(t1.audio_url, /^https:\/\/media\.relentlessbillionaire\.com\/admin\/rehosted\/\d{4}-\d{2}\/[0-9a-f-]{36}\.mp3$/, "type taken from the file name when the server doesn't say");
assert.equal(t1.cover_url, "https://media.relentlessbillionaire.com/covers/1.jpg", "links already on RB media are left alone");
const t2 = db.prepare("SELECT * FROM tracks WHERE title = 'Lake Merritt'").get();
const hero = db.prepare("SELECT * FROM hero_slides").get();
assert.equal(hero.image_url, t2.cover_url, "a file used twice is copied once and both rows use the copy");
assert.equal(downloads.filter((u) => u.endsWith("cover2.webp")).length, 1);
const set = JSON.parse(db.prepare("SELECT value FROM site_settings WHERE key = 'hub_hero_image'").get().value);
assert.match(set.src, /^https:\/\/media\.relentlessbillionaire\.com\/admin\/rehosted\/.+\.jpg$/, "links inside a setting's JSON are replaced");
assert.equal(set.alt, "RB");
const gone = db.prepare("SELECT audio_url FROM tracks WHERE title = 'Gone Song'").get();
assert.equal(gone.audio_url, "https://files.manuscdn.com/user_upload/a/gone.mp3", "a file that failed keeps its old link");
assert.equal(bucket.size, 4);
const put = [...bucket.values()].find((x) => x.o.httpMetadata.contentType === "audio/mpeg");
assert.equal(put.o.httpMetadata.cacheControl, "public, max-age=31536000, immutable");
assert.deepEqual([...put.v], [...MP3]);

s = await rh.scan(env);
assert.equal(s.files, 2, "only the two that failed are left");
assert.deepEqual(s.failed.map((f) => f.error).sort(), ["it isn't an image, audio or video file (text/html)", "the file answered 404 (it's gone)"]);
assert.ok(s.failed.every((f) => f.gave_up), "tried three times, then stops");
r = await rh.run(env, user, {}, () => true, fakeFetch);
assert.equal(r.copied.length + r.failed.length, 0, "no more retries after three");

// ---------------------------------------------------------------- every change can be undone
const logs = db.prepare("SELECT * FROM command_log WHERE action = 'row.update'").all();
assert.equal(logs.length, 5, "one logged edit per row changed");
const heroLog = logs.find((l) => l.target.startsWith("hero_slides:"));
const d = JSON.parse(heroLog.detail);
assert.equal(d.table, "hero_slides"); assert.equal(d.before.image_url, "https://files.manuscdn.com/user_upload/a/cover2.webp");
await undo(env, user, heroLog.id);
assert.equal(db.prepare("SELECT image_url FROM hero_slides").get().image_url, "https://files.manuscdn.com/user_upload/a/cover2.webp", "Undo puts the old link back");

// ---------------------------------------------------------------- permissions: only tables you may edit
db.exec("UPDATE tracks SET audio_url = 'https://files.manuscdn.com/user_upload/a/song9.mp3' WHERE title = 'Own Song'");
r = await rh.run(env, user, {}, (t) => t !== "tracks", fakeFetch);
assert.equal(db.prepare("SELECT audio_url FROM tracks WHERE title = 'Own Song'").get().audio_url, "https://files.manuscdn.com/user_upload/a/song9.mp3", "no tracks edit, no tracks change");
await assert.rejects(rh.run({ DB: env.DB }, user, {}, () => true, fakeFetch), /Media storage/);

// ---------------------------------------------------------------- the page and the route
const idx = readFileSync(join(dir, "index.js"), "utf8");
assert.ok(idx.includes('"/api/rehost/run"') && idx.includes('auth.can(user.role, TABLES[t]?.group, "edit")') && idx.includes('"#/rehost");'));
const html = renderPage("N0NCE", { me: { email: "o@x", name: "O", role: "owner", caps: { groups: { Content: "edit" }, label: "Owner" } }, links: {}, media: "", tables: {}, groups: ["Content"], uploads: true });
const script = html.match(/<script nonce="N0NCE">([\s\S]*?)<\/script>/);
const f = join(mkdtempSync(join(tmpdir(), "rbc-")), "client.js");
writeFileSync(f, script[1]);
execFileSync(process.execPath, ["--check", f]);
assert.ok(html.includes("function viewRehost()") && html.includes('r.name === "rehost"'));
console.log("rehost ok: scan, copy in steps, shared files copied once, JSON settings, failures kept and retried 3 times, Undo, per-table rights, page script parses");
