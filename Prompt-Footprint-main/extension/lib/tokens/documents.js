// PromptFootprint — what an attached file actually costs.
// ---------------------------------------------------------------------------
// "Summarize this report" is nine tokens. "Summarize this report" with a 40-page
// PDF attached is tens of thousands, and reporting the nine was the single most
// misleading thing the analyzer did.
//
// EVERYTHING HERE HAPPENS ON THE USER'S MACHINE. Files are read through the
// FileReader/ArrayBuffer APIs the page already handed us, parsed in-process, and
// discarded. Nothing is uploaded — not to a token-counting endpoint, not to a
// parsing service, not anywhere. That constraint is why this file contains a
// small PDF text extractor instead of a call to something that would do it
// better: doing it worse locally is the right trade for a tool whose whole
// subject matter is the user's private prompts.
//
// FOUR KINDS OF FILE, THREE KINDS OF ANSWER
//
//   text      Read it, tokenize it with the detected model's tokenizer. This is
//             the accurate case — the bytes we tokenize are the characters that
//             will be sent.
//   pdf       Two contributions, never merged: the EXTRACTED TEXT, and the
//             DOCUMENT/VISUAL processing that both providers apply on top. See
//             `analyzePdf` for why treating a PDF as plain text understates it
//             by roughly a factor of three on Claude.
//   image     Computed from the provider's published geometry rules — patches
//             for both, but different patch sizes, different caps, and different
//             downscaling.
//   opaque    .docx and friends: a zip of compressed XML we do not parse. A
//             wide byte-derived RANGE, labelled low confidence, is the honest
//             output. A precise-looking number here would be fiction.
//
// Every result carries `confidence` and, where the number is a band, `low` and
// `high`. Nothing in this file returns an exact count, because nothing in this
// file can produce one.

