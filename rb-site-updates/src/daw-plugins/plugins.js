/* RB plugins (patch_daw_plugins.py): per-track inserts and send modes, live and in every offline export. */
var RBFX = { lowCut: !1, lowCutHz: 80, air: !1, airDb: 4, compMode: "", deEss: !1, deEssHz: 6500, deEssDb: -30,
    drive: !1, driveStyle: "tape", driveAmt: .4, driveMix: 1, double: !1, doubleAmt: .5, phone: !1, phoneDrive: .3,
    crunch: !1, crunchBits: 8, crunchRate: 4, gate: !1, gateDb: -50, revMode: "", delSync: "" },
  RBSLOTS = ["gate", "lowCut", "air", "deEss", "drive", "phone", "crunch", "double"],
  RBIRS = { plate: [1.9, 0, .08, 3.2, 0], room: [.8, .006, .35, 2.4, 1], hall: [3.4, .026, .55, 2.6, 0] },
  RBSYNC = { "1/4": 1, "1/8": .5, "1/16": .25 },
  rbOpen = new Set(),
  rbV = (e, k) => (e.fx && e.fx[k] != null ? e.fx[k] : RBFX[k]);
function rbFxLoad(c, tries = 2) {
  if (c.rbFx) return c.rbFx;
  return (c.rbFx = (async () => {
    if (!c.audioWorklet || typeof AudioWorkletNode === "undefined") return (c.rbFxOk = !1);
    for (let i = 0; i < tries; i++)
      try { return await c.audioWorklet.addModule(new URL("./fx-worklet.js?v=__RB_BUILD__", import.meta.url)), (c.rbFxOk = !0); }
      catch (e) { console.warn("RB Studio: plugins worklet didn't load (Gate and Sibilance are bypassed)", e && e.message); }
    return (c.rbFxOk = !1);
  })());
}
function rbP(p, v, c) {
  c.currentTime > 0 ? p.setTargetAtTime(v, c.currentTime, .015) : (p.cancelScheduledValues(0), p.setValueAtTime(v, 0));
}
function rbSlot(c) {
  let i = c.createGain(), o = c.createGain(), b = c.createGain(), w = c.createGain();
  return (w.gain.value = 0, i.connect(b).connect(o), w.connect(o), { i, o, b, w, p: null, on: !1 });
}
function rbChain(h, n) {
  let s = (n.ins = {});
  for (let k of RBSLOTS) s[k] = rbSlot(h.ctx);
  n.input.connect(s.gate.i), s.gate.o.connect(s.lowCut.i), s.lowCut.o.connect(n.low).connect(n.mid).connect(n.high).connect(s.air.i),
    s.air.o.connect(s.deEss.i), s.deEss.o.connect(n.comp).connect(s.drive.i), s.drive.o.connect(s.phone.i),
    s.phone.o.connect(s.crunch.i), s.crunch.o.connect(n.vol), (n.rvTo = ""), (n.dlTo = "");
  // Double adds only a stereo side signal after the fader (so mute/volume apply), next to the panned dry track.
  s.double.b.disconnect(), n.vol.connect(s.double.i), s.double.o.connect(h.master.input), s.double.o.connect(n.rev), s.double.o.connect(n.del);
}
function rbBq(c, type, f, q, gain) {
  let b = c.createBiquadFilter();
  return (b.type = type, b.frequency.value = f, q != null && (b.Q.value = q), gain != null && (b.gain.value = gain), b);
}
function rbShape(st, d) {
  let k = 1 + d * 14,
    f = st === "tube" ? (x) => Math.tanh(k * x + .3 * k * x * x) : st === "console" ? (x) => Math.sin(O((1 + 3 * d) * x, -1, 1) * Math.PI / 2)
      : st === "phone" ? (x) => Math.tanh((1 + 12 * d) * x) : (x) => Math.tanh(k * x),
    N = 2048, curve = new Float32Array(N), si = 0, so = 0, dc = 0, ys = [];
  for (let i = 0; i < N; i++) curve[i] = f((i / (N - 1)) * 2 - 1);
  for (let i = 0; i < 256; i++) { let x = .3 * Math.sin((2 * Math.PI * i) / 256), y = f(x); ys.push(y), (dc += y / 256), (si += x * x); }
  for (let y of ys) so += (y - dc) * (y - dc);
  return { curve, mk: so > 0 ? Math.sqrt(si / so) : 1 };
}
function rbWorklet(c, name) {
  if (!c.rbFxOk) return null;
  try { return new AudioWorkletNode(c, name); } catch (e) { return console.warn("RB Studio:", name, e && e.message), null; }
}
var RBB = {
  gate(c) {
    let w = rbWorklet(c, "rb-gate");
    return w && { inp: w, out: w, set: (e) => rbP(w.parameters.get("threshold"), O(rbV(e, "gateDb"), -90, -10), c) };
  },
  lowCut(c) {
    let a = rbBq(c, "highpass", 80, .5412), b = rbBq(c, "highpass", 80, 1.3066);
    return a.connect(b), { inp: a, out: b, set(e) { let f = O(rbV(e, "lowCutHz"), 20, 300); rbP(a.frequency, f, c), rbP(b.frequency, f, c); } };
  },
  air(c) {
    let a = rbBq(c, "highshelf", 11e3, null, 0);
    return { inp: a, out: a, set: (e) => rbP(a.gain, O(rbV(e, "airDb"), 0, 12), c) };
  },
  deEss(c) {
    let w = rbWorklet(c, "rb-deess");
    return w && { inp: w, out: w, set(e) { rbP(w.parameters.get("freq"), O(rbV(e, "deEssHz"), 5e3, 9e3), c), rbP(w.parameters.get("threshold"), O(rbV(e, "deEssDb"), -50, -10), c); } };
  },
  drive(c) {
    let pre = c.createGain(), sh = c.createWaveShaper(), dc = rbBq(c, "highpass", 12, .7), wet = c.createGain(), dry = c.createGain(), out = c.createGain();
    sh.oversample = "4x", pre.connect(sh).connect(dc).connect(wet).connect(out), pre.connect(dry).connect(out);
    return { inp: pre, out, key: "", set(e) {
      let st = rbV(e, "driveStyle"), d = O(rbV(e, "driveAmt"), 0, 1), m = O(rbV(e, "driveMix"), 0, 1);
      st = st === "tube" || st === "console" ? st : "tape";
      if (this.key !== st + d) { let r = rbShape(st, d); (sh.curve = r.curve), (this.mk = r.mk), (this.key = st + d); }
      rbP(wet.gain, m * this.mk, c), rbP(dry.gain, 1 - m, c);
    } };
  },
  phone(c) {
    let h1 = rbBq(c, "highpass", 300, .5412), h2 = rbBq(c, "highpass", 300, 1.3066), pk = rbBq(c, "peaking", 1800, 1, 4),
      sh = c.createWaveShaper(), l1 = rbBq(c, "lowpass", 3400, .5412), l2 = rbBq(c, "lowpass", 3400, 1.3066), out = c.createGain();
    sh.oversample = "2x", h1.connect(h2).connect(pk).connect(sh).connect(l1).connect(l2).connect(out);
    return { inp: h1, out, key: "", set(e) {
      let d = O(rbV(e, "phoneDrive"), 0, 1);
      if (this.key !== d) { let r = rbShape("phone", d); (sh.curve = r.curve), (this.mk = r.mk), (this.key = d); }
      rbP(out.gain, this.mk * 1.25, c);
    } };
  },
  crunch(c) {
    let w = rbWorklet(c, "rb-crush"), lp = rbBq(c, "lowpass", 8e3, .7), sh = null;
    if (!w) (sh = c.createWaveShaper()), sh.connect(lp); else w.connect(lp);
    return { inp: w || sh, out: lp, fb: !w, key: "", set(e) {
      let bits = Math.round(O(rbV(e, "crunchBits"), 3, 16)), st = Math.round(O(rbV(e, "crunchRate"), 1, 16));
      if (w) rbP(w.parameters.get("bits"), bits, c), rbP(w.parameters.get("step"), st, c);
      else if (this.key !== bits) {
        let L = Math.pow(2, bits - 1), N = 8192, cv = new Float32Array(N);
        for (let i = 0; i < N; i++) cv[i] = Math.round(((i / (N - 1)) * 2 - 1) * L) / L;
        (sh.curve = cv), (this.key = bits);
      }
      rbP(lp.frequency, Math.min(16e3, (.45 * c.sampleRate) / st), c);
    } };
  },
  double(c) {
    let inp = c.createGain(), dA = c.createDelay(.1), dB = c.createDelay(.1), gB = c.createGain(), side = c.createGain(), inv = c.createGain(),
      mg = c.createChannelMerger(2), oA = c.createOscillator(), oB = c.createOscillator(), mA = c.createGain(), mB = c.createGain();
    inp.channelCount = 1, inp.channelCountMode = "explicit", inp.channelInterpretation = "speakers";
    dA.delayTime.value = .012, dB.delayTime.value = .021, oA.frequency.value = .55, oB.frequency.value = .37, mA.gain.value = .0018, mB.gain.value = .0024;
    oA.connect(mA).connect(dA.delayTime), oB.connect(mB).connect(dB.delayTime), oA.start(), oB.start();
    // Two short, slowly detuned copies; side = A - B goes +L / -R. It is wide in stereo and adds exactly zero in mono.
    gB.gain.value = -1, inv.gain.value = -1, inp.connect(dA).connect(side), inp.connect(dB).connect(gB).connect(side);
    side.connect(mg, 0, 0), side.connect(inv).connect(mg, 0, 1);
    return { inp, out: mg, stop() { try { oA.stop(), oB.stop(); } catch {} }, set: (e) => rbP(side.gain, .7 * O(rbV(e, "doubleAmt"), 0, 1), c) };
  },
};
function rbDrop(q) {
  try { q.i.disconnect(q.p.inp), q.p.out.disconnect(), q.p.stop && q.p.stop(); } catch {}
  q.p = null;
}
function rbKill(n) {
  for (let k in n.ins || {}) { let q = n.ins[k]; q.p && q.p.stop && q.p.stop(); }
  n.ins && n.ins.double.o.disconnect();
}
function rbIR(c, m) {
  let [dur, pre, dark, pw, er] = RBIRS[m], sr = c.sampleRate, pd = Math.floor(sr * pre), n = pd + Math.floor(sr * dur),
    b = c.createBuffer(2, n, sr), e0 = (sr * 2.4) / 21, e1 = 0;
  for (let ch = 0; ch < 2; ch++) {
    let d = b.getChannelData(ch), lp = 0;
    for (let i = pd; i < n; i++) {
      let x = (i - pd) / (n - pd);
      (lp += (Math.random() * 2 - 1 - lp) * (1 - dark * Math.sqrt(x))), (d[i] = lp * Math.pow(1 - x, pw));
    }
    if (er) for (let t = 0; t < 7; t++) { let at = pd + Math.floor(sr * (.007 + .0055 * t + .002 * ch)); at < n && (d[at] += (ch ? -.6 : .6) * Math.pow(.8, t)); }
    for (let i = 0; i < n; i++) e1 += d[i] * d[i];
  }
  let k = Math.sqrt((2 * e0) / (e1 || 1));
  for (let ch = 0; ch < 2; ch++) { let d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] *= k; }
  return b;
}
function rbRev(h, m) {
  if (!RBIRS[m]) return h.revIn;
  let R = (h.rbRv = h.rbRv || {});
  if (!R[m]) {
    let i = h.ctx.createGain(), cv = h.ctx.createConvolver(), o = h.ctx.createGain();
    (cv.buffer = rbIR(h.ctx, m)), (o.gain.value = .9), i.connect(cv).connect(o).connect(h.master.input), (R[m] = i);
  }
  return R[m];
}
function rbDel(h, k) {
  if (!RBSYNC[k]) return h.delIn;
  let D2 = (h.rbDl = h.rbDl || {});
  if (!D2[k]) {
    let c = h.ctx, i = c.createGain(), d = c.createDelay(4), fb = c.createGain(), lp = rbBq(c, "lowpass", 4200);
    (fb.gain.value = .35), (d.delayTime.value = O((60 / (h.rbBpm || 90)) * RBSYNC[k], .05, 3.9)),
      i.connect(d), d.connect(lp).connect(fb).connect(d), lp.connect(h.master.input), (D2[k] = { i, d, beats: RBSYNC[k] });
  }
  return D2[k].i;
}
function rbSetBpm(h, e) {
  h.rbBpm = e;
  for (let k in h.rbDl || {}) h.rbDl[k].d.delayTime.setTargetAtTime(O((60 / e) * h.rbDl[k].beats, .05, 3.9), h.ctx.currentTime, .02);
}
function rbApply(h, a, e, n) {
  let c = h.ctx, s = a.ins;
  if (!s) return;
  for (let k of RBSLOTS) {
    let q = s[k], on = !!rbV(e, k);
    if (on && (!q.p || (q.p.fb && c.rbFxOk))) {
      q.p && rbDrop(q), (q.p = RBB[k](c));
      q.p && (q.i.connect(q.p.inp), q.p.out.connect(q.w));
    }
    (on = on && !!q.p), on && q.p.set(e);
    if (on !== q.on || !q.init) (q.on = on), (q.init = 1), rbP(q.b.gain, on ? 0 : 1, c), rbP(q.w.gain, on ? 1 : 0, c);
  }
  let i = O(e.fx.comp, 0, 1), m = rbV(e, "compMode");
  if (i > 0 && (m === "punch" || m === "smooth")) {
    let P = m === "punch", t = c.currentTime;
    a.comp.ratio.setValueAtTime(P ? 4 + 4 * i : 2.5 + i, t), (a.comp.knee.value = P ? 2 : 14),
      (a.comp.attack.value = P ? .0015 : .01), (a.comp.release.value = P ? .08 : .45),
      a.vol.gain.setTargetAtTime(n ? e.volume * (1 + i * (P ? .9 : .7)) : 0, t, .015);
  }
  let rv = rbV(e, "revMode"), dl = rbV(e, "delSync");
  a.rvTo !== rv && (a.rev.disconnect(), a.rev.connect(rbRev(h, rv)), (a.rvTo = rv));
  a.dlTo !== dl && (a.del.disconnect(), a.del.connect(rbDel(h, dl)), (a.dlTo = dl));
}
var RBPRESETS = {
  trap_lead: { label: "Hard Trap Lead", fx: { low: -2, mid: 2, high: 4, comp: .7, reverb: .08, delay: .14, compMode: "punch", lowCut: !0, lowCutHz: 120,
    air: !0, airDb: 4, deEss: !0, deEssHz: 6500, deEssDb: -30, drive: !0, driveStyle: "tape", driveAmt: .35, driveMix: .6, gate: !0, gateDb: -52, revMode: "plate", delSync: "1/8" } },
  melodic_hook: { label: "Melodic Hook", fx: { low: -2, mid: 0, high: 3, comp: .55, reverb: .35, delay: .25, compMode: "smooth", lowCut: !0, lowCutHz: 100,
    air: !0, airDb: 3, deEss: !0, deEssHz: 7e3, deEssDb: -32, drive: !0, driveStyle: "tube", driveAmt: .2, driveMix: .4, double: !0, doubleAmt: .55, revMode: "hall" } },
  boombap: { label: "Boom-bap Rap", fx: { low: -1, mid: 3, high: 1, comp: .65, reverb: .12, delay: .05, compMode: "punch", lowCut: !0, lowCutHz: 90,
    deEss: !0, deEssHz: 6e3, deEssDb: -28, drive: !0, driveStyle: "console", driveAmt: .45, driveMix: .7, gate: !0, gateDb: -48, revMode: "room", delSync: "1/4" } },
  rnb_silk: { label: "R&B Silk", fx: { low: -1, mid: -1, high: 3, comp: .5, reverb: .3, delay: .15, compMode: "smooth", lowCut: !0, lowCutHz: 80,
    air: !0, airDb: 5, deEss: !0, deEssHz: 7500, deEssDb: -34, drive: !0, driveStyle: "tape", driveAmt: .15, driveMix: .3, double: !0, doubleAmt: .35, revMode: "plate", delSync: "1/4" } },
  adlib_spice: { label: "Ad-lib Spice", volume: .6, fx: { low: -8, mid: 4, high: 3, comp: .65, reverb: .25, delay: .35, compMode: "punch", lowCut: !0, lowCutHz: 200,
    deEss: !0, deEssHz: 6500, deEssDb: -30, drive: !0, driveStyle: "tube", driveAmt: .5, driveMix: .7, double: !0, doubleAmt: .8, revMode: "hall", delSync: "1/8" } },
  phone_radio: { label: "Phone/Radio", fx: { low: 0, mid: 2, high: 0, comp: .6, reverb: .1, delay: .1, compMode: "punch", lowCut: !0, lowCutHz: 250,
    phone: !0, phoneDrive: .5, revMode: "room", delSync: "1/8" } },
};
function rbPlug(n) {
  let f = n.fx, cnt = RBSLOTS.filter((k) => rbV(n, k)).length,
    rr = (lab, k, a, b, st, al = lab) => l("label", {}, lab, l("input", { type: "range", min: a, max: b, step: st, value: String(rbV(n, k)), "aria-label": `${n.name} ${al}`,
      onpointerdown: () => D.mark(), oninput: (p) => { (f[k] = +p.target.value), g.sync(); }, onchange: () => x(() => {}, { mark: !1, what: "lanes" }) })),
    sel = (lab, k, opts) => l("label", {}, lab, l("select", { "aria-label": `${n.name} ${lab === "Style" ? "drive style" : lab}`, onchange: (p) => x(() => (f[k] = p.target.value)) },
      ...opts.map(([v, t]) => l("option", { value: v, selected: rbV(n, k) === v, text: t })))),
    mod = (k, name, tip, ...ctl) => l("div", { class: "plgm" }, l("button", { class: "mini plg", type: "button", title: tip, "aria-pressed": String(!!rbV(n, k)),
      dataset: { plug: k }, onclick: () => x(() => (f[k] = !rbV(n, k))), text: name }), rbV(n, k) ? ctl : null),
    off = g.ctx && g.ctx.rbFxOk === !1;
  return l("details", { class: "plug", open: rbOpen.has(n.id), ontoggle: (e) => (e.target.open ? rbOpen.add(n.id) : rbOpen.delete(n.id)) },
    l("summary", { text: "Plugins" + (cnt ? ` \xB7 ${cnt} on` : "") }),
    mod("gate", "Noise gate", "Silences hiss and room noise between phrases", rr("Thr", "gateDb", -80, -20, 1, "gate threshold")),
    mod("lowCut", "Low cut", "Removes rumble below the frequency (24 dB/oct)", rr("Hz", "lowCutHz", 20, 300, 1, "low cut frequency")),
    mod("air", "Air", "High shelf at 11 kHz for sparkle", rr("dB", "airDb", 0, 10, .5, "air boost")),
    mod("deEss", "Sibilance", "Tames harsh S and T sounds (split-band)", rr("Freq", "deEssHz", 5e3, 9e3, 100, "sibilance frequency"), rr("Thr", "deEssDb", -50, -10, 1, "sibilance threshold")),
    l("div", { class: "plgm" }, sel("Comp", "compMode", [["", "Standard"], ["punch", "Punch (fast)"], ["smooth", "Smooth (slow)"]])),
    mod("drive", "Drive", "Saturation with level matched", sel("Style", "driveStyle", [["tape", "Tape"], ["tube", "Tube"], ["console", "Console"]]),
      rr("Amt", "driveAmt", 0, 1, .01, "drive amount"), rr("Mix", "driveMix", 0, 1, .01, "drive mix")),
    mod("phone", "Phone/Radio", "Band-limited 300 Hz to 3.4 kHz with grit", rr("Drive", "phoneDrive", 0, 1, .01, "phone drive")),
    mod("crunch", "Crunch", "Lo-fi: fewer bits, lower sample rate", rr("Bits", "crunchBits", 3, 16, 1, "crunch bits"), rr("Rate", "crunchRate", 1, 16, 1, "crunch rate divider")),
    mod("double", "Double", "Two detuned copies left and right; disappears in mono", rr("Amt", "doubleAmt", 0, 1, .01, "double amount")),
    l("div", { class: "plgm" }, sel("Verb", "revMode", [["", "Classic"], ["plate", "Plate"], ["room", "Room"], ["hall", "Hall"]]),
      sel("Echo", "delSync", [["", "1/8 dotted"], ["1/4", "1/4"], ["1/8", "1/8"], ["1/16", "1/16"]])),
    off ? l("p", { class: "fine", text: "This browser can't run Noise gate or Sibilance, so they're bypassed." }) : null);
}
function rbClipBar(t) {
  let c = t.c, tr = t.t, b = (text, fn, cls = "") => l("button", { class: "btn small" + cls, type: "button", onclick: fn, text });
  return l("div", { class: "row2 cliptools", role: "toolbar", "aria-label": "Clip tools" },
    b("Duplicate", () => _e(c.id)),
    b("Split at playhead", () => { (r.sel.clip = c.id), za(); }),
    b("Delete clip", () => { He(c.id), w("Clip deleted. Undo (↶ or Ctrl+Z) brings it back.", "ok"); }, " del"),
    b("Delete track", () => { (tr.clips.length && !aa(tr)) || Ke(tr.id); }, " del"),
    b("Plugins", () => { rbOpen.add(tr.id), kt("mixer"); }));
}
