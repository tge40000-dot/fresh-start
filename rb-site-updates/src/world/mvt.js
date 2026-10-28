// A small Mapbox Vector Tile reader (spec 2.1): the protobuf the map tiles come in, read straight into plain objects.
// decode(bytes) -> { <layer name>: { extent, features: [{ type, props, geom }] } }, geom being rings or lines of
// [x, y] in tile units (0..extent), type 1 point, 2 line, 3 polygon. Only what stream_worker.js needs, no libraries.
export function decode(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const layers = {};
  readMsg(u8, 0, u8.length, (tag, r) => { if (tag === 3) { const L = layer(u8, r.pos, r.pos + r.len); layers[L.name] = L; } else r.skip(); });
  return layers;
}
function reader(u8, start, end) {
  const r = { pos: start, end, len: 0 };
  r.varint = () => { let v = 0, s = 0, b; do { b = u8[r.pos++]; v += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80); return v; };
  r.skip = () => { /* set by readMsg */ };
  return r;
}
// walk the fields of a message; for length-delimited fields r.pos/r.len point at the payload
function readMsg(u8, start, end, onField) {
  const r = reader(u8, start, end);
  while (r.pos < end) {
    const key = r.varint(), tag = key >>> 3, wt = key & 7;
    if (wt === 2) { r.len = r.varint(); const p = r.pos; let skipped = false; r.skip = () => { skipped = true; }; onField(tag, r, wt); r.pos = p + r.len; }
    else if (wt === 0) { const v = r.varint(); r.val = v; r.skip = () => {}; onField(tag, r, wt); }
    else if (wt === 5) { r.val = new DataView(u8.buffer, u8.byteOffset + r.pos, 4).getFloat32(0, true); r.pos += 4; r.skip = () => {}; onField(tag, r, wt); }
    else if (wt === 1) { r.val = new DataView(u8.buffer, u8.byteOffset + r.pos, 8).getFloat64(0, true); r.pos += 8; r.skip = () => {}; onField(tag, r, wt); }
    else throw new Error("mvt: wire type " + wt);
  }
}
const td = new TextDecoder();
function layer(u8, start, end) {
  const L = { name: "", extent: 4096, features: [] }, keys = [], vals = [], raw = [];
  readMsg(u8, start, end, (tag, r) => {
    if (tag === 1) L.name = td.decode(u8.subarray(r.pos, r.pos + r.len));
    else if (tag === 2) raw.push([r.pos, r.pos + r.len]);
    else if (tag === 3) keys.push(td.decode(u8.subarray(r.pos, r.pos + r.len)));
    else if (tag === 4) vals.push(value(u8, r.pos, r.pos + r.len));
    else if (tag === 5) L.extent = r.val;
  });
  for (const [s, e] of raw) L.features.push(feature(u8, s, e, keys, vals));
  return L;
}
function value(u8, start, end) {
  let v = null;
  readMsg(u8, start, end, (tag, r) => {
    if (tag === 1) v = td.decode(u8.subarray(r.pos, r.pos + r.len));
    else if (tag === 2 || tag === 3) v = r.val;
    else if (tag === 4 || tag === 5) v = r.val;
    else if (tag === 6) v = r.val % 2 ? -(r.val + 1) / 2 : r.val / 2;
    else if (tag === 7) v = !!r.val;
  });
  return v;
}
function packed(u8, start, end) { const r = reader(u8, start, end), out = []; while (r.pos < end) out.push(r.varint()); return out; }
function feature(u8, start, end, keys, vals) {
  const f = { type: 0, props: {}, geom: [] }; let tags = [], cmds = [];
  readMsg(u8, start, end, (tag, r) => {
    if (tag === 2) tags = packed(u8, r.pos, r.pos + r.len);
    else if (tag === 3) f.type = r.val;
    else if (tag === 4) cmds = packed(u8, r.pos, r.pos + r.len);
  });
  for (let i = 0; i + 1 < tags.length; i += 2) f.props[keys[tags[i]]] = vals[tags[i + 1]];
  let x = 0, y = 0, cur = null;
  for (let i = 0; i < cmds.length;) {
    const c = cmds[i++], id = c & 7, n = c >> 3;
    if (id === 1 || id === 2) for (let k = 0; k < n; k++) {
      const dx = cmds[i++], dy = cmds[i++]; x += (dx >> 1) ^ -(dx & 1); y += (dy >> 1) ^ -(dy & 1);
      if (id === 1) { cur = [[x, y]]; f.geom.push(cur); } else cur.push([x, y]);
    }
    else if (id === 7 && cur) cur.push([cur[0][0], cur[0][1]]);
  }
  return f;
}
