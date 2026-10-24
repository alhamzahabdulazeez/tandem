'use strict';
/**
 * Compact the output of test, build and lint commands before it reaches the
 * model. A passing run becomes its summary lines; a failing run becomes the
 * failing tests with their assertion details and the final summary. Stack
 * frames from dependencies and runtime internals are dropped.
 *
 * Pure: text in, text out. The caller saves the full output to a log file and
 * tells the model where it is, so nothing is lost, only kept out of context.
 */

const MIN_LINES = 40;          // shorter output is returned unchanged
const MIN_CHARS = 3000;
const MAX_FAIL_LINES = 120;
const MAX_FAIL_CHARS = 6000;
const AFTER = 8;               // context lines kept after each failure marker
const BEFORE = 1;

const FAIL_MARK = /(?:✗|✕|×|✖|\bFAIL(?:ED|URE)?\b|\bfailing\b|^\s*not ok\b|AssertionError|AssertError|\bError:|\berror(?:\[\w+\])?:|\berror TS\d+|Traceback \(most recent call last\)|^E\s{2,}|panic:|--- FAIL|^\s*\d+\)\s|Expected|Received|expected .+ to |\bassert(?:ion)? failed|SyntaxError|TypeError|ReferenceError|Cannot find module|ModuleNotFoundError|ImportError)/i;
const SUMMARY = /(?:\b\d+\s+(?:passing|passed|failing|failed|pending|skipped|tests?|suites?|errors?|warnings?)\b|^\s*(?:Tests?|Test Suites|Snapshots|Time|Duration|Ran)\b|^#\s*(?:tests|pass|fail|skip|todo|suites|duration_ms)\b|^(?:ok|FAIL|PASS)\s|^=+ .* in [\d.]+s|\bFinished\b|\bCompiled\b|^Found \d+ error|\bBuild (?:succeeded|failed)\b|test result:)/i;
const NOISE = /^\s*at\s.*(?:node_modules|node:internal|internal\/|<anonymous>)|^\s*at\s(?:process\.processTicksAndRejections|Module\._compile|Object\.<anonymous> \(node:)|^\s*File ".*site-packages|^\s*$/;
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

function lines(text) {
  return String(text || '').replace(ANSI, '').replace(/\r/g, '').split('\n');
}

function capChars(text, max) {
  return text.length > max ? `${text.slice(0, max)}\n[... cut at ${max} chars]` : text;
}

function summaryLines(all, max) {
  const hits = [];
  for (let i = all.length - 1; i >= 0 && hits.length < max; i--) {
    if (SUMMARY.test(all[i]) && !NOISE.test(all[i])) hits.unshift(all[i].trimEnd());
  }
  return Array.from(new Set(hits));
}

// A line that by itself names a failure: a failing test, its message, a compiler error.
const IDENTITY = /^\s*(?:FAIL\b|×|✗|✕|✖|not ok\b|→ |--- FAIL|E\s{2,}\S)|AssertionError|\berror TS\d+|^\s*(?:\w*Error|panic):|^[^\s].*:\d+:\d+: error|FAILED |expected .+ to |^\s*[-+] (?:Expected|Received)/;

/**
 * Two tiers so the cap never hides which tests failed:
 *   1. every line that identifies a failure (deduplicated), always kept;
 *   2. context around failures (assertion diffs, code frames), first come first
 *      served, within what is left of the budget.
 */
function failureExcerpt(all) {
  const ids = [];
  const seen = new Set();
  for (let i = 0; i < all.length; i++) {
    const l = all[i].trimEnd();
    if (!IDENTITY.test(l) || NOISE.test(l)) continue;
    const k = l.trim();
    if (seen.has(k)) continue;
    seen.add(k);
    ids.push(i);
  }
  const keep = new Set(ids);
  let budget = MAX_FAIL_CHARS - ids.reduce((a, i) => a + all[i].length + 1, 0);
  for (let i = 0; i < all.length && budget > 0; i++) {
    if (!FAIL_MARK.test(all[i])) continue;
    for (let j = Math.max(0, i - BEFORE); j <= Math.min(all.length - 1, i + AFTER) && budget > 0; j++) {
      if (keep.has(j) || NOISE.test(all[j]) || seen.has(all[j].trim())) continue;
      keep.add(j);
      budget -= all[j].length + 1;
    }
  }
  const picked = [];
  let last = -2;
  for (const i of Array.from(keep).sort((a, b) => a - b)) {
    if (i > last + 1 && picked.length) picked.push('  ...');
    picked.push(all[i].trimEnd());
    last = i;
  }
  if (!picked.length) return all.filter((l) => !NOISE.test(l)).slice(-40).join('\n');
  const sum = summaryLines(all, 8).filter((l) => !picked.includes(l));
  return [...picked, ...(sum.length ? ['  ...', ...sum] : [])].join('\n');
}

/** Jest / Vitest --reporter=json: list the failing tests and their first message lines. */
function fromJsonReport(raw) {
  if (!/"testResults"\s*:/.test(raw)) return null;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let rep;
  try { rep = JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
  if (!rep || !Array.isArray(rep.testResults)) return null;
  const out = [];
  for (const f of rep.testResults) {
    const fails = (f.assertionResults || []).filter((a) => a.status === 'failed');
    if (!fails.length && f.status !== 'failed') continue;
    out.push(`FAIL ${f.name || ''}`);
    if (!fails.length && f.message) out.push(`  ${String(f.message).split('\n').slice(0, 4).join('\n  ')}`);
    for (const a of fails) {
      out.push(`  × ${a.fullName || a.title}`);
      const msg = (a.failureMessages || []).join('\n').replace(ANSI, '').split('\n').filter((l) => l.trim() && !NOISE.test(l)).slice(0, 6);
      for (const m of msg) out.push(`    ${m.trim()}`);
    }
  }
  out.push(`Tests: ${rep.numFailedTests} failed, ${rep.numPassedTests} passed, ${rep.numTotalTests} total`);
  return out.join('\n');
}

/**
 * @param {string} output  combined stdout+stderr
 * @param {number|null} exitCode
 * @returns {{ text: string, compacted: boolean, before: number, after: number }}
 */
function compact(output, exitCode) {
  const raw = String(output || '');
  const all = lines(raw);
  const before = raw.length;
  if (all.length < MIN_LINES && raw.length < MIN_CHARS) {
    return { text: raw, compacted: false, before, after: before };
  }

  let body;
  if (exitCode === 0) {
    const sum = summaryLines(all, 12);
    const tail = all.filter((l) => l.trim()).slice(-4);
    const warn = all.filter((l) => /\bwarn(?:ing)?\b/i.test(l) && !NOISE.test(l)).slice(0, 5);
    body = Array.from(new Set([...warn, ...sum, ...tail])).join('\n');
  } else {
    body = fromJsonReport(raw) || failureExcerpt(all);
  }
  if (body.length >= raw.length * 0.8) return { text: raw, compacted: false, before, after: before };
  return { text: body, compacted: true, before, after: body.length };
}

/** Commands whose output is worth compacting: tests, builds, linters, type checks. */
const COMPACTABLE = [
  /^(?:npm|pnpm|yarn|bun)\s+(?:test|t|run\s+(?:test|lint|build|typecheck|check|tsc)[\w:-]*)(?:\s|$)/,
  /^npx\s+(?:--no-install\s+)?(?:tsc|eslint|vitest|jest|mocha|biome|playwright\s+test)\b/,
  /^(?:jest|vitest|mocha|tsc|eslint)\b/,
  /^node\s+--test\b/,
  /^(?:python3?|py)\s+-m\s+(?:pytest|unittest|mypy|ruff|flake8)\b/,
  /^(?:pytest|mypy|ruff|flake8|tox)\b/,
  /^go\s+(?:test|vet|build)\b/,
  /^cargo\s+(?:test|check|build|clippy)\b/,
  /^(?:make|gradle|\.\/gradlew|mvn|dotnet)\s+(?:test|build|check)\b/,
];

/**
 * Return true when the whole command is one compactable invocation, optionally
 * after `cd <dir> &&`, with no pipe or redirect the agent chose itself.
 */
function isCompactable(cmd) {
  const c = String(cmd || '').trim();
  if (!c || /[|<>`]|\$\(|;|\|\||&\s*$/.test(c.replace(/\s2>&1\b/g, ''))) return false;
  const parts = c.split('&&').map((s) => s.trim());
  const main = parts.pop();
  if (!parts.every((p) => /^cd\s+\S+$/.test(p))) return false;
  return COMPACTABLE.some((re) => re.test(main.replace(/\s2>&1\b/, '')));
}

module.exports = { IDENTITY, compact, isCompactable, MIN_LINES, MIN_CHARS };
