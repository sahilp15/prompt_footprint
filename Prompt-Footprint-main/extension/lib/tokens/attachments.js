// PromptFootprint — keeping track of what is attached to the composer.
// ---------------------------------------------------------------------------
// The analyzer used to count the text box and nothing else. This is the piece
// that makes "Summarize this report" plus a 40-page PDF stop reporting nine
// tokens.
//
// TWO SOURCES OF TRUTH, DELIBERATELY
//
//   CAPTURE  tells us what a file CONTAINS. The only moments a page hands a
//            browser extension a real `File` object are the user's own actions:
//            a file picker's `change`, a `paste` carrying files, a `drop`. Those
//            are captured, and the File is kept so the content can be read.
//   THE DOM  tells us what is STILL ATTACHED. A captured file that the user then
//            removed must stop counting, and only the composer's chips know
//            that.
//
// Neither alone is enough, and the split is what makes the tracker resilient:
// if a product redesign invalidates every chip selector, captured files still
// count (we just get slower to notice a removal); if a file arrives by a route
// we never see (a restored draft, a picker we missed), the chip still puts it in
// the list — as a named attachment of unknown size, honestly labelled.
//
// PERFORMANCE. Parsing is keyed on file identity and happens once. Typing
// re-costs from that cache; a model switch re-costs from that cache. A 100-page
// PDF is inflated exactly once per attachment, never per keystroke.
//
// PRIVACY. Captured Files and their parsed text live in memory for as long as
// the attachment is attached to the composer, and are dropped on removal, on
// navigation, and on teardown. Nothing is persisted and nothing is transmitted.

