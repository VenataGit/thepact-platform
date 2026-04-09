#!/usr/bin/env node
// Generate PWA icons (192x192 and 512x512) from scratch.
// Uses pure Node.js (no external deps) — zlib for PNG compression.
// Run once: node scripts/generate-pwa-icons.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// --- CRC32 (needed for PNG chunks) ---
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[n] = c;
}
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const payload = Buffer.concat([t, data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(payload));
  return Buffer.concat([len, payload, c]);
}

function createPNG(size, drawFn) {
  // RGBA pixel buffer
  const pixels = Buffer.alloc(size * size * 4, 0);
  drawFn(pixels, size);

  // Apply PNG filter byte (0 = None) per row
  const rawRows = [];
  for (let y = 0; y < size; y++) {
    rawRows.push(Buffer.from([0])); // filter
    rawRows.push(pixels.subarray(y * size * 4, (y + 1) * size * 4));
  }
  const raw = Buffer.concat(rawRows);
  const compressed = zlib.deflateSync(raw, { level: 9 });

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function setPixel(pixels, size, x, y, r, g, b, a) {
  if (x < 0 || x >= size || y < 0 || y >= size) return;
  const i = (y * size + x) * 4;
  pixels[i] = r;
  pixels[i + 1] = g;
  pixels[i + 2] = b;
  pixels[i + 3] = a;
}

function drawIcon(pixels, size) {
  const bg = { r: 26, g: 39, b: 48 };    // #1a2730
  const fg = { r: 255, g: 255, b: 255 };  // white

  // Fill background with rounded rect appearance (circle mask for maskable)
  const cx = size / 2, cy = size / 2;
  const radius = size * 0.45; // safe zone for maskable

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      setPixel(pixels, size, x, y, bg.r, bg.g, bg.b, 255);
    }
  }

  // Draw the triangle/play icon (the distinctive ThePact mark)
  // Triangle vertices relative to center, scaled to ~40% of icon size
  const scale = size * 0.35;
  // Triangle pointing right: left-top, left-bottom, right-center
  const triX = cx - scale * 0.15; // shift slightly left to center visually
  const triY = cy;

  const ax = triX - scale * 0.45, ay = triY - scale * 0.55;  // top-left
  const bx = triX - scale * 0.45, by = triY + scale * 0.55;  // bottom-left
  const pcx = triX + scale * 0.55, pcy = triY;                // right point

  // Fill triangle using scanline
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (pointInTriangle(x, y, ax, ay, bx, by, pcx, pcy)) {
        // Anti-aliasing: check distance to edge
        setPixel(pixels, size, x, y, fg.r, fg.g, fg.b, 255);
      }
    }
  }

  // Draw "TP" text is too complex without font rendering, the triangle mark is the brand identity
}

function pointInTriangle(px, py, x1, y1, x2, y2, x3, y3) {
  const d1 = sign(px, py, x1, y1, x2, y2);
  const d2 = sign(px, py, x2, y2, x3, y3);
  const d3 = sign(px, py, x3, y3, x1, y1);
  const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
  const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
  return !(hasNeg && hasPos);
}

function sign(px, py, x1, y1, x2, y2) {
  return (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2);
}

// Generate both sizes
const outDir = path.join(__dirname, '..', 'public', 'img');

const icon192 = createPNG(192, drawIcon);
fs.writeFileSync(path.join(outDir, 'icon-192.png'), icon192);
console.log('Created icon-192.png (%d bytes)', icon192.length);

const icon512 = createPNG(512, drawIcon);
fs.writeFileSync(path.join(outDir, 'icon-512.png'), icon512);
console.log('Created icon-512.png (%d bytes)', icon512.length);

console.log('Done! PWA icons generated in public/img/');
