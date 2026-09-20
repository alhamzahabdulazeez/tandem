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

const component = encodeUrl.component || (encodeUrl.default && encodeUrl.default.component);

test('component is exported as a function', () => {
  assert.strictEqual(typeof component, 'function');
});

test('component encodes query parameters while keeping percent encodings', () => {
  assert.strictEqual(component('foo bar'), 'foo%20bar');
  assert.strictEqual(component('foo%20bar'), 'foo%20bar');
  assert.strictEqual(component('foo&bar=1?'), 'foo%26bar%3D1%3F');
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
