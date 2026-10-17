"""Add a PLUG-INS section to RB Studio mastering (rb-mastering-studio): seven optional mastering stages, plus a
"loudness targets" table after mastering.

Usage: python3 -I patch_studio_plugins.py <pulled rb-mastering-studio dir>

The stages are generic versions of the tools mastering engineers use most. Every one is off until its box is ticked, and
with none ticked the engine's output is bit-identical to before (test/studio-plugins.test.mjs checks this).

  Glue compressor  bus compressor after the EQ: ratio 2/4/10, attack 0.1-30 ms, release 0.1-1.2 s or Auto (dual
                   release), sidechain high-pass at 90 Hz, threshold set from the mix for 0.5-3 dB of reduction.
  Warmth           tape-style saturation (asymmetric tanh), 4x oversampled so the harmonics don't alias.
  De-harsh         dynamic cut of a 2-5 kHz band (focus 2.5 / 3.5 / 4.5 kHz) only when it pokes out of the mix, max 1-6 dB.
  Low-end trick    the vintage boost-and-attenuate move: a broad boost at 60 or 100 Hz with a dip just above it.
  Stereo by band   separate width for 120 Hz-4 kHz and above 4 kHz; below 120 Hz follows the mono-bass box.
  Clipper          Hard / Soft / Tape (or Off) before the limiter, 0.5-3 dB off the loudest peaks, 4x oversampled.
                   Replaces the genre's built-in soft clip while ticked.
  Limiter style    Transparent / Punchy / Aggressive: sets the limiter's lookahead, release, limiting budget and
                   (Transparent, Aggressive) the built-in soft clip's knee.

The chain order is EQ (+ low-end trick) -> glue -> 3-band compression -> warmth -> de-harsh -> stereo -> exciter ->
clipper -> limiter -> true-peak guard. Nothing runs after the limiter and the final true-peak guard. Each stage that runs
reports what it did in settings.plugins and gets a line in "What the engine did" (and so in the master report).

After mastering, a "Loudness targets" table shows how Spotify, Apple Music and YouTube would turn the master down or up
(the engine's own platform rules on the measured integrated loudness and true peak) and how far it is from loud
hip-hop (-9 to -7 LUFS) and club (-6 LUFS) levels.

Each anchor must match exactly once; running it twice changes nothing. Mastering still runs on the visitor's device.
"""
import pathlib
import sys

folder = pathlib.Path(sys.argv[1])


def one(pattern):
    found = sorted(folder.glob(pattern))
    if len(found) != 1:
        raise SystemExit(f"rb-mastering-studio: expected one {pattern}, found {len(found)}")
    return found[0]


