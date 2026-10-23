# RB Cloudflare and payments inventory

Phase 1 of the Workers and payments audit. Taken on 17 Oct 2026 using read-only API calls, the live code of each payment Worker, and the public pages. Nothing was deployed or changed, and no Stripe call was made.

**Limits of this snapshot.** The API token used here can't read D1 table contents, DNS, Email Routing or WAF, and has no Stripe access. Anything that depends on those is marked *unknown*. Secret values were never read; only secret names are listed.

## 1. Accounts

| Account | Workers | Pages projects | Custom domains on Workers |
| --- | --- | --- | --- |
| Main (tge40000), zone relentlessbillionaire.com | 53 | 8 | studio → `relentless-studio`, beatstore → `beatstore`, game → `relentless-hub`, hub and relentless-hub → `relentless-billionaire-api`, partners → `rb-partners`, fdb → `fuerzas-del-bay` |
| RB (relentlessbillionaire.vip) | 4 | 0 | members-staging.….vip → `rb-member-api-staging`, studio.….vip → `rb-studio-vip-router` |
| MAISON NOIR (maisonerotique.com) | 2 | 1 | atelier.maisonerotique.com → `maison-atelier-gate` |
| STUDIO DARKSIDE (studiodarkside.com) | 1 | 1 | none |

Storage in the main account:
- 46 KV namespaces, 20 R2 buckets and 4 queues.
- D1: the token can't list databases. Bindings show one shared database, `820b8c2f…`, used by 23 Workers. A donor ledger, `726f8273…`, is shared by 4.

Only the main account takes payments. The other three have no Stripe secrets.

## 2. Workers that touch money

| Worker | Serves | Stripe secrets | What it does with money | Webhook | Duplicate protection |
| --- | --- | --- | --- | --- | --- |
| `rb-store-payments` | `relentlessbillionaire.com/api/checkout*`, `/api/stripe/*`, `/api/webhooks/stripe*` (with and without www) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | **The real store checkout.** Beat licenses ($30 MP3, $50 WAV, $100 unlimited, exclusive by request), samples and bundles. Prices are inline (`price_data`), not Stripe price IDs. Paid downloads come from R2 `MASTERS`. Also serves `beatstore` and `rb-autopilot` through a service binding. | `/api/stripe/webhook` and `/api/webhooks/stripe`, signature checked with a time tolerance; handles `checkout.session.completed` | `INSERT OR IGNORE INTO store_orders`: safe |
| `beatstore` | beatstore.relentlessbillionaire.com | `STRIPE_SECRET_KEY` (unused in code) and others | Catalog page. Its checkout calls `rb-store-payments` through the `PAYMENTS` binding, then sends the buyer there in the same tab (`location.assign`). Exclusive goes to `/store?license=exclusive`. | none | n/a |
| `artist-router` | `relentlessbillionaire.com/*`, `www.…/*`, `*.relentlessbillionaire.com/*` | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `DONOR_WEBHOOK_SECRET` | Homepage, `/store` (catalog plus BUY NOW) and most pages. Its own `/api/checkout` and `/api/stripe/webhook` are **shadowed**: `rb-store-payments` has the more specific routes, so these never run on the main host. Also has `/api/studio/checkout` and `/api/studio/stripe/webhook` (subscriptions), and `/api/donors/webhook`. | 3 handlers (see left); live use *unknown* | stores `evt.id`: safe |
| `rb-mastering-studio` | `relentlessbillionaire.com/studio*` | `STRIPE_SECRET_KEY` | RB Studio mastering: single unlocks (credits), Artist/Pro subscriptions, vault. Price IDs live in R2 `billing/config.json`, not in code. **Has a Customer Portal** (`/api/portal`, `/cancel`). Success page `/studio/welcome?session_id=…`, same tab. A `live` flag gates charging; before launch everything is free. | `/studio/api/stripe/webhook`: checkout completed or async succeeded, subscription created/updated/deleted, `charge.refunded` | per-session record in R2: safe |
| `rb-fund-campaign` | `relentlessbillionaire.com/fund*` | `STRIPE_SECRET_KEY` | Donations and monthly support tiers. **8 hardcoded price IDs** (`price_1U99…`, `price_1U9B…`); one-off amounts are inline. | its own `/fund/webhook` returns 503; Stripe sends these events to the donor-ledger webhook instead | through the donor ledger (`processed_stripe_events`) |
| `relentless-billionaire-api` | media.relentlessbillionaire.com, `/references*`, plus hub.* domains | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | An older store checkout (inline prices) and webhook. hub.relentlessbillionaire.com returns 404 at `/`. | `/api/stripe/webhook` on its own hosts | `INSERT OR IGNORE INTO store_orders` |
| `rb-studio` (main and RB accounts) | no route (reached through bindings) | `STRIPE_DONOR_WEBHOOK_SECRET` | Donor ledger. | donor webhook: `checkout.session.completed`, `invoice.paid` / `payment_failed`, subscription updated/deleted | `processed_stripe_events` table: safe |
| `rb-memberships` | `/memberships*`, `/book*` | none | **No checkout.** "Just Starting" $5/mo and "Put Me In Coach" $2,500/yr are **waitlists** ("Opening soon"). Business tiers and booking are requests ("Nothing is charged before the call"). | none | n/a |
| `rb-autopilot` | cron only | none (uses tokens) | Creates invoices through `rb-store-payments` (`InvoiceApi`). | none | n/a |

