const { deflateSync } = require('node:zlib');

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length, 0);
  name.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), data.length + 8);
  return output;
}

function donutPng(active, panne, size = 320) {
  const total = Number(active) + Number(panne);
  const activeShare = total ? Number(active) / total : 0;
  const center = size / 2, outer = size * 0.38, inner = size * 0.235;
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  const colors = { active: [22, 115, 71], panne: [204, 0, 0], empty: [220, 220, 225], white: [255, 255, 255] };
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    pixels[row] = 0;
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - center, dy = y + 0.5 - center, distance = Math.hypot(dx, dy);
      let color = colors.white;
      if (distance >= inner && distance <= outer) {
        const angle = (Math.atan2(dy, dx) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
        color = !total ? colors.empty : angle / (Math.PI * 2) < activeShare ? colors.active : colors.panne;
      }
      const offset = row + 1 + x * 4;
      pixels[offset] = color[0]; pixels[offset + 1] = color[1]; pixels[offset + 2] = color[2]; pixels[offset + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

module.exports = { donutPng };
