# rb-email

`rb-email` was Cloudflare's unedited sample email Worker. It only accepted mail from `friend@example.com` and `coworker@example.com`, so it bounced everything else with "Address not allowed". It received 220 messages between 16 and 22 Sep 2026, and all of them bounced. Nothing has reached it since: the Email Routing rule that pointed at it seems to have been changed or turned off.

`src/index.js` replaces it with a forwarder:
- Every message goes to each address in **`FORWARD_TO`**, a comma-separated variable on the Worker. Each address must be a verified destination under Email Routing → Destination addresses.
- If one destination fails, the others still get the message.
- Until `FORWARD_TO` is set, senders get a clear bounce instead of the message vanishing.
- Optional **`BLOCK`**: comma-separated addresses or `@domains` to refuse.

## Status

`FORWARD_TO` is set to `relentlessbillionaire@outlook.com` as a plain-text variable. It went live as version `97aac504` on 17 Oct 2026. The code is the same as `41329d2a`; only the variable is new. To undo, remove the variable, or roll back to `41329d2a`.

Mail won't reach the Worker until the owner finishes these steps in the Cloudflare dashboard. The API token used here can't change Email Routing or DNS.
1. **Email → Email Routing** for relentlessbillionaire.com: turn it on and accept Cloudflare's MX records. They replace the current MX, `inbound-smtp.us-east-1.amazonaws.com` (Amazon SES). Anything still reading mail through SES stops getting it.
2. **Destination addresses**: add `relentlessbillionaire@outlook.com`. Then open Cloudflare's verification email in that Outlook inbox and confirm it. Forwarding to an unverified address fails.
3. **Routing rules**: set Catch-all, or just `hello@` and `advertise@`, to **Send to a Worker → rb-email**.

To change the inbox later, edit `FORWARD_TO` under **Workers & Pages → rb-email → Settings → Variables**. Separate several addresses with commas; each one must be verified as in step 2.

`test/test.mjs` runs it against fake messages.
