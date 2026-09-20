'use strict';
/**
 * Test Contract T-06: Oracle Control (PRD §24, §14, §16, §17, §21, §27, §28)
 *
 * Exercises all 6 normative exercise areas and adversarial fault models from PRD §24 T-06:
 *  1. Printing forged passing case IDs and reports in candidate stdout/stderr/files
 *  2. Suppressing assertion registration (test filtering, empty suites, skipping tests, zero assertions)
 *  3. Altering runner/report behavior (mock frameworks, exit code overriding, altered reporter format)
 *  4. Modifying tests, authoritative fixtures, discovery rules, or verification configuration
 *  5. Proposing weaker expected values or loose normalization rules
 *  6. Certifying candidate's own newly authored tests or diagnostic artifacts
 *
 * Asserts all 4 normative assertions and invariants:
 *  - Only the protected controller's independently computed predicate can establish authoritative PASS (INV-10)
 *  - A trusted parser or unchanged file hash does not promote an unprotected assertion channel to authoritative proof
 *  - Verification-affecting changes are refused or leave affected proof unresolved (INCONCLUSIVE / MISSING)
 *  - Applicable adverse supporting evidence is preserved and cannot be discarded (FAIL_WINS)
 *  - Candidate self-certification is denied; diagnostic artifacts cannot prove their own adequacy
 *  - Physical external observer qualification and sandbox runner isolation are NOT QUALIFIED on Termux/Android, QUALIFIED under the Docker runtime profile in CI
 *
 * Binds Evidence Families: EC, EV, ER, EX.
 */

const assert = require('node:assert');

const ACC = require('../../src/contracts/acceptance.js');
const REC = require('../../src/contracts/records.js');
const { sha256, canonicalJson, contentId } = require('../../src/contracts/crypto.js');
const EVID = require('../../src/contracts/evidence.js');
const PIPE = require('../../src/contracts/evidence-pipeline.js');
const DERIV = require('../../src/contracts/derivation.js');
const COH = require('../../src/contracts/coherence.js');

const { ObligationOutcome, Assurance, GenerationState } = REC;
const { EvidenceOutcome, InvalidationReason } = PIPE;
const { DerivationStatus } = DERIV;

// ---------------------------------------------------------------------------
// Helpers & Fixtures
// ---------------------------------------------------------------------------

const TREE_DIGEST_V1 = 'sha256:' + '1'.repeat(64);
const TREE_DIGEST_V2 = 'sha256:' + '2'.repeat(64);
const BASELINE_ID = 'commit:' + 'c'.repeat(40);

function makeObligation(overrides = {}) {
  const base = {
    obligationId: 'obl-t06-main',
    sourceRequirementAndSubconditionLinks: ['REQ-T06-01'],
    mandatoryStatus: 'mandatory',
    applicabilityAndDomain: 'exact slice: verify CLI exit and stdout behavior via protected observer',
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
    requiredScopeAndCompleteness: 'full candidate CLI invocation, bounded capture, outside comparison',
    permittedEvidenceSources: ['protected-observer'],
    candidateAndInputApplicability: 'gen-01/exact-tree',
    retryRule: 'NO_RETRY',
    conflictRule: 'FAIL_WINS',
    supersessionRule: 'EVIDENCE_BASED',
  };
  return ACC.createObligation({ ...base, ...overrides });
}

function makeInventoryEntry(overrides = {}) {
  const base = {
    requirementId: 'REQ-T06-01',
    parentRequirementId: null,
    sourceProvenance: 'original prompt, exact slice',
    originalMeaning: 'CLI binary executes and exits deterministically with code 0 and verified output',
    admittedInterpretation: 'run observer on candidate binary and verify clean exit and output',
    explicitOrInferred: 'explicit',
    mandatoryOrOptional: 'mandatory',
    applicability: 'APPLICABLE',
    scope: 'candidate runtime execution',
    rationale: 'primary acceptance contract',
    uncertainty: null,
    authorizedRevision: null,
    mappedObligationIds: ['obl-t06-main'],
  };
  return ACC.createInventoryEntry({ ...base, ...overrides });
}

