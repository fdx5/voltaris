import { deflateSync } from 'node:zlib';
import { writeFile, mkdir } from 'node:fs/promises';
// Original geometric Z mark. Generates install icons without remote assets or fonts.
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name, bytes) {
  const type = Buffer.from(name),
    len = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  len.writeUInt32BE(bytes.length);
  crc.writeUInt32BE(crc32(Buffer.concat([type, bytes])));
  return Buffer.concat([len, type, bytes, crc]);
}
await mkdir('public/icons', { recursive: true });
for (const size of [192, 512]) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = x / size,
        v = y / size;
      const border =
        u > 0.18 &&
        u < 0.82 &&
        v > 0.18 &&
        v < 0.82 &&
        (u < 0.205 || u > 0.795 || v < 0.205 || v > 0.795);
      const z =
        (u > 0.29 && u < 0.71 && ((v > 0.29 && v < 0.37) || (v > 0.63 && v < 0.71))) ||
        (v > 0.34 && v < 0.66 && Math.abs(u + v - 1) < 0.057);
      const p = y * (size * 4 + 1) + 1 + x * 4;
      raw[p] = border || z ? 182 : 7;
      raw[p + 1] = border || z ? 244 : 14;
      raw[p + 2] = border || z ? 213 : 21;
      raw[p + 3] = 255;
    }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  await writeFile(
    `public/icons/icon-${size}.png`,
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}
