'use strict';
/**
 * Native verification: detect the project's test command, run it, check the
 * syntax of changed files, and summarise failures compactly.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function readPkg(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); } catch { return null; }
}

function has(root, name) { return fs.existsSync(path.join(root, name)); }

function onPath(bin) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8', windowsHide: true });
  return r.status === 0;
}

/** Returns { command, source } or null. */
function detectTestCommand(root, cfg) {
  if (cfg && cfg.testCommand) return { command: cfg.testCommand, source: 'config' };
  const pkg = readPkg(root);
  if (pkg && pkg.scripts && pkg.scripts.test && !/no test specified/i.test(pkg.scripts.test)) {
    const pm = has(root, 'pnpm-lock.yaml') ? 'pnpm' : has(root, 'yarn.lock') ? 'yarn' : has(root, 'bun.lockb') ? 'bun' : 'npm';
    return { command: `${pm} test`, source: 'package.json' };
  }
  if (has(root, 'pytest.ini') || has(root, 'pyproject.toml') || has(root, 'setup.cfg') || has(root, 'tox.ini')) {
    const py = onPath('python3') ? 'python3' : 'python';
    return { command: `${py} -m pytest -q`, source: 'python' };
  }
  if (has(root, 'go.mod')) return { command: 'go test ./...', source: 'go.mod' };
  if (has(root, 'Cargo.toml')) return { command: 'cargo test', source: 'Cargo.toml' };
  return null;
}

const FAIL_LINE = /(?:✗|✕|×|✖|\bFAIL(?:ED)?\b|\bfailing\b|\bnot ok\b|\bError\b|AssertionError|Expected|Received|expected .* to|Traceback|panic:|--- FAIL)/;

function tail(text, n) {
  const lines = String(text || '').split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - n)).join('\n');
}

/** Compact failure excerpt: the lines that say what broke, then the tail. */
function summarize(output, maxChars = 2500) {
  const lines = String(output || '').split(/\r?\n/);
  const hits = [];
  for (let i = 0; i < lines.length && hits.length < 40; i++) {
    if (FAIL_LINE.test(lines[i])) hits.push(lines[i].trimEnd());
  }
  const uniq = Array.from(new Set(hits));
  let text = uniq.length ? `${uniq.join('\n')}\n...\n${tail(output, 15)}` : tail(output, 30);
  if (text.length > maxChars) text = `${text.slice(0, maxChars)}\n[truncated]`;
  return text;
}

/** A stable fingerprint of what failed, used to detect "same failure again". */
function failSignature(output) {
  const lines = String(output || '').split(/\r?\n/)
    .filter((l) => FAIL_LINE.test(l))
    .map((l) => l.replace(/\d+(?:\.\d+)?\s*m?s\b/g, '').replace(/:\d+:\d+/g, '').replace(/0x[0-9a-f]+/gi, '').trim())
    .filter(Boolean);
  return Array.from(new Set(lines)).sort().join('\n');
}

function runTests(root, command, timeoutSec) {
  const started = Date.now();
  const r = spawnSync(command, {
    cwd: root,
    shell: true,
    encoding: 'utf8',
    timeout: Math.max(5, timeoutSec || 300) * 1000,
    maxBuffer: 64 * 1024 * 1024,
    env: Object.assign({}, process.env, { CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' }),
    windowsHide: true,
  });
  const output = `${r.stdout || ''}\n${r.stderr || ''}`;
  const timedOut = !!(r.error && /ETIMEDOUT/.test(String(r.error.code || r.error.message)));
  const zeroTests = r.status === 0 && /\b(?:0 (?:tests|passing)|no tests? (?:found|ran)|ran 0 tests|collected 0 items)\b/i.test(output);
  return {
    command,
    exitCode: r.status,
    signal: r.signal || null,
    timedOut,
    zeroTests,
    passed: r.status === 0 && !timedOut && !zeroTests,
    ms: Date.now() - started,
    output,
  };
}

/** Syntax-check one changed file. Returns an error string or null. */
function syntaxCheck(root, rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return null;
  const ext = path.extname(rel).toLowerCase();
  if (ext === '.json') {
    try { JSON.parse(fs.readFileSync(abs, 'utf8')); return null; } catch (e) { return `invalid JSON: ${e.message}`; }
  }
  if (['.js', '.cjs', '.mjs'].includes(ext)) {
    const r = spawnSync(process.execPath, ['--check', abs], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    if (r.status === 0) return null;
    const msg = String(r.stderr || '');
    if (!/SyntaxError/.test(msg)) return null;
    if (ext === '.js' && /Cannot use import statement|Unexpected token 'export'/.test(msg)) return null;
    return msg.split(/\r?\n/).filter((l) => l.trim()).slice(0, 6).join('\n').replace(abs, rel);
  }
  if (ext === '.py') {
    const py = onPath('python3') ? 'python3' : onPath('python') ? 'python' : null;
    if (!py) return null;
    const r = spawnSync(py, ['-m', 'py_compile', abs], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    if (r.status === 0) return null;
    return String(r.stderr || '').trim().split(/\r?\n/).slice(-4).join('\n').replace(abs, rel);
  }
  return null;
}

module.exports = { detectTestCommand, runTests, summarize, failSignature, syntaxCheck };
