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

const parseHttpDate = fresh.parseHttpDate || (fresh.default && fresh.default.parseHttpDate);

test('parseHttpDate is exported as a function', () => {
  assert.strictEqual(typeof parseHttpDate, 'function');
});

test('parseHttpDate parses valid GMT string', () => {
  const ts = parseHttpDate('Sat, 01 Jan 2000 00:00:00 GMT');
  assert.strictEqual(ts, 946684800000);
});

test('parseHttpDate returns NaN on invalid string or non-string', () => {
  assert.ok(Number.isNaN(parseHttpDate('not a date')));
  assert.ok(Number.isNaN(parseHttpDate(null)));
  assert.ok(Number.isNaN(parseHttpDate(undefined)));
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
