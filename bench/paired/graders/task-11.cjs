'use strict';
/**
 * bench/paired/graders/task-11.cjs
 * Grader for TASK-P11: Group Diagnostics by File in parse.cjs
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

  t('exports groupByFile function', () => {
    assert.strictEqual(typeof parse.groupByFile, 'function');
  });

  t('groups multiple errors by their file property', () => {
    const errors = [
      { file: 'src/a.ts', line: 10, message: 'err1' },
      { file: 'src/b.ts', line: 5, message: 'err2' },
      { file: 'src/a.ts', line: 20, message: 'err3' }
    ];
    const grouped = parse.groupByFile(errors);
    assert.ok(grouped['src/a.ts']);
    assert.ok(grouped['src/b.ts']);
    assert.strictEqual(grouped['src/a.ts'].length, 2);
    assert.strictEqual(grouped['src/b.ts'].length, 1);
  });

  t('returns empty object for empty errors array', () => {
    const grouped = parse.groupByFile([]);
    assert.deepStrictEqual(grouped, {});
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
