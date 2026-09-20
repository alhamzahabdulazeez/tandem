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

const withBackticks = escapeHtml.withBackticks || (escapeHtml.default && escapeHtml.default.withBackticks);

test('withBackticks is exported as a function', () => {
  assert.strictEqual(typeof withBackticks, 'function');
});

test('withBackticks escapes backticks as &#96;', () => {
  assert.strictEqual(withBackticks('`code`'), '&#96;code&#96;');
});

test('withBackticks escapes both html entities and backticks', () => {
  assert.strictEqual(withBackticks('<script>`alert(1)`</script>'), '&lt;script&gt;&#96;alert(1)&#96;&lt;/script&gt;');
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