# ---------------------------------------------------------------------------------------------------------------- DSP
DSP_HELPERS = r'''  // ---------------------------------------------------------------- plug-ins (optional stages; with none set, master() is unchanged)
  // Limiter styles: lookahead (ms), release multiplier, change to the limiting budget (dB), change to the built-in
  // soft-clip knee (dB, + = less clipping) and extra clipper amount (dB) when the Clipper plug-in is on.
  var LIMITER_STYLES = {
    transparent: { label: "Transparent", look: 4, relMul: 1.6, grAdd: -0.5, kneeAdd: 1, clipAdd: 0 },
    punchy:      { label: "Punchy", look: 1, relMul: 0.8, grAdd: 0.5, kneeAdd: 0, clipAdd: 0 },
    aggressive:  { label: "Aggressive", look: 0.5, relMul: 0.5, grAdd: 1.5, kneeAdd: -1, clipAdd: 1 }
  };
  var CLIP_MODES = { soft: "Soft", hard: "Hard", tape: "Tape", off: "Off" };
  function optNum(v, d, lo, hi) { if (v == null || v === "") return d; v = +v; return isFinite(v) ? clamp(v, lo, hi) : d; }
  function plugOn(x) { return !!x && x.on !== false; }
  // turns the page's plain-data options into checked settings; a stage is absent unless asked for
  function plugOpts(o) {
    var p = {}, x;
    if (plugOn(o.glue)) { x = typeof o.glue === "object" ? o.glue : {};
      p.glue = { ratio: [2, 4, 10].indexOf(+x.ratio) >= 0 ? +x.ratio : 2, attack: optNum(x.attack, 10, 0.1, 30),
        release: x.release == null || x.release === "auto" ? "auto" : optNum(x.release, 300, 50, 2000), amount: optNum(x.amount, 1.5, 0.5, 4) }; }
    if (plugOn(o.warmth)) { x = typeof o.warmth === "object" ? o.warmth : {}; var wa = optNum(x.amount, 0.4, 0, 1); if (wa > 0) p.warmth = { amount: wa }; }
    if (plugOn(o.deharsh)) { x = typeof o.deharsh === "object" ? o.deharsh : {}; p.deharsh = { amount: optNum(x.amount, 3, 0.5, 6), focus: optNum(x.focus, 3500, 2000, 5000) }; }
    if (plugOn(o.lowTrick)) { x = typeof o.lowTrick === "object" ? o.lowTrick : {}; var lb = optNum(x.boost, 2, 0, 4); if (lb > 0) p.lowTrick = { freq: +x.freq === 100 ? 100 : 60, boost: lb }; }
    if (plugOn(o.bandWidth)) { x = typeof o.bandWidth === "object" ? o.bandWidth : {}; p.bandWidth = { low: optNum(x.low, 1, 0, 1.5), mid: optNum(x.mid, 1.2, 0, 2), high: optNum(x.high, 1.3, 0, 2) }; }
    if (plugOn(o.clipper)) { x = typeof o.clipper === "object" ? o.clipper : {}; p.clipper = { mode: CLIP_MODES[x.mode] ? x.mode : "soft", amount: optNum(x.amount, 1.5, 0, 3) }; }
    if (typeof o.limiterStyle === "string" && LIMITER_STYLES.hasOwnProperty(o.limiterStyle)) {
      var ls = LIMITER_STYLES[o.limiterStyle]; p.limiter = { key: o.limiterStyle, label: ls.label, look: ls.look, relMul: ls.relMul, grAdd: ls.grAdd, kneeAdd: ls.kneeAdd, clipAdd: ls.clipAdd };
    }
    return p;
  }
  // x + fn's distortion, computed at 4x the sample rate so harmonics above Nyquist are filtered out instead of folding
  // back. Zero-phase filters keep the residual aligned with x; worked in blocks so memory stays small.
  function oversampled(x, sr, fn) {
    var n = x.length, out = Float32Array.from(x), B = 32768, P = 256, lp = butter4("lp", Math.min(0.42 * sr, 20000), sr * 4), s0, i;
    lp = lp.concat(lp);
    for (s0 = 0; s0 < n; s0 += B) {
      var a = Math.max(0, s0 - P), b = Math.min(n, s0 + B + P), m = b - a, u = new Float32Array(m * 4), e = Math.min(n, s0 + B);
      for (i = 0; i < m; i++) u[i * 4] = x[a + i] * 4;
      u = filtfilt(u, lp);
      for (i = 0; i < u.length; i++) u[i] = fn(u[i]) - u[i];
      u = filtfilt(u, lp);
      for (i = s0; i < e; i++) out[i] = x[i] + u[(i - a) * 4];
    }
    return out;
  }
  function pctOf(arr, p) { if (!arr.length) return null; arr.sort(function (a, b) { return a - b; }); return arr[Math.min(arr.length - 1, Math.floor(arr.length * p))]; }
  // Glue: feed-forward bus compressor, RMS-ish detector on a 90 Hz high-passed sidechain, soft knee, log-domain ballistics.
  // Threshold comes from the mix: the loud 10% of the song gets about `amount` dB of static reduction.
  // Auto release = dual release: 100 ms for transients, 1.2 s for sustained loud passages (slow side charges over 250 ms).
  function glueStage(chs, sr, o) {
    var n = chs[0].length, hp = coefs("hp", 90, sr, 0.707), lv = new Float32Array(n), e = 0, a10 = Math.exp(-1 / (sr * 0.01)), i, c, v, q;
    var sc = chs.map(function (x) { return run(x, hp); });
    for (i = 0; i < n; i++) { v = 0; for (c = 0; c < sc.length; c++) { q = sc[c][i] * sc[c][i]; if (q > v) v = q; } e = a10 * e + (1 - a10) * v; lv[i] = 10 * Math.log10(e + 1e-20); }
    var smp = [], step = Math.max(1, Math.floor(n / 20000));
    for (i = 0; i < n; i += step) if (lv[i] > -70) smp.push(lv[i]);
    var r = o.ratio, slope = 1 - 1 / r, K = 4, p90 = pctOf(smp, 0.9), thr = (p90 == null ? -20 : p90) - o.amount / slope;
    var aA = Math.exp(-1 / (sr * o.attack / 1000)), auto = o.release === "auto", aR = Math.exp(-1 / (sr * (auto ? 100 : o.release) / 1000));
    var aAs = Math.exp(-1 / (sr * 0.25)), aRs = Math.exp(-1 / (sr * 1.2)), gF = 0, gS = 0, gr, sum = 0, cnt = 0, mx = 0;
    for (i = 0; i < n; i++) {
      var over = lv[i] - thr, t;
      if (over <= -K / 2) t = 0; else if (over >= K / 2) t = over * slope; else { var u = over + K / 2; t = slope * u * u / (2 * K); }
      gF = t > gF ? aA * gF + (1 - aA) * t : aR * gF + (1 - aR) * t;
      if (auto) { gS = t > gS ? aAs * gS + (1 - aAs) * t : aRs * gS + (1 - aRs) * t; gr = gF > gS ? gF : gS; } else gr = gF;
      var g = undb(-gr); for (c = 0; c < chs.length; c++) chs[c][i] *= g;
      if (lv[i] > -70) { sum += gr; cnt++; } if (gr > mx) mx = gr;
    }
    return { ratio: r, attackMs: o.attack, release: auto ? "auto" : o.release, sidechainHpHz: 90, targetDb: o.amount, thresholdDb: thr, avgGrDb: cnt ? sum / cnt : 0, maxGrDb: mx };
  }
  // Warmth: asymmetric tanh (tape-like, adds 2nd and 3rd harmonics), slope 1 at zero so quiet parts pass unchanged.
  // The loud 5% of the song is brought to -14 dBFS RMS before the curve, so the same setting sounds alike on any mix.
  function warmthStage(chs, sr, o) {
    var lvl = percentileLevel(chs, sr, 0.95), drive = 9 * o.amount, k = undb(-14 - lvl + drive), b = 0.2 * o.amount, tb = Math.tanh(b), norm = 1 / (k * (1 - tb * tb));
    var fn = function (v) { return (Math.tanh(k * v + b) - tb) * norm; }, dc = [coefs("hp", 12, sr, 0.707)];
    for (var c = 0; c < chs.length; c++) chs[c] = filtfilt(oversampled(chs[c], sr, fn), dc); // the asymmetry makes a little DC
    return { amount: o.amount, driveDb: drive, biasPct: 100 * b, oversample: 4 };
  }
  // De-harsh: a zero-phase 2-5 kHz band is turned down (3:1 above its usual share of the mix) only while it sticks out.
  function deharshStage(chs, sr, o) {
    var n = chs[0].length, lo = o.focus / 1.6, hi = Math.min(o.focus * 1.6, 0.45 * sr), c, i, v, w;
    var bands = chs.map(function (x) { return filtfilt(filtfilt(x, butter4("hp", lo, sr)), butter4("lp", hi, sr)); });
    var aA = Math.exp(-1 / (sr * 0.002)), aR = Math.exp(-1 / (sr * 0.05)), eB = 0, eF = 0, rel = new Float32Array(n);
    for (i = 0; i < n; i++) {
      v = 0; w = 0;
      for (c = 0; c < chs.length; c++) { var ab = bands[c][i] < 0 ? -bands[c][i] : bands[c][i], af = chs[c][i] < 0 ? -chs[c][i] : chs[c][i]; if (ab > v) v = ab; if (af > w) w = af; }
      eB = v > eB ? aA * eB + (1 - aA) * v : aR * eB + (1 - aR) * v; eF = w > eF ? aA * eF + (1 - aA) * w : aR * eF + (1 - aR) * w;
      rel[i] = eF > 1e-5 ? db(eB) - db(eF) : -99;
    }
    var smp = [], step = Math.max(1, Math.floor(n / 20000));
    for (i = 0; i < n; i += step) if (rel[i] > -90) smp.push(rel[i]);
    var thr = pctOf(smp, 0.6); if (thr == null) thr = 0;
    var cA = Math.exp(-1 / (sr * 0.002)), cR = Math.exp(-1 / (sr * 0.08)), cut = 0, sum = 0, cnt = 0, mx = 0;
    for (i = 0; i < n; i++) {
      var over = rel[i] - thr - 1, t = over > 0 ? Math.min(o.amount, over * (2 / 3)) : 0;
      cut = t > cut ? cA * cut + (1 - cA) * t : cR * cut + (1 - cR) * t;
      var k = 1 - undb(-cut); for (c = 0; c < chs.length; c++) chs[c][i] -= bands[c][i] * k;
      if (rel[i] > -90) { sum += cut; cnt++; } if (cut > mx) mx = cut;
    }
    return { focusHz: o.focus, loHz: lo, hiHz: hi, maxCutDb: o.amount, avgCutDb: cnt ? sum / cnt : 0, peakCutDb: mx };
  }
  // Low-end trick: broad boost at 60/100 Hz plus a narrower cut 2.5x higher, like boosting and attenuating at once on a
  // vintage program EQ (a fuller bottom without the boom above it).
  function lowTrickFilters(sr, o) { return [coefs("peak", o.freq, sr, 0.6, o.boost), coefs("peak", o.freq * 2.5, sr, 1.0, -0.6 * o.boost)]; }
  // Stereo by band: side signal split at 120 Hz / 4 kHz (zero-phase, sums back exactly); low follows mono bass.
  function bandWidthStage(chs, M, S, sr, o, monoBass) {
    var n = S.length, sLo = filtfilt(S, butter4("lp", 120, sr)), sHi = filtfilt(S, butter4("hp", 4000, sr)), wl = monoBass ? 0 : o.low, i;
    for (i = 0; i < n; i++) { var s2 = sLo[i] * wl + (S[i] - sLo[i] - sHi[i]) * o.mid + sHi[i] * o.high; chs[0][i] = M[i] + s2; chs[1][i] = M[i] - s2; }
    return { low: wl, mid: o.mid, high: o.high, splitHz: [120, 4000] };
  }
  // Clipper before the limiter. `amount` dB comes off the loudest peaks (99th percentile of 10 ms peaks), 4x oversampled.
  function clipperStage(chs, sr, gd, o, lim) {
    var n = chs[0].length, amt = clamp(o.amount + (lim ? lim.clipAdd : 0), 0, 4), c, i, j;
    for (c = 0; c < chs.length; c++) for (i = 0; i < n; i++) chs[c][i] *= gd;
    if (o.mode === "off" || amt <= 0) return { mode: o.mode, label: CLIP_MODES[o.mode], amountDb: 0, thresholdDb: null, pct: 0, clipped: 0 };
    var w = Math.max(1, Math.round(0.01 * sr)), mx = [];
    for (i = 0; i < n; i += w) { var m = 0; for (c = 0; c < chs.length; c++) for (j = i; j < Math.min(n, i + w); j++) { var a = chs[c][j] < 0 ? -chs[c][j] : chs[c][j]; if (a > m) m = a; } if (m > 1e-6) mx.push(m); }
    var P = pctOf(mx, 0.99) || 1, th = P * undb(-amt), knee = th * undb(-3), cnt = 0, fn;
    if (o.mode === "hard") fn = function (v) { return v > th ? th : v < -th ? -th : v; };
    else if (o.mode === "tape") fn = function (v) { return th * Math.tanh(v / th); };
    else fn = function (v) { var a = v < 0 ? -v : v; if (a <= knee) return v; a = knee + (th - knee) * Math.tanh((a - knee) / (th - knee)); return v < 0 ? -a : a; };
    for (c = 0; c < chs.length; c++) { for (i = 0; i < n; i++) if (chs[c][i] > th || chs[c][i] < -th) cnt++; chs[c] = oversampled(chs[c], sr, fn); }
    return { mode: o.mode, label: CLIP_MODES[o.mode], amountDb: amt, thresholdDb: db(th), pct: 100 * cnt / (chs.length * n), clipped: cnt, oversample: 4 };
  }

'''

