'use strict';
/**
 * bench/paired/graders/task-05.cjs
 * Grader for TASK-P05: Detect Pyright / Mypy Typecheckers in detect.cjs
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

  t('detects pyright via pyrightconfig.json', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-pyright-'));
    try {
      fs.writeFileSync(path.join(tmp, 'pyrightconfig.json'), '{}\n');
      const res = detect.detectGates(tmp, {}, {});
      assert.strictEqual(res.typecheck.available, true);
      assert.strictEqual(res.typecheck.command, 'pyright');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  t('detects mypy via mypy.ini', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-mypy-'));
    try {
      fs.writeFileSync(path.join(tmp, 'mypy.ini'), '[mypy]\n');
      const res = detect.detectGates(tmp, {}, {});
      assert.strictEqual(res.typecheck.available, true);
      assert.strictEqual(res.typecheck.command, 'mypy .');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  t('cfg.typecheckCommand overrides config files', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-pyright-override-'));
    try {
      fs.writeFileSync(path.join(tmp, 'pyrightconfig.json'), '{}\n');
      const res = detect.detectGates(tmp, { typecheckCommand: 'custom check' }, {});
      assert.strictEqual(res.typecheck.available, true);
      assert.strictEqual(res.typecheck.command, 'custom check');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
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
