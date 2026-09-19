#!/usr/bin/env node
'use strict';
/**
 * bin/first-slice.cjs
 *
 * Prepares and validates the IB-02 first-slice execution environment.
 * Clones baseline commit afa46cd into an isolated temporary directory,
 * computes the pre-run cryptographic fingerprint, verifies the baseline
 * test suite is green (111 passed, 0 failed), and emits the slice manifest.
 *
 * ARCHITECTURAL INVARIANT: Uses a held-out grader (bench/first-slice/spec.test.cjs)
 * that is never placed in candidate context. Only src/gates/detect.cjs is mutable.
 * STRICT INVARIANT: This script does NOT invoke any LLM or model.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const BASELINE_COMMIT = 'afa46cd68b1a2a616f5daff0ad2ba737ec9997d2';
const SHORT_COMMIT = 'afa46cd';
const HELD_OUT_SPEC_REL = 'bench/first-slice/spec.test.cjs';

const FIRST_SLICE_MANIFEST = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  document_type: 'FIRST_SLICE_MANIFEST_V1',
  schema_version: '1.0.0',
  task_id: 'TASK-IB02-ESLINT-DETECT',
  blocker_id: 'IB-02',
  title: 'ESLint Detection in Gate Detection',
  specification_path: 'docs/FIRST_SLICE.md',
  grader_type: 'HELD_OUT',
  held_out_spec_path: HELD_OUT_SPEC_REL,
  baseline: {
    repository: 'https://github.com/alhamzahabdulazeez/tandem.git',
    commit: BASELINE_COMMIT,
    short_commit: SHORT_COMMIT,
    runtime: 'node>=22',
    module_type: 'commonjs',
    expected_tests_passed: 111,
    expected_tests_failed: 0,
    files: [
      {
        path: 'src/gates/detect.cjs',
        sha256: '6e1f60865e8b4e4641b2bc8e43ef97722b161af18fcb16d576ad8f2d3ca6140a',
        bytes: 2815,
        role: 'MUTABLE_SOURCE'
      },
      {
        path: 'test/run.cjs',
        sha256: 'd675a1d938a6a49fce8b8875e2de281ee5aa5f5262a88b6735712ee0bfc33378',
        bytes: 29703,
        role: 'IMMUTABLE_TEST'
      },
      {
        path: 'package.json',
        sha256: '1fd9fd813aa8c192b82c14c5f470ebc3a7f0a1963d4bf39a0a363ef8fc7fd282',
        bytes: 798,
        role: 'IMMUTABLE_DESCRIPTOR'
      }
    ]
  },
  scope: {
    allowed_files: [
      'src/gates/detect.cjs'
    ],
    disallowed_files: [
      'test/run.cjs',
      'package.json',
      'package-lock.json',
      'bin/**',
      'bench/**',
      'src/core/**',
      'src/context/**',
      'src/adapter/**',
      'src/index.cjs'
    ]
  },
  verification: {
    stages: [
      {
        stage: 1,
        name: 'non_regression',
        recipe_command: 'node test/run.cjs',
        expected_exit_code: 0,
        expected_tests_passed: 111,
        expected_tests_failed: 0
      },
      {
        stage: 2,
        name: 'held_out_acceptance',
        recipe_command: 'node bench/first-slice/spec.test.cjs',
        expected_exit_code: 0,
        expected_tests_passed: 5,
        expected_tests_failed: 0
      }
    ],
    timeout_ms: 10000,
    allow_network: false,
    expected_exit_code: 0
  },
  acceptance_predicates: [
    'P1: Baseline commit afa46cd is clean and passes 111/0 tests prior to candidate run',
    'P2: Syntax across all repository files is valid CommonJS under Node.js >=22',
    'P3: Candidate mutations are strictly confined to src/gates/detect.cjs; test/run.cjs is untouched',
    'P4: Stage 1 baseline regression test passes exactly 111/0 tests with exit code 0',
    'P5: Stage 2 held-out grader passes exactly 5/0 tests with exit code 0 within timeout'
  ],
  baseline_failure_policy: {
    action: 'FAIL_CLOSED',
    admit_candidate: false,
    diagnostic: 'BASELINE_NON_GREEN'
  }
});

function getSliceManifest() {
  return JSON.parse(JSON.stringify(FIRST_SLICE_MANIFEST));
}

function computeFileDigest(filePath) {
  const buf = fs.readFileSync(filePath);
  return {
    sha256: crypto.createHash('sha256').update(buf).digest('hex'),
    bytes: buf.length
  };
}

function computePreRunFingerprint(targetDir, files = FIRST_SLICE_MANIFEST.baseline.files) {
  const fileDigests = {};
  for (const f of files) {
    const full = path.join(targetDir, f.path);
    if (fs.existsSync(full)) {
      fileDigests[f.path] = computeFileDigest(full);
    } else {
      fileDigests[f.path] = { missing: true };
    }
  }

  let gitCommit = null;
  let isClean = false;
  try {
    gitCommit = execSync('git rev-parse HEAD', { cwd: targetDir, encoding: 'utf8' }).trim();
    const status = execSync('git status --porcelain', { cwd: targetDir, encoding: 'utf8' }).trim();
    isClean = status.length === 0;
  } catch {
    // Non-git directory or probe error
  }

  return {
    timestamp: new Date().toISOString(),
    gitCommit,
    isClean,
    fileDigests
  };
}

function verifyBaseline(targetDir, timeoutMs = 15000) {
  const res = spawnSync(process.execPath, ['test/run.cjs'], {
    cwd: targetDir,
    timeout: timeoutMs,
    encoding: 'utf8',
    env: { ...process.env }
  });

  const stdout = res.stdout || '';
  const stderr = res.stderr || '';
  const exitCode = res.status;

  const match = stdout.match(/(\d+)\s+passed,\s+(\d+)\s+failed/);
  const passed = match ? parseInt(match[1], 10) : 0;
  const failed = match ? parseInt(match[2], 10) : (exitCode === 0 ? 0 : 1);

  const isGreen = exitCode === 0 && passed === 111 && failed === 0;

  return {
    isGreen,
    exitCode,
    passed,
    failed,
    stdout,
    stderr,
    error: isGreen ? null : 'BASELINE_NON_GREEN'
  };
}

function verifyMutationScope(targetDir, allowedFiles = FIRST_SLICE_MANIFEST.scope.allowed_files, baseCommit = BASELINE_COMMIT) {
  let changedFiles = [];
  try {
    const diffOutput = execSync(`git diff --name-only ${baseCommit}`, {
      cwd: targetDir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    const untrackedOutput = execSync('git ls-files --others --exclude-standard', {
      cwd: targetDir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    const diffList = diffOutput ? diffOutput.split('\n').map(s => s.trim()).filter(Boolean) : [];
    const untrackedList = untrackedOutput ? untrackedOutput.split('\n').map(s => s.trim()).filter(Boolean) : [];

    const allModified = Array.from(new Set([...diffList, ...untrackedList]));
    changedFiles = allModified.filter(f => f !== 'node_modules' && !f.startsWith('node_modules/') && !f.startsWith('.git/'));
  } catch (err) {
    return {
      valid: false,
      changedFiles: [],
      allowedFiles,
      disallowedFiles: [],
      error: 'SCOPE_CHECK_FAILED',
      message: err.message
    };
  }

  const disallowedFiles = changedFiles.filter(file => !allowedFiles.includes(file));
  const valid = disallowedFiles.length === 0;

  return {
    valid,
    changedFiles,
    allowedFiles,
    disallowedFiles,
    error: valid ? null : 'DISALLOWED_MUTATION_TEST_TAMPERING'
  };
}

function verifyHeldOutGrader(targetDir, specPath = path.join(REPO_ROOT, HELD_OUT_SPEC_REL), timeoutMs = 10000) {
  const res = spawnSync(process.execPath, [specPath, targetDir], {
    timeout: timeoutMs,
    encoding: 'utf8',
    env: { ...process.env }
  });

  const stdout = res.stdout || '';
  const stderr = res.stderr || '';
  const exitCode = res.status;

  const match = stdout.match(/(\d+)\s+passed,\s+(\d+)\s+failed/);
  const passed = match ? parseInt(match[1], 10) : 0;
  const failed = match ? parseInt(match[2], 10) : (exitCode === 0 ? 0 : 1);

  const isGreen = exitCode === 0 && passed === 5 && failed === 0;

  return {
    isGreen,
    exitCode,
    passed,
    failed,
    stdout,
    stderr,
    error: isGreen ? null : 'HELD_OUT_SPEC_FAILED'
  };
}

function evaluateFirstSlice(targetDir, options = {}) {
  const allowedFiles = options.allowedFiles || FIRST_SLICE_MANIFEST.scope.allowed_files;
  const baseCommit = options.baseCommit || BASELINE_COMMIT;

  // 1. Verify mutation scope boundary first
  const scopeResult = verifyMutationScope(targetDir, allowedFiles, baseCommit);
  if (!scopeResult.valid) {
    return {
      ok: false,
      stage: 'scope_fencing',
      error: scopeResult.error,
      scopeResult,
      stage1: null,
      stage2: null,
      verdict: 'FAILED'
    };
  }

  // 2. Stage 1: Non-regression baseline verification
  const stage1 = verifyBaseline(targetDir, options.stage1TimeoutMs || 15000);
  if (!stage1.isGreen) {
    return {
      ok: false,
      stage: 'stage1_non_regression',
      error: stage1.error || 'STAGE_1_FAILED',
      scopeResult,
      stage1,
      stage2: null,
      verdict: 'FAILED'
    };
  }

  // 3. Stage 2: Held-out acceptance grader
  const specPath = options.specPath || path.join(REPO_ROOT, HELD_OUT_SPEC_REL);
  const stage2 = verifyHeldOutGrader(targetDir, specPath, options.stage2TimeoutMs || 10000);
  if (!stage2.isGreen) {
    return {
      ok: false,
      stage: 'stage2_held_out_acceptance',
      error: stage2.error || 'STAGE_2_FAILED',
      scopeResult,
      stage1,
      stage2,
      verdict: 'FAILED'
    };
  }

  return {
    ok: true,
    stage: 'complete',
    error: null,
    scopeResult,
    stage1,
    stage2,
    verdict: 'PASSED'
  };
}

function prepareFirstSlice(options = {}) {
  const repoRoot = options.repoRoot || REPO_ROOT;
  const targetCommit = options.targetCommit || BASELINE_COMMIT;
  const keepWorkDir = Boolean(options.keepWorkDir);
  const nodeModulesSource = options.nodeModulesSource || path.join(repoRoot, 'node_modules');

  let workDir = options.workDir;
  let createdWorkDir = false;

  if (!workDir) {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-first-slice-'));
    createdWorkDir = true;
  }

  try {
    // 1. Clone repository
    execSync(`git clone --no-hardlinks "${repoRoot}" "${workDir}"`, { stdio: 'pipe' });
    execSync(`git checkout ${targetCommit}`, { cwd: workDir, stdio: 'pipe' });

    // 2. Link node_modules if present in source repo
    if (fs.existsSync(nodeModulesSource)) {
      const destModules = path.join(workDir, 'node_modules');
      if (!fs.existsSync(destModules)) {
        try {
          fs.symlinkSync(nodeModulesSource, destModules);
        } catch {
          // Fallback or permission limitation
        }
      }
    }

    // 3. Capture pre-run fingerprint
    const fingerprint = computePreRunFingerprint(workDir);

    // 4. Verify baseline test suite
    const baselineResult = verifyBaseline(workDir);

    if (!baselineResult.isGreen) {
      const err = new Error(`Baseline verification failed at commit ${targetCommit}: ${baselineResult.passed} passed, ${baselineResult.failed} failed, exit code ${baselineResult.exitCode}`);
      err.code = 'BASELINE_NON_GREEN';
      err.baselineResult = baselineResult;
      err.fingerprint = fingerprint;
      err.workDir = workDir;
      throw err;
    }

    const result = {
      ok: true,
      workDir,
      targetCommit,
      preRunFingerprint: fingerprint,
      baseline: {
        passed: baselineResult.passed,
        failed: baselineResult.failed,
        exitCode: baselineResult.exitCode
      },
      manifest: getSliceManifest()
    };

    return result;
  } finally {
    if (createdWorkDir && !keepWorkDir) {
      try {
        fs.rmSync(workDir, { recursive: true, force: true });
      } catch {
        // Temp cleanup error
      }
    }
  }
}

// CLI Execution Entrypoint
if (require.main === module) {
  const args = process.argv.slice(2);
  const isJson = args.includes('--json');
  const keepWorkDir = args.includes('--keep');
  const evalIdx = args.indexOf('--evaluate');
  const verifyIdx = args.indexOf('--verify');
  const targetIdx = evalIdx !== -1 ? evalIdx : verifyIdx;

  if (targetIdx !== -1 && args[targetIdx + 1]) {
    const targetDir = path.resolve(args[targetIdx + 1]);
    const evalResult = evaluateFirstSlice(targetDir);
    if (isJson) {
      console.log(JSON.stringify(evalResult, null, 2));
    } else {
      console.log('TANDEM IB-02 First-Slice Evaluation (Scope & Two-Stage Grader)\n');
      console.log(`  Overall Verdict:  ${evalResult.verdict}`);
      console.log(`  Scope Valid:      ${evalResult.scopeResult.valid} (${evalResult.scopeResult.changedFiles.join(', ') || 'no changes'})`);
      if (evalResult.scopeResult.disallowedFiles.length > 0) {
        console.log(`  Disallowed Files: ${evalResult.scopeResult.disallowedFiles.join(', ')}`);
      }
      if (evalResult.stage1) {
        console.log(`  Stage 1 (Regr):   ${evalResult.stage1.isGreen ? 'PASS' : 'FAIL'} (${evalResult.stage1.passed} passed, ${evalResult.stage1.failed} failed)`);
      }
      if (evalResult.stage2) {
        console.log(`  Stage 2 (Grader): ${evalResult.stage2.isGreen ? 'PASS' : 'FAIL'} (${evalResult.stage2.passed} passed, ${evalResult.stage2.failed} failed)`);
      }
      if (evalResult.error) {
        console.log(`  Error (${evalResult.stage}): ${evalResult.error}`);
      }
    }
    process.exit(evalResult.ok ? 0 : 1);
  }

  try {
    const result = prepareFirstSlice({ keepWorkDir });
    if (isJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('TANDEM IB-02 First-Slice Preparation (Held-Out Grader)\n');
      console.log(`  Baseline Commit:  ${result.targetCommit} (${SHORT_COMMIT})`);
      console.log(`  Baseline Status:  GREEN (${result.baseline.passed} passed, ${result.baseline.failed} failed)`);
      console.log(`  Pre-run Digest:   ${result.preRunFingerprint.gitCommit}`);
      console.log(`  Task ID:          ${result.manifest.task_id}`);
      console.log(`  Allowed Files:    ${result.manifest.scope.allowed_files.join(', ')}`);
      console.log(`  Grader Model:     HELD_OUT (${result.manifest.held_out_spec_path})`);
      console.log(`  Stage 1 Command:  ${result.manifest.verification.stages[0].recipe_command}`);
      console.log(`  Stage 2 Command:  ${result.manifest.verification.stages[1].recipe_command}`);
      console.log('\nSlice manifest ready for execution. (Zero models invoked)');
    }
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    if (err.baselineResult) {
      console.error(`Baseline exit code: ${err.baselineResult.exitCode}`);
      console.error(`Stdout: ${err.baselineResult.stdout}`);
      console.error(`Stderr: ${err.baselineResult.stderr}`);
    }
    process.exit(1);
  }
}

module.exports = {
  FIRST_SLICE_MANIFEST,
  BASELINE_COMMIT,
  SHORT_COMMIT,
  HELD_OUT_SPEC_REL,
  getSliceManifest,
  computeFileDigest,
  computePreRunFingerprint,
  verifyBaseline,
  verifyMutationScope,
  verifyHeldOutGrader,
  evaluateFirstSlice,
  prepareFirstSlice
};
