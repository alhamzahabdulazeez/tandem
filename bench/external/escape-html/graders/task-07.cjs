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

const safe = escapeHtml.safe || (escapeHtml.default && escapeHtml.default.safe);

test('safe is exported as a function', () => {
  assert.strictEqual(typeof safe, 'function');
});

test('safe returns empty string for null and undefined', () => {
  assert.strictEqual(safe(null), '');
  assert.strictEqual(safe(undefined), '');
});

test('safe escapes strings normally', () => {
  assert.strictEqual(safe('<b>hello</b>'), '&lt;b&gt;hello&lt;/b&gt;');
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
