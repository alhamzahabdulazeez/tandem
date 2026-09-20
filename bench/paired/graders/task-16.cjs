'use strict';
/**
 * bench/paired/graders/task-16.cjs
 * Grader for TASK-P16: Filter Ignored Error Codes in Gate Runner
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

  t('exports filterIgnoredCodes function', () => {
    assert.strictEqual(typeof run.filterIgnoredCodes, 'function');
  });

  t('filters out ignored codes from array', () => {
    const errors = [
      { file: 'a.ts', code: 'TS2304', message: 'Cannot find name' },
      { file: 'b.ts', code: 'TS2307', message: 'Cannot find module' },
      { file: 'c.ts', code: 'TS7006', message: 'Implicit any' }
    ];
    const filtered = run.filterIgnoredCodes(errors, ['TS2307', 'TS7006']);
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].code, 'TS2304');
  });

  t('supports Set as ignored parameter', () => {
    const errors = [
      { file: 'a.ts', code: 'TS100', message: 'err' },
      { file: 'b.ts', code: 'TS200', message: 'err' }
    ];
    const filtered = run.filterIgnoredCodes(errors, new Set(['TS100']));
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].code, 'TS200');
  });

  t('returns original or copy if ignored is empty/null', () => {
    const errors = [{ file: 'a.ts', code: 'TS100', message: 'err' }];
    const filtered = run.filterIgnoredCodes(errors, []);
    assert.strictEqual(filtered.length, 1);
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
