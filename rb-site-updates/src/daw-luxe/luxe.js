// RB Studio luxe (patch_daw_luxe.py): a value box at the end of every slider, in real units, plus fine control.
// Type a value and press Enter, use the arrow keys (Shift for x10), or drag up/down on the box. Shift-drag a slider for
// fine moves; double-click or Alt-click a slider to reset it. Changes go through the slider's own events, so undo,
// saving and the audio engine see them exactly as a normal drag.
var RBK = [
  [/master volume$/, "gain", .85], [/ (volume|vol)$/, "gain", .8], [/ pan$/, "pan", 0], [/ (low|mid|high)$/, "db", 0],
  [/ (comp|reverb|delay)$/, "pct", 0], [/gate threshold$/, "db", -50], [/sibilance threshold$/, "db", -30],
  [/air boost$/, "db", 4], [/low cut frequency$/, "hz", 80], [/sibilance frequency$/, "hz", 6500],
  [/drive amount$/, "pct", .4], [/drive mix$/, "pct", 1], [/phone drive$/, "pct", .3], [/double amount$/, "pct", .5],
  [/crunch bits$/, "bits", 8], [/crunch rate divider$/, "div", 4],
];
function rbKind(r) {
  let a = (r.getAttribute("aria-label") || "").toLowerCase();
  for (let [re, k, d] of RBK) if (re.test(a)) return { k, d };
  return { k: "num", d: null };
}
function rbFmt(k, v) {
  let sg = (x, n) => (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toFixed(n);
  if (k === "gain") return v <= .001 ? "−∞ dB" : sg(20 * Math.log10(v), 1) + " dB";
  if (k === "pan") { let p = Math.round(v * 100); return p ? (p < 0 ? "L " : "R ") + Math.abs(p) : "C"; }
  if (k === "db") return sg(v, Math.abs(v) % 1 ? 1 : 0) + " dB";
  if (k === "pct") return Math.round(v * 100) + "%";
  if (k === "hz") return v >= 1e3 ? (v / 1e3).toFixed(2) + " kHz" : Math.round(v) + " Hz";
  if (k === "bits") return v + "-bit";
  if (k === "div") return "÷" + v;
  return String(+(+v).toFixed(3));
}
function rbParse(k, s) {
  s = String(s).trim().toLowerCase().replace(/−/g, "-").replace(/,/g, ".");
  let n = parseFloat(s.replace(/[^0-9.+-]/g, ""));
  if (k === "gain") return /inf|∞/.test(s) ? 0 : isNaN(n) ? null : Math.pow(10, n / 20);
  if (k === "pan") {
    if (/^c/.test(s)) return 0;
    if (isNaN(n)) return null;
    n = Math.abs(n) > 1 ? n / 100 : n;
    return /^l/.test(s) ? -Math.abs(n) : /^r/.test(s) ? Math.abs(n) : n;
  }
  if (isNaN(n)) return null;
  if (k === "pct") return n / 100;
  if (k === "hz") return /k/.test(s) ? n * 1e3 : n;
  return n;
}
function rbSnap(r, v) {
  let mn = +r.min, mx = +r.max, st = +r.step || 1;
  v = Math.min(mx, Math.max(mn, v));
  v = mn + Math.round((v - mn) / st) * st;
  let d = (String(r.step).split(".")[1] || "").length;
  return +Math.min(mx, Math.max(mn, v)).toFixed(d);
}
function rbFill(r) {
  let mn = +r.min, mx = +r.max, p = mx > mn ? (100 * (+r.value - mn)) / (mx - mn) : 0, c = mn < 0 && mx > 0 ? (100 * -mn) / (mx - mn) : 0;
  r.style.setProperty("--a", Math.min(p, c).toFixed(2) + "%"), r.style.setProperty("--b", Math.max(p, c).toFixed(2) + "%");
}
var rbFocus = null;
// Set a slider as if the person had dragged it: pointerdown (undo mark), input (live), and change (commit) when done.
// A value that changes nothing does nothing (no undo point), so leaving a box or clicking Undo can't record a step.
function rbSet(r, v, commit) {
  v = rbSnap(r, v);
  if (v === +r.value && !r.rbBusy) return;
  if (!r.rbBusy) r.dispatchEvent(new PointerEvent("pointerdown", { bubbles: !0 })), (r.rbBusy = 1);
  r.value = String(v), r.dispatchEvent(new Event("input", { bubbles: !0 }));
  r.rbBox && (r.rbBox.value = rbFmt(r.rbK, v));
  clearTimeout(r.rbT);
  let done = () => { r.rbBusy = 0, r.dispatchEvent(new Event("change", { bubbles: !0 })); };
  commit ? done() : (r.rbT = setTimeout(done, 500));
}
function rbDecorate(r) {
  if (r.rbLuxe) return;
  r.rbLuxe = 1, r.classList.add("rb-r"), rbFill(r);
  let n = r.nextElementSibling;
  if (n && n.tagName === "SPAN" && n.textContent.trim()) return; // already shows its value (clip gain, fades)
  let { k, d } = rbKind(r), lab = r.getAttribute("aria-label") || "value",
    box = document.createElement("input");
  box.type = "text", box.className = "rb-val", box.inputMode = "decimal", box.spellcheck = !1, box.autocomplete = "off";
  box.setAttribute("aria-label", lab + " value"), (box.title = "Type a value, use the arrow keys, or drag up and down" + (d != null ? ". Double-click the slider to reset." : "."));
  box.value = rbFmt(k, +r.value), (r.rbBox = box), (r.rbK = k), (r.rbD = d);
  r.after(box);
  let back = () => (box.value = rbFmt(k, +r.value));
  box.addEventListener("focus", () => { (rbFocus = lab), box.select(); });
  box.addEventListener("blur", () => { rbFocus === lab && (rbFocus = null); });
  box.addEventListener("keydown", (e) => {
    let st = +r.step || 1, m = e.shiftKey ? 10 : 1;
    if (e.key === "Enter") { e.preventDefault(); let v = rbParse(k, box.value); v != null && rbSet(r, v, !0); back(), box.select(); }
    else if (e.key === "Escape") back(), box.select();
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") e.preventDefault(), rbSet(r, +r.value + (e.key === "ArrowUp" ? st : -st) * m), back(), box.select();
    e.stopPropagation(); // the studio's own shortcuts (Space, R, Delete...) stay out of the box
  });
  box.addEventListener("change", () => { let v = rbParse(k, box.value); v != null && rbSet(r, v, !0); back(); });
  // Drag up/down on the box: one step per 3 px (Shift: one step per 12 px).
  box.addEventListener("pointerdown", (e) => {
    if (document.activeElement === box || e.button !== 0) return;
    let y0 = e.clientY, v0 = +r.value, moved = !1, st = +r.step || 1;
    e.preventDefault(), box.setPointerCapture(e.pointerId);
    let mv = (ev) => {
      let dy = y0 - ev.clientY;
      if (!moved && Math.abs(dy) < 3) return;
      (moved = !0), document.body.classList.add("rb-scrub"), rbSet(r, v0 + Math.round(dy / (ev.shiftKey ? 12 : 3)) * st), back();
    }, up = () => {
      box.removeEventListener("pointermove", mv), box.removeEventListener("pointerup", up), box.removeEventListener("pointercancel", up);
      document.body.classList.remove("rb-scrub");
      moved ? (clearTimeout(r.rbT), (r.rbBusy = 0), r.dispatchEvent(new Event("change", { bubbles: !0 }))) : (box.focus(), box.select());
    };
    box.addEventListener("pointermove", mv), box.addEventListener("pointerup", up), box.addEventListener("pointercancel", up);
  });
  if (rbFocus === lab) requestAnimationFrame(() => { box.focus(), box.select(); });
}
function rbLuxe() {
  let scan = () => { for (let r of document.querySelectorAll('input[type="range"]')) rbDecorate(r); }, q = 0;
  new MutationObserver(() => { q || (q = requestAnimationFrame(() => { (q = 0), scan(); })); }).observe(document.body, { childList: !0, subtree: !0 });
  scan();
  document.addEventListener("input", (e) => {
    let r = e.target;
    if (r.rbLuxe) rbFill(r), r.rbBox && document.activeElement !== r.rbBox && (r.rbBox.value = rbFmt(r.rbK, +r.value));
  }, !0);
  // Reset: double-click a slider, or Alt-click it.
  let reset = (r) => r.rbD != null && rbSet(r, r.rbD, !0);
  document.addEventListener("dblclick", (e) => { e.target.rbLuxe && reset(e.target); });
  // Fine: Shift-drag moves a tenth as far as a normal drag.
  document.addEventListener("pointerdown", (e) => {
    let r = e.target;
    if (!r.rbLuxe || e.button !== 0) return;
    // The reset makes its own undo point, so the press itself must not reach the studio (it would add a second one).
    if (e.altKey) return e.preventDefault(), e.stopPropagation(), reset(r);
    if (!e.shiftKey) return;
    // This press reaches the studio and makes the undo point; the moves below then only set values.
    e.preventDefault(), r.setPointerCapture(e.pointerId), (r.rbBusy = 1);
    let x0 = e.clientX, v0 = +r.value, w = r.getBoundingClientRect().width || 1, span = +r.max - +r.min;
    let mv = (ev) => rbSet(r, v0 + ((ev.clientX - x0) / w) * span * .1),
      up = () => { r.removeEventListener("pointermove", mv), r.removeEventListener("pointerup", up), clearTimeout(r.rbT), r.rbBusy && ((r.rbBusy = 0), r.dispatchEvent(new Event("change", { bubbles: !0 }))); };
    r.addEventListener("pointermove", mv), r.addEventListener("pointerup", up);
  }, !0);
}
