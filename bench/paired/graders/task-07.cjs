'use strict';
/**
 * bench/paired/graders/task-07.cjs
 * Grader for TASK-P07: Parse ESLint JSON Diagnostics in parse.cjs
 */
const assert = require('node:assert');
const path = require('node:path');

function runGrader(targetDir) {
  const parsePath = path.resolve(targetDir, 'src', 'gates', 'parse.cjs');
  delete require.cache[require.resolve(parsePath)];
  const parse = require(parsePath);

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

  t('exports parseEslintJson function', () => {
    assert.strictEqual(typeof parse.parseEslintJson, 'function');
  });

  t('parses standard ESLint JSON format correctly', () => {
    const raw = JSON.stringify([
      {
        filePath: 'src/app.js',
        messages: [{ line: 10, column: 5, ruleId: 'no-unused-vars', message: 'x is unused' }]
      }
    ]);
    const res = parse.parseEslintJson(raw);
    assert.strictEqual(Array.isArray(res), true);
    assert.strictEqual(res.length, 1);
    assert.deepStrictEqual(res[0], {
      file: 'src/app.js',
      line: 10,
      column: 5,
      code: 'no-unused-vars',
      message: 'x is unused'
    });
  });

  t('returns empty array for valid JSON with zero error messages', () => {
    const raw = JSON.stringify([{ filePath: 'src/app.js', messages: [] }]);
    const res = parse.parseEslintJson(raw);
    assert.deepStrictEqual(res, []);
  });

  t('returns null or empty array gracefully on invalid JSON', () => {
    const res = parse.parseEslintJson('not valid json');
    assert.ok(res === null || (Array.isArray(res) && res.length === 0));
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
