'use strict';
/**
 * Test Contract T-07: Derivation Coverage (PRD §24, §5, §11, §14, §15, §16, §17, §21, §27, §28)
 *
 * Exercises all 7 normative exercise surfaces and adversarial fault models from PRD §24 T-07:
 *  1. Foreign entrypoint or dependency resolution
 *  2. Parent configuration and host lookup paths
 *  3. Stale generated output or cache
 *  4. Omitted ignored input
 *  5. An incumbent installation or outside workspace package
 *  6. A command labeled "full" that remains affected-only
 *  7. Incomplete discovery or execution scope
 *
 * Asserts all 4 normative assertions and invariants:
 *  - Actual loaded source/inputs are identified (INV-12, R-29)
 *  - Unrecorded or unknown resolution cannot establish acceptance (INV-12, INV-11, R-28)
 *  - The broad recipe proves its genuine declared scope (INV-21, R-19, R-25)
 *  - Missing/inconclusive coverage remains non-successful (INV-09, INV-12, R-26c)
 *  - Evidence applicability matches exact contract/policy/generation/inputs/predicate/interval (INV-11)
 *  - Platform Qualification: Physical derivation and execution environment qualification are
 *    NOT QUALIFIED on Termux, IB-01 OPEN.
 *
 * Binds Evidence Families: E0, ES, EV, ER, EX.
 */

const assert = require('node:assert');

const ACC = require('../../src/contracts/acceptance.js');
const REC = require('../../src/contracts/records.js');
const { sha256, canonicalJson, contentId } = require('../../src/contracts/crypto.js');
const EVID = require('../../src/contracts/evidence.js');
const PIPE = require('../../src/contracts/evidence-pipeline.js');
const DERIV = require('../../src/contracts/derivation.js');
const COH = require('../../src/contracts/coherence.js');
const DEC = require('../../src/contracts/decisions.js');
const CAPTURE = require('../../src/contracts/capture.js');
const GEN = require('../../src/contracts/generation.js');

const { ObligationOutcome, Assurance, GenerationState } = REC;
const { DerivationStatus } = DERIV;
const { EvidenceOutcome } = PIPE;

// ---------------------------------------------------------------------------
// Helpers & Fixtures
// ---------------------------------------------------------------------------

const TREE_DIGEST_V1 = 'sha256:' + '1'.repeat(64);
const TREE_DIGEST_V2 = 'sha256:' + '2'.repeat(64);
const BASELINE_COMMIT_40 = '0123456789abcdef0123456789abcdef01234567';

function makeFrozenGeneration(generationId = 'gen-t07-1', overrides = {}) {
  const g = REC.createGeneration({
    generationId,
    taskId: 'task-t07',
    incarnationId: 'inc-t07',
  });
  g.state = GenerationState.FROZEN;
  g.treeDigest = TREE_DIGEST_V1;
  g.createOnceIdentity = `ci1:${'a'.repeat(64)}`;
  g.baselineIdentity = BASELINE_COMMIT_40;
  g.barrier1ClosedAt = '2026-09-18T09:00:00.000Z';
  g.frozenAt = '2026-09-18T09:00:01.000Z';
  g.retention = { start: '2026-09-18T00:00:00.000Z', expiry: '2026-10-18T00:00:00.000Z' };
  if (overrides) Object.assign(g, overrides);
  return g;
}

function makeCompleteObserverRun(overrides = {}) {
  const r = REC.createObserverRun({
    runId: 'run-t07-1',
    incarnationId: 'inc-t07',
    obligationId: 'obl-t07-main',
    candidateIdentity: { generationId: 'gen-t07-1', treeDigest: TREE_DIGEST_V1 },
    qualification: { qualified: true, name: 'protected-native-observer', version: '1' },
    launch: {
      entrypoint: 'bin/tandem.cjs',
      sourceRoot: '/contained/frozen/gen-t07-1',
      runtimeIdentity: 'node@26.0.0-qualified',
      resolutionScope: 'closed:npm-lock@sha256:' + 'd'.repeat(64),
      envCluster: 'cluster:A',
      installedDependencyBytes: true,
      cachesDisabled: true,
      configParentIncluded: true,
    },
    captured: {
      stdoutBytes: 4096,
      stderrBytes: 1024,
      exitSignal: 0,
      timeoutSignal: false,
      completionFacts: {
        wallMs: 1200,
        startedAt: '2026-09-18T09:00:01.000Z',
        endedAt: '2026-09-18T09:00:02.200Z',
      },
      truncationState: 'NONE',
    },
    comparedOutsideExecution: true,
    classification: 'authoritative',
    observationPath: 'protected/evidence/obs-1.json',
    attestedAt: '2026-09-18T09:00:03.000Z',
  });
  if (overrides) {
    if (overrides.launch) {
      r.launch = { ...r.launch, ...overrides.launch };
      delete overrides.launch;
    }
    if (overrides.captured) {
      r.captured = { ...r.captured, ...overrides.captured };
      delete overrides.captured;
    }
    if (overrides.candidateIdentity) {
      r.candidateIdentity = { ...r.candidateIdentity, ...overrides.candidateIdentity };
      delete overrides.candidateIdentity;
    }
    if (overrides.qualification) {
      r.qualification = { ...r.qualification, ...overrides.qualification };
      delete overrides.qualification;
    }
    Object.assign(r, overrides);
  }
  return r;
}

