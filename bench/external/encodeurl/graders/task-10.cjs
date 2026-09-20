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

const isAllowedChar = encodeUrl.isAllowedChar || (encodeUrl.default && encodeUrl.default.isAllowedChar);

test('isAllowedChar is exported as a function', () => {
  assert.strictEqual(typeof isAllowedChar, 'function');
});

test('isAllowedChar returns true for allowed ASCII chars (alphanumeric, -, _, ., etc)', () => {
  assert.strictEqual(isAllowedChar('a'.charCodeAt(0)), true);
  assert.strictEqual(isAllowedChar('Z'.charCodeAt(0)), true);
  assert.strictEqual(isAllowedChar('5'.charCodeAt(0)), true);
  assert.strictEqual(isAllowedChar('-'.charCodeAt(0)), true);
  assert.strictEqual(isAllowedChar('.'.charCodeAt(0)), true);
  assert.strictEqual(isAllowedChar('_'.charCodeAt(0)), true);
  assert.strictEqual(isAllowedChar('~'.charCodeAt(0)), true);
});

test('isAllowedChar returns false for control chars and spaces', () => {
  assert.strictEqual(isAllowedChar(' '.charCodeAt(0)), false);
  assert.strictEqual(isAllowedChar(0), false);
  assert.strictEqual(isAllowedChar(10), false);
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
