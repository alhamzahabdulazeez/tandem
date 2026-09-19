#!/usr/bin/env node
'use strict';
/**
 * bench/paired/runner.cjs
 *
 * Resumable 60-run evaluation harness for IB-04 Paired Evaluation Protocol.
 * Evaluates 30 tasks across two experimental arms against baseline afa46cd:
 *   - Arm A: TANDEM_HOOKS=off (unassisted baseline)
 *   - Arm B: TANDEM_HOOKS=on (Tandem-assisted with scope prevention & budget)
 *
 * Implements resumable checkpointing in bench/paired/state.json and
 * Wilson score interval statistical comparison via bench/stats.cjs.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execSync, spawnSync } = require('node:child_process');

const stats = require('../stats.cjs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const BASELINE_COMMIT = 'afa46cd68b1a2a616f5daff0ad2ba737ec9997d2';
const TASKS_MANIFEST_PATH = path.join(__dirname, 'tasks.json');
const STATE_PATH = path.join(__dirname, 'state.json');

/**
 * Loads default environment variables from user shell RC files if not present in process.env.
 */
function loadEnvDefaults() {
  const vars = ['TANDEM_BASE_URL', 'TANDEM_API_KEY', 'TANDEM_MODEL', 'TANDEM_PROVIDER', 'TANDEM_API'];
  const missing = vars.filter(v => !process.env[v]);
  if (missing.length === 0) return;

  const home = os.homedir();
  const rcFiles = [
    path.join(home, '.bashrc'),
    path.join(home, '.profile'),
    path.join(home, '.bash_profile'),
  ];
  for (const rc of rcFiles) {
    if (fs.existsSync(rc)) {
      try {
        const content = fs.readFileSync(rc, 'utf8');
        for (const line of content.split('\n')) {
          const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)=(?:["']([^"']*)["']|([^\s#]+))/);
          if (m) {
            const key = m[1];
            const val = m[2] !== undefined ? m[2] : m[3];
            if (vars.includes(key) && !process.env[key]) {
              process.env[key] = val;
            }
          }
        }
      } catch {}
    }
  }
}

/**
 * Returns Termux-specific environment overrides if running under Termux.
 */
function termuxExecEnv() {
  const prefix = process.env.PREFIX || '/data/data/com.termux/files/usr';
  const lib = path.join(prefix, 'lib', 'libtermux-exec-ld-preload.so');
  try {
    return fs.existsSync(lib) ? { LD_PRELOAD: lib } : {};
  } catch {
    return {};
  }
}

/**
 * Loads the 30 tasks from tasks.json.
 */
function loadTasks() {
  if (!fs.existsSync(TASKS_MANIFEST_PATH)) {
    throw new Error(`Tasks manifest not found at ${TASKS_MANIFEST_PATH}`);
  }
  const data = JSON.parse(fs.readFileSync(TASKS_MANIFEST_PATH, 'utf8'));
  return data.tasks || [];
}

/**
 * Builds the list of 60 scheduled runs (30 tasks x 2 arms).
 */
function buildRunSchedule(tasks) {
  const runs = [];
  let index = 1;
  for (const task of tasks) {
    // Arm A: Hooks OFF
    runs.push({
      run_index: index++,
      task_id: task.id,
      task_index: task.index,
      task_title: task.title,
      arm: 'A',
      tandem_hooks: 'off',
      status: 'PENDING',
      passed: false,
      stage1_passed: false,
      stage2_passed: false,
      scope_valid: false,
      tool_calls: 0,
      files_read: 0,
      files_changed: 0,
      lines_added: 0,
      lines_removed: 0,
      wall_time_ms: 0,
      stop_reason: null,
      scope_blocks_fired: 0,
      scope_violations: [],
      error: null,
      timestamp: null
    });

    // Arm B: Hooks ON
    runs.push({
      run_index: index++,
      task_id: task.id,
      task_index: task.index,
      task_title: task.title,
      arm: 'B',
      tandem_hooks: 'on',
      status: 'PENDING',
      passed: false,
      stage1_passed: false,
      stage2_passed: false,
      scope_valid: false,
      tool_calls: 0,
      files_read: 0,
      files_changed: 0,
      lines_added: 0,
      lines_removed: 0,
      wall_time_ms: 0,
      stop_reason: null,
      scope_blocks_fired: 0,
      scope_violations: [],
      error: null,
      timestamp: null
    });
  }
  return runs;
}

/**
 * Creates or loads state.json.
 */
function loadState() {
  const tasks = loadTasks();
  if (fs.existsSync(STATE_PATH)) {
    try {
      const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
      if (state && Array.isArray(state.runs) && state.runs.length === 60) {
        return state;
      }
    } catch {
      // Re-initialize corrupted state
    }
  }

  const runs = buildRunSchedule(tasks);
  const initialState = {
    document_type: 'PAIRED_EVALUATION_STATE_V1',
    schema_version: '1.0.0',
    protocol: 'IB-04',
    baseline_commit: BASELINE_COMMIT,
    total_tasks: tasks.length,
    total_runs: runs.length,
    completed_runs: 0,
    runs,
    summary: computeSummary(runs)
  };

  saveState(initialState);
  return initialState;
}

/**
 * Atomically writes state to state.json.
 */
function saveState(state) {
  state.summary = computeSummary(state.runs);
  state.completed_runs = state.runs.filter(r => r.status === 'COMPLETED').length;
  state.invalid_runs = state.runs.filter(r => r.status === 'INVALID').length;
  const tmpPath = `${STATE_PATH}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmpPath, STATE_PATH);
}

/**
 * Computes Wilson intervals and comparative metrics from run records.
 */
function computeSummary(runs) {
  const armARuns = runs.filter(r => r.arm === 'A' && r.status === 'COMPLETED');
  const armBRuns = runs.filter(r => r.arm === 'B' && r.status === 'COMPLETED');

  const armASuccesses = armARuns.filter(r => r.passed).length;
  const armBSuccesses = armBRuns.filter(r => r.passed).length;

  const armATrials = armARuns.length;
  const armBTrials = armBRuns.length;

  const armAPassRate = armATrials > 0 ? armASuccesses / armATrials : 0;
  const armBPassRate = armBTrials > 0 ? armBSuccesses / armBTrials : 0;

  const armACi = stats.wilson(armASuccesses, armATrials, 1.96);
  const armBCi = stats.wilson(armBSuccesses, armBTrials, 1.96);

  const mean = (arr, fn) => arr.length > 0 ? arr.reduce((acc, x) => acc + fn(x), 0) / arr.length : 0;

  const armAMeanCalls = mean(armARuns, r => r.tool_calls);
  const armBMeanCalls = mean(armBRuns, r => r.tool_calls);

  const armAMeanTime = mean(armARuns, r => r.wall_time_ms);
  const armBMeanTime = mean(armBRuns, r => r.wall_time_ms);

  const armAMeanLines = mean(armARuns, r => r.lines_added + r.lines_removed);
  const armBMeanLines = mean(armBRuns, r => r.lines_added + r.lines_removed);

  const deltaPassRate = armBPassRate - armAPassRate;
  const benefitThresholdMet = deltaPassRate >= 0.15;

  const overheadRatio = armAMeanCalls > 0 ? armBMeanCalls / armAMeanCalls : (armBMeanCalls > 0 ? 2.0 : 1.0);
  const overheadAcceptable = overheadRatio <= 1.80;

  // Superiority requires: CI_B.lo > CI_A.hi (non-overlapping)
  const intervalsSeparated = armBCi.lo > armACi.hi;

  let superiorityVerdict = 'NOT_EVALUATED';
  if (armATrials === 30 && armBTrials === 30) {
    if (benefitThresholdMet && overheadAcceptable && intervalsSeparated) {
      superiorityVerdict = 'SUPERIOR';
    } else if (armBPassRate < armAPassRate || !overheadAcceptable) {
      superiorityVerdict = 'INFERIOR';
    } else {
      superiorityVerdict = 'INCONCLUSIVE';
    }
  } else if (armATrials > 0 || armBTrials > 0) {
    superiorityVerdict = 'IN_PROGRESS';
  }

  return {
    arm_A: {
      description: 'Baseline unassisted (TANDEM_HOOKS=off)',
      trials: armATrials,
      successes: armASuccesses,
      pass_rate: parseFloat(armAPassRate.toFixed(4)),
      wilson_ci: {
        lo: parseFloat(armACi.lo.toFixed(4)),
        hi: parseFloat(armACi.hi.toFixed(4))
      },
      mean_tool_calls: parseFloat(armAMeanCalls.toFixed(2)),
      mean_wall_time_ms: parseFloat(armAMeanTime.toFixed(1)),
      mean_lines_changed: parseFloat(armAMeanLines.toFixed(2))
    },
    arm_B: {
      description: 'Tandem-assisted (TANDEM_HOOKS=on)',
      trials: armBTrials,
      successes: armBSuccesses,
      pass_rate: parseFloat(armBPassRate.toFixed(4)),
      wilson_ci: {
        lo: parseFloat(armBCi.lo.toFixed(4)),
        hi: parseFloat(armBCi.hi.toFixed(4))
      },
      mean_tool_calls: parseFloat(armBMeanCalls.toFixed(2)),
      mean_wall_time_ms: parseFloat(armBMeanTime.toFixed(1)),
      mean_lines_changed: parseFloat(armBMeanLines.toFixed(2))
    },
    comparison: {
      delta_pass_rate: parseFloat(deltaPassRate.toFixed(4)),
      benefit_threshold: 0.15,
      benefit_threshold_met: benefitThresholdMet,
      overhead_ratio: parseFloat(overheadRatio.toFixed(4)),
      max_overhead_ratio: 1.80,
      overhead_acceptable: overheadAcceptable,
      intervals_separated: intervalsSeparated,
      superiority_verdict: superiorityVerdict
    }
  };
}

/**
 * Verifies that mutations in target workspace stay within allowed files.
 */
function verifyScope(workDir, allowedFiles) {
  try {
    const diffOut = execSync(`git diff --name-only ${BASELINE_COMMIT}`, {
      cwd: workDir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    const untrackedOut = execSync('git ls-files --others --exclude-standard', {
      cwd: workDir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    const diffList = diffOut ? diffOut.split('\n').map(s => s.trim()).filter(Boolean) : [];
    const untrackedList = untrackedOut ? untrackedOut.split('\n').map(s => s.trim()).filter(Boolean) : [];

    const changedFiles = Array.from(new Set([...diffList, ...untrackedList]))
      .filter(f => f !== 'node_modules' && !f.startsWith('node_modules/') && f !== '.git' && !f.startsWith('.git/'));

    const disallowed = changedFiles.filter(f => !allowedFiles.includes(f));
    return {
      valid: disallowed.length === 0,
      changedFiles,
      disallowedFiles: disallowed
    };
  } catch (err) {
    return {
      valid: false,
      changedFiles: [],
      disallowedFiles: ['GIT_DIFF_ERROR: ' + err.message]
    };
  }
}

/**
 * Runs Stage 1: Non-regression baseline verification.
 */
function runStage1(workDir, timeoutMs = 15000) {
  const res = spawnSync(process.execPath, ['test/run.cjs'], {
    cwd: workDir,
    timeout: timeoutMs,
    encoding: 'utf8'
  });
  const stdout = res.stdout || '';
  const match = stdout.match(/(\d+)\s+passed,\s+(\d+)\s+failed/);
  const passed = match ? parseInt(match[1], 10) : 0;
  const failed = match ? parseInt(match[2], 10) : (res.status === 0 ? 0 : 1);
  const isGreen = res.status === 0 && passed === 111 && failed === 0;

  return { isGreen, passed, failed, exitCode: res.status, stdout };
}

/**
 * Runs Stage 2: Held-out acceptance grader.
 */
function runStage2(workDir, graderRelPath, timeoutMs = 10000) {
  const graderAbsPath = path.resolve(REPO_ROOT, graderRelPath);
  if (!fs.existsSync(graderAbsPath)) {
    return { isGreen: false, passed: 0, failed: 1, exitCode: 1, error: `Grader not found at ${graderRelPath}` };
  }

  const res = spawnSync(process.execPath, [graderAbsPath, workDir], {
    timeout: timeoutMs,
    encoding: 'utf8'
  });
  const stdout = res.stdout || '';
  const match = stdout.match(/(\d+)\s+passed,\s+(\d+)\s+failed/);
  const passed = match ? parseInt(match[1], 10) : 0;
  const failed = match ? parseInt(match[2], 10) : (res.status === 0 ? 0 : 1);
  const isGreen = res.status === 0 && failed === 0 && passed > 0;

  return { isGreen, passed, failed, exitCode: res.status, stdout };
}

/**
 * Prepares an isolated work directory for a specific task run.
 */
function prepareWorkspace(workDir) {
  execSync(`git clone --no-hardlinks "${REPO_ROOT}" "${workDir}"`, { stdio: 'pipe' });
  execSync(`git checkout ${BASELINE_COMMIT}`, { cwd: workDir, stdio: 'pipe' });

  const nodeModulesSource = path.join(REPO_ROOT, 'node_modules');
  if (fs.existsSync(nodeModulesSource)) {
    const destModules = path.join(workDir, 'node_modules');
    if (!fs.existsSync(destModules)) {
      try {
        fs.symlinkSync(nodeModulesSource, destModules);
      } catch {
        // Fallback
      }
    }
  }
}

/**
 * Evaluates diff statistics (files changed, lines added/removed).
 */
function getDiffMetrics(workDir) {
  try {
    const numstat = execSync(`git diff --numstat ${BASELINE_COMMIT}`, {
      cwd: workDir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    let linesAdded = 0;
    let linesRemoved = 0;
    let filesChanged = 0;

    if (numstat) {
      for (const line of numstat.split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 3) {
          const added = parseInt(parts[0], 10) || 0;
          const removed = parseInt(parts[1], 10) || 0;
          linesAdded += added;
          linesRemoved += removed;
          filesChanged++;
        }
      }
    }

    return { linesAdded, linesRemoved, filesChanged };
  } catch {
    return { linesAdded: 0, linesRemoved: 0, filesChanged: 0 };
  }
}

/**
 * Evaluates the results of an existing or mock candidate directory against a scheduled run.
 */
function evaluateRunWorkspace(runRecord, task, workDir, telemetry = {}) {
  const startTime = Date.now();

  if (telemetry.is_invalid) {
    runRecord.status = 'INVALID';
    runRecord.passed = false;
    runRecord.stage1_passed = false;
    runRecord.stage2_passed = false;
    runRecord.scope_valid = false;
    runRecord.tool_calls = telemetry.tool_calls || 0;
    runRecord.files_read = telemetry.files_read || 0;
    runRecord.files_changed = 0;
    runRecord.lines_added = 0;
    runRecord.lines_removed = 0;
    runRecord.wall_time_ms = telemetry.wall_time_ms || 0;
    runRecord.stop_reason = telemetry.stop_reason || 'SESSION_FAILED';
    runRecord.scope_blocks_fired = telemetry.scope_blocks_fired || 0;
    runRecord.scope_violations = [];
    runRecord.error = telemetry.stop_reason || 'MODEL_UNREACHED';
    runRecord.timestamp = new Date().toISOString();
    return runRecord;
  }

  const scopeResult = verifyScope(workDir, task.allowed_files);
  const stage1 = runStage1(workDir);
  const stage2 = runStage2(workDir, task.grader_rel_path);
  const diffMetrics = getDiffMetrics(workDir);

  const passed = scopeResult.valid && stage1.isGreen && stage2.isGreen;

  runRecord.status = 'COMPLETED';
  runRecord.passed = passed;
  runRecord.stage1_passed = stage1.isGreen;
  runRecord.stage2_passed = stage2.isGreen;
  runRecord.scope_valid = scopeResult.valid;
  runRecord.tool_calls = telemetry.tool_calls || 0;
  runRecord.files_read = telemetry.files_read || 0;
  runRecord.files_changed = diffMetrics.filesChanged;
  runRecord.lines_added = diffMetrics.linesAdded;
  runRecord.lines_removed = diffMetrics.linesRemoved;
  runRecord.wall_time_ms = telemetry.wall_time_ms || (Date.now() - startTime);
  runRecord.stop_reason = telemetry.stop_reason || (passed ? 'SUCCESS' : 'VERIFICATION_FAILED');
  runRecord.scope_blocks_fired = telemetry.scope_blocks_fired || 0;
  runRecord.scope_violations = scopeResult.disallowedFiles;
  runRecord.error = passed ? null : (
    !scopeResult.valid ? 'DISALLOWED_MUTATION_SCOPE' :
    (!stage1.isGreen ? 'STAGE1_BASELINE_REGRESSION' : 'STAGE2_GRADER_FAILED')
  );
  runRecord.timestamp = new Date().toISOString();

  return runRecord;
}

/**
 * Prints formatted CLI summary.
 */
function printSummary(state) {
  const summary = state.summary;
  console.log('\n============================================================');
  console.log('         TANDEM IB-04 PAIRED EVALUATION PROTOCOL            ');
  console.log('============================================================\n');
  console.log(`Baseline Commit:    ${state.baseline_commit} (afa46cd)`);
  console.log(`Total Tasks:        ${state.total_tasks}`);
  console.log(`Total Scheduled:    ${state.total_runs} (30 tasks x 2 arms)`);
  console.log(`Completed Runs:     ${state.completed_runs} / ${state.total_runs}`);
  if (state.invalid_runs && state.invalid_runs > 0) {
    console.log(`Invalid Runs:       ${state.invalid_runs} (excluded from trial denominator)`);
  }
  console.log('');

  console.log('--- ARM A (TANDEM_HOOKS=off, Baseline) ---');
  console.log(`  Trials:           ${summary.arm_A.trials}`);
  console.log(`  Successes:        ${summary.arm_A.successes}`);
  console.log(`  Pass Rate:        ${(summary.arm_A.pass_rate * 100).toFixed(1)}%`);
  console.log(`  95% Wilson CI:    [${(summary.arm_A.wilson_ci.lo * 100).toFixed(1)}%, ${(summary.arm_A.wilson_ci.hi * 100).toFixed(1)}%]`);
  console.log(`  Mean Tool Calls:  ${summary.arm_A.mean_tool_calls}`);
  console.log(`  Mean Wall Time:   ${summary.arm_A.mean_wall_time_ms} ms`);
  console.log('');

  console.log('--- ARM B (TANDEM_HOOKS=on, Tandem-Assisted) ---');
  console.log(`  Trials:           ${summary.arm_B.trials}`);
  console.log(`  Successes:        ${summary.arm_B.successes}`);
  console.log(`  Pass Rate:        ${(summary.arm_B.pass_rate * 100).toFixed(1)}%`);
  console.log(`  95% Wilson CI:    [${(summary.arm_B.wilson_ci.lo * 100).toFixed(1)}%, ${(summary.arm_B.wilson_ci.hi * 100).toFixed(1)}%]`);
  console.log(`  Mean Tool Calls:  ${summary.arm_B.mean_tool_calls}`);
  console.log(`  Mean Wall Time:   ${summary.arm_B.mean_wall_time_ms} ms`);
  console.log('');

  console.log('--- STATISTICAL COMPARISON & DECISION RULES ---');
  console.log(`  Δ Pass Rate (B - A):      ${(summary.comparison.delta_pass_rate * 100).toFixed(1)}% (Threshold: +15.0%) -> ${summary.comparison.benefit_threshold_met ? 'PASS' : 'FAIL'}`);
  console.log(`  Resource Overhead Ratio:  ${summary.comparison.overhead_ratio.toFixed(2)}x (Max: 1.80x) -> ${summary.comparison.overhead_acceptable ? 'PASS' : 'FAIL'}`);
  console.log(`  95% CI Non-Overlapping:   ${summary.comparison.intervals_separated ? 'YES' : 'NO'}`);
  console.log(`  Superiority Verdict:      ${summary.comparison.superiority_verdict}`);
  console.log('============================================================\n');
}

/**
 * Runs a single candidate session via Tandem adapter.
 */
function runCandidateSession(workDir, task, arm, timeoutMs = 120000) {
  loadEnvDefaults();
  const hooksEnv = arm === 'B' ? 'on' : 'off';
  const env = {
    ...process.env,
    ...termuxExecEnv(),
    TANDEM_HOOKS: hooksEnv,
    TANDEM_ALLOWED_FILES: (task.allowed_files || []).join(','),
  };

  const startTime = Date.now();
  const runScriptPath = path.join(REPO_ROOT, 'src/adapter/run.mjs');

  const child = spawnSync(process.execPath, [runScriptPath, task.prompt], {
    cwd: workDir,
    env,
    encoding: 'utf8',
    timeout: timeoutMs,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const wallTimeMs = Date.now() - startTime;
  const stdout = child.stdout || '';
  const stderr = child.stderr || '';
  const combined = stdout + '\n' + stderr;

  let tool_calls = 0;
  let files_read = 0;
  let scope_blocks_fired = 0;

  const telemMatch = combined.match(/\[tandem:telemetry\]\s+tool_calls=(\d+)\s+files_read=(\d+)\s+scope_blocks_fired=(\d+)/);
  if (telemMatch) {
    tool_calls = parseInt(telemMatch[1], 10);
    files_read = parseInt(telemMatch[2], 10);
    scope_blocks_fired = parseInt(telemMatch[3], 10);
  }

  const providerRefused = /quota|rate.?limit|429|insufficient|unauthorized|401|403|payment|credit/i.test(combined);
  const noModelOutput = child.status === 3 || combined.includes('the session produced no events — the model was not reached');
  const modelUnresolved = child.status === 2 || combined.includes('could not resolve a model') || combined.includes('host agent not available');
  const agentError = child.status === 4 || combined.includes('agent reported');

  let stop_reason = 'UNKNOWN';
  if (child.status === 0) {
    stop_reason = 'SUCCESS';
  } else if (child.error && child.error.code === 'ETIMEDOUT') {
    stop_reason = 'TIMEOUT';
  } else if (providerRefused) {
    stop_reason = 'PROVIDER_REFUSED';
  } else if (modelUnresolved) {
    stop_reason = 'MODEL_UNRESOLVED';
  } else if (noModelOutput) {
    stop_reason = 'MODEL_UNREACHED';
  } else if (agentError) {
    stop_reason = 'AGENT_ERROR';
  } else if (child.status !== 0) {
    stop_reason = 'SESSION_FAILED';
  }

  const is_invalid = (tool_calls === 0 && stop_reason !== 'SUCCESS') || child.status === 2 || child.status === 3 || providerRefused || modelUnresolved || noModelOutput;

  if (child.error) {
    console.error(`[IB-04 Runner] Candidate process spawn error: ${child.error.message}`);
  }
  if (child.status !== 0 || is_invalid) {
    console.error(`[IB-04 Runner] Candidate session exit code: ${child.status}, stop_reason: ${stop_reason}`);
    if (stderr.trim()) {
      console.error(`[IB-04 Runner] Candidate stderr:\n${stderr.trim()}`);
    }
    if (stdout.trim() && !stderr.trim()) {
      console.error(`[IB-04 Runner] Candidate stdout:\n${stdout.trim()}`);
    }
  }

  return {
    tool_calls,
    files_read,
    scope_blocks_fired,
    wall_time_ms: wallTimeMs,
    stop_reason,
    exit_code: child.status,
    is_invalid,
    stdout,
    stderr
  };
}

/**
 * Executes scheduled evaluation runs in isolated workspaces and persists state.
 */
function executeRuns(state, options = {}) {
  const limit = options.limit !== undefined ? options.limit : Infinity;
  const timeoutMs = options.timeoutMs || 120000;
  const tasks = loadTasks();
  const taskMap = new Map(tasks.map(t => [t.id, t]));

  let executedCount = 0;

  for (const run of state.runs) {
    if (run.status === 'COMPLETED' || run.status === 'INVALID') {
      continue;
    }
    if (executedCount >= limit) {
      break;
    }

    const task = taskMap.get(run.task_id);
    if (!task) {
      throw new Error(`Task ${run.task_id} not found in manifest`);
    }

    console.log(`[IB-04 Runner] Starting Run ${run.run_index}/${state.total_runs}: Task=${task.id} (${task.title}) Arm=${run.arm} (Hooks=${run.tandem_hooks})`);

    const workDir = path.join(os.tmpdir(), `tandem-paired-${run.task_id}-${run.arm}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);

    try {
      prepareWorkspace(workDir);
      const sessionResult = runCandidateSession(workDir, task, run.arm, timeoutMs);
      evaluateRunWorkspace(run, task, workDir, {
        tool_calls: sessionResult.tool_calls,
        files_read: sessionResult.files_read,
        scope_blocks_fired: sessionResult.scope_blocks_fired,
        wall_time_ms: sessionResult.wall_time_ms,
        stop_reason: sessionResult.stop_reason,
        is_invalid: sessionResult.is_invalid
      });

      console.log(`[IB-04 Runner] Completed Run ${run.run_index}: Status=${run.status} Passed=${run.passed} ToolCalls=${run.tool_calls} FilesRead=${run.files_read} FilesChanged=${run.files_changed} (+${run.lines_added}/-${run.lines_removed}) ScopeBlocks=${run.scope_blocks_fired} StopReason=${run.stop_reason} Time=${run.wall_time_ms}ms`);
    } catch (err) {
      run.status = 'INVALID';
      run.passed = false;
      run.error = 'RUNNER_EXECUTION_ERROR: ' + err.message;
      run.stop_reason = 'EXECUTION_ERROR';
      run.timestamp = new Date().toISOString();
      console.error(`[IB-04 Runner] Error in Run ${run.run_index}:`, err.message);
    } finally {
      try {
        if (fs.existsSync(workDir)) {
          fs.rmSync(workDir, { recursive: true, force: true });
        }
      } catch {
        // Cleanup error ignored
      }
    }

    executedCount++;
    saveState(state);
  }

  return executedCount;
}

