// node rb-email/test/test.mjs: the email Worker against fake messages.
import assert from "node:assert/strict";
const { default: w } = await import(new URL("../src/index.js", import.meta.url));
const msg = (from, failOn = []) => ({ from, to: "hello@relentlessbillionaire.com", rejected: null, forwarded: [],
  setReject(r) { this.rejected = r; }, async forward(d) { if (failOn.includes(d)) throw new Error("destination not verified"); this.forwarded.push(d); } });
console.warn = console.error = () => {};
let m = msg("fan@gmail.com"); await w.email(m, {});
assert.match(m.rejected, /isn't set up yet/); assert.deepEqual(m.forwarded, []);
m = msg("fan@gmail.com"); await w.email(m, { FORWARD_TO: "owner@example.com, team@example.com" });
assert.equal(m.rejected, null); assert.deepEqual(m.forwarded, ["owner@example.com", "team@example.com"], "anyone can write in now");
m = msg("fan@gmail.com", ["team@example.com"]); await w.email(m, { FORWARD_TO: "owner@example.com,team@example.com" });
assert.equal(m.rejected, null); assert.deepEqual(m.forwarded, ["owner@example.com"], "one bad destination doesn't lose the message");
m = msg("fan@gmail.com", ["owner@example.com"]); await w.email(m, { FORWARD_TO: "owner@example.com" });
assert.match(m.rejected, /couldn't deliver/, "nothing delivered: the sender is told");
m = msg("Spam@Bad.example"); await w.email(m, { FORWARD_TO: "owner@example.com", BLOCK: "@bad.example" });
assert.match(m.rejected, /doesn't accept/); assert.deepEqual(m.forwarded, []);
console.log("rb-email ok: forwards to every destination, survives a bad one, bounces clearly when not set up, blocks");
