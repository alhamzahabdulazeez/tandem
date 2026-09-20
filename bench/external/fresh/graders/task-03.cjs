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

const parseTokenList = fresh.parseTokenList || (fresh.default && fresh.default.parseTokenList);

test('parseTokenList is exported as a function', () => {
  assert.strictEqual(typeof parseTokenList, 'function');
});

test('parseTokenList parses comma-separated list', () => {
  const list = parseTokenList('foo, bar, baz');
  assert.deepStrictEqual(list, ['foo', 'bar', 'baz']);
});

test('parseTokenList trims tabs and extra whitespace', () => {
  const list = parseTokenList(' \t"foo"  ,  \t"bar" ');
  assert.deepStrictEqual(list, ['"foo"', '"bar"']);
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
