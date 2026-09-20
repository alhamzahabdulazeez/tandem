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

test('escapeHtml.escapeMap is exported as an object mapping characters to entities', () => {
  assert.strictEqual(typeof escapeHtml.escapeMap, 'object');
  assert.strictEqual(escapeHtml.escapeMap['"'], '&quot;');
  assert.strictEqual(escapeHtml.escapeMap['&'], '&amp;');
  assert.strictEqual(escapeHtml.escapeMap["'"], '&#39;');
  assert.strictEqual(escapeHtml.escapeMap['<'], '&lt;');
  assert.strictEqual(escapeHtml.escapeMap['>'], '&gt;');
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
