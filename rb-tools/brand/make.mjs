// Regenerate the icon files: cd rb-tools/brand && npm i opentype.js@1.3.4 && node outline.mjs > rb.json && node make.mjs
// (writes icon.svg, maskable.svg, apple.svg, the PNGs and preview.png; favicon.ico is packed from icon-16/32/48.png).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
const { d } = JSON.parse(readFileSync("rb.json", "utf8"));
const grad = `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FCE9A8"/><stop offset=".48" stop-color="#E3B64A"/><stop offset="1" stop-color="#A8761A"/></linearGradient></defs>`;
// Tab icon: rounded gold tile, black RB, a fine dark keyline so it holds on light and dark tab bars.
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${grad}<rect width="64" height="64" rx="14" fill="url(#g)"/><rect x="1.5" y="1.5" width="61" height="61" rx="12.5" fill="none" stroke="#0B0A09" stroke-opacity=".35" stroke-width="1.5"/><path fill="#0B0A09" d="${d}"/></svg>`;
// Maskable (Android home screen): full-bleed gold, letters inside the 80% safe zone.
const mask = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${grad}<rect width="64" height="64" fill="url(#g)"/><g transform="translate(32 32) scale(.72) translate(-32 -32)"><path fill="#0B0A09" d="${d}"/></g></svg>`;
// Apple touch: square (iOS rounds it), no keyline.
const apple = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${grad}<rect width="64" height="64" fill="url(#g)"/><g transform="translate(32 32) scale(.86) translate(-32 -32)"><path fill="#0B0A09" d="${d}"/></g></svg>`;
writeFileSync("icon.svg", icon); writeFileSync("maskable.svg", mask); writeFileSync("apple.svg", apple);
const b = await chromium.launch(); const p = await b.newPage();
const shot = async (svg, px, out, bg = "transparent") => {
  await p.setViewportSize({ width: px, height: px });
  await p.setContent(`<html><body style="margin:0;background:${bg}"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}" width="${px}" height="${px}" style="display:block"></body></html>`);
  await p.screenshot({ path: out, omitBackground: bg === "transparent" });
};
for (const px of [16, 32, 48]) await shot(icon, px, `icon-${px}.png`);
await shot(icon, 192, "icon-192.png"); await shot(icon, 512, "icon-512.png");
await shot(mask, 512, "maskable-512.png"); await shot(apple, 180, "apple-touch-icon.png");
// preview: tab-size icons on dark and light bars, next to the old one
await p.setViewportSize({ width: 520, height: 200 });
const img = (f, px) => `<img src="data:image/png;base64,${readFileSync(f).toString("base64")}" width="${px}" height="${px}" style="margin:8px;image-rendering:auto">`;
const old = existsSync("old-fav.png") ? readFileSync("old-fav.png").toString("base64") : readFileSync("icon-32.png").toString("base64");
await p.setContent(`<body style="margin:0;font:12px sans-serif">${["#202124", "#f1f3f4"].map((bg) => `<div style="background:${bg};padding:10px;display:flex;align-items:center;color:${bg === "#202124" ? "#ccc" : "#333"}">old <img src="data:image/png;base64,${old}" width="16" height="16" style="margin:8px"><img src="data:image/png;base64,${old}" width="32" height="32" style="margin:8px"> new ${img("icon-16.png", 16)}${img("icon-32.png", 32)}${img("icon-48.png", 48)}${img("apple-touch-icon.png", 60)}${img("maskable-512.png", 60)}</div>`).join("")}</body>`);
await p.screenshot({ path: "preview.png" });
await b.close();