**Stripe (read-only check, 17 Oct, through the Stripe connector).** There is **one live account**, "Relentless Billionaire" (`acct_1SjTtWB7eDnuwXUA`). Seven Workers each hold their own copy of its secret key.

Webhook endpoints registered in Stripe:

| Endpoint | Status | Events |
| --- | --- | --- |
| `relentlessbillionaire.com/api/webhooks/stripe` → `rb-store-payments` | enabled | checkout completed, invoice paid/failed, subscription deleted |
| `relentlessbillionaire.com/api/donors/webhook` → `artist-router` (donor ledger) | enabled | checkout completed, invoice paid/failed, subscription updated/deleted |
| `studio.relentlessbillionaire.vip/api/donors/webhook` | disabled 22 Sep (it returned 404) | — |

So:
- `/fund` donations **are** recorded, through the donor-ledger webhook. Its own `/fund/webhook` (503) is unused.
- **RB Studio has no webhook in Stripe**, and its Artist/Pro prices aren't among the active prices. Studio billing hasn't been set up yet, which matches its "free before launch" mode. The `artist-router` and `relentless-billionaire-api` `/api/stripe/webhook` handlers aren't registered either.

Active prices (23): 8 fundraiser prices (one-off $50 to $1,000, monthly $10 to $100, and an adjustable donation of $5 or more), STARTER/PRO/ELITE memberships at $49/$199/$499 a month, and services: consulting $2,000, outreach $1,000, lead generation $500, flyer $200. **The memberships and services each appear twice** (created 10 Apr and again 16 Apr), plus two "Built by Community" adjustable-amount donations. None of the beat licenses are Stripe prices; the store sends amounts inline.

## 3. Public money entry points (live, 17 Oct)

| Page | Status | What the visitor sees | Checkout behaviour |
| --- | --- | --- | --- |
| `/` homepage | 200 | Houses, ads, radio. The "Music library cleared" text is in the HTML but **not shown**. One visible "Loading today's games and forecasts…" line. | Ad links open in a new tab (intended: outside advertisers) |
| `/shop` | 301 → `/store` | | |
| `/store` | 200 | Full catalog with BUY NOW, $30 to $500. **No "Curating…" placeholder** after load. | same tab, through `rb-store-payments` |
| beatstore.relentlessbillionaire.com | 200 | Beats at $30, sample packs ("Choose 5 for $3"), memberships shown at $5/mo and $2,500/yr | same tab, through `rb-store-payments` |
| `/studio/` | 200 | Mastering tool; Unlock this master, Unlock vault. "Pause checkout" and "Test purchase $1.75" exist only in the operator panel (hidden). | same tab; "See all plans" (operator panel) opens `pricing` in a new tab |
| studio.relentlessbillionaire.com | 200 | RB Studio DAW ("Untitled song"). Has both a route (`rb-daw`) and a custom domain (`relentless-studio`); the DAW is what serves. | links to `/memberships` |
| `/memberships` | 200 | 9 plans from $5/mo to $499/mo. All are waitlist or request forms. | none |
| `/fund` | 200 | Tiers $5 to $1,000, Subscribe, Donate any amount | Stripe Checkout; no fulfillment webhook |
| `/book` | 200 | $25 to $1,500 booking options | request form |
| shop.relentlessbillionaire.com | 200 | Serves the homepage, because `artist-router`'s `*.relentlessbillionaire.com/*` route catches it before Pages. | |
| `/pricing`, `/checkout` | 404 | do not exist | |

