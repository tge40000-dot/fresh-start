# Stripe review, 23 Oct 2026

**Update, later on 23 Oct (with the owner's OK):**
- **RB Studio checkout fixed.** The studio turned out to be connected to a second Stripe account (`acct_1U8gl1…`), which has Stripe Managed Payments on by default. Managed Payments refused every product without a tax code, so every studio purchase failed with "the product tax code is missing". Studio checkout sessions now ask for `managed_payments[enabled]=false` (`rb-site-updates/patch_studio_checkout.py`), the same as the beat store and `/fund`. Checked live: a single master and a monthly plan both open a live Stripe checkout page. Sales tax stays RB's responsibility, as it already is for the store and `/fund`.
- **10 duplicate products archived** (archived, not deleted; this can be undone in the dashboard):
  - both sets of ELITE, PRO and STARTER Membership;
  - the older copy of Consulting, Outreach, Flyer and Lead Generation.

  No site's code used them.
- **Still to do by hand:** delete the disabled webhook (`studio.relentlessbillionaire.vip/api/donors/webhook`) in the dashboard, because the Stripe connector can't delete webhooks. It's already disabled, so it's harmless.

The original review follows.

This was a read-only check of the one live Stripe account, "Relentless Billionaire" (`acct_1SjTtWB7eDnuwXUA`), made through the Stripe connector. Nothing in Stripe was created, changed or archived. Every change below waits on the owner's OK.

## 1. RB Studio can't take payments from this account (check first)

RB Studio (`/studio`, Worker `rb-mastering-studio`) shows its plans live: Single master $7, Artist $14.99 a month and Artist yearly $119. The checkout picks Stripe prices saved in the studio's settings, which its own "Set up Stripe" step creates with the lookup keys `rb_single_v1`, `rb_artist_month_v1`, `rb_artist_year_v1` and `rb_pro_month_v1`.

- **None of those prices exist in this Stripe account.** A search by lookup key returns nothing, and no product is named "RB Studio …".
- **No webhook here points at the studio's own handler** (`relentlessbillionaire.com/studio/api/stripe/webhook`). Without one, a cancelled or failed subscription never reaches the studio.

So one of these is true:
1. The studio's `STRIPE_SECRET_KEY` belongs to a different Stripe account or is a test key. If it's a test key, payments would go to test mode and no real money would come in.
2. Setup was never run, so the checkout answers "Pick a plan." and nobody can buy.

**How to check:** open RB Studio admin > Billing. It shows whether a Stripe key is connected and whether setup is done (prices plus a webhook). A single test checkout would also show which one, because its link starts `cs_live_` or `cs_test_`. Nobody would pay, but it creates a session in Stripe, so it waits on the owner's OK.

**The fix (owner's OK):** run the studio's own setup (RB Studio admin > Billing > Set up Stripe) with the live key of this account. It creates the four prices and the webhook, and saves the webhook's signing secret itself. The launch coupon ended on 17 Oct, so no new coupon is needed.

## 2. Webhooks

| Endpoint | Status | Events | Note |
| --- | --- | --- | --- |
| `relentlessbillionaire.com/api/donors/webhook` | enabled | checkout completed, invoice paid or failed, subscription updated or deleted | the donor ledger (`/fund`) |
| `relentlessbillionaire.com/api/webhooks/stripe` | enabled | checkout completed, invoice paid or failed, subscription deleted | store orders (`rb-store-payments`) |
| `studio.relentlessbillionaire.vip/api/donors/webhook` | disabled | (same as the donor ledger) | already replaced; **can be deleted** |

## 3. Products: duplicates to archive

There are 24 active products. Archiving (not deleting) hides a product from new sales and keeps its history, and it can be undone.

| Product | Copies | Prices | Suggestion |
| --- | --- | --- | --- |
| ELITE, PRO and STARTER Membership | 2 each (10 Apr: `prod_UJPf…`; 16 Apr: `prod_ULVY…`) | none | **Archive both sets** unless something still sells them. `/memberships` sells nothing today (waitlists and requests only). Their descriptions promise discounts and perks ("40% off all services", "weekly strategy calls", "VIP + backstage"), so they shouldn't come back without those being real. |
| 1-on-1 Business Consulting, Targeted Outreach Campaign, Custom Event Flyer Design, AI (-Powered) Lead Generation | 2 each (10 and 16 Apr) | none | Archive the older copy (`prod_UJPf…`). Keep one only if these services are still offered. |
| "Built by Community. Powered by Creativity." | 2 (29 Dec 2025) | 1 each | Keep the one a QR code or link points at, and archive the other. Which one is in use isn't visible from Stripe. |
| Fundraiser: Initiate, Sustainer, Member, Partner, the Voluntary Donation and three monthly donations | 1 each | 1 each | **Keep.** `/fund` uses them (8 price IDs in `rb-fund-campaign`). |

## 4. Recent activity (last 10 checkout sessions)

These were all `/fund` donations or tiers. Three were paid ($5, $9 and $20). The rest were started but not finished and expired, which is normal for an abandoned checkout. No studio or store sessions were among the ten.