DSP_EDITS = [
    ("  // ---------------------------------------------------------------- mastering chain\n",
     DSP_HELPERS + "  // ---------------------------------------------------------------- mastering chain\n"),
    ("    eq[0] += opts.bass || 0; eq[4] += opts.presence || 0; eq[5] += opts.air || 0;\n",
     "    eq[0] += opts.bass || 0; eq[4] += opts.presence || 0; eq[5] += opts.air || 0;\n"
     "    var pl = plugOpts(opts), plugInfo = {}, limLook = 1.5;\n"
     "    if (pl.limiter) {\n"
     "      st.rel *= pl.limiter.relMul; st.gr = Math.max(1, st.gr + pl.limiter.grAdd); st.knee = Math.min(-1, st.knee + pl.limiter.kneeAdd); limLook = pl.limiter.look;\n"
     "      plugInfo.limiter = { style: pl.limiter.key, label: pl.limiter.label, lookMs: limLook, releaseMs: st.rel, budgetDb: st.gr, kneeDb: st.knee, softClip: st.clip && !pl.clipper };\n"
     "    }\n"),
    ("    var filt = [coefs(\"hp\", 22, sr, 0.707)].concat(EQ_BANDS.map(function (b, i) { return coefs(b.type, b.f, sr, b.q, eq[i]); }));\n",
     "    var filt = [coefs(\"hp\", 22, sr, 0.707)].concat(EQ_BANDS.map(function (b, i) { return coefs(b.type, b.f, sr, b.q, eq[i]); }));\n"
     "    if (pl.lowTrick) { filt = filt.concat(lowTrickFilters(sr, pl.lowTrick)); plugInfo.lowTrick = { freq: pl.lowTrick.freq, boostDb: pl.lowTrick.boost, dipFreq: pl.lowTrick.freq * 2.5, dipDb: -0.6 * pl.lowTrick.boost }; }\n"),
    ("    progress(0.3, \"EQ\");\n",
     "    progress(0.3, \"EQ\");\n"
     "    if (pl.glue) { plugInfo.glue = glueStage(chs, sr, pl.glue); progress(0.36, \"Glue\"); }\n"),
    ("    progress(0.5, \"Dynamics\");\n",
     "    progress(0.5, \"Dynamics\");\n"
     "    if (pl.warmth) { plugInfo.warmth = warmthStage(chs, sr, pl.warmth); progress(0.54, \"Warmth\"); }\n"
     "    if (pl.deharsh) { plugInfo.deharsh = deharshStage(chs, sr, pl.deharsh); progress(0.57, \"De-harsh\"); }\n"),
    ("      var sHi = filtfilt(S, butter4(\"hp\", 250, sr)), monoBass = opts.monoBass == null ? st.mono : opts.monoBass, sLo = monoBass ? filtfilt(S, butter4(\"lp\", 120, sr)) : null;\n"
     "      for (i = 0; i < n; i++) { var s2 = S[i] + sHi[i] * (width - 1) - (sLo ? sLo[i] : 0); chs[0][i] = M[i] + s2; chs[1][i] = M[i] - s2; }\n",
     "      if (pl.bandWidth) { var monoBass = opts.monoBass == null ? st.mono : opts.monoBass; plugInfo.bandWidth = bandWidthStage(chs, M, S, sr, pl.bandWidth, monoBass); } else {\n"
     "      var sHi = filtfilt(S, butter4(\"hp\", 250, sr)), monoBass = opts.monoBass == null ? st.mono : opts.monoBass, sLo = monoBass ? filtfilt(S, butter4(\"lp\", 120, sr)) : null;\n"
     "      for (i = 0; i < n; i++) { var s2 = S[i] + sHi[i] * (width - 1) - (sLo ? sLo[i] : 0); chs[0][i] = M[i] + s2; chs[1][i] = M[i] - s2; }\n"
     "      }\n"),
    ("    if (st.clip) chs.forEach(function (x) {\n",
     "    if (pl.clipper) { plugInfo.clipper = clipperStage(chs, sr, gd, pl.clipper, pl.limiter); clipped = plugInfo.clipper.clipped; }\n"
     "    else if (st.clip) chs.forEach(function (x) {\n"),
    ("      g = limiterGain(tpk, sr, undb(gain), guard, 1.5, st.rel);\n",
     "      g = limiterGain(tpk, sr, undb(gain), guard, limLook, st.rel);\n"),
    ("bandGrDb: grs, width: width, exciterDb: exAmt, gainDb: drive + gain },\n",
     "bandGrDb: grs, width: width, exciterDb: exAmt, gainDb: drive + gain, plugins: plugInfo },\n"),
]

