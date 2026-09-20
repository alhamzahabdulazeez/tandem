'use strict';
/**
 * bench/paired/graders/task-15.cjs
 * Grader for TASK-P15: Export formatRegressionSummary in repair.cjs
 */
const assert = require('node:assert');
const path = require('node:path');

function runGrader(targetDir) {
  const repairPath = path.resolve(targetDir, 'src', 'gates', 'repair.cjs');
  delete require.cache[require.resolve(repairPath)];
  const repair = require(repairPath);

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

  t('exports formatRegressionSummary function', () => {
    assert.strictEqual(typeof repair.formatRegressionSummary, 'function');
  });

  t('returns "No regressions" when hasRegression is false', () => {
    const summary = repair.formatRegressionSummary({ hasRegression: false, regressed: [] });
    assert.strictEqual(summary, 'No regressions');
  });

  t('formats single test regression accurately', () => {
    const summary = repair.formatRegressionSummary({ hasRegression: true, regressed: ['test_login'] });
    assert.ok(summary.includes('REGRESSION'));
    assert.ok(summary.includes('1'));
    assert.ok(summary.includes('test_login'));
  });

  t('formats multi-test regression accurately', () => {
    const summary = repair.formatRegressionSummary({ hasRegression: true, regressed: ['test_auth', 'test_db'] });
    assert.ok(summary.includes('REGRESSION'));
    assert.ok(summary.includes('2'));
    assert.ok(summary.includes('test_auth'));
    assert.ok(summary.includes('test_db'));
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