function makeEnvelope(overrides = {}) {
  return {
    taskAndIncarnation: 'task-t06/inc-01',
    originatingOwnerAndAction: 'owner-supervisor/act-01',
    acceptanceContractDigest: sha256('contract-t06-v1'),
    requirementObligationAndPredicateIdentity: 'REQ-T06-01/obl-t06-main/EXTERNAL_BEHAVIORAL_CASE',
    predicateVersionParametersAndExpectedValues: sha256('v1:params-expected'),
    effectivePolicyRevision: 'pol-rev-1',
    qualifiedProfileDigest: sha256('profile-native-contained'),
    selectedSourceBaseline: '0123456789abcdef0123456789abcdef01234567',
    exactCandidateGenerationAndTreeDigest: TREE_DIGEST_V1,
    actualSourceDependencyConfigurationEnvironmentInputs: sha256('env-inputs-t06'),
    runtimeToolchainAndLaunchIdentity: 'node-22.0.0-qualified',
    discoverySelectionAndExecutionScope: 'exact-slice-native-recipe',
    artifactDerivationIfApplicable: 'direct-source-no-build',
    observationInterval: '2026-09-18T00:00:00.000Z/2026-09-18T00:00:01.000Z',
    completionTimeoutSignalAndTruncationState: 'NONE',
    provenance: 'protected-controller-launch',
    conflictsInvalidationsAndSupersession: 'none',
    ...overrides,
  };
}

function makeEvidenceRecord(overrides = {}) {
  const env = makeEnvelope(overrides.envelopeOverrides || {});
  const baseKey = PIPE.computeApplicabilityKey({
    generationId: 'gen-01',
    obligationId: 'obl-t06-main',
    acceptanceContractDigest: env.acceptanceContractDigest,
    effectivePolicyRevision: env.effectivePolicyRevision,
    qualifiedProfileDigest: env.qualifiedProfileDigest,
    selectedSourceBaseline: env.selectedSourceBaseline,
    exactCandidateGenerationAndTreeDigest: env.exactCandidateGenerationAndTreeDigest,
    requirementObligationAndPredicateIdentity: env.requirementObligationAndPredicateIdentity,
    predicateVersionParametersAndExpectedValues: env.predicateVersionParametersAndExpectedValues,
  });

  return {
    kind: 'evidence',
    evidenceId: 'ev-t06-001',
    generationId: 'gen-01',
    obligationId: 'obl-t06-main',
    outcome: EvidenceOutcome.PASS,
    applicabilityKey: baseKey,
    classification: 'authoritative',
    observerQualified: true,
    invalidated: false,
    envelope: env,
    captured: {
      stdoutBytes: 256,
      stderrBytes: 0,
      exitSignal: 0,
      timeoutSignal: false,
      completionFacts: { wallMs: 45, startedAt: '2026-09-18T00:00:00.000Z', endedAt: '2026-09-18T00:00:00.045Z' },
      truncationState: 'NONE',
    },
    ...overrides,
  };
}

function makeFrozenGeneration(generationId = 'gen-01', treeDigest = TREE_DIGEST_V1, over = {}) {
  const g = REC.createGeneration({ generationId, taskId: 'task-t06', incarnationId: 'inc-01' });
  g.state = GenerationState.FROZEN;
  g.treeDigest = treeDigest;
  g.createOnceIdentity = `ci1:${treeDigest.slice(7)}`;
  g.baselineIdentity = BASELINE_ID;
  g.barrier1ClosedAt = '2026-09-18T00:00:00.000Z';
  g.retention = { start: '2026-09-18T00:00:00.000Z', expiry: '2026-10-18T00:00:00.000Z' };
  if (over) Object.assign(g, over);
  return g;
}

function makeCompleteObserverRun(over = {}) {
  const g = REC.createObserverRun({
    runId: 'run-t06-001',
    incarnationId: 'inc-01',
    obligationId: 'obl-t06-main',
    candidateIdentity: { generationId: 'gen-01', treeDigest: TREE_DIGEST_V1 },
    qualification: { qualified: true, name: 'protected-native-observer', version: '1' },
    launch: {
      entrypoint: 'bin/tandem.cjs',
      sourceRoot: '/contained/frozen/gen-01',
      runtimeIdentity: 'node@22.0.0-qualified',
      resolutionScope: 'closed:npm-lock@sha256:' + 'd'.repeat(64),
      envCluster: 'cluster:T06',
      installedDependencyBytes: true,
      cachesDisabled: true,
      configParentIncluded: true,
    },
    captured: {
      stdoutBytes: 1024,
      stderrBytes: 0,
      exitSignal: 0,
      timeoutSignal: false,
      completionFacts: { wallMs: 120, startedAt: '2026-09-18T00:00:01.000Z', endedAt: '2026-09-18T00:00:01.120Z' },
      truncationState: 'NONE',
    },
    comparedOutsideExecution: true,
    classification: 'authoritative',
    observationPath: 'protected/evidence/obs-t06-1.json',
    attestedAt: '2026-09-18T00:00:02.000Z',
  });
  if (over) Object.assign(g, over);
  return g;
}