# ---------------------------------------------------------------------------------------------------------------- page
CSS = (
    '.plugs{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px}\n'
    '.plug{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 16px 14px;min-width:0;transition:border-color .15s}\n'
    '.plug.on{border-color:var(--gold);background:#100e07}\n'
    '.plug label.plug-h{display:flex;gap:10px;align-items:center;margin:0;min-height:36px;font-size:12px;letter-spacing:.12em;color:var(--txt);font-weight:600;cursor:pointer}\n'
    '.plug label.plug-h input{width:18px;height:18px}\n'
    '.plug p{margin:2px 0 0;font-size:12px;color:var(--dim)}\n'
    '.plug .ctl{display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;margin-top:8px}\n'
    '.plug .ctl label{margin:8px 0 4px}.plug select{padding:8px 10px;font-size:13px}.plug .ctl .wide{grid-column:1/-1}\n'
    '.plug:not(.on) .ctl{opacity:.45}\n'
    '@media(max-width:420px){.plug .ctl{grid-template-columns:1fr}}\n'
)


def sl(id_, label, lo, hi, step, val, out, unit="", fmt=""):
    extra = f' data-unit="{unit}"' if unit else ""
    extra += f' data-fmt="{fmt}"' if fmt else ""
    return (f'<div class="wide"><label for="{id_}">{label}</label><div class="sl"><input type="range" id="{id_}" min="{lo}" max="{hi}" step="{step}" value="{val}"{extra}>'
            f'<output for="{id_}">{out}</output></div></div>')


