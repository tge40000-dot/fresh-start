/**
 * RB's email Worker (Cloudflare Email Routing sends mail for an RB address here).
 *
 * It replaces Cloudflare's sample Worker, which bounced every message with "Address not allowed" because it only
 * accepted mail from friend@example.com and coworker@example.com. All 220 messages it received (16-22 Sep 2026) bounced.
 *
 * Now it forwards every message to FORWARD_TO: one or more addresses, comma-separated, set as a variable on this Worker.
 * Each must be a verified destination under Email Routing > Destination addresses. Until FORWARD_TO is set, senders get
 * a clear bounce instead of the message vanishing. Optional BLOCK: comma-separated addresses or @domains to refuse.
 */
const list = (v) => String(v || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

export default {
  async email(message, env) {
    const from = String(message.from || "").toLowerCase();
    if (list(env.BLOCK).some((b) => (b.startsWith("@") ? from.endsWith(b) : from === b))) {
      message.setReject("This address doesn't accept mail from you.");
      return;
    }
    const to = list(env.FORWARD_TO);
    if (!to.length) {
      console.warn("rb-email: FORWARD_TO isn't set; bounced a message to " + message.to);
      message.setReject("This mailbox isn't set up yet. Please contact Relentless Billionaire through relentlessbillionaire.com.");
      return;
    }
    let delivered = 0;
    for (const dest of to) {
      try { await message.forward(dest); delivered++; }
      catch (e) { console.error("rb-email: couldn't forward to " + dest + ": " + (e && e.message)); }
    }
    if (!delivered) message.setReject("We couldn't deliver your message right now. Please try again later.");
  },
};
