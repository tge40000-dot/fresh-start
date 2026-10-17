// Usage: node rb-command-updates/test/create-upload.test.mjs <patched rb-command dir>
// The Create screen's quick song upload is in the page once and the page script still parses.
import assert from "node:assert/strict";
import { join } from "node:path";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
const dir = process.argv[2];
const { renderPage } = await import(join(dir, "ui.js"));
const html = renderPage("N0NCE", { me: { email: "o@x", name: "O", role: "owner", caps: { groups: { Content: "edit", CRM: "edit" }, label: "Owner" } }, links: {}, media: "", tables: {}, groups: ["Content"], uploads: true });
const js = [...html.matchAll(/<script nonce="N0NCE">([\s\S]*?)<\/script>/g)].map((x) => x[1]).join("\n;\n");
for (const want of ["function quickUploadHtml()", "function wireQuickUpload()", 'api("t/tracks", { values: values })', 'uploadFile(f.file, "tracks")', "the beat store, music player and RB Radio", 'x.kind === "song" || x.kind === "beat"'])
  assert.equal(js.split(want).length - 1, 1, want + " appears once");
const f = join(mkdtempSync(join(tmpdir(), "qup-")), "page.js"); writeFileSync(f, js); execFileSync(process.execPath, ["--check", f]);
console.log("create upload ok: quick song upload and beat destinations in the page once, page script parses");
