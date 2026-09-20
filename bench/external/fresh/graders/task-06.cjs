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

test('returns false when cache-control contains s-maxage=0 with matching etag', () => {
  const req = { 'cache-control': 's-maxage=0', 'if-none-match': '"123"' };
  const res = { etag: '"123"' };
  assert.strictEqual(fresh(req, res), false);
});

test('returns false when cache-control contains s-maxage = 0 with spacing', () => {
  const req = { 'cache-control': 'public, s-maxage = 0, must-revalidate', 'if-none-match': '"123"' };
  const res = { etag: '"123"' };
  assert.strictEqual(fresh(req, res), false);
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
