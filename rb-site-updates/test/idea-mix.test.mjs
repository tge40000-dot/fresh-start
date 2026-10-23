// Usage: node --no-warnings rb-site-updates/test/idea-mix.test.mjs <patched rb-autopilot dir>
// rb-tools/patch_idea_mix.py: the AI Forge's daily mix follows RB TV's own watch data.
import assert from "node:assert/strict";
import path from "node:path";
const { ideaMix } = await import(path.resolve(process.argv[2], "creative.js"));
const v = (kind, plays, seconds, duration_s) => ({ kind, plays, seconds, duration_s });
const S = (videos) => ({ rb: { videos } });
// no watch data, or shorts no better: the even rotation, as before
assert.deepEqual(ideaMix(S([]), 3, 0), ["beat", "song", "video"]);
assert.deepEqual(ideaMix(S([v("short", 10, 40, 8), v("video", 10, 300, 60)]), 3, 0), ["beat", "song", "video"]); // 50% vs 50%
assert.deepEqual(ideaMix(S([v("short", 0, 0, 8), v("video", 10, 100, 60)]), 3, 0), ["beat", "song", "video"]); // no short plays
// the live numbers (originals shorts ~75% watched, music videos 17-32%): a short leads, the third slot alternates
const live = S([v("video", 17, 0.32 * 17 * 200, 200), v("video", 19, 0.17 * 19 * 200, 200), v("short", 10, 0.75 * 10 * 8, 8)]);
assert.deepEqual(ideaMix(live, 3, 0), ["video", "beat", "song"]);
assert.deepEqual(ideaMix(live, 3, 1), ["video", "beat", "video"]);
const two = [...ideaMix(live, 3, 0), ...ideaMix(live, 3, 1)].reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {});
assert.deepEqual(two, { video: 3, beat: 2, song: 1 });
assert.equal(ideaMix(live, 6, 0).filter((k) => k === "song").length >= 1, true, "songs still come up");
console.log("idea mix ok: even rotation without watch data; with RB TV's live numbers shorts lead (3 shorts, 2 beats, 1 song over two days)");
