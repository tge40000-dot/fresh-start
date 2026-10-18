#!/usr/bin/env bash
# Everything in this repo, in one go: pull each Worker live, apply every patch, run every test.
#   ./deploy-all.sh            checks only (nothing is uploaded)
#   ./deploy-all.sh --deploy   then upload code only (bindings, secrets and routes stay as they are), in this order:
#     artist-router (post links, the ad slot files) -> rb-radio and rb-tv (ad slots) -> rb-command -> rb-email,
#     then the relentless-billionaire.pages.dev redirect and rb-command's daily schedule.
# RB Radio is skipped while a live show is on air. Needs CLOUDFLARE_API_TOKEN, python3, Node 22.5+ and npx.
set -euo pipefail
: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN}"
ROOT=$(cd "$(dirname "$0")" && pwd)
W=$(mktemp -d)
ACCOUNT=0a7be075f32d9d615349825b83ab8fcb
py() { python3 -I "$@"; }

for s in rb-public-content artist-router rb-radio rb-tv rb-command rb-email rb-mastering-studio rb-daw relentless-billionaire-api rb-radio-hub rb-autopilot; do py "$ROOT/rb-tools/cfworker.py" pull "$s" "$W/$s"; done
# the AI Forge lives in the RB account
CF_ACCOUNT_ID=b72a2e342f81d93bf047e568374dab0e py "$ROOT/rb-tools/cfworker.py" pull rb-studio "$W/rb-studio"
# artist-router: colours (no-op once live), post links and the ad slot
py "$ROOT/rb-tools/palettes.py" "$W/artist-router"; py "$ROOT/rb-site-updates/patch_artist_router.py" "$W/artist-router"; py "$ROOT/rb-site-updates/patch_home_status.py" "$W/artist-router"
# RB Create at /create; /record and /studio may be framed by their own site; the free AI voice it uses
py "$ROOT/rb-site-updates/patch_artist_router_create.py" "$W/artist-router"
# RB Collect (/rewards): ships switched off with draft prizes; the owner turns it on in RB Command > Rewards
py "$ROOT/rb-site-updates/patch_rewards.py" "$W/artist-router"
for s in rb-daw rb-mastering-studio; do py "$ROOT/rb-site-updates/patch_embed_create.py" "$W/$s"; done
# /record plugins and mobile clip tools: test on the unpatched app, then the patch (bumps BUILD)
# (the test needs the app as it was before the patch; once live has it, the patch re-run is a no-op and is checked below)
if grep -q "fx-worklet.js" "$W/rb-daw/assets.js"; then echo "rb-daw: plugins already live"; else node "$ROOT/rb-site-updates/test/daw-plugins.test.mjs" "$W/rb-daw" | tail -1; fi
py "$ROOT/rb-site-updates/patch_daw_plugins.py" "$W/rb-daw"
py "$ROOT/rb-site-updates/patch_ai_speech.py" "$W/relentless-billionaire-api"
py "$ROOT/rb-site-updates/patch_ai_image.py" "$W/relentless-billionaire-api"
py "$ROOT/rb-site-updates/patch_ai_limit.py" "$W/relentless-billionaire-api"
py "$ROOT/rb-site-updates/patch_radio.py" "$W/rb-radio"; py "$ROOT/rb-site-updates/patch_radio_flow.py" "$W/rb-radio"
# every palette restyles all of RB Radio (page, bar, RB Flow, hub pages)
for s in rb-radio rb-radio-hub rb-public-content rb-command artist-router; do py "$ROOT/rb-site-updates/patch_radio_colours.py" "$W/$s"; done
# AI Forge beats reach the player and RB Radio
py "$ROOT/rb-site-updates/patch_beat_publish.py" "$W/rb-studio"; py "$ROOT/rb-site-updates/patch_beat_publish.py" "$W/rb-autopilot"
py "$ROOT/rb-site-updates/patch_tv.py" "$W/rb-tv"
py "$ROOT/rb-site-updates/patch_studio.py" "$W/rb-mastering-studio"
# studio plug-ins: the test compares against the unpatched engine (bit-identical when no plug-in is ticked), then the patch
node "$ROOT/rb-site-updates/test/studio-plugins.test.mjs" "$W/rb-mastering-studio" | tail -1
py "$ROOT/rb-site-updates/patch_studio_plugins.py" "$W/rb-mastering-studio"
# custom palettes from the builder: every copy of theme.js learns them (consumers are deployed before rb-command)
for s in rb-public-content artist-router rb-radio rb-command; do py "$ROOT/rb-tools/patch_theme_custom.py" "$W/$s"; done
# rb-command: every patch, in order; each skips what's already there and drops copies an older script added twice
py "$ROOT/rb-tools/palettes.py" "$W/rb-command"
for p in patch_rb_command patch_show_planner patch_planner_links patch_analytics patch_rehost patch_nav patch_scheduled patch_signal patch_lux_ui patch_palette_builder patch_video patch_create_upload patch_rewards_admin; do py "$ROOT/rb-command-updates/$p.py" "$W/rb-command"; done
# rb-email: the forwarder replaces Cloudflare's sample
cp "$ROOT/rb-email/src/index.js" "$W/rb-email/index.js"

