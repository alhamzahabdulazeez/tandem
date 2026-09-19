'use strict';
/**
 * bench/paired/graders/task-12.cjs
 * Grader for TASK-P12: Parse Biome JSON Diagnostics in parse.cjs
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

  t('exports parseBiomeJson function', () => {
    assert.strictEqual(typeof parse.parseBiomeJson, 'function');
  });

  t('parses Biome reporter JSON output format', () => {
    const raw = JSON.stringify({
      diagnostics: [
        {
          location: { path: { file: 'src/app.ts' }, start: { line: 12, column: 3 } },
          category: 'lint/correctness/noUnusedVariables',
          description: 'This variable is unused.'
        }
      ]
    });
    const res = parse.parseBiomeJson(raw);
    assert.ok(Array.isArray(res));
    assert.strictEqual(res.length, 1);
    assert.strictEqual(res[0].file, 'src/app.ts');
    assert.strictEqual(res[0].line, 12);
    assert.strictEqual(res[0].column, 3);
    assert.strictEqual(res[0].code, 'lint/correctness/noUnusedVariables');
    assert.strictEqual(res[0].message, 'This variable is unused.');
  });

  t('returns empty array on empty diagnostics', () => {
    const res = parse.parseBiomeJson(JSON.stringify({ diagnostics: [] }));
    assert.deepStrictEqual(res, []);
  });

  t('returns null or empty array on non-JSON input', () => {
    const res = parse.parseBiomeJson('syntax error: not json');
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
