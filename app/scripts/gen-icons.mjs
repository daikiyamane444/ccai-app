// 仮アイコン（単色の地に白い丸）を public/icons に作る。デザインは後で差し替える前提の仮のもの。
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

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
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, bg, fg, radiusRatio) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const cx = size / 2, r = size * radiusRatio;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const inside = (x - cx + 0.5) ** 2 + (y - cx + 0.5) ** 2 <= r * r;
      const c = inside ? fg : bg;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]);
}
mkdirSync("public/icons", { recursive: true });
const bg = [0x2f, 0x6f, 0x62], fg = [0xff, 0xff, 0xff];
writeFileSync("public/icons/icon-192.png", png(192, bg, fg, 0.28));
writeFileSync("public/icons/icon-512.png", png(512, bg, fg, 0.28));
// maskable は安全領域（中央80%）に収めるため丸を小さめにする
writeFileSync("public/icons/icon-maskable-512.png", png(512, bg, fg, 0.22));
writeFileSync("public/icons/apple-touch-icon.png", png(180, bg, fg, 0.28));
console.log("icons written");
