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

const unescape = escapeHtml.unescape || (escapeHtml.default && escapeHtml.default.unescape);

test('unescape is exported as a function', () => {
  assert.strictEqual(typeof unescape, 'function');
});

test('unescape decodes standard html entities back to characters', () => {
  assert.strictEqual(unescape('&amp;foo &lt;&gt; bar &quot;fizz&quot; l&#39;a'), '&foo <> bar "fizz" l\'a');
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
