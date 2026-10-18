// Browser check of the Studio value boxes: node studio-controls.mjs <patched rb-daw dir | live>
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { routeStudio } from './route-studio.mjs';
import assert from 'node:assert/strict';
const DIR = process.argv[2];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } }); p.setDefaultTimeout(8000);
const errs = []; p.on('pageerror', e => errs.push(e.message));
if (DIR !== 'live') await routeStudio(p, DIR);
await p.goto('https://studio.relentlessbillionaire.com/', { waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
const skip = p.locator('#wl-skip'); if (await skip.isVisible().catch(() => false)) await skip.click();
await p.getByRole('tab', { name: 'Mixer' }).click(); await p.waitForTimeout(300);
const box = (l) => p.locator(`.rb-val[aria-label="${l} value"]`).first();
const rng = (l) => p.locator(`input[type=range][aria-label="${l}"]`).first();
const val = async (l) => (await box(l).inputValue());
const raw = async (l) => +(await rng(l).inputValue());
// 1. typed exact values, with units, survive the mixer re-render and reach the track head
await box('Vocal Vol').click(); await p.keyboard.type('-6'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
console.log('vol -6 dB ->', await raw('Vocal Vol'), await val('Vocal Vol'), '| head', await val('Vocal volume'));
assert.equal(await val('Vocal Vol'), '−6.0 dB'); assert.equal(await raw('Vocal Vol'), 0.5); assert.equal(await val('Vocal volume'), '−6.0 dB');
await box('Vocal Pan').click(); await p.keyboard.type('L25'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
assert.equal(await val('Vocal Pan'), 'L 25'); assert.equal(await raw('Vocal Pan'), -0.25);
await box('Vocal Low').click(); await p.keyboard.type('3.5'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
assert.equal(await val('Vocal Low'), '+3.5 dB');
await box('Vocal Reverb').click(); await p.keyboard.type('35'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
assert.equal(await val('Vocal Reverb'), '35%');
// out of range clamps
await box('Vocal Mid').click(); await p.keyboard.type('40'); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
assert.equal(await val('Vocal Mid'), '+12 dB');
// 2. arrows: one step, Shift x10; focus stays in the box across the re-render
await box('Vocal Delay').click(); await p.keyboard.press('ArrowUp'); await p.keyboard.press('Shift+ArrowUp'); await p.waitForTimeout(900);
assert.equal(await val('Vocal Delay'), '11%');
assert.equal(await p.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Vocal Delay value', 'focus kept');
// 3. drag up on the value box scrubs
await p.keyboard.press('Escape'); await p.locator('h4').first().click();
await box('Vocal High').scrollIntoViewIfNeeded(); const bb = await box('Vocal High').boundingBox();
await p.mouse.move(bb.x + 20, bb.y + 10); await p.mouse.down(); await p.mouse.move(bb.x + 20, bb.y - 20, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(300);
console.log('scrub high ->', await val('Vocal High'));
assert.equal(await val('Vocal High'), '+5 dB');
// 4. shift-drag the slider: fine
await rng('Vocal Comp').scrollIntoViewIfNeeded(); const rb = await rng('Vocal Comp').boundingBox();
await p.keyboard.down('Shift'); await p.mouse.move(rb.x + 5, rb.y + rb.height / 2); await p.mouse.down(); await p.mouse.move(rb.x + 5 + rb.width, rb.y + rb.height / 2, { steps: 8 }); await p.mouse.up(); await p.keyboard.up('Shift'); await p.waitForTimeout(300);
console.log('shift-drag full width comp ->', await val('Vocal Comp'));
const comp = await raw('Vocal Comp'); assert.ok(comp >= 0.08 && comp <= 0.12, 'fine drag ~10%: ' + comp);
// 5. double-click resets, Alt-click resets
await rng('Vocal Pan').dblclick(); await p.waitForTimeout(300); assert.equal(await val('Vocal Pan'), 'C');
{ await rng('Vocal Low').scrollIntoViewIfNeeded(); const lb = await rng('Vocal Low').boundingBox(); await p.mouse.move(lb.x + lb.width - 3, lb.y + lb.height / 2); await p.keyboard.down('Alt'); await p.mouse.down(); await p.mouse.up(); await p.keyboard.up('Alt'); } await p.waitForTimeout(300); assert.equal(await val('Vocal Low'), '0 dB');
// 6. undo goes back one change at a time
await p.locator('#t-undo').click(); await p.waitForTimeout(300);
console.log('after undo low ->', await val('Vocal Low'));
assert.equal(await val('Vocal Low'), '+3.5 dB');
// 7. the change reached the saved song: reload keeps it
await p.waitForTimeout(1500); await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1000);
await p.getByRole('tab', { name: 'Mixer' }).click(); await p.waitForTimeout(300);
console.log('after reload vol/reverb', await val('Vocal Vol'), await val('Vocal Reverb'));
assert.equal(await val('Vocal Vol'), '−6.0 dB'); assert.equal(await val('Vocal Reverb'), '35%');
// 8. space in a value box does not start playback
await box('Vocal Reverb').click(); await p.keyboard.press('Space'); await p.waitForTimeout(300);
assert.equal(await p.locator('#t-play[aria-pressed=true]').count(), 0);
assert.deepEqual(errs, []);
console.log('luxe: all control checks passed');
await b.close();
