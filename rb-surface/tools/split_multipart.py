"""Split a Worker bundle downloaded from /workers/scripts/<name>/content/v2 into its module files.

Usage: python3 -I split_multipart.py <headers-file> <body-file> <out-dir>
"""
import email
import os
import sys

headers_path, body_path, out_dir = sys.argv[1:4]
content_type = next(
    line.split(":", 1)[1].strip()
    for line in open(headers_path, encoding="latin-1").read().splitlines()
    if line.lower().startswith("content-type:")
)
msg = email.message_from_bytes(b"Content-Type: " + content_type.encode() + b"\r\n\r\n" + open(body_path, "rb").read())
os.makedirs(out_dir, exist_ok=True)
for part in msg.walk():
    if part.is_multipart():
        continue
    name = os.path.basename(part.get_filename() or part.get_param("name", header="content-disposition"))
    with open(os.path.join(out_dir, name), "wb") as f:
        f.write(part.get_payload(decode=True))
    print(name)
