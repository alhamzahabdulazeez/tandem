'use strict';
/**
 * packages/tandem-check/lib/check.cjs
 *
 * Core inspection logic for `tandem-check`.
 * Model-free, zero-config analyzer for uncommitted git changes:
 * - What changed: files, lines added and removed
 * - Blast radius: dependent importers via regex depgraph
 * - Uncovered changes: changed exported symbols not referenced in test files
 * - Test weakening: removed assertions, added .skip/.only/xit, passWithNoTests, deleted test files, snapshots
 * - Honest exit codes: 0 (clean), 1 (finding), 2 (not a git repo), 3 (clean but unverified)
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const depgraph = require('./depgraph.cjs');

const TEST_FILE_RE = /(?:^|\/)(?:test|tests|__tests__|spec|specs)\/|\.(?:test|spec)\.(?:js|jsx|ts|tsx|mjs|cjs|mts|cts)$|(?:^|\/)(?:test|tests|spec|specs)\.(?:js|jsx|ts|tsx|mjs|cjs|mts|cts)$|test-[^/]+\.(?:js|jsx|ts|tsx|mjs|cjs|mts|cts)$|[^/]+-test\.(?:js|jsx|ts|tsx|mjs|cjs|mts|cts)$/i;
const SNAPSHOT_RE = /\.(?:snap|snapshot)$|\/__snapshots__\//i;

/**
 * Check if a directory is inside a git work tree.
 */