def sel(id_, label, options, selected, wide=False):
    opts = "".join(f'<option value="{v}"{" selected" if v == selected else ""}>{t}</option>' for v, t in options)
    cls = ' class="wide"' if wide else ""
    return f'<div{cls}><label for="{id_}">{label}</label><select id="{id_}">{opts}</select></div>'


def plug(key, title, where, text, controls):
    return (f'      <div class="plug" data-plug="{key}">\n'
            f'        <label class="plug-h"><input type="checkbox" id="pl-{key}"> {title}</label>\n'
            f'        <p>{text} <i>{where}</i></p>\n'
            f'        <div class="ctl">{"".join(controls)}</div>\n'
            f'      </div>\n')


PLUGS_HTML = (
    '    <h3>PLUG-INS <span class="tag">OPTIONAL · OFF UNTIL TICKED</span></h3>\n'
    '    <p class="sub" style="margin:0 0 12px">Extra stages modelled on the tools mastering engineers use most. Tick one to add it to the chain; where it sits in the chain is in italics. Untick it and it\'s gone.</p>\n'
    '    <div class="plugs" id="plugs">\n'
    + plug("glue", "GLUE COMPRESSOR", "After EQ.", "Bus compressor that holds the mix together. Its detector ignores the sub (high-pass at 90 Hz).", [
        sel("glue-ratio", "RATIO", [("2", "2:1"), ("4", "4:1"), ("10", "10:1")], "2"),
        sel("glue-attack", "ATTACK", [("0.1", "0.1 ms"), ("0.3", "0.3 ms"), ("1", "1 ms"), ("3", "3 ms"), ("10", "10 ms"), ("30", "30 ms")], "10"),
        sel("glue-release", "RELEASE", [("100", "0.1 s"), ("300", "0.3 s"), ("600", "0.6 s"), ("1200", "1.2 s"), ("auto", "Auto")], "auto"),
        sl("glue-amount", "REDUCTION", 0.5, 3, 0.5, 1.5, "1.5 dB", " dB")])
    + plug("warmth", "WARMTH", "After the 3-band compressor.", "Tape-style saturation: rounder lows and mids, 4x oversampled so it stays clean up top.", [
        sl("warmth-amount", "AMOUNT", 10, 100, 10, 40, "40%", "%")])
    + plug("deharsh", "DE-HARSH", "After Warmth.", "Turns 2-5 kHz down only in the moments it gets harsh (cymbals, bright vocals), not all the time.", [
        sl("deharsh-amount", "MAX CUT", 1, 6, 0.5, 3, "3 dB", " dB"),
        sel("deharsh-focus", "FOCUS", [("2500", "2.5 kHz"), ("3500", "3.5 kHz"), ("4500", "4.5 kHz")], "3500")])
    + plug("lowtrick", "LOW-END TRICK", "In the EQ.", "The vintage boost-and-attenuate move: a fuller bottom with a small dip above it so it doesn't boom.", [
        sel("lowtrick-freq", "FREQUENCY", [("60", "60 Hz"), ("100", "100 Hz")], "60"),
        sl("lowtrick-boost", "BOOST", 0.5, 4, 0.5, 2, "2 dB", " dB")])
    + plug("bandwidth", "STEREO BY BAND", "Replaces the width step.", "Separate width for the mids and the highs. Below 120 Hz follows the mono bass box above.", [
        sl("bw-mid", "MID WIDTH", 0.8, 1.6, 0.05, 1.2, "120%", "", "pct"),
        sl("bw-high", "HIGH WIDTH", 0.8, 1.8, 0.05, 1.3, "130%", "", "pct")])
    + plug("clipper", "CLIPPER", "Just before the limiter.", "Shaves the loudest peaks so the limiter works less. Replaces the genre's built-in soft clip while ticked.", [
        sel("clip-mode", "MODE", [("soft", "Soft"), ("hard", "Hard"), ("tape", "Tape"), ("off", "Off (no clipping)")], "soft"),
        sl("clip-amount", "AMOUNT", 0.5, 3, 0.5, 1.5, "1.5 dB", " dB")])
    + plug("limstyle", "LIMITER STYLE", "The limiter, last in the chain.", "Transparent: slow and clean. Punchy: lets drums snap back. Aggressive: fastest, loudest, and it adds clipping.", [
        sel("lim-style", "STYLE", [("transparent", "Transparent"), ("punchy", "Punchy"), ("aggressive", "Aggressive")], "punchy", True)])
    + '    </div>\n'
)

