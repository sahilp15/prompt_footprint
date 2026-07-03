// PromptFootprint Writing-Format Helpers
// ---------------------------------------------------------------------------
// Render writing suggestions so the user can see exactly what changed: a
// word-level diff that wraps changed/inserted words in <strong>. All output is
// HTML-escaped first, so prompt text (which may contain < > &) can never inject
// markup into the suggestion chip.
//
// Pure and DOM-free → unit-testable under Node and usable as a content-script
// global. Formatting preservation (bullets, numbering, **bold**, paragraphs)
// lives in spellChecker.applySafeFixes, which edits text line-by-line and keeps
// each line's list/quote marker; these helpers only render previews.

(function (root) {
  'use strict';

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Tokenize into runs of whitespace and runs of non-whitespace, preserving
  // both so the rendered preview keeps the original spacing.
  function tokenize(text) {
    return String(text).match(/\s+|\S+/g) || [];
  }

  // Longest common subsequence of two token arrays (indices into `b` that are
  // part of the common run with `a`). Used to decide which improved tokens are
  // unchanged (plain) vs new/changed (bolded).
  function lcsCommonInB(a, b) {
    const n = a.length, m = b.length;
    const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const common = new Set();
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { common.add(j); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
    return common;
  }

  // Render `improved` with the words that differ from `original` bolded.
  // Whitespace is never bolded. Returns injection-safe HTML.
  function diffBold(original, improved) {
    const a = tokenize(original);
    const b = tokenize(improved);
    const common = lcsCommonInB(a, b);
    let html = '';
    for (let j = 0; j < b.length; j++) {
      const tok = b[j];
      const safe = escapeHtml(tok);
      if (/^\s+$/.test(tok) || common.has(j)) html += safe;
      else html += `<strong>${safe}</strong>`;
    }
    return html;
  }

  // Render one discrete suggestion as "original → **suggestion**" (the changed
  // text bolded), injection-safe. Capitalization/punctuation tidy-ups that have
  // no meaningful token form fall back to just the bolded suggestion label.
  // A suggestion whose replacement is '' (a filler word/phrase to delete, not
  // replace) renders as "original → remove" instead of an empty bold tag.
  function renderSuggestion(sug) {
    if (!sug) return '';
    if (sug.suggestion === '') {
      // Advisory content hints (repetition, long sentences, prompt-size) have no
      // replacement word — the reason explains them, so just show the flagged text.
      if (sug.type === 'clarity' || sug.type === 'size') return escapeHtml(sug.original);
      return `${escapeHtml(sug.original)} &rarr; <strong>remove</strong>`;
    }
    const to = `<strong>${escapeHtml(sug.suggestion)}</strong>`;
    if (sug.original && sug.original !== sug.suggestion) {
      return `${escapeHtml(sug.original)} &rarr; ${to}`;
    }
    return to;
  }

  const PFWritingFormat = { escapeHtml, tokenize, diffBold, renderSuggestion };

  if (root) root.PFWritingFormat = PFWritingFormat;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFWritingFormat;
})(typeof self !== 'undefined' ? self : this);
