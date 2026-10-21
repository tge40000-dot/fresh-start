import opentype from "opentype.js";
const f = opentype.loadSync("/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf");
// "RB" set tight, centred in a 64 box
const size = 38, track = -2.5;
const R = f.charToGlyph("R"), B = f.charToGlyph("B");
const s = size / f.unitsPerEm, wR = R.advanceWidth * s, wB = B.advanceWidth * s;
const total = wR + track + wB, x0 = (64 - total) / 2, base = 44.6;
const p1 = R.getPath(x0, base, size), p2 = B.getPath(x0 + wR + track, base, size);
const bb = [p1.getBoundingBox(), p2.getBoundingBox()];
console.log(JSON.stringify({ d: p1.toPathData(2) + p2.toPathData(2), bb }));
