'use strict';
/**
 * bench/paired/graders/task-30.cjs
 * Grader for TASK-P30: Topological Sort of Dependency Graph
 */
const assert = require('node:assert');
const path = require('node:path');

function runGrader(targetDir) {
  const depPath = path.resolve(targetDir, 'src', 'context', 'depgraph.cjs');
  delete require.cache[require.resolve(depPath)];
  const dep = require(depPath);

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

  t('exports topologicalSort function', () => {
    assert.strictEqual(typeof dep.topologicalSort, 'function');
  });

  t('sorts acyclic graph dependency-first', () => {
    // a depends on b, b depends on c (c has no deps) -> order should put c before b, b before a
    const graph = {
      files: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
      imports: {
        'src/a.ts': ['src/b.ts'],
        'src/b.ts': ['src/c.ts'],
        'src/c.ts': []
      }
    };
    const order = dep.topologicalSort(graph);
    assert.ok(Array.isArray(order));
    assert.strictEqual(order.length, 3);
    const posA = order.indexOf('src/a.ts');
    const posB = order.indexOf('src/b.ts');
    const posC = order.indexOf('src/c.ts');
    assert.ok(posC < posB, 'c must precede b');
    assert.ok(posB < posA, 'b must precede a');
  });

  t('returns null when graph contains cycle', () => {
    const graph = {
      files: ['src/a.ts', 'src/b.ts'],
      imports: {
        'src/a.ts': ['src/b.ts'],
        'src/b.ts': ['src/a.ts']
      }
    };
    const order = dep.topologicalSort(graph);
    assert.strictEqual(order, null);
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
