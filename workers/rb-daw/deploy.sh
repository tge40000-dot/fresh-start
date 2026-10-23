#!/usr/bin/env bash
# Deploy RB Studio (rb-daw) from this folder: build, check nobody changed it in the Cloudflare dashboard, upload, record
# the new version. Code only: bindings, secrets and routes stay as they are. Needs CLOUDFLARE_API_TOKEN.
#   ./deploy.sh          build + drift check + upload
#   ./deploy.sh --check  build + drift check only (exit 1 if live differs from src/)
# Undo: the previous version is printed and kept in git history of live.json; roll back to it in the Cloudflare dashboard.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
node "$HERE/build.mjs"
python3 -I "$ROOT/rb-tools/cfworker.py" pull rb-daw "$TMP/live" >/dev/null
LIVE_VER="$(python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1]))["version"])' "$TMP/live/manifest.json")"
WANT_VER="$(python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1]))["version"])' "$HERE/live.json")"
if [ "$LIVE_VER" != "$WANT_VER" ]; then
  echo "rb-daw: live is version $LIVE_VER but live.json says $WANT_VER: it was changed outside this folder." >&2
  echo "        Pull it, bring the change into src/, and update live.json before deploying." >&2
  exit 1
fi
if node "$HERE/build.mjs" --compare "$TMP/live"; then
  [ "${1:-}" = "--check" ] && exit 0
  echo "rb-daw: nothing to deploy (live already matches src/)."
  exit 0
fi
[ "${1:-}" = "--check" ] && exit 1
OUT="$(python3 -I "$ROOT/rb-tools/cfworker.py" push rb-daw "$HERE/dist")"
echo "$OUT"
NEW_VER="$(echo "$OUT" | sed -n 's/.*-> \([0-9a-f-]\{36\}\).*/\1/p')"
[ -n "$NEW_VER" ] || { echo "rb-daw: couldn't read the new version from the upload output" >&2; exit 1; }
python3 -I - "$HERE/live.json" "$NEW_VER" <<'EOF'
import json, sys
p, v = sys.argv[1], sys.argv[2]
d = json.load(open(p)); d["previous"] = d["version"]; d["version"] = v
open(p, "w").write(json.dumps(d, indent=2) + "\n")
EOF
echo "rb-daw: live.json now records $NEW_VER (undo: roll back to the previous version in the Cloudflare dashboard)."
