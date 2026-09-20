'use strict';
/**
 * bench/paired/graders/task-21.cjs
 * Grader for TASK-P21: Support TANDEM_MAX_ERRORS Env Override
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

  const origErrors = process.env.TANDEM_MAX_ERRORS;
  const origRepairs = process.env.TANDEM_MAX_REPAIRS;

  try {
    t('uses defaults when env vars are not set', () => {
      delete process.env.TANDEM_MAX_ERRORS;
      delete process.env.TANDEM_MAX_REPAIRS;
      const cfg = config.load(targetDir);
      assert.strictEqual(cfg.maxErrorsToModel, config.DEFAULTS.maxErrorsToModel);
      assert.strictEqual(cfg.maxRepairs, config.DEFAULTS.maxRepairs);
    });

    t('overrides maxErrorsToModel from TANDEM_MAX_ERRORS', () => {
      process.env.TANDEM_MAX_ERRORS = '42';
      const cfg = config.load(targetDir);
      assert.strictEqual(cfg.maxErrorsToModel, 42);
    });

    t('overrides maxRepairs from TANDEM_MAX_REPAIRS', () => {
      process.env.TANDEM_MAX_REPAIRS = '7';
      const cfg = config.load(targetDir);
      assert.strictEqual(cfg.maxRepairs, 7);
    });
  } finally {
    if (origErrors !== undefined) process.env.TANDEM_MAX_ERRORS = origErrors;
    else delete process.env.TANDEM_MAX_ERRORS;
    if (origRepairs !== undefined) process.env.TANDEM_MAX_REPAIRS = origRepairs;
    else delete process.env.TANDEM_MAX_REPAIRS;
  }

  console.log(`${passed} passed, ${failed} failed`);
  return { passed, failed, exitCode: failed === 0 ? 0 : 1 };
}

if (require.main === module) {
  const targetDir = process.argv[2] || process.cwd();
  const res = runGrader(targetDir);
  process.exit(res.exitCode);
}

module.exports = { runGrader };