TARGETS_HTML = (
    '    <h3>LOUDNESS TARGETS <span class="tag">MEASURED</span></h3>\n'
    '    <div class="tbl"><table><thead><tr><th>TARGET</th><th class="num">LUFS</th><th class="num">dBTP</th><th>YOUR MASTER</th><th>PEAKS</th></tr></thead><tbody id="tgt-rows"></tbody></table></div>\n'
    '    <div class="status" id="tgt-note"></div>\n'
)

PLUG_JS = r'''  // ---------------------------------------------------------------- plug-ins: optional stages, sent to the engine as plain settings
  function plugSync(box) {
    var on = box.querySelector(".plug-h input").checked;
    box.classList.toggle("on", on);
    box.querySelectorAll(".ctl input, .ctl select").forEach(function (el) { el.disabled = !on; });
  }
  document.querySelectorAll("#plugs .plug").forEach(function (box) { box.querySelector(".plug-h input").addEventListener("change", function () { plugSync(box); }); plugSync(box); });
  document.querySelectorAll("#plugs input[type=range]").forEach(function (r) {
    r.oninput = function () { this.nextElementSibling.textContent = this.dataset.fmt === "pct" ? Math.round(this.value * 100) + "%" : this.value + (this.dataset.unit || ""); };
  });
  $("pl-bandwidth").addEventListener("change", function () { // start from the current width the first time
    if (!this.checked || this.dataset.seeded) return;
    this.dataset.seeded = "1"; var w = +$("width").value;
    $("bw-mid").value = w; $("bw-high").value = Math.min(1.8, w + 0.1); $("bw-mid").oninput(); $("bw-high").oninput();
  });
  function pluginOpts() {
    var o = {}, on = function (k) { return $("pl-" + k).checked; }, v = function (id) { return $(id).value; };
    if (on("glue")) o.glue = { ratio: +v("glue-ratio"), attack: +v("glue-attack"), release: v("glue-release") === "auto" ? "auto" : +v("glue-release"), amount: +v("glue-amount") };
    if (on("warmth")) o.warmth = { amount: +v("warmth-amount") / 100 };
    if (on("deharsh")) o.deharsh = { amount: +v("deharsh-amount"), focus: +v("deharsh-focus") };
    if (on("lowtrick")) o.lowTrick = { freq: +v("lowtrick-freq"), boost: +v("lowtrick-boost") };
    if (on("bandwidth")) o.bandWidth = { low: $("monobass").checked ? 0 : 1, mid: +v("bw-mid"), high: +v("bw-high") };
    if (on("clipper")) o.clipper = { mode: v("clip-mode"), amount: +v("clip-amount") };
    if (on("limstyle")) o.limiterStyle = v("lim-style");
    return o;
  }
  // chain lines for the plug-ins, in chain order around the standard five
  function withPlugins(s, rep, list) {
    var p = s.plugins || {}, out = [list[0]], hz = function (f) { return f >= 1000 ? (f / 1000).toFixed(1).replace(/\.0$/, "") + " kHz" : Math.round(f) + " Hz"; };
    if (p.lowTrick) out.push("<b>Low-end trick</b> (boost and attenuate): " + f1(p.lowTrick.boostDb) + " dB at " + hz(p.lowTrick.freq) + " with a " + f1(p.lowTrick.dipDb) + " dB dip at " + hz(p.lowTrick.dipFreq) + ".");
    if (p.glue) out.push("<b>Glue compressor</b>: " + p.glue.ratio + ":1, attack " + p.glue.attackMs + " ms, release " + (p.glue.release === "auto" ? "auto" : (p.glue.release / 1000) + " s") +
      ", sidechain high-pass " + p.glue.sidechainHpHz + " Hz, " + p.glue.avgGrDb.toFixed(1) + " dB average reduction (" + p.glue.maxGrDb.toFixed(1) + " dB max).");
    out.push(list[1]);
    if (p.warmth) out.push("<b>Warmth</b>: tape-style saturation, " + Math.round(p.warmth.amount * 100) + "% (" + p.warmth.driveDb.toFixed(1) + " dB drive), " + p.warmth.oversample + "x oversampled.");
    if (p.deharsh) out.push("<b>De-harsh</b>: dynamic cut around " + hz(p.deharsh.focusHz) + " (" + hz(p.deharsh.loHz) + "-" + hz(p.deharsh.hiHz) + "), " + p.deharsh.avgCutDb.toFixed(1) + " dB on average, " + p.deharsh.peakCutDb.toFixed(1) + " dB at most.");
    out.push(p.bandWidth ? "<b>Stereo by band</b>: below 120 Hz " + (p.bandWidth.low === 0 ? "mono" : Math.round(p.bandWidth.low * 100) + "%") + ", 120 Hz-4 kHz at " + Math.round(p.bandWidth.mid * 100) + "%, above 4 kHz at " + Math.round(p.bandWidth.high * 100) + "% width." : list[2]);
    out.push(list[3]);
    var loud = list[4];
    if (p.clipper) {
      out.push(p.clipper.mode === "off" ? "<b>Clipper</b>: off, straight into the limiter." : "<b>Clipper</b>: " + p.clipper.label + ", " + p.clipper.amountDb.toFixed(1) + " dB off the loudest peaks, " + p.clipper.oversample + "x oversampled (engaged on " + p.clipper.pct.toFixed(1) + "% of samples).");
      loud = loud.replace(/soft clipper \(engaged on [^)]*\) into a/, "the clipper into a");
    }
    if (p.limiter) out.push("<b>Limiter style</b>: " + p.limiter.label + ", " + p.limiter.lookMs + " ms lookahead, " + Math.round(p.limiter.releaseMs) + " ms release, " + p.limiter.budgetDb.toFixed(1) + " dB limiting budget.");
    out.push(loud);
    return out;
  }
  // loudness targets: the engine's own platform rules on the master's measured integrated loudness and true peak
  function renderTargets(m) {
    var a = after, gain = function (k) { var r = m.after.filter(function (x) { return x.key === k; })[0]; return r ? r.gainDb : null; };
    var rows = [
      { label: "Spotify", key: "spotify", lufs: -14, tp: -1 }, { label: "Apple Music", key: "apple", lufs: -16, tp: -1 }, { label: "YouTube", key: "youtube", lufs: -14, tp: -1 },
      { label: "Loud hip-hop", lo: -9, hi: -7 }, { label: "Club / DJ", lo: -6, hi: -6 }
    ];
    $("tgt-rows").innerHTML = rows.map(function (r) {
      var what, lv = r.key ? r.lufs : r.lo === r.hi ? r.lo : r.lo + " to " + r.hi;
      if (r.key) {
        var g = gain(r.key), d = a.lufs - r.lufs;
        what = g == null ? "" : g < -0.05 ? "Turned down <b>" + (-g).toFixed(1) + " dB</b>" : g > 0.05 ? "Turned up <b>" + g.toFixed(1) + " dB</b>" : d < -0.05 ? "Plays as is, " + (-d).toFixed(1) + " dB under (not turned up)" : "Plays as is";
      } else {
        what = a.lufs > r.hi + 0.05 ? (a.lufs - r.hi).toFixed(1) + " dB louder" : a.lufs < r.lo - 0.05 ? "<b>" + (r.lo - a.lufs).toFixed(1) + " dB</b> quieter" : "On target";
      }
      var pk = r.tp == null ? '<span style="color:var(--dim)">-</span>' : a.truePeak <= r.tp + 0.005 ? '<span class="ok">OK</span>' : '<span class="bad">' + (a.truePeak - r.tp).toFixed(1) + " dB over</span>";
      return "<tr><td>" + esc(r.label) + '</td><td class="num">' + lv + '</td><td class="num">' + (r.tp == null ? "-" : r.tp) + "</td><td>" + what + "</td><td>" + pk + "</td></tr>";
    }).join("");
    $("tgt-note").textContent = "Your master measures " + a.lufs.toFixed(1) + " LUFS integrated and " + a.truePeak.toFixed(1) + " dBTP. Streaming rows use each service's published normalization (the same rules as the table above); hip-hop and club rows are typical release levels, not a service turning it down.";
  }

'''

