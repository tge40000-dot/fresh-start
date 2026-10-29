# RB Studio: vocal tools (Prompt C), 29 Oct 2026

Code only. Nothing here is deployed yet. All of it is in RB Studio (`rb-daw`, studio.relentlessbillionaire.com and
relentlessbillionaire.com/record), in `workers/rb-daw/src`. Everything runs on the visitor's device: no audio is sent
anywhere, and no AI model is involved.

## What's new

**Four vocal chains** in each track's preset menu (Mixer):
- **Clean vocal** (already there).
- **Warm vocal:** gentle low cut, smooth compression, tube saturation, a room.
- **Radio-Ready vocal:** up-front mids and air, punchy compression, de-esser, a light console drive, a plate.
- **Aggressive vocal:** hard compression, tape drive, a double, a tight 1/16 delay.

Each one sets the same inserts the other presets use (EQ, compression mode, low cut, air, de-esser, saturation, gate,
reverb and delay), so every part can still be changed by hand afterwards.

**Clean-up & timing** (Editor, on any audio clip). Both make a new file; the take is never changed.
- **Noise reduction:**
  - It lowers steady noise (hiss, hum, a fan) by spectral subtraction. The noise is learned from the quietest tenth of the take.
  - The Noise slider sets how deep it goes, from 6 dB at the light end to 24 dB at the strong end.
  - Gains open at once and close gently, and are smoothed across neighbouring frequencies, which keeps the warbling "musical noise" down.
  - Stereo takes get the same gains on both sides.
  - It refuses honestly in two cases. If the take has no quiet moment, it doesn't learn the voice as noise; it says so and changes nothing. If the noise is already below -78 dBFS, there's nothing to remove.
- **Timing:**
  - "Tighten to 1/8 notes" or "1/16 notes" moves each sung phrase, whole, toward the nearest grid line of the song's tempo. A phrase is a run of sound with gaps of 120 ms or more around it.
  - Nothing inside a phrase is stretched or cut.
  - A phrase never moves more than half the gap to its neighbours, and its edges fade over 5 ms in that gap.
  - The Tighten slider sets how far toward the grid each phrase moves.
- **Status line:**
  - It reports what happened, from the measurements. For example: "noise was -54 dBFS, now 14 dB lower; 6 of 7 phrases moved toward the 1/8 grid, 18 ms on average (most 47 ms)".
  - The same summary stays in the panel.
- **Original always one click away:**
  - **Turn off** brings the take back.
  - **▶ Original** and **▶ Processed** play the clip's two versions dry, so you can compare them directly.
  - AutoPitch (already there) now sits on top of the clean-up. Redoing or turning off the clean-up redoes AutoPitch with the same settings, and turning off AutoPitch keeps the clean-up.

**Comping takes.** Loop recording already made one take per pass.
- Under the takes there's now a grid: one column per bar of the song, one row per take. Pick the best take for each bar, then press **Build comp**.
- Where the take changes, the comp joins them with a 10 ms equal-power crossfade.
- The takes are kept. Picking a single take again plays that take.
- "Keep this comp" deletes the takes that aren't used.
- Clean-up and AutoPitch, if on, are redone on the new comp.
- Picking a single take turns them off for it, so auditioning is instant. Their settings are kept for the next Apply.

## Latency and speed

- **Nothing here adds latency to recording or playback.** These are offline renders of a finished take. The live
  chain, monitoring and latency compensation are unchanged.
- **Render time:**

  | Step | Time (this cloud machine, one core) |
  | --- | --- |
  | Noise reduction, 60 s mono vocal | about 1.2 s |
  | Noise reduction, 60 s stereo | about 2.6 s |
  | Timing, 60 s | about 0.05 s |
  | 3 takes × 4 bars: comp plus clean-up together, in Chromium | 0.4–0.6 s |

- The status line shows a percentage while noise reduction runs, and the page stays responsive.
- Phones will be slower; this wasn't measured on one.

## Fallbacks and limits, said plainly

- **Noise reduction:**
  - It handles steady noise. Noise that comes and goes (traffic, a door, a voice in the next room) isn't learned and stays.
  - Strong settings on very noisy takes can still sound slightly hollow; that's what the ▶ buttons are for.
  - With no quiet moment to learn from, it doesn't run. If timing was also asked for, the timing still runs.
