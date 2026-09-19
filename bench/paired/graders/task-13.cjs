'use strict';
/**
 * bench/paired/graders/task-13.cjs
 * Grader for TASK-P13: Track isConsecutive failure flag in repair.cjs
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

  t('returns isConsecutive false on initial failure', () => {
    const state = { lastFailureKey: '', repairCount: 0, greenTests: [] };
    const result = { errors: [{ file: 'a.ts', code: 'TS100', message: 'err' }] };
    const cfg = { maxRepairs: 3, blockOnRegression: false };

    const eval1 = repair.evaluate(state, result, 'typecheck', cfg);
    assert.strictEqual(eval1.isConsecutive, false);
    assert.strictEqual(eval1.repairCount, 1);
  });

  t('returns isConsecutive true when same failure repeats consecutively', () => {
    const state = { lastFailureKey: '', repairCount: 0, greenTests: [] };
    const result = { errors: [{ file: 'a.ts', code: 'TS100', message: 'err' }] };
    const cfg = { maxRepairs: 3, blockOnRegression: false };

    repair.evaluate(state, result, 'typecheck', cfg);
    const eval2 = repair.evaluate(state, result, 'typecheck', cfg);
    assert.strictEqual(eval2.isConsecutive, true);
    assert.strictEqual(eval2.repairCount, 2);
  });

  t('returns isConsecutive false when failure key changes', () => {
    const state = { lastFailureKey: '', repairCount: 0, greenTests: [] };
    const result1 = { errors: [{ file: 'a.ts', code: 'TS100', message: 'err' }] };
    const result2 = { errors: [{ file: 'b.ts', code: 'TS200', message: 'other' }] };
    const cfg = { maxRepairs: 3, blockOnRegression: false };

    repair.evaluate(state, result1, 'typecheck', cfg);
    const eval2 = repair.evaluate(state, result2, 'typecheck', cfg);
    assert.strictEqual(eval2.isConsecutive, false);
    assert.strictEqual(eval2.repairCount, 1);
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