APP_EDITS = [
    ('.chainlist{font-size:13px;color:var(--dim);margin:0;padding-left:18px}.chainlist li{margin:4px 0}.chainlist b{color:var(--txt);font-weight:500}\n',
     '.chainlist{font-size:13px;color:var(--dim);margin:0;padding-left:18px}.chainlist li{margin:4px 0}.chainlist b{color:var(--txt);font-weight:500}\n' + CSS),
    ('    <button class="go" id="go">MASTER IT</button>\n',
     PLUGS_HTML + '\n    <button class="go" id="go">MASTER IT</button>\n'),
    ('    <div class="status" id="plat-note"></div>\n',
     '    <div class="status" id="plat-note"></div>\n\n' + TARGETS_HTML),
    ('  // ---------------------------------------------------------------- controls\n',
     PLUG_JS + '  // ---------------------------------------------------------------- controls\n'),
    ('    if ($("width").dataset.touched) opts.width = +$("width").value;\n',
     '    if ($("width").dataset.touched) opts.width = +$("width").value;\n'
     '    var pg = pluginOpts(); Object.keys(pg).forEach(function (k) { opts[k] = pg[k]; });\n'),
    ('    $("chain").innerHTML = [\n', '    $("chain").innerHTML = withPlugins(s, report, [\n'),
    ('    ].map(function (t) { return "<li>" + t + "</li>"; }).join("");\n  }\n',
     '    ]).map(function (t) { return "<li>" + t + "</li>"; }).join("");\n  }\n'),
    ('      highlightPlat();\n    });\n  }\n  function highlightPlat()',
     '      highlightPlat();\n      renderTargets(m);\n    });\n  }\n  function highlightPlat()'),
]


def apply(path, edits):
    s = path.read_text(encoding="utf-8")
    changed = False
    for old, new in edits:
        if new.startswith(old):
            added = new[len(old):]
        elif new.endswith(old):
            added = new[:-len(old)]
        else:
            added = None
        if new in s or (added and added in s):
            continue
        if s.count(old) != 1:
            raise SystemExit(f"rb-mastering-studio: {path.name}: anchor found {s.count(old)} times: {old[:70]!r}")
        s = s.replace(old, new)
        changed = True
    return s, changed


dsp_p, app_p = one("*-dsp.txt"), one("*-app.html")
dsp, dsp_changed = apply(dsp_p, DSP_EDITS)
app, app_changed = apply(app_p, APP_EDITS)
if "</script" in dsp.lower():
    raise SystemExit("rb-mastering-studio: the DSP text would contain </script and break the page")
if dsp_changed:
    dsp_p.write_text(dsp, encoding="utf-8")
if app_changed:
    app_p.write_text(app, encoding="utf-8")
if dsp_changed or app_changed:
    print("rb-mastering-studio: plug-ins added (" + ", ".join(n for n, c in (("engine", dsp_changed), ("page", app_changed)) if c) + ")")
else:
    print("rb-mastering-studio: plug-ins already in place")
