// PromptFootprint — tokenization constants, with their sources.
// ---------------------------------------------------------------------------
// EVERY number in this file comes from first-party provider documentation, and
// every one is annotated with where it came from and when it was checked. Model
// line-ups, tokenizers, and document pipelines all change; a constant whose
// origin is not written down cannot be re-verified, and an un-verifiable
// constant is how an extension ends up confidently reporting a number that
// stopped being true a year ago.
//
// It deliberately holds NO model list. Models, families, and context windows
// live in lib/models/catalog.js, which already exists and already carries its
// own sourcing. This file only says how a given model's input is COUNTED.
//
// Sources, checked 2026-08-20:
//
//   [T1] openai/tiktoken — tiktoken/model.py
//        MODEL_PREFIX_TO_ENCODING: "o1-", "o3-", "o4-mini-", "gpt-5",
//        "gpt-4.5-", "gpt-4.1-", "chatgpt-4o-", "gpt-4o-" -> o200k_base;
//        "gpt-4-", "gpt-3.5-turbo-" -> cl100k_base; "gpt-oss-" -> o200k_harmony.
//        Prefix matching is why "gpt-5.6-sol" resolves to o200k_base.
//   [T2] openai/tiktoken — tiktoken_ext/openai_public.py
//        The `pat_str` pre-tokenization regexes for cl100k_base and o200k_base,
//        reproduced verbatim in lib/tokens/counter.js.
//   [T3] Claude docs — Models overview. Context-window tooltips give the
//        official character/word anchors this file calibrates against:
//        Claude Fable 5 / Opus 5 / Sonnet 5: "1M tokens ~= 555k words,
//        ~2.5M unicode characters". Claude Opus 4.6 / Sonnet 4.6:
//        "1M tokens ~= 750k words, ~3.4M unicode characters".
//        Also: "Claude Fable 5 uses the tokenizer introduced with Claude
//        Opus 4.7; compared to models before Claude Opus 4.7, the same text
//        produces roughly 30% more tokens."
//   [T4] Claude docs — Vision, "Resolution and token cost":
//        "Each patch is a 28x28-pixel block of the image... An image, therefore,
//        costs ceil(width / 28) x ceil(height / 28) visual tokens."
//        High-resolution tier (Claude 4.7 and later): max long edge 2576 px,
//        max 4784 visual tokens. Standard tier: 1568 px, 1568 visual tokens.
//        claude.ai limits: 20 images per message, 10 MB per image, 8000x8000 px.
//   [T5] Claude docs — PDF support, "Estimate your costs":
//        "Each page typically uses 1,500-3,000 tokens per page depending on
//        content density." Plus: "The system converts each page of the document
//        into an image. The text from each page is extracted and provided
//        alongside each page's image", and image token costs use [T4].
//        Limits: 32 MB max request, 600 pages (100 under a 1M context window).
//   [T6] OpenAI API docs — Images and vision, image token calculation:
//        patch-based models cover the image in 32x32 px patches,
//        original_patch_count = ceil(width/32) x ceil(height/32), capped at a
//        per-detail token budget; over budget the image is scaled by
//        sqrt(budget * 32^2 / (width * height)). Mini/nano variants apply a
//        multiplier. GPT-4o-family models instead use the older tile system:
//        fit within 2048x2048, scale the shortest side to 768, then 512x512
//        tiles at 170 tokens each plus an 85-token base.
//   [T7] OpenAI API docs — File inputs: for vision-capable models the API
//        "extracts both text and page images and sends both to the model", so
//        PDF token usage "can increase significantly"; a `detail` field
//        (auto/low/high) controls page-image processing, and `auto` resolves to
//        `high` for GPT-5.6 and later and `low` for earlier models. Non-PDF
//        documents and text files have text extracted only.
//   [T8] OpenAI Help Center — Optimizing file uploads in ChatGPT:
//        ChatGPT stuffs document text into the context window up to roughly
//        110k tokens and sends the remainder to a private search index, from
//        which only relevant chunks are retrieved. Marked as under active
//        development. This is why an uploaded file's contribution on
//        chatgpt.com is a RANGE, not a number.
//   [T9] Claude docs — Token counting: the count_tokens endpoint is the only
//        authoritative count, "should be considered an estimate", and requires
//        sending the content to Anthropic. PromptFootprint does not call it —
//        see PRIVACY below.
//
// PRIVACY. Both providers offer an exact input-token count, and both require
// transmitting the user's prompt and documents to do it. PromptFootprint counts
// everything on-device instead, and labels the result an estimate. That trade is
// deliberate: a browser extension that quietly started uploading the documents
// you attach, in order to tell you how big they are, would be a worse product
// than one that says "approximately".