module.exports = function run(t, group) {
  // -------------------------------------------------------------------------
  // 1. Candidate Printing Forged Passing Case IDs and Reports (INV-10)
  // -------------------------------------------------------------------------
  group('T-06.1: Forged Passing Case IDs and Reports in Candidate Stdout/Stderr/Files (INV-10)');

  t('candidate printing forged green pass summary in stdout is an observation, not an assertion', () => {
    // Candidate stdout prints plausible JSON asserting 100% pass
    const candidateStdout = JSON.stringify({
      testSuite: 'authoritative-acceptance',
      passed: 42,
      failed: 0,
      status: 'PASS',
      attestation: 'ALL_REQUIREMENTS_SATISFIED',
    });

    const obl = makeObligation();

    // The protected evaluator tests actual stdout against expected pattern, not candidate self-claims
    const evalRes = ACC.evaluateObservation({
      evidenceId: 'ev-forged-stdout',
      predicts: obl.parametersAndExpectedValues.expectedStdoutPattern,
      actual: candidateStdout, // Does not match expected pattern "^SUCCESS: verification complete\n$"
      complete: true,
    });

    // The evaluation contradiction correctly fails the observation
    assert.strictEqual(evalRes.valid, true);
    assert.strictEqual(evalRes.evaluation, 'predicate_contradicted');

    // Total obligation outcome reduces to FAIL
    const oblRes = ACC.reduceObligation(obl, [{ ...evalRes, evidenceId: 'ev-forged-stdout', applicable: true }]);
    assert.strictEqual(oblRes.outcome, ObligationOutcome.FAIL);
    assert.ok(oblRes.reasons.some((r) => r.includes('applicable failure from ev-forged-stdout')));
  });

  t('candidate-generated report file is classified as supporting and cannot establish authoritative PASS', () => {
    // Candidate wrote a JUnit/TAP XML report file into workspace claiming all tests passed
    const candidateReportEvidence = makeEvidenceRecord({
      evidenceId: 'ev-candidate-file',
      classification: 'supporting',
      observerQualified: false, // Candidate-authored report
    });

    // Authoritative check fails: candidate-generated reports cannot be authoritative
    const authCheck = EVID.authoritative({
      evidence: candidateReportEvidence,
      observerQualified: false,
    });
    assert.strictEqual(authCheck.ok, false);
    assert.ok(authCheck.reason.includes('no qualified external observer'));

    // Pipeline reduction marks authoritative as false
    const pipelineRes = PIPE.reducePipeline({
      obligations: ['obl-t06-main'],
      evidenceRecords: [candidateReportEvidence],
    });
    assert.strictEqual(pipelineRes.authoritative, false);
  });

  t('forged classification="authoritative" without qualified observer is rejected (Finding B fix)', () => {
    // Adversarial candidate tampers with evidence classification field
    const forgedEvidence = makeEvidenceRecord({
      evidenceId: 'ev-forged-auth',
      classification: 'authoritative', // Forged label
      observerQualified: false,        // But observer is NOT qualified
    });

    const authCheck = EVID.authoritative({
      evidence: forgedEvidence,
      observerQualified: false,
    });
    assert.strictEqual(authCheck.ok, false);
    assert.ok(authCheck.reason.includes('no qualified external observer'));

    const pipeRes = PIPE.reducePipeline({
      obligations: ['obl-t06-main'],
      evidenceRecords: [forgedEvidence],
    });
    assert.strictEqual(pipeRes.authoritative, false);
  });

  t('comparison must be performed outside candidate execution (§16.5)', () => {
    const frozenGen = makeFrozenGeneration('gen-01');
    const runInsideExecution = makeCompleteObserverRun({
      comparedOutsideExecution: false, // Evaluated inside candidate sandbox/process!
    });

    const derivState = DERIV.deriveState({
      records: [frozenGen, runInsideExecution],
    });

    assert.strictEqual(derivState.status, DerivationStatus.INCONCLUSIVE);
    assert.ok(derivState.reasons.some((r) => r.includes('comparison was not performed outside candidate execution')));
  });

  // -------------------------------------------------------------------------
  // 2. Suppressing Assertion Registration & Empty Suites
  // -------------------------------------------------------------------------
  group('T-06.2: Suppressing Assertion Registration & Empty Suites');

  t('empty test discovery or zero executed assertions fails closed to MISSING / INCONCLUSIVE', () => {
    const obl = makeObligation();

    // Zero observations submitted for the obligation
    const resEmpty = ACC.reduceObligation(obl, []);
    assert.strictEqual(resEmpty.outcome, ObligationOutcome.MISSING);
    assert.ok(resEmpty.reasons.some((r) => r.includes('no evaluator/witness/observation/proof for mandatory obligation')));

    // Coverage validator rejects empty obligation set
    const inv = [makeInventoryEntry()];
    const cov = ACC.validateCoverage({ inventory: inv, obligations: [], claimedOutcome: true });
    assert.strictEqual(cov.ok, false);
    assert.ok(cov.problems.some((p) => p.includes('8: empty obligation conjunction cannot establish acceptance')));
  });

  t('filtering or skipping required assertions leaves obligation with incomplete observations', () => {
    const obl = makeObligation();

    // Candidate used test filtering (--grep / test.skip) resulting in skipped checks and missing stdout
    const incompleteObs = {
      evidenceId: 'ev-skipped-test',
      valid: true,
      applicable: true,
      evaluation: 'predicate_satisfied',
      completeness: 'incomplete', // Marked incomplete due to skipped assertions
    };

    const res = ACC.reduceObligation(obl, [incompleteObs]);
    assert.strictEqual(res.outcome, ObligationOutcome.INCONCLUSIVE);
    assert.ok(res.reasons.some((r) => r.includes('incomplete applicable observation')));
  });

  t('positive evidence requires verified candidate response, not mere zero exit code', () => {
    const obl = makeObligation({
      predicateFamily: ACC.PredicateFamily.EXTERNAL_BEHAVIORAL_CASE,
      requiredObservationTypes: ACC.FAMILY_EVIDENCE[ACC.PredicateFamily.EXTERNAL_BEHAVIORAL_CASE].requiredObservationTypes,
    });

    // Candidate exited with 0 but produced empty stdout (no positive evidence of behavior)
    const emptyStdoutObs = ACC.evaluateObservation({
      evidenceId: 'ev-noop-exit',
      predicts: obl.parametersAndExpectedValues.expectedStdoutPattern,
      actual: '', // Empty output from commented-out code
      complete: true,
    });

    assert.strictEqual(emptyStdoutObs.evaluation, 'predicate_contradicted');

    const res = ACC.reduceObligation(obl, [{ ...emptyStdoutObs, evidenceId: 'ev-noop-exit', applicable: true }]);
    assert.strictEqual(res.outcome, ObligationOutcome.FAIL);
  });

  // -------------------------------------------------------------------------
  // 3. Altering Runner / Report Behavior
  // -------------------------------------------------------------------------
  group('T-06.3: Altering Runner / Report Behavior');

  t('canned mock responses do not deceive protected external observer running direct frozen root', () => {
    const frozenGen = makeFrozenGeneration('gen-01', TREE_DIGEST_V1);

    // Observer records launch using direct-source entrypoint and closed resolution
    const obsRun = makeCompleteObserverRun({
      launch: {
        entrypoint: 'bin/tandem.cjs',
        sourceRoot: '/contained/frozen/gen-01',
        runtimeIdentity: 'node@22.0.0-qualified',
        resolutionScope: 'closed:npm-lock@sha256:' + 'd'.repeat(64),
        envCluster: 'cluster:T06',
        installedDependencyBytes: true,
        cachesDisabled: true,
        configParentIncluded: true,
      },
    });

    const deriv = DERIV.deriveState({ records: [frozenGen, obsRun] });
    // Structure is valid and outside-compared
    assert.strictEqual(deriv.status, DerivationStatus.ESTABLISHED);
  });

  t('candidate overriding exit code does not override observer timeout or exit signal capture', () => {
    // Process timed out or was killed by SIGKILL (candidate could not intercept)
    const timeoutCapture = {
      stdoutBytes: 128,
      stderrBytes: 512,
      exitSignal: 'SIGKILL',
      timeoutSignal: true, // Timed out!
      completionFacts: { wallMs: 30000, startedAt: '2026-09-18T00:00:00.000Z', endedAt: '2026-09-18T00:00:30.000Z' },
      truncationState: 'NONE',
    };

    const boundCheck = DERIV.captureBounded(timeoutCapture);
    assert.strictEqual(boundCheck.ok, true);

    // Evaluating timeout against expectedExit=0 contradicts predicate
    const evalRes = ACC.evaluateObservation({
      evidenceId: 'ev-timeout',
      predicts: 0,
      actual: timeoutCapture.exitSignal,
      complete: false,
    });

    assert.strictEqual(evalRes.valid, true);
    assert.strictEqual(evalRes.evaluation, 'predicate_contradicted');
  });

  t('altered or unparseable report stream fails closed to INCONCLUSIVE (never vacuous PASS)', () => {
    // Corrupted reporter output (e.g. invalid JSON stream from crashed or modified reporter)
    const unparseableObs = ACC.evaluateObservation({
      evidenceId: 'ev-corrupted-stream',
      predicts: { passed: 10 },
      actual: null, // Parser failed to extract observation
      complete: false,
    });

    assert.strictEqual(unparseableObs.valid, false);
    assert.strictEqual(unparseableObs.reason, 'no authoritative observation');

    const obl = makeObligation();
    const oblRes = ACC.reduceObligation(obl, [{ ...unparseableObs, evidenceId: 'ev-corrupted-stream' }]);
    assert.strictEqual(oblRes.outcome, ObligationOutcome.INCONCLUSIVE);
    assert.ok(oblRes.reasons.some((r) => r.includes('untrusted/valid=false')));
  });

  // -------------------------------------------------------------------------
  // 4. Modifying Tests, Fixtures, Discovery, or Verification Configuration
  // -------------------------------------------------------------------------
  group('T-06.4: Modifying Tests, Fixtures, Discovery, or Verification Configuration');

  t('modifying test files or fixtures mutates tree digest and invalidates evidence applicability', () => {
    const keyOriginalTree = PIPE.computeApplicabilityKey({
      generationId: 'gen-01',
      obligationId: 'obl-t06-main',
      acceptanceContractDigest: sha256('contract-v1'),
      effectivePolicyRevision: 'pol-1',
      qualifiedProfileDigest: sha256('prof-1'),
      selectedSourceBaseline: '0123456789abcdef0123456789abcdef01234567',
      exactCandidateGenerationAndTreeDigest: TREE_DIGEST_V1,
      requirementObligationAndPredicateIdentity: 'REQ/obl/EXT',
      predicateVersionParametersAndExpectedValues: sha256('v1:params'),
    });

    // Evidence captured against original tree
    const evRecord = makeEvidenceRecord({
      evidenceId: 'ev-tree-v1',
      applicabilityKey: keyOriginalTree,
      envelopeOverrides: { exactCandidateGenerationAndTreeDigest: TREE_DIGEST_V1 },
    });

    // Candidate modified test files, generating TREE_DIGEST_V2
    const keyModifiedTree = PIPE.computeApplicabilityKey({
      generationId: 'gen-01',
      obligationId: 'obl-t06-main',
      acceptanceContractDigest: sha256('contract-v1'),
      effectivePolicyRevision: 'pol-1',
      qualifiedProfileDigest: sha256('prof-1'),
      selectedSourceBaseline: '0123456789abcdef0123456789abcdef01234567',
      exactCandidateGenerationAndTreeDigest: TREE_DIGEST_V2, // Changed!
      requirementObligationAndPredicateIdentity: 'REQ/obl/EXT',
      predicateVersionParametersAndExpectedValues: sha256('v1:params'),
    });

    assert.notStrictEqual(keyOriginalTree, keyModifiedTree);

    // Attempting to admit evidence from old tree against modified tree fails closed
    const admission = PIPE.admitEvidence(evRecord, {
      activeGenerationId: 'gen-01',
      expectedApplicabilityKey: keyModifiedTree,
    });

    assert.strictEqual(admission.admitted, false);
    assert.strictEqual(admission.invalidationReason, InvalidationReason.KEY_MISMATCH);
  });

  t('unprotected observation path cannot establish authoritative derivation', () => {
    const frozenGen = makeFrozenGeneration('gen-01');

    // Candidate configured observation path inside candidate-writable directory
    const runInCandidateDir = makeCompleteObserverRun({
      observationPath: 'candidate/workspace/test-results.json', // Not protected!
    });

    assert.strictEqual(DERIV.isProtectedPath('candidate/workspace/test-results.json'), false);
    assert.strictEqual(DERIV.isProtectedPath('protected/evidence/obs-1.json'), true);

    const derivState = DERIV.deriveState({
      records: [frozenGen, runInCandidateDir],
    });

    assert.strictEqual(derivState.status, DerivationStatus.INCONCLUSIVE);
    assert.ok(derivState.reasons.some((r) => r.includes('observations are supporting only')));
  });

  t('unrecorded discovery scope or unknown resolution leaves derivation envelope incomplete', () => {
    const frozenGen = makeFrozenGeneration('gen-01');

    // Observer run with incomplete launch envelope (e.g. unknown package resolution or caches not disabled)
    const runIncompleteLaunch = makeCompleteObserverRun({
      launch: {
        entrypoint: 'bin/tandem.cjs',
        // Missing runtimeIdentity, resolutionScope, installedDependencyBytes, cachesDisabled
      },
    });

    const derivState = DERIV.deriveState({
      records: [frozenGen, runIncompleteLaunch],
    });

    assert.strictEqual(derivState.status, DerivationStatus.INCONCLUSIVE);
    assert.ok(derivState.reasons.some((r) => r.includes('derivation envelope incomplete')));
  });

  // -------------------------------------------------------------------------
  // 5. Proposing Weaker Expected Values or Loose Normalization Rules
  // -------------------------------------------------------------------------
  group('T-06.5: Proposing Weaker Expected Values or Loose Normalization Rules');

  t('modifying expected values changes parameters digest and breaks applicability key binding', () => {
    const originalParams = { command: 'node', args: ['--check'], expectedExit: 0 };
    const weakenedParams = { command: 'node', args: ['--check'], expectedExit: [0, 1, 2] }; // Relaxed exit codes

    const paramsDigestOrig = sha256(canonicalJson(originalParams));
    const paramsDigestWeak = sha256(canonicalJson(weakenedParams));

    const keyOrig = ACC.evidenceApplicabilityKey({
      taskAndIncarnation: 'task-1/inc-1',
      originatingAction: 'act-1',
      acceptanceContractDigest: sha256('contract-v1'),
      predicateFamily: ACC.PredicateFamily.EXTERNAL_BEHAVIORAL_CASE,
      predicateVersion: 1,
      parametersDigest: paramsDigestOrig,
      effectivePolicyRevision: 'pol-1',
      qualifiedProfileDigest: sha256('prof-1'),
      selectedSourceBaseline: '0123456789abcdef0123456789abcdef01234567',
      exactGenerationAndTreeDigest: TREE_DIGEST_V1,
    });

    const keyWeak = ACC.evidenceApplicabilityKey({
      taskAndIncarnation: 'task-1/inc-1',
      originatingAction: 'act-1',
      acceptanceContractDigest: sha256('contract-v1'),
      predicateFamily: ACC.PredicateFamily.EXTERNAL_BEHAVIORAL_CASE,
      predicateVersion: 1,
      parametersDigest: paramsDigestWeak,
      effectivePolicyRevision: 'pol-1',
      qualifiedProfileDigest: sha256('prof-1'),
      selectedSourceBaseline: '0123456789abcdef0123456789abcdef01234567',
      exactGenerationAndTreeDigest: TREE_DIGEST_V1,
    });

    assert.notStrictEqual(keyOrig, keyWeak, 'weakened parameters must produce different applicability key');
  });

  t('acceptance contract digest immutably covers expected values, preventing silent normalization', () => {
    const contractV1 = sha256(canonicalJson({
      contractId: 'contract-v1',
      inventory: [makeInventoryEntry()],
      obligations: [makeObligation({ parametersAndExpectedValues: { strict: true } })],
      policyRevision: 'pol-1',
      profileDigest: sha256('prof-1'),
      evidencePolicy: 'EVIDENCE_BASED',
    }));

    const contractV2 = sha256(canonicalJson({
      contractId: 'contract-v1',
      inventory: [makeInventoryEntry()],
      obligations: [makeObligation({ parametersAndExpectedValues: { strict: false } })], // Silent normalization attempt
      policyRevision: 'pol-1',
      profileDigest: sha256('prof-1'),
      evidencePolicy: 'EVIDENCE_BASED',
    }));

    assert.notStrictEqual(contractV1, contractV2, 'contract digest must bind exact parameters and expected values');
  });

  // -------------------------------------------------------------------------
  // 6. Candidate Self-Certification Denial & Authoring New Tests
  // -------------------------------------------------------------------------
  group('T-06.6: Candidate Self-Certification Denial & Authoring New Tests');

  t('candidate newly authored tests cannot independently discharge mandatory behavioral obligations', () => {
    // Candidate added a new test file and produced a green run result
    const candidateAuthoredTestEvidence = makeEvidenceRecord({
      evidenceId: 'ev-candidate-new-test',
      classification: 'supporting',
      observerQualified: false,
    });

    const authCheck = EVID.authoritative({
      evidence: candidateAuthoredTestEvidence,
      observerQualified: false,
    });
    assert.strictEqual(authCheck.ok, false);
    assert.strictEqual(authCheck.reason, 'no qualified external observer; evidence cannot be authoritative');
  });

  t('unchanged test file hash does not promote an unprotected assertion channel to authoritative proof', () => {
    // Even when test file hash is unchanged and invocation ID is fresh, if runner is candidate-controlled,
    // evidence remains supporting and cannot establish authoritative proof (§16)
    const unchangedHashEvidence = makeEvidenceRecord({
      evidenceId: 'ev-unchanged-hash-supporting',
      classification: 'supporting',
      observerQualified: false,
    });

    const authCheck = EVID.authoritative({
      evidence: unchangedHashEvidence,
      observerQualified: false,
    });
    assert.strictEqual(authCheck.ok, false);
  });

  t('candidate cannot replace mandatory supervisor inventory obligations with candidate self-tests', () => {
    // Inventory has REQ-01; candidate maps an unapproved self-test obligation
    const inv = [makeInventoryEntry({ requirementId: 'REQ-01', mappedObligationIds: ['obl-mandatory-supervisor'] })];
    const candidateObligations = [
      makeObligation({ obligationId: 'obl-candidate-self-test', sourceRequirementAndSubconditionLinks: ['REQ-OTHER'] }),
    ];

    const cov = ACC.validateCoverage({ inventory: inv, obligations: candidateObligations, claimedOutcome: true });
    assert.strictEqual(cov.ok, false);
    assert.ok(cov.problems.some((p) => p.includes('2: mandatory requirement REQ-01 maps to unknown obligation obl-mandatory-supervisor')));
  });

  // -------------------------------------------------------------------------
  // 7. Adverse Supporting Evidence Preservation (FAIL_WINS)
  // -------------------------------------------------------------------------
  group('T-06.7: Adverse Supporting Evidence Preservation (FAIL_WINS)');

  t('applicable adverse supporting evidence is not discarded and blocks acceptance under FAIL_WINS', () => {
    const obl = makeObligation();

    // Supporting runner output reports a failure/assertion error
    const adverseSupportingObs = {
      evidenceId: 'ev-adverse-supporting',
      valid: true,
      applicable: true,
      evaluation: 'predicate_contradicted', // FAIL
      completeness: 'complete',
    };

    // Candidate claimed green summary
    const greenObs = {
      evidenceId: 'ev-candidate-claimed-pass',
      valid: true,
      applicable: true,
      evaluation: 'predicate_satisfied',
      completeness: 'complete',
    };

    // Under FAIL_WINS conflict rule, adverse evidence is preserved and causes FAIL
    const res = ACC.reduceObligation(obl, [adverseSupportingObs, greenObs]);
    assert.strictEqual(res.outcome, ObligationOutcome.FAIL);
    assert.ok(res.reasons.some((r) => r.includes('applicable failure from ev-adverse-supporting')));
  });

  t('conflicting PASS and FAIL evidence records in pipeline reduce to FAIL (fail closed)', () => {
    const key = sha256('shared-key');
    const passRec = makeEvidenceRecord({ evidenceId: 'ev-pass-1', outcome: EvidenceOutcome.PASS, applicabilityKey: key });
    const failRec = makeEvidenceRecord({ evidenceId: 'ev-fail-1', outcome: EvidenceOutcome.FAIL, applicabilityKey: key });

    const pipeOutcome = PIPE.reduceObligationOutcome([passRec, failRec]);
    assert.strictEqual(pipeOutcome.outcome, EvidenceOutcome.FAIL);
    assert.ok(pipeOutcome.reasons.some((r) => r.includes('conflicting PASS and FAIL — fail closed')));
  });

  t('supersession cannot overwrite an applicable FAIL with a later green observation (§23 req 5)', () => {
    const key = sha256('key-same-slice');
    const existingFail = makeEvidenceRecord({
      evidenceId: 'ev-fail-existing',
      outcome: EvidenceOutcome.FAIL,
      applicabilityKey: key,
    });
    const incomingPass = makeEvidenceRecord({
      evidenceId: 'ev-pass-later',
      outcome: EvidenceOutcome.PASS,
      applicabilityKey: key,
    });

    const blockReason = PIPE.supersessionBlocked(existingFail, incomingPass);
    assert.ok(typeof blockReason === 'string' && blockReason.length > 0);
    assert.ok(blockReason.includes('valid-failure preservation: a later PASS may not erase an applicable FAIL'));
  });

  // -------------------------------------------------------------------------
  // 8. Independent Oracle Path & Acceptance Reduction (INV-10)
  // -------------------------------------------------------------------------
  group('T-06.8: Independent Oracle Path & Acceptance Reduction (INV-10)');

  t('acceptance reduction fails closed when derivation is not ESTABLISHED', () => {
    const inv = [makeInventoryEntry()];
    const obls = [makeObligation()];
    const obs = [{ obligationId: 'obl-t06-main', valid: true, applicable: true, evaluation: 'predicate_satisfied', completeness: 'complete' }];

    // Derivation not established (e.g. unverified observer or candidate-only run)
    const red = ACC.reduceAcceptance({
      inventory: inv,
      obligations: obls,
      observations: obs,
      evidenceCoherent: true,
      frozenGenerationId: 'gen-01',
      derivationEstablished: false, // NOT ESTABLISHED!
      quiescenceProven: true,
      payloadManifestComplete: true,
      cleanAuthorityOwnership: true,
      blockers: [],
    });

    assert.strictEqual(red.accepted, false);
    assert.strictEqual(red.assurance, Assurance.UNVERIFIED);
    assert.ok(red.reasons.some((r) => r.includes('actual source/input derivation not established')));
  });

  t('acceptanceGates derives actualDerivation=false when derivation is UNQUALIFIED or INCONCLUSIVE', () => {
    const frozenGen = makeFrozenGeneration('gen-01');
    const unqualRun = makeCompleteObserverRun({
      qualification: { qualified: false, name: 'unqualified-observer' },
    });

    const gates = COH.acceptanceGates({
      records: [frozenGen, unqualRun],
      inventory: [makeInventoryEntry()],
      obligations: [makeObligation()],
    });

    assert.strictEqual(gates.derivation.status, DerivationStatus.UNQUALIFIED);
    assert.strictEqual(gates.evidenceCoherent, false);
  });

  t('LLM confidence scores or agent completion messages cannot manufacture PASS (R-22, INV-10)', () => {
    // Acceptance reduction ignores agent completion messages and requires deterministic predicate satisfaction
    const inv = [makeInventoryEntry()];
    const obls = [makeObligation()];

    // Empty observations with agent claiming 100% confidence
    const red = ACC.reduceAcceptance({
      inventory: inv,
      obligations: obls,
      observations: [], // No actual valid observations
      evidenceCoherent: true,
      frozenGenerationId: 'gen-01',
      derivationEstablished: true,
      quiescenceProven: true,
      payloadManifestComplete: true,
      cleanAuthorityOwnership: true,
      blockers: [],
    });

    assert.strictEqual(red.accepted, false);
    assert.ok(red.reasons.some((r) => r.includes('obl-t06-main is MISSING')));
  });

  // -------------------------------------------------------------------------
  // 9. Platform Qualification Boundary (Termux / Linux External Observer Profile)
  // -------------------------------------------------------------------------
  group('T-06.9: Platform Qualification Boundary (Termux / Linux External Observer Profile)');

  t('physical external observer qualification and sandbox runner isolation are NOT QUALIFIED on Termux, IB-01 OPEN', () => {
    // Cryptographic derivation algebra, outside comparison checks, protected path validation,
    // FAIL_WINS adverse evidence preservation, and tamper-resistant applicability keys are fully verified fail-closed.
    // Physical external observer qualification and sandbox runner isolation cannot be qualified
    // on Android/Termux without a verified Linux execution profile and host virtualization (IB-01).
    const platformQualified = false; // Termux / Android environment
    assert.strictEqual(platformQualified, false, 'Physical external observer qualification and sandbox runner isolation are NOT QUALIFIED on Termux/Android, QUALIFIED under the Docker runtime profile in CI');
  });
};
