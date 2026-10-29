# Dark Luxury lock, motion, and the polish sweep (Prompts A and E), 28 Oct 2026

Code only. Nothing here is deployed yet, no data was changed, Stripe wasn't touched, and RB Radio is still skipped by
`deploy-all.sh` while a show is live. Everything below was checked against the live code of each Worker (pulled read-only
on 28 Oct) and, where it shows on a page, in a browser against the live site.

## A. The locked tokens

The nine tokens are now one shared set, `--lux-*`, that every palette fills:

| Token | Dark Luxury value | From any other palette |
| --- | --- | --- |
| `--lux-bg` | `#05040A` | its background |
| `--lux-bg-elevated` | `#0C0A10` | its dark panel |
| `--lux-gold` | `#D4AF37` | its readable accent |
| `--lux-gold-highlight` | `#F5E6C8` | its second accent |
| `--lux-gold-deep` | `#8B6914` | the accent darkened |
| `--lux-crimson` | `#C41E3A` | its second colour (`--lux-crimson-text` is the readable version) |
| `--lux-text` | `#F5F0E6` | its text |
| `--lux-text-muted` | `#A89F8C` | its muted text |
| `--lux-line` | `#2A261C` | its hairline |

- **Dark Luxury** is a new built-in palette, first in RB Command > Site colours. Its colours were chosen so the same
  `tones()` every site already uses gives exactly the values above. It passes every readability check (text 14:1,
  gold 7.6:1, button text on gold 9.7:1). There are now 27 palettes.
- **The theme changer** adds the `--lux-*` tokens to every site's `theme.css` whenever a theme is chosen, from whatever
  palette that is, including custom ones from the **palette builder**. No theme chosen: nothing is added.
- **The builder** shows the nine tokens for the palette you're building, and starts from the locked gold and crimson.
- **The homepage hub** has its own locked brand. Its colour literals now go through its variables (with its own values
  the page is identical: 2,745 computed colours compared on the live homepage, 0 differences). When Dark Luxury is the
  homepage's theme, the hub takes the locked set. Under any other palette it keeps its own brand, as today.
- **RB Create** can't load `theme.css` (its CSP only takes its own nonced styles), so it carries the locked values itself.

**Nothing changes colour on deploy.** The live setting is a custom palette (`c_s9hf5t65`). To put Dark Luxury live:
RB Command > Site colours > Dark Luxury > Publish colours. *Back* undoes it.

## A. Motion

All in the stylesheet every user site already loads (`/api/content/site-images.css`), so there's no new script, no
new request and nothing for a page's CSP to block. Everything that moves stops with *reduce motion*.

| Site | Scroll reveals | Gold lift and sweep on hover | Other |
| --- | --- | --- | --- |
| Homepage hub | sections and the stats rise in | `.rb-btn` | |
| RB TV | shelves rise in | gold buttons | |
| /events | (keeps its own fade-ins) | gold buttons | venue cards lift |
| /memberships | plan cards, set heads, the comparison | main buttons | |
| /studio (mastering) | none: it's a tool | *Master* button | |
| RB Studio (/record) | none: it's a tool | *Export WAV* | |
| RB Create | each tool view rises in, tool cards stagger | gold buttons | |
| RB Radio and its hub | none | none | (classes available, unused) |

- Reveals use CSS scroll-driven animations, only where the browser has them (Chrome, Edge, Safari 26). Elsewhere the
  page simply shows everything. Once an element is in view it's exactly as the site styles it.
- Hover effects only apply with a real pointer, so a tapped button on a phone doesn't stay lifted.
- **GSAP isn't loaded anywhere.** No page has a sequence CSS can't do, so it would only add weight. Pages that need one
  later can load it then.
- `.rb-skel` (gold skeleton) and `.rb-shimmer` (gold sweep) are available on every site.

## E. Polish

1. **The Cloudflare token: not confirmed.** I can't see from here whether the shared token was revoked. Revoke it in
   Cloudflare > My Profile > API Tokens when you're ready; `deploy-all.sh` needs a token in `CLOUDFLARE_API_TOKEN` to run.
