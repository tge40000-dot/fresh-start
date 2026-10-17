#!/usr/bin/env bash
# The Analytics screen for RB Command (Cloudflare Web Analytics and Workers analytics).
#   ./rb-command-updates/deploy-analytics.sh            pull rb-command, patch it, run every test (no upload)
#   ./rb-command-updates/deploy-analytics.sh --deploy   same, then upload code only (bindings, secrets, routes stay)
# The colour, Affiliate ads and Show planner patches run first; they're already live, so they change nothing.
# The screen needs the CF_ANALYTICS_TOKEN secret on rb-command (see README); without it, it shows how to add one.
# Needs CLOUDFLARE_API_TOKEN, python3 and Node 22.5+.
set -euo pipefail
: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN}"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)

python3 -I "$ROOT/rb-tools/cfworker.py" pull rb-command "$WORK/rb-command"
python3 -I "$ROOT/rb-tools/palettes.py" "$WORK/rb-command"
for p in patch_rb_command patch_show_planner patch_analytics; do python3 -I "$ROOT/rb-command-updates/$p.py" "$WORK/rb-command"; done

for f in "$WORK/rb-command"/*.js; do node --check "$f"; done
node --no-warnings "$ROOT/rb-command-updates/test/palettes.mjs" "$WORK/rb-command/theme.js" | tail -1
for t in affiliate showplanner analytics; do node --no-warnings "$ROOT/rb-command-updates/test/$t.test.mjs" "$WORK/rb-command"; done

if [ "${1:-}" != "--deploy" ]; then
  echo "Checks passed. Patched Worker: $WORK/rb-command. Run with --deploy to upload it."
  exit 0
fi
python3 -I "$ROOT/rb-tools/cfworker.py" push rb-command "$WORK/rb-command"
echo "Deployed. The previous version is in $WORK/rb-command/deployed.json; roll back from Workers > rb-command > Deployments."