## 4. Health, last 7 days

The highest traffic is `artist-router` (41,037 requests, 0.3% errors, CPU p99 18.7 ms). Every other Worker had 0 to 3 errors.

Long wall times, which are waits rather than CPU:
- `rb-radio-hub` (95 s): a stream.
- `relentless-backend` (77 s) and `rb-autopilot` (35 s): crons.

Payment Workers:
- `rb-store-payments`: 211 requests, 0 errors.
- `beatstore`: 931, 0 errors.
- `rb-mastering-studio`: 946, 0 errors.
- `rb-fund-campaign`: 355, 0 errors.

Observability is on for the Workers deployed recently. Placement is "smart" on `rb-email`; the others weren't checked one by one.

## 5. Workers with no traffic in 7 days

There are 19 (`rb-email` is left out because it only takes mail):

`dry-pond-c4b6`, `green-unit-8a77`, `media-worker`, `ops-worker`, `rb-dancer-portal`, `rb-operations-admin`, `rb-studio-root-proxy`, `rb-worker`, `recording-mobile-css`, `relentless-agent-mcp-server`, `relentless-billionaire-game`, `relentless-billionaire-gateway`, `relentless-club-boundary`, `relentless-hub` (custom domain game.relentlessbillionaire.com), `soft-violet-13f4`, `waitlist-api`, `bruxie-davis-ai`, `rb-member-api-staging`, `autumn-credit-6d51` (route `*.studiodarkside.com`).

The earlier review flagged 11 of these as deletable. That still waits on the owner. Nothing has been deleted.

## 6. What the plan assumed vs what is live

| Plan says | Live today |
| --- | --- |
| Checkout opens in a new tab | Store, beatstore and studio checkouts already redirect **in the same tab**. Only ad links and one operator-panel link use new tabs. |
| `/shop` shows "Curating the storefront…" | `/shop` is a 301 to `/store`, which loads the full catalog. The placeholder string is in the HTML but hidden once the catalog loads. |
| $5/mo and $2,500/yr are sold on beatstore | They are **waitlists**, with no Stripe product. Selling them needs owner-set prices and terms, which counts as a Stripe change. |
| No Customer Portal | RB Studio already has one, with a cancel flow. The store sells one-off purchases, so it has nothing to manage. |
| No webhook idempotency | The store, studio and donor webhooks are already safe against redelivery. The **fund** has no webhook at all. |

## 7. Real problems found

1. **Seven copies of the Stripe secret, and five webhook handlers in four Workers.** Two of them, `artist-router`'s `/api/checkout` and `/api/stripe/webhook`, are dead code shadowed by `rb-store-payments`. More keys means more to rotate and more ways to drift.
2. **`/fund` hardcodes 8 price IDs** and has a dead `/fund/webhook` (503). Donations are recorded by the donor-ledger webhook.
3. **Prices live in three places**: inline in `rb-store-payments`, in R2 `billing/config.json` for the studio, and as hardcoded IDs in the fund.
4. **No `/pricing` page.** Plans are spread over `/memberships`, `/studio/pricing`, beatstore and `/fund`.
5. **shop.relentlessbillionaire.com** shows the homepage instead of the store.
6. **studio.relentlessbillionaire.com** is claimed by both a route (`rb-daw`) and a custom domain (`relentless-studio`).
7. `beatstore` holds a `STRIPE_SECRET_KEY` and a `CLOUDFLARE_API_TOKEN` it doesn't use in code. Removing them shrinks the risk if it leaks.

## 8. Needed from the owner before Phase 2 and 3

- Stripe is now connected (read-only use so far). Any change, such as archiving the duplicate products or adding the studio webhook, still needs the owner's explicit OK.
- **Prices and terms** for anything new to sell, such as the $5/mo and $2,500/yr memberships, which are waitlists now. The sites must not show invented prices.
- **D1 read access** on the token, to audit the `store_orders`, membership and license tables.
- **Zone WAF and Rate Limiting** permission, if those rules are wanted.