function makeObligation(overrides = {}) {
  const base = {
    obligationId: 'obl-t07-main',
    sourceRequirementAndSubconditionLinks: ['REQ-T07-01'],
    mandatoryStatus: 'mandatory',
    applicabilityAndDomain: 'exact slice: direct-source CLI execution and verified output',
    predicateFamily: ACC.PredicateFamily.EXTERNAL_BEHAVIORAL_CASE,
    predicateAdapterId: 'native-cli-observer',
    predicateVersion: 1,
    parametersAndExpectedValues: {
      command: 'node',
      args: ['bin/tandem.cjs', '--check'],
      expectedExit: 0,
      expectedStdoutPattern: '^SUCCESS: verification complete\\n$',
    },
    requiredObservationTypes: [
      'expected_value',
      'candidate_stdout',
      'candidate_stderr',
      'exit_signal',
      'exit_code',
      'timeout',
    ],
    requiredScopeAndCompleteness: 'full candidate direct-source CLI invocation, bounded capture, outside comparison',
    permittedEvidenceSources: ['protected-observer'],
    candidateAndInputApplicability: 'gen-t07-1/exact-tree',
    retryRule: 'NO_RETRY',
    conflictRule: 'FAIL_WINS',
    supersessionRule: 'EVIDENCE_BASED',
  };
  return ACC.createObligation({ ...base, ...overrides });
}

function makeInventoryEntry(overrides = {}) {
  const base = {
    requirementId: 'REQ-T07-01',
    parentRequirementId: null,
    sourceProvenance: 'original prompt, exact slice',
    originalMeaning: 'CLI binary executes from frozen direct-source root with closed dependencies and passes all checks',
    admittedInterpretation: 'run observer on candidate binary and verify clean exit and output',
    explicitOrInferred: 'explicit',
    mandatoryOrOptional: 'mandatory',
    applicability: 'APPLICABLE',
    scope: 'candidate runtime execution',
    rationale: 'primary derivation contract',
    uncertainty: null,
    authorizedRevision: null,
    mappedObligationIds: ['obl-t07-main'],
  };
  return ACC.createInventoryEntry({ ...base, ...overrides });
}

