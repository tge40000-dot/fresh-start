#!/usr/bin/env bash
# The Show planner for RB Command.
#   ./rb-command-updates/deploy-show-planner.sh            pull rb-command, patch it, run every test (no upload)
#   ./rb-command-updates/deploy-show-planner.sh --deploy   same, then upload code only (bindings, secrets, routes stay)
# The colour and Affiliate ads patches run first; they're already live, so they change nothing.
# Needs CLOUDFLARE_API_TOKEN, python3 and Node 22.5+.
set -euo pipefail
: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN}"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)

python3 -I "$ROOT/rb-tools/cfworker.py" pull rb-command "$WORK/rb-command"
python3 -I "$ROOT/rb-tools/palettes.py" "$WORK/rb-command"
python3 -I "$ROOT/rb-command-updates/patch_rb_command.py" "$WORK/rb-command"
python3 -I "$ROOT/rb-command-updates/patch_show_planner.py" "$WORK/rb-command"

for f in "$WORK/rb-command"/*.js; do node --check "$f"; done
node --no-warnings "$ROOT/rb-command-updates/test/palettes.mjs" "$WORK/rb-command/theme.js" | tail -1
node --no-warnings "$ROOT/rb-command-updates/test/affiliate.test.mjs" "$WORK/rb-command"
node --no-warnings "$ROOT/rb-command-updates/test/showplanner.test.mjs" "$WORK/rb-command"

if [ "${1:-}" != "--deploy" ]; then
  echo "Checks passed. Patched Worker: $WORK/rb-command. Run with --deploy to upload it."
  exit 0
fi
python3 -I "$ROOT/rb-tools/cfworker.py" push rb-command "$WORK/rb-command"
echo "Deployed. The previous version is in $WORK/rb-command/deployed.json; roll back from Workers > rb-command > Deployments."
