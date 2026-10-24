'use strict';
/**
 * Hallucinated-import detection. Extracts the modules a source file imports
 * and checks each new one resolves: a relative path to a real file, a Node
 * builtin, or a package the project actually depends on / has installed.
 * Python files are checked with the project's own interpreter.
 */

const fs = require('node:fs');
const path = require('node:path');
const { builtinModules } = require('node:module');
const { spawnSync } = require('node:child_process');

const JS_EXT = new Set(['.js', '.cjs', '.mjs', '.jsx', '.ts', '.cts', '.mts', '.tsx']);
const BUILTIN = new Set(builtinModules.concat(builtinModules.map((m) => `node:${m}`)));

function langOf(rel) {
  const ext = path.extname(rel).toLowerCase();
  if (JS_EXT.has(ext)) return 'js';
  if (ext === '.py') return 'py';
  return null;
}

/** Module specifiers imported by a JS/TS source (static, dynamic, require, export-from). */
function jsImports(src) {
  const text = String(src || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  const out = new Set();
  const res = [
    /\bimport\s+(?:type\s+)?(?:[\w*{}\s,$]+\s+from\s+)?['"]([^'"\n]+)['"]/g,
    /\bexport\s+(?:type\s+)?(?:\*|\{[^}]*\})(?:\s+as\s+\w+)?\s+from\s+['"]([^'"\n]+)['"]/g,
    /\b(?:require|import)\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
  ];
  for (const re of res) for (const m of text.matchAll(re)) out.add(m[1]);
  return out;
}

/** Top-level module names imported by a Python source. */
function pyImports(src) {
  const out = new Set();
  for (const raw of String(src || '').split('\n')) {
    const line = raw.replace(/#.*$/, '');
    let m = line.match(/^\s*from\s+(\.*[A-Za-z_][\w.]*|\.+)\s+import\b/);
    if (m) { out.add(m[1]); continue; }
    m = line.match(/^\s*import\s+([A-Za-z_][\w.]*(?:\s+as\s+\w+)?(?:\s*,\s*[A-Za-z_][\w.]*(?:\s+as\s+\w+)?)*)\s*$/);
    if (m) for (const part of m[1].split(',')) out.add(part.trim().split(/\s+/)[0]);
  }
  return out;
}

function importsOf(rel, src) {
  const lang = langOf(rel);
  if (lang === 'js') return jsImports(src);
  if (lang === 'py') return pyImports(src);
  return new Set();
}

function packageName(spec) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function fileExists(p) { try { return fs.statSync(p).isFile(); } catch { return false; } }

function resolveRelative(fromAbs, spec) {
  const base = path.resolve(path.dirname(fromAbs), spec.split('?')[0]);
  const exts = ['', '.ts', '.tsx', '.js', '.jsx', '.cjs', '.mjs', '.mts', '.cts', '.json', '.d.ts'];
  const cands = [];
  for (const e of exts) cands.push(base + e);
  // TS/ESM style: './x.js' written for a source file x.ts
  const m = base.match(/^(.*)\.(?:js|jsx|mjs|cjs)$/);
  if (m) for (const e of ['.ts', '.tsx', '.mts', '.cts']) cands.push(m[1] + e);
  for (const e of exts.slice(1)) cands.push(path.join(base, `index${e}`));
  return cands.some(fileExists) || (() => { try { return fs.statSync(path.join(base, 'package.json')).isFile(); } catch { return false; } })();
}

function declaredDeps(root) {
  const names = new Set();
  let dir = root;
  for (let i = 0; i < 6; i++) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      if (pkg.name) names.add(pkg.name);
      for (const k of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const n of Object.keys(pkg[k] || {})) names.add(n);
      }
      for (const n of Object.keys(pkg.imports || {})) names.add(n);
    } catch { /* none here */ }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return names;
}

