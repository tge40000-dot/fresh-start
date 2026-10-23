// Usage: node --no-warnings rb-site-updates/test/beat-publish.test.mjs <patched rb-autopilot dir>
// Publishing an AI Forge beat: copied to RB's media host, listed through the bridge, its track made live; a double
// publish or a retry can't publish twice, and a failure after the listing says so instead of "nothing was published".
import assert from "node:assert/strict";
import { join } from "node:path";
import { fakeD1 } from "../../rb-surface/test/fake-d1.mjs";
const { publish } = await import(join(process.argv[2], "creative.js"));
const mk = () => {
  const DB = fakeD1();
  DB.raw.exec(`CREATE TABLE creative_ideas (id TEXT PRIMARY KEY, kind TEXT, status TEXT, title TEXT, why TEXT, bpm INTEGER, song_key TEXT, jobs TEXT, published TEXT, published_by TEXT, published_at TEXT, updated_at TEXT);
    CREATE TABLE tracks (id INTEGER PRIMARY KEY, title TEXT, artist_name TEXT, audio_url TEXT, cover_url TEXT, sort_order INTEGER, status TEXT);
    INSERT INTO creative_ideas (id, kind, status, title, why, bpm, jobs, updated_at) VALUES ('c_1', 'beat', 'ready', 'Midnight Test', 'why', 90, '{"music":{"key":"gen/a.mp3"},"image":{"key":"gen/a.jpg"}}', '2026-10-18T00:00:00Z');`);
  return DB;
};
let bridgeCalls = 0, failUpdate = false;
const puts = [];
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.includes("/api/publish/beat")) {
    bridgeCalls++;
    const env = mkEnv.current; env.DB.raw.exec("INSERT INTO tracks (id, title, audio_url, status) VALUES (" + (100 + bridgeCalls) + ", 'Midnight Test', 'https://studio.relentlessbillionaire.vip/media/studio/generated/a.mp3', 'beat')");
    if (failUpdate) env.DB.raw.exec("DROP TABLE tracks; CREATE TABLE tracks (id INTEGER PRIMARY KEY)");
    return new Response(JSON.stringify({ ok: true, productId: 7, trackId: 100 + bridgeCalls, price: 1 }), { headers: { "content-type": "application/json" } });
  }
  return new Response(new Uint8Array(100), { headers: { "Content-Type": url.endsWith(".jpg") ? "image/jpeg" : "audio/mpeg" } });
};
const mkEnv = (DB) => (mkEnv.current = { DB, FORGE_TOKEN: "t", MEDIA: { put: async (k) => { puts.push(k); } } });

// a normal publish: listed, copied, track live and credited
let DB = mk(); let env = mkEnv(DB);
let r = await publish(env, "c_1", "owner@x", { price: "1", artist: "Jay Test" });
assert.ok(r.published, JSON.stringify(r));
assert.match(r.published.place, /music player and RB Radio/);
const t = DB.raw.prepare("SELECT * FROM tracks WHERE id = 101").get();
assert.equal(t.status, "live"); assert.equal(t.artist_name, "Jay Test"); assert.match(t.audio_url, /^https:\/\/media\.relentlessbillionaire\.com\/admin\/ai\/beats\//);
assert.equal(DB.raw.prepare("SELECT status FROM creative_ideas").get().status, "published");
r = await publish(env, "c_1", "owner@x", { price: "1" });
assert.equal(r.status, 409, "a second publish is refused"); assert.equal(bridgeCalls, 1);

// two publishes at once: only one reaches the bridge
DB = mk(); env = mkEnv(DB); bridgeCalls = 0;
const both = await Promise.all([publish(env, "c_1", "o", { price: "1" }), publish(env, "c_1", "o", { price: "1" })]);
assert.equal(both.filter((x) => x.published).length, 1); assert.equal(both.filter((x) => x.status === 409).length, 1); assert.equal(bridgeCalls, 1);

// a bad price hands the claim back
DB = mk(); env = mkEnv(DB); bridgeCalls = 0;
r = await publish(env, "c_1", "o", { price: "0" });
assert.equal(r.status, 400); assert.equal(DB.raw.prepare("SELECT status FROM creative_ideas").get().status, "ready", "claim released");

// the track update fails after the listing: recorded as published, honest message, no second listing on retry
DB = mk(); env = mkEnv(DB); bridgeCalls = 0; failUpdate = true;
r = await publish(env, "c_1", "o", { price: "1" });
assert.equal(r.status, 502); assert.match(r.error, /Listed in the beat store/); assert.doesNotMatch(r.error, /Nothing was published/);
assert.equal(DB.raw.prepare("SELECT status FROM creative_ideas").get().status, "published");
failUpdate = false;
r = await publish(env, "c_1", "o", { price: "1" });
assert.equal(r.status, 409); assert.equal(bridgeCalls, 1, "no second listing");
console.log("beat publish ok: copied, listed, track live and credited; second and simultaneous publishes refused; bad input releases the claim; a failure after listing is recorded and said plainly");
