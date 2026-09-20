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

const isEncoded = encodeUrl.isEncoded || (encodeUrl.default && encodeUrl.default.isEncoded);

test('isEncoded is exported as a function', () => {
  assert.strictEqual(typeof isEncoded, 'function');
});

test('isEncoded returns true for valid URL with no special chars', () => {
  assert.strictEqual(isEncoded('http://example.com/foo/bar?q=1#top'), true);
});

test('isEncoded returns true for already percent-encoded URL', () => {
  assert.strictEqual(isEncoded('http://example.com/%20snow.html'), true);
});

test('isEncoded returns false for URL with raw spaces or special characters', () => {
  assert.strictEqual(isEncoded('http://example.com/ snow.html'), false);
  assert.strictEqual(isEncoded('http://example.com/\nsnow.html'), false);
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
