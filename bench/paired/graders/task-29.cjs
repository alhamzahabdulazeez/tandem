'use strict';
/**
 * bench/paired/graders/task-29.cjs
 * Grader for TASK-P29: Find Dependency Cycles in Graph
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

  t('exports findCycles function', () => {
    assert.strictEqual(typeof dep.findCycles, 'function');
  });

  t('detects simple 2-node cycle', () => {
    const graph = {
      files: ['src/a.ts', 'src/b.ts'],
      imports: {
        'src/a.ts': ['src/b.ts'],
        'src/b.ts': ['src/a.ts']
      }
    };
    const cycles = dep.findCycles(graph);
    assert.ok(Array.isArray(cycles));
    assert.ok(cycles.length >= 1);
    const cycleNodes = cycles[0];
    assert.ok(cycleNodes.includes('src/a.ts'));
    assert.ok(cycleNodes.includes('src/b.ts'));
  });

  t('returns empty array for acyclic DAG', () => {
    const graph = {
      files: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
      imports: {
        'src/a.ts': ['src/b.ts'],
        'src/b.ts': ['src/c.ts'],
        'src/c.ts': []
      }
    };
    const cycles = dep.findCycles(graph);
    assert.ok(Array.isArray(cycles));
    assert.strictEqual(cycles.length, 0);
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
