'use strict';
/**
 * bench/paired/graders/task-04.cjs
 * Grader for TASK-P04: Detect Mocha Test Runner in detect.cjs
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

  t('detects mocha in devDependencies', () => {
    const res = detect.detectGates(targetDir, {}, { devDependencies: { mocha: '^10.0.0' } });
    assert.strictEqual(res.test.available, true);
    assert.strictEqual(res.test.command, 'npx mocha --reporter json');
    assert.strictEqual(res.test.reason, null);
  });

  t('cfg.testCommand overrides mocha', () => {
    const res = detect.detectGates(targetDir, { testCommand: 'custom mocha' }, { devDependencies: { mocha: '^10.0.0' } });
    assert.strictEqual(res.test.available, true);
    assert.strictEqual(res.test.command, 'custom mocha');
  });

  t('vitest takes precedence over mocha', () => {
    const res = detect.detectGates(targetDir, {}, { devDependencies: { vitest: '^1.0.0', mocha: '^10.0.0' } });
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
