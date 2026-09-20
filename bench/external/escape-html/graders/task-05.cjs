'use strict';
const path = require('node:path');
const assert = require('node:assert');

const targetDir = process.argv[2] || process.cwd();
const escapeHtml = require(path.join(targetDir, 'index.js'));

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

const tag = escapeHtml.tag || (escapeHtml.default && escapeHtml.default.tag);

test('tag is exported as a function', () => {
  assert.strictEqual(typeof tag, 'function');
});

test('tag escapes interpolated values in template strings', () => {
  const user = '<script>alert(1)</script>';
  const output = tag`<div>Hello ${user}</div>`;
  assert.strictEqual(output, '<div>Hello &lt;script&gt;alert(1)&lt;/script&gt;</div>');
});

test('tag handles multiple interpolated values', () => {
  const name = 'Alice & Bob';
  const role = '"Admin"';
  const output = tag`<span>${name} (${role})</span>`;
  assert.strictEqual(output, '<span>Alice &amp; Bob (&quot;Admin&quot;)</span>');
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
