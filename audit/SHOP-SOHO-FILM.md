# The Shop, the Soho upgrade and the AI Director, 29 Oct 2026

## The Shop (relentlessbillionaire.com/store)

- **Three houses, no beats:**
  - **The Soho Luxury Atelier**, with four Genesis pieces pulled from the shop, links to /soho.
  - **Slank Customs**, with a screenshot of its live site; shirts from $35 and outfits from $100. Links to
    slank.relentlessbillionaire.com.
  - **Sports 4 All**, with a screenshot of its live site; 1530 Sonoma Blvd, Ste A, Vallejo. Links to
    sports4all.relentlessbillionaire.com.
- **Beats** still live at the beat store, and the site tabs still say Beats. The beat store's "request exclusive
  rights" link (`/store?license=exclusive&beat=…`) still opens the old request form.
- **Homepage Shop card:** describes the three houses. RB admin hub tile id 3 (which overrides the built-in wording) was
  updated with the owner's OK on 29 Oct 2026:
  ```sql
  UPDATE hub_tiles SET subtitle='Apparel', blurb='The Soho Luxury Atelier, Slank Customs and Sports 4 All under one name.', image_url='https://media.relentlessbillionaire.com/atelier/atelier-hero-crop.webp' WHERE id=3;
  ```
- **Where it lives:** the page is `rb-site-updates/src/store/store.html`, applied by `patch_store.py` (in
  `deploy-all.sh`) and checked by `test/store.test.mjs`. The pictures are in `media.relentlessbillionaire.com/store/`.

## Soho (/soho): the luxury layer

The changes follow the patterns that luxury fashion sites use today:
- one hero image per fold;
- a serif headline over sans-serif text;
- an editorial edit of shoppable looks;
- close-up detail shots;
- quiet motion and no urgency;
- a private-client contact.

What was added:
- **The Edit:** three full-height looks with "Shop this look" buttons.
- **In detail:** close-up tiles with a slow zoom.
- **A private-client card.**
- **Details:**
  - an intro curtain with the monogram;
  - hero parallax, in browsers that support scroll-linked animation;
  - pictures that fade in from blur;
  - a magnifier in the quick view;
  - a gold cursor ring, on mouse and trackpad only;
  - smooth filter changes (view transitions);
  - a floating bag button;
  - balanced headline wrapping.
- **Reduced motion:** every motion stops for visitors who ask for less of it.

Sources:
- [redefineweb: luxury fashion e-commerce trends 2026](https://redefineweb.com/blog/luxury-fashion-ecommerce-web-design-trends-2026/)
- [Limely: minimalist luxury e-commerce sites](https://www.limely.co.uk/blog/top-10-minimalist-luxury-ecommerce-websites)
- [Awwwards: luxury](https://www.awwwards.com/websites/luxury/)

## RB Create, Cartoon & film: the AI Director

**What it does:** you type one idea, choose a length (3, 5 or 7 scenes) and 1–3 characters, and press **Make the whole
film**. It then:
- writes the script;
- draws each character and cuts it out of its background, finding the mouth automatically;
- paints every scene's background;
- voices every line, giving each character their own tone;
- composes an original score;
- edits the film, with camera moves, fades, a title card ("An RB Create film · made with AI"), captions and an end
  card.

**Pacing:** it keeps within the free AI tools' per-visitor limits, so a film takes about 3–4 minutes. When a tool says
"too many requests", it waits and carries on.

**If a step fails:** a missed picture or voice doesn't stop the film. The status line says what to add by hand.

**Options:**
- export the video automatically when the film is done;
- change everything afterwards in the editor.

**Bugs fixed:**
- **AI characters showed as white boxes.** They now get their plain background cut away. There is also a **Cut out**
  button for any character.
- **Editor timers were saved into projects.** This affected films and voiceovers.
- **The Record button label stayed on "Stop" after recording.**
- **The AI image, voice and text calls gave up on the first "too many requests".**

**Checks:** `test/director.test.mjs`, which is in the pipeline:
- the script reader repairs and caps what the model returns;
- the cut-out and the mouth finder work on a drawn figure;
- busy backgrounds are left alone;
- pacing waits out a busy answer and carries on.

With `--browser`, the whole run goes through Chromium against stand-in AI tools, one of which answers "busy" first. It
produces a 3-scene film with 2 cut-out characters, 3 backgrounds, 5 voiced lines, a score and titles. The film plays
with no errors.

## Deployed

29 Oct 2026, artist-router `024ed006` -> **`455c984d`** (code only). Checked live in Chromium at 1440 and 390 px:
/store, /soho and /create#film load with no console errors and no sideways scroll; the beat store's exclusive-rights
form still answers at `/store?license=exclusive&beat=…`; the homepage card reads "...Sports 4 All under one name."

## Rollback

artist-router, from Cloudflare > Workers > artist-router > Deployments: go back to `024ed006`. The hub tile can be put
back with `UPDATE hub_tiles SET subtitle='Beats & Apparel', blurb='GOT BEATS licensing and Slank Customs apparel — one
storefront.' WHERE id=3` (and its previous image_url).
