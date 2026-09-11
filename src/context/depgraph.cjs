'use strict';
/**
 * Dependency graph — powers DP3.
 *
 * Research finding this addresses: every agent performs measurably worse on existing
 * codebases than on greenfield ones, because agents verify what they touched, not what
 * depends on it. DP3 needs to know who imports a file before it is edited.
 *
 * Deliberately a regex scan, not a full parser: it must be fast enough to run before an
 * edit, and it only needs import specifiers.
 */
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const SKIP = new Set(['node_modules', 'dist', 'build', 'coverage', '.git', '.tandem']);

const IMPORT_PATTERNS = [
  /import\s+[^'"]*from\s*['"]([^'"]+)['"]/g,
  /import\s*['"]([^'"]+)['"]/g,
  /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /export\s+[^'"]*from\s*['"]([^'"]+)['"]/g,
];

function walk(dir, root, acc) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.') continue;
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, root, acc);
    else if (SOURCE.test(e.name)) acc.push(rel(root, full));
  }
  return acc;
}

function rel(root, f) {
  return path.relative(root, f).split(path.sep).join('/');
}

function extractImports(text) {
  const found = new Set();
  for (const re of IMPORT_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) found.add(m[1]);
  }
  return [...found];
}

/** Resolve a relative specifier to a project file, trying the usual extensions. */
function resolveRelative(fromFile, spec, files) {
  if (!spec.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  const stripped = base.replace(/\.(js|mjs|cjs)$/, '');
  const candidates = [
    base, stripped,
    stripped + '.ts', stripped + '.tsx', stripped + '.mts', stripped + '.cts',
    stripped + '.js', stripped + '.jsx', stripped + '.mjs', stripped + '.cjs',
    stripped + '/index.ts', stripped + '/index.js',
  ];
  const set = new Set(files);
  for (const c of candidates) if (set.has(c)) return c;
  return null;
}

/**
 * Build the graph.
 * @returns {{files:string[], imports:Record<string,string[]>, dependents:Record<string,string[]>,
 *            external:Record<string,string[]>}}
 */
function build(root) {
  const files = walk(root, root, []);
  const imports = {};
  const dependents = {};
  const external = {};
  for (const f of files) { imports[f] = []; dependents[f] = []; external[f] = []; }

  for (const f of files) {
    let text;
    try { text = fs.readFileSync(path.join(root, f), 'utf8'); } catch { continue; }
    for (const spec of extractImports(text)) {
      const target = resolveRelative(f, spec, files);
      if (target) {
        imports[f].push(target);
        dependents[target].push(f);
      } else if (!spec.startsWith('.')) {
        external[f].push(spec);
      }
    }
  }
  return { files, imports, dependents, external };
}

function dependentsOf(graph, file) {
  return (graph.dependents[file] || []).slice();
}

function dependentCount(graph, file) {
  return (graph.dependents[file] || []).length;
}

module.exports = { build, dependentsOf, dependentCount, extractImports, resolveRelative };
