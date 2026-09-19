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

const FIRST_SLICE_MANIFEST = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  document_type: 'FIRST_SLICE_MANIFEST_V1',
  schema_version: '1.0.0',
  task_id: 'TASK-IB02-ESLINT-DETECT',
  blocker_id: 'IB-02',
  title: 'ESLint Detection in Gate Detection',
  specification_path: 'docs/FIRST_SLICE.md',
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
        role: 'MUTABLE_TEST'
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
      'src/gates/detect.cjs',
      'test/run.cjs'
    ],
    disallowed_files: [
      'package.json',
      'package-lock.json',
      'bin/**',
      'src/core/**',
      'src/context/**',
      'src/adapter/**',
      'src/index.cjs'
    ]
  },
  verification: {
    recipe_command: 'node test/run.cjs',
    timeout_ms: 10000,
    allow_network: false,
    expected_exit_code: 0,
    expected_tests_passed: 112,
    expected_tests_failed: 0
  },
  acceptance_predicates: [
    'P1: Baseline commit afa46cd is clean and passes 111/0 tests prior to candidate run',
    'P2: Syntax across all repository files is valid CommonJS under Node.js >=22',
    'P3: No changes occur outside the allowed mutation scope (src/gates/detect.cjs and test/run.cjs)',
    'P4: No new dependencies or network access introduced',
    'P5: Post-mutation test suite passes exactly 112/0 tests with exit code 0 within 10,000ms'
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

  try {
    const result = prepareFirstSlice({ keepWorkDir });
    if (isJson) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('TANDEM IB-02 First-Slice Preparation\n');
      console.log(`  Baseline Commit:  ${result.targetCommit} (${SHORT_COMMIT})`);
      console.log(`  Baseline Status:  GREEN (${result.baseline.passed} passed, ${result.baseline.failed} failed)`);
      console.log(`  Pre-run Digest:   ${result.preRunFingerprint.gitCommit}`);
      console.log(`  Task ID:          ${result.manifest.task_id}`);
      console.log(`  Allowed Files:    ${result.manifest.scope.allowed_files.join(', ')}`);
      console.log(`  Native Recipe:    ${result.manifest.verification.recipe_command}`);
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
  getSliceManifest,
  computeFileDigest,
  computePreRunFingerprint,
  verifyBaseline,
  prepareFirstSlice
};
