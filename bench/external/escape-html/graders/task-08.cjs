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

const withSlash = escapeHtml.withSlash || (escapeHtml.default && escapeHtml.default.withSlash);

test('withSlash is exported as a function', () => {
  assert.strictEqual(typeof withSlash, 'function');
});

test('withSlash escapes forward slashes as &#x2F;', () => {
  assert.strictEqual(withSlash('</div>'), '&lt;&#x2F;div&gt;');
  assert.strictEqual(withSlash('http://example.com/'), 'http:&#x2F;&#x2F;example.com&#x2F;');
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
