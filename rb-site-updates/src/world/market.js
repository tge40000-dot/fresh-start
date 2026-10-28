// The market (📈 in the phone): what's happening in the city this half hour, the cost of living like a billionaire and
// how much heat your expansion draws. All game money; the events are made up (empire_defs.js MARKET), not real news.
//   - Market events: every half hour, the same for everyone. They change how many customers some businesses get
//     (empire.js figures()) for that half hour: a boom, a festival, a storm, an inspection.
//   - Lifestyle: the richer you are, the more it costs to keep it up (house, staff, cars, security): 0.01% a minute
//     of your net worth above $250,000, taken every minute.
//   - Heat: buying lots, claiming nodes and hostile takeovers in a hurry draws attention. It cools by itself; while it's
//     high there's a chance of a tax audit each minute (a fine of 3% of your net worth, at most $250,000).
import { on } from "./empire.js";
import { marketAt, MARKET_SLOT_MIN } from "./empire_defs.js";

const SAVE = "rb_market_v1";
const LIFE_FROM = 250000, LIFE_RATE = 0.0001, HEAT_AUDIT = 60;
const HEAT = { buy: 12, build: 4, "node-claim": 15, offer: 6, takeover: 20 };
const money = (n) => "$" + Math.round(n).toLocaleString("en-US");

export function initMarket(E, ctx) {
  const P = ctx.player;
  const S = (() => { try { return Object.assign({ heat: 0, life: 0, audits: [] }, JSON.parse(localStorage.getItem(SAVE) || "{}")); } catch (e) { return { heat: 0, life: 0, audits: [] }; } })();
  const keep = () => { try { localStorage.setItem(SAVE, JSON.stringify(S)); } catch (e) {} };
  const out = { S, open, now: () => marketAt(Date.now()), lifestyle: () => Math.max(0, P.netWorth - LIFE_FROM) * LIFE_RATE * 60 };
  for (const [ev, h] of Object.entries(HEAT)) on(ev, () => { S.heat = Math.min(100, S.heat + h); keep(); if (S.heat >= HEAT_AUDIT && S.heat - h < HEAT_AUDIT) E.toast("🔥 Heat is high: you're expanding fast. Expect a tax audit unless you cool off.", true); });

  // a new market event: say so once
  let slot = marketAt(Date.now()).slot;
  setInterval(() => {
    const m = marketAt(Date.now());
    if (m.slot !== slot) { slot = m.slot; if (m.k !== 1) E.toast(`📈 Market: ${m.text} (${m.k > 1 ? "+" : "−"}${Math.round(Math.abs(m.k - 1) * 100)}% customers for ${MARKET_SLOT_MIN} minutes).`); }
  }, 15000);
  setTimeout(() => { const m = marketAt(Date.now()); if (m.k !== 1) E.toast(`📈 Market: ${m.text}.`); }, 12000);

  // every minute: the cost of living, heat cooling, maybe an audit
  setInterval(() => {
    const life = Math.max(0, P.netWorth - LIFE_FROM) * LIFE_RATE;
    if (life >= 1) { P.netWorth -= life; S.life += life; }
    if (S.heat >= HEAT_AUDIT && Math.random() < 0.3) {
      const fine = Math.min(250000, Math.round(P.netWorth * 0.03));
      P.netWorth = Math.max(0, P.netWorth - fine); S.heat = Math.max(0, S.heat - 40);
      S.audits.unshift({ at: Date.now(), fine }); S.audits = S.audits.slice(0, 5);
      E.toast(`🧾 Tax audit: fined ${money(fine)} for expanding too fast.`, true); ctx.play && ctx.play("alert");
    }
    S.heat = Math.max(0, S.heat - 2);
    keep(); ctx.sync && ctx.sync();
  }, 60000);

  function open() {
    const m = marketAt(Date.now()), next = marketAt(m.ends + 1000), mins = Math.max(1, Math.round((m.ends - Date.now()) / 60000));
    const heatCol = S.heat >= HEAT_AUDIT ? "#ff5252" : S.heat >= 35 ? "#ffb000" : "#38d27a";
    E.panel(`<h2>📈 MARKET</h2>
      <div class="rb-card" style="display:block"><b>Now</b><div class="rb-muted">${m.text}${m.k !== 1 ? ` · ${m.k > 1 ? "+" : "−"}${Math.round(Math.abs(m.k - 1) * 100)}% customers` : ""} · ${mins} min left</div>
        <div class="rb-muted">Next: ${next.text}${next.k !== 1 ? ` (${next.k > 1 ? "+" : "−"}${Math.round(Math.abs(next.k - 1) * 100)}%)` : ""}</div></div>
      <div class="rb-card" style="display:block"><b>Lifestyle</b><div class="rb-muted">${P.netWorth > LIFE_FROM ? `About ${money(out.lifestyle())} an hour to keep up your life at ${money(P.netWorth)} (0.01% a minute of everything over ${money(LIFE_FROM)}).` : `Free until you're worth ${money(LIFE_FROM)}.`} Paid so far: ${money(S.life)}.</div></div>
      <div class="rb-card" style="display:block"><b>Heat</b><div style="height:8px;border-radius:4px;background:rgba(255,255,255,.12);overflow:hidden;margin:6px 0"><i style="display:block;height:100%;width:${Math.round(S.heat)}%;background:${heatCol}"></i></div>
        <div class="rb-muted">Buying lots, claiming nodes and takeover bids in a hurry raise it; it cools by itself. Over ${HEAT_AUDIT}%, a tax audit can come any minute.${S.audits.length ? ` Last audit: ${money(S.audits[0].fine)}.` : ""}</div></div>
      <div class="rb-muted" style="font-size:10px">The events are part of the game, not real news. All money in the game is game money.</div>
      <button class="btn-ghost" data-e="x">CLOSE</button>`, { x: E.hidePanel });
  }
  return out;
}
