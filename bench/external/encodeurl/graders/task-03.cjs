'use strict';
const path = require('node:path');
const assert = require('node:assert');

const targetDir = process.argv[2] || process.cwd();
const encodeUrl = require(path.join(targetDir, 'index.js'));

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

test('ENCODE_CHARS_REGEXP is exported as a RegExp', () => {
  assert.ok(encodeUrl.ENCODE_CHARS_REGEXP instanceof RegExp);
});

test('UNMATCHED_SURROGATE_PAIR_REGEXP is exported as a RegExp', () => {
  assert.ok(encodeUrl.UNMATCHED_SURROGATE_PAIR_REGEXP instanceof RegExp);
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
