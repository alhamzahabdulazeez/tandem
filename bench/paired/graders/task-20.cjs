'use strict';
/**
 * bench/paired/graders/task-20.cjs
 * Grader for TASK-P20: Merge Configuration Objects
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

  t('exports mergeConfig function', () => {
    assert.strictEqual(typeof config.mergeConfig, 'function');
  });

  t('merges overrides onto base and ignores undefined overrides', () => {
    const base = { maxRepairs: 2, blockOnRegression: true, gateTimeoutMs: 120000 };
    const overrides = { maxRepairs: 5, gateTimeoutMs: undefined };
    const merged = config.mergeConfig(base, overrides);

    assert.strictEqual(merged.maxRepairs, 5);
    assert.strictEqual(merged.blockOnRegression, true);
    assert.strictEqual(merged.gateTimeoutMs, 120000);
  });

  t('does not mutate original base object', () => {
    const base = { maxRepairs: 2 };
    const merged = config.mergeConfig(base, { maxRepairs: 4 });
    assert.strictEqual(base.maxRepairs, 2);
    assert.strictEqual(merged.maxRepairs, 4);
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
