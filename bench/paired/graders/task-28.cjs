'use strict';
/**
 * bench/paired/graders/task-28.cjs
 * Grader for TASK-P28: Filter Decision Points
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

  t('exports filterPoints function', () => {
    assert.strictEqual(typeof dp.filterPoints, 'function');
  });

  t('filters out disabled points provided as array', () => {
    const points = ['DP1_EDIT', 'DP2_IMPORT', 'DP5_FINISH'];
    const filtered = dp.filterPoints(points, ['DP1_EDIT', 'DP5_FINISH']);
    assert.deepStrictEqual(filtered, ['DP2_IMPORT']);
  });

  t('filters out disabled points provided as Set or object map', () => {
    const points = ['DP1_EDIT', 'DP2_IMPORT', 'DP3_DEPENDENTS'];
    const filteredSet = dp.filterPoints(points, new Set(['DP2_IMPORT']));
    assert.deepStrictEqual(filteredSet, ['DP1_EDIT', 'DP3_DEPENDENTS']);
  });

  t('handles empty or undefined disabled points', () => {
    const points = ['DP1_EDIT', 'DP2_IMPORT'];
    assert.deepStrictEqual(dp.filterPoints(points, []), points);
    assert.deepStrictEqual(dp.filterPoints(points, null), points);
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
