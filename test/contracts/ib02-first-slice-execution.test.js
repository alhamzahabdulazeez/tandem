'use strict';
/**
 * test/contracts/ib02-first-slice-execution.test.js
 *
 * Contract test suite for IB-02 First-Slice execution preparation:
 *   1. Manifest shape and schema compliance
 *   2. Scope boundary constraints (mutable vs immutable files)
 *   3. Pre-run fingerprinting & SHA-256 digest computation
 *   4. Baseline-green verification (111 passed / 0 failed at afa46cd)
 *   5. Fail-closed policy on non-green baseline
 *   6. Zero-model invocation and qualification status invariants
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  FIRST_SLICE_MANIFEST,
  BASELINE_COMMIT,
  SHORT_COMMIT,
  getSliceManifest,
  computeFileDigest,
  computePreRunFingerprint,
  verifyBaseline,
  prepareFirstSlice
} = require('../../bin/first-slice.cjs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

module.exports = function run(t, group) {
  group('IB-02 First-Slice: Manifest Shape & Schema Invariants');

  t('manifest has required schema, task_id, and blocker_id fields', () => {
    const manifest = getSliceManifest();
    assert.strictEqual(manifest.document_type, 'FIRST_SLICE_MANIFEST_V1');
    assert.strictEqual(manifest.schema_version, '1.0.0');
    assert.strictEqual(manifest.task_id, 'TASK-IB02-ESLINT-DETECT');
    assert.strictEqual(manifest.blocker_id, 'IB-02');
    assert.strictEqual(manifest.title, 'ESLint Detection in Gate Detection');
    assert.strictEqual(manifest.specification_path, 'docs/FIRST_SLICE.md');
  });

  t('baseline anchor matches commit afa46cd and 111/0 expected tests', () => {
    const manifest = getSliceManifest();
    assert.strictEqual(manifest.baseline.commit, BASELINE_COMMIT);
    assert.strictEqual(manifest.baseline.short_commit, SHORT_COMMIT);
    assert.strictEqual(manifest.baseline.expected_tests_passed, 111);
    assert.strictEqual(manifest.baseline.expected_tests_failed, 0);
    assert.strictEqual(manifest.baseline.runtime, 'node>=22');
    assert.strictEqual(manifest.baseline.module_type, 'commonjs');
  });

  t('manifest files contain required digests and roles', () => {
    const manifest = getSliceManifest();
    assert.ok(Array.isArray(manifest.baseline.files));
    assert.strictEqual(manifest.baseline.files.length, 3);

    const detectFile = manifest.baseline.files.find(f => f.path === 'src/gates/detect.cjs');
    assert.ok(detectFile);
    assert.strictEqual(detectFile.role, 'MUTABLE_SOURCE');
    assert.strictEqual(detectFile.sha256, '6e1f60865e8b4e4641b2bc8e43ef97722b161af18fcb16d576ad8f2d3ca6140a');
    assert.strictEqual(detectFile.bytes, 2815);

    const testFile = manifest.baseline.files.find(f => f.path === 'test/run.cjs');
    assert.ok(testFile);
    assert.strictEqual(testFile.role, 'MUTABLE_TEST');
    assert.strictEqual(testFile.sha256, 'd675a1d938a6a49fce8b8875e2de281ee5aa5f5262a88b6735712ee0bfc33378');
    assert.strictEqual(testFile.bytes, 29703);

    const pkgFile = manifest.baseline.files.find(f => f.path === 'package.json');
    assert.ok(pkgFile);
    assert.strictEqual(pkgFile.role, 'IMMUTABLE_DESCRIPTOR');
  });

  t('scope strictly bounds mutable files and forbids package.json / core modification', () => {
    const manifest = getSliceManifest();
    assert.deepStrictEqual(manifest.scope.allowed_files, [
      'src/gates/detect.cjs',
      'test/run.cjs'
    ]);
    assert.ok(manifest.scope.disallowed_files.includes('package.json'));
    assert.ok(manifest.scope.disallowed_files.includes('src/core/**'));
    assert.ok(manifest.scope.disallowed_files.includes('src/index.cjs'));
  });

  t('verification recipe specifies zero-network execution and 112 expected passes', () => {
    const manifest = getSliceManifest();
    assert.strictEqual(manifest.verification.recipe_command, 'node test/run.cjs');
    assert.strictEqual(manifest.verification.allow_network, false);
    assert.strictEqual(manifest.verification.expected_exit_code, 0);
    assert.strictEqual(manifest.verification.expected_tests_passed, 112);
    assert.strictEqual(manifest.verification.expected_tests_failed, 0);
  });

  group('IB-02 First-Slice: Cryptographic Fingerprinting');

  t('computeFileDigest returns valid SHA-256 hex string and byte count', () => {
    const tmp = path.join(os.tmpdir(), `tandem-digest-test-${Date.now()}.txt`);
    try {
      fs.writeFileSync(tmp, 'hello world\n', 'utf8');
      const digest = computeFileDigest(tmp);
      assert.strictEqual(digest.sha256, 'a948904f2f0f479b8f8197694b30184b0d2ed1c1cd2a1ec0fb85d299a192a447');
      assert.strictEqual(digest.bytes, 12);
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
  });

  t('computePreRunFingerprint accurately reflects file digest map and git commit', () => {
    const fp = computePreRunFingerprint(REPO_ROOT);
    assert.ok(typeof fp.timestamp === 'string');
    assert.ok(typeof fp.gitCommit === 'string' && fp.gitCommit.length === 40);
    assert.ok(fp.fileDigests['src/gates/detect.cjs']);
    assert.ok(fp.fileDigests['test/run.cjs']);
    assert.ok(fp.fileDigests['package.json']);
  });

  group('IB-02 First-Slice: Baseline Verification & Fail-Closed Policy');

  t('verifyBaseline detects non-green exit on broken test directory', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-broken-test-'));
    try {
      fs.mkdirSync(path.join(tmpDir, 'test'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, 'test', 'run.cjs'),
        'console.log("100 passed, 2 failed"); process.exit(1);\n',
        'utf8'
      );
      const res = verifyBaseline(tmpDir, 5000);
      assert.strictEqual(res.isGreen, false);
      assert.strictEqual(res.passed, 100);
      assert.strictEqual(res.failed, 2);
      assert.strictEqual(res.exitCode, 1);
      assert.strictEqual(res.error, 'BASELINE_NON_GREEN');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  t('verifyBaseline rejects non-111 pass count even if exit code is 0', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-count-mismatch-'));
    try {
      fs.mkdirSync(path.join(tmpDir, 'test'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, 'test', 'run.cjs'),
        'console.log("110 passed, 0 failed"); process.exit(0);\n',
        'utf8'
      );
      const res = verifyBaseline(tmpDir, 5000);
      assert.strictEqual(res.isGreen, false);
      assert.strictEqual(res.passed, 110);
      assert.strictEqual(res.failed, 0);
      assert.strictEqual(res.error, 'BASELINE_NON_GREEN');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  t('prepareFirstSlice succeeds against clean afa46cd baseline checkout', () => {
    const result = prepareFirstSlice();
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.targetCommit, BASELINE_COMMIT);
    assert.strictEqual(result.baseline.passed, 111);
    assert.strictEqual(result.baseline.failed, 0);
    assert.strictEqual(result.baseline.exitCode, 0);
    assert.ok(result.preRunFingerprint);
    assert.strictEqual(result.preRunFingerprint.gitCommit, BASELINE_COMMIT);
    assert.strictEqual(result.manifest.task_id, 'TASK-IB02-ESLINT-DETECT');
  });

  group('IB-02 Qualification Status Invariants');

  t('docs/QUALIFICATION.md records IB-02 as OPEN (NOT QUALIFIED)', () => {
    const qualDoc = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'QUALIFICATION.md'), 'utf8');
    assert.ok(qualDoc.includes('IB-02'));
    assert.ok(qualDoc.includes('OPEN'));
    // Ensure IB-02 is NOT marked QUALIFIED
    const lines = qualDoc.split('\n');
    const ib02SummaryLine = lines.find(l => l.includes('**IB-02**') && l.includes('First-slice'));
    assert.ok(ib02SummaryLine, 'Summary table line for IB-02 found');
    assert.ok(ib02SummaryLine.includes('**OPEN**'), 'IB-02 summary status must be OPEN');
    assert.ok(!ib02SummaryLine.includes('**QUALIFIED**'), 'IB-02 must NOT be marked QUALIFIED');
  });

  t('docs/FIRST_SLICE.md records frozen specification and OPEN qualification state', () => {
    const specDoc = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'FIRST_SLICE.md'), 'utf8');
    assert.ok(specDoc.includes('FIRST_SLICE_SPEC_V1'));
    assert.ok(specDoc.includes('FROZEN'));
    assert.ok(specDoc.includes('Qualification State:** OPEN'));
    assert.ok(specDoc.includes('TASK-IB02-ESLINT-DETECT'));
  });
};
