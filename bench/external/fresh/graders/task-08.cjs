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

test('handles quoted commas in etag list without splitting them', () => {
  const req = { 'if-none-match': '"foo,bar", "baz"' };
  const res1 = { etag: '"foo,bar"' };
  const res2 = { etag: '"baz"' };
  const res3 = { etag: '"foo"' };
  assert.strictEqual(fresh(req, res1), true);
  assert.strictEqual(fresh(req, res2), true);
  assert.strictEqual(fresh(req, res3), false);
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
