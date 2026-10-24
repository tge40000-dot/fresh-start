"""Upload rb-world-live (RB World's live rooms) as its own Worker, with only the bindings it needs.

  python3 -I cflive.py <path to rb-world-live/index.js>

  - Bindings: ROOMS (a Durable Object namespace for its own class Room, SQLite-backed) and DB (the shared D1 database,
    read-only use: RB World's switches and the block list). No secrets, no routes.
  - The first upload creates the Durable Object class (migration v1); later uploads keep it.
  - It's served on its workers.dev address (wss://rb-world-live.<account subdomain>.workers.dev), which the game's
    Content-Security-Policy allows.
  - Prints the version before and after, for rollback (Workers > rb-world-live > Deployments). Never prints the token.
"""
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request
import uuid

ACCOUNT = os.environ.get("CF_ACCOUNT_ID", "0a7be075f32d9d615349825b83ab8fcb")
NAME = "rb-world-live"
D1 = "820b8c2f-55b8-40ea-8ab8-2dfc74659fdb"
API = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/workers/scripts/{NAME}"


def call(method, url, body=None, ctype=None):
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("Authorization", "Bearer " + os.environ["CLOUDFLARE_API_TOKEN"])
    if ctype:
        req.add_header("Content-Type", ctype)
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            return res.status, json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except ValueError:
            return e.code, {}


def live_version():
    code, d = call("GET", API + "/deployments")
    if code != 200:
        return None
    deps = (d.get("result") or {}).get("deployments") or []
    return deps[0]["versions"][0]["version_id"] if deps else None


src = pathlib.Path(sys.argv[1]).read_bytes()
before = live_version()
meta = {
    "main_module": "index.js",
    "compatibility_date": "2025-01-01",
    "bindings": [
        {"type": "durable_object_namespace", "name": "ROOMS", "class_name": "Room"},
        {"type": "d1", "name": "DB", "id": D1},
    ],
}
if before is None:
    meta["migrations"] = {"new_tag": "v1", "new_sqlite_classes": ["Room"]}
boundary = "rbwl" + uuid.uuid4().hex
parts = [
    (f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"; filename="metadata.json"\r\nContent-Type: application/json\r\n\r\n').encode() + json.dumps(meta).encode() + b"\r\n",
    (f'--{boundary}\r\nContent-Disposition: form-data; name="index.js"; filename="index.js"\r\nContent-Type: application/javascript+module\r\n\r\n').encode() + src + b"\r\n",
    f"--{boundary}--\r\n".encode(),
]
code, d = call("PUT", API, b"".join(parts), f"multipart/form-data; boundary={boundary}")
if code != 200 or not d.get("success"):
    raise SystemExit(f"{NAME}: upload failed ({code}): {json.dumps(d.get('errors'))[:400]}")
code, d = call("POST", API + "/subdomain", json.dumps({"enabled": True, "previews_enabled": False}).encode(), "application/json")
if code != 200:
    raise SystemExit(f"{NAME}: uploaded, but turning on its workers.dev address failed ({code}): {json.dumps(d.get('errors'))[:300]}")
print(f"{NAME}: live version {before or '(new Worker)'} -> {live_version()}")
