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

const isFresh = fresh.isFresh || (fresh.default && fresh.default.isFresh);

test('isFresh is exported as a function', () => {
  assert.strictEqual(typeof isFresh, 'function');
});

test('isFresh works with object with headers property', () => {
  const req = { headers: { 'if-none-match': '"123"' } };
  const res = { headers: { etag: '"123"' } };
  assert.strictEqual(isFresh(req, res), true);
});

test('isFresh works with object with get method', () => {
  const req = {
    headers: {},
    get(name) {
      if (name.toLowerCase() === 'if-none-match') return '"123"';
      return undefined;
    }
  };
  const res = {
    headers: {},
    get(name) {
      if (name.toLowerCase() === 'etag') return '"123"';
      return undefined;
    }
  };
  assert.strictEqual(isFresh(req, res), true);
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