2. **Loading states are gold skeletons**, with the words kept for screen readers: the shop, the store, the homepage
   roster and the homepage scoreboard, RB Create's project list, and RB Command's Live signal. Admin-only lists keep
   their text.
3. **One sound at a time.** The radio bar already paused for audio and video on the same page. It now also steps aside
   for another RB tab or frame on the site (a video on RB TV in one tab, the radio in another) and for the studio, which
   plays through Web Audio and couldn't be seen before. Checked in a browser: a second tab's sound pauses the first;
   a studio claim pauses both; a muted hero loop doesn't. The beat store (beatstore.) and studio. are their own sites,
   so the browser keeps them separate from the main site.
4. **Consistency check** (what's live now, not changed here):
   - Site tabs are on every page except RB World, which turns them off on purpose (it's a full-screen game).
   - Page backgrounds match (`#0B0A09` from Site images) except RB TV, which keeps its own on purpose.
   - **Typefaces differ by site:** Manrope (homepage shell, Record, Memberships), Geist (hub), system font (RB Create),
     Jost (RB TV), Inter (Events, RB World), the system font (mastering). One pair for the whole family would do more for
     "one brand" than anything else left. Worth a decision before changing it.
   - **Button shapes differ:** the hub's gold buttons are square, most others are pills, RB TV's line buttons are
     nearly square. Same note.
5. **Still open from the last session, not changed here:**
   - RB World money is counted in the browser, so it can be edited by a determined player. It shouldn't back anything
     of real value until the server keeps it.
   - RB World's new combat (bullet and blast damage to cars and people) hasn't been play-tested for feel.
   - Bullet damage is worked out on each player's own device, so two players can see slightly different results.
   - The membership-class badges stay unlit for everyone until people hold those memberships (by design; nothing fakes it).

## Deploy

`./deploy-all.sh` runs every new patch and test after the existing ones; `./deploy-all.sh --deploy` uploads code only.

| Worker | What changes | Needs |
| --- | --- | --- |
| `rb-public-content` | the luxe layer in `site-images.css`; `--lux-*` in `theme.css` | first (every site reads it) |
| `artist-router` | Dark Luxury palette, hub tokens, RB Create, loading skeletons | |
| `rb-command` | Dark Luxury in the picker, tokens in the builder, gold skeletons | last, as always |
| `rb-radio` | Dark Luxury palette, one sound at a time | skipped automatically while a show is live |
| `rb-daw` | the studio claims the sound when it plays or records | its own `deploy.sh` (run by `deploy-all.sh`) |

**Rollback.** Versions to roll back to, from the 28 Oct session summary (check they're still live before deploying;
`cfworker.py push` refuses if a Worker changed since it was pulled):

| Worker | Live before this (roll back to) |
| --- | --- |
| `artist-router` | `286df164` |
| `rb-command` | `a8486556` |
| `rb-public-content`, `rb-radio`, `rb-daw` | Not in the summary; the deploy prints and saves each one's previous version (`*/deployed.json`) |

Roll back from Cloudflare > Workers > the Worker > Deployments. `site-images.css` may stay in browsers' caches for up
to a few hours after a rollback.

## Files

- `rb-tools/luxe_tokens.js`, `rb-tools/patch_luxe_tokens.py`: the palette and tokens in every `theme.js` copy.
- `rb-site-updates/patch_hub_tokens.py`: the hub's colours through its variables; Dark Luxury for the hub.
- `rb-site-updates/src/site-images-public.js`: the luxe layer (`LUXE_CSS`, `LUXE_SITES`, `luxeCss()`).
- `rb-site-updates/src/create/create.html`: RB Create's locked tokens, motion and project skeleton.
- `rb-site-updates/patch_loading_states.py`: the public loading skeletons.
- `rb-site-updates/patch_radio_onesound.py`, `workers/rb-daw/src/assets/main.js` (`rbClaimSound`): one sound at a time.
- `rb-command-updates/patch_luxe_builder.py`: the builder's token strip and gold skeletons.
- Tests: `rb-tools/test/luxe-tokens.mjs`, `rb-site-updates/test/luxe-motion.test.mjs`,
  `rb-site-updates/test/onesound.test.mjs`; `rb-command-updates/test/palettes.mjs` now expects 27.
