'use strict';
/**
 * bench/paired/graders/task-02.cjs
 * Grader for TASK-P02: Detect Ruff Linter in detect.cjs
 */
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

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

  t('detects ruff in devDependencies', () => {
    const res = detect.detectGates(targetDir, {}, { devDependencies: { ruff: '^0.1.0' } });
    assert.strictEqual(res.lint.available, true);
    assert.strictEqual(res.lint.command, 'ruff check --output-format=json .');
  });

  t('detects ruff via ruff.toml in cwd', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-ruff-'));
    try {
      fs.writeFileSync(path.join(tmp, 'ruff.toml'), '# ruff config\n');
      const res = detect.detectGates(tmp, {}, {});
      assert.strictEqual(res.lint.available, true);
      assert.strictEqual(res.lint.command, 'ruff check --output-format=json .');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  t('cfg.lintCommand overrides ruff', () => {
    const res = detect.detectGates(targetDir, { lintCommand: 'custom ruff' }, { devDependencies: { ruff: '^0.1.0' } });
    assert.strictEqual(res.lint.available, true);
    assert.strictEqual(res.lint.command, 'custom ruff');
  });

  t('@biomejs/biome takes precedence over ruff in package.json', () => {
    const res = detect.detectGates(targetDir, {}, { devDependencies: { '@biomejs/biome': '^1.0.0', ruff: '^0.1.0' } });
    assert.strictEqual(res.lint.available, true);
    assert.strictEqual(res.lint.command, 'npx biome check --reporter=json .');
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
