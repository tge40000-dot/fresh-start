#!/usr/bin/env bash
# Add ?surface= targeting to the live artist-router Worker.
#   ./rb-surface/deploy.sh            download the live bundle, patch it, run the tests (no upload)
#   ./rb-surface/deploy.sh --deploy   same, then upload the code (bindings, secrets and routes stay as they are)
# Needs CLOUDFLARE_API_TOKEN, curl, python3 and Node 22.5+ (node:sqlite).
set -euo pipefail
: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN}"
ACCOUNT=0a7be075f32d9d615349825b83ab8fcb
SCRIPT=artist-router
# Versions the patch applies to: the original, and the first surface deploy (patch.py skips edits already in place).
EXPECT_VERSIONS="37adc502-5550-4243-8453-98fc760393b9 54e08a43-e845-4d42-9976-36abdb05c958 e2e799e6-1dea-430d-83bb-533e77592fa3"
HERE=$(cd "$(dirname "$0")" && pwd)
WORK=$(mktemp -d)
API="https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/workers/scripts/$SCRIPT"
AUTH=(-H "Authorization: Bearer $CLOUDFLARE_API_TOKEN")

live=$(curl -fsS "${AUTH[@]}" "$API/deployments" \
  | python3 -I -c 'import sys,json; print(json.load(sys.stdin)["result"]["deployments"][0]["versions"][0]["version_id"])')
case " $EXPECT_VERSIONS " in
  *" $live "*) ;;
  *) echo "artist-router is on $live, not one of: $EXPECT_VERSIONS. Check the patch still applies."; exit 1 ;;
esac

curl -fsS "${AUTH[@]}" -D "$WORK/headers" -o "$WORK/body" "$API/content/v2"
python3 -I "$HERE/tools/split_multipart.py" "$WORK/headers" "$WORK/body" "$WORK/live" >/dev/null
mkdir -p "$WORK/build"
cp "$WORK/live/theme.js" "$WORK/build/theme.js"
python3 -I "$HERE/tools/patch.py" "$WORK/live/artist-router-v14.js" "$WORK/build/artist-router-v14.js"
node --check "$WORK/build/artist-router-v14.js"
node --no-warnings "$HERE/test/test.mjs" "$WORK/live/artist-router-v14.js"
node --no-warnings "$HERE/test/test.mjs" "$WORK/build/artist-router-v14.js" --expect-surface
node --no-warnings "$HERE/test/fresh.mjs" "$WORK/build/artist-router-v14.js"

if [ "${1:-}" != "--deploy" ]; then
  echo "Checks passed. Patched bundle: $WORK/build. Run with --deploy to upload it."
  exit 0
fi

curl -fsS "${AUTH[@]}" -X PUT "$API/content" \
  -F 'metadata={"main_module":"artist-router-v14.js"};type=application/json' \
  -F "artist-router-v14.js=@$WORK/build/artist-router-v14.js;filename=artist-router-v14.js;type=application/javascript+module" \
  -F "theme.js=@$WORK/build/theme.js;filename=theme.js;type=application/javascript+module" \
  | python3 -I -c 'import sys,json; d=json.load(sys.stdin); print("upload ok" if d.get("success") else d.get("errors"))'
curl -fsS "${AUTH[@]}" "$API/deployments" \
  | python3 -I -c 'import sys,json; v=json.load(sys.stdin)["result"]["deployments"][0]["versions"][0]; print("now live:", v["version_id"], v["percentage"], "%")'
echo "Previous version: $live (roll back from Workers > artist-router > Deployments)."
