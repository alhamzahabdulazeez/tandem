'use strict';
/**
 * bench/paired/graders/task-14.cjs
 * Grader for TASK-P14: Support Per-Gate Custom Repair Limits in repair.cjs
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

  t('respects custom gate limit when gateMaxRepairs is provided', () => {
    const state = { lastFailureKey: '', repairCount: 0, greenTests: [] };
    const result = { errors: [{ file: 'a.js', code: 'lint-err', message: 'lint error' }] };
    const cfg = { maxRepairs: 5, gateMaxRepairs: { lint: 1 } };

    const eval1 = repair.evaluate(state, result, 'lint', cfg);
    assert.strictEqual(eval1.action, 'CONTINUE');

    const eval2 = repair.evaluate(state, result, 'lint', cfg);
    assert.strictEqual(eval2.action, 'REPORT_AND_STOP');
  });

  t('falls back to cfg.maxRepairs when gate not in gateMaxRepairs', () => {
    const state = { lastFailureKey: '', repairCount: 0, greenTests: [] };
    const result = { errors: [{ file: 'a.ts', code: 'ts-err', message: 'ts error' }] };
    const cfg = { maxRepairs: 3, gateMaxRepairs: { lint: 1 } };

    const eval1 = repair.evaluate(state, result, 'typecheck', cfg);
    assert.strictEqual(eval1.action, 'CONTINUE');
    const eval2 = repair.evaluate(state, result, 'typecheck', cfg);
    assert.strictEqual(eval2.action, 'CONTINUE');
    const eval3 = repair.evaluate(state, result, 'typecheck', cfg);
    assert.strictEqual(eval3.action, 'CONTINUE');
    const eval4 = repair.evaluate(state, result, 'typecheck', cfg);
    assert.strictEqual(eval4.action, 'REPORT_AND_STOP');
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
