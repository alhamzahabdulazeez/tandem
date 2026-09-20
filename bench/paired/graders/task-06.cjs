'use strict';
/**
 * bench/paired/graders/task-06.cjs
 * Grader for TASK-P06: Export hasAnyDep Helper in detect.cjs
 */
const assert = require('node:assert');
const path = require('node:path');

function runGrader(targetDir) {
  const detectPath = path.resolve(targetDir, 'src', 'gates', 'detect.cjs');
  delete require.cache[require.resolve(detectPath)];
  const detect = require(detectPath);

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

  t('exports hasAnyDep function', () => {
    assert.strictEqual(typeof detect.hasAnyDep, 'function');
  });

  t('returns true when first name matches in dependencies', () => {
    const manifest = { dependencies: { jest: '^29.0.0', mocha: '^10.0.0' } };
    assert.strictEqual(detect.hasAnyDep(manifest, ['jest', 'vitest']), true);
  });

  t('returns true when second name matches in devDependencies', () => {
    const manifest = { devDependencies: { vitest: '^1.0.0' } };
    assert.strictEqual(detect.hasAnyDep(manifest, ['jest', 'vitest']), true);
  });

  t('returns false when no names match', () => {
    const manifest = { devDependencies: { eslint: '^8.0.0' } };
    assert.strictEqual(detect.hasAnyDep(manifest, ['jest', 'vitest']), false);
  });

  t('returns false on empty or null manifest or empty names array', () => {
    assert.strictEqual(detect.hasAnyDep(null, ['jest']), false);
    assert.strictEqual(detect.hasAnyDep({}, []), false);
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