- **Timing:**
  - It moves phrases, not syllables. Lines sung without a 120 ms breath between them count as one phrase and move together.
  - It follows the song's tempo, not the beat audio. Set the BPM first ("Detect tempo & key" finds it).
- **Comping:**
  - It works on loop takes, which all line up with the loop.
  - Takes recorded separately aren't comped; drag them onto separate tracks and use mute instead.
  - If the tempo or the clip moves after picking, the grid asks you to pick again.
- **Not WASM or ONNX.** The plan suggested WASM or ONNX models. This is plain JavaScript DSP on the studio's own FFT. It needs no download and works in every browser the studio already supports. A learned noise model (e.g. RNNoise-style) would handle changing noise better; it would be a ~100–200 KB download and a separate decision.
- **No quality claims.** Nothing here was compared with Suno or any other product, and the page says nothing of the kind.

## Generative audio and the AI limits

- RB Studio itself calls no AI model. Its lyric and vocal helpers go through `relentless-billionaire-api` (`/ai/studio/*`), and AI Forge music through `rb-studio`. Both are checked against the operator's rules and logged since the AI limits work (pull request #8).
- The two Workers listed there as not wired yet are unchanged: `relentless-studio`'s two lyric calls and `rb-cloud`.

## Mastering: reference matching

- **Reference matching already exists** on the mastering page (`rb-mastering-studio`, relentlessbillionaire.com/studio, "Match a reference"):
  - you load a track you love, and the page measures its spectrum and loudness on your device;
  - the tonal correction then aims at it instead of the genre curve;
  - "Clear" goes back to the genre master.
- **Already additive.** The free genre master stays the default, and the measured suggestions and meters are untouched.
- **It's measurement, not AI.** It's described as reference matching, not as AI, and that's accurate.
- **No change made.** It is a paid member feature once checkout goes live, so changing it touches the paywall. Under the ground rules (no Stripe or pricing changes without the owner's OK), this pass leaves it as it is.

## Checked

- **`rb-site-updates/test/studio-vocal.test.mjs`** (in the pipeline), on sounds whose answer is known:
  - Noise reduction:
    - hiss at -50 dBFS comes down 15 dB;
    - the voice keeps its level within 1 dB and its shape (correlation above 0.99);
    - stereo gets the same gains on both sides;
    - it refuses on clean takes, takes with no quiet moment, and very short takes.
  - Timing:
    - four phrases sung 20–60 ms off the grid land within 6 ms of it;
    - their samples are moved, not changed;
    - at half strength they move half as far;
    - a phrase 40 ms from its neighbour moves at most 20 ms.
  - Comping: the right take in each bar, no step larger than 0.001 at the joins, equal-power crossfades.
  - Bar lines for clips that start mid-bar or are trimmed.
  - The page wiring.
- **`node workers/rb-daw/test.mjs`:** the build, every module parses, the existing blocks are present once.
- **`rb-site-updates/test/browser/studio-vocal.mjs`**, in Chromium with a phrase-and-hiss file as the microphone (`RB_FAKE_WAV`):
  - loop-recorded 3 takes over 4 bars at 180 BPM;
  - built a comp (bar 1 take 1, bar 2 take 2, bars 3–4 take 3);
  - clean-up on the comp: noise 14 dB lower, 6 of 7 phrases moved 18 ms on average;
  - played the dry original and stopped it;
  - turned clean-up off, then picked a single take again;
  - found the four vocal chains in the menu;
  - no page errors.

## Deploy

- **Command:** `./deploy-all.sh --deploy` builds and uploads `rb-daw` with `workers/rb-daw/deploy.sh`.
- **Safety check:** the upload refuses if live isn't `f1d00978` (`workers/rb-daw/live.json`), so an edit made in the dashboard is never overwritten.
- **Roll back:** Cloudflare > Workers > rb-daw > Deployments, to `f1d00978` (the version before this). After deploying, `live.json` records the new version and keeps the old one as `previous`.
- **Saved projects:**
  - Projects saved before this open unchanged.
  - Projects saved with a comp or clean-up still open in the older studio after a rollback. It plays the processed file and ignores the extra fields; the takes and the original are still in the project.
