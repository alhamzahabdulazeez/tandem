'use strict';
/**
 * bench/paired/graders/task-03.cjs
 * Grader for TASK-P03: Detect Jest Test Runner in detect.cjs
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

  t('detects jest in devDependencies', () => {
    const res = detect.detectGates(targetDir, {}, { devDependencies: { jest: '^29.0.0' } });
    assert.strictEqual(res.test.available, true);
    assert.strictEqual(res.test.command, 'npx jest --json');
    assert.strictEqual(res.test.reason, null);
  });

  t('detects jest in dependencies', () => {
    const res = detect.detectGates(targetDir, {}, { dependencies: { jest: '^29.0.0' } });
    assert.strictEqual(res.test.available, true);
    assert.strictEqual(res.test.command, 'npx jest --json');
  });

  t('cfg.testCommand overrides jest', () => {
    const res = detect.detectGates(targetDir, { testCommand: 'custom test' }, { devDependencies: { jest: '^29.0.0' } });
    assert.strictEqual(res.test.available, true);
    assert.strictEqual(res.test.command, 'custom test');
  });

  t('vitest takes precedence over jest', () => {
    const res = detect.detectGates(targetDir, {}, { devDependencies: { vitest: '^1.0.0', jest: '^29.0.0' } });
    assert.strictEqual(res.test.available, true);
    assert.strictEqual(res.test.command, 'npx vitest run --reporter=json');
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
