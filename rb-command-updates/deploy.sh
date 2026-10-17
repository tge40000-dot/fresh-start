#!/usr/bin/env bash
# More site colours and the Affiliate ads screen.
#   ./rb-command-updates/deploy.sh            pull the four Workers, patch them, run every test (no upload)
#   ./rb-command-updates/deploy.sh --deploy   same, then upload code only (bindings, secrets, routes stay)
# Order: the sites that draw the colours first (rb-public-content, rb-radio, artist-router), then RB Command,
# so no screen can offer a colour the sites don't know yet.
# Needs CLOUDFLARE_API_TOKEN, python3 and Node 22.5+.
set -euo pipefail
: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN}"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
WORKERS="rb-public-content rb-radio artist-router rb-command"

for s in $WORKERS; do python3 -I "$ROOT/rb-tools/cfworker.py" pull "$s" "$WORK/$s"; done
for s in $WORKERS; do python3 -I "$ROOT/rb-tools/palettes.py" "$WORK/$s"; done
python3 -I "$ROOT/rb-command-updates/patch_rb_command.py" "$WORK/rb-command"

for s in $WORKERS; do for f in "$WORK/$s"/*.js; do node --check "$f"; done; done
node --no-warnings "$ROOT/rb-command-updates/test/palettes.mjs" "$WORK/rb-command/theme.js" | tail -1
node --no-warnings "$ROOT/rb-command-updates/test/affiliate.test.mjs" "$WORK/rb-command"
node --no-warnings "$ROOT/rb-surface/test/test.mjs" "$WORK/artist-router/artist-router-v14.js" --expect-surface
node --no-warnings "$ROOT/rb-surface/test/fresh.mjs" "$WORK/artist-router/artist-router-v14.js"
for s in rb-public-content rb-radio artist-router; do
  grep -q 'sapphire: { label: "Sapphire"' "$WORK/$s/theme.js" || { echo "$s: palettes missing"; exit 1; }
done

if [ "${1:-}" != "--deploy" ]; then
  echo "Checks passed. Patched Workers: $WORK. Run with --deploy to upload them."
  exit 0
fi
for s in $WORKERS; do python3 -I "$ROOT/rb-tools/cfworker.py" push "$s" "$WORK/$s"; done
echo "Deployed. Previous versions are in $WORK/*/deployed.json; roll back from Workers > <name> > Deployments."
