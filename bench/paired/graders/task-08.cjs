'use strict';
/**
 * bench/paired/graders/task-08.cjs
 * Grader for TASK-P08: Parse Jest JSON in parse.cjs
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

  t('exports parseJestJson function', () => {
    assert.strictEqual(typeof parse.parseJestJson, 'function');
  });

  t('parses Jest JSON output with pass and fail results', () => {
    const raw = JSON.stringify({
      testResults: [
        {
          name: 'test/calc.test.js',
          assertionResults: [
            { status: 'passed', fullName: 'calc adds numbers' },
            { status: 'failed', fullName: 'calc divides by zero', failureMessages: ['Expected error to be thrown'] }
          ]
        }
      ]
    });
    const res = parse.parseJestJson(raw);
    assert.ok(res);
    assert.strictEqual(res.passing.length, 1);
    assert.strictEqual(res.passing[0], 'calc adds numbers');
    assert.strictEqual(res.errors.length, 1);
    assert.strictEqual(res.errors[0].file, 'test/calc.test.js');
    assert.ok(res.errors[0].message.includes('Expected error'));
  });

  t('returns empty arrays when testResults is empty', () => {
    const res = parse.parseJestJson(JSON.stringify({ testResults: [] }));
    assert.deepStrictEqual(res, { errors: [], passing: [] });
  });

  t('returns null gracefully on non-JSON input', () => {
    const res = parse.parseJestJson('syntax error: not json');
    assert.ok(res === null || (typeof res === 'object' && res.errors?.length === 0));
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
