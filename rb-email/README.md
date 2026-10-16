# rb-email

`rb-email` was Cloudflare's unedited sample email Worker. It only accepted mail from `friend@example.com` and `coworker@example.com`, so it bounced everything else with "Address not allowed". It received 220 messages between 16 and 22 Sep 2026, and all of them bounced. Nothing has reached it since: the Email Routing rule that pointed at it seems to have been changed or turned off.

`src/index.js` replaces it with a forwarder:
- Every message goes to each address in **`FORWARD_TO`**, a comma-separated variable on the Worker. Each address must be a verified destination under Email Routing → Destination addresses.
- If one destination fails, the others still get the message.
- Until `FORWARD_TO` is set, senders get a clear bounce instead of the message vanishing.
- Optional **`BLOCK`**: comma-separated addresses or `@domains` to refuse.

To use it:
1. In Cloudflare, go to **Workers & Pages → rb-email → Settings → Variables**. Add `FORWARD_TO` with the inbox to forward to, as a plain-text variable.
2. Under **Email → Email Routing → Routing rules** for relentlessbillionaire.com, point the address(es) you want at **Send to a Worker → rb-email**.

`test/test.mjs` runs it against fake messages.
