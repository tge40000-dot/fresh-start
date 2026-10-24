// RB World's sound, made live with WebAudio (no sound files to download):
//   - your engine: a growl that rises through five gears with your speed, louder on the throttle, with a whoosh on nitro;
//   - tyres squealing in a drift, wind rising with speed, a thud when you hit something;
//   - the city: a low traffic rumble, the odd distant horn, rain on the roof when it rains (fx.js weather);
//   - sirens when the cops are after you, getting louder as they close in;
//   - your horn: G.
// It follows Settings > Audio (on or off) and starts on the first tap or key, as browsers require.
import { on } from "./empire.js";

let A = null; // the audio context and its parts, once started
let duckK = 1; // the car radio dips the game's sounds while it plays
function noiseBuffer(ctx, seconds, brown) {
  const n = ctx.sampleRate * seconds, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) { const w = Math.random() * 2 - 1; if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
  return b;
}
function loop(ctx, buf) { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; }
function chain(ctx, ...nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; }
const set = (param, v, t = 0.08) => param.setTargetAtTime(v, A.ctx.currentTime, t);

function start() {
  if (A) { if (A.ctx.state === "suspended") A.ctx.resume(); return; }
  const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return;
  const ctx = new Ctx(), master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
  const white = noiseBuffer(ctx, 2, false), brown = noiseBuffer(ctx, 4, true);
  // engine: two detuned saws and a square an octave down, through a low-pass that opens with the revs
  const eng = ctx.createGain(); eng.gain.value = 0;
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 400; lp.Q.value = 3;
  const oscs = [["sawtooth", 1, 0.5], ["sawtooth", 1.007, 0.4], ["square", 0.5, 0.35]].map(([type, mul, g]) => {
    const o = ctx.createOscillator(); o.type = type; const og = ctx.createGain(); og.gain.value = g; o.connect(og).connect(lp); o.start(); return { o, mul };
  });
  lp.connect(eng).connect(master);
  // nitro whoosh, tyres, wind, rain and the city: filtered noise
  const band = (buf, type, f, q, g0 = 0) => { const s = loop(ctx, buf), fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = ctx.createGain(); g.gain.value = g0; chain(ctx, s, fl, g, master); return { g, fl }; };
  const nitro = band(white, "bandpass", 900, 0.7), tyre = band(white, "bandpass", 1900, 9), wind = band(white, "lowpass", 600, 0.5);
  const rain = band(white, "highpass", 2500, 0.3), city = band(brown, "lowpass", 260, 0.6);
  // sirens: a square wave that swaps between two notes
  const sir = ctx.createOscillator(); sir.type = "square"; const sg = ctx.createGain(); sg.gain.value = 0; const sf = ctx.createBiquadFilter(); sf.type = "lowpass"; sf.frequency.value = 1800;
  chain(ctx, sir, sf, sg, master); sir.start();
  A = { ctx, master, eng, lp, oscs, nitro, tyre, wind, rain, city, sir, sg, nextHorn: 15 + Math.random() * 20 };
}
// a short honk: two square waves, a quick fade
function honk(gain, f1 = 392, f2 = 494, len = 0.35) {
  if (!A) return;
  const { ctx } = A, g = ctx.createGain(), t = ctx.currentTime; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.02); g.gain.setValueAtTime(gain, t + len - 0.05); g.gain.linearRampToValueAtTime(0, t + len);
  const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 2200; chain(ctx, g, f, A.master);
  for (const fr of [f1, f2]) { const o = ctx.createOscillator(); o.type = "square"; o.frequency.value = fr; o.connect(g); o.start(t); o.stop(t + len + 0.05); }
}
function thud(strength) {
  if (!A) return;
  const { ctx } = A, t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = "sine"; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
  g.gain.setValueAtTime(Math.min(0.6, strength / 40), t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
  chain(ctx, o, g, A.master); o.start(t); o.stop(t + 0.4);
}

export function initAudio(E, ctx) {
  const go = () => start();
  for (const ev of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(ev, go, { passive: true });
  start(); // the START button press is a gesture already
  window.addEventListener("keydown", (e) => { if (e.code === "KeyG" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "")) honk(0.18); });
  on("crash", (hit) => thud(hit));
  let lastSpeed = 0, t = 0;
  on("frame", (dt) => {
    if (!A) return;
    t += dt;
    const audioOn = ctx.player.settings?.audio !== false && !document.hidden;
    set(A.master.gain, audioOn ? 0.9 * duckK : 0, 0.2);
    if (!audioOn) return;
    const car = E.car, v = car.onFoot ? 0 : Math.abs(car.speed || 0), accel = (v - lastSpeed) / Math.max(dt, 1e-3); lastSpeed = v;
    // gears every 9 m/s; revs climb through each gear and drop on the change
    const gear = Math.min(5, Math.floor(v / 9)), rpm = Math.min(1.25, (v - gear * 9) / 9 + (gear === 5 ? (v - 45) / 30 : 0));
    const base = 46 + gear * 7 + rpm * 70, throttle = Math.max(0, Math.min(1, accel / 12));
    for (const { o, mul } of A.oscs) set(o.frequency, base * mul, 0.05);
    set(A.lp.frequency, 260 + rpm * 900 + throttle * 600, 0.08);
    set(A.eng.gain, car.photo || car.onFoot ? 0 : 0.045 + throttle * 0.06 + Math.min(1, v / 40) * 0.03, 0.1);
    const boosting = !!car.boosting;
    set(A.nitro.g.gain, boosting ? 0.07 : 0, 0.1);
    set(A.tyre.g.gain, (car.drift || 0) > 6 && v > 10 ? Math.min(0.09, (car.drift - 6) * 0.012) : 0, 0.06);
    set(A.wind.g.gain, Math.min(0.08, (v / 45) ** 2 * 0.08), 0.2); set(A.wind.fl.frequency, 300 + v * 18, 0.2);
    const W = ctx.fx ? ctx.fx.weather : { rain: 0 };
    set(A.rain.g.gain, W.rain * 0.06, 0.5);
    set(A.city.g.gain, 0.035, 1);
    // cops: louder the closer the nearest one is
    const cops = (E.radar().cops || []), wanted = E.wanted ? E.wanted() : 0;
    const near = cops.reduce((m, c) => Math.min(m, Math.hypot(c.x - car.x, c.z - car.z)), Infinity);
    set(A.sg.gain, wanted > 0 && near < 250 ? 0.05 * (1 - near / 250) : 0, 0.2);
    A.sir.frequency.setValueAtTime(Math.floor(t * 2.2) % 2 ? 960 : 720, A.ctx.currentTime);
    // now and then a horn somewhere down the street
    A.nextHorn -= dt; if (A.nextHorn <= 0) { A.nextHorn = 18 + Math.random() * 30; honk(0.025, 330 + Math.random() * 80, 415 + Math.random() * 80, 0.25 + Math.random() * 0.3); }
  });
  return { honk: () => honk(0.18), started: () => !!A, duck: (v) => { duckK = Math.max(0, Math.min(1, Number(v) || 0)); } };
}
