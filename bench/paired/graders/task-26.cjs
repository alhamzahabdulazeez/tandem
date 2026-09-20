'use strict';
/**
 * bench/paired/graders/task-26.cjs
 * Grader for TASK-P26: Summarize State Metrics
 */
const assert = require('node:assert');
const path = require('node:path');

function runGrader(targetDir) {
  const statePath = path.resolve(targetDir, 'src', 'core', 'state.cjs');
  delete require.cache[require.resolve(statePath)];
  const stateMod = require(statePath);

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

  t('exports summarizeState function', () => {
    assert.strictEqual(typeof stateMod.summarizeState, 'function');
  });

  t('summarizes state metrics correctly', () => {
    const s = {
      repairCount: 3,
      greenTests: ['t1', 't2', 't3'],
      memory: [{ key: 'k1' }, { key: 'k2' }],
      errorCounts: { 'k1': 3, 'k2': 2, 'k3': 1 }
    };

    const summary = stateMod.summarizeState(s);
    assert.strictEqual(summary.greenCount, 3);
    assert.strictEqual(summary.lessonCount, 2);
    assert.strictEqual(summary.repairCount, 3);
    assert.strictEqual(summary.errorCountTotal, 6);
  });

  t('handles default empty state metrics', () => {
    const s = stateMod.empty();
    const summary = stateMod.summarizeState(s);
    assert.strictEqual(summary.greenCount, 0);
    assert.strictEqual(summary.lessonCount, 0);
    assert.strictEqual(summary.repairCount, 0);
    assert.strictEqual(summary.errorCountTotal, 0);
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
