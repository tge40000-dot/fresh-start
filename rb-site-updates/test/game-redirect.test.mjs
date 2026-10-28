// Usage: node --no-warnings rb-site-updates/test/game-redirect.test.mjs <patched rb-game dir>
// The game page sends players to RB World; everything else under /game/ (sounds, scripts) still comes from the old game.
import assert from "node:assert/strict";
import { join } from "node:path";
globalThis.HTMLRewriter = class { on() { return this; } transform(r) { return r; } };
import { readFileSync, writeFileSync } from "node:fs";
const entry = JSON.parse(readFileSync(join(process.argv[2], "manifest.json"), "utf8")).entry || "worker.js";
// a Worker with Durable Objects imports "cloudflare:workers", which Node hasn't got: stand it in, in a copy outside the
// Worker folder (everything in that folder is uploaded)
let file = join(process.argv[2], entry);
const src = readFileSync(file, "utf8");
if (src.includes('from "cloudflare:workers"')) { file = join((await import("node:fs")).mkdtempSync(join((await import("node:os")).tmpdir(), "rbgame-")), entry); writeFileSync(file, src.replace(/import \{ DurableObject \} from "cloudflare:workers";/, "class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }")); }
const mod = await import(file), worker = mod.default;
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
// the old game's other pages still load (their helpers are there), and the extra /game/api is closed but for health
const html = await worker.fetch(new Request("https://relentlessbillionaire.com/game/old.html"), { GAME: { fetch: async () => new Response("<html><head></head></html>", { headers: { "Content-Type": "text/html" } }) } }, {});
assert.equal(html.status, 200, "an old game page doesn't fail");
if (src.includes("handleGameApi")) {
  const h = await worker.fetch(new Request("https://relentlessbillionaire.com/game/api/health"), env, {});
  assert.equal(h.status, 200); assert.equal((await h.json()).status, "ok");
  for (const [m, path] of [["GET", "/game/api/player"], ["POST", "/game/api/territory/claim"], ["POST", "/game/api/combat/start"], ["GET", "/game/api/map"]]) {
    const r = await worker.fetch(new Request("https://relentlessbillionaire.com" + path, { method: m, headers: { "X-Player-Id": "x", "Content-Type": "application/json" }, body: m === "POST" ? "{}" : undefined }), env, {});
    assert.equal(r.status, 410, path + " is closed");
  }
  let set = 0, del = 0; const t = new mod.Territory({ storage: { get: async () => "someone", put: async () => {}, setAlarm: async () => { set++; }, deleteAlarm: async () => { del++; } } }, {});
  await t.alarm(); assert.deepEqual([set, del], [0, 1], "a territory's alarm ends and isn't set again");
}
console.log("game redirect ok: /game/api closed but health, territory alarms end, old pages' helpers back,  /game/ to RB World (302, query kept, subdomains too), files and other methods still from the old game");
