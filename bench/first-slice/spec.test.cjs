#!/usr/bin/env node
'use strict';
/**
 * bench/first-slice/spec.test.cjs
 *
 * Held-out grader acceptance specification for TASK-IB02-ESLINT-DETECT.
 * Evaluates candidate implementation of ESLint gate detection in src/gates/detect.cjs.
 *
 * INVARIANT: This file is held out from candidate context and never present
 * in the candidate workspace during generation.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function runGrader(targetDir = process.cwd()) {
  const detectPath = path.resolve(targetDir, 'src/gates/detect.cjs');
  if (!fs.existsSync(detectPath)) {
    console.error(`ERROR: Target source file not found at ${detectPath}`);
    return { passed: 0, failed: 1, exitCode: 1, error: 'SOURCE_NOT_FOUND' };
  }

  // Clear module cache for target to ensure clean evaluation
  delete require.cache[require.resolve(detectPath)];
  const detect = require(detectPath);

  let passed = 0;
  let failed = 0;
  const failures = [];

  function test(name, fn) {
    try {
      fn();
      passed++;
    } catch (err) {
      failed++;
      failures.push({ name, error: err.message });
      console.error(`FAIL: ${name} - ${err.message}`);
    }
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-spec-test-'));

  try {
    test('detects eslint when present in devDependencies', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ devDependencies: { eslint: '^9.0.0' } }),
        'utf8'
      );
      const d = detect.detectGates(tmpDir, {});
      assert.strictEqual(d.lint.available, true, 'lint.available must be true when eslint in devDependencies');
      assert.strictEqual(d.lint.command, 'npx eslint --format json .', 'lint.command must match npx eslint format');
      assert.strictEqual(d.lint.reason, null, 'lint.reason must be null when available');
    });

    test('detects eslint when present in dependencies', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ dependencies: { eslint: '^8.50.0' } }),
        'utf8'
      );
      const d = detect.detectGates(tmpDir, {});
      assert.strictEqual(d.lint.available, true, 'lint.available must be true when eslint in dependencies');
      assert.strictEqual(d.lint.command, 'npx eslint --format json .', 'lint.command must match npx eslint format');
      assert.strictEqual(d.lint.reason, null, 'lint.reason must be null when available');
    });

    test('respects cfg.lintCommand override even when eslint is present in manifest', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ devDependencies: { eslint: '^9.0.0' } }),
        'utf8'
      );
      const d = detect.detectGates(tmpDir, { lintCommand: 'custom-linter --check' });
      assert.strictEqual(d.lint.available, true, 'lint.available must be true on explicit override');
      assert.strictEqual(d.lint.command, 'custom-linter --check', 'lint.command must match explicit cfg.lintCommand');
      assert.strictEqual(d.lint.reason, null, 'lint.reason must be null on explicit override');
    });

    test('gives @biomejs/biome precedence over eslint', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ devDependencies: { '@biomejs/biome': '^1.0.0', eslint: '^9.0.0' } }),
        'utf8'
      );
      const d = detect.detectGates(tmpDir, {});
      assert.strictEqual(d.lint.available, true, 'lint.available must be true for biome');
      assert.strictEqual(d.lint.command, 'npx biome check --reporter=json .', 'biome must take precedence over eslint');
      assert.strictEqual(d.lint.reason, null, 'lint.reason must be null for biome');
    });

    test('returns available: false when no linter is configured or present in manifest', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ devDependencies: { prettier: '^3.0.0' } }),
        'utf8'
      );
      const d = detect.detectGates(tmpDir, {});
      assert.strictEqual(d.lint.available, false, 'lint.available must be false when no linter found');
      assert.strictEqual(d.lint.command, null, 'lint.command must be null when unavailable');
      assert.strictEqual(d.lint.reason, 'no linter configured', 'lint.reason must state no linter configured');
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  const exitCode = failed === 0 ? 0 : 1;
  return { passed, failed, failures, exitCode };
}

if (require.main === module) {
  const targetDir = process.argv[2] || process.cwd();
  const res = runGrader(targetDir);
  console.log(`Held-out spec: ${res.passed} passed, ${res.failed} failed`);
  process.exit(res.exitCode);
}

module.exports = { runGrader };
