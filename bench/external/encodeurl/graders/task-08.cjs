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

test('encodeUrl has version property set to 2.0.0', () => {
  assert.strictEqual(encodeUrl.version, '2.0.0');
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
