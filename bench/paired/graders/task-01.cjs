'use strict';
/**
 * bench/paired/graders/task-01.cjs
 * Grader for TASK-P01: Detect Standard Linter in detect.cjs
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

  t('detects standard in devDependencies', () => {
    const res = detect.detectGates(targetDir, {}, { devDependencies: { standard: '^17.0.0' } });
    assert.strictEqual(res.lint.available, true);
    assert.strictEqual(res.lint.command, 'npx standard --verbose');
    assert.strictEqual(res.lint.reason, null);
  });

  t('detects standard in dependencies', () => {
    const res = detect.detectGates(targetDir, {}, { dependencies: { standard: '^17.0.0' } });
    assert.strictEqual(res.lint.available, true);
    assert.strictEqual(res.lint.command, 'npx standard --verbose');
  });

  t('cfg.lintCommand overrides standard', () => {
    const res = detect.detectGates(targetDir, { lintCommand: 'custom lint' }, { devDependencies: { standard: '^17.0.0' } });
    assert.strictEqual(res.lint.available, true);
    assert.strictEqual(res.lint.command, 'custom lint');
  });

  t('@biomejs/biome takes precedence over standard', () => {
    const res = detect.detectGates(targetDir, {}, { devDependencies: { '@biomejs/biome': '^1.0.0', standard: '^17.0.0' } });
    assert.strictEqual(res.lint.available, true);
    assert.strictEqual(res.lint.command, 'npx biome check --reporter=json .');
  });

  t('returns available false when no linter in package.json', () => {
    const res = detect.detectGates(targetDir, {}, {});
    assert.strictEqual(res.lint.available, false);
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
