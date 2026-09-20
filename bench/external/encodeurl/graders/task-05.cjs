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

test('trims whitespace when options.trim is true', () => {
  const result = encodeUrl('  http://example.com/foo \t\n', { trim: true });
  assert.strictEqual(result, 'http://example.com/foo');
});

test('does not trim when options.trim is falsy or omitted', () => {
  const result = encodeUrl(' http://example.com/foo ');
  assert.strictEqual(result, '%20http://example.com/foo%20');
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
