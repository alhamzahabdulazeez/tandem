'use strict';
/**
 * test/contracts/ib02-first-slice-execution.test.js
 *
 * Contract test suite for IB-02 First-Slice execution preparation:
 *   1. Manifest shape and schema compliance (held-out grader architecture)
 *   2. Scope boundary constraints (only src/gates/detect.cjs mutable, test/run.cjs disallowed)
 *   3. Pre-run fingerprinting & SHA-256 digest computation
 *   4. Baseline-green verification (111 passed / 0 failed at afa46cd)
 *   5. Held-out grader verification (5 test cases on ESLint detection)
 *   6. Fail-closed policy on non-green baseline or broken held-out spec
 *   7. Zero-model invocation and qualification status invariants
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
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
} = require('../../bin/first-slice.cjs');
const { Tandem } = require('../../src/index.cjs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

module.exports = function run(t, group) {
  group('IB-02 First-Slice: Manifest Shape & Held-Out Grader Invariants');

  t('manifest has required schema, task_id, blocker_id, and held-out grader fields', () => {
    const manifest = getSliceManifest();
    assert.strictEqual(manifest.document_type, 'FIRST_SLICE_MANIFEST_V1');
    assert.strictEqual(manifest.schema_version, '1.0.0');
    assert.strictEqual(manifest.task_id, 'TASK-IB02-ESLINT-DETECT');
    assert.strictEqual(manifest.blocker_id, 'IB-02');
    assert.strictEqual(manifest.title, 'ESLint Detection in Gate Detection');
    assert.strictEqual(manifest.specification_path, 'docs/FIRST_SLICE.md');
    assert.strictEqual(manifest.grader_type, 'HELD_OUT');
    assert.strictEqual(manifest.held_out_spec_path, 'bench/first-slice/spec.test.cjs');
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
    assert.strictEqual(testFile.role, 'IMMUTABLE_TEST');
    assert.strictEqual(testFile.sha256, 'd675a1d938a6a49fce8b8875e2de281ee5aa5f5262a88b6735712ee0bfc33378');
    assert.strictEqual(testFile.bytes, 29703);

    const pkgFile = manifest.baseline.files.find(f => f.path === 'package.json');
    assert.ok(pkgFile);
    assert.strictEqual(pkgFile.role, 'IMMUTABLE_DESCRIPTOR');
  });

  t('scope strictly bounds mutable files to src/gates/detect.cjs only and disallows test/run.cjs', () => {
    const manifest = getSliceManifest();
    assert.deepStrictEqual(manifest.scope.allowed_files, [
      'src/gates/detect.cjs'
    ]);
    assert.ok(manifest.scope.disallowed_files.includes('test/run.cjs'), 'test/run.cjs must be disallowed');
    assert.ok(manifest.scope.disallowed_files.includes('package.json'));
    assert.ok(manifest.scope.disallowed_files.includes('bench/**'));
    assert.ok(manifest.scope.disallowed_files.includes('src/core/**'));
    assert.ok(manifest.scope.disallowed_files.includes('src/index.cjs'));
  });

  t('verification recipe specifies two-stage execution with held-out grader', () => {
    const manifest = getSliceManifest();
    assert.ok(Array.isArray(manifest.verification.stages));
    assert.strictEqual(manifest.verification.stages.length, 2);

    const stage1 = manifest.verification.stages[0];
    assert.strictEqual(stage1.stage, 1);
    assert.strictEqual(stage1.name, 'non_regression');
    assert.strictEqual(stage1.recipe_command, 'node test/run.cjs');
    assert.strictEqual(stage1.expected_exit_code, 0);
    assert.strictEqual(stage1.expected_tests_passed, 111);
    assert.strictEqual(stage1.expected_tests_failed, 0);

    const stage2 = manifest.verification.stages[1];
    assert.strictEqual(stage2.stage, 2);
    assert.strictEqual(stage2.name, 'held_out_acceptance');
    assert.strictEqual(stage2.recipe_command, 'node bench/first-slice/spec.test.cjs');
    assert.strictEqual(stage2.expected_exit_code, 0);
    assert.strictEqual(stage2.expected_tests_passed, 5);
    assert.strictEqual(stage2.expected_tests_failed, 0);

    assert.strictEqual(manifest.verification.allow_network, false);
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

  t('verifyHeldOutGrader correctly evaluates modified vs unmodified targets', () => {
    // 1. Unmodified target (baseline) fails held-out spec because eslint detection is not implemented
    const baselineRes = verifyHeldOutGrader(REPO_ROOT);
    assert.strictEqual(baselineRes.isGreen, false, 'Unmodified baseline must fail held-out grader');
    assert.strictEqual(baselineRes.failed > 0, true);

    // 2. Mock directory with implemented eslint detection passes held-out spec
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-mock-green-'));
    try {
      fs.mkdirSync(path.join(tmpDir, 'src', 'gates'), { recursive: true });
      const origSrc = fs.readFileSync(path.join(REPO_ROOT, 'src', 'gates', 'detect.cjs'), 'utf8');
      const modifiedSrc = origSrc.replace(
        "if (hasDep(m, '@biomejs/biome')) return { available: true, command: 'npx biome check --reporter=json .', reason: null };",
        "if (hasDep(m, '@biomejs/biome')) return { available: true, command: 'npx biome check --reporter=json .', reason: null };\n  if (hasDep(m, 'eslint')) return { available: true, command: 'npx eslint --format json .', reason: null };"
      );
      fs.writeFileSync(path.join(tmpDir, 'src', 'gates', 'detect.cjs'), modifiedSrc, 'utf8');

      const mockRes = verifyHeldOutGrader(tmpDir);
      assert.strictEqual(mockRes.isGreen, true, 'Implemented candidate must pass held-out grader');
      assert.strictEqual(mockRes.passed, 5);
      assert.strictEqual(mockRes.failed, 0);
      assert.strictEqual(mockRes.exitCode, 0);
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
    assert.strictEqual(result.manifest.grader_type, 'HELD_OUT');
  });

  group('IB-02 First-Slice: Mutation Scope Fencing & Disallowed Mutation Refusal');

  t('verifyMutationScope accepts mutations strictly within allowed files (src/gates/detect.cjs)', () => {
    const prep = prepareFirstSlice({ keepWorkDir: true });
    try {
      // Mutate only src/gates/detect.cjs
      const detectPath = path.join(prep.workDir, 'src', 'gates', 'detect.cjs');
      const orig = fs.readFileSync(detectPath, 'utf8');
      fs.writeFileSync(detectPath, orig + '\n// scope test comment\n', 'utf8');

      const scope = verifyMutationScope(prep.workDir);
      assert.strictEqual(scope.valid, true, 'Mutation in allowed file must be valid');
      assert.strictEqual(scope.error, null);
      assert.deepStrictEqual(scope.changedFiles, ['src/gates/detect.cjs']);
      assert.deepStrictEqual(scope.disallowedFiles, []);
    } finally {
      fs.rmSync(prep.workDir, { recursive: true, force: true });
    }
  });

  t('verifyMutationScope rejects mutations to test/run.cjs with DISALLOWED_MUTATION_TEST_TAMPERING', () => {
    const prep = prepareFirstSlice({ keepWorkDir: true });
    try {
      // Tamper with test/run.cjs
      const testPath = path.join(prep.workDir, 'test', 'run.cjs');
      const orig = fs.readFileSync(testPath, 'utf8');
      fs.writeFileSync(testPath, orig + '\n// tampering with test suite\n', 'utf8');

      const scope = verifyMutationScope(prep.workDir);
      assert.strictEqual(scope.valid, false, 'Tampering with test/run.cjs must be rejected');
      assert.strictEqual(scope.error, 'DISALLOWED_MUTATION_TEST_TAMPERING');
      assert.ok(scope.disallowedFiles.includes('test/run.cjs'));
    } finally {
      fs.rmSync(prep.workDir, { recursive: true, force: true });
    }
  });

  t('verifyMutationScope rejects untracked and outside files with DISALLOWED_MUTATION_TEST_TAMPERING', () => {
    const prep = prepareFirstSlice({ keepWorkDir: true });
    try {
      // Add an untracked file outside allowed list
      const untrackedPath = path.join(prep.workDir, 'test', 'new-test.cjs');
      fs.writeFileSync(untrackedPath, 'console.log("untracked");\n', 'utf8');

      const scope = verifyMutationScope(prep.workDir);
      assert.strictEqual(scope.valid, false, 'Untracked files outside allowed scope must be rejected');
      assert.strictEqual(scope.error, 'DISALLOWED_MUTATION_TEST_TAMPERING');
      assert.ok(scope.disallowedFiles.includes('test/new-test.cjs'));
    } finally {
      fs.rmSync(prep.workDir, { recursive: true, force: true });
    }
  });

  t('evaluateFirstSlice fails closed immediately on scope violation before Stage 1 / Stage 2 execution', () => {
    const prep = prepareFirstSlice({ keepWorkDir: true });
    try {
      // Modify test/run.cjs (disallowed)
      const testPath = path.join(prep.workDir, 'test', 'run.cjs');
      const origTest = fs.readFileSync(testPath, 'utf8');
      fs.writeFileSync(testPath, origTest + '\n// disallowed test mutation\n', 'utf8');

      const evalRes = evaluateFirstSlice(prep.workDir);
      assert.strictEqual(evalRes.ok, false);
      assert.strictEqual(evalRes.verdict, 'FAILED');
      assert.strictEqual(evalRes.stage, 'scope_fencing');
      assert.strictEqual(evalRes.error, 'DISALLOWED_MUTATION_TEST_TAMPERING');
      assert.strictEqual(evalRes.stage1, null, 'Stage 1 must not be executed when scope check fails');
      assert.strictEqual(evalRes.stage2, null, 'Stage 2 must not be executed when scope check fails');
    } finally {
      fs.rmSync(prep.workDir, { recursive: true, force: true });
    }
  });

  t('beforeTool blocks write and edit to test/run.cjs when allow-list is src/gates/detect.cjs only (options)', () => {
    const tandem = new Tandem(REPO_ROOT, 'test-model', {}, { allowedFiles: ['src/gates/detect.cjs'] });
    tandem.sessionStart();

    // 1. Attempt write to test/run.cjs
    const writeVerdict = tandem.beforeTool({
      tool: 'write',
      name: 'write',
      kind: 'write',
      file_path: 'test/run.cjs',
      content: '// unauthorized edit'
    });
    assert.strictEqual(writeVerdict.block, true, 'Write to test/run.cjs must be blocked');
    assert.ok(writeVerdict.reason.includes('DISALLOWED_MUTATION'));
    assert.ok(writeVerdict.reason.includes('test/run.cjs is outside allowed slice scope'));

    // 2. Attempt edit to test/run.cjs
    const editVerdict = tandem.beforeTool({
      tool: 'edit',
      name: 'edit',
      kind: 'edit',
      file_path: 'test/run.cjs',
      old_string: 'foo',
      new_string: 'bar'
    });
    assert.strictEqual(editVerdict.block, true, 'Edit to test/run.cjs must be blocked');
    assert.ok(editVerdict.reason.includes('DISALLOWED_MUTATION'));

    // 3. Attempt write to src/gates/detect.cjs (allowed)
    const allowedVerdict = tandem.beforeTool({
      tool: 'write',
      name: 'write',
      kind: 'write',
      file_path: 'src/gates/detect.cjs',
      content: '// allowed edit'
    });
    assert.strictEqual(allowedVerdict.block, false, 'Write to src/gates/detect.cjs must be permitted');
  });

  t('beforeTool blocks write to test/run.cjs when allow-list is set via TANDEM_ALLOWED_FILES env var', () => {
    const prevEnv = process.env.TANDEM_ALLOWED_FILES;
    process.env.TANDEM_ALLOWED_FILES = 'src/gates/detect.cjs';
    try {
      const tandem = new Tandem(REPO_ROOT, 'test-model');
      tandem.sessionStart();

      const verdict = tandem.beforeTool({
        tool: 'write',
        name: 'write',
        kind: 'write',
        file_path: 'test/run.cjs',
        content: '// unauthorized edit'
      });
      assert.strictEqual(verdict.block, true, 'Write to test/run.cjs must be blocked via env allow-list');
      assert.ok(verdict.reason.includes('DISALLOWED_MUTATION'));
      assert.ok(verdict.reason.includes('test/run.cjs is outside allowed slice scope'));

      const allowedVerdict = tandem.beforeTool({
        tool: 'write',
        name: 'write',
        kind: 'write',
        file_path: 'src/gates/detect.cjs',
        content: '// allowed edit'
      });
      assert.strictEqual(allowedVerdict.block, false, 'Write to src/gates/detect.cjs must be permitted');
    } finally {
      if (prevEnv === undefined) delete process.env.TANDEM_ALLOWED_FILES;
      else process.env.TANDEM_ALLOWED_FILES = prevEnv;
    }
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

  t('docs/FIRST_SLICE.md records frozen specification, held-out grader, and OPEN qualification state', () => {
    const specDoc = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'FIRST_SLICE.md'), 'utf8');
    assert.ok(specDoc.includes('FIRST_SLICE_SPEC_V1'));
    assert.ok(specDoc.includes('FROZEN'));
    assert.ok(specDoc.includes('Qualification State:** OPEN'));
    assert.ok(specDoc.includes('TASK-IB02-ESLINT-DETECT'));
    assert.ok(specDoc.includes('bench/first-slice/spec.test.cjs'));
    assert.ok(specDoc.includes('test/run.cjs'));
    assert.ok(specDoc.includes('Held-Out Grader'));
  });
};
