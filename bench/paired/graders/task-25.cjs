'use strict';
/**
 * bench/paired/graders/task-25.cjs
 * Grader for TASK-P25: Diff State Snapshots
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

  t('exports diffState function', () => {
    assert.strictEqual(typeof stateMod.diffState, 'function');
  });

  t('calculates difference between greenTests and lessons', () => {
    const prev = {
      greenTests: ['t1', 't2'],
      memory: [{ key: 'k1', message: 'm1' }]
    };
    const next = {
      greenTests: ['t2', 't3'],
      memory: [{ key: 'k1', message: 'm1' }, { key: 'k2', message: 'm2' }]
    };

    const diff = stateMod.diffState(prev, next);
    assert.deepStrictEqual(diff.newGreenTests, ['t3']);
    assert.deepStrictEqual(diff.lostGreenTests, ['t1']);
    assert.strictEqual(diff.newLessons.length, 1);
    assert.strictEqual(diff.newLessons[0].key, 'k2');
  });

  t('handles empty states cleanly', () => {
    const diff = stateMod.diffState({}, {});
    assert.deepStrictEqual(diff.newGreenTests, []);
    assert.deepStrictEqual(diff.lostGreenTests, []);
    assert.deepStrictEqual(diff.newLessons, []);
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
