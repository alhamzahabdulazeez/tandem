'use strict';
/**
 * bench/paired/graders/task-18.cjs
 * Grader for TASK-P18: Safe Execution with Timeout
 */
const assert = require('node:assert');
const path = require('node:path');

function runGrader(targetDir) {
  const runPath = path.resolve(targetDir, 'src', 'gates', 'run.cjs');
  delete require.cache[require.resolve(runPath)];
  const run = require(runPath);

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

  t('exports execSafe function', () => {
    assert.strictEqual(typeof run.execSafe, 'function');
  });

  t('executes simple command successfully', () => {
    const res = run.execSafe('node -e "console.log(\'hello safe\')"', targetDir, 5000);
    assert.strictEqual(res.code, 0);
    assert.ok(res.out.includes('hello safe'));
    assert.strictEqual(res.timedOut, false);
  });

  t('flags timedOut: true on timeout', () => {
    // node -e infinite loop with 200ms timeout
    const res = run.execSafe('node -e "while(true){}"', targetDir, 200);
    assert.strictEqual(res.timedOut, true);
    assert.notStrictEqual(res.code, 0);
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
