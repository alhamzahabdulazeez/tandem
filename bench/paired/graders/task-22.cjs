'use strict';
/**
 * bench/paired/graders/task-22.cjs
 * Grader for TASK-P22: Normalize Working Set Globs
 */
const assert = require('node:assert');
const path = require('node:path');

function runGrader(targetDir) {
  const configPath = path.resolve(targetDir, 'src', 'core', 'config.cjs');
  delete require.cache[require.resolve(configPath)];
  const config = require(configPath);

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

  t('exports normalizeWorkingSet function', () => {
    assert.strictEqual(typeof config.normalizeWorkingSet, 'function');
  });

  t('trims, replaces backslashes, and deduplicates', () => {
    const raw = ['  src/**  ', 'src/**', 'src\\components\\**', '  test/** '];
    const normalized = config.normalizeWorkingSet(raw);

    assert.strictEqual(normalized.length, 3);
    assert.strictEqual(normalized[0], 'src/**');
    assert.strictEqual(normalized[1], 'src/components/**');
    assert.strictEqual(normalized[2], 'test/**');
  });

  t('handles empty array', () => {
    assert.deepStrictEqual(config.normalizeWorkingSet([]), []);
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
