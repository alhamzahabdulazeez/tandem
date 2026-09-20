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

test('returns true when last-modified equals if-unmodified-since', () => {
  const req = { 'if-unmodified-since': 'Sat, 01 Jan 2000 00:00:00 GMT' };
  const res = { 'last-modified': 'Sat, 01 Jan 2000 00:00:00 GMT' };
  assert.strictEqual(fresh(req, res), true);
});

test('returns false when last-modified is newer than if-unmodified-since', () => {
  const req = { 'if-unmodified-since': 'Sat, 01 Jan 2000 00:00:00 GMT' };
  const res = { 'last-modified': 'Sat, 01 Jan 2000 01:00:00 GMT' };
  assert.strictEqual(fresh(req, res), false);
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
