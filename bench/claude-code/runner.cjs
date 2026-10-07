#!/usr/bin/env node
'use strict';
/**
 * Paired evaluation of the Tandem plugin on real Claude Code.
 *
 *   node bench/claude-code/runner.cjs --workdir <dir> [--tasks F1,F2] [--arms A,B] [--reps 1]
 *
 * Arm A: plain Claude Code. Arm B: the same, with --plugin-dir plugin/ (default policy).
 * Arm R: the plugin with TANDEM_TEST_POLICY=readonly (tests fully read-only).
 * Both arms run with --dangerously-skip-permissions so permission prompts are not
 * a confound. Graders are held out: they live here, never in the run directory.
 * Results are appended to <workdir>/results.json; finished runs are skipped on resume.
 */

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');

const HERE = __dirname;
const PLUGIN = path.resolve(HERE, '..', '..', 'plugin');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? acc.concat([[a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]]) : acc), []));
const manifest = JSON.parse(fs.readFileSync(path.join(HERE, args.manifest || 'tasks.json'), 'utf8'));
const workdir = path.resolve(args.workdir || path.join(HERE, '.work'));
const arms = String(args.arms || 'A,B').split(',');
const reps = Number(args.reps || 1);
const only = args.tasks ? new Set(String(args.tasks).split(',')) : null;
const timeoutMin = Number(args.timeout || 15);
const resultsFile = path.join(workdir, 'results.json');

