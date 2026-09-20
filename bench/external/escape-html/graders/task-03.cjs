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

const isEscapeNeeded = escapeHtml.isEscapeNeeded || (escapeHtml.default && escapeHtml.default.isEscapeNeeded);

test('isEscapeNeeded is exported as a function', () => {
  assert.strictEqual(typeof isEscapeNeeded, 'function');
});

test('isEscapeNeeded returns false for plain string', () => {
  assert.strictEqual(isEscapeNeeded('hello world 123'), false);
});

test('isEscapeNeeded returns true when string contains html characters', () => {
  assert.strictEqual(isEscapeNeeded('hello <world>'), true);
  assert.strictEqual(isEscapeNeeded('"test"'), true);
  assert.strictEqual(isEscapeNeeded("it's"), true);
  assert.strictEqual(isEscapeNeeded('foo & bar'), true);
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
