// Who's playing, and their saved game, so a player always comes back to the same empire.
//   - Signed in with an RB account: the account's one player, on any device. The first time, that's your best player
//     from before, or the guest player on this device (what you built as a guest comes with you).
//   - Not signed in: this device's guest player, the same every visit (rb_world.js keeps its id and key).
//   - The saved game (money, tokens, empire, progress, customs, story, wardrobe, attachments, ...) goes to RB every 30
//     seconds and when you leave, and comes back when you start: on another device for an account, or after signing
//     out and back in. Settings that belong to the device (graphics, screen, radio, camera) stay on the device.
import { api, device, setDeviceId, clerkReady } from "./rb_world.js";

const META = "rb_world_save_meta"; // { id, at: when RB last saved it, local: when this device last changed it, dirty, money }
export const SAVE_KEYS = ["rb_empire_v1", "rb_progress_v1", "rb_customs_v1", "rb_story_v1", "rb_world_look", "rb_world_attach", "rb_traps_v1", "rb_state", "rb_investments", "rb_world_18", "rb_world_combat"];
const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} },
};
const readMeta = () => { try { return JSON.parse(ls.get(META) || "{}") || {}; } catch (e) { return {}; } };
const writeMeta = (m) => ls.set(META, JSON.stringify(m));

export async function whoAmI() {
  const c = await clerkReady();
  const d = device();
  const w = await api("/api/world/me", { id: d.id });
  if (!w.signedIn && w.id !== d.id) setDeviceId(w.id); // this device's old player is an account's now: a fresh guest
  const u = c && c.user;
  const email = u ? (u.primaryEmailAddress && u.primaryEmailAddress.emailAddress) || u.username || "" : "";
  if (c && c.addListener) { let was = !!u; c.addListener((e) => { const now = !!(e && e.user); if (now !== was) { was = now; location.reload(); } }); }
  return { ...w, clerk: !!c, email, first: u ? u.firstName || u.username || "" : "" };
}
export async function signIn() { const c = await clerkReady(10000); if (c) c.openSignIn({ afterSignInUrl: location.href, afterSignUpUrl: location.href }); return !!c; }
export async function signOut() { const c = await clerkReady(10000); if (c) await c.signOut(); location.reload(); }

// Before the game starts: put this player's saved game in place, and say what money and tokens they have (or null
// for the defaults).
export function applySave(w) {
  const meta = readMeta(), mine = meta.id === w.id;
  let data = null; try { data = w.save && JSON.parse(w.save.data); } catch (e) {}
  if (data && data.keys && !(mine && meta.dirty && meta.local > w.save.at)) {
    for (const k of SAVE_KEYS) ls.set(k, data.keys[k] == null ? null : String(data.keys[k]));
    writeMeta({ id: w.id, at: w.save.at, local: w.save.at, dirty: false, money: data.money || null });
    return data.money || null;
  }
  if (mine) return meta.money || null; // this device has the newest
  // a player this device hasn't played before: their own fresh start, not the last player's game (on the first visit
  // after this update there's no last player, so the game already on this device becomes theirs)
  if (meta.id) for (const k of SAVE_KEYS) ls.set(k, null);
  const money = w.netWorth != null ? { netWorth: w.netWorth, tokens: w.tokens } : null;
  writeMeta({ id: w.id, at: 0, local: Date.now(), dirty: true, money });
  return money;
}

// While playing: save to RB when something changed (every 30 seconds, and when the tab is hidden or closed).
export function startSaving(id, money) {
  let last = "";
  async function push() {
    const keys = {}; for (const k of SAVE_KEYS) { const v = ls.get(k); if (v != null) keys[k] = v; }
    const m = money(), str = JSON.stringify({ v: 1, money: m, keys });
    if (str === last) return;
    writeMeta({ ...readMeta(), id, local: Date.now(), dirty: true, money: m });
    try { const r = await api("/api/world/save", { id, data: str }); last = str; writeMeta({ id, at: r.at, local: r.at, dirty: false, money: m }); } catch (e) {}
  }
  setTimeout(push, 5000); setInterval(push, 30000);
  document.addEventListener("visibilitychange", () => { if (document.hidden) push(); });
  return { push };
}