(function (root) {
  'use strict';

  const DOCS = (typeof PFDocumentAnalyzer !== 'undefined') ? PFDocumentAnalyzer : require('./documents.js');

  /** DOM churn is coalesced into at most one attachment scan per this window. */
  const SYNC_DEBOUNCE_MS = 150;

  /**
   * Stable identity for a file.
   *
   * Name plus size plus mtime is what the File System API itself exposes, and it
   * is enough: two files with the same three are the same file for our purposes,
   * and the consequence of a collision is a reused token count, not a wrong one.
   * Hashing the contents would mean reading every attached file on every scan,
   * which is exactly the cost this key exists to avoid.
   */
  function fileKey(file) {
    if (!file) return '';
    return [file.name || 'file', file.size || 0, file.lastModified || 0].join('|');
  }

  /**
   * Do these two names refer to the same file?
   *
   * Chips truncate: `annual-report-2026-final.pdf` renders as
   * `annual-repo….pdf`. So a match is either exact, or a shared prefix plus the
   * same extension — which is what survives every truncation style the products
   * use (leading ellipsis, middle ellipsis, CSS overflow).
   */
  function namesMatch(chipName, fileName) {
    const a = String(chipName || '').toLowerCase().trim();
    const b = String(fileName || '').toLowerCase().trim();
    if (!a || !b) return false;
    if (a === b || a.includes(b)) return true;
    const ext = (s) => {
      const dot = s.lastIndexOf('.');
      return dot > 0 ? s.slice(dot + 1) : '';
    };
    if (ext(a) && ext(a) !== ext(b)) return false;
    const stem = (s) => s.replace(/\.[^.]*$/, '').replace(/[……]/g, '');
    const sa = stem(a);
    const sb = stem(b);
    if (!sa || !sb) return false;
    const shared = Math.min(6, sa.length, sb.length);
    return shared >= 3 && sa.slice(0, shared) === sb.slice(0, shared);
  }

  /**
   * Create a tracker for one page.
   *
   *   document   the page
   *   adapter    a platform adapter (attachmentSelectors, composerSurfaceSelector)
   *   getTarget  () -> the current detection target, read fresh on every cost
   *   getSurface () -> 'chatgpt' | 'claude-web' | …, which changes PDF accounting
   *   onChange   called whenever the attachment set or its costs change
   */
  function createTracker(options) {
    const o = options || {};
    const doc = o.document || (typeof document !== 'undefined' ? document : null);
    const adapter = o.adapter || null;
    const getTarget = typeof o.getTarget === 'function' ? o.getTarget : () => null;
    const getSurface = typeof o.getSurface === 'function' ? o.getSurface : () => null;
    const onChange = typeof o.onChange === 'function' ? o.onChange : () => {};
    const log = o.log || function () {};

    // key -> { file, name, parsed, record, parsing, seenAt, attached, source }
    const entries = new Map();
    // Chips naming a file we never captured. Counted as "present but unreadable"
    // rather than ignored: an attachment we cannot measure is still an
    // attachment, and silently dropping it is how the old analyzer got to nine.
    let unmatchedChips = [];
    // Has ANY attachment chip ever been recognised on this page? Distinguishes
    // "the user removed everything" from "our selectors do not match this
    // build", which look identical from a single scan.
    let anyChipEverSeen = false;
    let destroyed = false;
    let syncTimer = null;
    let observer = null;
    const cleanups = [];

    function on(target, type, handler, opts) {
      if (!target || !target.addEventListener) return;
      target.addEventListener(type, handler, opts);
      cleanups.push(() => target.removeEventListener(type, handler, opts));
    }

    // ── Capture ─────────────────────────────────────────────────────────────

    function noteFiles(files, source) {
      if (destroyed || !files) return 0;
      let added = 0;
      for (const file of Array.from(files)) {
        if (!file || !file.name) continue;
        const key = fileKey(file);
        if (entries.has(key)) {
          // Re-attached after a removal, or the same file picked twice.
          const existing = entries.get(key);
          existing.attached = true;
          existing.seenAt = Date.now();
          continue;
        }
        entries.set(key, {
          key, file, name: file.name, source,
          parsed: null, record: null, parsing: false,
          attached: true, seenAt: Date.now(),
        });
        added += 1;
      }
      if (added) {
        log('attachments: captured', added, 'file(s) via', source);
        parsePending();
      }
      return added;
    }

    /**
     * Parse everything that has not been parsed yet, once each.
     *
     * Sequential rather than parallel: attachments arrive in ones and twos, and
     * inflating four PDFs at the same time on the main thread is how an
     * extension makes a page feel broken.
     */
    async function parsePending() {
      for (const entry of Array.from(entries.values())) {
        if (destroyed) return;
        if (entry.parsed || entry.parsing || !entry.file) continue;
        entry.parsing = true;
        try {
          entry.parsed = await DOCS.parse(entry.file);
        } catch (err) {
          entry.parsed = { name: entry.name, kind: 'unknown', size: entry.file.size || 0, error: (err && err.message) || 'unreadable' };
        }
        entry.parsing = false;
        entry.record = null;                   // force a re-cost
        if (!destroyed) emit('parsed');
      }
    }

    // ── DOM synchronization ─────────────────────────────────────────────────

    function composerSurface() {
      if (!doc) return null;
      const sel = adapter && adapter.composerSurfaceSelector;
      if (sel) {
        try {
          const found = doc.querySelector(sel);
          if (found) return found;
        } catch (_) { /* selector churn — fall through */ }
      }
      return doc.body || null;
    }

    /** Every attachment-chip name the composer currently shows. */
    function readChipNames() {
      const surface = composerSurface();
      if (!surface || !surface.querySelectorAll) return [];
      const selectors = (adapter && adapter.attachmentSelectors) || [];
      const seen = new Set();
      const names = [];
      for (const selector of selectors) {
        let nodes = [];
        try { nodes = surface.querySelectorAll(selector); } catch (_) { continue; }
        for (const el of nodes) {
          if (seen.has(el)) continue;
          seen.add(el);
          const name = readName(el);
          // A chip must look like a file name. Without this the "Remove"
          // buttons and generic containers in the fallback list would each
          // contribute a phantom attachment.
          if (name && /\.[A-Za-z0-9]{1,8}(\s|$)/.test(name)) names.push(name);
        }
      }
      return names;
    }

    function readName(el) {
      const P = (typeof PFPlatforms !== 'undefined') ? PFPlatforms : null;
      if (P && typeof P.attachmentName === 'function') return P.attachmentName(el);
      return String(el.getAttribute?.('title') || el.getAttribute?.('aria-label') || el.textContent || '').trim();
    }

    /**
     * Reconcile captured files against what the composer is showing.
     *
     * The grace window matters: a file is captured on `drop` or `change` and the
     * product renders its chip a moment later, so a strict "no chip, not
     * attached" rule would drop every attachment for the first few hundred
     * milliseconds of its life and make the count flicker.
     */
    function syncFromDom() {
      if (destroyed || !doc) return;
      const chips = readChipNames();
      if (chips.length) anyChipEverSeen = true;
      const GRACE_MS = 2500;
      const now = Date.now();
      const claimed = new Set();
      let changed = false;

      for (const entry of entries.values()) {
        const chip = chips.find((name) => namesMatch(name, entry.name));
        if (chip) claimed.add(chip);
        let attached;
        if (chip) {
          attached = true;
          // Remembering that we once saw this file's chip is what makes its
          // DISAPPEARANCE meaningful. Without it, "no chips at all" is
          // ambiguous between "the user removed the only attachment" and "our
          // selectors do not match this build" — and guessing the second means a
          // removed file counts forever.
          entry.chipSeen = true;
        } else if (entry.chipSeen) {
          attached = false;
        } else if (now - entry.seenAt < GRACE_MS) {
          // Captured a moment ago; the product has not rendered its chip yet.
          attached = true;
        } else if (!chips.length && !anyChipEverSeen) {
          // No chip has ever been recognised on this page, for any file. The
          // selectors are not working here, so captured files are trusted rather
          // than discarded — a stale count beats a count of zero.
          attached = true;
        } else {
          attached = false;
        }
        if (attached !== entry.attached) {
          entry.attached = attached;
          changed = true;
          log('attachments:', entry.name, attached ? 'attached' : 'removed');
        }
      }

      // Drop removed entries entirely, so their file and parsed text stop being
      // held. Attachment state is ephemeral by design.
      for (const [key, entry] of Array.from(entries.entries())) {
        if (!entry.attached) entries.delete(key);
      }

      const orphans = chips.filter((name) => !claimed.has(name));
      if (orphans.join('|') !== unmatchedChips.join('|')) {
        unmatchedChips = orphans;
        changed = true;
      }
      if (changed) emit('dom');
    }

    function scheduleSync() {
      if (destroyed || syncTimer) return;
      syncTimer = setTimeout(() => { syncTimer = null; syncFromDom(); }, SYNC_DEBOUNCE_MS);
    }

    // ── Output ──────────────────────────────────────────────────────────────

    /**
     * The current attachments, costed against the current model.
     *
     * Costing is re-run whenever the target changes, from the cached parse — so
     * switching from ChatGPT to Claude re-prices a 40-page PDF instantly and
     * correctly, without touching the file again.
     */
    function attachments() {
      const target = getTarget();
      const surface = getSurface();
      const signature = JSON.stringify([target && target.provider, target && target.canonicalModel, surface]);
      const out = [];
      for (const entry of entries.values()) {
        if (!entry.attached) continue;
        if (!entry.parsed) {
          out.push({
            name: entry.name, kind: 'pending', total: 0, low: 0, high: 0,
            textTokens: 0, visualTokens: 0,
            method: 'generic-estimate', confidence: 'unknown',
            detail: 'reading…', pending: true,
          });
          continue;
        }
        if (!entry.record || entry.signature !== signature) {
          entry.record = DOCS.cost(entry.parsed, target, { surface });
          entry.signature = signature;
        }
        out.push(entry.record);
      }
      // Chips we could not match to a captured file. Named, counted as unknown,
      // and never given an invented number.
      for (const name of unmatchedChips) {
        out.push({
          name, kind: 'unknown', total: 0, low: 0, high: 0,
          textTokens: 0, visualTokens: 0,
          method: 'generic-estimate', confidence: 'unknown',
          unreadable: true,
          detail: 'attached before PromptFootprint could read it — its size is not included',
        });
      }
      return out;
    }

    function emit(reason) {
      try { onChange(reason); } catch (err) { log('attachments: listener failed', err && err.message); }
    }

    /** Forget everything. A new conversation is a new context. */
    function reset(reason) {
      const had = entries.size || unmatchedChips.length;
      entries.clear();
      unmatchedChips = [];
      anyChipEverSeen = false;
      if (had) {
        log('attachments: cleared (', reason || 'reset', ')');
        emit('reset');
      }
    }

    function start() {
      if (destroyed || !doc) return api;
      // The three moments a page hands an extension real File objects.
      on(doc, 'change', (e) => {
        const input = e.target;
        if (!input || String(input.tagName || '').toUpperCase() !== 'INPUT') return;
        if (input.type !== 'file' || !input.files || !input.files.length) return;
        noteFiles(input.files, 'file-picker');
        scheduleSync();
      }, true);

      on(doc, 'paste', (e) => {
        const dt = e.clipboardData;
        if (!dt) return;
        if (dt.files && dt.files.length) noteFiles(dt.files, 'paste');
        else if (dt.items) {
          const files = Array.from(dt.items)
            .filter((i) => i.kind === 'file')
            .map((i) => i.getAsFile())
            .filter(Boolean);
          if (files.length) noteFiles(files, 'paste');
        }
        scheduleSync();
      }, true);

      on(doc, 'drop', (e) => {
        const dt = e.dataTransfer;
        if (dt && dt.files && dt.files.length) noteFiles(dt.files, 'drop');
        scheduleSync();
      }, true);

      // Removals only show up in the DOM, so the chip area is watched. Scoped to
      // the composer surface rather than the document: the message thread
      // mutates constantly while a response streams, and none of it is relevant.
      if (typeof MutationObserver !== 'undefined') {
        observer = new MutationObserver(scheduleSync);
        const target = composerSurface();
        if (target) {
          try {
            observer.observe(target, { childList: true, subtree: true });
            cleanups.push(() => observer && observer.disconnect());
          } catch (_) { observer = null; }
        }
      }
      syncFromDom();
      return api;
    }

    function destroy() {
      destroyed = true;
      clearTimeout(syncTimer);
      syncTimer = null;
      while (cleanups.length) {
        const fn = cleanups.pop();
        try { fn(); } catch (_) { /* teardown must not throw */ }
      }
      entries.clear();
      unmatchedChips = [];
    }

    const api = {
      start,
      destroy,
      reset,
      noteFiles,
      syncFromDom,
      attachments,
      /** True while at least one attachment is still being parsed. */
      get parsing() {
        return Array.from(entries.values()).some((e) => e.parsing || (!e.parsed && e.file));
      },
      get size() { return entries.size; },
      /** Wait for parsing to settle. Tests and the first render use this. */
      async settle() {
        for (let i = 0; i < 200 && this.parsing; i += 1) {
          // eslint-disable-next-line no-await-in-loop
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        return this.attachments();
      },
    };
    return api;
  }

  const PFAttachmentTracker = {
    SYNC_DEBOUNCE_MS,
    fileKey,
    namesMatch,
    createTracker,
  };

  if (root) root.PFAttachmentTracker = PFAttachmentTracker;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFAttachmentTracker;
})(typeof self !== 'undefined' ? self : this);
