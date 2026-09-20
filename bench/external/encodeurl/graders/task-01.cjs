'use strict';
const path = require('node:path');
const assert = require('node:assert');

const targetDir = process.argv[2] || process.cwd();
const encodeUrl = require(path.join(targetDir, 'index.js'));

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

test('replaces unpaired surrogate with custom replacement string', () => {
  const result = encodeUrl('http://localhost/\uD83D', { replacement: '?' });
  assert.strictEqual(result, 'http://localhost/?');
});

test('replaces multiple unpaired surrogates with custom replacement', () => {
  const result = encodeUrl('\uD83Dfoo\uDC7B', { replacement: 'X' });
  assert.strictEqual(result, 'XfooX');
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
