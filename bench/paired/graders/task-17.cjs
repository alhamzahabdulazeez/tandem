'use strict';
/**
 * bench/paired/graders/task-17.cjs
 * Grader for TASK-P17: Sanitize Shell Commands
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

  t('exports sanitizeCommand function', () => {
    assert.strictEqual(typeof run.sanitizeCommand, 'function');
  });

  t('trims whitespace and returns clean command', () => {
    assert.strictEqual(run.sanitizeCommand('  npm run test  '), 'npm run test');
  });

  t('throws on semicolon', () => {
    assert.throws(() => run.sanitizeCommand('npm test; rm -rf /'), /disallowed/i);
  });

  t('throws on logical AND', () => {
    assert.throws(() => run.sanitizeCommand('npm run build && npm test'), /disallowed/i);
  });

  t('throws on logical OR', () => {
    assert.throws(() => run.sanitizeCommand('npm test || true'), /disallowed/i);
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
