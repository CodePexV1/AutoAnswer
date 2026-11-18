// Generates the extension icons: green rounded square with a white check mark.
// Usage: node tools/make-icons.js icons
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const outDir = process.argv[2] || 'icons';
fs.mkdirSync(outDir, { recursive: true });

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ]);
}
const clamp = (v) => Math.max(0, Math.min(1, v));
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

for (const size of [16, 32, 48, 128]) {
  const px = Buffer.alloc(size * size * 4);
  const S = 4; // supersampling
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let a = 0, w = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const u = (x + (sx + 0.5) / S) / size, v = (y + (sy + 0.5) / S) / size;
      const r = 0.22, m = 0.03;
      const qx = Math.max(Math.abs(u - 0.5) - (0.5 - m - r), 0), qy = Math.max(Math.abs(v - 0.5) - (0.5 - m - r), 0);
      if (Math.hypot(qx, qy) > r) continue;
      a++;
      const d = Math.min(segDist(u, v, 0.27, 0.52, 0.44, 0.69), segDist(u, v, 0.44, 0.69, 0.75, 0.33));
      if (d < 0.075) w++;
    }
    const i = (y * size + x) * 4;
    const white = a ? w / a : 0;
    const t = y / size;
    const g = [22 + 10 * t, 163 - 30 * t, 74 - 10 * t];
    for (let k = 0; k < 3; k++) px[i + k] = Math.round(g[k] * (1 - white) + 255 * white);
    px[i + 3] = Math.round((a / (S * S)) * 255);
  }
  fs.writeFileSync(path.join(outDir, `icon${size}.png`), png(size, px));
}
console.log('icons written to', outDir);