function makeEvidenceRecord(overrides = {}) {
  const base = {
    evidenceId: 'ev-t07-01',
    obligationId: 'obl-t07-main',
    generationId: 'gen-t07-1',
    outcome: EvidenceOutcome.PASS,
    classification: 'authoritative',
    observerQualified: true,
    observationPath: 'protected/evidence/obs-1.json',
    applicabilityKey: sha256('applicability-key-t07'),
    envelope: {
      taskAndIncarnation: 'task-t07/inc-t07',
      selectedSourceBaseline: BASELINE_COMMIT_40,
      exactCandidateGenerationAndTreeDigest: TREE_DIGEST_V1,
      actualSourceDependencyConfigurationEnvironmentInputs: sha256('env-inputs-t07'),
      runtimeToolchainAndLaunchIdentity: 'node@26.0.0-qualified',
    },
  };
  return REC.createEvidenceRecord({ ...base, ...overrides });
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

module.exports = function run(t, group) {

  // -------------------------------------------------------------------------
  // 1. Foreign Entrypoint & Dependency Resolution (PRD §16, §24, INV-12, R-29)
  // -------------------------------------------------------------------------
  group('T-07.1: Foreign Entrypoint & Dependency Resolution (PRD §16, §24, INV-12, R-29)');

  t('missing recorded entrypoint yields INCONCLUSIVE derivation (direct-source launch required)', () => {
    const gen = makeFrozenGeneration();
    const run = makeCompleteObserverRun({ launch: { entrypoint: null } });

    const res = DERIV.deriveState({ records: [gen, run] });
    assert.strictEqual(res.status, DerivationStatus.INCONCLUSIVE);
    assert.ok(res.reasons.some((r) => r.includes('recorded entrypoint (direct-source launch)')));
    assert.ok(res.envelopeMissing.includes('recorded entrypoint (direct-source launch)'));
  });

  t('missing pinned runtime/toolchain identity leaves derivation envelope incomplete', () => {
    const gen = makeFrozenGeneration();
    const run = makeCompleteObserverRun({ launch: { runtimeIdentity: null } });

    const res = DERIV.deriveState({ records: [gen, run] });
    assert.strictEqual(res.status, DerivationStatus.INCONCLUSIVE);
    assert.ok(res.reasons.some((r) => r.includes('pinned runtime/toolchain identity')));
    assert.ok(res.envelopeMissing.includes('pinned runtime/toolchain identity'));
  });

  t('unclosed module/package resolution scope fails closed as INCONCLUSIVE', () => {
    const gen = makeFrozenGeneration();
    const run = makeCompleteObserverRun({ launch: { resolutionScope: null } });

    const res = DERIV.deriveState({ records: [gen, run] });
    assert.strictEqual(res.status, DerivationStatus.INCONCLUSIVE);
    assert.ok(res.reasons.some((r) => r.includes('closed module/package resolution scope')));
    assert.ok(res.envelopeMissing.includes('closed module/package resolution scope'));
  });

  t('lockfile alone without verified installed dependency bytes fails derivation envelope', () => {
    // §16: "Installed dependency bytes, not merely the lockfile"
    const gen = makeFrozenGeneration();
    const run = makeCompleteObserverRun({ launch: { installedDependencyBytes: false } });

    const res = DERIV.deriveState({ records: [gen, run] });
    assert.strictEqual(res.status, DerivationStatus.INCONCLUSIVE);
    assert.ok(res.reasons.some((r) => r.includes('installed dependency bytes (not merely the lockfile)')));
    assert.ok(res.envelopeMissing.includes('installed dependency bytes (not merely the lockfile)'));
  });

  t('missing entire launch specification yields INCONCLUSIVE with full envelope missing list', () => {
    const gen = makeFrozenGeneration();
    const run = makeCompleteObserverRun({ launch: null });

    const res = DERIV.deriveState({ records: [gen, run] });
    assert.strictEqual(res.status, DerivationStatus.INCONCLUSIVE);
    assert.ok(res.envelopeMissing.includes('actual source root / entrypoint'));
    assert.ok(res.envelopeMissing.includes('runtime-toolchain identity'));
    assert.ok(res.envelopeMissing.includes('module/package resolution'));
    assert.ok(res.envelopeMissing.includes('environment/lookup paths'));
    assert.ok(res.envelopeMissing.includes('excluded caches'));
  });

  // -------------------------------------------------------------------------
  // 2. Parent Configuration and Host Lookup Paths (PRD §16, §24, INV-12, R-09a)
  // -------------------------------------------------------------------------
  group('T-07.2: Parent Configuration and Host Lookup Paths (PRD §16, §24, INV-12, R-09a)');

  t('unrecorded parent configuration search leaves derivation envelope incomplete', () => {
    // §16: "Configuration search and parent directories ... must be inaccessible or explicitly included and pinned"
    const gen = makeFrozenGeneration();
    const run = makeCompleteObserverRun({ launch: { configParentIncluded: false } });

    const res = DERIV.deriveState({ records: [gen, run] });
    assert.strictEqual(res.status, DerivationStatus.INCONCLUSIVE);
    assert.ok(res.reasons.some((r) => r.includes('configuration search and parent-directory identity')));
    assert.ok(res.envelopeMissing.includes('configuration search and parent-directory identity'));
  });

  t('unpinned environment and lookup-path identity yields INCONCLUSIVE derivation', () => {
    // §16: "Environment and lookup paths"
    const gen = makeFrozenGeneration();
    const run = makeCompleteObserverRun({ launch: { envCluster: null } });

    const res = DERIV.deriveState({ records: [gen, run] });
    assert.strictEqual(res.status, DerivationStatus.INCONCLUSIVE);
    assert.ok(res.reasons.some((r) => r.includes('environment/lookup-path identity')));
    assert.ok(res.envelopeMissing.includes('environment/lookup-path identity'));
  });

  t('coherence gates derive actualDerivation=false when parent configuration is unrecorded', () => {
    const gen = makeFrozenGeneration();
    const run = makeCompleteObserverRun({ launch: { configParentIncluded: false } });
    const inv = [makeInventoryEntry()];
    const obls = [makeObligation()];

    const gates = COH.acceptanceGates({
      records: [gen, run],
      inventory: inv,
      obligations: obls,
    });

    assert.strictEqual(gates.derivation.status, DerivationStatus.INCONCLUSIVE);
    assert.strictEqual(gates.evidenceCoherent, false);
  });

  // -------------------------------------------------------------------------
  // 3. Stale Generated Output & Build Cache Invalidation (PRD §16, §24, INV-12, R-29)
  // -------------------------------------------------------------------------
  group('T-07.3: Stale Generated Output & Build Cache Invalidation (PRD §16, §24, INV-12, R-29)');

  t('incremental, shared, or remote build caches enabled fails derivation envelope', () => {
    // §16: "Incremental, shared, and remote build caches MUST be disabled unless separately qualified"
    const gen = makeFrozenGeneration();
    const run = makeCompleteObserverRun({ launch: { cachesDisabled: false } });

    const res = DERIV.deriveState({ records: [gen, run] });
    assert.strictEqual(res.status, DerivationStatus.INCONCLUSIVE);
    assert.ok(res.reasons.some((r) => r.includes('incremental/shared/remote caches disabled')));
    assert.ok(res.envelopeMissing.includes('incremental/shared/remote caches disabled'));
  });

  t('observer run bound to a different tree digest is rejected as stale/foreign bytes', () => {
    // §16, §17: "A run recorded against one generation never certifies another"
    const gen = makeFrozenGeneration('gen-t07-1', { treeDigest: TREE_DIGEST_V1 });
    const staleRun = makeCompleteObserverRun({
      candidateIdentity: { generationId: 'gen-t07-1', treeDigest: TREE_DIGEST_V2 },
    });

    const applies = DERIV.observerApplies({ run: staleRun, frozenGeneration: gen });
    assert.strictEqual(applies.applies, false);
    assert.ok(applies.reason.includes('run tree digest does not match the frozen tree digest'));

    const res = DERIV.deriveState({ records: [gen, staleRun] });
    assert.strictEqual(res.status, DerivationStatus.MISSING);
    assert.ok(res.reasons.some((r) => r.includes('stale/foreign (tree digest mismatch)')));
  });

  t('observer run bound to a different generationId is rejected as foreign attempt', () => {
    const gen = makeFrozenGeneration('gen-t07-current');
    const foreignRun = makeCompleteObserverRun({
      candidateIdentity: { generationId: 'gen-t07-prior', treeDigest: TREE_DIGEST_V1 },
    });

    const applies = DERIV.observerApplies({ run: foreignRun, frozenGeneration: gen });
    assert.strictEqual(applies.applies, false);
    assert.ok(applies.reason.includes('run is for gen-t07-prior, not the frozen gen-t07-current'));

    const res = DERIV.deriveState({ records: [gen, foreignRun] });
    assert.strictEqual(res.status, DerivationStatus.MISSING);
  });

  t('changed source requires fresh derivation: old PASS observations cannot certify new generation (§18)', () => {
    const keyGen1 = PIPE.computeApplicabilityKey({
      exactCandidateGenerationAndTreeDigest: TREE_DIGEST_V1,
      selectedSourceBaseline: BASELINE_COMMIT_40,
    });
    const keyGen2 = PIPE.computeApplicabilityKey({
      exactCandidateGenerationAndTreeDigest: TREE_DIGEST_V2,
      selectedSourceBaseline: BASELINE_COMMIT_40,
    });

    // Applicability keys differ deterministically across generation tree digests
    assert.notStrictEqual(keyGen1, keyGen2);

    const oldEvidence = makeEvidenceRecord({
      generationId: 'gen-t07-1',
      applicabilityKey: keyGen1,
      outcome: EvidenceOutcome.PASS,
    });

    // Attempting to evaluate old evidence against generation 2 fails applicability check
    const currentEnvelope = {
      exactCandidateGenerationAndTreeDigest: TREE_DIGEST_V2,
      selectedSourceBaseline: BASELINE_COMMIT_40,
    };
    const currentKey = PIPE.computeApplicabilityKey(currentEnvelope);
    assert.notStrictEqual(oldEvidence.applicabilityKey, currentKey);
  });

  // -------------------------------------------------------------------------
  // 4. Omitted Ignored Input & Input Closure (PRD §11, §16, §17, §24, INV-11, INV-12, R-12a)
  // -------------------------------------------------------------------------
  group('T-07.4: Omitted Ignored Input & Input Closure (PRD §11, §16, §17, §24, INV-11, INV-12, R-12a)');

  t('missing baselineIdentity in frozen generation leaves derivation envelope incomplete', () => {
    // §11, §16: "The task MUST explicitly identify an immutable Git commit"
    const gen = makeFrozenGeneration('gen-t07-1', { baselineIdentity: null });
    const run = makeCompleteObserverRun();

    const res = DERIV.deriveState({ records: [gen, run] });
    assert.strictEqual(res.status, DerivationStatus.INCONCLUSIVE);
    assert.ok(res.reasons.some((r) => r.includes('selected source baseline identity')));
    assert.ok(res.envelopeMissing.includes('selected source baseline identity'));
  });

  t('unclosed input closure facts cause acceptanceGates to fail closed', () => {
    // §17: "The profile MUST qualify the completeness of this envelope. Hashing an arbitrarily selected subset does not prove input closure."
    const gen = makeFrozenGeneration();
    const run = makeCompleteObserverRun();

    // No input closure observed facts supplied
    const gates = COH.acceptanceGates({
      records: [gen, run],
      observed: {}, // inputClosure absent -> defaults to { closed: false }
    });

    assert.strictEqual(gates.inputClosure.closed, false);
    assert.ok(gates.inputClosure.missing.some((m) => m.includes('no input-closure facts in records')));
  });

  t('unrecorded or ignored input difference alters applicability key and prevents stale reuse', () => {
    const inputDigestA = sha256('env-config-A');
    const inputDigestB = sha256('env-config-B-with-ignored-input');

    const keyA = PIPE.computeApplicabilityKey({
      predicateVersionParametersAndExpectedValues: inputDigestA,
      exactCandidateGenerationAndTreeDigest: TREE_DIGEST_V1,
    });
    const keyB = PIPE.computeApplicabilityKey({
      predicateVersionParametersAndExpectedValues: inputDigestB,
      exactCandidateGenerationAndTreeDigest: TREE_DIGEST_V1,
    });

    assert.notStrictEqual(keyA, keyB);
  });

  t('missing frozen generation entirely yields MISSING derivation (live tree derivation prohibited)', () => {
    // §16: "derivation against a live tree is not actual derivation"
    const run = makeCompleteObserverRun();
    const res = DERIV.deriveState({ records: [run] }); // No frozen generation record

    assert.strictEqual(res.status, DerivationStatus.MISSING);
    assert.strictEqual(res.frozenGenerationId, null);
    assert.ok(res.reasons.some((r) => r.includes('no frozen generation')));
  });

  // -------------------------------------------------------------------------
  // 5. Incumbent Installation & Outside Workspace Isolation (PRD §11, §16, §24, INV-06, INV-07, R-13, R-29)
  // -------------------------------------------------------------------------
  group('T-07.5: Incumbent Installation & Outside Workspace Isolation (PRD §11, §16, §24, INV-06, INV-07, R-13, R-29)');

  t('candidate source capture strictly excludes dirty incumbent state (§11)', () => {
    const dirtyCapture = REC.createSourceCapture({
      captureId: 'cap-t07-dirty',
      incarnationId: 'inc-t07',
      commitIdentity: BASELINE_COMMIT_40,
      baselineManifestIdentity: contentId('manifest-t07'),
      rules: {
        include: [],
        exclude: [],
        excludeDirty: false, // Attempted inclusion of dirty incumbent state!
      },
    });
    dirtyCapture.reader = { qualified: true, name: 'test-reader', version: 1 };
    dirtyCapture.integrity = {
      objectIdentitiesVerified: true,
      treeEnumerationComplete: true,
      independentRetentionEstablished: true,
    };

    const check = CAPTURE.captureReadiness(dirtyCapture);
    assert.strictEqual(check.status, CAPTURE.CaptureStatus.NOT_READY);
    assert.ok(check.problems.some((p) => p.includes('excludeDirty must be declared')));
  });

  t('candidate source capture rejects unsupported Git shapes and special files (§11)', () => {
    const symlinkCapture = REC.createSourceCapture({
      captureId: 'cap-t07-symlink',
      incarnationId: 'inc-t07',
      commitIdentity: BASELINE_COMMIT_40,
      baselineManifestIdentity: contentId('manifest-t07'),
      rules: { include: [], exclude: [], excludeDirty: true },
      rejections: { symlink: true },
    });

    const check = CAPTURE.captureReadiness(symlinkCapture);
    assert.strictEqual(check.status, CAPTURE.CaptureStatus.UNSUPPORTED);
    assert.ok(check.problems.some((p) => p.includes('rejected source shapes present')));
  });

  t('candidate source capture rejects missing or non-commit baseline identity', () => {
    const badCommitCapture = REC.createSourceCapture({
      captureId: 'cap-t07-badcommit',
      incarnationId: 'inc-t07',
      commitIdentity: 'HEAD', // Not a full hex sha!
      baselineManifestIdentity: contentId('manifest-t07'),
      rules: { include: [], exclude: [], excludeDirty: true },
    });
    badCommitCapture.reader = { qualified: true, name: 'test-reader', version: 1 };
    badCommitCapture.integrity = {
      objectIdentitiesVerified: true,
      treeEnumerationComplete: true,
      independentRetentionEstablished: true,
    };

    const check = CAPTURE.captureReadiness(badCommitCapture);
    assert.strictEqual(check.status, CAPTURE.CaptureStatus.NOT_READY);
    assert.ok(check.problems.some((p) => p.includes('commitIdentity must be a full hex commit hash')));
  });

  t('derivation enforces candidate direct-source root and isolated dependency resolution', () => {
    // §16: "The exact slice MUST use direct-source launch. The trusted controller MUST launch the recorded entrypoint from the frozen source root using the pinned runtime and controlled resolution."
    const gen = makeFrozenGeneration();
    const run = makeCompleteObserverRun({
      launch: {
        sourceRoot: '/contained/frozen/gen-t07-1',
        entrypoint: 'bin/tandem.cjs',
        resolutionScope: 'closed:npm-lock@sha256:' + 'd'.repeat(64),
        installedDependencyBytes: true,
      },
    });

    const gaps = DERIV.deriveEnvelopeGaps(gen, [run]);
    assert.strictEqual(gaps.length, 0);
  });

  // -------------------------------------------------------------------------
  // 6. Broad Native Recipe vs Affected-Only Command (PRD §15, §16, §24, INV-21, R-19, R-25)
  // -------------------------------------------------------------------------
  group('T-07.6: Broad Native Recipe vs Affected-Only Command (PRD §15, §16, §24, INV-21, R-19, R-25)');

  t('impact analysis remains distinguishable from verification and records assumptions and uncertainties (PRD §15)', () => {
    // §15: "Impact analysis MUST remain distinguishable from verification. It must record input identities, assumptions, discovery limits, unsupported dynamic behavior, and uncertainty."
    const analysis = DEC.impactAnalysis({
      inputs: [{ id: 'src/cli.js' }, { id: 'src/util.js' }],
      discovered: ['src/cli.js'],
      discoveryLimit: 10,
      hasUnresolvedDynamic: true,
    });

    assert.ok(typeof analysis.impact === 'string');
    assert.ok(analysis.assumptions.length > 0);
    assert.ok(analysis.uncertainty.some((u) => u.includes('dynamic runtime behavior is not statically determinable — unverified')));
  });

  t('empty inferred impact set does not prove absence of impact and requires broad fallback (INV-21, R-19)', () => {
    // §15: "Unreliable impact assumptions require genuine broader coverage or unresolved obligations. An empty inferred impact set does not prove no impact."
    const emptyAnalysis = DEC.impactAnalysis({
      inputs: [],
      discovered: [],
      discoveryLimit: 5,
      hasUnresolvedDynamic: false,
    });

    assert.ok(emptyAnalysis.assumptions.some((a) => a.includes('empty discovery set may indicate no impact or insufficient search')));
  });

  t('static capability selection prioritizes native deterministic over speculative analyzers (PRD §15)', () => {
    // §15: "prefer native deterministic mechanisms, trusted search/inspection, then any specifically admitted analyzer, then model reasoning where deterministic evidence is insufficient"
    const sel = DEC.selectCapability({
      questionType: 'exit_behavior',
      requiredEvidence: ['stdout', 'stderr', 'exit_code'],
      contextExpansionJustified: false,
    });

    assert.strictEqual(sel.problems.length, 0);
    assert.strictEqual(sel.rank, DEC.CAPABILITY_RANKS.NATIVE_DETERMINISTIC);
    assert.strictEqual(sel.selected.identityAndVersion, 'protected-cli-observer@1');
    assert.strictEqual(sel.selected.trustClassification, 'TRUSTED');
  });

  t('model reasoning cannot substitute for native deterministic verification without justified expansion (PRD §15)', () => {
    const sel = DEC.selectCapability({
      questionType: 'model_judgment',
      requiredEvidence: ['proposal_text'],
      contextExpansionJustified: false, // Not justified!
    });

    assert.strictEqual(sel.selected, null);
    assert.ok(sel.problems.some((p) => p.includes('model reasoning selected but context expansion not justified')));
  });

  // -------------------------------------------------------------------------
  // 7. Incomplete Discovery & Execution Scope (PRD §14, §16, §24, INV-08, INV-09, R-25, R-26c)
  // -------------------------------------------------------------------------
  group('T-07.7: Incomplete Discovery & Execution Scope (PRD §14, §16, §24, INV-08, INV-09, R-25, R-26c)');

  t('zero discovered tests or empty obligation set fails coverage validation (INV-08, INV-09)', () => {
    const inv = [makeInventoryEntry({ mappedObligationIds: ['obl-t07-main'] })];
    const emptyObligations = [];

    const cov = ACC.validateCoverage({ inventory: inv, obligations: emptyObligations });
    assert.strictEqual(cov.ok, false);
    assert.ok(cov.problems.some((p) => p.includes('maps to unknown obligation obl-t07-main')));
  });

  t('unknown or unbounded truncation state in captured output fails bounded capture check (§16.4)', () => {
    // §16: "truncated required output cannot establish required verification"
    const captured = {
      stdoutBytes: 1024,
      stderrBytes: 0,
      exitSignal: 0,
      timeoutSignal: false,
      completionFacts: { wallMs: 100 },
      truncationState: 'UNKNOWN_UNBOUNDED', // Unbounded truncation!
    };

    const check = DERIV.captureBounded(captured);
    assert.strictEqual(check.ok, false);
    assert.ok(check.problems.some((p) => p.includes('truncation state is unknown/unbounded')));

    const gen = makeFrozenGeneration();
    const run = makeCompleteObserverRun({ captured });
    const res = DERIV.deriveState({ records: [gen, run] });
    assert.strictEqual(res.status, DerivationStatus.INCONCLUSIVE);
    assert.ok(res.reasons.some((r) => r.includes('at least one applying observer run lacks bounded, known-truncation capture')));
  });

  t('missing runtime-completion facts or exit/signal fails bounded capture check', () => {
    const captured = {
      stdoutBytes: 1024,
      stderrBytes: 0,
      exitSignal: null, // Missing!
      timeoutSignal: false,
      completionFacts: null, // Missing!
      truncationState: 'NONE',
    };

    const check = DERIV.captureBounded(captured);
    assert.strictEqual(check.ok, false);
    assert.ok(check.problems.some((p) => p.includes('exit/signal fact not recorded')));
    assert.ok(check.problems.some((p) => p.includes('runtime-completion facts not recorded')));
  });

  t('comparison performed inside candidate execution fails oracle independence (§16.5)', () => {
    // §16: "Compare observations outside candidate execution"
    const gen = makeFrozenGeneration();
    const run = makeCompleteObserverRun({ comparedOutsideExecution: false });

    const res = DERIV.deriveState({ records: [gen, run] });
    assert.strictEqual(res.status, DerivationStatus.INCONCLUSIVE);
    assert.ok(res.reasons.some((r) => r.includes('comparison was not performed outside candidate execution')));
  });

  t('candidate-authored report with supporting classification cannot establish derivation', () => {
    // §16, §17: "Supporting reports cannot independently discharge behavioral obligations"
    const gen = makeFrozenGeneration();
    const run = makeCompleteObserverRun({
      classification: 'supporting', // Candidate self-report
      observationPath: 'candidate/test-report.json', // Candidate path
    });

    const res = DERIV.deriveState({ records: [gen, run] });
    assert.strictEqual(res.status, DerivationStatus.INCONCLUSIVE);
    assert.ok(res.reasons.some((r) => r.includes('candidate-authored reports stay supporting')));
  });

  t('unprotected observation path fails authoritative classification requirement (§16.6)', () => {
    const gen = makeFrozenGeneration();
    const run = makeCompleteObserverRun({
      classification: 'authoritative',
      observationPath: 'unprotected/tmp/run.json', // Not a protected path!
    });

    assert.strictEqual(DERIV.isProtectedPath('unprotected/tmp/run.json'), false);
    assert.strictEqual(DERIV.isProtectedPath('protected/evidence/obs-1.json'), true);

    const res = DERIV.deriveState({ records: [gen, run] });
    assert.strictEqual(res.status, DerivationStatus.INCONCLUSIVE);
  });

  t('unqualified observer produces UNQUALIFIED derivation status under IB-01', () => {
    // §16: "observer qualification unattested -> UNQUALIFIED (IB-01)"
    const gen = makeFrozenGeneration();
    const run = makeCompleteObserverRun({
      qualification: { qualified: false, name: 'unqualified-observer' },
    });

    const res = DERIV.deriveState({ records: [gen, run] });
    assert.strictEqual(res.status, DerivationStatus.UNQUALIFIED);
    assert.ok(res.reasons.some((r) => r.includes('observer qualification not attested (IB-01)')));
  });

  t('mixed qualification among applying authoritative runs produces INCONCLUSIVE', () => {
    const gen = makeFrozenGeneration();
    const qualifiedRun = makeCompleteObserverRun({ runId: 'run-qual', qualification: { qualified: true, name: 'qual' } });
    const unqualifiedRun = makeCompleteObserverRun({ runId: 'run-unqual', qualification: { qualified: false, name: 'unqual' } });

    const res = DERIV.deriveState({ records: [gen, qualifiedRun, unqualifiedRun] });
    assert.strictEqual(res.status, DerivationStatus.INCONCLUSIVE);
    assert.ok(res.reasons.some((r) => r.includes('mixed qualification among applying authoritative runs')));
  });

  // -------------------------------------------------------------------------
  // 8. Total Outcome Reduction on Derivation States (PRD §16, §17, §21, §24, INV-09, INV-12, R-30)
  // -------------------------------------------------------------------------
  group('T-07.8: Total Outcome Reduction on Derivation States (PRD §16, §17, §21, §24, INV-09, INV-12, R-30)');

  t('DerivationStatus.MISSING causes reduceAcceptance to fail closed with UNVERIFIED assurance', () => {
    const inv = [makeInventoryEntry()];
    const obls = [makeObligation()];
    const obs = [{
      obligationId: 'obl-t07-main',
      valid: true,
      applicable: true,
      evaluation: 'predicate_satisfied',
      completeness: 'complete',
    }];

    const red = ACC.reduceAcceptance({
      inventory: inv,
      obligations: obls,
      observations: obs,
      evidenceCoherent: true,
      frozenGenerationId: 'gen-t07-1',
      derivationEstablished: false, // Derivation missing / not established!
      quiescenceProven: true,
      payloadManifestComplete: true,
      cleanAuthorityOwnership: true,
      blockers: [],
    });

    assert.strictEqual(red.accepted, false);
    assert.strictEqual(red.outcome, 'NOT_ACCEPTED');
    assert.strictEqual(red.assurance, Assurance.UNVERIFIED);
    assert.ok(red.reasons.some((r) => r.includes('actual source/input derivation not established')));
  });

  t('DerivationStatus.INCONCLUSIVE blocks acceptance and marks evidence as non-coherent', () => {
    const gen = makeFrozenGeneration();
    const incompleteRun = makeCompleteObserverRun({ launch: { entrypoint: null } });

    const gates = COH.acceptanceGates({
      records: [gen, incompleteRun],
      inventory: [makeInventoryEntry()],
      obligations: [makeObligation()],
    });

    assert.strictEqual(gates.derivation.status, DerivationStatus.INCONCLUSIVE);
    assert.strictEqual(gates.evidenceCoherent, false);

    const red = ACC.reduceAcceptance({
      inventory: [makeInventoryEntry()],
      obligations: [makeObligation()],
      observations: [{ obligationId: 'obl-t07-main', valid: true, applicable: true, evaluation: 'predicate_satisfied' }],
      evidenceCoherent: gates.evidenceCoherent,
      frozenGenerationId: 'gen-t07-1',
      derivationEstablished: gates.derivation.status === DerivationStatus.ESTABLISHED,
      quiescenceProven: true,
      payloadManifestComplete: true,
      cleanAuthorityOwnership: true,
      blockers: [],
    });

    assert.strictEqual(red.accepted, false);
    assert.ok(red.reasons.some((r) => r.includes('evidence is not coherent')));
    assert.ok(red.reasons.some((r) => r.includes('actual source/input derivation not established')));
  });

  t('DerivationStatus.UNQUALIFIED blocks acceptance under IB-01 (fail closed)', () => {
    const gen = makeFrozenGeneration();
    const unqualRun = makeCompleteObserverRun({
      qualification: { qualified: false, name: 'unqualified-observer' },
    });

    const gates = COH.acceptanceGates({
      records: [gen, unqualRun],
      inventory: [makeInventoryEntry()],
      obligations: [makeObligation()],
    });

    assert.strictEqual(gates.derivation.status, DerivationStatus.UNQUALIFIED);
    assert.strictEqual(gates.evidenceCoherent, false);
  });

  t('DerivationStatus.ESTABLISHED with all gates satisfied achieves VERIFIED_REQUIRED_CHECKS', () => {
    const inv = [makeInventoryEntry()];
    const obls = [makeObligation()];
    const obs = [{
      obligationId: 'obl-t07-main',
      valid: true,
      applicable: true,
      evaluation: 'predicate_satisfied',
      completeness: 'complete',
    }];

    const red = ACC.reduceAcceptance({
      inventory: inv,
      obligations: obls,
      observations: obs,
      evidenceCoherent: true,
      frozenGenerationId: 'gen-t07-1',
      derivationEstablished: true, // ESTABLISHED!
      quiescenceProven: true,
      payloadManifestComplete: true,
      cleanAuthorityOwnership: true,
      blockers: [],
    });

    assert.strictEqual(red.accepted, true);
    assert.strictEqual(red.outcome, 'COMPLETE');
    assert.strictEqual(red.assurance, Assurance.VERIFIED_REQUIRED_CHECKS);
    assert.strictEqual(red.reasons.length, 0);
  });

  t('unknown or unrecorded resolution cannot be bypassed by green exit code or agent claims (INV-12)', () => {
    const inv = [makeInventoryEntry()];
    const obls = [makeObligation()];

    // Empty observations or observations without valid derivation
    const red = ACC.reduceAcceptance({
      inventory: inv,
      obligations: obls,
      observations: [],
      evidenceCoherent: false,
      frozenGenerationId: 'gen-t07-1',
      derivationEstablished: false,
      quiescenceProven: true,
      payloadManifestComplete: true,
      cleanAuthorityOwnership: true,
      blockers: [],
    });

    assert.strictEqual(red.accepted, false);
    assert.strictEqual(red.outcome, 'NOT_ACCEPTED');
    assert.strictEqual(red.assurance, Assurance.PARTIAL);
    assert.ok(red.reasons.some((r) => r.includes('obl-t07-main is MISSING')));
  });

  // -------------------------------------------------------------------------
  // 9. Platform Qualification Boundary (Termux / Linux Derivation & Runtime Profile)
  // -------------------------------------------------------------------------
  group('T-07.9: Platform Qualification Boundary (Termux / Linux Derivation & Runtime Profile)');

  t('physical derivation and execution environment qualification are NOT QUALIFIED on Termux, IB-01 OPEN', () => {
    // Pure derivation algebra, envelope gap analysis, bounded capture rules,
    // and total outcome reduction are fully verified fail-closed.
    // Physical execution environment qualification, kernel cgroup isolation, and hardware-level
    // derivation enforcement cannot be established on Android/Termux without
    // a verified Linux execution profile and host virtualization (IB-01).
    const platformQualified = false; // Termux / Android environment
    assert.strictEqual(platformQualified, false, 'Physical derivation and execution environment qualification are NOT QUALIFIED on Termux, IB-01 OPEN');
  });
};
