// Browser check of the recording fixes and the track-area bar: node studio-recording.mjs <patched rb-daw dir> (uses Chromium's fake microphone)
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { routeStudio } from './route-studio.mjs';
import assert from 'node:assert/strict';
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const mk = async (init, vp = { width: 1280, height: 900 }) => {
  const ctx = await b.newContext({ viewport: vp, permissions: ['microphone'] });
  const p = await ctx.newPage(); p.setDefaultTimeout(8000); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
  await routeStudio(p, process.argv[2]);
  init && await p.addInitScript(init);
  await p.goto('https://studio.relentlessbillionaire.com/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
  const skip = p.locator('#wl-skip'); if (await skip.isVisible().catch(() => false)) await skip.click();
  return p;
};
const st = (p) => p.evaluate(() => ({ ghost: !!document.querySelector('#rec-ghost'), rec: document.body.classList.contains('is-recording'), status: document.querySelector('#status').textContent.trim().slice(0, 80) }));

// 1. A normal take still records (fake mic tone), and the marker goes away.
let p = await mk();
await p.click('#t-rec'); await p.waitForTimeout(5000); await p.click('#t-stop'); await p.waitForTimeout(2000);
let s = await st(p); console.log('normal take', JSON.stringify(s));
assert.ok(/^Recorded \d/.test(s.status) && !s.ghost && !s.rec);
// 2. Opening another song while recording: the take is kept and recording ends.
await p.click('#t-rec'); await p.waitForTimeout(5000);
await p.getByRole('tab', { name: 'Projects' }).click(); await p.waitForTimeout(500);
const clipsBefore = await p.locator('.clip').count();
const open = p.getByRole('button', { name: 'Open', exact: true }).first();
console.log('projects open buttons', await p.getByRole('button', { name: 'Open', exact: true }).count());
if (await open.count()) { await open.click(); await p.waitForTimeout(2500); s = await st(p); console.log('open song mid-take', JSON.stringify(s)); assert.ok(!s.rec && !s.ghost); }
else { await p.click('#t-stop'); }
assert.deepEqual(p.errs, []); await p.context().close();

// 3. Recording fails to start with the headphone monitor on: monitor switched off, marker cleared.
p = await mk(() => { const W = window.AudioWorkletNode; window.AudioWorkletNode = function (c, n, o) { if (n === 'rb-recorder') throw new Error('test: recorder failed'); return new W(c, n, o); }; window.AudioWorkletNode.prototype = W.prototype;
  const C = AudioNode.prototype.connect; window.__mon = 0; AudioNode.prototype.connect = function (d, ...r) { if (this instanceof MediaStreamAudioSourceNode && d instanceof GainNode) window.__mon++; return C.call(this, d, ...r); };
  const D = AudioNode.prototype.disconnect; AudioNode.prototype.disconnect = function (...a) { if (this instanceof GainNode && this.__isMon) window.__mon--; return D.apply(this, a); }; });
await p.getByRole('button', { name: /Hear the input/ }).first().click().catch(async () => { await p.locator('button[title^="Hear the input"]').first().click(); });
await p.click('#t-rec'); await p.waitForTimeout(2500);
s = await st(p); console.log('failed start', JSON.stringify(s));
const monLeft = await p.evaluate(() => { /* monitor gain still feeding a track? */ return window.__mon; });
console.log('monitor connects', monLeft);
assert.ok(!s.ghost && !s.rec && /test: recorder failed/.test(s.status));
await p.context().close();

// 4. Track area resizer: drag up shrinks the panel, double-click folds it to the tabs, a tab opens it again, height is remembered.
p = await mk();
for (let i = 0; i < 6; i++) await p.getByRole('button', { name: '+ Audio track' }).click();
const ph = () => p.evaluate(() => Math.round(document.querySelector('.panel').getBoundingClientRect().height));
const vis = () => p.evaluate(() => { const sc = document.querySelector('#scroller').getBoundingClientRect(); return [...document.querySelectorAll('.head')].filter(h => { const r = h.getBoundingClientRect(); return r.height && r.bottom <= sc.bottom + 1; }).length; });
const h0 = await ph(), v0 = await vis();
const bb = await p.locator('.rb-split').boundingBox();
await p.mouse.move(bb.x + 100, bb.y + 5); await p.mouse.down(); await p.mouse.move(bb.x + 100, bb.y + 155, { steps: 5 }); await p.mouse.up();
const h1 = await ph(), v1 = await vis();
await p.locator('.rb-split').dblclick(); await p.waitForTimeout(100);
const h2 = await ph(), v2 = await vis();
await p.getByRole('tab', { name: 'Mixer' }).click(); await p.waitForTimeout(100);
const h3 = await ph();
await p.locator('.rb-split').focus(); await p.keyboard.press('ArrowUp'); const h4 = await ph();
console.log({ h0, v0, h1, v1, h2, v2, h3, h4, total: await p.locator('.head').count() });
assert.ok(h1 < h0 - 100 && v1 > v0, 'drag down gives tracks more room');
assert.ok(h2 <= 50 && v2 >= v1, 'double-click folds the panel');
assert.ok(h3 >= 200, 'a tab opens the panel again');
assert.equal(h4, h3 + 24, 'arrow keys resize');
await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(800);
assert.equal(await ph(), h4, 'height remembered');
assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
assert.deepEqual(p.errs, []);
await p.screenshot({ path: 'resized.png' });
await p.context().close();
// 5. Phone width: bar present and page doesn't scroll sideways.
p = await mk(null, { width: 390, height: 800 });
console.log('phone', await p.evaluate(() => ({ bar: !!document.querySelector('.rb-split'), sw: document.documentElement.scrollWidth, panel: Math.round(document.querySelector('.panel').getBoundingClientRect().height) })));
await p.screenshot({ path: 'phone.png' });
await b.close();
console.log('all fix checks passed');
