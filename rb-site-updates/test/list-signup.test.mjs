// Usage: node --no-warnings rb-site-updates/test/list-signup.test.mjs <patched rb-radio dir> <patched rb-tv dir>
// rb-site-updates/patch_list_signup.py: the RB list on RB Radio, and a last slide after the RB TV shorts.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
const [radioDir, tvDir] = process.argv.slice(2);
// RB Radio: the card sits before the footer, its script carries the page nonce, and it sends name, email and "beats"
const src = fs.readFileSync(path.join(radioDir, "index.js"), "utf8");
const page = JSON.parse(src.match(/const PAGE_HTML = (".*?");\n/s)[1]);
assert.equal(page.split('id="rbl-radio"').length, 2, "one card");
assert.ok(page.indexOf('id="rbl-radio"') < page.indexOf("</main>") && page.indexOf("</main>") < page.indexOf('<footer class="foot">'));
const script = page.match(/<script nonce="%NONCE%">(\(function\(\)\{var f=document\.getElementById\("rbl-form"\).*?)<\/script>/s);
assert.ok(script, "the form script carries the nonce");
const el = (extra = {}) => ({ textContent: "", hidden: false, disabled: false, focus() {}, ...extra });
const msg = el(), btn = el();
let onSubmit, posted;
const form = el({ elements: { name: { value: " Ana ", focus() {} }, email: { value: "ana@example.com", focus() {} } }, querySelector: () => btn, addEventListener: (t, fn) => { onSubmit = fn; } });
const ctx = { document: { getElementById: (id) => ({ "rbl-form": form, "rbl-msg": msg })[id] }, JSON,
  fetch: async (u, init) => { posted = { u, body: JSON.parse(init.body) }; return { json: async () => ({ ok: true, alreadyRegistered: false }) }; } };
vm.runInNewContext(script[1], ctx);
onSubmit({ preventDefault() {} });
await new Promise((r) => setTimeout(r, 10));
assert.deepEqual(posted, { u: "/api/list", body: { name: "Ana", email: "ana@example.com", interests: ["beats"] } });
assert.equal(msg.textContent, "You’re on the RB list."); assert.equal(form.hidden, true);
form.elements.email.value = "nope"; form.hidden = false; posted = null; onSubmit({ preventDefault() {} });
assert.equal(posted, null); assert.match(msg.textContent, /valid email/);
// RB TV: one more slide after the last short, the same size, with RB TV's own signup and the way back
const views = await import(path.resolve(tvDir, "views.js"));
const short = (id) => ({ id, kind: "short", source: "upload", video_url: "https://media.relentlessbillionaire.com/v/" + id + ".mp4", title: "Short " + id, channel: "rb", channel_name: "RB", duration_s: 8, likes: 0 });
const L = { t: (k) => k, u: (p) => p, count: String };
const html = views.shortsPage([short("a1"), short("b2")], L);
assert.equal(html.split('class="short"').length - 1, 2, "the two shorts");
const end = html.indexOf('class="short short-end"');
assert.ok(end > html.lastIndexOf('data-short="b2"'), "the slide comes after the last short");
assert.ok(html.slice(end).includes('data-signup="shorts"') && html.slice(end).includes('href="/tv"'));
assert.ok(!/data-short=/.test(html.slice(end)), "it isn't a video, so the player skips it");
assert.ok(views.shortsPage([], L).includes("empty-page"), "no shorts: the empty page as before");
const css = JSON.parse(fs.readFileSync(path.join(tvDir, "assets.js"), "utf8").match(/export const CSS = (".*?");\n/s)[1]);
assert.ok(css.includes(".short-end .sframe{") && css.includes(".sframe{position:relative;height:100%;aspect-ratio:9/16"), "same frame size as a short");
console.log("list signup ok: RB Radio's card joins the RB list for new music; RB TV's shorts end with a signup slide");
