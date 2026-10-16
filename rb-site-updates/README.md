# Main site, RB Radio and RB TV updates

## Ad slots on RB Radio and RB TV
Ads set to **RB Radio only**, **RB TV only** or **Everywhere** now show on those sites:
- **RB Radio:** one slot under *Up next / Recently played*, with up to two cards.
- **RB TV:** one slot after the video grid on the home page (up to two cards), and one under *Up next* on every watch page (one card).

A slot stays hidden when no ad is live.

The main site serves the slot code at `/api/ads/slot.js` and `/api/ads/slot.css` (from `src/ad-slot.js` and `src/ad-slot.css`). It follows the same rules as the homepage rails:
- one daily cap per visitor across every RB page
- views counted when a card is drawn, and "viewable" after half of it has been on screen for 1 second (2 for video)
- video muted and only while on screen
- clicks go through `/go/ad/<id>`, tagged `radio-rail` or `tv-rail` in the ad's stats

RB Radio's page only allows pictures from RB's own domains, so an ad whose picture is hosted elsewhere shows there without its picture. Affiliate-ad pictures are already on RB media.

## Counted post links
Every post in a Show planner plan gets a link such as `relentlessbillionaire.com/go/post/42?c=instagram`, for a bio or a story link sticker. Each click adds one to that post's count, which shows in the plan. Link previews, bots and prefetches don't count. The link then goes to `/events` with UTM tags (`utm_campaign=rb-show-<plan>`, `utm_content=post-<id>`).

## The old Pages copy
`relentless-billionaire.pages.dev` served an old "React Artifact" copy of the site. Its newest production deployment is now just `pages-redirect/`: a 301 from every path to the same path on relentlessbillionaire.com. Earlier deployments are kept. To undo, go to Workers & Pages → relentless-billionaire → Deployments and roll back to `c43f9ecc`.

## Files
- `patch_artist_router.py`: post links, plus the ad-slot files and their routes. The files are rewritten from `src/` on every run.
- `patch_radio.py`, `patch_tv.py`: the slots.
- `test/post-link.test.mjs`: runs the real artist-router bundle (redirects, counting, bots, the slot files).
- `test/radio-tv.test.mjs`: checks each page has exactly one slot, script and stylesheet.
- `../deploy-all.sh`: runs these with everything else.
