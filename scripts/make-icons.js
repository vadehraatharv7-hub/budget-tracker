// Generates the PWA icons (no image dependencies): a budget ring on the flat accent blue.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const OUT = resolve(fileURLToPath(new URL('../web/public/icons', import.meta.url)));
mkdirSync(OUT, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const C1 = [31, 79, 216], C2 = [31, 79, 216]; // flat accent blue, same as the UI

function render(size, scale) {
  const SS = 3; // supersampling
  return png(size, (px, py) => {
    let wr = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const x = (px + (sx + 0.5) / SS) / size - 0.5, y = (py + (sy + 0.5) / SS) / size - 0.5;
      const R = 0.27 * scale, w = 0.085 * scale;
      const r = Math.hypot(x, y);
      let a = Math.atan2(y, x) + Math.PI / 2; // 0 at top, clockwise
      if (a < 0) a += Math.PI * 2;
      const sweep = Math.PI * 2 * 0.72;
      let hit = Math.abs(r - R) < w / 2 && a <= sweep;
      const cap = (ang) => Math.hypot(x - R * Math.sin(ang), y + R * Math.cos(ang)) < w / 2;
      if (cap(0) || cap(sweep)) hit = true;
      if (r < 0.05 * scale) hit = true;
      if (hit) wr++;
    }
    const t = Math.min(1, Math.max(0, (px + py) / (2 * size)));
    const bg = mix(C1, C2, t);
    return mix(bg, [255, 255, 255], wr / (SS * SS));
  });
}

writeFileSync(`${OUT}/icon-192.png`, render(192, 1));
writeFileSync(`${OUT}/icon-512.png`, render(512, 1));
writeFileSync(`${OUT}/icon-maskable-512.png`, render(512, 0.85));
writeFileSync(`${OUT}/apple-touch-icon.png`, render(180, 1));
console.log('icons written to', OUT);
