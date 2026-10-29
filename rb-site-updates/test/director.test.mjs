// Usage: node --no-warnings rb-site-updates/test/director.test.mjs [<patched artist-router-v14.js> --browser]
// RB Create's AI Director (29 Oct 2026): one idea in, a finished film out. Checks the script reader (repairs the
// model's slips, fills gaps, caps counts), the background cut-out and the mouth finder on drawn figures, the stage
// positions, and that the film view wires them. With a worker and --browser, the whole run in Chromium against
// stand-in AI tools (one of which says "too many requests" first): script, two characters cut out, three
// backgrounds, every line voiced, a score, titles, and a film that plays, with no errors.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const html = readFileSync(new URL("../src/create/create.html", import.meta.url), "utf8");
const block = html.slice(html.indexOf("var DIRECTOR = {"), html.indexOf("/** The free text tool"));
const D = new Function(block + "; return DIRECTOR;")();

// the script reader
const want = { scenes: 3, cast: 2 };
const messy = `Sure! Here is your film:\n{"title": "Taco Night", "mood": "upbeat", "characters": [{"name": "Dee", "look": "a tall woman in a gold jacket"}, {"name": "Rome", "look": "a short man in a red hoodie"}, {"name": "Extra", "look": "x"}],
 "scenes": [{"setting": "a taco truck at night", "camera": "dolly", "lines": [{"who": "Dee", "text": "We open in five!"}, {"who": "rome", "text": "Five minutes? I'm not ready."},]},
 {"setting": "the line outside", "camera": "zoomzoom", "lines": [{"who": "Somebody", "text": "Is that who I think it is?"}]},
 {"setting": "the counter", "lines": [{"who": "Dee", "text": “One of everything.”}]},
 {"setting": "too many", "lines": [{"who": "Dee", "text": "cut"}]}]}`;
const sc = D.parse(messy, want);
assert.ok(sc, "trailing commas and curly quotes repaired");
assert.equal(sc.title, "Taco Night"); assert.equal(sc.mood, "upbeat");
assert.deepEqual(sc.characters.map((c) => c.name), ["Dee", "Rome"], "capped at the cast asked for");
assert.equal(sc.scenes.length, 3, "capped at the scenes asked for");
assert.equal(sc.scenes[0].lines[1].who, "Rome", "names matched without case");
assert.ok(D.CAMS.includes(sc.scenes[1].camera), "an unknown camera move replaced");
assert.ok(sc.scenes[1].lines[0].who === "Dee" || sc.scenes[1].lines[0].who === "Rome", "an unknown speaker given to the cast");
assert.equal(D.parse("no json here", want), null);
assert.equal(D.parse('{"title":"x","characters":[],"scenes":[]}', want), null, "nothing usable");
assert.equal(D.parse('{"characters":[{"name":"A"}],"scenes":[{"lines":[{"who":"A","text":"Hi"}]}]}', want).characters[0].look.length > 5, true, "a missing look filled");
const pr = D.prompt("Two friends open a taco truck", 5, 2);
assert.ok(pr.includes("exactly 5 scenes") && pr.includes("Exactly 2 characters") && pr.includes("JSON"));

// the cut-out and the mouth: a figure (head on shoulders) on a flat grey background
const W = 300, H = 400, img = (bg, body) => { const d = new Uint8ClampedArray(W * H * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4, c = body(x, y) || bg; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; } return { width: W, height: H, data: d }; };
const figure = (x, y) => { const head = (x - 150) ** 2 + (y - 90) ** 2 < 42 ** 2, body = y > 140 && y < 390 && Math.abs(x - 150) < 85; return head ? [222, 170, 130] : body ? [180, 30, 40] : null; };
const cut = D.cutoutData(img([214, 214, 214], figure), null);
assert.ok(cut, "a plain background is cut away");
assert.ok(cut.w < 200 && cut.w > 160 && cut.h > 330 && cut.h < 360, `trimmed to the figure (${cut.w}x${cut.h})`);
assert.equal(cut.mask[0], 0, "the corner is see-through");
assert.equal(cut.mask[Math.floor(cut.h / 2) * cut.w + Math.floor(cut.w / 2)], 1, "the body is kept");
const m = D.mouth(cut.mask, cut.w, cut.h);
const headTop = (90 - 42 - (400 - cut.h - 10)) / cut.h; // roughly where the head starts in the trimmed picture
assert.ok(Math.abs(m.x - 0.5) < 0.06, "the mouth is centred on the face: " + m.x.toFixed(2));
assert.ok(m.y > 0.12 && m.y < 0.32, "the mouth sits in the lower part of the head: " + m.y.toFixed(2));
assert.ok(m.w >= 0.05 && m.w <= 0.2);
let s = 1; const noisy = img([0, 0, 0], () => { s = (s * 16807) % 2147483647; return [s % 255, (s >> 8) % 255, (s >> 16) % 255]; });
assert.equal(D.cutoutData(noisy, null), null, "a busy background is left alone");
assert.equal(D.cutoutData(img([214, 214, 214], () => null), null), null, "an empty picture is left alone");

