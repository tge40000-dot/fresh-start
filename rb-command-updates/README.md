# RB Command: more site colours and Affiliate ads

## More site colours

RB Command's **Site colours** screen goes from 13 themes to 26. The original 13 were mostly warm golds, pinks and reds. The new 13 add blues, teals, cool greys and brights:

Sapphire, Ocean, Teal, Mint, Indigo, Arctic, Steel & Silver, Neon Lime, Sunset, Coral, Fuchsia, Ruby, Royal Purple.

Every theme goes through the same readability check the screen already used (`tones()` in `theme.js`). Body text, muted text, both accents and dark button text all reach at least 4.5:1 on the panels. `test/palettes.mjs` checks all 26 palettes and builds every site's stylesheet with each one.

The colour list is copied into four Workers. A site ignores a theme its own copy doesn't know, so all four get the new palettes:

| Worker | What it does with the list |
| --- | --- |
| `rb-command` | The picker. Also the homepage theme (`blocks.js`) and artist theme (`tables.js`, `ui.js`) lists. |
| `rb-public-content` | Serves `/api/content/theme.css`, the stylesheet most sites load. |
| `artist-router` | The homepage and artist pages (`THEMES` and its `theme.js`). |
| `rb-radio` | RB Radio's own copy. |

The new themes are also available as homepage and artist-page themes.

`rb-operations-admin` has an old copy of the key list, but no route reaches it, so it's left alone.

## Affiliate ads

A new **Affiliate ads** screen in RB Command (in the nav for anyone who can edit Ads):

1. **Paste the affiliate link** and press *Read the page*.
   - RB Command opens the link, follows redirects, and reads the page's title, description, site name and picture (Open Graph and Twitter tags, then the `<title>`).
   - If the page can't be read, the fields stay empty with a note, and you fill them in.
2. **The words.** Advertiser, headline, a line of text and the button text come pre-filled from the page, and you can edit them. Use only what the product page says: no invented prices, results or promises.
3. **The picture**, one of three:
   - **The page's picture.** It's copied into RB media (`admin/ads/…`) so the ad doesn't depend on the merchant's server.
   - **Upload my own.** This uses the existing upload, up to 15 MB.
   - **Make a card for me.** A 1080×1080 SVG card in the homepage's current colours, with brand, headline, text line, button and domain. It previews live as you type.
4. **Where it shows.**
   - Placement: discovery rails, homepage spotlight, or rails and the live ticker.
   - Shows on: everywhere, main site only, RB Radio only, or RB TV only.
   - *Publish ad* makes it live straight away. *Save it paused* doesn't.

**What publishing does:**
- Adds a normal row to the `ads` table: format image, weight 1, daily cap 3 per visitor, and the `surface` you chose.
- It appears in the ad rotation on every page that shows ads, marked **Sponsored**.
- Views and clicks are counted like any other ad.
- Clicks go through `/go/ad/<id>` to the affiliate link **exactly as pasted**, so the network's tracking is kept. The redirect only adds `utm_*` tags that aren't already in the link.
- It's logged as a normal "added" change, so the toast's **Undo** removes it. Edit, pause or delete it any time under **Ads**.

The **Ads** editor also gets a **Shows on** field, so the surface can be changed on any ad.

**Limits:**
- RB Radio and RB TV pages don't show ads yet. An ad set to them waits until those pages get an ad rail.
- Pages that block automated readers come back empty. Type the words and use your own picture or a card.

## Files

- `src/affiliate.js`: the new RB Command module (reading the page, the card, publishing).
- `patch_rb_command.py`: adds the module, three routes (`/api/affiliate/preview`, `/card`, `/create`, all needing edit rights on Ads), the screen, its styles, and the Ads table's **Shows on** field to a pulled `rb-command`.
- `../rb-tools/palettes.py`: adds the 13 palettes to any pulled Worker that has the list.
- `../rb-tools/cfworker.py`: `pull` a Worker into a folder, and `push` it back as code only. Push refuses if the live version changed since the pull.
- `test/palettes.mjs`, `test/affiliate.test.mjs`: the checks.
- `deploy.sh`: pulls all four Workers, patches them and runs every test, including the main-site ad tests in `../rb-surface/test`. With `--deploy` it then uploads them in order (sites first, RB Command last).

All the patch scripts skip edits that are already in place, so running them twice changes nothing.

## Status: deployed 16 Oct 2026

| Worker | Now live | Previous (roll back to) |
| --- | --- | --- |
| `rb-public-content` | `2cb45aa9` | `bb391305` |
| `rb-radio` | `5904e5fc` | `0f0a3556` |
| `artist-router` | `cbd9da43` | `e2e799e6` |
| `rb-command` | `f816a3f8` | `72afeff1` |

All four were deployed in that order, after every test passed on freshly pulled code.

Checked live afterwards:
- `/`, `/home`, `/radio`, `/tv`, `/studio/`, `/fund`, `/api/signal`, the ad rail and the beat store return 200.
- `theme.css` serves for TV, the beat store and Radio.
- RB Command is behind Cloudflare Access, and a signed-out request to the new affiliate endpoint is refused.

To undo, go to Cloudflare → Workers → each Worker → Deployments, and redeploy the previous version.
