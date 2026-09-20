'use strict';
const path = require('node:path');
const assert = require('node:assert');

const targetDir = process.argv[2] || process.cwd();
const escapeHtml = require(path.join(targetDir, 'index.js'));

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failed++;
    console.error(`FAIL: ${name} - ${err.message}`);
  }
}

const custom = escapeHtml.custom || (escapeHtml.default && escapeHtml.default.custom);

test('custom is exported as a function', () => {
  assert.strictEqual(typeof custom, 'function');
});

test('custom replaces characters mapped in custom dictionary', () => {
  const customMap = { '[': '(', ']': ')', '$': 'USD ' };
  const res = custom('[price: $10]', customMap);
  assert.strictEqual(res, '(price: USD 10)');
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
