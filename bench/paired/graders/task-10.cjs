'use strict';
/**
 * bench/paired/graders/task-10.cjs
 * Grader for TASK-P10: Filter Diagnostics by Code in parse.cjs
 */
const assert = require('node:assert');
const path = require('node:path');

function runGrader(targetDir) {
  const parsePath = path.resolve(targetDir, 'src', 'gates', 'parse.cjs');
  delete require.cache[require.resolve(parsePath)];
  const parse = require(parsePath);

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

  t('exports filterByCode function', () => {
    assert.strictEqual(typeof parse.filterByCode, 'function');
  });

  t('filters errors matching array of ignored codes', () => {
    const errors = [
      { file: 'a.ts', code: 'TS2304', message: 'err1' },
      { file: 'b.ts', code: 'TS2307', message: 'err2' },
      { file: 'c.ts', code: 'TS2554', message: 'err3' }
    ];
    const filtered = parse.filterByCode(errors, ['TS2304', 'TS2307']);
    assert.strictEqual(filtered.length, 1);
    assert.strictEqual(filtered[0].code, 'TS2554');
  });

  t('retains errors where code is null/undefined or not in ignored set', () => {
    const errors = [
      { file: 'a.ts', code: null, message: 'generic error' },
      { file: 'b.ts', code: 'TS1005', message: 'syntax' }
    ];
    const filtered = parse.filterByCode(errors, ['TS2304']);
    assert.strictEqual(filtered.length, 2);
  });

  t('does not mutate original errors array', () => {
    const errors = [{ file: 'a.ts', code: 'TS2304' }];
    parse.filterByCode(errors, ['TS2304']);
    assert.strictEqual(errors.length, 1);
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
