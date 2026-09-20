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

test('encodes space as plus when options.spaceAsPlus is true', () => {
  const result = encodeUrl('http://example.com/hello world', { spaceAsPlus: true });
  assert.strictEqual(result, 'http://example.com/hello+world');
});

test('encodes space as %20 when options.spaceAsPlus is false or omitted', () => {
  const result = encodeUrl('http://example.com/hello world');
  assert.strictEqual(result, 'http://example.com/hello%20world');
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
