// RB Gold Rush: the round plan, shared word for word by the server (badge-worker.js, to check a score) and the RB app
// page (app.html, to draw the round). Plain script, no imports: patch_badge.py pastes it into both.
// A round is RBG_MS long. Everything that falls comes from the seed the server hands out, so the server knows the
// highest score a round could reach and refuses anything above it.
var RBG_MS = 45000;
var RBG_KINDS = { gold: 10, diamond: 25, bomb: -15 };
function rbgRandom(seed) {
  var a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Each item: when it starts falling (ms into the round), across (0 to 1), what it is, its points and its speed
// (screen heights per second). Items come faster and fall faster as the round goes on.
function rbgPlan(seed) {
  var r = rbgRandom(seed), out = [], t = 600;
  while (t < RBG_MS - 1500) {
    var p = t / RBG_MS, roll = r(), kind = roll < 0.07 ? "diamond" : roll < 0.23 ? "bomb" : "gold";
    out.push({ t: Math.round(t), x: Math.round((0.06 + r() * 0.88) * 1000) / 1000, kind: kind, value: RBG_KINDS[kind], speed: Math.round((0.32 + p * 0.3 + r() * 0.12) * 1000) / 1000 });
    t += 620 - p * 260 + r() * 180;
  }
  return out;
}
// The most a round can score: every gold and diamond caught, no bomb.
function rbgMax(seed) {
  return rbgPlan(seed).reduce(function (n, it) { return n + Math.max(0, it.value); }, 0);
}
