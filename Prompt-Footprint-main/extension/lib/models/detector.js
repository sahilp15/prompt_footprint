// PromptFootprint Live Model Detector
// ---------------------------------------------------------------------------
// Watches the page and reports the moment the user switches model, effort, tool
// mode, or conversation — without a reload, and without scanning the world.
//
// Shape of the loop:
//
//   DOM mutation / route change
//        -> throttled CHEAP scan   (~120 ms) reads only the control labels
//        -> debounced FULL recalc  (~350 ms) builds a whole observation
//        -> if the identity actually changed: bump `generation`, dispatch
//           `promptfootprint:modelchange`, hand both observations to the caller
//
// The generation counter is the cancellation primitive for everything async: an
// estimate or an optimizer result that comes back stamped with an old generation
// describes a model the user has already moved away from, and is dropped.
//
// Two things this deliberately does NOT do: patch fetch/XHR to sniff the model,
// and inject script into the page's world. Detection stays on accessible DOM
// state, which is also the state a screen reader would read.

(function (root) {
  'use strict';

  const OBS = (typeof PFModelObservation !== 'undefined') ? PFModelObservation : require('./observation.js');

  const MODEL_CHANGE_EVENT = 'promptfootprint:modelchange';
  const DEFAULT_THROTTLE_MS = 120;   // cheap label scan
  const DEFAULT_DEBOUNCE_MS = 350;   // full recalculation
  const DEFAULT_ROUTE_POLL_MS = 1000; // SPA pushState safety net

  function create(options) {
    const o = options || {};
    const adapter = o.adapter;
    const doc = o.document || (typeof document !== 'undefined' ? document : null);
    const win = o.window || (typeof window !== 'undefined' ? window : null);
    const timers = o.timers || {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id),
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (id) => clearInterval(id),
    };
    const throttleMs = o.throttleMs != null ? o.throttleMs : DEFAULT_THROTTLE_MS;
    const debounceMs = o.debounceMs != null ? o.debounceMs : DEFAULT_DEBOUNCE_MS;
    const routePollMs = o.routePollMs != null ? o.routePollMs : DEFAULT_ROUTE_POLL_MS;
    const log = o.log || function () {};

    let destroyed = false;
    let started = false;
    let generation = 0;
    let current = null;
    let previous = null;
    let scanTimer = null;
    let recalcTimer = null;
    let routeTimer = null;
    let lastHref = win && win.location ? win.location.href : null;
    let lastFingerprint = '';
    let boundRoots = [];
    let scopedObserver = null;

    /** Cheap signature of every model-ish control's label and selected state. */
    function fingerprint() {
      if (!adapter || !doc) return '';
      let controls = [];
      try { controls = adapter.findModelControls(doc) || []; } catch (_) { controls = []; }
      const parts = controls.slice(0, 40).map((el) => {
        const selected = OBS.isSelectedOption(el) ? '1' : '0';
        const hidden = OBS.isHiddenElement(el) ? 'h' : 'v';
        return `${selected}${hidden}:${OBS.controlText(el)}|${OBS.accessibleName(el)}`;
      });
      // Tool chips change the estimate too, so they belong in the signature.
      let tools = [];
      try { tools = adapter.readToolModes(doc) || []; } catch (_) { tools = []; }
      return `${parts.join('~')}##${tools.join(',')}`;
    }

    /**
     * Point the observer at the adapter's current roots. React replaces the
     * picker and composer subtrees on navigation, so the roots are re-resolved
     * every scan; `refresh` disconnects before re-observing, which is what keeps
     * a rebind from stacking a second observer on the same node.
     */
    function rebind() {
      if (destroyed || !adapter || !doc) return;
      let roots = [];
      try { roots = adapter.observeRoots(doc) || []; } catch (_) { roots = []; }
      const changed = roots.length !== boundRoots.length || roots.some((el, i) => el !== boundRoots[i]);
      if (!changed) return;
      boundRoots = roots;
      if (scopedObserver) scopedObserver.refresh(roots);
      log('detector: observer rebound to', roots.length, 'root(s)');
    }

    function scheduleScan() {
      if (destroyed || scanTimer) return;
      scanTimer = timers.setTimeout(() => {
        scanTimer = null;
        scan();
      }, throttleMs);
    }

    function scheduleRecalc(reason) {
      if (destroyed) return;
      if (recalcTimer) timers.clearTimeout(recalcTimer);
      recalcTimer = timers.setTimeout(() => {
        recalcTimer = null;
        recalc(reason);
      }, debounceMs);
    }

    /** Cheap pass: rebind if the DOM moved, and only escalate when it matters. */
    function scan() {
      if (destroyed) return;
      rebind();
      const href = win && win.location ? win.location.href : lastHref;
      if (href !== lastHref) {
        lastHref = href;
        log('detector: route changed ->', href);
        scheduleRecalc('route');
        return;
      }
      const fp = fingerprint();
      if (fp !== lastFingerprint) {
        lastFingerprint = fp;
        scheduleRecalc('dom');
      }
    }

    /** Full pass: build an observation and publish it if the identity changed. */
    function recalc(reason) {
      if (destroyed || !adapter) return null;
      let next;
      try {
        next = adapter.readModelObservation(doc, { url: win && win.location });
      } catch (e) {
        log('detector: read failed', e && e.message);
        return null;
      }
      if (OBS.observationsEqual(current, next)) {
        // Same situation. Refresh the timestamp only — no generation bump, no
        // event, so downstream work is never invalidated for nothing.
        if (current) current.observedAt = next.observedAt;
        return current;
      }
      generation += 1;
      next.generation = generation;
      previous = current;
      current = next;
      log('detector: model change (', reason, ') ->', next.selectedLabel, next.canonicalModel, 'gen', generation);
      // The very first read is a discovery, not a change: there is no previous
      // state for anything downstream to invalidate, and callers already have
      // `detector.current` the moment `start()` returns. Announcing it as a
      // change would make "the model changed" fire on every page load.
      if (previous === null) return next;
      if (win && typeof win.CustomEvent === 'function' && typeof win.dispatchEvent === 'function') {
        win.dispatchEvent(new win.CustomEvent(MODEL_CHANGE_EVENT, {
          detail: { previous, current: next },
        }));
      }
      if (typeof o.onChange === 'function') o.onChange(next, previous);
      return next;
    }

    const onRouteEvent = () => { lastHref = null; scheduleScan(); };

    function start() {
      if (started || destroyed || !adapter || !doc) return api;
      started = true;
      scopedObserver = OBS.createScopedObserver({
        document: doc,
        window: win,
        onChange: scheduleScan,
      });
      boundRoots = [];
      rebind();
      if (win && win.addEventListener) {
        win.addEventListener('popstate', onRouteEvent);
        win.addEventListener('hashchange', onRouteEvent);
      }
      // pushState/replaceState fire no event and we will not inject a script into
      // the page's world to hear them, so a low-frequency href check covers SPA
      // navigations. It reads one string; it is not a DOM scan.
      if (routePollMs > 0) {
        routeTimer = timers.setInterval(() => {
          if (destroyed) return;
          const href = win && win.location ? win.location.href : null;
          if (href !== lastHref) scheduleScan();
        }, routePollMs);
      }
      lastFingerprint = fingerprint();
      recalc('initial');
      return api;
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      started = false;
      if (scopedObserver) scopedObserver.destroy();
      scopedObserver = null;
      if (scanTimer) timers.clearTimeout(scanTimer);
      if (recalcTimer) timers.clearTimeout(recalcTimer);
      if (routeTimer) timers.clearInterval(routeTimer);
      scanTimer = recalcTimer = routeTimer = null;
      if (win && win.removeEventListener) {
        win.removeEventListener('popstate', onRouteEvent);
        win.removeEventListener('hashchange', onRouteEvent);
      }
      boundRoots = [];
    }

    const api = {
      start,
      destroy,
      /** Force a full recalculation now (used by tests and by explicit refresh). */
      refresh(reason) { return recalc(reason || 'manual'); },
      /** Force the cheap pass now. */
      poke() { scan(); },
      get current() { return current; },
      get previous() { return previous; },
      get generation() { return generation; },
      get destroyed() { return destroyed; },
      get observedRoots() { return boundRoots.slice(); },
      /** True when an async result stamped with `gen` still describes the present. */
      isCurrentGeneration(gen) { return gen === generation; },
    };
    return api;
  }

  const PFModelDetector = { create, MODEL_CHANGE_EVENT, DEFAULT_THROTTLE_MS, DEFAULT_DEBOUNCE_MS, DEFAULT_ROUTE_POLL_MS };

  if (root) root.PFModelDetector = PFModelDetector;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFModelDetector;
})(typeof self !== 'undefined' ? self : this);
