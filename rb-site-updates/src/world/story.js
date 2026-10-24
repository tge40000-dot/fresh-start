// The story (📖 in the phone): "Rise of RB", five chapters played in order, each with a short talk from Vale (RB's
// fixer, a made-up character), one or two goals with a marker, the radar arrow and a chip saying what to do, and a
// reward in game money and tokens.
//   1. Fresh start: drive to a landmark across town before the clock runs out.
//   2. Street speed: four checkpoints against the clock.
//   3. Walk in like you own it: park up and walk into RB Plaza on foot.
//   4. Hold your ground: with combat on, a turf war; with it off, get away from two stars of police.
//   5. The briefcase: pick up a case across town, then get it to RB Plaza with three stars on you.
// Fail one (time up, busted, wasted, gave up) and you can try it again straight away. Progress is kept on this device.
import * as THREE from "three";
import { on } from "./empire.js";

const SAVE = "rb_story_v1";
const CHAPTERS = [
  { name: "Fresh start", icon: "🚗", pay: 5000, tokens: 25,
    talk: ["You made it. Welcome to the city. I'm Vale; I look after things for RB.", "First, show me you can drive. There's a landmark across town. Get there before the clock runs out."],
    steps: [{ t: "go", to: "landmark", min: 300, timed: true, within: 14 }],
    done: "Not bad. Next, let's see how quick you really are." },
  { name: "Street speed", icon: "🏁", pay: 8000, tokens: 40,
    talk: ["Speed is reputation here. Four checkpoints, one clock.", "Nitro (Shift) helps. Don't hit anyone you can't afford."],
    steps: [{ t: "checkpoints", n: 4, time: 80 }],
    done: "That's the kind of driving people talk about." },
  { name: "Walk in like you own it", icon: "🚶", pay: 6000, tokens: 30,
    talk: ["Nobody respects a face behind tinted glass.", "Park up, get out (F) and walk into RB Plaza. Let them see you."],
    steps: [{ t: "go", to: "plaza", foot: true, within: 14 }],
    done: "Good. Now they know who you are. Some of them won't like it." },
  { name: "Hold your ground", icon: "🛡️", pay: 12000, tokens: 60,
    talk: ["Told you. Someone's testing us.", "Deal with it however you deal with things. Just don't get caught."],
    steps: [{ t: "fight" }],
    done: "Handled. RB doesn't forget that." },
  { name: "The briefcase", icon: "💼", pay: 25000, tokens: 150,
    talk: ["Last job, and the big one. There's a briefcase waiting across town.", "Pick it up and bring it to RB Plaza. The police will be on you the moment you touch it."],
    steps: [{ t: "go", to: "far", min: 450, within: 5, what: "case" }, { t: "go", to: "plaza", within: 18, wanted: 3 }],
    done: "That's the rise of RB. The city is yours to build now." },
];
const load = () => { try { return Math.max(0, Math.min(CHAPTERS.length, Number(JSON.parse(localStorage.getItem(SAVE) || "{}").done) || 0)); } catch (e) { return 0; } };

