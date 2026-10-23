// Usage: node --no-warnings rb-site-updates/test/studio-checkout.test.mjs <patched rb-mastering-studio dir>
// rb-site-updates/patch_studio_checkout.py: studio checkout sessions ask Stripe for managed_payments[enabled]=false,
// and are made again without it if Stripe doesn't know the parameter.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakeD1 } from "../../rb-surface/test/fake-d1.mjs";
globalThis.caches = { default: { match: async () => null, put: async () => {} } };
const dir = process.argv[2];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "studio-co-"));
let src = fs.readFileSync(path.join(dir, "index.js"), "utf8");
src = src.replace(/import (\w+) from "\.\/([^"]+)";/g, (m, name, file) => `const ${name} = ${JSON.stringify(fs.readFileSync(path.join(dir, file), "utf8"))};`);
fs.writeFileSync(path.join(tmp, "index.mjs"), src);
const S = (await import(path.join(tmp, "index.mjs"))).default;
const store = new Map([["billing/config.json", JSON.stringify({ live: true, prices: { single: "price_single_test" }, created: "2026-10-01T00:00:00Z" })]]);
const VAULT = { async get(k) { const v = store.get(k); return v == null ? null : { json: async () => JSON.parse(v), text: async () => v, body: v, httpMetadata: {} }; },
  async put(k, v) { store.set(k, String(v)); }, async delete(k) { store.delete(k); }, async list() { return { objects: [], truncated: false }; }, async head() { return null; } };
const env = { VAULT, DB: fakeD1(), STUDIO_KEY: "test-only-key", STRIPE_SECRET_KEY: "test-only-stripe" };
const ctx = { waitUntil() {}, passThroughOnException() {} };
const realFetch = globalThis.fetch;
let bodies = [], answer;
globalThis.fetch = async (u, init) => {
  if (String(u).startsWith("https://api.stripe.com/v1/checkout/sessions")) { bodies.push(new URLSearchParams(init.body)); return answer(bodies.length); }
  return realFetch(u, init);
};
const buy = async () => { const r = await S.fetch(new Request("https://relentlessbillionaire.com/studio/api/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: "single" }) }), env, ctx); return { status: r.status, body: await r.json() }; };
const ok = () => new Response(JSON.stringify({ id: "cs_x", url: "https://checkout.stripe.com/c/pay/cs_x" }), { status: 200 });
const err = (m) => new Response(JSON.stringify({ error: { message: m } }), { status: 400 });
// 1. the session asks for Managed Payments off, and checkout opens
answer = () => ok();
let r = await buy();
assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.url, "https://checkout.stripe.com/c/pay/cs_x");
assert.equal(bodies.length, 1); assert.equal(bodies[0].get("managed_payments[enabled]"), "false"); assert.equal(bodies[0].get("line_items[0][price]"), "price_single_test");
// 2. Stripe doesn't know the parameter: made again without it
bodies = []; answer = (n) => (n === 1 ? err("Received unknown parameter: managed_payments") : ok());
r = await buy();
assert.equal(r.status, 200); assert.equal(bodies.length, 2); assert.equal(bodies[1].get("managed_payments[enabled]"), null);
// 3. any other Stripe error is shown as before, and not retried
bodies = []; answer = () => err("Your card was declined.");
r = await buy();
assert.equal(r.status, 502); assert.equal(r.body.detail, "Your card was declined."); assert.equal(bodies.length, 1);
globalThis.fetch = realFetch;
console.log("studio checkout ok: sessions ask for Managed Payments off, retried without it if Stripe doesn't know it, other errors as before");
