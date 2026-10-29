// Browser check of the vocal tools: node studio-vocal.mjs <rb-daw dist dir> (uses Chromium's fake microphone)
// RB_FAKE_WAV=<wav> feeds the microphone from a file: phrases with gaps (every 0.7 s, off the 180 BPM grid) over hiss.
// Loop-records takes, builds a comp bar by bar, applies and removes clean-up, picks a single take again.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { routeStudio } from './route-studio.mjs';
import assert from 'node:assert/strict';
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', ...(process.env.RB_FAKE_WAV ? ['--use-file-for-fake-audio-capture=' + process.env.RB_FAKE_WAV] : [])] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['microphone'] });
const p = await ctx.newPage(); p.setDefaultTimeout(10000); const errs = []; p.on('pageerror', e => errs.push(e.message));
await routeStudio(p, process.argv[2]);
await p.goto('https://studio.relentlessbillionaire.com/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
const skip = p.locator('#wl-skip'); if (await skip.isVisible().catch(() => false)) await skip.click();
const status = () => p.locator('#status').textContent().then((t) => t.trim());
const until = async (re, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { const s = await status(); if (re.test(s)) return s; await p.waitForTimeout(250); } throw new Error('status never matched ' + re + ': ' + await status()); };

// 1. three passes over a 4-bar loop at 180 BPM (about 5.3 s a pass)
await p.fill('#bpm', '180'); await p.locator('#bpm').press('Enter'); await p.waitForTimeout(300);
await p.click('#t-loop'); await p.click('#t-rec'); await p.waitForTimeout(18500); await p.click('#t-stop');
const rec = await until(/^Recorded \d+ takes over the loop/); console.log(rec);
await p.getByRole('tab', { name: 'Editor' }).click(); await p.waitForTimeout(400);
const takes = await p.locator('.takes > button.mini').count(); assert.ok(takes >= 2, 'takes ' + takes);
assert.match(await p.locator('.takes b').first().textContent(), new RegExp(`^Take ${takes} of ${takes}$`));
// 2. the comp grid: a column per bar, a row per take; pick take 1 for bar 1 and take 2 for the rest of bar 2
const grid = p.locator('.comp'); assert.equal(await grid.count(), 1);
const cells = await grid.locator('button').count(); const bars = cells / takes; assert.ok(Number.isInteger(bars) && bars >= 2, 'bars ' + bars);
await p.getByRole('button', { name: /^Bar 1: take 1$/ }).click(); await p.getByRole('button', { name: /^Bar 2: take 2$/ }).click();
assert.equal(await p.getByRole('button', { name: /^Bar 1: take 1$/ }).getAttribute('aria-pressed'), 'true');
assert.equal(await p.getByRole('button', { name: new RegExp(`^Bar 1: take ${takes}$`) }).getAttribute('aria-pressed'), 'false');
await p.getByRole('button', { name: 'Build comp' }).click();
console.log(await until(/^Comp built: bar 1 take 1, bar 2 take 2/));
assert.match(await p.locator('.takes b').first().textContent(), new RegExp(`^Comp of ${takes} takes$`));
assert.equal(await p.getByRole('button', { name: 'Rebuild comp' }).count(), 1);
assert.equal(await p.getByRole('button', { name: /^Bar 2: take 2$/ }).getAttribute('aria-pressed'), 'true', 'the comp remembers its picks');
// 3. clean-up on the comp: timing to 1/8 notes (the fake mic beeps once a second, off the 180 BPM grid)
await p.getByLabel('Timing grid').selectOption('1/8');
await p.getByRole('button', { name: 'Apply clean-up' }).click();
const fix = await until(/^(Clean-up on|Nothing to change|Clean-up needs)/); console.log(fix);
assert.match(fix, /^Clean-up on in [\d.]+ s: .*phrases/);
await p.waitForTimeout(300);
assert.match(await p.locator('.tune h4').nth(1).textContent(), /Clean-up & timing · on/);
assert.equal(await p.getByRole('button', { name: '▶ Original' }).count(), 1, 'compare buttons');
await p.getByRole('button', { name: '▶ Original' }).click(); await p.waitForTimeout(400);
assert.equal(await p.getByRole('button', { name: '■ Stop' }).count(), 1); await p.getByRole('button', { name: '■ Stop' }).click();
assert.match(await p.locator('.takes b').first().textContent(), /^Comp of/, 'clean-up sits on the comp');
await p.screenshot({ path: 'studio-vocal.png', fullPage: false });
// 4. turn it off: the comp is back
await p.getByRole('button', { name: 'Turn off' }).last().click();
console.log(await until(/^Clean-up off: the original take is back/));
assert.equal(await p.getByRole('button', { name: 'Apply clean-up' }).count(), 1);
// 5. a single take again
await p.locator('.takes > button.mini').first().click(); await p.waitForTimeout(300);
assert.match(await p.locator('.takes b').first().textContent(), new RegExp(`^Take 1 of ${takes}$`));
assert.equal(await p.getByRole('button', { name: 'Build comp' }).count(), 1);
// 6. the vocal chains are in the preset menu
await p.getByRole('tab', { name: 'Mixer' }).click(); await p.waitForTimeout(300);
const opts = await p.locator('select option').allTextContents();
for (const name of ['Clean vocal', 'Warm vocal', 'Radio-Ready vocal', 'Aggressive vocal']) assert.ok(opts.includes(name), name);
// 7. latency: the note says what each take is corrected by; Measure can't hear clicks through a fake mic, so it says so and changes nothing
assert.match(await p.locator('.rblat').textContent(), /^Each take is corrected by \d+ ms: \d+ ms your device reports\.$/);
await p.getByRole('button', { name: 'Measure' }).click();
console.log(await until(/^(Measured|Couldn't hear the clicks)/, 15000));
assert.match(await status(), /^Couldn't hear the clicks clearly.*Latency wasn't changed\.$/);
assert.deepEqual(errs, []);
await b.close();
console.log(`studio vocal tools in the browser: ${takes} takes over ${bars} bars, comp built, clean-up on and off, presets listed`);
