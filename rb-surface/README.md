# RB ad surface targeting

Adds `?surface=` to `GET /api/ads` on relentlessbillionaire.com so an ad can be kept to the home page, RB Radio or RB TV.

## Where it lives

`/api/ads` is served by the **artist-router** Worker (route `relentlessbillionaire.com/*`), which reads the `ads` table in the `waitlist-db` D1 database. The same Worker also serves `/api/ads/event`, `/api/ads/impression`, `/api/ads/click`, `/api/ads/save`, `/api/ads/delete` and `/go/ad/<id>`.

The original package proposed a separate `rb-ads` Worker on the route `relentlessbillionaire.com/api/ads*` with its own new D1 database. That route would also catch every `/api/ads/...` endpoint above and answer them with 404, which would break ad measurement and the admin save and delete actions. Its handler also dropped the existing slot, weight, schedule and impression-cap rules, and served a stale copy of the ads (ad 4 linked to `/studio`, but the database has `/home`). So the feature is added to artist-router instead, as a small patch on the live code.

## Behaviour

`GET /api/ads?slot=rail|spotlight&surface=home|radio|tv|all`

- No `surface`, or `surface=all`: every live ad, exactly as before. Clicks stay `/go/ad/<id>?s=rail` (or `?s=spotlight`), so the home page does not change.
- `home`, `radio`, `tv`: ads whose surface is that value or `all`. The click becomes `/go/ad/<id>?s=<surface>-<slot>`, for example `?s=radio-rail`, and `/go/ad` now keeps the hyphen in `utm_content`.
- Any other value: `400 {"ok":false,"error":"surface must be home, radio, tv, or all"}`.
- Each ad keeps its existing fields and adds `surface`. The response also echoes the `surface` it used.
- Slot, `skip`, weights, start/end dates, `max_impressions`, the shuffle and `Cache-Control: no-store` all work as before.
- `/api/signal` `liveAds` still counts every live ad, on any surface.

`POST /api/ads` with `{"id": 4, "surface": "radio"}` sets an ad's surface. It uses the Worker's existing admin check: Cloudflare Access sign-in, or the `X-API-Key` header set to `ADMIN_API_KEY`. No new secret is needed. It returns 401 without admin access, 400 for a missing or invalid `id` or `surface`, and 404 for an unknown id. The admin "Sell an Ad Slot" form doesn't send `surface`, so saving an ad there keeps the surface it already has.

Every existing ad starts as `all`, so nothing changes on the site until a surface is set.

## What it doesn't do yet

- The home page still calls `/api/ads` without `surface`, so it shows every ad, including ones set to `radio` or `tv`. That keeps the home page unchanged, as the package asked. To keep radio-only and TV-only ads off home, the home rails would need to request `surface=home` (their clicks would then read `?s=home-rail`).
- The RB Radio (`rb-radio`) and RB TV (`rb-tv`) Workers don't call `/api/ads` at all today. `surface=radio` and `surface=tv` have no visible effect until those pages get an ad rail.
- Not caused by this change: the admin form's Placement list has no "spotlight" option, so editing ad 1 or ad 6 there moves it to the sidebar rail.

## Files

- `artist-router-surface.patch`: the change, as a diff against the live bundle (version `37adc502`).
- `tools/patch.py`: applies the change to a downloaded bundle. Each anchor must match exactly once, or it stops.
- `tools/split_multipart.py`: splits a downloaded Worker bundle into its module files.
- `test/test.mjs`: runs the real Worker against an in-memory copy of the ads table. With `--expect-surface` it checks the new behaviour. Without it, it checks the old behaviour still holds.
- `test/fresh.mjs`: checks that the schema bump (`artist-router-v14.3`) adds the column on a database that doesn't have it yet.
- `deploy.sh`: downloads the live bundle, checks it is still `37adc502`, patches it, and runs all the tests. With `--deploy` it then uploads code only, so bindings, secrets and routes stay as they are.

## Status (15 Oct 2026)

- Done: `ALTER TABLE ads ADD COLUMN surface TEXT NOT NULL DEFAULT 'all'` on `waitlist-db`. All six ads are `all`.
- Deployed: artist-router version `54e08a43-e845-4d42-9976-36abdb05c958` is live at 100%. It replaced `37adc502-5550-4243-8453-98fc760393b9`.
- Checked live after the deploy:
  - `/api/ads?slot=rail` returns ads 2 and 4 with `?s=rail` and `surface: "all"`.
  - `surface=radio` gives `?s=radio-rail`.
  - `surface=nope` returns 400, and an unauthenticated POST returns 401.
  - `/go/ad/2?s=radio-rail` redirects with `utm_content=radio-rail`.
  - `/`, `/home`, `/api/signal`, `/radio` and `/tv` return 200.

`deploy.sh` now stops at its version check, because `37adc502` is no longer live. That's on purpose, so the patch can't be applied twice.

To check again:

```bash
curl -s 'https://relentlessbillionaire.com/api/ads?slot=rail' | grep -c '"surface": "all"'      # every ad, now with surface
curl -s -o /dev/null -w '%{http_code}\n' 'https://relentlessbillionaire.com/api/ads?surface=nope'  # 400
curl -s 'https://relentlessbillionaire.com/api/ads?slot=rail&surface=radio' | grep 'radio-rail'   # radio click slot
```

## Undo

- Code: Cloudflare dashboard → Workers → artist-router → Deployments → version `37adc502` → Deploy.
- Column: harmless to leave, since the old code ignores it. To remove it: `ALTER TABLE ads DROP COLUMN surface`.
