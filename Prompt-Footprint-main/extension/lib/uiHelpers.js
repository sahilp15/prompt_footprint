// PromptFootprint UI Helpers (pure, testable)
// ---------------------------------------------------------------------------
// Small DOM-free helpers shared by the content script: the panel keyboard
// shortcut predicate and the draggable-capsule viewport clamp. Kept here (not
// inline in content.js) so they can be unit-tested under Node without a browser.

(function (root) {
  'use strict';

  // Main-panel shortcut: Alt+P. Deliberately NOT Ctrl/Cmd+P (print) and not a
  // plain letter, so it won't fire while the user is typing a prompt. We also
  // require no Ctrl/Cmd/Shift so it can't collide with other Alt+Shift combos.
  function isPanelToggleShortcut(e) {
    if (!e) return false;
    if (!(e.altKey === true && !e.ctrlKey && !e.metaKey && !e.shiftKey)) return false;
    // Match by physical key (e.code) too: on macOS, Alt/Option+P yields key='π'.
    const key = (e.key || '').toLowerCase();
    return key === 'p' || e.code === 'KeyP';
  }

  // Human-readable label for the shortcut (shown in the UI).
  const PANEL_SHORTCUT_LABEL = 'Alt+P';

  // Clamp a {left, top} position so an element of {width, height} stays fully
  // inside the viewport with an 8px margin — never permanently off-screen, even
  // if the window shrank since the position was saved. `margin` is configurable.
  function clampToViewport(pos, size, viewport, margin) {
    const m = typeof margin === 'number' ? margin : 8;
    const vw = viewport && viewport.width || 0;
    const vh = viewport && viewport.height || 0;
    const w = size && size.width || 0;
    const h = size && size.height || 0;
    const maxLeft = Math.max(m, vw - w - m);
    const maxTop = Math.max(m, vh - h - m);
    const left = Math.min(Math.max(m, (pos && pos.left) || 0), maxLeft);
    const top = Math.min(Math.max(m, (pos && pos.top) || 0), maxTop);
    return { left, top };
  }

  const PFUiHelpers = { isPanelToggleShortcut, PANEL_SHORTCUT_LABEL, clampToViewport };

  if (root) root.PFUiHelpers = PFUiHelpers;
  if (typeof module !== 'undefined' && module.exports) module.exports = PFUiHelpers;
})(typeof self !== 'undefined' ? self : this);