for s in rb-public-content artist-router rb-radio rb-tv rb-command rb-email rb-mastering-studio rb-daw relentless-billionaire-api rb-radio-hub rb-autopilot rb-studio; do for f in "$W/$s"/*.js; do node --check "$f"; done; done
T="$ROOT/rb-command-updates/test"
node "$T/no-duplicates.mjs" "$W/rb-command"
node --no-warnings "$T/palettes.mjs" "$W/rb-command/theme.js" | tail -1
for t in affiliate showplanner analytics rehost scheduled signal; do node --no-warnings "$T/$t.test.mjs" "$W/rb-command"; done
node "$T/create-upload.test.mjs" "$W/rb-command"
node --no-warnings "$T/rewards-admin.test.mjs" "$W/rb-command"
node --no-warnings "$ROOT/rb-surface/test/test.mjs" "$W/artist-router/artist-router-v14.js" --expect-surface
node --no-warnings "$ROOT/rb-surface/test/fresh.mjs" "$W/artist-router/artist-router-v14.js"
node --no-warnings "$ROOT/rb-site-updates/test/post-link.test.mjs" "$W/artist-router/artist-router-v14.js"
node --no-warnings "$ROOT/rb-site-updates/test/create.test.mjs" "$W/artist-router/artist-router-v14.js"
node --no-warnings "$ROOT/rb-site-updates/test/rewards.test.mjs" "$W/artist-router/artist-router-v14.js" | tail -c 120
node --no-warnings "$ROOT/rb-site-updates/test/ai-limit.test.mjs" "$W/relentless-billionaire-api/script.js"
node --no-warnings "$ROOT/rb-site-updates/test/radio-tv.test.mjs" "$W/rb-radio" "$W/rb-tv"
node "$ROOT/rb-site-updates/test/flow.test.mjs" "$W/rb-radio"
node "$ROOT/rb-site-updates/test/studio.test.mjs" "$W/rb-mastering-studio"
node "$ROOT/rb-tools/test/custom-palettes.mjs" "$W/rb-command" "$W/rb-public-content" "$W/rb-radio" "$W/artist-router"
node "$ROOT/rb-email/test/test.mjs"

if [ "${1:-}" != "--deploy" ]; then echo "Checks passed. Patched Workers: $W. Run with --deploy to upload them."; exit 0; fi

py "$ROOT/rb-tools/cfworker.py" push rb-public-content "$W/rb-public-content"
# what /create calls or frames goes first
py "$ROOT/rb-tools/cfworker.py" push relentless-billionaire-api "$W/relentless-billionaire-api"
py "$ROOT/rb-tools/cfworker.py" push rb-daw "$W/rb-daw"
py "$ROOT/rb-tools/cfworker.py" push rb-mastering-studio "$W/rb-mastering-studio"
py "$ROOT/rb-tools/cfworker.py" push rb-autopilot "$W/rb-autopilot"
CF_ACCOUNT_ID=b72a2e342f81d93bf047e568374dab0e py "$ROOT/rb-tools/cfworker.py" push rb-studio "$W/rb-studio"
py "$ROOT/rb-tools/cfworker.py" push rb-radio-hub "$W/rb-radio-hub"
py "$ROOT/rb-tools/cfworker.py" push artist-router "$W/artist-router"
if curl -fsS -m 20 https://relentlessbillionaire.com/radio/api/now | python3 -c 'import json,sys; d=json.load(sys.stdin); sys.exit(0 if d.get("live") else 1)'; then
  echo "rb-radio: a live show is on air, so it's skipped. Run this again after the show."
else
  py "$ROOT/rb-tools/cfworker.py" push rb-radio "$W/rb-radio"
fi
py "$ROOT/rb-tools/cfworker.py" push rb-tv "$W/rb-tv"
py "$ROOT/rb-tools/cfworker.py" push rb-command "$W/rb-command"
py "$ROOT/rb-tools/cfworker.py" push rb-email "$W/rb-email"
# The old Pages copy: one deployment that redirects every path to the main site (earlier deployments stay, for rollback)
(cd /tmp && CLOUDFLARE_ACCOUNT_ID=$ACCOUNT npx --yes wrangler@3.114.0 pages deploy "$ROOT/rb-site-updates/pages-redirect" --project-name relentless-billionaire --branch allme --commit-dirty=true)
# rb-command's daily run: 14:52 UTC (7:52 AM in the Bay Area in summer, 6:52 AM in winter)
curl -fsS -m 30 -X PUT "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/workers/scripts/rb-command/schedules" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" --data '[{"cron":"52 14 * * *"}]' >/dev/null && echo "rb-command: daily schedule set"
echo "Deployed. Previous versions are in $W/*/deployed.json; roll back from Workers > <name> > Deployments."
