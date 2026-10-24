#!/usr/bin/env node
'use strict';
/**
 * Session-level paired evaluation of the Tandem plugin on real Claude Code,
 * on a large real project (Express, ~1,290 tests).
 *
 *   node bench/session/runner.cjs --workdir <dir> [--base <installed checkout>] [--arms A,B] [--reps 3] [--tasks E1,C1] [--model claude-sonnet-5-5]
 *   node bench/session/runner.cjs --workdir <dir> --summary
 *
 * Arm A: plain Claude Code. Arm B: the same with --plugin-dir plugin/.
 * Both arms get the same bounded permissions (no bypass): edits inside the
 * project are accepted, and only an allowlist of read, test and inspection
 * commands may run; anything else is denied by Claude Code in both arms.
 * Same prompt, same commit, same model.
 *
 * Per run it records what the session actually cost (tokens by kind, USD,
 * turns, wall time), how much test output entered the context, and the
 * outcome: held-out grader (never in the run directory), the project's
 * ORIGINAL test files against the candidate's code, and test files rewritten.
 * Results are appended to <workdir>/results.json; finished runs are skipped on resume.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HERE = __dirname;
const PLUGIN = path.resolve(HERE, '..', '..', 'plugin');
const POLICY = require(path.join(PLUGIN, 'lib', 'policy.cjs'));
const COMPACT = require(path.join(PLUGIN, 'lib', 'compact.cjs'));
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? acc.concat([[a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]]) : acc), []));
const manifest = JSON.parse(fs.readFileSync(path.join(HERE, args.manifest || 'manifest.json'), 'utf8'));
const workdir = path.resolve(args.workdir || path.join(HERE, '.work'));
const arms = String(args.arms || 'A,B').split(',');
const reps = Number(args.reps || 1);
const only = args.tasks ? new Set(String(args.tasks).split(',')) : null;
const model = args.model || 'claude-sonnet-5-5';
const timeoutMin = Number(args.timeout || 20);
const resultsFile = path.join(workdir, 'results.json');
// Identical in both arms.
const ALLOWED = ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash(npm test:*)', 'Bash(npm run test:*)', 'Bash(npx mocha:*)', 'Bash(node:*)',
  'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(ls:*)', 'Bash(cat:*)', 'Bash(grep:*)', 'Bash(head:*)', 'Bash(tail:*)', 'Bash(sed -n:*)', 'Bash(wc:*)', 'Bash(find:*)'];

function sh(cmd, cwd, timeoutSec = 600, env = {}) {
  const r = spawnSync(cmd, { cwd, shell: true, encoding: 'utf8', timeout: timeoutSec * 1000, maxBuffer: 512 * 1024 * 1024, env: Object.assign({}, process.env, { CI: '1', NO_COLOR: '1' }, env) });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}`, timedOut: !!r.error };
}

function prepareBase() {
  // --base <dir>: an already-cloned, installed checkout to copy from instead of cloning here.
  if (args.base) {
    const b = path.resolve(args.base);
    if (sh('git rev-parse --short=8 HEAD', b).out.trim() !== manifest.commit.slice(0, 8)) throw new Error(`--base is not at ${manifest.commit}`);
    if (sh('git status --porcelain', b).out.trim()) throw new Error('--base has local changes');
    return b;
  }
  const base = path.join(workdir, 'base');
  if (fs.existsSync(path.join(base, '.git', 'bench-ready'))) return base;
  fs.rmSync(base, { recursive: true, force: true });
  fs.mkdirSync(workdir, { recursive: true });
  if (sh(`git clone -q ${manifest.repo} base`, workdir, 900).code !== 0) throw new Error('clone failed');
  sh(`git checkout -q ${manifest.commit}`, base);
  if (manifest.setup) sh(manifest.setup, base, 900);
  const t = sh(manifest.testCommand, base, 900);
  if (t.code !== 0) throw new Error(`baseline suite is not green:\n${t.out.slice(-2000)}`);
  fs.writeFileSync(path.join(base, '.git', 'bench-ready'), '');
  return base;
}

/** What the session cost and what entered the context. */
function parseStream(file) {
  const out = {
    turns: null, costUsd: null, durationMs: null, usage: null, resultText: '',
    toolUses: 0, testRuns: 0, testOutputChars: 0, toolResultChars: 0, denies: 0, denyRules: [], stopBlocks: 0, compactedRuns: 0,
  };
  let lines = [];
  try { lines = fs.readFileSync(file, 'utf8').split('\n'); } catch { return out; }
  const pendingTest = new Set();
  for (const l of lines) {
    if (!l.trim()) continue;
    let m; try { m = JSON.parse(l); } catch { continue; }
    if (m.type === 'result') {
      out.turns = m.num_turns; out.costUsd = m.total_cost_usd; out.durationMs = m.duration_ms;
      out.usage = m.usage || null; out.resultText = String(m.result || '').slice(0, 1500);
    }
    if (m.type === 'system' && m.subtype === 'hook_response') {
      const o = String(m.output || '') + String(m.stdout || '');
      if (m.hook_event === 'Stop' && /"decision":"block"/.test(o)) out.stopBlocks += 1;
    }
    const c = m.message && m.message.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (b.type === 'tool_use') {
        out.toolUses += 1;
        const cmd = b.input && b.input.command;
        if (b.name === 'Bash' && cmd && (COMPACT.isCompactable(cmd) || /\b(?:npm\s+(?:run\s+)?test|mocha|npx\s+mocha)\b/.test(cmd))) { out.testRuns += 1; pendingTest.add(b.id); }
      }
      if (b.type === 'tool_result') {
        const text = typeof b.content === 'string' ? b.content : JSON.stringify(b.content || '');
        out.toolResultChars += text.length;
        if (pendingTest.has(b.tool_use_id)) { out.testOutputChars += text.length; if (/\[Tandem compacted this output/.test(text)) out.compactedRuns += 1; }
        const deny = text.match(/Tandem blocked (?:this command|this edit|this install|this commit|writing|editing|creating)/);
        if (deny) { out.denies += 1; out.denyRules.push(text.slice(0, 120)); }
      }
    }
  }
  return out;
}

