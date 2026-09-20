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

test('returns false when req cache-control contains no-store', () => {
  const req = { 'cache-control': 'no-store', 'if-none-match': '"123"' };
  const res = { etag: '"123"' };
  assert.strictEqual(fresh(req, res), false);
});

test('returns false when res cache-control contains no-store', () => {
  const req = { 'if-none-match': '"123"' };
  const res = { 'cache-control': 'no-store, no-cache', etag: '"123"' };
  assert.strictEqual(fresh(req, res), false);
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
