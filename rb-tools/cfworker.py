"""Download a Cloudflare Worker's code into a folder, and upload a folder back as a new version (code only).

  python3 -I cfworker.py pull <script> <dir>       writes the modules, plus manifest.json (entry module, part types,
                                                   and the live version it came from)
  python3 -I cfworker.py push <script> <dir>       uploads the modules listed in manifest.json, plus any new .js file
                                                   in the folder, after checking the live version is still the one
                                                   pulled; prints the new version

Uses PUT /workers/scripts/<script>/content, which replaces the code only: bindings, secrets, routes and cron
triggers stay as they are. Needs CLOUDFLARE_API_TOKEN. Never prints the token.
"""
import email
import json
import os
import pathlib
import sys
import urllib.request
import uuid

ACCOUNT = os.environ.get("CF_ACCOUNT_ID", "0a7be075f32d9d615349825b83ab8fcb")
API = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/workers/scripts"


def call(method, url, body=None, headers=None):
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header("Authorization", "Bearer " + os.environ["CLOUDFLARE_API_TOKEN"])
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=120) as res:
        return res.headers, res.read()


def live_version(script):
    _, body = call("GET", f"{API}/{script}/deployments")
    dep = json.loads(body)["result"]["deployments"][0]
    v = max(dep["versions"], key=lambda x: x["percentage"])
    return v["version_id"]


def pull(script, folder):
    folder = pathlib.Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    version = live_version(script)
    headers, body = call("GET", f"{API}/{script}/content/v2")
    ctype = headers["Content-Type"]
    msg = email.message_from_bytes(b"Content-Type: " + ctype.encode() + b"\r\n\r\n" + body)
    parts = []
    for part in msg.walk():
        if part.is_multipart():
            continue
        name = part.get_filename() or part.get_param("name", header="content-disposition")
        if not name or "/" in name or name.startswith("."):
            raise SystemExit(f"unexpected part name {name!r}")
        (folder / name).write_bytes(part.get_payload(decode=True))
        parts.append({"name": name, "type": part.get_content_type() if part.get_content_type() != "text/plain" else part.get("Content-Type", "application/javascript+module")})
    manifest = {"script": script, "entry": headers.get("cf-entrypoint"), "version": version, "parts": parts}
    (folder / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"{script}: pulled version {version}, entry {manifest['entry']}, {len(parts)} module(s) into {folder}")


def push(script, folder):
    folder = pathlib.Path(folder)
    manifest = json.loads((folder / "manifest.json").read_text())
    if manifest["script"] != script:
        raise SystemExit(f"{folder} holds {manifest['script']}, not {script}")
    live = live_version(script)
    if live != manifest["version"]:
        raise SystemExit(f"{script} is now on {live}, not {manifest['version']} which was pulled. Pull again and re-apply.")
    names = {p["name"] for p in manifest["parts"]}
    parts = list(manifest["parts"]) + [{"name": p.name, "type": "application/javascript+module"} for p in sorted(folder.glob("*.js")) if p.name not in names]
    boundary = uuid.uuid4().hex
    out = bytearray()

    def field(name, data, ctype, filename=None):
        out.extend(f"--{boundary}\r\n".encode())
        disp = f'form-data; name="{name}"' + (f'; filename="{filename}"' if filename else "")
        out.extend(f"Content-Disposition: {disp}\r\nContent-Type: {ctype}\r\n\r\n".encode())
        out.extend(data)
        out.extend(b"\r\n")

    field("metadata", json.dumps({"main_module": manifest["entry"]}).encode(), "application/json")
    for p in parts:
        field(p["name"], (folder / p["name"]).read_bytes(), p["type"], p["name"])
    out.extend(f"--{boundary}--\r\n".encode())
    _, body = call("PUT", f"{API}/{script}/content", bytes(out), {"Content-Type": f"multipart/form-data; boundary={boundary}"})
    res = json.loads(body)
    if not res.get("success"):
        raise SystemExit(f"upload failed: {res.get('errors')}")
    now = live_version(script)
    print(f"{script}: uploaded {len(parts)} module(s); live version {manifest['version']} -> {now}")
    (folder / "deployed.json").write_text(json.dumps({"script": script, "previous": manifest["version"], "now": now}, indent=2))


if __name__ == "__main__":
    if len(sys.argv) != 4 or sys.argv[1] not in ("pull", "push"):
        raise SystemExit(__doc__)
    (pull if sys.argv[1] == "pull" else push)(sys.argv[2], sys.argv[3])
