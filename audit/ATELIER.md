# Soho Luxury Atelier, 29 Oct 2026

**Live at relentlessbillionaire.com/soho** (its first address, /atelier, redirects there). It rebuilds the shop from the old Pages build
(`0dff6f8d.relentless-billionaire.pages.dev`, which isn't rolled back to or linked anywhere) inside the main site. It
has the same nine outfits, pictures and prices, with Manzo Leathers credited as the manufacturer.

## What's on the page

- **The nine Genesis pieces, at the old page's prices.** Varsity and Leather are categories from the old page, and
  Genesis is its collection name. The pieces are:

  | Piece | Category | Price |
  | --- | --- | --- |
  | Black Wool Varsity | Varsity | $1,250 |
  | Leather Moto Varsity | Leather | $1,850 |
  | Ivory Cream Varsity | Varsity | $1,250 |
  | Wool Coach Jacket | Coach | $950 |
  | Black Leather Bomber | Bomber | $2,100 |
  | Cropped Varsity | Varsity | $1,100 |
  | Luxury Varsity | Luxury | $2,500 |
  | Soho Original | Archive | $1,350 |
  | Wool Varsity Alt | Varsity | $1,250 |

- **What the page does:**
  - filters by category;
  - quick view with sizes XS–XXL;
  - save a piece (heart);
  - a bag;
  - **Send the request**.
- **"Made by Manzo Leathers"** appears in the hero, in a section about the maker, on every piece, in the quick view and
  in the footer.
- **Every link stays on relentlessbillionaire.com:** Shop, Events, World, Jobs, Studio, Radio, Memberships, and the
  footer links. The RB Radio bar plays at the bottom, as the old page's music player did.
- **Look:** dark luxury tokens (deep black, champagne gold, a touch of crimson), film grain and vignette, a slow hero
  drift, gold sheen, glass panels, cards that lift and zoom, and scroll reveals. All motion stops for visitors who ask
  for reduced motion.
- **Typography:** Inter, the old page's typeface, kept for the wordmark, labels and body text. Instrument Serif, the
  site's display face, is added for headlines and prices.

## Changed from the old page, on purpose

- **Nothing is charged on the page.** "Add to bag" and "Send the request" save a request in the shop's own
  inquiries, labelled **Soho Atelier**. That's RB admin > Inquiries, the same place as Slank Customs requests. The page
  says the atelier replies by email to confirm size, timing and payment. Taking payment would mean a Stripe change,
  which needs the owner's OK.
- **Left out, because they weren't true or couldn't be checked:**
  - the treasury, ad-revenue and music-sales counters ($0);
  - "Treasury growth +12.4%";
  - "Genesis 73/100" and "73 Genesis left";
  - the "Siddiqui Rum" and "Atelier Access" ads;
  - RB Points "1 pt per $10";
  - the sample-song player.
- **Pictures:** one of the old pictures (used for "Soho Original" and the banner) was a mock-up of a product page
  reading "Made in Italy", "Crafted in Italy", "18k gold" and "Shop Pay". That would contradict Manzo Leathers, so only
  the photograph and the detail shots were cut from it. The other eight pictures are the originals, resized for the web.

## Where things live

- **The page:** `rb-site-updates/src/atelier/atelier.html`, served by artist-router through `patch_atelier.py`, which
  is in `deploy-all.sh`.
- **The pieces:** ordinary shop products, `shop_products` with brand `atelier`, added by `atelier_seed.sql` (safe to
  run again). Change prices, pictures, wording or order in RB admin > Shop; its brand menu now has "Soho Atelier".
- **Pictures:** `media.relentlessbillionaire.com/atelier/*.webp` (R2 bucket `relentless-billionaire-media`), in 640 and
  1200 px sizes.
- **The Store:** `/store` has a third tab, **Soho Atelier**, that opens /soho.

## Checked

- **`rb-site-updates/test/atelier.test.mjs`** (in the pipeline), with the real Worker and a stand-in database:
  - the nine pieces are added once;
  - scripts run by nonce only;
  - every link stays on the site;
  - none of the invented numbers appear;
  - a request is saved as Atelier;
  - the Store has the tab, and RB admin keeps the brand.
- **With `--browser`:**
  - at desktop and phone width, all nine pieces show and the filters, quick view, size, bag and request work;
  - the request is saved;
  - there are no errors and no sideways scrolling.
- **On the live site:** nine pieces, no console errors at 1440 and 390 px, the RB Radio bar plays, and the Store tab is
  there.

## Rollback

artist-router, from Cloudflare > Workers > artist-router > Deployments:

| Version | What it is |
| --- | --- |
| `024ed006` | Live now: the page at /soho, /atelier redirecting |
| `127a2eec` | The page at /atelier |
| `91aa9f46` | Before the Atelier |

To take the pieces down without a rollback, set them to archived in RB admin > Shop. The rows and pictures are additive.
