'use strict';
/**
 * bench/paired/graders/task-24.cjs
 * Grader for TASK-P24: Reset Session State
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

  t('exports resetSession function', () => {
    assert.strictEqual(typeof stateMod.resetSession, 'function');
  });

  t('resets ephemeral fields while preserving persistent errorCounts and memory', () => {
    const s = {
      repairCount: 5,
      lastFailureKey: 'someKey',
      greenTests: ['test_1', 'test_2'],
      disabled: { 'DP1_EDIT': true },
      seenImports: ['lodash'],
      gates: { lint: { available: true } },
      graphStamp: 12345,
      errorCounts: { 'src/a.ts|TS100': 3 },
      memory: [{ key: 'src/a.ts|TS100', file: 'src/a.ts', code: 'TS100' }]
    };

    const reset = stateMod.resetSession(s);
    assert.strictEqual(reset.repairCount, 0);
    assert.strictEqual(reset.lastFailureKey, '');
    assert.deepStrictEqual(reset.greenTests, []);
    assert.deepStrictEqual(reset.disabled, {});
    assert.deepStrictEqual(reset.errorCounts, { 'src/a.ts|TS100': 3 });
    assert.strictEqual(reset.memory.length, 1);
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
