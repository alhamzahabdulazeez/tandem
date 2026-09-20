'use strict';
/**
 * bench/external/baseline-runner.cjs
 *
 * Zero-dependency, pure-Node Mocha-compatible test runner for external candidate repos.
 * Supports describe, context, it, specify, before, after, beforeEach, afterEach.
 */

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

function runTestsInDirectory(workDir) {
  const testDir = path.join(workDir, 'test');
  if (!fs.existsSync(testDir)) {
    console.error(`No test directory found at ${testDir}`);
    return { passed: 0, failed: 1, exitCode: 1 };
  }

  const testFiles = [];
  function collectFiles(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectFiles(full);
      } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.cjs'))) {
        testFiles.push(full);
      }
    }
  }
  collectFiles(testDir);

  if (testFiles.length === 0) {
    console.error(`No test files found under ${testDir}`);
    return { passed: 0, failed: 1, exitCode: 1 };
  }

  let passed = 0;
  let failed = 0;
  const failureDetails = [];

  const suiteStack = [{
    title: 'root',
    beforeHooks: [],
    afterHooks: [],
    beforeEachHooks: [],
    afterEachHooks: []
  }];

  function currentSuite() {
    return suiteStack[suiteStack.length - 1];
  }

  global.describe = global.context = function (title, fn) {
    const suite = {
      title,
      beforeHooks: [],
      afterHooks: [],
      beforeEachHooks: [],
      afterEachHooks: []
    };
    suiteStack.push(suite);
    try {
      fn.call(suite);
    } catch (err) {
      failed++;
      failureDetails.push(`Suite "${title}" definition error: ${err.message}`);
    } finally {
      for (const hook of suite.afterHooks) {
        try { hook(); } catch (err) { failed++; failureDetails.push(`after hook error in "${title}": ${err.message}`); }
      }
      suiteStack.pop();
    }
  };

  global.it = global.specify = function (title, fn) {
    if (!fn) return; // skipped test
    try {
      // Run all beforeEach hooks up the stack
      for (const s of suiteStack) {
        for (const hook of s.beforeEachHooks) {
          hook();
        }
      }

      fn();

      // Run all afterEach hooks down the stack
      for (let i = suiteStack.length - 1; i >= 0; i--) {
        for (const hook of suiteStack[i].afterEachHooks) {
          hook();
        }
      }

      passed++;
    } catch (err) {
      failed++;
      failureDetails.push(`Test "${title}" failed: ${err.message}`);
    }
  };

  global.before = function (fn) {
    if (fn) {
      try { fn(); } catch (err) { failed++; failureDetails.push(`before hook error: ${err.message}`); }
    }
  };

  global.after = function (fn) {
    if (fn) currentSuite().afterHooks.push(fn);
  };

  global.beforeEach = function (fn) {
    if (fn) currentSuite().beforeEachHooks.push(fn);
  };

  global.afterEach = function (fn) {
    if (fn) currentSuite().afterEachHooks.push(fn);
  };

  const origCwd = process.cwd();
  try {
    process.chdir(workDir);
    for (const file of testFiles) {
      // Clear require cache for local files
      delete require.cache[require.resolve(file)];
      require(file);
    }
  } catch (err) {
    failed++;
    failureDetails.push(`Error loading test file: ${err.message}`);
  } finally {
    process.chdir(origCwd);
  }

  for (const fail of failureDetails) {
    console.error('FAIL: ' + fail);
  }

  console.log(`${passed} passed, ${failed} failed`);
  return { passed, failed, exitCode: failed > 0 ? 1 : 0 };
}

if (require.main === module) {
  const targetDir = process.argv[2] || process.cwd();
  const res = runTestsInDirectory(targetDir);
  process.exit(res.exitCode);
}

module.exports = { runTestsInDirectory };