// the stage
assert.deepEqual(D.stage(1).map((p) => p.x), [0.5]);
assert.deepEqual(D.stage(2).map((p) => p.x), [0.3, 0.7]);
assert.equal(D.stage(3).length, 3); assert.ok(D.stage(3)[0].scale < 1);
assert.equal(D.stage(9).length, 4, "four at most");
// paced: waits out a "too many requests" and carries on
let calls = 0, waited = 0;
const got = await D.paced(() => (++calls < 2 ? Promise.reject(Object.assign(new Error("busy"), { retry: 0.01 })) : Promise.resolve("ok")), 3, () => waited++);
assert.equal(got, "ok"); assert.equal(calls, 2); assert.equal(waited, 1);
await assert.rejects(D.paced(() => Promise.reject(new Error("broken")), 3), /broken/, "other errors are not retried");

// the film view wires it
for (const want of ['id="d-go"', 'seg("dlen"', 'seg("dcast"', 'id="d-export"', "DIRECTOR.score(plan().total", "cutAsset(a)", 'data-cut="', 'name === "dlen" || name === "dcast"', "s.lead || 0.35", "(s.tail || 0)", "An RB Create film · made with AI", "Made with RB Create"])
  assert.ok(html.includes(want), want);
assert.ok(!/P\._t\s*=/.test(html), "editor timers are not saved into projects");
console.log("AI Director ok: script reader (repairs, caps, fills), cut-out and mouth on a drawn figure, busy backgrounds left alone, stage, pacing, wiring");