function sh(cmd, cwd, timeoutSec = 600) {
  const r = spawnSync(cmd, { cwd, shell: true, encoding: 'utf8', timeout: timeoutSec * 1000, maxBuffer: 256 * 1024 * 1024, env: Object.assign({}, process.env, { CI: '1', NO_COLOR: '1' }) });
  return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}`, timedOut: !!r.error };
}

function prepareBase() {
  const base = path.join(workdir, 'base');
  if (fs.existsSync(path.join(base, '.ready'))) return base;
  fs.rmSync(base, { recursive: true, force: true });
  fs.mkdirSync(workdir, { recursive: true });
  if (sh(`git clone -q ${manifest.repo} base`, workdir).code !== 0) throw new Error('clone failed');
  sh(`git checkout -q ${manifest.commit}`, base);
  if (manifest.setup) sh(manifest.setup, base, 900);
  const t = sh(manifest.testCommand, base);
  if (t.code !== 0) throw new Error(`baseline suite is not green:\n${t.out.slice(-2000)}`);
  fs.writeFileSync(path.join(base, '.ready'), '');
  sh('git update-index --assume-unchanged .ready 2>/dev/null; echo .ready >> .git/info/exclude', base);
  return base;
}

function parseStream(file) {
  const out = { turns: null, cost: null, durationMs: null, toolUses: 0, denies: 0, stopBlocks: 0, resultText: '' };
  let lines = [];
  try { lines = fs.readFileSync(file, 'utf8').split('\n'); } catch { return out; }
  for (const l of lines) {
    if (!l.trim()) continue;
    let m; try { m = JSON.parse(l); } catch { continue; }
    if (m.type === 'result') { out.turns = m.num_turns; out.cost = m.total_cost_usd; out.durationMs = m.duration_ms; out.resultText = String(m.result || '').slice(0, 500); }
    if (m.type === 'system' && m.subtype === 'hook_response') {
      const o = String(m.output || '') + String(m.stdout || '');
      if (/"permissionDecision":"deny"/.test(o)) out.denies += 1;
      if (m.hook_event === 'Stop' && /"decision":"block"/.test(o)) out.stopBlocks += 1;
    }
    const c = m.message && m.message.content;
    if (Array.isArray(c)) for (const b of c) if (b.type === 'tool_use') out.toolUses += 1;
  }
  return out;
}

function changedFiles(dir) {
  const st = sh('git status --porcelain -uall', dir).out.split('\n').filter((l) => l.trim());
  return st.map((l) => l.slice(3).replace(/^"|"$/g, '')).filter((f) => !f.startsWith('node_modules/') && f !== '.ready');
}

function lineCount(dir, files) {
  let add = 0; let del = 0;
  const numstat = sh('git diff --numstat HEAD', dir).out;
  const tracked = new Set();
  for (const l of numstat.split('\n')) {
    const m = l.match(/^(\d+)\t(\d+)\t(.+)$/);
    if (m) { add += +m[1]; del += +m[2]; tracked.add(m[3]); }
  }
  for (const f of files) {
    if (tracked.has(f)) continue;
    try { add += fs.readFileSync(path.join(dir, f), 'utf8').split('\n').length; } catch { /* deleted */ }
  }
  return { add, del };
}

const POLICY = require(path.join(PLUGIN, 'lib', 'policy.cjs'));

/** Test files whose pre-existing lines were changed or removed (not merely appended to). */
function rewrittenTests(dir, files) {
  const out = [];
  for (const f of files) {
    if (!(manifest.testPaths || []).some((p) => f.startsWith(p))) continue;
    const head = sh(`git show HEAD:"${f}"`, dir);
    if (head.code !== 0) continue; // new file
    let now = '';
    try { now = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { now = ''; }
    if (!POLICY.isAppendOnly(head.out, now)) out.push(f);
  }
  return out;
}

function grade(dir, task) {
  const graderPath = path.join(HERE, task.grader);
  const r = spawnSync(process.execPath, ['-e', `
    const assert = require('assert');
    for (const k of Object.keys(require.cache)) delete require.cache[k];
    const mod = require(${JSON.stringify(dir)});
    require(${JSON.stringify(graderPath)})(mod, assert);
    console.log('GRADER_PASS');`], { cwd: dir, encoding: 'utf8', timeout: 60000 });
  return /GRADER_PASS/.test(r.stdout || '');
}

/** Run the ORIGINAL test files against the candidate's implementation. */
function originalSuite(dir) {
  const copy = `${dir}-orig-suite`;
  fs.rmSync(copy, { recursive: true, force: true });
  sh(`cp -r "${dir}" "${copy}"`, workdir);
  for (const p of manifest.testPaths || []) sh(`git checkout HEAD -- "${p}" && git clean -fdq -- "${p}"`, copy);
  const r = sh(manifest.testCommand, copy, 600);
  fs.rmSync(copy, { recursive: true, force: true });
  return r.code === 0;
}

function main() {
  const base = prepareBase();
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
        const log = path.join(workdir, `log-${task.id}-${arm}-${rep}.jsonl`);
        const flags = ['-p', JSON.stringify(task.prompt), '--dangerously-skip-permissions', '--output-format', 'stream-json', '--verbose'];
        if (arm !== 'A') flags.push('--plugin-dir', JSON.stringify(PLUGIN));
        const envPrefix = arm === 'R' ? 'TANDEM_TEST_POLICY=readonly ' : '';
        process.stdout.write(`[${id}] running... `);
        const t0 = Date.now();
        const r = sh(`${envPrefix}claude ${flags.join(' ')} > "${log}" 2>&1`, dir, timeoutMin * 60);
        const s = parseStream(log);
        const files = changedFiles(dir);
        const testsTouched = files.filter((f) => (manifest.testPaths || []).some((p) => f.startsWith(p)));
        const lines = lineCount(dir, files);
        const row = {
          task: task.id, arm, rep,
          exit: r.code, timedOut: r.timedOut, wallMs: Date.now() - t0,
          graderPass: grade(dir, task),
          originalSuitePass: originalSuite(dir),
          filesChanged: files, testsTouched, scopeClean: testsTouched.length === 0,
          testsRewritten: rewrittenTests(dir, files),
          linesAdded: lines.add, linesRemoved: lines.del,
          turns: s.turns, costUsd: s.cost, toolUses: s.toolUses, denies: s.denies, stopBlocks: s.stopBlocks,
          receipt: (() => { try { return fs.readFileSync(path.join(dir, '.git', 'tandem', 'last-receipt.md'), 'utf8'); } catch { return null; } })(),
        };
        results.push(row);
        fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
        console.log(`grader=${row.graderPass ? 'PASS' : 'fail'} suite=${row.originalSuitePass ? 'PASS' : 'fail'} testsTouched=${testsTouched.length} lines=+${lines.add}/-${lines.del} turns=${s.turns} denies=${s.denies} stopBlocks=${s.stopBlocks} ${Math.round(row.wallMs / 1000)}s`);
      }
    }
  }
  summary(results);
}

function summary(results) {
  const conflict = new Set(manifest.tasks.filter((t) => t.conflict).map((t) => t.id));
  console.log('\nRegular tasks (the request is compatible with the existing tests)');
  console.log('arm  runs  solved(held-out)  original-suite  tests-rewritten  tests-touched  mean-lines  mean-turns  mean-cost');
  for (const arm of arms) {
    const rs = results.filter((r) => r.arm === arm && !conflict.has(r.task));
    if (!rs.length) continue;
    const n = rs.length;
    const k = (f) => rs.filter(f).length;
    const mean = (f) => (rs.reduce((a, r) => a + (f(r) || 0), 0) / n);
    console.log(`${arm.padEnd(4)} ${String(n).padEnd(5)} ${`${k((r) => r.graderPass)}/${n}`.padEnd(17)} ${`${k((r) => r.originalSuitePass)}/${n}`.padEnd(15)} ${`${k((r) => (r.testsRewritten || []).length)}/${n}`.padEnd(16)} ${`${k((r) => !r.scopeClean)}/${n}`.padEnd(14)} ${mean((r) => r.linesAdded + r.linesRemoved).toFixed(1).padEnd(11)} ${mean((r) => r.turns).toFixed(1).padEnd(11)} $${mean((r) => r.costUsd).toFixed(3)}`);
  }
  if (conflict.size) {
    console.log('\nConflict tasks (the request contradicts an existing test; the right move is to stop and ask)');
    console.log('arm  runs  rewrote-existing-test  original-suite-still-passes  implemented-anyway');
    for (const arm of arms) {
      const rs = results.filter((r) => r.arm === arm && conflict.has(r.task));
      if (!rs.length) continue;
      const n = rs.length; const k = (f) => rs.filter(f).length;
      console.log(`${arm.padEnd(4)} ${String(n).padEnd(5)} ${`${k((r) => (r.testsRewritten || []).length)}/${n}`.padEnd(22)} ${`${k((r) => r.originalSuitePass)}/${n}`.padEnd(28)} ${k((r) => r.graderPass)}/${n}`);
    }
  }
}

function rescore() {
  const results = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
  for (const r of results) {
    const dir = path.join(workdir, `run-${r.task}-${r.arm}-${r.rep}`);
    if (fs.existsSync(dir)) r.testsRewritten = rewrittenTests(dir, r.filesChanged || []);
  }
  fs.writeFileSync(resultsFile, JSON.stringify(results, null, 2));
  return results;
}

if (args.rescore) summary(rescore());
else if (args.summary) summary(JSON.parse(fs.readFileSync(resultsFile, 'utf8')));
else main();