// CLI Execution Entrypoint
if (require.main === module) {
  const args = process.argv.slice(2);
  const isJson = args.includes('--json');
  const isSummary = args.includes('--summary');
  const isReset = args.includes('--reset');
  const isRun = args.includes('--run');

  let limit = undefined;
  const limitIdx = args.indexOf('--limit');
  if (limitIdx !== -1 && args[limitIdx + 1]) {
    limit = parseInt(args[limitIdx + 1], 10);
  } else {
    const limitEq = args.find(a => a.startsWith('--limit='));
    if (limitEq) {
      limit = parseInt(limitEq.split('=')[1], 10);
    }
  }

  if (isReset && fs.existsSync(STATE_PATH)) {
    fs.unlinkSync(STATE_PATH);
    console.log('Reset paired evaluation state.');
  }

  const state = loadState();

  if (isRun) {
    try {
      const executed = executeRuns(state, { limit });
      console.log(`\n[IB-04 Runner] Executed ${executed} run(s). Current status: ${state.completed_runs}/${state.total_runs} completed.`);
    } catch (err) {
      console.error('[IB-04 Runner] Fatal execution failure:', err);
      process.exit(1);
    }
  }

  if (isSummary || isRun) {
    if (isJson) {
      console.log(JSON.stringify(state.summary, null, 2));
    } else {
      printSummary(state);
    }
    process.exit(0);
  }

  if (isJson) {
    console.log(JSON.stringify(state, null, 2));
  } else {
    printSummary(state);
  }
}

module.exports = {
  loadTasks,
  loadState,
  saveState,
  buildRunSchedule,
  computeSummary,
  verifyScope,
  runStage1,
  runStage2,
  prepareWorkspace,
  evaluateRunWorkspace,
  runCandidateSession,
  executeRuns
};