function isGitRepository(cwd) {
  try {
    const res = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return res.status === 0 && res.stdout.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Get all changed, staged, unstaged, and untracked files with line stats.
 */
function getChanges(cwd) {
  const changes = [];
  const changedFileSet = new Set();

  // Check if HEAD exists
  let hasHead = true;
  try {
    const headCheck = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    hasHead = headCheck.status === 0;
  } catch {
    hasHead = false;
  }

  // 1. Get tracked changes (staged and unstaged)
  const diffArgs = hasHead ? ['diff', 'HEAD', '--numstat'] : ['diff', '--cached', '--numstat'];
  let diffOut = '';
  try {
    const res = spawnSync('git', diffArgs, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (res.status === 0) diffOut = res.stdout;
  } catch {}

  // If there's unstaged diff when hasHead is false, also check `git diff --numstat`
  if (!hasHead) {
    try {
      const resUnstaged = spawnSync('git', ['diff', '--numstat'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      if (resUnstaged.status === 0) diffOut += '\n' + resUnstaged.stdout;
    } catch {}
  }

  for (const line of diffOut.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 3) {
      const added = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
      const removed = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
      const file = parts.slice(2).join(' ').split('\\').join('/');
      if (!changedFileSet.has(file)) {
        changedFileSet.add(file);
        changes.push({ file, added, removed, status: 'modified' });
      }
    }
  }

  // 2. Name status to detect deleted or added files
  const nameStatusArgs = hasHead ? ['diff', 'HEAD', '--name-status'] : ['diff', '--cached', '--name-status'];
  try {
    const resStatus = spawnSync('git', nameStatusArgs, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (resStatus.status === 0) {
      for (const line of resStatus.stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const [code, ...fileParts] = trimmed.split(/\s+/);
        const file = fileParts.join(' ').split('\\').join('/');
        const existing = changes.find((c) => c.file === file);
        if (code && code.startsWith('D')) {
          if (existing) existing.status = 'deleted';
          else {
            changedFileSet.add(file);
            changes.push({ file, added: 0, removed: 0, status: 'deleted' });
          }
        } else if (code && code.startsWith('A')) {
          if (existing) existing.status = 'added';
        }
      }
    }
  } catch {}

  // 3. Untracked files via git status --porcelain -uall
  try {
    const resPorcelain = spawnSync('git', ['status', '--porcelain', '-uall'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (resPorcelain.status === 0) {
      for (const line of resPorcelain.stdout.split('\n')) {
        if (line.startsWith('?? ')) {
          let file = line.slice(3).trim();
          if (file.startsWith('"') && file.endsWith('"')) {
            file = file.slice(1, -1);
          }
          file = file.split('\\').join('/');
          if (!changedFileSet.has(file)) {
            changedFileSet.add(file);
            let added = 0;
            const fullPath = path.join(cwd, file);
            try {
              const stat = fs.statSync(fullPath);
              if (stat.isFile()) {
                const content = fs.readFileSync(fullPath, 'utf8');
                added = content ? content.split('\n').length : 0;
              }
            } catch {}
            changes.push({ file, added, removed: 0, status: 'untracked' });
          }
        }
      }
    }
  } catch {}

  return changes.sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Retrieve unified diff text against HEAD or index.
 */
function getDiffText(cwd) {
  let hasHead = true;
  try {
    const headCheck = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    hasHead = headCheck.status === 0;
  } catch {
    hasHead = false;
  }

  const diffArgs = hasHead ? ['diff', 'HEAD'] : ['diff', '--cached'];
  try {
    const res = spawnSync('git', diffArgs, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    let out = res.stdout || '';
    if (!hasHead) {
      const resUnstaged = spawnSync('git', ['diff'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      out += '\n' + (resUnstaged.stdout || '');
    }
    return out;
  } catch {
    return '';
  }
}

/**
 * Compute blast radius using dependency graph.
 */
function computeBlastRadius(cwd, changes, graph) {
  const blastRadius = {};
  for (const c of changes) {
    if (c.status === 'deleted') continue;
    const deps = depgraph.dependentsOf(graph, c.file);
    blastRadius[c.file] = deps;
  }
  return blastRadius;
}

function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '');
}

/**
 * Extract exported symbol identifiers from file content.
 */
function extractExportedSymbols(text) {
  const clean = stripComments(text);
  const symbols = new Set();

  // export function name(...) / export async function name(...)
  const fnRe = /export\s+(?:async\s+)?function\s+([a-zA-Z0-9_$]+)/g;
  let m;
  while ((m = fnRe.exec(clean)) !== null) symbols.add(m[1]);

  // export class Name
  const clsRe = /export\s+class\s+([a-zA-Z0-9_$]+)/g;
  while ((m = clsRe.exec(clean)) !== null) symbols.add(m[1]);

  // export const/let/var name = ...
  const varRe = /export\s+(?:const|let|var)\s+([a-zA-Z0-9_$]+)/g;
  while ((m = varRe.exec(clean)) !== null) symbols.add(m[1]);

  // export { a, b as c }
  const blockRe = /export\s*\{\s*([^}]+)\s*\}/g;
  while ((m = blockRe.exec(clean)) !== null) {
    const list = m[1].split(',');
    for (const item of list) {
      const trimmed = item.trim();
      if (!trimmed) continue;
      if (trimmed.includes(' as ')) {
        const parts = trimmed.split(/\s+as\s+/);
        if (parts[1]) symbols.add(parts[1].trim());
      } else {
        symbols.add(trimmed);
      }
    }
  }

  // CommonJS: module.exports.name = ... or exports.name = ...
  const cjsNamedRe = /(?:module\.)?exports\.([a-zA-Z0-9_$]+)\s*=/g;
  while ((m = cjsNamedRe.exec(clean)) !== null) {
    if (m[1] !== '__esModule') symbols.add(m[1]);
  }

  // CommonJS: module.exports = { a, b: ... }
  const cjsObjRe = /module\.exports\s*=\s*\{\s*([^}]+)\s*\}/g;
  while ((m = cjsObjRe.exec(clean)) !== null) {
    const list = m[1].split(',');
    for (const item of list) {
      const trimmed = item.trim();
      if (!trimmed) continue;
      const key = trimmed.split(':')[0].trim();
      if (/^[a-zA-Z0-9_$]+$/.test(key)) {
        symbols.add(key);
      }
    }
  }

  return [...symbols];
}

/**
 * Check for uncovered changes: changed exported symbols not referenced in test files.
 */
function findUncoveredChanges(cwd, changes, graph) {
  const uncovered = [];
  const testFiles = graph.files.filter((f) => TEST_FILE_RE.test(f));

  // If no test files exist in the repository, any source change with exports is uncovered
  const testFileContents = new Map();
  for (const tf of testFiles) {
    try {
      testFileContents.set(tf, fs.readFileSync(path.join(cwd, tf), 'utf8'));
    } catch {}
  }

  for (const c of changes) {
    if (c.status === 'deleted') continue;
    if (TEST_FILE_RE.test(c.file)) continue; // skip test files

    const fullPath = path.join(cwd, c.file);
    let text = '';
    try {
      text = fs.readFileSync(fullPath, 'utf8');
    } catch {
      continue;
    }

    const exported = extractExportedSymbols(text);
    if (exported.length === 0) continue;

    for (const sym of exported) {
      // Check if any test file references this exported symbol
      const symRe = new RegExp(`\\b${sym}\\b`);
      let referenced = false;
      for (const [tf, content] of testFileContents) {
        if (symRe.test(content)) {
          referenced = true;
          break;
        }
      }

      if (!referenced) {
        uncovered.push({
          file: c.file,
          symbol: sym,
          message: `${c.file}: exported symbol '${sym}' is not referenced by any test file`,
        });
      }
    }
  }

  return uncovered;
}

/**
 * Parse diff text per-file for detailed inspection.
 */
function parseDiffByFile(diffText) {
  const fileDiffs = new Map();
  const fileHeaderRe = /^diff --git a\/(.+?) b\/(.+?)$/m;
  const sections = diffText.split(/^diff --git /m);

  for (const sec of sections) {
    if (!sec.trim()) continue;
    const lines = sec.split('\n');
    const first = lines[0];
    const match = first.match(/^a\/(.+?) b\/(.+?)$/);
    if (!match) continue;
    const filePath = match[2];
    fileDiffs.set(filePath, lines.slice(1));
  }

  return fileDiffs;
}

/**
 * Detect test weakening in changed files.
 */
function findTestWeakening(cwd, changes, diffText) {
  const weakening = [];
  const fileDiffs = parseDiffByFile(diffText);
  const sourceChanges = changes.filter((c) => !TEST_FILE_RE.test(c.file) && !SNAPSHOT_RE.test(c.file));
  const snapshotChanges = changes.filter((c) => SNAPSHOT_RE.test(c.file));

  // 1. Deleted test files
  for (const c of changes) {
    if (c.status === 'deleted' && TEST_FILE_RE.test(c.file)) {
      weakening.push({
        file: c.file,
        type: 'deleted_test_file',
        message: `${c.file}: test file was deleted`,
      });
    }
  }

  // 2. Snapshot changes alongside source changes without new test assertions
  if (snapshotChanges.length > 0 && sourceChanges.length > 0) {
    for (const s of snapshotChanges) {
      weakening.push({
        file: s.file,
        type: 'snapshot_alongside_source',
        message: `${s.file}: snapshot modified alongside source changes`,
      });
    }
  }

  // 3. Inspect diffs of test files for skip/only/removed assertions
  for (const [file, lines] of fileDiffs.entries()) {
    const isTestFile = TEST_FILE_RE.test(file);
    const addedLines = lines.filter((l) => l.startsWith('+') && !l.startsWith('+++'));
    const removedLines = lines.filter((l) => l.startsWith('-') && !l.startsWith('---'));

    // Check passWithNoTests in package.json or configs
    for (const al of addedLines) {
      if (/passWithNoTests/i.test(al)) {
        weakening.push({
          file,
          type: 'pass_with_no_tests',
          message: `${file}: added passWithNoTests configuration`,
        });
      }
    }

    if (!isTestFile) continue;

    // Added skips
    for (const al of addedLines) {
      if (/\b(?:it|test|describe|context)\.skip\b/.test(al) || /\b(?:xit|xdescribe|xtest)\b/.test(al)) {
        weakening.push({
          file,
          type: 'added_skip',
          message: `${file}: added test skip (.skip or xit)`,
        });
        break;
      }
    }

    // Added only
    for (const al of addedLines) {
      if (/\b(?:it|test|describe|context)\.only\b/.test(al) || /\b(?:fit|fdescribe)\b/.test(al)) {
        weakening.push({
          file,
          type: 'added_only',
          message: `${file}: added exclusive test focus (.only or fit)`,
        });
        break;
      }
    }

    // Removed assertions vs added assertions
    const assertionPattern = /\b(?:assert|expect|t\.ok|t\.equal|t\.strictEqual|t\.is|t\.same|should)\b|\.(?:toBe|toEqual|toThrow|toMatch|toStrictEqual)\b/;
    const removedAssertions = removedLines.filter((l) => assertionPattern.test(l)).length;
    const addedAssertions = addedLines.filter((l) => assertionPattern.test(l)).length;

    if (removedAssertions > addedAssertions) {
      const netRemoved = removedAssertions - addedAssertions;
      weakening.push({
        file,
        type: 'removed_assertions',
        message: `${file}: removed ${netRemoved} assertion(s) without replacement`,
      });
    }
  }

  return weakening;
}

/**
 * Run test verification if requested.
 */
function runVerify(cwd) {
  const pkgPath = path.join(cwd, 'package.json');
  let hasTestScript = false;

  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.scripts && pkg.scripts.test && !pkg.scripts.test.includes('no test specified')) {
        hasTestScript = true;
      }
    } catch {}
  }

  if (hasTestScript) {
    try {
      const res = spawnSync('npm', ['test'], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 120000,
      });
      if (res.status === 0) {
        return { verified: true, passed: true };
      }
      return {
        verified: true,
        passed: false,
        error: 'test suite failed',
        output: (res.stderr || res.stdout || '').trim(),
      };
    } catch (e) {
      return { verified: true, passed: false, error: e.message };
    }
  }

  // Check fallback test runners
  if (fs.existsSync(path.join(cwd, 'test', 'all.cjs'))) {
    try {
      const res = spawnSync(process.execPath, ['test/all.cjs'], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 120000,
      });
      return { verified: true, passed: res.status === 0, output: res.stderr || res.stdout };
    } catch (e) {
      return { verified: true, passed: false, error: e.message };
    }
  }

  return { verified: false, reason: 'no test runner detected' };
}

/**
 * Main check routine.
 * @param {string} cwd Directory to check
 * @param {object} [options]
 * @param {boolean} [options.verify] Whether to run verification
 * @returns {object} Analysis result object
 */
function check(cwd, options = {}) {
  const targetDir = path.resolve(cwd || process.cwd());

  if (!isGitRepository(targetDir)) {
    return {
      isGitRepo: false,
      exitCode: 2,
      verdict: 'Cannot determine: not a git repository.',
      changes: [],
      blastRadius: {},
      uncovered: [],
      testWeakening: [],
      findings: ['not a git repository'],
    };
  }

  const changes = getChanges(targetDir);
  const diffText = getDiffText(targetDir);
  const graph = depgraph.build(targetDir);
  const blastRadius = computeBlastRadius(targetDir, changes, graph);
  const uncovered = findUncoveredChanges(targetDir, changes, graph);
  const testWeakening = findTestWeakening(targetDir, changes, diffText);

  const findings = [];
  for (const u of uncovered) findings.push(u.message);
  for (const w of testWeakening) findings.push(w.message);

  let verificationResult = null;
  if (options.verify) {
    verificationResult = runVerify(targetDir);
    if (verificationResult.verified && !verificationResult.passed) {
      findings.push('test verification failed');
    }
  }

  let exitCode = 0;
  let verdict = '';

  if (findings.length > 0) {
    exitCode = 1;
    const parts = [];
    if (testWeakening.length > 0) parts.push(`${testWeakening.length} test weakening`);
    if (uncovered.length > 0) parts.push(`${uncovered.length} uncovered export${uncovered.length === 1 ? '' : 's'}`);
    if (verificationResult && !verificationResult.passed) parts.push('test failure');
    verdict = `Finding: ${findings.length} issue(s) detected (${parts.join(', ')}).`;
  } else if (changes.length === 0) {
    exitCode = 0;
    verdict = 'Clean: no uncommitted changes.';
  } else {
    // Changes exist and no static findings
    if (options.verify) {
      if (verificationResult && verificationResult.passed) {
        exitCode = 0;
        verdict = `Clean: ${changes.length} file(s) changed, 0 findings, verified with tests.`;
      } else {
        exitCode = 3;
        verdict = `Clean (unverified): ${changes.length} file(s) changed, 0 findings (${(verificationResult && verificationResult.reason) || 'unverified'}).`;
      }
    } else {
      exitCode = 3;
      verdict = `Clean (unverified): ${changes.length} file(s) changed, 0 findings. Run with --verify to run tests.`;
    }
  }

  return {
    isGitRepo: true,
    exitCode,
    verdict,
    changes,
    blastRadius,
    uncovered,
    testWeakening,
    findings,
    verification: verificationResult,
  };
}

/**
 * Format report as plain text (no ANSI colors, no absolute paths).
 */
function formatReport(result) {
  if (!result.isGitRepo) {
    return `${result.verdict}\n`;
  }

  const lines = [];
  lines.push('tandem-check\n');

  // 1. What changed
  lines.push('What changed:');
  if (result.changes.length === 0) {
    lines.push('  none');
  } else {
    let totAdded = 0;
    let totRemoved = 0;
    for (const c of result.changes) {
      totAdded += c.added;
      totRemoved += c.removed;
      lines.push(`  ${c.file} (+${c.added}, -${c.removed})`);
    }
    lines.push(`  Total: ${result.changes.length} file(s) changed (+${totAdded}, -${totRemoved} lines)`);
  }
  lines.push('');

  // 2. Blast radius
  lines.push('Blast radius:');
  const blastEntries = Object.entries(result.blastRadius);
  if (blastEntries.length === 0) {
    lines.push('  none');
  } else {
    for (const [file, deps] of blastEntries) {
      if (deps.length > 0) {
        lines.push(`  ${file} (${deps.length} dependent${deps.length === 1 ? '' : 's'}):`);
        for (const d of deps) {
          lines.push(`    ${d}`);
        }
      } else {
        lines.push(`  ${file} (0 dependents)`);
      }
    }
  }
  lines.push('');

  // 3. Uncovered changes
  lines.push('Uncovered changes:');
  if (result.uncovered.length === 0) {
    lines.push('  none');
  } else {
    for (const u of result.uncovered) {
      lines.push(`  ${u.message}`);
    }
  }
  lines.push('');

  // 4. Test weakening
  lines.push('Test weakening:');
  if (result.testWeakening.length === 0) {
    lines.push('  none');
  } else {
    for (const w of result.testWeakening) {
      lines.push(`  ${w.message}`);
    }
  }
  lines.push('');

  // 5. Verdict
  lines.push(`Verdict: ${result.verdict}`);

  return lines.join('\n');
}

module.exports = {
  check,
  formatReport,
  isGitRepository,
  getChanges,
  getDiffText,
  computeBlastRadius,
  findUncoveredChanges,
  findTestWeakening,
  runVerify,
};
