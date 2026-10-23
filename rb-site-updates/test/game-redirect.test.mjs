// Usage: node --no-warnings rb-site-updates/test/game-redirect.test.mjs <patched rb-game dir>
// The game page sends players to RB World; everything else under /game/ (sounds, scripts) still comes from the old game.
import assert from "node:assert/strict";
import { join } from "node:path";
globalThis.HTMLRewriter = class { on() { return this; } transform(r) { return r; } };
const worker = (await import(join(process.argv[2], "worker.js"))).default;
const seen = [];
const env = { GAME: { fetch: async (req) => { seen.push(new URL(req.url).pathname); return new Response("ID3", { headers: { "Content-Type": "audio/mpeg" } }); } } };
for (const path of ["/game", "/game/", "/game/index.html", "/game/?ref=tab"]) {
  const r = await worker.fetch(new Request("https://relentlessbillionaire.com" + path), env, {});
  assert.equal(r.status, 302, path);
  assert.equal(r.headers.get("Location"), "https://relentlessbillionaire.com/app/world/" + (path.includes("?") ? "?ref=tab" : ""), path);
}
const sub = await worker.fetch(new Request("https://beatstore.relentlessbillionaire.com/game/"), env, {});
assert.equal(sub.headers.get("Location"), "https://relentlessbillionaire.com/app/world/", "subdomains go to the main site's RB World");
assert.equal(seen.length, 0, "the old game page isn't fetched");
const a = await worker.fetch(new Request("https://relentlessbillionaire.com/game/assets/audio/hustle-theme.mp3"), env, {});
assert.equal(a.status, 200); assert.equal(await a.text(), "ID3"); assert.deepEqual(seen, ["/game/assets/audio/hustle-theme.mp3"], "files still served");
const post = await worker.fetch(new Request("https://relentlessbillionaire.com/game/", { method: "POST" }), env, {});
assert.equal(post.status, 200, "only GET and HEAD of the page redirect");
console.log("game redirect ok: /game/ to RB World (302, query kept, subdomains too), files and other methods still from the old game");
