# RB Create > Cartoon & film: the upgrade (Prompt B), 29 Oct 2026

Code only. Nothing here is deployed yet. RB Create is one page served by `artist-router`
(`rb-site-updates/src/create/create.html`); this changes only the page. It relies on the AI limits work (pull
request #8) for looks and shapes on AI pictures, so it deploys with or after that.

## What's new

**AI pictures through one service, with a look.**
- Every AI picture goes through `aiService.image({prompt, style, aspect})`, and the operator's rules in RB Command >
  AI limits apply on the server before any model runs.
- A film now has a **look for AI backgrounds**: none, Dark Luxury, Cinematic Night, Hip-Hop Editorial or Photoreal.
  Backgrounds are drawn in the film's own shape (16:9, 9:16 or 1:1, about one megapixel) instead of a square.
- AI characters are drawn tall (3:4) with no look, so their plain background stays clean for cutting out. The status
  line says which look was used, since the operator can lock one in.

**Lip-sync from the voice.**
- Each line's audio is read 60 times a second. Loudness says how open the mouth is, and the balance of low, middle and
  high sound picks one of 8 mouth shapes: rest, pressed lips (M, B, P), A, I, E, O, U, and S/F with teeth.
- The mouth is drawn at the mouth point, and the shapes blend into each other.
- Lines with no audio get shapes from their letters.
- **It reads sound, not words.** It's a close match, not phoneme recognition. On test sounds with known shapes, every
  one came out right, including a 50 ms gap read as pressed lips.
- **Manual override stays.** In each character's Mouth dialog: "Shapes from the voice" or the old "Open and close".
  A second, mouth-open picture still swaps in on loud sounds, as before.

**Four new camera moves.** The background and the characters are now separate layers, so moves have depth:
- **Dolly in:** the characters come closer faster than the background.
- **Orbit:** they slide past each other as if the camera circles.
- **Rack focus:** the background starts sharp, then focus pulls to the characters.
- **Moving light:** a warm key light crosses the frame, with a vignette.

The seven old moves look exactly as before.

**Export.**
- 1080p by default (720p still offered): 1920×1080, 1080×1920 or 1080×1080. Video at 14 Mbit/s for 1920×1080 and 1080×1920 (9 Mbit/s for square and 720p), audio at 192 kbit/s.
- Each frame is handed to the recorder as it's drawn, timed by the audio clock, so picture and sound stay together. Before, the recorder sampled the canvas on its own clock.
- Voice lines are evened out to the same speaking level (never past -1 dBFS peaks), and a soft limiter on the mix stops clipping.
- If the tab goes into the background mid-export, the export stops with a clear message instead of finishing out of sync.
- The Voice & visualizer tool's export gets the frame timing too.

**Switches.** Each new path can be turned off in one browser, for comparison or if something misbehaves:
`localStorage.rb_create_flags = '{"visemes":false,"cams":false,"hq":false}'` (any of the three).

## What isn't here, and why

- **AI video clips (image-to-video) for backgrounds and B-roll.** Workers AI has no free video model. The paid ones
  (Seedance, Veo and others) are on the AI Forge, operator only. Making them a free public button in Film would put
  paid video renders behind a free tool, and that's a money decision for the owner. **Today:** make a clip in the AI
  Forge and add it to the library. Film already plays video backgrounds and video characters, and exports them.
  Building a public button behind the AI limits switches and daily caps is a small addition once the owner says yes.
- **Faster-than-real-time export.** Rendering offline with WebCodecs would need an MP4 muxer in the page; export stays
  real time.
- **Consistent characters across AI pictures** (reference images). The public picture model doesn't take references.
- **"Imagine-class" quality claims.** Not made here: output quality depends on the model behind `/ai/platform/image`
  (FLUX.2 klein), which this doesn't change.

## Checked

- `rb-site-updates/test/film.test.mjs` (in the pipeline):
  - mouth shapes from synthetic sounds whose shapes are known (O, A, E, S, rest, pressed lips);
  - shapes from text;
  - every shape draws;
  - the page wiring.
- `create.test.mjs` on the live `artist-router` with the new page embedded: strict CSP, nonces, no inline attributes, scripts parse.
- End to end in Chromium:
  - built a film (an AI character with a mouth point, a Cinematic Night AI background, an AI voice line, Dolly in);
  - played it, then exported it;
  - the export is a 1920×1080, 3.8-second file with 48 kHz audio, and the page reported no errors.
  - The cloud test browser has no GPU and drew about 10 frames a second; a normal computer draws 60. Every frame still carries its true time, so the sound stays in sync either way.
  - Headless Chromium has no H.264 encoder, so it recorded VP9; desktop Chrome and Safari record H.264, as before.

## Deploy

`./deploy-all.sh --deploy` re-embeds the page in `artist-router` (`patch_artist_router_create.py`). Roll back
`artist-router` from Cloudflare > Workers > artist-router > Deployments; per the 28 Oct session summary its live
version then was `286df164`. Projects saved in visitors' browsers keep working either way: the new fields (look,
quality, mouth mode) are simply ignored by the older page.
