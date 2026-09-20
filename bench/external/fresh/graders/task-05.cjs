'use strict';
const path = require('node:path');
const assert = require('node:assert');

const targetDir = process.argv[2] || process.cwd();
const fresh = require(path.join(targetDir, 'index.js'));

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

const isETagMatch = fresh.isETagMatch || (fresh.default && fresh.default.isETagMatch);

test('isETagMatch is exported as a function', () => {
  assert.strictEqual(typeof isETagMatch, 'function');
});

test('isETagMatch matches identical strong ETags', () => {
  assert.strictEqual(isETagMatch('"abc"', '"abc"'), true);
});

test('isETagMatch matches weak and strong ETags', () => {
  assert.strictEqual(isETagMatch('W/"abc"', '"abc"'), true);
  assert.strictEqual(isETagMatch('"abc"', 'W/"abc"'), true);
  assert.strictEqual(isETagMatch('W/"abc"', 'W/"abc"'), true);
});

test('isETagMatch returns false on mismatch', () => {
  assert.strictEqual(isETagMatch('"abc"', '"xyz"'), false);
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
