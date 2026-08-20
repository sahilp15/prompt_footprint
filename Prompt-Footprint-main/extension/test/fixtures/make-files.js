#!/usr/bin/env node
// Regenerates the binary fixtures in test/fixtures/files.
//
// They are committed rather than generated at test time so the suite stays
// deterministic and dependency-free, but they are BUILT rather than downloaded
// so their provenance is inspectable: a PDF whose page tree and content streams
// you can read in this file is a much better test of a PDF parser than an opaque
// blob nobody can explain.
//
//   node test/fixtures/make-files.js

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUT = path.join(__dirname, 'files');
fs.mkdirSync(OUT, { recursive: true });

/**
 * A minimal but structurally valid PDF: catalog, page tree with a real /Count,
 * one Type1 font, and one content stream per page holding `Tj` text operators.
 * Compressed with Flate when asked, which is the case the extractor has to
 * handle in practice — almost every real PDF compresses its content streams.
 */
function buildPdf(pages, { compress }) {
  const objects = new Map();
  const pageIds = pages.map((_, i) => 4 + 2 * i);
  const contentIds = pages.map((_, i) => 5 + 2 * i);

  objects.set(1, Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'));
  objects.set(2, Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`));
  objects.set(3, Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'));

  pages.forEach((text, i) => {
    objects.set(pageIds[i], Buffer.from(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] `
      + `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentIds[i]} 0 R >>`,
    ));
    const body = Buffer.from(
      `BT /F1 12 Tf 72 720 Td 14 TL\n${text.split('\n')
        .map((line) => `(${line.replace(/([\\()])/g, '\\$1')}) Tj T*`)
        .join('\n')}\nET\n`,
      'latin1',
    );
    const data = compress ? zlib.deflateSync(body) : body;
    objects.set(contentIds[i], Buffer.concat([
      Buffer.from(`<< /Length ${data.length}${compress ? ' /Filter /FlateDecode' : ''} >>\nstream\n`),
      data,
      Buffer.from('\nendstream'),
    ]));
  });

  const chunks = [Buffer.from('%PDF-1.7\n')];
  const offsets = new Map();
  let cursor = chunks[0].length;
  for (const num of [...objects.keys()].sort((a, b) => a - b)) {
    offsets.set(num, cursor);
    const chunk = Buffer.concat([
      Buffer.from(`${num} 0 obj\n`), objects.get(num), Buffer.from('\nendobj\n'),
    ]);
    chunks.push(chunk);
    cursor += chunk.length;
  }
  const top = Math.max(...objects.keys()) + 1;
  const xref = [`xref\n0 ${top}\n0000000000 65535 f \n`];
  for (let num = 1; num < top; num += 1) {
    xref.push(offsets.has(num)
      ? `${String(offsets.get(num)).padStart(10, '0')} 00000 n \n`
      : '0000000000 65535 f \n');
  }
  chunks.push(Buffer.from(xref.join('')));
  chunks.push(Buffer.from(`trailer\n<< /Size ${top} /Root 1 0 R >>\nstartxref\n${cursor}\n%%EOF\n`));
  return Buffer.concat(chunks);
}

/** An uncompressed PNG of the given size — enough for a header-only parser. */
function buildPng(width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const check = Buffer.alloc(4);
    check.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, check]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;            // bit depth
  ihdr[9] = 2;            // truecolour
  const raw = Buffer.alloc(height * (1 + width * 3));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const paragraph = 'The quarterly report covers operations across every region and highlights '
  + 'the principal risks identified by the audit committee during the period. '
  + 'Revenue grew steadily while operating costs remained broadly flat.';
const pages = (n) => Array.from({ length: n }, (_, i) => `Page ${i + 1} heading\n${paragraph}\n${paragraph}`);

const written = [
  ['report-6p.pdf', buildPdf(pages(6), { compress: true })],
  ['plain-3p.pdf', buildPdf(pages(3), { compress: false })],
  ['chart-640x480.png', buildPng(640, 480)],
];
for (const [name, buffer] of written) {
  fs.writeFileSync(path.join(OUT, name), buffer);
  console.log(`${name}  ${buffer.length} bytes`);
}
