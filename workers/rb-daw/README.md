# RB Studio (rb-daw)

The browser DAW at studio.relentlessbillionaire.com and relentlessbillionaire.com/record. It was built in Cloudflare;
this folder is now its source. Edit here, then deploy with `./deploy.sh`.

| Path | What it is |
| --- | --- |
| `src/index.js` | The Worker: routes, the page, assets, projects and files API (D1 `DB`, R2 `MEDIA`), beats, legacy pages. |
| `src/shell.html` | The page. `index.js` fills in `{{BASE}}`, `{{CANONICAL}}`, `{{BUILD}}` and `{{THEME_LINK}}`. |
| `src/assets/main.js` | The studio app: engine, mixer, editors, recording, export, plugins, track-area bar, value boxes. |
| `src/assets/daw.css` | Its styles, including the luxe layer (all colours are the site palette variables). |
| `src/assets/fx-worklet.js`, `rec-worklet.js` | Audio-thread code: gate, de-esser, crunch, and the recorder. |
| `assets.json` | Which files are served from `/daw/assets/` and their content types. |
| `live.json` | The Cloudflare version this folder was last deployed as. |
| `build.mjs` | Packs `src/` into `dist/index.js` and `dist/assets.js` (what Cloudflare runs). |

`main.js` came from Cloudflare minified, so names are short (`g` is the audio engine, `r` the app state, `R()` redraws a
part of the page, `x()` makes a change with an undo point, `D` the undo history, `l()` builds an element). It is now
formatted for reading, and the blocks added since are commented. In `main.js`, `__BUILD__` is replaced by the build hash
(the worklet cache keys).

## Commands

```sh
node build.mjs                                   # build dist/
./deploy.sh --check                              # build and compare with live (exit 1 if they differ)
./deploy.sh                                      # build, check live wasn't changed elsewhere, upload, update live.json
node ../../rb-site-updates/test/browser/studio-controls.mjs "$PWD/dist"    # browser checks on a local build
node ../../rb-site-updates/test/browser/studio-recording.mjs "$PWD/dist"   #   (add {"type":"module"} as dist/package.json first)
```

`deploy.sh` refuses to upload if the live version isn't the one in `live.json`, so an edit made in the Cloudflare
dashboard is never overwritten: pull it (`python3 rb-tools/cfworker.py pull rb-daw <dir>`), bring the change into `src/`,
and set `live.json` to that version first.

## History

Before this folder existed, the studio was changed with patch scripts applied to the live bundle
(`rb-site-updates/patch_daw_plugins.py`, `patch_daw_record_fix.py`, `patch_daw_luxe.py`). Their changes are all in
`src/` now, and `deploy-all.sh` no longer patches rb-daw. On 18 Oct 2026, `src/` was unpacked from live version
`ac24d1ca` and rebuilt byte for byte (apart from the build hash), then `main.js` and `daw.css` were formatted; their
syntax trees and CSS rules are identical to the minified originals.
