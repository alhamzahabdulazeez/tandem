'use strict';
/**
 * bench/paired/graders/task-09.cjs
 * Grader for TASK-P09: Parse Pytest Output in parse.cjs
 */
const assert = require('node:assert');
const path = require('node:path');

function runGrader(targetDir) {
  const parsePath = path.resolve(targetDir, 'src', 'gates', 'parse.cjs');
  delete require.cache[require.resolve(parsePath)];
  const parse = require(parsePath);

  let passed = 0;
  let failed = 0;

  function t(name, fn) {
    try {
      fn();
      passed++;
    } catch (err) {
      failed++;
      console.error(`FAIL: ${name} ->`, err.message);
    }
  }

  t('exports parsePytest function', () => {
    assert.strictEqual(typeof parse.parsePytest, 'function');
  });

  t('parses pytest stdout with passed and failed tests', () => {
    const raw = `
tests/test_math.py::test_add PASSED
tests/test_math.py::test_div FAILED - ZeroDivisionError: division by zero
tests/test_math.py::test_mul PASSED
`;
    const res = parse.parsePytest(raw);
    assert.ok(res);
    assert.strictEqual(res.passing.length, 2);
    assert.strictEqual(res.errors.length, 1);
    assert.ok(res.errors[0].file.includes('tests/test_math.py'));
    assert.ok(res.errors[0].message.includes('ZeroDivisionError') || res.errors[0].message.includes('test_div'));
  });

  t('handles empty or unrecognized output without crashing', () => {
    const res = parse.parsePytest('no tests were run\n');
    assert.ok(res);
    assert.deepStrictEqual(res.errors, []);
    assert.deepStrictEqual(res.passing, []);
  });

  console.log(`${passed} passed, ${failed} failed`);
  return { passed, failed, exitCode: failed === 0 ? 0 : 1 };
}

if (require.main === module) {
  const targetDir = process.argv[2] || process.cwd();
  const res = runGrader(targetDir);
  process.exit(res.exitCode);
}

module.exports = { runGrader };
