#!/usr/bin/env node
'use strict';
/**
 * Benchmark — hooks off versus hooks on.
 *
 * Identical model, prompt and scaffold in both arms. Ten tasks: six greenfield and four
 * against a seeded codebase, because published measurement shows every agent performs
 * worse on existing code — and that is exactly what DP3 targets.
 *
 * The model identifier comes from the caller. No provider or gateway is named here.
 */
const { spawnSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { wilson, differs } = require('./stats.cjs');

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(String(process.argv[i]).replace(/^--/, ''), process.argv[i + 1]);
}
const REPEAT = Number(args.get('repeat') || 5);
const ONLY = args.get('task');
const MODEL = args.get('model') || process.env.TANDEM_BENCH_MODEL || '';
const AGENT = args.get('agent') || process.env.TANDEM_BENCH_AGENT || 'tandem';
const PACE_MS = Number(args.get('pace') || 0);

const ROOT = __dirname;
const TASKS = path.join(ROOT, 'tasks');
const SCAFFOLD = path.join(TASKS, '_scaffold');
const FIXTURE = path.join(ROOT, 'fixture');
const OUT = path.join(process.cwd(), 'bench-results');
const PREP = path.join(process.cwd(), '.prepared');
fs.mkdirSync(OUT, { recursive: true });

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, ''));
const sleep = (ms) => { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

/**
 * On Termux, `node_modules/.bin/<tool>` carries `#!/usr/bin/env node`, and Termux's own
 * `/usr/bin/env` lives elsewhere, so `npx tsc` / `npx vitest` / `npm install` fail with
 * "not found" — not a real toolchain problem, just an uninherited LD_PRELOAD. Verified:
 * this silently invalidated every scoring run in this session (vitest exited 127, so
 * `passed` was always false regardless of what the agent wrote). Termux ships the fix
 * itself (`termux-exec`); this just makes sure a spawned subprocess inherits it. A no-op
 * on every other platform. Mirrors the identical helper in src/gates/run.cjs — bench/
 * intentionally does not depend on src/, so this stays duplicated rather than shared.
 */
function termuxExecEnv() {
  const prefix = process.env.PREFIX;
  if (!prefix || !prefix.includes('com.termux')) return {};
  const lib = path.join(prefix, 'lib', 'libtermux-exec-ld-preload.so');
  try { return fs.existsSync(lib) ? { LD_PRELOAD: lib } : {}; } catch { return {}; }
}
const SPAWN_ENV = { ...process.env, ...termuxExecEnv() };

/** Install the toolchain once. Installing per run is unworkable on a metered connection. */
function prepare(name, from) {
  const dir = path.join(PREP, name);
  if (fs.existsSync(path.join(dir, 'node_modules'))) return dir;
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(from, dir, { recursive: true });
  console.log(`preparing ${name} once…`);
  execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit', shell: true, env: SPAWN_ENV });
  return dir;
}

function freshFrom(prepared, prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.cpSync(prepared, d, { recursive: true });
  return d;
}

function countTypeErrors(dir) {
  const r = spawnSync('npx tsc --noEmit --pretty false', { cwd: dir, shell: true, encoding: 'utf8', timeout: 180000, env: SPAWN_ENV });
  return (((r.stdout || '') + (r.stderr || '')).match(/error TS\d+:/g) || []).length;
}

/**
 * Groq's 429 body names the exact recovery time: "Please try again in 2m53.232s."
 * Parsing it turns a guessed pace into a measured one. Falls back to a conservative
 * default when the text does not match (provider wording changed, or a non-token 429).
 */
function parseRefusalWaitMs(log) {
  const m = /try again in\s+(?:(\d+)m)?([\d.]+)s/i.exec(log);
  if (!m) return 15000;
  const minutes = m[1] ? Number(m[1]) : 0;
  const seconds = Number(m[2]);
  return Math.ceil((minutes * 60 + seconds) * 1000) + 5000; // 5s safety buffer
}

const MAX_REFUSAL_RETRIES = 5;
const MAX_REFUSAL_WAIT_MS = 20 * 60 * 1000; // a wait this long signals the quota is not
                                             // recovering on any timescale this run can wait out

/**
 * Pure retry policy, separated from the I/O (spawning the agent, sleeping) so it can be
 * tested without a real provider call. Given a run's result and how many attempts have
 * already been made, decide whether to retry and for how long.
 *
 * @returns {{retry:false}|{retry:true, waitMs:number}}
 */
function refusalRetryDecision(result, attempt) {
  if (!result.invalid || result.invalidReason !== 'provider refused' || attempt >= MAX_REFUSAL_RETRIES) {
    return { retry: false };
  }
  const waitMs = parseRefusalWaitMs(result.refusalLog || '');
  if (waitMs > MAX_REFUSAL_WAIT_MS) return { retry: false };
  return { retry: true, waitMs };
}

/**
 * Key rotation. TANDEM_API_KEYS is a comma-separated list; TANDEM_API_KEY alone is still
 * honoured as a single-key fallback so nothing that worked before this feature existed
 * breaks. Blank entries (trailing commas, stray whitespace) are dropped.
 */
function parseApiKeys(multi, single) {
  const raw = String(multi || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (raw.length) return raw;
  const one = String(single || '').trim();
  return one ? [one] : [];
}

/**
 * Rotation never resets to key 0 on its own — a key that was just refused is assumed
 * still cold, so there is no reason to prefer it again before every other key has had a
 * turn. State lives here, not at module scope, so a test can construct an isolated
 * rotator instead of fighting global mutable state.
 */
function createKeyRotator(keys) {
  let index = 0;
  return {
    total: keys.length,
    current() { return keys[index]; },
    index() { return index; },
    /** Advances to the next key (wrapping) and returns {position, total} for logging —
     *  never the key itself. */
    rotate() {
      index = (index + 1) % keys.length;
      return { position: index + 1, total: keys.length };
    },
  };
}

/** The only thing ever logged about a rotation. Takes numbers, not keys, so it cannot leak one. */
function formatKeyRotated({ position, total }) {
  return `KEY_ROTATED ${position}/${total}`;
}

/**
 * Pure: given a refused result and how many keys have been rotated through so far for
 * this run, decide whether to try the next key. Stops once every key has had one turn
 * ("one pass") — that is what falls through to the existing backoff-retry policy above.
 *
 * @returns {{rotate:false}|{rotate:true}}
 */
function keyRotationDecision(result, rotationsSoFar, totalKeys) {
  if (!result.invalid || result.invalidReason !== 'provider refused') return { rotate: false };
  if (totalKeys <= 1) return { rotate: false };
  if (rotationsSoFar >= totalKeys - 1) return { rotate: false };
  return { rotate: true };
}

/**
 * A refused run costs no quota — the request is rejected before the provider bills it
 * (observed: "Used" ticked down between two back-to-back refusals, never up). So retrying
 * — with the next key, or with the provider's own suggested wait once every key has had a
 * turn — is free in tokens and turns a transient window miss into a valid run, instead of
 * burning the run as VOID.
 */
function runOne(taskDir, rep, on, prepared) {
  let r = attemptOnce(taskDir, rep, on, prepared);

  // Rotating a key is instant; waiting out a single key's own backoff can take minutes.
  // With more than one key configured, try every other key first — it is strictly
  // cheaper — before ever falling back to waiting.
  for (let rotations = 0; ; rotations++) {
    const decision = keyRotationDecision(r, rotations, keyRotator.total);
    if (!decision.rotate) break;
    console.log(formatKeyRotated(keyRotator.rotate()));
    r = attemptOnce(taskDir, rep, on, prepared);
  }

  // Every key refused in this pass (or only one key exists) — fall through to the
  // existing wait-and-retry policy, unchanged, on whichever key is now current.
  for (let attempt = 0; attempt <= MAX_REFUSAL_RETRIES; attempt++) {
    const decision = refusalRetryDecision(r, attempt);
    if (!decision.retry) { delete r.refusalLog; return r; }
    console.log(`   provider refused — retrying in ${Math.ceil(decision.waitMs / 1000)}s (attempt ${attempt + 1}/${MAX_REFUSAL_RETRIES})`);
    sleep(decision.waitMs);
    r = attemptOnce(taskDir, rep, on, prepared);
  }
  delete r.refusalLog;
  return r;
}

const API_KEYS = parseApiKeys(process.env.TANDEM_API_KEYS, process.env.TANDEM_API_KEY);
const keyRotator = createKeyRotator(API_KEYS.length ? API_KEYS : ['']);

function attemptOnce(taskDir, rep, on, prepared) {
  const task = readJson(path.join(TASKS, taskDir, 'task.json'));
  const seeded = task.seed === 'fixture';
  const base = prepared[seeded ? 'fixture' : 'scaffold'];
  const source = seeded ? FIXTURE : SCAFFOLD;

  // The agent's directory carries config and source only — never node_modules, which a
  // model will list and thereby exhaust its budget, and never the hidden spec.
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-' + task.id + '-'));
  const score = freshFrom(base, 'ts-' + task.id + '-');
  const started = Date.now();
  try {
    for (const e of fs.readdirSync(source)) {
      if (e === 'node_modules') continue;
      fs.cpSync(path.join(source, e), path.join(work, e), { recursive: true });
    }
    fs.mkdirSync(path.join(work, 'src'), { recursive: true });

    const env = { ...process.env };
    env.TANDEM_VERBOSE = '1';
    if (!on) env.TANDEM_HOOKS = 'off';
    if (MODEL) env.TANDEM_MODEL = MODEL;
    if (API_KEYS.length) env.TANDEM_API_KEY = keyRotator.current();

    const parts = String(AGENT).split(' ').filter(Boolean);
    const argv = parts.slice(1);
    if (MODEL) argv.push('--model', MODEL);
    argv.push('-p', task.prompt);
    const r = spawnSync(parts[0], argv, { cwd: work, encoding: 'utf8',
                               timeout: task.timeoutMs || 300000, maxBuffer: 64 * 1024 * 1024, env });

    fs.rmSync(path.join(score, 'src'), { recursive: true, force: true });
    fs.cpSync(path.join(work, 'src'), path.join(score, 'src'), { recursive: true });
    fs.copyFileSync(path.join(TASKS, taskDir, 'spec.test.ts'), path.join(score, 'spec.test.ts'));

    const typeErrors = countTypeErrors(score);
    const v = spawnSync('npx vitest run --reporter=basic', { cwd: score, shell: true, encoding: 'utf8', timeout: 180000, env: SPAWN_ENV });
    const log = (r.stdout || '') + (r.stderr || '');
    if (process.env.TB_DEBUG) { console.log("=== AGENT EXIT: "+r.status); console.log("=== STDERR ==="); console.log((r.stderr||"").slice(0,2000)); if(r.error) console.log("=== SPAWN ERROR: "+r.error.message); }

    // A run where the provider never answered is INVALID, not failed. Recording it as a
    // failure silently corrupts every rate: a quota wall looks exactly like a weak model.
    const providerRefused = /quota|rate.?limit|429|insufficient|unauthorized|401|403|payment|credit/i.test(log);
    const noModelOutput = r.status === 3 || !/message_update|toolCall|tool_execution/i.test(log);
    const invalid = providerRefused || noModelOutput;

    return {
      taskId: taskDir, family: task.family || 'greenfield', rep, arm: on ? 'on' : 'off',
      invalid, invalidReason: invalid ? (providerRefused ? 'provider refused' : 'no model output') : null,
      passed: v.status === 0, typeErrorsAtEnd: typeErrors,
      wallMs: Date.now() - started,
      tandemMentions: log.split('TANDEM').length - 1,
      dp3Mentions: log.split('DP3').length - 1,
      boundedRepair: log.includes('BOUNDED_REPAIR'),
      regressionBlocked: log.includes('REGRESSION'),
      blockedWrites: log.split('outside the working set').length - 1,
      agentExit: r.status,
      refusalLog: providerRefused ? log : undefined,
    };
  } catch (e) {
    return { taskId: taskDir, family: 'unknown', rep, arm: on ? 'on' : 'off', passed: false,
             invalid: true, invalidReason: 'runner error',
             typeErrorsAtEnd: -1, wallMs: Date.now() - started, error: String(e) };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
    fs.rmSync(score, { recursive: true, force: true });
  }
}

/** Pure: pass/fail counts, Wilson intervals and the on/off overlap test for one subset of runs. */
function summarise(subset) {
  const valid = subset.filter((r) => !r.invalid);
  const off = valid.filter((r) => r.arm === 'off');
  const on = valid.filter((r) => r.arm === 'on');
  const sOff = off.filter((r) => r.passed).length;
  const sOn = on.filter((r) => r.passed).length;
  return {
    off: { pass: sOff, of: off.length, rate: off.length ? sOff / off.length : 0, wilson95: wilson(sOff, off.length),
           typeErrors: off.reduce((a, r) => a + Math.max(0, r.typeErrorsAtEnd), 0) },
    on: { pass: sOn, of: on.length, rate: on.length ? sOn / on.length : 0, wilson95: wilson(sOn, on.length),
          typeErrors: on.reduce((a, r) => a + Math.max(0, r.typeErrorsAtEnd), 0) },
    differs: off.length && on.length ? differs({ s: sOff, n: off.length }, { s: sOn, n: on.length }) : false,
  };
}

// Everything below actually runs the benchmark (spawns agents, hits the network). Guarded
// so `require('./run.cjs')` — used by tests to reach the pure functions above — never runs
// it as a side effect of being loaded.
if (require.main === module) {

const dirs = fs.readdirSync(TASKS).filter((d) => /^t\d\d-/.test(d) && (!ONLY || d.startsWith(ONLY))).sort();
const needsFixture = dirs.some((d) => (readJson(path.join(TASKS, d, 'task.json')).seed === 'fixture'));
const prepared = { scaffold: prepare('scaffold', SCAFFOLD) };
if (needsFixture) prepared.fixture = prepare('fixture', FIXTURE);

// Resumable: a long run may be interrupted, and repeating completed work is waste.
const LOG = path.join(OUT, 'progress.jsonl');
const runs = [];
const done = new Set();
if (fs.existsSync(LOG)) {
  for (const line of fs.readFileSync(LOG, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); runs.push(r); done.add(`${r.taskId}#${r.rep}#${r.arm}`); } catch { /* skip */ }
  }
  if (runs.length) console.log(`resuming: ${runs.length} runs already recorded`);
}

// Retries inside runOne already absorb a transient window miss. A run that is still VOID
// after those retries means the quota is not recovering on any timescale this process
// should wait out — stop rather than burn the rest of the matrix against an empty budget.
let stoppedEarly = false;
outer:
for (let rep = 1; rep <= REPEAT; rep++) {
  for (const d of dirs) {
    for (const on of [false, true]) {
      const key = `${d}#${rep}#${on ? 'on' : 'off'}`;
      if (done.has(key)) continue;
      const r = runOne(d, rep, on, prepared);
      runs.push(r);
      fs.appendFileSync(LOG, JSON.stringify(r) + '\n');
      const mark = r.invalid ? 'VOID' : (r.passed ? 'PASS' : 'FAIL');
      console.log(`rep${rep} ${d.padEnd(22)} ${r.arm.padEnd(3)} ${mark}  typeErr=${r.typeErrorsAtEnd}  ${r.wallMs}ms${r.invalid ? '  (' + r.invalidReason + ')' : ''}`);
      if (r.invalid) {
        stoppedEarly = true;
        console.log(`\nSTOPPING: ${key} came back VOID (${r.invalidReason}) even after retries.`);
        console.log(`${runs.filter((x) => !x.invalid).length} valid run(s) completed out of ${runs.length} attempted.`);
        break outer;
      }
      sleep(PACE_MS);
    }
  }
}

const overall = summarise(runs);
// Task files label families as novel, multifile or codebase. Anything that is not
// seeded against the fixture is greenfield — matching a literal 'greenfield' string
// silently produced an empty row.
const isCodebase = (r) => r.family === 'codebase';
const green = summarise(runs.filter((r) => !isCodebase(r) && r.family !== 'unknown'));
const codebase = summarise(runs.filter(isCodebase));

const invalidRuns = runs.filter((r) => r.invalid);
const invalidPct = runs.length ? invalidRuns.length / runs.length : 0;
const enoughData = overall.off.of >= 10 && overall.on.of >= 10;

const verdict = invalidPct > 0.2
  ? `VOID — ${invalidRuns.length} of ${runs.length} runs never reached the model. Fix that and re-run.`
  : !enoughData
    ? `VOID — only ${overall.off.of} valid runs per arm. At least 10 are needed.`
    : !overall.differs ? 'INCONCLUSIVE — the difference is inside measurement noise'
      : overall.on.rate > overall.off.rate ? 'HOOKS HELP' : 'HOOKS HURT';

const report = { model: MODEL || '(from environment)', agent: AGENT, repetitions: REPEAT,
                 tasks: dirs.length, overall, greenfield: green, codebase, verdict, stoppedEarly,
                 invalidRuns: invalidRuns.length, invalidPct, runs };
const file = path.join(OUT, 'bench-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
fs.writeFileSync(file, JSON.stringify(report, null, 2));

const pct = (x) => (x * 100).toFixed(1) + '%';
const line = (label, s) => `${label.padEnd(12)} off ${String(s.off.pass).padStart(3)}/${String(s.off.of).padEnd(3)} ${pct(s.off.rate).padStart(6)} [${pct(s.off.wilson95.lo)}, ${pct(s.off.wilson95.hi)}]   on ${String(s.on.pass).padStart(3)}/${String(s.on.of).padEnd(3)} ${pct(s.on.rate).padStart(6)} [${pct(s.on.wilson95.lo)}, ${pct(s.on.wilson95.hi)}]`;

console.log('\n================ RESULT ================');
console.log(line('overall', overall));
console.log(line('greenfield', green));
console.log(line('codebase', codebase));
console.log(`\ntype errors surviving   off ${overall.off.typeErrors}   on ${overall.on.typeErrors}`);
if (invalidRuns.length) {
  const why = {};
  for (const r of invalidRuns) why[r.invalidReason] = (why[r.invalidReason] || 0) + 1;
  console.log(`\nINVALID RUNS: ${invalidRuns.length}/${runs.length} (${(invalidPct * 100).toFixed(0)}%) — excluded from every rate above`);
  for (const [k, n] of Object.entries(why)) console.log(`   ${n} × ${k}`);
}
console.log(`\nVERDICT: ${verdict}`);
console.log('written: ' + file);

} // require.main === module

module.exports = { parseRefusalWaitMs, refusalRetryDecision, summarise, termuxExecEnv,
                   MAX_REFUSAL_RETRIES, MAX_REFUSAL_WAIT_MS,
                   parseApiKeys, createKeyRotator, formatKeyRotated, keyRotationDecision };
