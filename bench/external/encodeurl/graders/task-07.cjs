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

const decodeUrl = encodeUrl.decodeUrl || (encodeUrl.default && encodeUrl.default.decodeUrl);

test('decodeUrl is exported as a function', () => {
  assert.strictEqual(typeof decodeUrl, 'function');
});

test('decodeUrl decodes valid percent-encoded URL', () => {
  assert.strictEqual(decodeUrl('http://example.com/%20snow.html'), 'http://example.com/ snow.html');
});

test('decodeUrl does not throw on invalid percent sequence', () => {
  assert.doesNotThrow(() => {
    decodeUrl('http://example.com/%E0%A4%A');
  });
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
