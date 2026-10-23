// RB World's connection to RB, in place of InstantDB. It offers the few InstantDB calls the game uses (init, id,
// joinRoom with presence and a chat topic, subscribeQuery for users and ads, tx.users[id].update and transact), so
// main.js plays the same, but everything goes to relentlessbillionaire.com/api/world/* (artist-router, waitlist-db):
//   POST /api/world/beat  every BEAT_MS: this player's state in; other players nearby, the leaderboard, new chat and,
//                         for signed-in RB Badge members, play-time points out
//   POST /api/world/chat  a chat message;  GET /api/world/ads  the ticker (live RB ads and upcoming RB events)
// Signed in with an RB account (Clerk, loaded through window.RBLoadClerk), play time earns RB Badge points.
const BEAT_MS = 4000;
const ADS_MS = 60000;

export function id() {
  return crypto.randomUUID ? crypto.randomUUID() : "p-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

let clerk = null;
function token() { return clerk && clerk.session ? clerk.session.getToken().catch(() => null) : Promise.resolve(null); }
// The same request helper, for the empire (lots and rent), and a way for it to hear each beat.
export function api(path, body) { return call(path, body); }
const beatHooks = [];
export function onBeat(cb) { beatHooks.push(cb); }
async function call(path, body) {
  const t = await token(), headers = { "Content-Type": "application/json" };
  if (t) headers.Authorization = "Bearer " + t;
  const res = await fetch(path, body ? { method: "POST", headers, body: JSON.stringify(body), credentials: "same-origin" } : { headers, credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || "RB World is unavailable right now.");
  return data;
}

// The small RB Badge chip in the corner: points from playing, or how to start earning them.
let chip = null;
function showChip(text, href) {
  if (!document.body) return;
  if (!chip) {
    chip = document.createElement("a");
    chip.id = "rb-badge-chip";
    chip.style.cssText = "position:fixed;left:12px;top:198px;z-index:7000;padding:7px 14px;border-radius:999px;background:rgba(5,5,5,.85);border:1px solid #C9A84C;color:#F5E6A3;font:700 11px/1.2 Inter,system-ui,sans-serif;letter-spacing:.06em;text-decoration:none;white-space:nowrap";
    document.body.appendChild(chip);
  }
  chip.textContent = text;
  chip.href = href || "/app";
  placeChip();
}
// Out of the way while the city chat is open (it fills the bottom of the screen).
function placeChip() {
  const chat = document.getElementById("chat-panel");
  if (chip) chip.style.display = chat && chat.classList.contains("open") ? "none" : "";
}
document.addEventListener("click", () => setTimeout(placeChip, 0), true);

export function init() {
  const state = { me: null, since: 0, peers: {}, board: [], online: true };
  const presence = [], topics = {}, queries = { users: [], ads: [] };
  let pending = {}, busy = false;
  const seen = new Set();

  async function beat() {
    if (!state.me || !state.me.id || busy) return;
    busy = true;
    try {
      const d = await call("/api/world/beat", { ...state.me, ...pending, since: state.since });
      pending = {};
      beatHooks.forEach((cb) => { try { cb(d); } catch (e) {} });
      state.peers = Object.fromEntries((d.peers || []).map((p) => [p.id, p]));
      presence.forEach((cb) => cb({ peers: state.peers }));
      for (const m of d.chat || []) {
        state.since = Math.max(state.since, m.n);
        if (seen.has(m.n)) continue;
        seen.add(m.n);
        (topics.chat || []).forEach((cb) => cb(m));
      }
      const users = Object.fromEntries((d.board || []).map((u) => [u.id, u]));
      queries.users.forEach((cb) => cb({ data: { users } }));
      if (!state.online) { state.online = true; offline(false); }
      if (d.points && d.points.member) showChip(d.points.added > 0 ? `+${d.points.added} RB Badge points · ${d.points.today} today` : `RB Badge · ${d.points.today} of ${d.points.daily} play points today`, "/app");
      else if (d.points && d.points.on) showChip("Sign in to earn RB Badge points while you play", "/app");
    } catch (e) {
      if (state.online) { state.online = false; offline(true); }
    } finally { busy = false; }
  }
  function offline(on) {
    const l = document.getElementById("lb-list");
    if (on && l && !l.children.length) l.innerHTML = '<div class="lb-item">Leaderboard offline</div>';
  }
  async function ads() {
    try {
      const d = await call("/api/world/ads");
      queries.ads.forEach((cb) => cb({ data: { ads: d.ads || [] } }));
    } catch (e) {}
  }
  setInterval(beat, BEAT_MS);
  setTimeout(beat, 600);
  ads(); setInterval(ads, ADS_MS);
  if (window.RBLoadClerk && window.RB_CLERK_KEY) window.RBLoadClerk(window.RB_CLERK_KEY).then((c) => { clerk = c; beat(); }).catch(() => {});

  const db = {
    joinRoom() {
      return {
        subscribePresence(_, cb) { presence.push(cb); },
        subscribeTopic(name, cb) { (topics[name] ||= []).push(cb); },
        publishPresence(p) { state.me = { ...(state.me || {}), ...p }; },
        publishTopic(name, msg) { if (name === "chat") call("/api/world/chat", { id: state.me && state.me.id, name: msg.author, text: msg.text }).catch((e) => alert(e.message)); },
      };
    },
    subscribeQuery(q, cb) { if (q.users) queries.users.push(cb); if (q.ads) queries.ads.push(cb); },
    // tx.users[id].update({...}): saved with the next beat. Other collections the old backend had are not used.
    tx: new Proxy({}, { get: (_, coll) => new Proxy({}, { get: (__, pid) => ({ update: (v) => ({ coll, pid, v }) }) }) }),
    transact(t) {
      if (t && t.coll === "users") { pending = { ...pending, ...t.v }; state.me = { ...(state.me || {}), id: t.pid, ...t.v }; }
      return Promise.resolve();
    },
  };
  return db;
}
