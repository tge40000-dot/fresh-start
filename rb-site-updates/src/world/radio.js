// RB World's car radio: RB Radio live in every car. Everyone hears the same song at the same moment, and live shows
// come through when RB goes on air. It drives the station player every RB site uses (window.RBRadio from
// /radio/embed.js; the page is its host, so no radio bar is drawn over the game).
// - 📻 or M turns it on and off; the slider sets its volume; what's on shows next to it (● LIVE for a show).
// - While it plays, the game's theme music stops and the engine and city sounds dip so the music comes through.
// - A new song shows as a toast. Settings > Global Radio hides it; RB Command > RB World > Car radio switches it
//   off for everyone (window.RB_WORLD_CFG.radio).
const KEY = "rb_world_radio";
const pref = { get: () => { try { return localStorage.getItem(KEY) || "on"; } catch (e) { return "on"; } }, set: (v) => { try { localStorage.setItem(KEY, v); } catch (e) {} } };

export function initRadio(E, ctx) {
  const cfg = window.RB_WORLD_CFG || { radio: true };
  const bar = document.getElementById("radio-bar"), btn = document.getElementById("btn-radio"), track = document.getElementById("radio-track"),
    vol = document.getElementById("radio-vol"), sel = document.getElementById("set-radio");
  const out = { enabled: !!cfg.radio, playing: false, label: "", toggle() {} };
  if (!bar || !btn) return out;
  if (!cfg.radio) { bar.hidden = true; if (sel) sel.closest(".form-group").hidden = true; return out; }
  let R = null, lastSong = null, shown = pref.get() !== "off";
  const show = (on) => { shown = on; bar.hidden = !on; if (sel) sel.value = on ? "on" : "off"; if (!on && R && R.state().playing) R.pause(); };
  show(shown);
  if (sel) sel.onchange = () => { pref.set(sel.value); show(sel.value === "on"); };
  const label = (s) => s.live ? "● LIVE · " + (s.live.title || "RB Radio") + (s.live.host ? " · " + s.live.host : "")
    : s.on_air ? s.on_air.title + (s.on_air.artist ? " · " + s.on_air.artist : "") : "RB Radio";
  function paint(s) {
    const playing = !!(s && s.playing);
    out.playing = playing; out.label = s ? label(s) : "";
    btn.setAttribute("aria-pressed", playing ? "true" : "false");
    bar.classList.toggle("on", playing); bar.classList.toggle("live", !!(s && s.live));
    track.textContent = !s || !s.ready ? "Tuning in…" : playing || s.loading ? out.label : "Press 📻 for RB Radio";
    if (vol && document.activeElement !== vol) vol.value = String(s && s.volume != null ? s.volume : 1);
    ctx.music && ctx.music(!playing);
    window.RBAudio && window.RBAudio.duck && window.RBAudio.duck(playing ? 0.5 : 1);
    const song = s && (s.live ? "live:" + (s.live.title || "") : s.on_air ? s.on_air.id : null);
    if (playing && song && song !== lastSong && E.toast) E.toast("📻 " + out.label);
    if (playing) lastSong = song;
  }
  function hook() {
    if (R || !window.RBRadio) return;
    R = window.RBRadio;
    R.subscribe(paint);
  }
  out.toggle = () => { if (!R) { track.textContent = "Tuning in…"; return; } if (!shown) show(true); R.toggle(); };
  btn.addEventListener("click", out.toggle);
  if (vol) vol.addEventListener("input", () => { if (R) R.volume(Number(vol.value)); });
  window.addEventListener("keydown", (e) => { if (e.code === "KeyM" && !e.repeat && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "")) out.toggle(); });
  if (window.RBRadio) hook(); else window.addEventListener("rbradio:ready", hook, { once: true });
  return out;
}