function installed(fromAbs, root, name) {
  let dir = path.dirname(fromAbs);
  for (let i = 0; i < 30; i++) {
    if (fileExists(path.join(dir, 'node_modules', name, 'package.json'))) return true;
    if (dir === path.parse(dir).root) break;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return false;
}

function tsPaths(root) {
  for (const f of ['tsconfig.json', 'jsconfig.json']) {
    try {
      const txt = fs.readFileSync(path.join(root, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"])\/\/.*$/gm, '$1').replace(/,\s*([}\]])/g, '$1');
      const j = JSON.parse(txt);
      const p = (j.compilerOptions && j.compilerOptions.paths) || {};
      return Object.keys(p).map((k) => k.replace(/\*$/, ''));
    } catch { /* none */ }
  }
  return [];
}

/**
 * Which of `specs` (imported by the JS/TS file `rel`) do not resolve.
 * Returns [{ spec, why }].
 */
function unresolvedJs(root, rel, specs) {
  const abs = path.join(root, rel);
  const deps = declaredDeps(root);
  const aliases = tsPaths(root);
  const out = [];
  for (const spec of specs) {
    if (!spec || BUILTIN.has(spec) || BUILTIN.has(spec.split('/')[0]) || /^(?:node|bun|deno|https?|data|virtual|#|~|\$)/.test(spec)) continue;
    if (/^(?:\.{1,2})(?:\/|$)/.test(spec)) {
      if (!resolveRelative(abs, spec)) out.push({ spec, why: 'no such file' });
      continue;
    }
    if (spec.startsWith('/')) continue;
    if (aliases.some((a) => a && spec.startsWith(a))) continue;
    if (/\.(?:css|scss|sass|less|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|html|md|txt|vue|svelte|wasm)$/i.test(spec)) continue;
    const name = packageName(spec);
    if (deps.has(name) || installed(abs, root, name)) continue;
    out.push({ spec, why: `package "${name}" is not a dependency of this project and is not installed` });
  }
  return out;
}

const PY_PROBE = [
  'import sys, json, importlib.util, os',
  'root, here, names = sys.argv[1], sys.argv[2], json.loads(sys.argv[3])',
  'for p in (here, root, os.path.join(root, "src")):',
  '    sys.path.insert(0, p)',
  'bad = []',
  'for n in names:',
  '    top = n.split(".")[0]',
  '    if top in getattr(sys, "stdlib_module_names", ()) or top in sys.builtin_module_names: continue',
  '    try:',
  '        if importlib.util.find_spec(top) is None: bad.append(n)',
  '    except Exception:',
  '        bad.append(n)',
  'print(json.dumps(bad))',
].join('\n');

function pythonBin() {
  for (const b of process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python']) {
    const r = spawnSync(b, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    if (r.status === 0) return b;
  }
  return null;
}

function unresolvedPy(root, rel, specs) {
  const names = Array.from(specs).filter((s) => !s.startsWith('.'));
  if (!names.length) return [];
  const py = pythonBin();
  if (!py) return [];
  const abs = path.join(root, rel);
  const r = spawnSync(py, ['-c', PY_PROBE, root, path.dirname(abs), JSON.stringify(names)], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 15000 });
  if (r.status !== 0) return [];
  try {
    return JSON.parse(r.stdout.trim().split('\n').pop()).map((spec) => ({ spec, why: `module "${spec.split('.')[0]}" is not installed and is not in the project` }));
  } catch { return []; }
}

/**
 * New imports in `after` that were not in `before` and do not resolve.
 * `before` is the previous source text, or the list of its import specifiers.
 * @returns {{ spec: string, why: string }[]}
 */
function newUnresolved(root, rel, before, after) {
  const lang = langOf(rel);
  if (!lang) return [];
  const old = Array.isArray(before) || before instanceof Set ? new Set(before) : importsOf(rel, before);
  const added = Array.from(importsOf(rel, after)).filter((s) => !old.has(s));
  if (!added.length) return [];
  return lang === 'js' ? unresolvedJs(root, rel, added) : unresolvedPy(root, rel, added);
}

/** Every import of the file that does not resolve right now (used at Stop). */
function stillUnresolved(root, rel, specs) {
  const lang = langOf(rel);
  if (!lang || !specs.length) return [];
  return lang === 'js' ? unresolvedJs(root, rel, specs) : unresolvedPy(root, rel, specs);
}

module.exports = { jsImports, pyImports, importsOf, packageName, newUnresolved, stillUnresolved, langOf };
