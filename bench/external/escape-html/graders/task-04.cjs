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

const attribute = escapeHtml.attribute || (escapeHtml.default && escapeHtml.default.attribute);

test('attribute is exported as a function', () => {
  assert.strictEqual(typeof attribute, 'function');
});

test('attribute safely escapes attribute string', () => {
  assert.strictEqual(attribute('foo "bar" & <baz>'), 'foo &quot;bar&quot; &amp; &lt;baz&gt;');
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