export function initStory(E, ctx, foot, combat) {
  const car = E.car, CITY = E.city, P = ctx.player, scene = ctx.scene;
  let done = load(), cur = null; // cur: { n, step, s: step state }
  const out = { open, get done() { return done; }, get active() { return cur ? CHAPTERS[cur.n].name : null; }, CHAPTERS };

  const css = document.createElement("style");
  css.textContent = `#rb-story{position:fixed;left:50%;transform:translateX(-50%);top:calc(var(--rb-under,120px) + 78px);z-index:7000;display:none;background:rgba(20,14,0,.86);border:1px solid #C9A84C;border-radius:12px;padding:6px 14px;color:#fff;font:800 12px/1.3 Inter,sans-serif;text-align:center;pointer-events:none;max-width:86vw}
body.rb-photo #rb-story,body:has(#rb-phone.open) #rb-story{display:none!important}
.rb-talk{border-left:3px solid #C9A84C;padding:6px 10px;margin:8px 0;background:rgba(201,168,76,.08);border-radius:0 10px 10px 0;font-size:13px;line-height:1.45}.rb-talk b{color:#F5E6A3}`;
  document.head.appendChild(css);
  const chip = document.createElement("div"); chip.id = "rb-story"; document.body.appendChild(chip);

  // ---------------------------------------------------------------- the marker: a gold column where you're going
  let beacon = null, caseMesh = null;
  function setBeacon(p, color = 0xC9A84C) {
    if (beacon) { scene.remove(beacon); beacon = null; }
    window.__rbStoryTarget = p || null;
    if (!p) return;
    beacon = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 80, 18, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }));
    beacon.position.set(p[0], 40, p[1]); beacon.userData.noAO = true; scene.add(beacon);
  }
  function place(st) {
    const here = [car.x, car.z];
    if (st.to === "plaza") return st.foot ? [CITY.PLAZA[0], CITY.PLAZA[1]] : [CITY.START[0], CITY.START[1]];
    if (st.to === "landmark") {
      const ok = CITY.LANDMARKS.filter((l) => { const d = Math.hypot(l.at[0] - here[0], l.at[1] - here[1]); return d >= st.min && d <= 900; });
      if (ok.length) { const l = ok[Math.floor(Math.random() * ok.length)]; return Object.assign([l.at[0], l.at[1]], { name: l.name }); }
    }
    return CITY.roadPoint({ away: here, minFrom: st.min || 250, near: here, maxFrom: (st.min || 250) + 450 });
  }

  // ---------------------------------------------------------------- the panel
  function open() {
    const rows = CHAPTERS.map((c, i) => {
      const state = i < done ? "✅ DONE" : cur && cur.n === i ? "IN PROGRESS" : i === done ? "" : "🔒";
      const btn = cur && cur.n === i ? `<button class="rb-btn" data-e="quit">GIVE UP</button>` : i === done && !cur ? `<button class="rb-btn" data-e="go">PLAY</button>` : `<span class="rb-tag">${state}</span>`;
      return `<div class="rb-card"><div><b>${c.icon} Chapter ${i + 1}: ${c.name}</b><div class="rb-muted">Reward ${E.money(c.pay)} + ${c.tokens} tokens</div></div>${btn}</div>`;
    }).join("");
    E.panel(`<h2>📖 RISE OF RB</h2><div class="rb-muted">${done >= CHAPTERS.length ? "You've finished the story. The rewards are yours; the city is still there to build." : `Chapter ${done + 1} of ${CHAPTERS.length} is next.`}</div>${rows}<button class="btn-ghost" data-e="x">CLOSE</button>`,
      { x: E.hidePanel, go: () => talk(done), quit: () => { fail("You gave up."); open(); } });
  }
  function talk(n) {
    const c = CHAPTERS[n]; if (!c || cur) return;
    E.panel(`<h2>${c.icon} CHAPTER ${n + 1}: ${c.name.toUpperCase()}</h2>${c.talk.map((l) => `<div class="rb-talk"><b>Vale:</b> ${l}</div>`).join("")}
      <button class="btn-gold" data-e="go">LET'S GO</button><button class="btn-ghost" data-e="x">NOT NOW</button>`, { go: () => { E.hidePanel(); start(n); }, x: E.hidePanel });
  }

  // ---------------------------------------------------------------- playing a chapter
  function start(n) { cur = { n, step: -1 }; next(); }
  function next() {
    const c = CHAPTERS[cur.n]; cur.step++;
    if (cur.step >= c.steps.length) return finish();
    const st = c.steps[cur.step], s = (cur.s = { st, t: 0 });
    if (st.t === "go") {
      s.at = place(st); setBeacon(s.at, st.what === "case" ? 0xff8a3b : 0xC9A84C);
      if (st.timed) s.left = Math.round(Math.hypot(s.at[0] - car.x, s.at[1] - car.z) / 13 + 25);
      if (st.what === "case") { caseMesh = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.38, 0.16), new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.7, roughness: 0.3 })); caseMesh.position.set(s.at[0], 0.6, s.at[1]); scene.add(caseMesh); }
      if (st.wanted) E.setWanted(Math.max(E.wanted(), st.wanted));
      s.say = st.what === "case" ? "Pick up the briefcase" : st.to === "plaza" ? (st.foot ? "Walk into RB Plaza (on foot)" : cur.n === 4 ? "Get the briefcase to RB Plaza" : "Get to RB Plaza") : `Drive to ${s.at.name || "the marker"}`;
    } else if (st.t === "checkpoints") {
      s.k = 0; s.left = st.time; s.pts = []; let from = [car.x, car.z];
      for (let i = 0; i < st.n; i++) { const p = CITY.roadPoint({ away: from, minFrom: 140, near: from, maxFrom: 320 }); s.pts.push(p); from = p; }
      s.at = s.pts[0]; setBeacon(s.at); s.say = `Checkpoint 1 of ${st.n}`;
    } else if (st.t === "fight") {
      if (combat && combat.on) {
        if (combat.mission) return fail("Finish the combat mission you're on first.");
        combat.startMission("turf"); s.mode = "turf"; s.say = "Clear the crew off the corner"; setBeacon(null);
      } else { s.mode = "cops"; E.setWanted(Math.max(E.wanted(), 2)); s.say = "Lose the police"; setBeacon(null); }
    }
    E.toast(`📖 ${s.say}.`);
  }
  function finish() {
    const c = CHAPTERS[cur.n];
    P.netWorth += c.pay; P.tokens = (P.tokens || 0) + c.tokens; ctx.sync && ctx.sync(); ctx.play && ctx.play("cash");
    done = Math.max(done, cur.n + 1); try { localStorage.setItem(SAVE, JSON.stringify({ done })); } catch (e) {}
    E.emit("story", cur.n + 1);
    const n = cur.n; clear();
    E.panel(`<h2>✅ CHAPTER ${n + 1} DONE</h2><div class="rb-talk"><b>Vale:</b> ${c.done}</div><div class="rb-muted">+${E.money(c.pay)} and ${c.tokens} tokens.</div>
      ${n + 1 < CHAPTERS.length ? `<button class="btn-gold" data-e="go">NEXT: ${CHAPTERS[n + 1].name.toUpperCase()}</button>` : ""}<button class="btn-ghost" data-e="x">LATER</button>`,
      { go: () => talk(n + 1), x: E.hidePanel });
  }
  function fail(why) {
    if (!cur) return;
    const n = cur.n; clear();
    E.toast(`❌ ${CHAPTERS[n].name}: ${why} Open 📖 Story to try again.`, true);
  }
  function clear() { cur = null; setBeacon(null); chip.style.display = "none"; if (caseMesh) { scene.remove(caseMesh); caseMesh = null; } }

  on("busted", () => { if (cur) fail("Busted."); });
  if (combat) combat.onDeath.push(() => { if (cur) fail("Wasted."); });
  on("mission-done", (k) => { if (cur && cur.s && cur.s.mode === "turf" && k === "turf") next(); });

  // ---------------------------------------------------------------- every frame
  ctx.onFrame((dt) => {
    if (!cur || !cur.s) return;
    dt = Math.min(dt, 0.1);
    const s = cur.s, st = s.st; s.t += dt;
    if (s.left != null) { s.left -= dt; if (s.left <= 0) return fail("Out of time."); }
    if (caseMesh) caseMesh.rotation.y += dt * 2;
    if (beacon) beacon.material.opacity = 0.24 + Math.sin(s.t * 3) * 0.06;
    const d = s.at ? Math.hypot(s.at[0] - car.x, s.at[1] - car.z) : 0;
    if (st.t === "go" && d < st.within && (!st.foot || foot.on)) return next();
    if (st.t === "checkpoints" && d < 12 && !foot.on) {
      s.k++; ctx.play && ctx.play("cash", 0.25);
      if (s.k >= s.pts.length) return next();
      s.at = s.pts[s.k]; setBeacon(s.at); s.say = `Checkpoint ${s.k + 1} of ${s.pts.length}`;
    }
    if (st.t === "fight") {
      if (s.mode === "turf" && !combat.mission && s.t > 1) return fail("The crew held the corner.");
      if (s.mode === "cops" && E.wanted() === 0 && s.t > 2) return next();
    }
    // the chip: what to do, how far, which way and the clock
    let txt = `📖 ${s.say}`;
    if (s.at) {
      const ang = Math.atan2(s.at[0] - car.x, s.at[1] - car.z), view = foot.on ? foot.yaw : car.heading;
      let rel = ang - view; rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      txt += ` · ${Math.round(d)} m <span style="display:inline-block;transform:rotate(${(-rel * 180) / Math.PI}deg)">⬆</span>`;
    }
    if (st.t === "fight" && s.mode === "cops") txt += ` · ${"★".repeat(E.wanted())}`;
    if (s.left != null) txt += ` · <span style="color:${s.left < 10 ? "#ff6b6b" : "#F5E6A3"}">${Math.ceil(s.left)}s</span>`;
    chip.style.display = "block"; chip.innerHTML = txt;
  });
  return out;
}
