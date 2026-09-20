'use strict';
/**
 * bench/paired/graders/task-23.cjs
 * Grader for TASK-P23: Clear Memory Key from State
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

  t('exports clearMemory function', () => {
    assert.strictEqual(typeof stateMod.clearMemory, 'function');
  });

  t('clears memory items matching key and resets errorCounts', () => {
    const s = {
      ...stateMod.empty(),
      errorCounts: { 'src/a.ts|TS100': 3, 'src/b.ts|TS200': 2 },
      memory: [
        { key: 'src/a.ts|TS100', file: 'src/a.ts', code: 'TS100' },
        { key: 'src/b.ts|TS200', file: 'src/b.ts', code: 'TS200' }
      ]
    };

    const removedCount = stateMod.clearMemory(s, 'src/a.ts|TS100');
    assert.strictEqual(removedCount, 1);
    assert.strictEqual(s.memory.length, 1);
    assert.strictEqual(s.memory[0].key, 'src/b.ts|TS200');
    assert.strictEqual(s.errorCounts['src/a.ts|TS100'], undefined);
  });

  t('returns 0 when targetKey not found', () => {
    const s = stateMod.empty();
    const removedCount = stateMod.clearMemory(s, 'nonexistent');
    assert.strictEqual(removedCount, 0);
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
