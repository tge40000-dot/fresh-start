# AI limits: the owner's boundaries for every AI call (Prompt D), 29 Oct 2026

Code only. Nothing here is deployed yet, no data was changed, and Stripe wasn't touched. Every part was run against the
live code of its Worker (pulled read-only on 29 Oct) with a stand-in database and AI.

## What it is

**RB Command > AI limits** (`team.relentlessbillionaire.com/ai`), owner only. Every other role gets a 403, and the nav
entry only shows for the owner.

| Setting | What it does | RB's default |
| --- | --- | --- |
| On or paused | One switch each for the public tools, the AI Forge and Autopilot. Paused stops new calls at once. | All on |
| Style locks | Dark Luxury, Cinematic Night, Hip-Hop Editorial, Photoreal. A style that's off is refused. Optionally, the default style is added to every picture and video prompt that doesn't pick one. | All four allowed; not added automatically |
| Largest picture side | Bigger requests are brought down to it, keeping their shape. | 2048 px |
| Longest video / music | Longer requests are brought down to it. | 20 s / 600 s |
| Content filters | Sexual or nude content, children and teenagers, gore, hate symbols, suicide and self-harm. Set separately for pictures and video, and for words, voice and music. Plus the owner's own blocked words. | Every filter on for pictures and video; hate on for words |
| AI check | Llama Guard (already on Workers AI) reads public picture and video prompts too. | On |
| Rate limits | Public tools per visitor (minute, hour, day) and site-wide per day; AI Forge renders per day. | Today's numbers; no Forge cap, as now |
| Autonomous actions | Autopilot can't start a paid render without the owner's approval of that idea. | On (as Autopilot already works) |
| The log | Keep the first 300 characters of each prompt, and for how many days. | Kept, 90 days |

**Never allowed, whatever is set:** sexual content together with any sign of someone under 18.

The screen also has **Try a prompt** (checks a prompt against the rules on screen, saved or not; nothing is generated),
**Put back the last rules**, and **Every AI call**: the log, newest first, filterable by where, outcome and kind, and
searchable.

## Where it's enforced

| Path | Worker | What's checked |
| --- | --- | --- |
| RB Create (Film pictures, Voice, captions), writing, vision | `relentless-billionaire-api` (`/ai/platform/*`) | Switch, styles, sizes, filters, AI check on pictures, rate limits |
| Studio lyric and vocal helpers | `relentless-billionaire-api` (`/ai/studio/*`) | Switch, word filters, rate limits; members logged by id |
| AI Forge (music, voice, video, pictures, writing) | `rb-studio`, RB account | Switch, styles, sizes and lengths, filters, per-day caps, Autopilot's approval |
| Autopilot's drafts and ideas | `rb-autopilot` | Switch; every call logged |

Every check runs **before** a model is called, and every call is logged in `ai_audit` (waitlist-db) with its outcome
(done, queued, blocked, rate limited, failed), model, style, a fingerprint of the prompt, who asked (a visitor is a
hash of their IP; the IP is never stored), and how long it took.

**How the AI Forge gets the rules.** It's in the other Cloudflare account and can't read RB's database. Autopilot
already holds its key, so Autopilot carries the rules there right after the owner publishes, and checks every 10
minutes that the Forge's copy is current. The Forge keeps its log for 14 days, and Autopilot copies it into RB
Command's log every 10 minutes. Only Autopilot can change the Forge's copy; the Forge's own admin key can't. No new
secrets or bindings were needed.

## What changes on the day this deploys

The defaults apply as soon as the code is live, before anyone opens the screen:
- **Public picture prompts** go through the word filters and the AI check, which adds about half a second. Prompts
  about children are refused for pictures, e.g. "kids playing basketball". That's the cautious setting; switch it off
  under Content filters if Film needs child characters.
- **AI Forge pictures** are capped at 2048 px, so a 4K (Nano Banana) request comes out at 2K. Raise "Largest picture
  side" to 4096 to keep 4K.
- **Autopilot's renders** must carry the approved idea. Autopilot is deployed before the Forge so this holds from the
  start.
- **Prompts are logged.** The first 300 characters of visitors' prompts are kept for 90 days, tied to a hashed IP.
  **RB's privacy page (version 1.1) mentions "interaction logs" but not AI prompts.** Add a line there, or untick "Keep the first 300 characters".
- Rate limits, approvals, sizes for RB Create (1024 px) and everything else stay as they are.

## Limits, said plainly

- The word filters catch plain wording and simple letter swaps; determined misspellings get past them. The AI check
  backs them up on public pictures and video only. If the AI check fails to answer, the prompt is allowed and the
  log says so.
- If the database can't be reached, the tools use the last rules they read, or RB's defaults, and keep working (as
  the rate limits already did).
- Each Worker re-reads the rules every 30 seconds (the AI Forge: every minute after Autopilot sends them).
- The AI Forge's log entries show "queued" when a render starts; whether it then succeeded is in the Forge's job
  status, not the log.
- **Not wired yet** (they call Workers AI outside these paths): `relentless-studio` (two lyric-helper calls),
  `rb-cloud` (voice, transcription and picture reading), `yoshcoastmusic`, and the CRM's own autopilot replies. They
  keep working as before and aren't in the log. Each is a small patch with the same module.

## Deploy

`./deploy-all.sh` applies every patch and runs every test; `./deploy-all.sh --deploy` uploads code only, in this
order: `relentless-billionaire-api`, `rb-autopilot`, `rb-studio` (RB account), …, `rb-command` last.

| Worker | Live and rollback |
| --- | --- |
| `rb-command` | `a8486556` per the 28 Oct session summary (roll back to it) |
| `relentless-billionaire-api`, `rb-autopilot`, `rb-studio` | Not in the session summary. The deploy prints and saves each one's previous version (`*/deployed.json`) |

Roll back from Cloudflare > Workers > the Worker > Deployments. Rolling back RB Command alone just hides the screen; the
rules saved in `site_settings.ai_policy` stay and are still applied. To switch everything off without a rollback,
pause the three switches on the screen.

**New data, all additive:** table `ai_audit` (made on first use), `site_settings` keys `ai_policy`,
`ai_policy_previous` and `ai_forge_audit_cursor`, and on the AI Forge's KV `rb:ai-policy` and `audit:*` (14 days).

## Files

- `rb-tools/ai_policy.js`: the rules, the check and the log, copied into every AI Worker.
- `rb-tools/ai_autopilot.js`, `rb-tools/ai_forge.js`: Autopilot's wrapper and sync; the AI Forge's gate and log.
- `rb-command-updates/src/aipolicy.js`, `patch_ai_policy.py`: the screen and its routes.
- `rb-site-updates/patch_ai_policy_api.py`, `patch_ai_policy_forge.py`, `patch_ai_policy_autopilot.py`: wiring.
- Tests: `rb-site-updates/test/ai-policy-api.test.mjs`, `ai-policy-forge.test.mjs`, `ai-policy-autopilot.test.mjs`,
  `rb-command-updates/test/ai-policy.test.mjs`.