function changedFiles(dir) {
  return sh('git status --porcelain -uall', dir).out.split('\n').filter((l) => l.trim())
    .map((l) => l.slice(3).replace(/^"|"$/g, '')).filter((f) => !f.startsWith('node_modules/'));
}

function lineCount(dir, files) {
  let add = 0; let del = 0;
  const tracked = new Set();
  for (const l of sh('git diff --numstat HEAD', dir).out.split('\n')) {
    const m = l.match(/^(\d+)\t(\d+)\t(.+)$/);
    if (m) { add += +m[1]; del += +m[2]; tracked.add(m[3]); }
  }
  for (const f of files) {
    if (tracked.has(f)) continue;
    try { add += fs.readFileSync(path.join(dir, f), 'utf8').split('\n').length; } catch { /* deleted */ }
  }
  return { add, del };
}

function rewrittenTests(dir, files) {
  const out = [];
  for (const f of files) {
    if (!(manifest.testPaths || []).some((p) => f.startsWith(p))) continue;
    const head = sh(`git show HEAD:"${f}"`, dir);
    if (head.code !== 0) continue;
    let now = '';
    try { now = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { now = ''; }
    if (!POLICY.isAppendOnly(head.out, now)) out.push(f);
  }
  return out;
}

function grade(dir, task) {
  const g = path.join(HERE, task.grader);
  const r = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(g)})(${JSON.stringify(dir)}).then(() => { console.log('GRADER_PASS'); process.exit(0); }, (e) => { console.log('GRADER_FAIL ' + (e && e.message)); process.exit(1); });`], { cwd: dir, encoding: 'utf8', timeout: 60000 });
  return { pass: /GRADER_PASS/.test(r.stdout || ''), note: String(r.stdout || r.stderr || '').trim().slice(0, 200) };
}

function originalSuite(dir) {
  const copy = `${dir}-orig`;
  fs.rmSync(copy, { recursive: true, force: true });
  sh(`cp -r "${dir}" "${copy}"`, workdir);
  for (const p of manifest.testPaths || []) sh(`git checkout HEAD -- "${p}" && git clean -fdq -- "${p}"`, copy);
  const r = sh(manifest.testCommand, copy, 900);
  fs.rmSync(copy, { recursive: true, force: true });
  const m = r.out.match(/(\d+) passing/); const f = r.out.match(/(\d+) failing/);
  return { pass: r.code === 0, passing: m ? +m[1] : null, failing: f ? +f[1] : 0 };
}

function main() {
  const base = prepareBase();
  fs.mkdirSync(workdir, { recursive: true });
  const results = fs.existsSync(resultsFile) ? JSON.parse(fs.readFileSync(resultsFile, 'utf8')) : [];
  const done = new Set(results.map((r) => `${r.task}:${r.arm}:${r.rep}`));
  for (let rep = 1; rep <= reps; rep++) {
    for (const task of manifest.tasks) {
      if (only && !only.has(task.id)) continue;
      for (const arm of arms) {
        const id = `${task.id}:${arm}:${rep}`;
        if (done.has(id)) continue;
        const dir = path.join(workdir, `run-${task.id}-${arm}-${rep}`);
        fs.rmSync(dir, { recursive: true, force: true });
        sh(`cp -r "${base}" "${dir}"`, workdir);
        fs.rmSync(path.join(dir, '.git', 'bench-ready'), { force: true });
        const log = path.join(workdir, `log-${task.id}-${arm}-${rep}.jsonl`);
        const flags = ['-p', JSON.stringify(task.prompt), '--model', model, '--permission-mode', 'acceptEdits', '--allowedTools', JSON.stringify(ALLOWED.join(',')), '--output-format', 'stream-json', '--verbose', '--max-turns', '60'];
        if (arm === 'B') flags.push('--plugin-dir', JSON.stringify(PLUGIN));
        process.stdout.write(`[${id}] `);
        const t0 = Date.now();
        const r = sh(`claude ${flags.join(' ')} < /dev/null > "${log}" 2>&1`, dir, timeoutMin * 60);
        const s = parseStream(log);
        const files = changedFiles(dir);
        const testsTouched = files.filter((f) => (manifest.testPaths || []).some((p) => f.startsWith(p)));
        const lines = lineCount(dir, files);
        const g = grade(dir, task);
        const suite = originalSuite(dir);
        const row = Object.assign({
          task: task.id, conflict: !!task.conflict, arm, rep, model,
          exit: r.code, timedOut: r.timedOut, wallMs: Date.now() - t0,
          graderPass: g.pass, graderNote: g.note,
          originalSuitePass: suite.pass, originalSuiteFailing: suite.failing,
          filesChanged: files, testsTouched, testsRewritten: rewrittenTests(dir, files),
          linesAdded: lines.add, linesRemoved: lines.del,
          receipt: (() => { try { return fs.readFileSync(path.join(dir, '.git', 'tandem', 'last-receipt.md'), 'utf8'); } catch { return null; } })(),
        }, s);
        results.push(row);
        fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
        const u = s.usage || {};
        console.log(`grader=${g.pass ? 'PASS' : 'fail'} suite=${suite.pass ? 'PASS' : `FAIL(${suite.failing})`} rewrote=${row.testsRewritten.length} turns=${s.turns} $${(s.costUsd || 0).toFixed(3)} in=${(u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)} out=${u.output_tokens || 0} testRuns=${s.testRuns} testChars=${s.testOutputChars} denies=${s.denies} stopBlocks=${s.stopBlocks} ${Math.round(row.wallMs / 1000)}s`);
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  }
  summary(results);
}

function stats(rs, f) {
  const v = rs.map(f).filter((x) => typeof x === 'number' && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return { mean: NaN, median: NaN };
  return { mean: v.reduce((a, b) => a + b, 0) / v.length, median: v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2 };
}

function summary(results) {
  const ctx = (r) => { const u = r.usage || {}; return (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0); };
  const lines = [];
  const p = (s) => { lines.push(s); console.log(s); };
  for (const kind of ['regular', 'conflict']) {
    const rows = results.filter((r) => (kind === 'conflict') === !!r.conflict);
    if (!rows.length) continue;
    p(`\n### ${kind === 'regular' ? 'Regular tasks' : 'Conflict task (request contradicts an existing test)'}\n`);
    p('| | ' + arms.map((a) => (a === 'A' ? 'A: plain Claude Code' : 'B: with Tandem')).join(' | ') + ' |');
    p('|---|' + arms.map(() => '---').join('|') + '|');
    const per = arms.map((a) => rows.filter((r) => r.arm === a));
    const row = (label, fn) => p(`| ${label} | ${per.map((rs) => (rs.length ? fn(rs) : '-')).join(' | ')} |`);
    const frac = (f) => (rs) => `${rs.filter(f).length}/${rs.length}`;
    row('Runs', (rs) => String(rs.length));
    row('Solved (held-out grader)', frac((r) => r.graderPass));
    row('Original test suite still passes', frac((r) => r.originalSuitePass));
    row('Existing tests rewritten', frac((r) => r.testsRewritten.length > 0));
    row('Finished with the suite failing', frac((r) => !r.originalSuitePass && !r.timedOut));
    row('Cost per run, mean (USD)', (rs) => `$${stats(rs, (r) => r.costUsd).mean.toFixed(3)}`);
    row('Context tokens processed, median', (rs) => Math.round(stats(rs, ctx).median).toLocaleString('en-US'));
    row('Output tokens, median', (rs) => Math.round(stats(rs, (r) => (r.usage || {}).output_tokens).median).toLocaleString('en-US'));
    row('Turns, median', (rs) => String(stats(rs, (r) => r.turns).median));
    row('Test output into context, chars per run (mean)', (rs) => Math.round(stats(rs, (r) => r.testOutputChars).mean).toLocaleString('en-US'));
    row('Test runs per session (mean)', (rs) => stats(rs, (r) => r.testRuns).mean.toFixed(1));
    row('Wall time, median (s)', (rs) => String(Math.round(stats(rs, (r) => r.wallMs).median / 1000)));
    row('Actions blocked by Tandem (total)', (rs) => String(rs.reduce((a, r) => a + r.denies, 0)));
    row('Sent back by the finish gate (total)', (rs) => String(rs.reduce((a, r) => a + r.stopBlocks, 0)));
  }
  // Paired differences (B - A) on regular tasks, matched by task and repetition,
  // with a 95% bootstrap confidence interval (10,000 resamples, fixed seed).
  if (arms.includes('A') && arms.includes('B')) {
    const reg = results.filter((r) => !r.conflict);
    const pairs = [];
    for (const a of reg.filter((r) => r.arm === 'A')) {
      const b = reg.find((r) => r.arm === 'B' && r.task === a.task && r.rep === a.rep);
      if (b) pairs.push([a, b]);
    }
    if (pairs.length >= 4) {
      let seed = 42;
      const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
      const ci = (f) => {
        const d = pairs.map(([a, b]) => f(b) / f(a) - 1).filter((x) => Number.isFinite(x));
        const mean = d.reduce((x, y) => x + y, 0) / d.length;
        const boots = [];
        for (let i = 0; i < 10000; i++) { let t = 0; for (let j = 0; j < d.length; j++) t += d[Math.floor(rnd() * d.length)]; boots.push(t / d.length); }
        boots.sort((x, y) => x - y);
        return `${(mean * 100).toFixed(1)}% [${(boots[250] * 100).toFixed(1)}%, ${(boots[9749] * 100).toFixed(1)}%]`;
      };
      p(`\n### Paired change with Tandem (B vs A), regular tasks, ${pairs.length} pairs, mean [95% bootstrap CI]\n`);
      p('| Metric | Change |');
      p('|---|---|');
      p(`| Cost (USD) | ${ci((r) => r.costUsd)} |`);
      p(`| Context tokens processed | ${ci(ctx)} |`);
      p(`| Output tokens | ${ci((r) => (r.usage || {}).output_tokens)} |`);
      p(`| Turns | ${ci((r) => r.turns)} |`);
      p(`| Wall time | ${ci((r) => r.wallMs)} |`);
    }
  }
  if (args.out) fs.writeFileSync(args.out, `${lines.join('\n')}\n`);
}

if (args.summary) summary(JSON.parse(fs.readFileSync(resultsFile, 'utf8')));
else main();
