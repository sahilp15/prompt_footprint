const test = require('node:test');
const assert = require('node:assert');
const U = require('../lib/uiHelpers.js');

test('isPanelToggleShortcut matches Alt+P only', () => {
  assert.strictEqual(U.isPanelToggleShortcut({ altKey: true, key: 'p' }), true);
  assert.strictEqual(U.isPanelToggleShortcut({ altKey: true, key: 'P' }), true);
});

test('isPanelToggleShortcut matches by physical key on macOS (Option+P → π)', () => {
  assert.strictEqual(U.isPanelToggleShortcut({ altKey: true, key: 'π', code: 'KeyP' }), true);
});

test('isPanelToggleShortcut ignores plain typing and other combos', () => {
  assert.strictEqual(U.isPanelToggleShortcut({ key: 'p' }), false);            // just typing p
  assert.strictEqual(U.isPanelToggleShortcut({ ctrlKey: true, key: 'p' }), false); // Ctrl+P (print)
  assert.strictEqual(U.isPanelToggleShortcut({ metaKey: true, key: 'p' }), false);
  assert.strictEqual(U.isPanelToggleShortcut({ altKey: true, shiftKey: true, key: 'p' }), false);
  assert.strictEqual(U.isPanelToggleShortcut({ altKey: true, key: 'a' }), false);
  assert.strictEqual(U.isPanelToggleShortcut(null), false);
});

test('PANEL_SHORTCUT_LABEL is the documented default', () => {
  assert.strictEqual(U.PANEL_SHORTCUT_LABEL, 'Alt+P');
});

test('clampToViewport keeps an on-screen position unchanged', () => {
  const p = U.clampToViewport({ left: 100, top: 100 }, { width: 80, height: 40 }, { width: 1000, height: 800 });
  assert.deepStrictEqual(p, { left: 100, top: 100 });
});

test('clampToViewport pulls an off-screen position back into view', () => {
  const p = U.clampToViewport({ left: 5000, top: 5000 }, { width: 80, height: 40 }, { width: 1000, height: 800 });
  assert.strictEqual(p.left, 1000 - 80 - 8);
  assert.strictEqual(p.top, 800 - 40 - 8);
});

test('clampToViewport never goes below the margin (negative input)', () => {
  const p = U.clampToViewport({ left: -50, top: -50 }, { width: 80, height: 40 }, { width: 1000, height: 800 });
  assert.deepStrictEqual(p, { left: 8, top: 8 });
});

test('clampToViewport stays valid when the element is larger than the viewport', () => {
  const p = U.clampToViewport({ left: 10, top: 10 }, { width: 2000, height: 2000 }, { width: 300, height: 300 });
  assert.deepStrictEqual(p, { left: 8, top: 8 });
});