(function (root) {
  'use strict';

  const UPDATED_AT = '2026-08-20';

  // ── OpenAI encodings ──────────────────────────────────────────────────────

  /**
   * Model-id prefix -> encoding, mirroring tiktoken's own table. [T1]
   *
   * Ordered longest-prefix-first at lookup time, exactly as tiktoken resolves
   * `encoding_for_model`. Keeping the same shape means updating this table is a
   * matter of diffing one upstream file.
   */
  const OPENAI_ENCODING_BY_PREFIX = {
    'o1-': 'o200k_base',
    'o3-': 'o200k_base',
    'o4-mini-': 'o200k_base',
    'gpt-5': 'o200k_base',
    'gpt-4.5-': 'o200k_base',
    'gpt-4.1-': 'o200k_base',
    'chatgpt-4o-': 'o200k_base',
    'gpt-4o-': 'o200k_base',
    'gpt-oss-': 'o200k_harmony',
    'gpt-4-': 'cl100k_base',
    'gpt-3.5-turbo-': 'cl100k_base',
  };

  /**
   * Encoding used when the model is unknown.
   *
   * tiktoken's own cookbook recommends catching the KeyError from
   * `encoding_for_model` and falling back to o200k_base, which is also the
   * encoding every current OpenAI chat model uses. [T1]
   */
  const OPENAI_DEFAULT_ENCODING = 'o200k_base';

  // ── Per-tokenizer cost profiles ───────────────────────────────────────────
  //
  // PromptFootprint does not ship a BPE vocabulary. o200k_base alone is several
  // megabytes, it is fetched at runtime by tiktoken rather than embedded, and
  // Anthropic has never published theirs at all. So text is counted by splitting
  // it with the provider's REAL pre-tokenization rule — which is public and
  // exact — and then costing each resulting piece with a profile calibrated
  // against that provider's own published figures.
  //
  // The split is the accurate half: pre-tokenization decides where token
  // boundaries CAN fall, so no estimate can be off by more than the merge
  // behaviour inside a piece. The costing is the estimated half, and is why
  // every count this produces is labelled an estimate rather than a fact.
  //
  //   wordSingleMax    letters in a word piece that a vocabulary of this size
  //                    still holds as one token
  //   wordExtraChars   characters per additional token beyond that
  //   wordCharsPerToken  used instead of the two above where the vocabulary is
  //                    small enough that even short words split — the anchor is
  //                    a documented characters-per-token ratio [T3]
  //   punctRun / wsRun characters per token inside a run of punctuation or
  //                    whitespace (both merge aggressively in every BPE)
  //   nonLatinBytes    UTF-8 bytes per token outside the Latin scripts, where
  //                    coverage is driven by byte-level merges
  //   charsPerToken    the profile's own headline ratio, for documentation and
  //                    for the calibration tests to assert against
  const PROFILES = {
    // ~4 characters per token for English prose is the long-standing OpenAI
    // guidance and holds for o200k_base, whose 200k-entry vocabulary keeps
    // most common words whole.
    o200k_base: {
      id: 'o200k_base',
      label: 'o200k_base',
      wordSingleMax: 5,
      wordExtraChars: 4,
      punctRun: 3,
      wsRun: 6,
      nonLatinBytes: 4,
      charsPerToken: 4,
    },
    // cl100k_base has half the vocabulary and noticeably worse coverage of
    // non-English scripts.
    cl100k_base: {
      id: 'cl100k_base',
      label: 'cl100k_base',
      wordSingleMax: 4,
      wordExtraChars: 4,
      punctRun: 3,
      wsRun: 5,
      nonLatinBytes: 2,
      charsPerToken: 3.5,
    },
    // o200k_harmony extends o200k_base with control tokens for the open-weight
    // models' message format; the text merges are the same. [T1]
    o200k_harmony: {
      id: 'o200k_harmony',
      label: 'o200k_harmony',
      wordSingleMax: 5,
      wordExtraChars: 4,
      punctRun: 3,
      wsRun: 6,
      nonLatinBytes: 4,
      charsPerToken: 4,
    },
    // Claude's tokenizer from Opus 4.7 onward — the one every Claude 5 model
    // uses. Anchored on the documented 1M tokens ~= 2.5M unicode characters
    // and ~555k words. [T3]
    'claude-4.7': {
      id: 'claude-4.7',
      label: 'Claude tokenizer (Opus 4.7 and later)',
      // Tuned slightly above the headline 2.5 because `wordCharsPerToken` is
      // applied per WORD and rounded to whole tokens; feeding the raw ratio in
      // makes the rounding bias the total upward. 2.6 is the value at which a
      // representative prose corpus measures back out at ~2.5 characters per
      // token, which is the figure the documentation actually states. [T3]
      wordCharsPerToken: 2.6,
      punctRun: 2,
      wsRun: 4,
      nonLatinBytes: 2.5,
      charsPerToken: 2.5,
    },
    // Claude models before Opus 4.7, including Haiku 4.5. Anchored on the
    // documented 1M tokens ~= 3.4M characters and ~750k words. [T3]
    'claude-legacy': {
      id: 'claude-legacy',
      label: 'Claude tokenizer (before Opus 4.7)',
      // Same rounding correction as above, against the documented 3.4. [T3]
      wordCharsPerToken: 3.6,
      punctRun: 2.5,
      wsRun: 5,
      nonLatinBytes: 3,
      charsPerToken: 3.4,
    },
    // Used only when the provider itself is unknown. Sits between the two
    // families rather than pretending to be either.
    generic: {
      id: 'generic',
      label: 'generic approximation',
      wordSingleMax: 5,
      wordExtraChars: 4,
      punctRun: 3,
      wsRun: 5,
      nonLatinBytes: 3,
      charsPerToken: 3.5,
    },
  };

  /**
   * Which Claude tokenizer a model uses.
   *
   * The Claude 5 generation and Opus 4.7/4.8 use the newer one; everything
   * before Opus 4.7 — including Haiku 4.5, which shipped later but predates the
   * change — uses the old one. The same text is roughly 30% more tokens on the
   * newer tokenizer, which is far too large a difference to average over. [T3]
   */
  function anthropicProfileFor(canonicalModel) {
    const id = String(canonicalModel || '').toLowerCase();
    if (!id) return 'claude-4.7';                       // current default
    if (/^claude-(fable|opus|sonnet|mythos)-5/.test(id)) return 'claude-4.7';
    if (/^claude-opus-4-(7|8)/.test(id)) return 'claude-4.7';
    if (/^claude-(haiku|sonnet|opus)-/.test(id)) return 'claude-legacy';
    return 'claude-4.7';
  }

  // ── Anthropic PDF and image accounting ────────────────────────────────────

  /**
   * Claude turns EVERY PDF page into an image and extracts its text, then sends
   * both. [T5] So a PDF's cost has two components that must be shown
   * separately: they behave differently (text scales with density, the visual
   * part scales with page count) and only one of them is something the user can
   * reduce by pasting text instead.
   */
  const ANTHROPIC_PDF = {
    // "Each page typically uses 1,500-3,000 tokens per page depending on
    // content density." [T5] Used as a fallback when text extraction fails,
    // and as a sanity band around extraction that succeeded.
    textTokensPerPage: { low: 1500, high: 3000 },
    // Per-page image cost. A page rendered at a typical document aspect ratio
    // lands near the tier's visual-token ceiling, so the band is the standard
    // tier's cap at the low end and the high-resolution tier's at the top. [T4]
    imageTokensPerPage: { low: 1400, high: 4784 },
    maxPages: 600,
    maxPagesUnder1M: 100,
    maxRequestBytes: 32 * 1024 * 1024,
  };

  /** Claude vision, verbatim from [T4]. */
  const ANTHROPIC_IMAGE = {
    patchPx: 28,
    tiers: {
      // Claude 4.7 and later.
      high: { maxLongEdge: 2576, maxVisualTokens: 4784 },
      // Everything else.
      standard: { maxLongEdge: 1568, maxVisualTokens: 1568 },
    },
    maxDimensionPx: 8000,
    maxImagesPerMessageOnClaudeAi: 20,
    maxBytesOnClaudeAi: 10 * 1024 * 1024,
  };

  // ── OpenAI image accounting ───────────────────────────────────────────────

  /**
   * The patch system used by the GPT-4.1 and GPT-5 families. [T6]
   *
   * `budget` is the documented 1536-patch cap. GPT-5.6 with `detail` at
   * `original` or `auto` is documented as using the ORIGINAL patch count without
   * resizing, which is unbounded in practice — so an image on a current model is
   * reported as a range from the capped figure to the uncapped one rather than
   * as a single number we cannot justify.
   */
  const OPENAI_IMAGE_PATCH = {
    patchPx: 32,
    budget: 1536,
    lowDetailPatches: 256,       // a 512x512 rendering, 16x16 patches [T6]
    multipliers: { mini: 1.62, nano: 2.46, default: 1 },
  };

  /** The older tile system, still used by the GPT-4o family. [T6] */
  const OPENAI_IMAGE_TILE = {
    fitBox: 2048,
    shortSide: 768,
    tilePx: 512,
    tokensPerTile: 170,
    baseTokens: 85,
    lowDetailTokens: 85,
  };

  /**
   * ChatGPT's own document handling, which is NOT the API's. [T8]
   *
   * Text is stuffed into the context window up to roughly this many tokens and
   * the remainder goes to a retrieval index, so a 40-page PDF does not
   * necessarily put 40 pages of tokens in the request — and the extension cannot
   * see which chunks were retrieved. Everything above the cap is therefore
   * reported as "indexed, not in context" rather than counted.
   */
  const CHATGPT_UPLOAD = {
    contextStuffingTokens: 110000,
    note: 'ChatGPT places roughly the first 110k tokens of uploaded text in the '
      + 'context window and sends the rest to a private search index, retrieving '
      + 'only relevant chunks per question.',
  };

  /**
   * OpenAI PDF inputs on the API. [T7]
   *
   * Text is always extracted; page images are additionally processed, at `high`
   * detail by default on GPT-5.6 and later. chatgpt.com is governed by [T8]
   * instead, which is why the two are separate constants.
   */
  const OPENAI_PDF = {
    extractsText: true,
    processesPageImages: true,
    autoDetailIsHighFrom: 'gpt-5.6',
    maxBytesPerFile: 50 * 1024 * 1024,
  };

  // ── File classification ───────────────────────────────────────────────────

  /**
   * Extensions whose meaningful content is text and can therefore be read and
   * tokenized exactly as it will be sent. Deliberately a list of extensions
   * rather than a MIME check: browsers report `application/octet-stream` for
   * most source files, and `text/plain` for some binaries.
   */
  const TEXT_EXTENSIONS = [
    // plain documents and data
    'txt', 'md', 'markdown', 'rst', 'log', 'csv', 'tsv', 'json', 'jsonl', 'ndjson',
    'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'properties',
    // source code
    'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt',
    'kts', 'swift', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'php', 'pl', 'lua', 'r',
    'scala', 'clj', 'ex', 'exs', 'erl', 'hs', 'dart', 'sh', 'bash', 'zsh', 'fish',
    'ps1', 'bat', 'sql', 'graphql', 'gql', 'proto', 'tf', 'hcl', 'dockerfile',
    'makefile', 'gradle', 'vue', 'svelte', 'astro',
    // markup and styles
    'html', 'htm', 'css', 'scss', 'sass', 'less', 'svg', 'tex', 'bib',
    // notebooks are JSON, and the JSON is what gets sent
    'ipynb', 'patch', 'diff',
  ];

  const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'heic', 'tiff'];

  /**
   * Formats that are neither plain text nor images: zip containers (Office),
   * legacy binary documents, archives. Their text cannot be extracted without
   * shipping a parser for each one, so they are estimated from byte size and
   * marked low confidence rather than guessed at precisely.
   */
  const OPAQUE_EXTENSIONS = ['docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls', 'odt', 'ods',
    'odp', 'rtf', 'epub', 'zip', 'tar', 'gz', '7z', 'rar'];

  /**
   * Bytes of an opaque document per token of extracted text.
   *
   * A .docx is a zip of compressed XML: the deflated payload runs roughly 6-10
   * bytes per character of prose once markup is accounted for, and prose
   * tokenizes at 2.5-4 characters per token. The resulting band is wide, which
   * is the honest shape for a format we are not parsing — it is reported as a
   * range and never as a figure.
   */
  const OPAQUE_BYTES_PER_TOKEN = { low: 40, high: 12 };

  const PFTokenConstants = {
    UPDATED_AT,
    OPENAI_ENCODING_BY_PREFIX,
    OPENAI_DEFAULT_ENCODING,
    PROFILES,
    anthropicProfileFor,
    ANTHROPIC_PDF,
    ANTHROPIC_IMAGE,
    OPENAI_IMAGE_PATCH,
    OPENAI_IMAGE_TILE,
    OPENAI_PDF,
    CHATGPT_UPLOAD,
    TEXT_EXTENSIONS,
    IMAGE_EXTENSIONS,
    OPAQUE_EXTENSIONS,
    OPAQUE_BYTES_PER_TOKEN,
  };

  if (root) root.PFTokenConstants = PFTokenConstants;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFTokenConstants;
})(typeof self !== 'undefined' ? self : this);
