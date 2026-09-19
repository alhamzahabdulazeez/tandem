'use strict';
/**
 * bench/paired/graders/task-27.cjs
 * Grader for TASK-P27: Priority for Decision Points
 */
const assert = require('node:assert');
const path = require('node:path');

function runGrader(targetDir) {
  const dpPath = path.resolve(targetDir, 'src', 'core', 'decision-points.cjs');
  delete require.cache[require.resolve(dpPath)];
  const dp = require(dpPath);

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

  t('exports priorityFor function', () => {
    assert.strictEqual(typeof dp.priorityFor, 'function');
  });

  t('maps standard decision points to correct priority numbers', () => {
    assert.strictEqual(dp.priorityFor('DP1_EDIT'), 1);
    assert.strictEqual(dp.priorityFor('DP2_IMPORT'), 2);
    assert.strictEqual(dp.priorityFor('DP3_DEPENDENTS'), 3);
    assert.strictEqual(dp.priorityFor('DP4_FAILURE'), 4);
    assert.strictEqual(dp.priorityFor('DP5_FINISH'), 5);
  });

  t('returns 0 for unknown or invalid decision points', () => {
    assert.strictEqual(dp.priorityFor('UNKNOWN'), 0);
    assert.strictEqual(dp.priorityFor(null), 0);
    assert.strictEqual(dp.priorityFor(undefined), 0);
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
