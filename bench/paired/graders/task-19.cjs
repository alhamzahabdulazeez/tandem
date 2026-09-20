'use strict';
/**
 * bench/paired/graders/task-19.cjs
 * Grader for TASK-P19: Validate Config Schema
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

  t('exports validateConfig function', () => {
    assert.strictEqual(typeof config.validateConfig, 'function');
  });

  t('validates valid default configuration', () => {
    const res = config.validateConfig(config.DEFAULTS);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.errors.length, 0);
  });

  t('detects invalid maxRepairs / maxErrorsToModel', () => {
    const invalid = { ...config.DEFAULTS, maxRepairs: -1, maxErrorsToModel: 'invalid' };
    const res = config.validateConfig(invalid);
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.length >= 1);
  });

  t('detects invalid workingSet non-array', () => {
    const invalid = { ...config.DEFAULTS, workingSet: 'not-an-array' };
    const res = config.validateConfig(invalid);
    assert.strictEqual(res.valid, false);
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