(function (root) {
  'use strict';

  const K = (typeof PFTokenConstants !== 'undefined') ? PFTokenConstants : require('./constants.js');
  const TC = (typeof PFTokenCounter !== 'undefined') ? PFTokenCounter : require('./counter.js');

  // ── Classification ────────────────────────────────────────────────────────

  function extensionOf(name) {
    const base = String(name || '').split(/[\\/]/).pop() || '';
    const dot = base.lastIndexOf('.');
    if (dot <= 0) return base.toLowerCase();          // "Makefile", "Dockerfile"
    return base.slice(dot + 1).toLowerCase();
  }

  /**
   * What kind of file this is, decided by extension first and MIME second.
   *
   * Extension leads deliberately: browsers report `application/octet-stream` for
   * most source files and `text/plain` for several binaries, so the MIME type is
   * the less reliable of the two signals here.
   */
  function classify(file) {
    const name = (file && file.name) || '';
    const mime = String((file && file.type) || '').toLowerCase();
    const ext = extensionOf(name);

    if (ext === 'pdf' || mime === 'application/pdf') return { kind: 'pdf', ext, mime };
    if (K.IMAGE_EXTENSIONS.includes(ext) || mime.startsWith('image/')) return { kind: 'image', ext, mime };
    if (K.TEXT_EXTENSIONS.includes(ext)) return { kind: 'text', ext, mime };
    if (K.OPAQUE_EXTENSIONS.includes(ext)) return { kind: 'opaque', ext, mime };
    if (mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml') {
      return { kind: 'text', ext, mime };
    }
    return { kind: 'unknown', ext, mime };
  }

  // ── Byte helpers ──────────────────────────────────────────────────────────

  async function readBytes(file) {
    if (file && typeof file.arrayBuffer === 'function') {
      return new Uint8Array(await file.arrayBuffer());
    }
    if (file && file.bytes instanceof Uint8Array) return file.bytes;   // tests
    throw new Error('unreadable file');
  }

  function decodeUtf8(bytes) {
    if (typeof TextDecoder !== 'undefined') {
      return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    }
    return Buffer.from(bytes).toString('utf8');
  }

  /** Latin-1 view of the bytes: the right lens for scanning PDF structure. */
  function decodeLatin1(bytes) {
    let out = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return out;
  }

  /** zlib inflate, using whichever primitive the runtime provides. */
  async function inflate(bytes) {
    if (typeof DecompressionStream !== 'undefined') {
      for (const format of ['deflate', 'deflate-raw']) {
        try {
          const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
          const buf = await new Response(stream).arrayBuffer();
          return new Uint8Array(buf);
        } catch (_) { /* try raw, then give up */ }
      }
    }
    return null;
  }

  // ── Text files ────────────────────────────────────────────────────────────

  /**
   * The accurate case: the characters we tokenize are the characters that will
   * be sent, so the only uncertainty left is the tokenizer approximation itself.
   */
  function costText(text, target) {
    const counted = TC.countText(text, target);
    return {
      kind: 'text',
      textTokens: counted.count,
      visualTokens: 0,
      total: counted.count,
      low: counted.low,
      high: counted.high,
      characters: text.length,
      method: counted.method,
      confidence: counted.confidence,
      detail: `${text.length.toLocaleString()} characters, read and tokenized in full`,
    };
  }

  // ── PDFs ──────────────────────────────────────────────────────────────────

  /** Page count, from the strongest available structural signal. */
  function countPdfPages(scan) {
    // The page tree's root /Count is authoritative when present.
    let best = 0;
    const counts = scan.match(/\/Type\s*\/Pages[\s\S]{0,400}?\/Count\s+(\d+)/g) || [];
    for (const chunk of counts) {
      const m = /\/Count\s+(\d+)/.exec(chunk);
      if (m) best = Math.max(best, Number(m[1]));
    }
    if (best > 0) return best;
    // Otherwise count the page objects themselves. `[^s]` keeps /Pages out.
    const pageObjects = (scan.match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
    if (pageObjects > 0) return pageObjects;
    // Linearized PDFs declare it up front.
    const linear = /\/Linearized[\s\S]{0,200}?\/N\s+(\d+)/.exec(scan);
    if (linear) return Number(linear[1]);
    return 0;
  }

  /** Text-showing operators inside a decoded content stream. */
  function textFromContentStream(content) {
    const out = [];
    // Literal strings: (…) Tj / TJ / ' / ", with PDF's escape rules.
    const literal = /\((?:\\.|[^\\()])*\)/g;
    let m;
    while ((m = literal.exec(content)) !== null) {
      const raw = m[0].slice(1, -1);
      out.push(raw
        .replace(/\\([nrtbf])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', b: '', f: '' }[c]))
        .replace(/\\([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)))
        .replace(/\\(.)/g, '$1'));
    }
    // Hex strings: <48656C6C6F> Tj
    const hex = /<([0-9A-Fa-f\s]{2,})>\s*(?:Tj|TJ)/g;
    while ((m = hex.exec(content)) !== null) {
      const digits = m[1].replace(/\s+/g, '');
      let s = '';
      for (let i = 0; i + 1 < digits.length; i += 2) {
        const code = parseInt(digits.slice(i, i + 2), 16);
        if (code >= 32 || code === 10) s += String.fromCharCode(code);
      }
      out.push(s);
    }
    return out.join(' ');
  }

  /**
   * Pull readable text out of a PDF.
   *
   * Scope, stated plainly: this handles the common case — Flate-compressed or
   * uncompressed content streams with simple font encodings — and it does not
   * handle scanned documents, custom CMaps, or encrypted files. When it comes up
   * short the caller falls back to the provider's documented per-page band
   * rather than reporting a small number with false precision, and the
   * confidence drops to say so.
   */
  async function extractPdfText(bytes, scan) {
    const chunks = [];
    // The lookbehind is load-bearing: without it this also matches the "stream"
    // inside "endstream", and every other "stream" found is a span of binary
    // garbage between two unrelated objects. PDF requires a real `stream`
    // keyword to be followed by CRLF or LF, which is the rest of the pattern.
    const streamRx = /(?<![A-Za-z])stream\r?\n/g;
    let m;
    let budget = 0;
    while ((m = streamRx.exec(scan)) !== null) {
      const start = m.index + m[0].length;
      const stop = scan.indexOf('endstream', start);
      if (stop < 0) break;
      // Skip past this object's payload rather than scanning into it.
      streamRx.lastIndex = stop + 'endstream'.length;
      // Only content streams matter, and only up to a bounded amount of work:
      // a 100 MB PDF must not lock the page up.
      if (budget > 4000) continue;
      budget += 1;
      const header = scan.slice(Math.max(0, m.index - 400), m.index);
      // The EOL before `endstream` belongs to the syntax, not to the data —
      // and a zlib decoder rejects the whole stream over one trailing byte.
      let dataEnd = stop;
      while (dataEnd > start && (bytes[dataEnd - 1] === 0x0a || bytes[dataEnd - 1] === 0x0d)) dataEnd -= 1;
      const raw = bytes.subarray(start, dataEnd);
      let decoded = null;
      if (/\/FlateDecode/.test(header)) decoded = await inflate(raw);
      else if (!/\/(DCTDecode|JPXDecode|CCITTFaxDecode|JBIG2Decode|RunLengthDecode|ASCII85Decode|LZWDecode)/.test(header)) {
        decoded = raw;
      }
      if (!decoded || !decoded.length) continue;
      const content = decodeLatin1(decoded);
      // Object streams hold page dictionaries rather than drawing operators;
      // they are worth scanning for structure but contain no showable text.
      if (!/(Tj|TJ|'|")\s*$/m.test(content) && !/\bBT\b/.test(content)) {
        chunks.push({ structure: content });
        continue;
      }
      const text = textFromContentStream(content);
      if (text.trim()) chunks.push({ text });
    }
    return {
      text: chunks.filter((c) => c.text).map((c) => c.text).join('\n'),
      structure: chunks.filter((c) => c.structure).map((c) => c.structure).join('\n'),
    };
  }

  /**
   * A PDF's real cost, split into the two things it is made of.
   *
   * Both providers do more with a PDF than read its text:
   *
   *   Claude   "The system converts each page of the document into an image.
   *            The text from each page is extracted and provided alongside each
   *            page's image." Their own worked example is ~1,000 tokens for a
   *            3-page PDF as text and ~7,000 for the same PDF processed
   *            visually. [T5]
   *   OpenAI   the API "extracts both text and page images and sends both to the
   *            model" [T7]; chatgpt.com instead stuffs roughly the first 110k
   *            tokens of extracted text into context and indexes the rest [T8].
   *
   * So "extract the text and tokenize it" is not the answer — on Claude it is
   * roughly a third of the answer. The two contributions are reported
   * separately because they behave differently and only one of them is
   * something the user can avoid (by pasting the text instead).
   */
  function costPdf(parsed, target, options) {
    const opts = options || {};
    const provider = (target && target.provider) || 'unknown';
    const { pages, pagesKnown, encrypted, chars, extractionUsable } = parsed;
    const extracted = { text: parsed.text };

    let textTokens;
    let textLow;
    let textHigh;
    let textBasis;
    if (extractionUsable) {
      const counted = TC.countText(extracted.text || '', target);
      textTokens = counted.count;
      textLow = counted.low;
      textHigh = counted.high;
      textBasis = `${chars.toLocaleString()} characters extracted locally`;
    } else {
      // Anthropic's documented band, which is the only published per-page figure
      // either provider gives. [T5] Used for both providers: OpenAI publishes no
      // equivalent, and page density is a property of the document rather than
      // of the vendor.
      const band = K.ANTHROPIC_PDF.textTokensPerPage;
      textLow = pages * band.low;
      textHigh = pages * band.high;
      textTokens = Math.round((textLow + textHigh) / 2);
      textBasis = encrypted
        ? 'encrypted PDF — text could not be read, so the provider’s documented per-page band is used'
        : 'text could not be extracted (scanned or unusual encoding) — using the documented per-page band';
    }

    // The visual half.
    let visualLow = 0;
    let visualHigh = 0;
    let visualNote = '';
    if (provider === 'anthropic') {
      const band = K.ANTHROPIC_PDF.imageTokensPerPage;
      visualLow = pages * band.low;
      visualHigh = pages * band.high;
      visualNote = 'Claude renders every page as an image as well as extracting its text.';
    } else if (provider === 'openai') {
      if (opts.surface === 'chatgpt') {
        // Visual retrieval exists on chatgpt.com but is conditional on the plan,
        // the upload path, and whether the PDF has images at all — none of which
        // is visible from the page. Reporting zero would understate it; making a
        // number up would be worse. The range starts at zero and says why.
        visualLow = 0;
        visualHigh = pages * K.ANTHROPIC_PDF.imageTokensPerPage.low;
        visualNote = 'ChatGPT may also process page images (visual retrieval); whether it '
          + 'does is not visible to the extension.';
      } else {
        visualLow = pages * 500;
        visualHigh = pages * K.ANTHROPIC_PDF.imageTokensPerPage.high;
        visualNote = 'The API sends page images alongside the extracted text.';
      }
    }

    // ChatGPT caps what actually reaches the context window. [T8]
    let indexedOverflow = 0;
    if (provider === 'openai' && opts.surface === 'chatgpt') {
      const cap = K.CHATGPT_UPLOAD.contextStuffingTokens;
      if (textTokens > cap) {
        indexedOverflow = textTokens - cap;
        textTokens = cap;
        textLow = Math.min(textLow, cap);
        textHigh = Math.min(textHigh, cap);
      }
    }

    const visualCentral = Math.round((visualLow + visualHigh) / 2);
    return {
      kind: 'pdf',
      pages,
      pagesKnown,
      textTokens,
      visualTokens: visualCentral,
      visualLow,
      visualHigh,
      total: textTokens + visualCentral,
      low: textLow + visualLow,
      high: textHigh + visualHigh,
      characters: chars,
      indexedOverflow,
      method: extractionUsable ? 'local-tokenizer' : 'model-estimate',
      // Never 'high': even perfect extraction leaves the visual half as a band.
      confidence: 'estimated',
      detail: [
        pagesKnown ? `${pages} page${pages === 1 ? '' : 's'}` : `~${pages} pages (count not readable)`,
        textBasis,
        visualNote,
        indexedOverflow
          ? `About ${indexedOverflow.toLocaleString()} tokens beyond ChatGPT’s ~110k in-context limit go to its search index instead.`
          : '',
      ].filter(Boolean).join(' · '),
    };
  }

  /** Last resort when a PDF's structure is unreadable: ~55 kB of PDF per page. */
  function estimatePagesFromBytes(size) {
    return Math.max(1, Math.round(size / 55000));
  }

  // ── Images ────────────────────────────────────────────────────────────────

  /**
   * Pixel dimensions from the file header.
   *
   * Parsed directly rather than through `createImageBitmap` so this works
   * identically in a content script, a worker, and a test — and so a decoded
   * copy of the user's image is never materialized just to read two numbers.
   */
  function imageDimensions(bytes) {
    const b = bytes;
    const u16 = (i) => (b[i] << 8) | b[i + 1];
    const u32 = (i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

    // PNG
    if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
      return { width: u32(16), height: u32(20) };
    }
    // GIF
    if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
      return { width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) };
    }
    // BMP
    if (b.length > 26 && b[0] === 0x42 && b[1] === 0x4d) {
      const le32 = (i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
      return { width: le32(18), height: le32(22) };
    }
    // WebP (VP8X / VP8 / VP8L)
    if (b.length > 30 && b[0] === 0x52 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42) {
      const fourcc = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (fourcc === 'VP8X') {
        return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
      }
      if (fourcc === 'VP8 ') return { width: u16(27) & 0x3fff, height: u16(29) & 0x3fff };
      if (fourcc === 'VP8L') {
        const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
    }
    // JPEG: walk the segment chain to the frame header.
    if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i += 1; continue; }
        const marker = b[i + 1];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
        const length = u16(i + 2);
        // SOF0..SOF15, excluding the DHT/JPG/DAC markers interleaved in that range
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: u16(i + 5), width: u16(i + 7) };
        }
        i += 2 + length;
      }
    }
    return null;
  }

  /**
   * Claude's visual-token cost. [T4]
   *
   *   tokens = ceil(width / 28) * ceil(height / 28)
   *
   * subject to the model's resolution tier: the image is first scaled so its
   * long edge fits, then scaled again if the patch count still exceeds the
   * tier's ceiling. Reproduces the worked examples in Anthropic's own table
   * exactly — 1920x1080 costs 2691 on the high-resolution tier and 1560 on the
   * standard one.
   */
  function anthropicImageTokens(width, height, tier) {
    const spec = K.ANTHROPIC_IMAGE.tiers[tier] || K.ANTHROPIC_IMAGE.tiers.standard;
    const patch = K.ANTHROPIC_IMAGE.patchPx;
    let w = width;
    let h = height;
    const longEdge = Math.max(w, h);
    if (longEdge > spec.maxLongEdge) {
      const scale = spec.maxLongEdge / longEdge;
      w *= scale;
      h *= scale;
    }
    const tokensFor = (a, b) => Math.ceil(a / patch) * Math.ceil(b / patch);
    const tokens = tokensFor(w, h);
    if (tokens <= spec.maxVisualTokens) return tokens;

    // Over the ceiling. Anthropic "scales it to the largest size that fits the
    // tier's limits while preserving its aspect ratio" [T4], so find the LARGEST
    // scale whose patch count still fits rather than shrinking by a fudge factor
    // — the difference between the two is about 3%, which is exactly the sort of
    // quiet drift that makes a published table stop reproducing.
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i += 1) {
      const mid = (lo + hi) / 2;
      if (tokensFor(w * mid, h * mid) <= spec.maxVisualTokens) lo = mid;
      else hi = mid;
    }
    return Math.min(tokensFor(w * lo, h * lo), spec.maxVisualTokens);
  }

  /** OpenAI's patch cost. [T6] */
  function openaiImageTokens(width, height, opts) {
    const o = opts || {};
    const spec = K.OPENAI_IMAGE_PATCH;
    const patches = Math.ceil(width / spec.patchPx) * Math.ceil(height / spec.patchPx);
    const multiplier = spec.multipliers[o.variant] || spec.multipliers.default;
    const capped = Math.round(Math.min(patches, spec.budget) * multiplier);
    // GPT-5.6 and later at `original`/`auto` detail use the ORIGINAL patch count
    // with no budget cap, which is why this is a range rather than a number.
    const uncapped = Math.round(patches * multiplier);
    return { low: Math.min(capped, uncapped), high: Math.max(capped, uncapped) };
  }

  /** Which Claude resolution tier a model sits in. [T4] */
  function anthropicTierFor(model) {
    const id = String(model || '').toLowerCase();
    if (!id) return 'high';                       // current models are high-res
    if (/^claude-(fable|opus|sonnet|mythos)-5/.test(id)) return 'high';
    if (/^claude-opus-4-(7|8)/.test(id)) return 'high';
    return 'standard';
  }

  function costImage(parsed, target) {
    const provider = (target && target.provider) || 'unknown';
    const dims = parsed.dims;

    if (!dims || !dims.width || !dims.height) {
      // No dimensions means no geometry, and the provider rules are entirely
      // geometric. A band spanning a small image to a tier ceiling is the most
      // that can honestly be said.
      return {
        kind: 'image', textTokens: 0, visualTokens: 1500, total: 1500,
        low: 250, high: 4784, method: 'model-estimate', confidence: 'estimated',
        detail: 'image dimensions could not be read from the file header — wide estimate',
      };
    }

    if (provider === 'anthropic') {
      const tier = anthropicTierFor(target && target.canonicalModel);
      const tokens = anthropicImageTokens(dims.width, dims.height, tier);
      return {
        kind: 'image', textTokens: 0, visualTokens: tokens, total: tokens,
        low: tokens, high: tokens,
        width: dims.width, height: dims.height,
        // The geometry rule is published and exact; what is uncertain is only
        // whether claude.ai resizes before upload, which it may.
        method: 'local-tokenizer', confidence: 'high',
        detail: `${dims.width}x${dims.height} · ceil(w/28) x ceil(h/28) on the `
          + `${tier === 'high' ? 'high-resolution' : 'standard'} tier`,
      };
    }

    if (provider === 'openai') {
      const band = openaiImageTokens(dims.width, dims.height, {});
      return {
        kind: 'image', textTokens: 0,
        visualTokens: Math.round((band.low + band.high) / 2),
        total: Math.round((band.low + band.high) / 2),
        low: band.low, high: band.high,
        width: dims.width, height: dims.height,
        method: 'model-estimate', confidence: 'estimated',
        detail: `${dims.width}x${dims.height} · 32px patches; the range spans the `
          + '1536-patch budget and the uncapped original-detail count',
      };
    }

    const generic = anthropicImageTokens(dims.width, dims.height, 'standard');
    return {
      kind: 'image', textTokens: 0, visualTokens: generic, total: generic,
      low: Math.round(generic * 0.5), high: Math.round(generic * 3),
      width: dims.width, height: dims.height,
      method: 'generic-estimate', confidence: 'estimated',
      detail: `${dims.width}x${dims.height} · provider unknown, wide estimate`,
    };
  }

  // ── Opaque documents ──────────────────────────────────────────────────────

  /**
   * .docx, .pptx, .xlsx and friends.
   *
   * These are zip containers of compressed XML. Unzipping them locally is
   * possible but means shipping and maintaining a parser per format, and the
   * result would still be an estimate because both providers extract text from
   * them with their own converters. A byte-derived band, plainly labelled as
   * low confidence, costs nothing and claims nothing.
   */
  function costOpaque(parsed, info) {
    const size = parsed.size || 0;
    const band = K.OPAQUE_BYTES_PER_TOKEN;
    const low = Math.max(1, Math.round(size / band.low));
    const high = Math.max(low, Math.round(size / band.high));
    return {
      kind: 'opaque',
      textTokens: Math.round((low + high) / 2),
      visualTokens: 0,
      total: Math.round((low + high) / 2),
      low,
      high,
      method: 'generic-estimate',
      confidence: 'low',
      detail: `.${info.ext} is a compressed container — estimated from its ${formatBytes(size)} `
        + 'rather than read, so this is a wide band',
    };
  }

  function formatBytes(n) {
    if (!n) return '0 B';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} kB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }

  // ── Parse once, cost often ────────────────────────────────────────────────
  //
  // The split that keeps typing fast. Parsing is the expensive half — inflating
  // a 100-page PDF's content streams, walking a JPEG's segment chain, decoding a
  // 5 MB log file — and it depends only on the FILE. Costing is cheap and
  // depends on the MODEL. Since the model can change at any moment (a picker
  // click, a route change) and the file cannot, they are separated so a model
  // switch re-costs from cache instead of re-parsing.
  //
  // The tracker keys its cache on file identity; this function is what that
  // cache holds.

  /**
   * Everything about a file that does not depend on which model is selected.
   *
   * The parsed text of a document IS retained here, because re-reading it on
   * every model switch would be worse for both latency and privacy (more disk
   * reads of the user's files, not fewer). It lives in memory only, for as long
   * as the attachment is attached, and is dropped with it.
   */
  async function parse(file) {
    const info = classify(file);
    const base = {
      name: (file && file.name) || 'attachment',
      size: (file && file.size) || (file && file.bytes && file.bytes.length) || 0,
      mime: info.mime,
      ext: info.ext,
      kind: info.kind,
    };

    try {
      if (info.kind === 'text') {
        const text = decodeUtf8(await readBytes(file));
        return { ...base, text };
      }

      if (info.kind === 'pdf') {
        const bytes = await readBytes(file);
        const scan = decodeLatin1(bytes);
        const encrypted = /\/Encrypt\b/.test(scan);
        let extracted = { text: '', structure: '' };
        if (!encrypted) {
          try { extracted = await extractPdfText(bytes, scan); } catch (_) { /* keep the empty result */ }
        }
        const structural = countPdfPages(scan + extracted.structure);
        const pages = structural || estimatePagesFromBytes(bytes.length);
        const chars = extracted.text.replace(/\s+/g, ' ').trim().length;
        // Did extraction actually work? A text PDF yields hundreds of characters
        // per page; a handful means a scan, a CMap we cannot read, or encryption.
        const extractionUsable = !encrypted && pages > 0 && (chars / pages) >= 120;
        return {
          ...base,
          pages,
          pagesKnown: structural > 0,
          encrypted,
          chars,
          extractionUsable,
          text: extracted.text,
        };
      }

      if (info.kind === 'image') {
        return { ...base, dims: imageDimensions(await readBytes(file)) };
      }

      return { ...base };                      // opaque and unknown: size only
    } catch (err) {
      return { ...base, error: (err && err.message) || 'unreadable' };
    }
  }

  /**
   * Turn a parsed file into a token contribution for one detection target.
   *
   * Pure and synchronous, so a model switch re-costs every attachment in a
   * fraction of a millisecond.
   */
  function cost(parsed, target, options) {
    if (!parsed) return null;
    const base = {
      name: parsed.name, size: parsed.size, mime: parsed.mime, ext: parsed.ext,
    };
    if (parsed.error) {
      return {
        ...base, kind: parsed.kind, textTokens: 0, visualTokens: 0,
        total: 0, low: 0, high: 0,
        method: 'generic-estimate', confidence: 'unknown',
        detail: `could not be read (${parsed.error}) — not counted`,
      };
    }
    if (parsed.kind === 'text') return { ...base, ...costText(parsed.text || '', target) };
    if (parsed.kind === 'pdf') return { ...base, ...costPdf(parsed, target, options) };
    if (parsed.kind === 'image') return { ...base, ...costImage(parsed, target) };
    const opaque = { ...base, ...costOpaque(parsed, { ext: parsed.ext }) };
    if (parsed.kind !== 'opaque') {
      opaque.kind = 'unknown';
      opaque.detail = `unrecognised type .${parsed.ext || '?'} — estimated from ${formatBytes(parsed.size)}`;
    }
    return opaque;
  }

  /**
   * Parse and cost in one call.
   *
   * Always resolves — a file that cannot be read produces a zero-token record
   * with `confidence: 'unknown'` and an explanation, because an analyzer that
   * throws would take the whole breakdown down with it.
   */
  async function analyze(file, target, options) {
    return cost(await parse(file), target, options);
  }

  const PFDocumentAnalyzer = {
    classify,
    extensionOf,
    parse,
    cost,
    analyze,
    costText,
    costPdf,
    costImage,
    costOpaque,
    countPdfPages,
    extractPdfText,
    textFromContentStream,
    imageDimensions,
    anthropicImageTokens,
    anthropicTierFor,
    openaiImageTokens,
    formatBytes,
  };

  if (root) root.PFDocumentAnalyzer = PFDocumentAnalyzer;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFDocumentAnalyzer;
})(typeof self !== 'undefined' ? self : this);
