// Deals between players (🤝 in the phone, and on another player's lot): make an offer to buy their lot, or a hostile
// takeover bid (at least 1.5x what the lot is worth). The owner can accept or decline; a takeover nobody answers goes
// through after a day if the lot is empty, while a lot with a business can only be bought. The server checks every
// step (world-worker.js) and moves the money: what you're owed (a sale, a node taken from you, a walking streak) comes
// in with the next beat, once.
import { api, onBeat } from "./rb_world.js";
import { lotValue, TAKEOVER_MIN, DEAL_OFFER_H, DEAL_TAKEOVER_H } from "./empire_defs.js";

const money = (n) => "$" + Math.round(n).toLocaleString("en-US");
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const STATUS = { open: "open", accepted: "accepted", won: "went through (no answer)", declined: "declined", cancelled: "cancelled", lapsed: "lapsed", closed: "closed (the lot was sold)", gone: "the lot changed hands" };

export function initDeals(E, ctx) {
  const P = ctx.player;
  const out = { deals: [], open, offer, refresh };
  let seen = new Set(), first = true;

  // money and tokens owed to you, from the server
  onBeat((d) => {
    for (const s of d.settle || []) {
      P.netWorth = Math.max(0, P.netWorth + (s.cash || 0)); P.tokens = Math.max(0, (P.tokens || 0) + (s.tokens || 0));
      ctx.sync && ctx.sync(); if (s.cash > 0 || s.tokens > 0) ctx.play && ctx.play("cash");
      E.toast(`${s.note || "Payment"}: ${s.cash ? (s.cash > 0 ? "+" : "−") + money(Math.abs(s.cash)) : ""}${s.tokens ? ` +${s.tokens} tokens` : ""}`);
    }
  });
  async function refresh() {
    try {
      const d = await api("/api/world/deal", { id: P.id, name: P.name, op: "list" });
      out.deals = d.deals || [];
      for (const x of out.deals) {
        if (!x.mine && x.status === "open" && !seen.has(x.id) && !first) E.toast(`🤝 ${x.from} ${x.kind === "takeover" ? "made a takeover bid of" : "offered"} ${money(x.amount)} for your lot ${x.lot}. Open 🤝 Deals.`, true);
        seen.add(x.id);
      }
      first = false;
    } catch (e) {}
  }
  setInterval(refresh, 60000); setTimeout(refresh, 8000);

  // from another player's lot (empire.js)
  function offer(l, s, kind) {
    const worth = lotValue(l.id, s.business, s.level), min = kind === "takeover" ? Math.ceil(worth * TAKEOVER_MIN) : 1000, start = kind === "takeover" ? min : worth;
    E.panel(`<h2>${kind === "takeover" ? "⚔️ HOSTILE TAKEOVER" : "🤝 MAKE AN OFFER"} · LOT ${l.id}</h2>
      <div class="rb-muted">Owner <b>${esc(s.owner_name)}</b>. It's worth about <b>${money(worth)}</b> (the deed${s.business ? ", the business and its upgrades" : ""}).</div>
      <div class="rb-muted">${kind === "takeover" ? `A takeover bid starts at ${money(min)}. If ${esc(s.owner_name)} doesn't answer within ${DEAL_TAKEOVER_H} hours ${s.business ? "the bid lapses: a lot with a business can only be sold" : "it goes through anyway: the lot is empty"}.` : `${esc(s.owner_name)} has ${DEAL_OFFER_H} hours to accept.`} Nothing is paid unless it goes through.</div>
      <label class="rb-muted" style="display:block;margin:10px 0 4px">Your offer ($)</label>
      <input id="rb-deal-amt" type="number" inputmode="numeric" min="${min}" step="500" value="${start}" style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.4);color:#fff;font:700 15px Inter,sans-serif">
      <button class="btn-gold" data-e="send">SEND ${kind === "takeover" ? "BID" : "OFFER"}</button><button class="btn-ghost" data-e="x">CANCEL</button>`,
      { x: E.hidePanel, send: async () => {
        const amount = Math.round(Number(document.getElementById("rb-deal-amt").value));
        if (!(amount >= min)) return E.toast(`At least ${money(min)}.`, true);
        if (amount > P.netWorth) return E.toast("You don't have that much.", true);
        try { const d = await api("/api/world/deal", { id: P.id, name: P.name, op: kind, lot: l.id, amount }); E.toast(`${kind === "takeover" ? "⚔️ Takeover bid" : "🤝 Offer"} sent to ${s.owner_name}: ${money(amount)}.`); E.emit(kind === "takeover" ? "takeover" : "offer", l.id); E.hidePanel(); refresh(); }
        catch (e) { E.toast(e.message, true); }
      } });
  }
  async function act(op, deal) {
    try { await api("/api/world/deal", { id: P.id, name: P.name, op, deal }); E.toast(op === "accept" ? "🤝 Done: the money comes in with the next update." : op === "decline" ? "Declined." : "Bid withdrawn."); }
    catch (e) { E.toast(e.message, true); }
    await refresh(); open();
  }

  // the 🤝 app
  async function open() {
    await refresh();
    const left = (x) => { const h = Math.max(0, (x.expires - Date.now()) / 3600e3); return h >= 1 ? Math.round(h) + " h left" : Math.max(1, Math.round(h * 60)) + " min left"; };
    const incoming = out.deals.filter((x) => !x.mine && x.status === "open"), outgoing = out.deals.filter((x) => x.mine && x.status === "open"), done = out.deals.filter((x) => x.status !== "open").slice(0, 8);
    const acts = { x: E.hidePanel };
    const card = (x, btns) => `<div class="rb-card"><div><b>${x.kind === "takeover" ? "⚔️" : "🤝"} Lot ${x.lot} · ${money(x.amount)}</b><div class="rb-muted">${x.mine ? "to " + esc(x.to) : "from " + esc(x.from)} · ${x.kind === "takeover" ? "takeover bid" : "offer"} · ${x.status === "open" ? left(x) : STATUS[x.status] || x.status}</div></div>${btns}</div>`;
    const inc = incoming.map((x) => { acts["a" + x.id] = () => act("accept", x.id); acts["d" + x.id] = () => act("decline", x.id); return card(x, `<div><button class="rb-btn" data-e="a${x.id}">ACCEPT</button> <button class="btn-ghost" data-e="d${x.id}">DECLINE</button></div>`); }).join("");
    const outg = outgoing.map((x) => { acts["c" + x.id] = () => act("cancel", x.id); return card(x, `<button class="btn-ghost" data-e="c${x.id}">WITHDRAW</button>`); }).join("");
    E.panel(`<h2>🤝 DEALS</h2><div class="rb-muted">Stop by another player's lot to make an offer or a takeover bid. Offers for your lots show up here.</div>
      <h3 style="font:800 11px Inter,sans-serif;color:var(--gold);letter-spacing:2px;margin:14px 0 6px">FOR YOUR LOTS</h3>${inc || '<div class="rb-muted">Nothing waiting.</div>'}
      <h3 style="font:800 11px Inter,sans-serif;color:var(--gold);letter-spacing:2px;margin:14px 0 6px">YOUR BIDS</h3>${outg || '<div class="rb-muted">None open.</div>'}
      ${done.length ? `<h3 style="font:800 11px Inter,sans-serif;color:var(--gold);letter-spacing:2px;margin:14px 0 6px">RECENT</h3>${done.map((x) => card(x, "")).join("")}` : ""}
      <button class="btn-ghost" data-e="x">CLOSE</button>`, acts);
  }
  return out;
}