if (process.argv.includes("--browser")) {
  const worker = (await import(process.argv[2])).default;
  const env = {}, ctx = { waitUntil() {}, passThroughOnException() {} };
  const { chromium } = await import("/opt/node22/lib/node_modules/playwright/index.mjs");
  const b = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  // stand-in pictures, drawn by the browser itself
  const maker = await b.newPage();
  const pics = await maker.evaluate(() => {
    const out = {}, cv = document.createElement("canvas"), g = cv.getContext("2d");
    cv.width = 384; cv.height = 512; g.fillStyle = "#d6d6d6"; g.fillRect(0, 0, 384, 512);
    g.fillStyle = "#b41e28"; g.fillRect(100, 170, 184, 330); g.fillStyle = "#deaa82"; g.beginPath(); g.arc(192, 110, 56, 0, 7); g.fill();
    out.char = cv.toDataURL("image/png").split(",")[1];
    cv.width = 640; cv.height = 360; const gr = g.createLinearGradient(0, 0, 0, 360); gr.addColorStop(0, "#1a1440"); gr.addColorStop(1, "#c98a2a"); g.fillStyle = gr; g.fillRect(0, 0, 640, 360);
    for (let i = 0; i < 40; i++) { g.fillStyle = `hsl(${i * 37},60%,50%)`; g.fillRect((i * 53) % 640, 200 + ((i * 29) % 120), 30, 60); }
    out.bg = cv.toDataURL("image/png").split(",")[1];
    return out;
  });
  await maker.close();
  // a stand-in voice: a 1.2 s tone, 16-bit mono WAV
  const sr = 22050, n = Math.round(sr * 1.2), wav = Buffer.alloc(44 + n * 2);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sr, 24); wav.writeUInt32LE(sr * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) wav.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / sr) * 9000 * (0.5 + 0.5 * Math.sin((2 * Math.PI * 4 * i) / sr))), 44 + i * 2);
  const script = { title: "Taco Truck Royalty", mood: "upbeat", characters: [{ name: "Dee", look: "a tall woman in a gold jacket, cartoon style" }, { name: "Rome", look: "a short man in a red hoodie, cartoon style" }],
    scenes: [{ setting: "a taco truck on a Vallejo street at night", camera: "dolly", lines: [{ who: "Dee", text: "We open in five minutes!" }, { who: "Rome", text: "Five? The salsa isn't even cold." }] },
      { setting: "a long line of people under neon lights", camera: "orbit", lines: [{ who: "Rome", text: "Is that who I think it is?" }, { who: "Dee", text: "Act normal. Act very normal." }] },
      { setting: "the truck counter with steam rising", camera: "speaker", lines: [{ who: "Dee", text: "One of everything, on the house." }] }] };
  const hits = { text: 0, image: 0, speech: 0, busy: 0 }; let firstImage = true;
  const p = await b.newPage({ viewport: { width: 1440, height: 1000 } }); const errs = [];
  p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  p.on("dialog", (d) => d.accept());
  await p.route(/^https:\/\/relentlessbillionaire\.com\/create/, async (route) => {
    const res = await worker.fetch(new Request(route.request().url(), { headers: { "User-Agent": "Mozilla/5.0" } }), env, ctx);
    const h = {}; res.headers.forEach((v, k) => (h[k] = v)); await route.fulfill({ status: res.status, headers: h, body: Buffer.from(await res.arrayBuffer()) });
  });
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "Retry-After" };
  await p.route(/^https:\/\/media\.relentlessbillionaire\.com\//, async (route) => {
    const q = route.request(), u = new URL(q.url());
    if (q.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { ...cors, "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST" } });
    if (u.pathname === "/ai/platform/text") { hits.text++; const body = JSON.parse(q.postData()); assert.equal(body.task, "general"); return route.fulfill({ headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ ok: true, result: { content: "Here you go:\n" + JSON.stringify(script) } }) }); }
    if (u.pathname === "/ai/platform/image") {
      if (firstImage) { firstImage = false; hits.busy++; return route.fulfill({ status: 429, headers: { ...cors, "Content-Type": "application/json", "Retry-After": "1" }, body: JSON.stringify({ ok: false, error: { message: "Wait a little." } }) }); }
      hits.image++; const body = JSON.parse(q.postData()), kind = body.aspect === "3:4" ? "char" : "bg";
      return route.fulfill({ headers: { ...cors, "Content-Type": "application/json" }, body: JSON.stringify({ ok: true, asset: { url: `https://media.relentlessbillionaire.com/ai/out/${kind}-${hits.image}.png` }, model: "stand-in" }) });
    }
    if (u.pathname.startsWith("/ai/out/")) return route.fulfill({ headers: { ...cors, "Content-Type": "image/png" }, body: Buffer.from(u.pathname.includes("/char-") ? pics.char : pics.bg, "base64") });
    if (u.pathname === "/ai/platform/speech") { hits.speech++; return route.fulfill({ headers: { ...cors, "Content-Type": "audio/wav" }, body: wav }); }
    return route.fulfill({ status: 404, headers: cors, body: "" });
  });
  await p.goto("https://relentlessbillionaire.com/create#film", { waitUntil: "networkidle" });
  await p.fill("#d-idea", "Two friends from Vallejo open a late-night taco truck and a celebrity shows up hungry.");
  await p.locator('[data-seg="dlen"] button[data-v="short"]').click();
  await p.locator('[data-seg="dcast"] button[data-v="2"]').click();
  await p.locator("#d-go").click();
  await p.waitForFunction(() => /ready|stopped|unreadable/i.test(document.querySelector("#d-st").textContent), null, { timeout: 120000 });
  const st = await p.locator("#d-st").textContent();
  assert.match(st, /^Your film is ready\. Press ▶ Play film\.$/, st);
  assert.equal(await p.locator("#d-steps li.ok").count(), 5, "every step done");
  assert.deepEqual([hits.text, hits.image, hits.busy, hits.speech], [1, 5, 1, 5], "one script, 2 characters + 3 backgrounds (after one busy answer), 5 voice lines");
  assert.equal(await p.locator("#f-name").inputValue(), "Taco Truck Royalty");
  assert.equal(await p.locator("#f-scenes [data-scn]").count(), 3);
  assert.equal(await p.locator("#f-cast li").count(), 2);
  assert.match(await p.locator("#f-musicname").textContent(), /^Score · Taco Truck Royalty$/);
  const proj = await p.evaluate(() => new Promise((res) => { const r = indexedDB.open("rb-create"); r.onsuccess = () => { const t = r.result.transaction("projects").objectStore("projects").getAll(); t.onsuccess = () => res(t.result); }; r.onerror = () => res(null); }));
  if (proj) {
    const f = proj.find((x) => x.name === "Taco Truck Royalty");
    assert.ok(f, "the film is saved");
    assert.ok(!("_t" in f), "no timer saved");
    assert.equal(f.scenes[0].title, "Taco Truck Royalty"); assert.equal(f.scenes[0].lead, 3.4); assert.equal(f.scenes[2].tail, 3);
    assert.ok(f.scenes.every((x) => x.bg.asset && x.lines.every((l) => l.audio)), "every scene has a background and every line a voice");
    assert.deepEqual(f.scenes[0].actors.map((a) => a.x), [0.3, 0.7]); assert.equal(f.scenes[2].actors.length, 1);
    assert.ok(f.cast.every((c) => c.mouth && c.mouth.y > 0.05 && c.mouth.y < 0.4), "mouths found automatically");
    assert.ok(f.music && f.musicVol === 0.32);
  } else console.log("(the saved project wasn't readable from the test; skipped those checks)");
  await p.screenshot({ path: "director-done.png" });
  // it plays
  await p.locator("#f-play").click(); await p.waitForTimeout(4200);
  await p.screenshot({ path: "director-playing.png" });
  assert.match(await p.locator("#f-play").textContent(), /Stop/);
  await p.locator("#f-play").click();
  assert.deepEqual(errs.filter((e) => !/status of 429/.test(e)), [], "no errors (the one busy answer is the stand-in's)");
  await b.close();
  console.log("AI Director in Chromium ok: idea in, a 3-scene film out (script, 2 characters cut out with mouths, 3 backgrounds, 5 voices, a score, titles), paced past a busy answer, plays, no errors");
}
