const test = require('node:test');
const assert = require('node:assert');
const PFFormat = require('../lib/formatters.js');

// These assertions pin the exact strings the popup ({ main, sub }) and the
// in-page modal (compact) rendered before the conversion logic was centralized.
// They must not change without an intentional UI decision.

test('water: popup main/sub matches original wording across all branches', () => {
  assert.deepStrictEqual(pick(PFFormat.water(0)),      { main: '0 drops',   sub: 'of water' });
  assert.deepStrictEqual(pick(PFFormat.water(0.02)),   { main: '< 1 drop',  sub: 'of water' });
  assert.deepStrictEqual(pick(PFFormat.water(1)),      { main: '≈ 20 drops', sub: 'of water' });
  assert.deepStrictEqual(pick(PFFormat.water(2.5)),    { main: '≈ 0.5 tsp', sub: 'of water' });
  assert.deepStrictEqual(pick(PFFormat.water(125)),    { main: '≈ 50%',     sub: 'of a glass of water' });
  assert.deepStrictEqual(pick(PFFormat.water(500)),    { main: '≈ 2.0 glasses', sub: 'of water' });
});

test('water: compact (modal) matches original single-line wording', () => {
  assert.strictEqual(PFFormat.water(0).compact,    '0 drops');
  assert.strictEqual(PFFormat.water(0.02).compact, '< 1 drop');
  assert.strictEqual(PFFormat.water(1).compact,    '≈ 20 drops');
  assert.strictEqual(PFFormat.water(2.5).compact,  '≈ 0.5 tsp');
  assert.strictEqual(PFFormat.water(125).compact,  '≈ 50% of a glass');
  assert.strictEqual(PFFormat.water(500).compact,  '≈ 2.0 glasses');
});

test('energy: popup main/sub matches original wording across all branches', () => {
  assert.deepStrictEqual(pick(PFFormat.energy(0)),      { main: '< 1 sec', sub: 'of phone use' });
  assert.deepStrictEqual(pick(PFFormat.energy(0.001)),  { main: '< 2 sec', sub: 'of phone screen-on' });
  assert.deepStrictEqual(pick(PFFormat.energy(0.01)),   { main: '≈ 12s',   sub: 'of phone screen-on' });
  assert.deepStrictEqual(pick(PFFormat.energy(0.1)),    { main: '≈ 2 min', sub: 'of phone screen-on' });
  assert.deepStrictEqual(pick(PFFormat.energy(5)),      { main: '≈ 1.7 hrs', sub: 'of phone screen-on' });
});

test('energy: compact (modal) matches original single-line wording', () => {
  assert.strictEqual(PFFormat.energy(0).compact,     '< 1 sec phone');
  assert.strictEqual(PFFormat.energy(0.001).compact, '< 2 sec phone');
  assert.strictEqual(PFFormat.energy(0.01).compact,  '≈ 12s phone');
  assert.strictEqual(PFFormat.energy(0.1).compact,   '≈ 2 min phone');
  assert.strictEqual(PFFormat.energy(5).compact,     '≈ 1.7 hr phone');
});

test('co2: popup main/sub matches original wording across all branches', () => {
  assert.deepStrictEqual(pick(PFFormat.co2(0)),     { main: '< 1 cm',  sub: 'driven by car' });
  assert.deepStrictEqual(pick(PFFormat.co2(0.1)),   { main: '≈ 50 cm', sub: 'driven by car' });
  assert.deepStrictEqual(pick(PFFormat.co2(10)),    { main: '≈ 50.0 m', sub: 'driven by car' });
  assert.deepStrictEqual(pick(PFFormat.co2(500)),   { main: '≈ 2.50 km', sub: 'driven by car' });
});

test('co2: compact (modal) matches original single-line wording', () => {
  assert.strictEqual(PFFormat.co2(0).compact,   '< 1 cm by car');
  assert.strictEqual(PFFormat.co2(0.1).compact, '≈ 50 cm by car');
  assert.strictEqual(PFFormat.co2(10).compact,  '≈ 50.0 m by car');
  assert.strictEqual(PFFormat.co2(500).compact, '≈ 2.50 km by car');
});

function pick({ main, sub }) {
  return { main, sub };
}
