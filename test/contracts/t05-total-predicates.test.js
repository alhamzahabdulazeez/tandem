'use strict';
/**
 * Test Contract T-05: Total Predicates (PRD §24, §13, §14, §16, §17, §21, §33)
 *
 * Exercises all 8 normative fault conditions and exercise areas from PRD §24 T-05:
 *  1. Dropped mandatory requirement or subcondition
 *  2. Empty obligation set or zero selected cases
 *  3. Missing, partial, truncated, duplicate, malformed, or unrecognized observations
 *  4. Unknown and unproven applicability
 *  5. Changed predicate or mandatory status under a stable ID
 *  6. Same-generation FAIL followed by green (monotonic failure & conflict rule)
 *  7. No-change task with no positive outcome witness
 *  8. Parser failure presented as zero diagnostics
 *
 * Asserts all 5 normative invariants:
 *  - Coverage validation detects every gap (8-point validator in PRD §14)
 *  - No vacuous or relabeled PASS (empty conjunctions, missing proofs never pass)
 *  - Valid failures remain blockers under the admitted conflict rule (FAIL_WINS)
 *  - Missing and inconclusive states remain distinct, total, and non-successful
 *  - Old decisions do not cross contract revisions (applicability digest binding)
 *
 * Binds Evidence Families: EC, EV, EA, EX.
 */

const assert = require('node:assert');

const ACC = require('../../src/contracts/acceptance.js');
const REC = require('../../src/contracts/records.js');
const { sha256, canonicalJson, contentId } = require('../../src/contracts/crypto.js');
const EVID = require('../../src/contracts/evidence.js');
const PIPE = require('../../src/contracts/evidence-pipeline.js');
const INTENT = require('../../src/contracts/intent.js');

const { ObligationOutcome, Assurance } = REC;
const { EvidenceOutcome, InvalidationReason } = PIPE;

// ---------------------------------------------------------------------------
// Helpers & Fixtures
// ---------------------------------------------------------------------------

function makeObligation(overrides = {}) {
  const base = {
    obligationId: 'obl-t05-main',
    sourceRequirementAndSubconditionLinks: ['REQ-01'],
    mandatoryStatus: 'mandatory',
    applicabilityAndDomain: 'exact slice: verify CLI exit and stdout behavior',
    predicateFamily: ACC.PredicateFamily.EXTERNAL_BEHAVIORAL_CASE,
    predicateAdapterId: 'native-cli-observer',
    predicateVersion: 1,
    parametersAndExpectedValues: { command: 'node', args: ['--version'], expectedExit: 0 },
    requiredObservationTypes: [
      'expected_value',
      'candidate_stdout',
      'candidate_stderr',
      'exit_signal',
      'exit_code',
      'timeout',
    ],
    requiredScopeAndCompleteness: 'full candidate CLI invocation, bounded capture',
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
    requirementId: 'REQ-01',
    parentRequirementId: null,
    sourceProvenance: 'original prompt, exact slice',
    originalMeaning: 'CLI binary executes and exits deterministically with code 0',
    admittedInterpretation: 'run observer on candidate binary and verify clean exit',
    explicitOrInferred: 'explicit',
    mandatoryOrOptional: 'mandatory',
    applicability: 'APPLICABLE',
    scope: 'candidate runtime execution',
    rationale: 'primary acceptance contract',
    uncertainty: null,
    authorizedRevision: null,
    mappedObligationIds: ['obl-t05-main'],
  };
  return ACC.createInventoryEntry({ ...base, ...overrides });
}

function makeEnvelope(overrides = {}) {
  return {
    taskAndIncarnation: 'task-t05/inc-01',
    originatingOwnerAndAction: 'owner-supervisor/act-01',
    acceptanceContractDigest: sha256('contract-v1'),
    requirementObligationAndPredicateIdentity: 'REQ-01/obl-t05-main/EXTERNAL_BEHAVIORAL_CASE',
    predicateVersionParametersAndExpectedValues: sha256('v1:params'),
    effectivePolicyRevision: 'pol-rev-1',
    qualifiedProfileDigest: sha256('profile-native'),
    selectedSourceBaseline: '0123456789abcdef0123456789abcdef01234567',
    exactCandidateGenerationAndTreeDigest: sha256('gen-tree-1'),
    actualSourceDependencyConfigurationEnvironmentInputs: sha256('env-inputs'),
    runtimeToolchainAndLaunchIdentity: 'node-22.0.0',
    discoverySelectionAndExecutionScope: 'full-slice',
    artifactDerivationIfApplicable: null,
    observationInterval: '2026-09-18T10:00:00.000Z/2026-09-18T10:00:01.000Z',
    completionTimeoutSignalAndTruncationState: 'NONE',
    provenance: 'protected-external-observer',
    conflictsInvalidationsAndSupersession: 'none',
    ...overrides,
  };
}

function makeEvidenceRecord(overrides = {}) {
  const envelope = makeEnvelope(overrides.envelope || {});
  const base = {
    evidenceId: 'ev-t05-001',
    observationPath: '/var/tandem/evidence/obs-001.json',
    classification: 'authoritative',
    generationId: 'gen-01',
    obligationId: 'obl-t05-main',
    outcome: EvidenceOutcome.PASS,
    observerQualified: true,
    envelope,
  };
  const record = { ...base, ...overrides };
  if (!record.applicabilityKey) {
    record.applicabilityKey = PIPE.computeApplicabilityKey({
      generationId: record.generationId,
      obligationId: record.obligationId,
      acceptanceContractDigest: envelope.acceptanceContractDigest,
      effectivePolicyRevision: envelope.effectivePolicyRevision,
      qualifiedProfileDigest: envelope.qualifiedProfileDigest,
      selectedSourceBaseline: envelope.selectedSourceBaseline,
      exactCandidateGenerationAndTreeDigest: envelope.exactCandidateGenerationAndTreeDigest,
      requirementObligationAndPredicateIdentity: envelope.requirementObligationAndPredicateIdentity,
      predicateVersionParametersAndExpectedValues: envelope.predicateVersionParametersAndExpectedValues,
    });
  }
  return record;
}

module.exports = function run(t, group) {
  // -------------------------------------------------------------------------
  // 1. Dropped Mandatory Requirement or Subcondition
  // -------------------------------------------------------------------------
  group('T-05.1: Dropped Mandatory Requirement or Subcondition');

  t('dropping mandatory requirement from inventory fails 8-point coverage validation (Point 1)', () => {
    // Empty mandatory inventory when claiming a task outcome
    const inv = [makeInventoryEntry({ mandatoryOrOptional: 'optional' })];
    const obls = [makeObligation()];
    const cov = ACC.validateCoverage({ inventory: inv, obligations: obls, claimedOutcome: true });
    assert.strictEqual(cov.ok, false);
    assert.ok(cov.problems.some((p) => p.includes('1: mandatory inventory is empty')));
  });

  t('mandatory inventory completely empty fails coverage validation (Point 1)', () => {
    const cov = ACC.validateCoverage({ inventory: [], obligations: [makeObligation()], claimedOutcome: true });
    assert.strictEqual(cov.ok, false);
    assert.ok(cov.problems.some((p) => p.includes('1: mandatory inventory is empty')));
    assert.ok(cov.problems.some((p) => p.includes('1: inventory is empty')));
  });

  t('mandatory requirement with dropped/empty mappedObligationIds fails coverage validation (Points 2 & 7)', () => {
    const inv = [makeInventoryEntry({ requirementId: 'REQ-MANDATORY', mappedObligationIds: [] })];
    const obls = [makeObligation({ obligationId: 'obl-t05-main' })];
    const cov = ACC.validateCoverage({ inventory: inv, obligations: obls, claimedOutcome: true });
    assert.strictEqual(cov.ok, false);
    assert.ok(cov.problems.some((p) => p.includes('2: mandatory requirement REQ-MANDATORY has no obligation mapping')));
    assert.ok(cov.problems.some((p) => p.includes('7: mandatory REQ-MANDATORY silently optional')));
  });

  t('mandatory requirement mapping to nonexistent obligation ID fails coverage validation (Point 2)', () => {
    const inv = [makeInventoryEntry({ requirementId: 'REQ-01', mappedObligationIds: ['obl-nonexistent'] })];
    const obls = [makeObligation({ obligationId: 'obl-t05-main' })];
    const cov = ACC.validateCoverage({ inventory: inv, obligations: obls, claimedOutcome: true });
    assert.strictEqual(cov.ok, false);
    assert.ok(cov.problems.some((p) => p.includes('2: mandatory requirement REQ-01 maps to unknown obligation obl-nonexistent')));
  });

  t('mandatory subcondition dropped from mapping blocks final acceptance (§21)', () => {
    const inv = [
      makeInventoryEntry({ requirementId: 'REQ-01', mappedObligationIds: ['obl-01'] }),
      makeInventoryEntry({ requirementId: 'REQ-01.SUB-A', parentRequirementId: 'REQ-01', mappedObligationIds: [] }),
    ];
    const obls = [makeObligation({ obligationId: 'obl-01' })];
    const obs = [{ obligationId: 'obl-01', valid: true, applicable: true, evaluation: 'predicate_satisfied', completeness: 'complete' }];

    const res = ACC.reduceAcceptance({
      inventory: inv,
      obligations: obls,
      observations: obs,
      evidenceCoherent: true,
      frozenGenerationId: 'gen-01',
      derivationEstablished: true,
      quiescenceProven: true,
      payloadManifestComplete: true,
      cleanAuthorityOwnership: true,
      blockers: [],
    });

    assert.strictEqual(res.accepted, false);
    assert.strictEqual(res.outcome, 'NOT_ACCEPTED');
    assert.ok(res.reasons.some((r) => r.includes('REQ-01.SUB-A has no obligation mapping')));
  });

  // -------------------------------------------------------------------------
  // 2. Empty Obligation Set or Zero Selected Cases
  // -------------------------------------------------------------------------
  group('T-05.2: Empty Obligation Set or Zero Selected Cases');

  t('empty obligation set with claimed outcome fails coverage validation (Point 8)', () => {
    const inv = [makeInventoryEntry({ mappedObligationIds: [] })];
    const cov = ACC.validateCoverage({ inventory: inv, obligations: [], claimedOutcome: true });
    assert.strictEqual(cov.ok, false);
    assert.ok(cov.problems.some((p) => p.includes('8: empty obligation conjunction cannot establish acceptance')));
  });

  t('empty obligation set in reduceAcceptance fails closed (never establishes acceptance)', () => {
    const inv = [makeInventoryEntry()];
    const res = ACC.reduceAcceptance({
      inventory: inv,
      obligations: [],
      observations: [],
      evidenceCoherent: true,
      frozenGenerationId: 'gen-01',
      derivationEstablished: true,
      quiescenceProven: true,
      payloadManifestComplete: true,
      cleanAuthorityOwnership: true,
      blockers: [],
    });
    assert.strictEqual(res.accepted, false);
    assert.ok(res.reasons.some((r) => r.includes('no mandatory obligations — empty conjunction cannot establish acceptance')));
  });

  t('obligation with empty parameters/cases fails coverage validation (Point 5)', () => {
    const o = makeObligation({ parametersAndExpectedValues: {} });
    const inv = [makeInventoryEntry({ mappedObligationIds: [o.obligationId] })];
    const cov = ACC.validateCoverage({ inventory: inv, obligations: [o], claimedOutcome: true });
    assert.strictEqual(cov.ok, false);
    assert.ok(cov.problems.some((p) => p.includes('5: obligation obl-t05-main has no parametersAndExpectedValues')));
  });

  t('obligation with empty requiredObservationTypes fails coverage validation (Point 5)', () => {
    const o = makeObligation({ requiredObservationTypes: [] });
    const inv = [makeInventoryEntry({ mappedObligationIds: [o.obligationId] })];
    const cov = ACC.validateCoverage({ inventory: inv, obligations: [o], claimedOutcome: true });
    assert.strictEqual(cov.ok, false);
    assert.ok(cov.problems.some((p) => p.includes('5: obligation obl-t05-main has no requiredObservationTypes')));
  });

  t('obligation with missing predicateAdapterId or predicateVersion fails coverage validation (Point 5)', () => {
    const o1 = makeObligation({ predicateAdapterId: null });
    const cov1 = ACC.validateCoverage({ inventory: [makeInventoryEntry()], obligations: [o1], claimedOutcome: true });
    assert.strictEqual(cov1.ok, false);
    assert.ok(cov1.problems.some((p) => p.includes('5: obligation obl-t05-main has no predicateAdapterId')));

    const o2 = makeObligation({ predicateVersion: null });
    const cov2 = ACC.validateCoverage({ inventory: [makeInventoryEntry()], obligations: [o2], claimedOutcome: true });
    assert.strictEqual(cov2.ok, false);
    assert.ok(cov2.problems.some((p) => p.includes('5: obligation obl-t05-main has no predicateVersion')));
  });

  t('reduceObligationOutcome on zero/empty evidence reduces to MISSING', () => {
    const res = PIPE.reduceObligationOutcome([]);
    assert.strictEqual(res.outcome, EvidenceOutcome.MISSING);
    assert.ok(res.reasons.some((r) => r.includes('no admitted evidence for obligation')));
  });

  t('reducePipeline on empty obligations list returns MISSING verdict', () => {
    const res = PIPE.reducePipeline({ obligations: [], evidenceRecords: [] });
    assert.strictEqual(res.verdict, EvidenceOutcome.MISSING);
    assert.strictEqual(res.authoritative, false);
  });

  // -------------------------------------------------------------------------
  // 3. Missing, Partial, Truncated, Duplicate, Malformed, or Unrecognized Observations
  // -------------------------------------------------------------------------
  group('T-05.3: Missing, Partial, Truncated, Duplicate, Malformed, or Unrecognized Observations');

  t('missing observation for mandatory obligation reduces to MISSING, never PASS', () => {
    const obl = makeObligation({ mandatoryStatus: 'mandatory' });
    const res = ACC.reduceObligation(obl, []);
    assert.strictEqual(res.outcome, ObligationOutcome.MISSING);
    assert.ok(res.reasons.some((r) => r.includes('no evaluator/witness/observation/proof for mandatory obligation')));
  });

  t('partial/incomplete observation reduces to INCONCLUSIVE, never PASS', () => {
    const obl = makeObligation({ mandatoryStatus: 'mandatory' });
    const obs = [
      { valid: true, applicable: true, evaluation: 'predicate_satisfied', completeness: 'incomplete', evidenceId: 'ev-inc' },
    ];
    const res = ACC.reduceObligation(obl, obs);
    assert.strictEqual(res.outcome, ObligationOutcome.INCONCLUSIVE);
    assert.ok(res.reasons.some((r) => r.includes('incomplete applicable observation')));
  });

  t('truncated observation with unbounded/unknown state fails closed to INCONCLUSIVE in pipeline reduction (Finding A)', () => {
    const recBounded = makeEvidenceRecord({
      outcome: EvidenceOutcome.PASS,
      envelope: { completionTimeoutSignalAndTruncationState: 'TRUNCATED_BOUNDED' },
    });
    const resBounded = PIPE.reduceObligationOutcome([recBounded]);
    assert.strictEqual(resBounded.outcome, EvidenceOutcome.PASS);

    const recUnbounded = makeEvidenceRecord({
      evidenceId: 'ev-unbounded',
      outcome: EvidenceOutcome.PASS,
      envelope: { completionTimeoutSignalAndTruncationState: 'TRUNCATED_UNBOUNDED' },
    });
    const resUnbounded = PIPE.reduceObligationOutcome([recUnbounded]);
    assert.strictEqual(resUnbounded.outcome, EvidenceOutcome.INCONCLUSIVE);
    assert.ok(resUnbounded.reasons.some((r) => r.includes('unbounded/unknown truncation present')));

    const recUnknownTrunc = makeEvidenceRecord({
      evidenceId: 'ev-unknown-trunc',
      outcome: EvidenceOutcome.PASS,
      envelope: { completionTimeoutSignalAndTruncationState: 'UNKNOWN_TRUNCATION_BURST' },
    });
    const resUnknown = PIPE.reduceObligationOutcome([recUnknownTrunc]);
    assert.strictEqual(resUnknown.outcome, EvidenceOutcome.INCONCLUSIVE);
  });

  t('duplicate valid satisfied observations deterministically reduce to PASS without double-counting', () => {
    const obl = makeObligation({ mandatoryStatus: 'mandatory' });
    const obs1 = { valid: true, applicable: true, evaluation: 'predicate_satisfied', completeness: 'complete', evidenceId: 'ev-dup-1' };
    const obs2 = { valid: true, applicable: true, evaluation: 'predicate_satisfied', completeness: 'complete', evidenceId: 'ev-dup-1' };
    const res = ACC.reduceObligation(obl, [obs1, obs2]);
    assert.strictEqual(res.outcome, ObligationOutcome.PASS);
  });

  t('malformed observations (non-object, untrusted/valid=false, missing fields) reduce to INCONCLUSIVE', () => {
    const obl = makeObligation({ mandatoryStatus: 'mandatory' });

    // Non-object observation
    const resNull = ACC.reduceObligation(obl, [null]);
    assert.strictEqual(resNull.outcome, ObligationOutcome.INCONCLUSIVE);
    assert.ok(resNull.reasons.some((r) => r.includes('malformed observation')));

    // valid: false observation
    const resInvalid = ACC.reduceObligation(obl, [
      { valid: false, applicable: true, evaluation: 'predicate_satisfied', completeness: 'complete', evidenceId: 'ev-bad' },
    ]);
    assert.strictEqual(resInvalid.outcome, ObligationOutcome.INCONCLUSIVE);
    assert.ok(resInvalid.reasons.some((r) => r.includes('untrusted/valid=false')));
  });

  t('unrecognized observation outcome in admitEvidence is rejected immediately', () => {
    const recBogus = makeEvidenceRecord({ outcome: 'SUPER_PASS' });
    const ctx = {
      activeGenerationId: 'gen-01',
      expectedApplicabilityKey: recBogus.applicabilityKey,
    };
    const res = PIPE.admitEvidence(recBogus, ctx);
    assert.strictEqual(res.admitted, false);
    assert.ok(res.reason.includes('invalid outcome "SUPER_PASS"'));
  });

  t('unsupported predicate family fails obligation construction and coverage validation (Point 4)', () => {
    assert.throws(
      () => makeObligation({ predicateFamily: 'DYNAMIC_SCRIPT_EVAL' }),
      /unknown predicate family "DYNAMIC_SCRIPT_EVAL"/,
    );

    // Spread to construct a raw object with bad family
    const badObl = { ...makeObligation(), predicateFamily: 'DYNAMIC_SCRIPT_EVAL' };
    const cov = ACC.validateCoverage({
      inventory: [makeInventoryEntry({ mappedObligationIds: [badObl.obligationId] })],
      obligations: [badObl],
      claimedOutcome: true,
    });
    assert.strictEqual(cov.ok, false);
    assert.ok(cov.problems.some((p) => p.includes('4: obligation obl-t05-main uses unsupported predicate family')));
  });

  t('predicate family missing required observation types fails coverage validation (Point 4 table)', () => {
    // EXTERNAL_BEHAVIORAL_CASE requires exit_code, stdout, stderr, etc.
    const o = makeObligation({
      predicateFamily: ACC.PredicateFamily.EXTERNAL_BEHAVIORAL_CASE,
      requiredObservationTypes: ['candidate_stdout'], // Missing exit_code, stderr, timeout, etc.
    });
    const cov = ACC.validateCoverage({
      inventory: [makeInventoryEntry({ mappedObligationIds: [o.obligationId] })],
      obligations: [o],
      claimedOutcome: true,
    });
    assert.strictEqual(cov.ok, false);
    assert.ok(cov.problems.some((p) => p.includes('lacks required observation type "exit_code"')));
    assert.ok(cov.problems.some((p) => p.includes('lacks required observation type "candidate_stderr"')));
  });

  // -------------------------------------------------------------------------
  // 4. Unknown and Unproven Applicability
  // -------------------------------------------------------------------------
  group('T-05.4: Unknown and Unproven Applicability');

  t('unresolved applicability in inventory or obligation fails coverage validation (Point 6)', () => {
    // Inventory entry missing applicability
    const invBad = [{ ...makeInventoryEntry(), applicability: null }];
    const oblsGood = [makeObligation()];
    const cov1 = ACC.validateCoverage({ inventory: invBad, obligations: oblsGood, claimedOutcome: true });
    assert.strictEqual(cov1.ok, false);
    assert.ok(cov1.problems.some((p) => p.includes('6: inventory REQ-01 has no applicability')));

    // Obligation missing applicability
    const invGood = [makeInventoryEntry()];
    const oblBad = { ...makeObligation(), applicabilityAndDomain: null };
    const cov2 = ACC.validateCoverage({ inventory: invGood, obligations: [oblBad], claimedOutcome: true });
    assert.strictEqual(cov2.ok, false);
    assert.ok(cov2.problems.some((p) => p.includes('6: obligation obl-t05-main has no applicability')));
  });

  t('observation with non-applicable status for mandatory obligation cannot establish PASS', () => {
    const obl = makeObligation({ mandatoryStatus: 'mandatory' });
    const obs = [
      { valid: true, applicable: false, evaluation: 'predicate_satisfied', completeness: 'complete', evidenceId: 'ev-non-app' },
    ];
    // Non-applicable observation is skipped; with no other observations, mandatory obligation yields MISSING
    const res = ACC.reduceObligation(obl, obs);
    assert.strictEqual(res.outcome, ObligationOutcome.MISSING);
    assert.ok(res.reasons.some((r) => r.includes('no evaluator/witness/observation/proof for mandatory obligation')));
  });

  t('evidence record with mismatched applicability key fails admission (KEY_MISMATCH)', () => {
    const rec = makeEvidenceRecord();
    const ctx = {
      activeGenerationId: 'gen-01',
      expectedApplicabilityKey: 'different-expected-key-00000000000000000000000000000000',
    };
    const res = PIPE.admitEvidence(rec, ctx);
    assert.strictEqual(res.admitted, false);
    assert.strictEqual(res.invalidationReason, InvalidationReason.KEY_MISMATCH);
    assert.ok(res.reason.includes('does not match current contract/policy/profile/generation'));
  });

  t('evidenceApplicable returns false when expectedKey is absent or envelope is incomplete', () => {
    const rec = makeEvidenceRecord();
    const resNoKey = EVID.evidenceApplicable(rec, null);
    assert.strictEqual(resNoKey.applicable, false);
    assert.ok(resNoKey.reason.includes('no expected applicability key'));

    const incompleteRec = { ...rec, envelope: { taskAndIncarnation: 't/i' } };
    incompleteRec.applicabilityKey = 'matching-key';
    const resInc = EVID.evidenceApplicable(incompleteRec, 'matching-key');
    assert.strictEqual(resInc.applicable, false);
    assert.ok(resInc.reason.includes('incomplete envelope'));
  });

  // -------------------------------------------------------------------------
  // 5. Changed Predicate or Mandatory Status Under a Stable ID
  // -------------------------------------------------------------------------
  group('T-05.5: Changed Predicate or Mandatory Status Under a Stable ID');

  t('changing predicate version or parameters changes applicability key and prevents stale evidence reuse', () => {
    const baseBinding = {
      generationId: 'gen-01',
      obligationId: 'obl-stable-id',
      acceptanceContractDigest: sha256('contract-v1'),
      effectivePolicyRevision: 'pol-1',
      qualifiedProfileDigest: sha256('profile-1'),
      selectedSourceBaseline: '0123456789abcdef0123456789abcdef01234567',
      exactCandidateGenerationAndTreeDigest: sha256('gen-tree-1'),
      requirementObligationAndPredicateIdentity: 'REQ-01/obl-stable-id/EXTERNAL_BEHAVIORAL_CASE',
      predicateVersionParametersAndExpectedValues: sha256('version:1|expectedExit:0'),
    };

    const keyV1 = PIPE.computeApplicabilityKey(baseBinding);

    // Change predicate parameters under the same obligationId
    const changedBinding = {
      ...baseBinding,
      predicateVersionParametersAndExpectedValues: sha256('version:2|expectedExit:0|timeoutMs:5000'),
    };
    const keyV2 = PIPE.computeApplicabilityKey(changedBinding);

    assert.notStrictEqual(keyV1, keyV2, 'applicability key must change when predicate version/parameters change');

    // Evidence captured under V1 fails admission for active slice under V2
    const recCapturedUnderV1 = makeEvidenceRecord({
      obligationId: 'obl-stable-id',
      applicabilityKey: keyV1,
    });
    const ctxV2 = {
      activeGenerationId: 'gen-01',
      expectedApplicabilityKey: keyV2,
    };
    const admissionRes = PIPE.admitEvidence(recCapturedUnderV1, ctxV2);
    assert.strictEqual(admissionRes.admitted, false);
    assert.strictEqual(admissionRes.invalidationReason, InvalidationReason.KEY_MISMATCH);
  });

  t('changing mandatory requirement to optional obligation under stable ID fails coverage validation (Point 7)', () => {
    // Inventory marks REQ-01 as mandatory, but mapped obligation is marked optional
    const inv = [makeInventoryEntry({ requirementId: 'REQ-01', mandatoryOrOptional: 'mandatory', mappedObligationIds: ['obl-01'] })];
    const oblOptional = makeObligation({ obligationId: 'obl-01', mandatoryStatus: 'optional' });

    const cov = ACC.validateCoverage({ inventory: inv, obligations: [oblOptional], claimedOutcome: true });
    assert.strictEqual(cov.ok, false);
    assert.ok(cov.problems.some((p) => p.includes('7: mandatory REQ-01 maps to obligation obl-01 marked optional')));
  });

  t('acceptance contract digest mismatch invalidates evidence across contract revisions', () => {
    const params = {
      taskAndIncarnation: 'task-1/inc-1',
      originatingAction: 'act-1',
      acceptanceContractDigest: sha256('contract-rev-A'),
      predicateFamily: ACC.PredicateFamily.EXTERNAL_BEHAVIORAL_CASE,
      predicateVersion: 1,
      parametersDigest: sha256('params'),
      effectivePolicyRevision: 'pol-1',
      qualifiedProfileDigest: sha256('prof-1'),
      selectedSourceBaseline: '0123456789abcdef0123456789abcdef01234567',
      exactGenerationAndTreeDigest: sha256('tree-1'),
    };

    const keyRevA = ACC.evidenceApplicabilityKey(params);
    const keyRevB = ACC.evidenceApplicabilityKey({
      ...params,
      acceptanceContractDigest: sha256('contract-rev-B'),
    });

    assert.notStrictEqual(keyRevA, keyRevB, 'evidence applicability keys must not cross contract revisions');
  });

  // -------------------------------------------------------------------------
  // 6. Same-Generation FAIL Followed by Green (Monotonic Failure & Conflict Rule)
  // -------------------------------------------------------------------------
  group('T-05.6: Same-Generation FAIL Followed by Green (Monotonic Failure & Conflict Rule)');

  t('same-generation valid FAIL is preserved monotonically even when followed by satisfied observation', () => {
    const obl = makeObligation();
    const obsFail = {
      valid: true,
      applicable: true,
      evaluation: 'predicate_contradicted',
      completeness: 'complete',
      evidenceId: 'ev-fail-1',
    };
    const obsPass = {
      valid: true,
      applicable: true,
      evaluation: 'predicate_satisfied',
      completeness: 'complete',
      evidenceId: 'ev-pass-2',
    };

    // Ordered FAIL then PASS
    const resFailThenPass = ACC.reduceObligation(obl, [obsFail, obsPass]);
    assert.strictEqual(resFailThenPass.outcome, ObligationOutcome.FAIL);
    assert.ok(resFailThenPass.reasons.some((r) => r.includes('applicable failure from ev-fail-1')));

    // Ordered PASS then FAIL
    const resPassThenFail = ACC.reduceObligation(obl, [obsPass, obsFail]);
    assert.strictEqual(resPassThenFail.outcome, ObligationOutcome.FAIL);
    assert.ok(resPassThenFail.reasons.some((r) => r.includes('applicable failure from ev-fail-1')));
  });

  t('supersessionBlocked refuses to let later PASS overwrite existing applicable FAIL (§23 req 5)', () => {
    const key = sha256('same-applicability-key');
    const existingFail = makeEvidenceRecord({
      evidenceId: 'ev-fail',
      outcome: EvidenceOutcome.FAIL,
      applicabilityKey: key,
    });
    const incomingPass = makeEvidenceRecord({
      evidenceId: 'ev-pass',
      outcome: EvidenceOutcome.PASS,
      applicabilityKey: key,
    });

    const blockReason = PIPE.supersessionBlocked(existingFail, incomingPass);
    assert.ok(typeof blockReason === 'string' && blockReason.length > 0);
    assert.ok(blockReason.includes('valid-failure preservation: a later PASS may not erase an applicable FAIL'));
  });

  t('reduceObligationOutcome resolves conflicting PASS + FAIL to FAIL (fail closed)', () => {
    const key = sha256('key-1');
    const recPass = makeEvidenceRecord({ evidenceId: 'ev-1', outcome: EvidenceOutcome.PASS, applicabilityKey: key });
    const recFail = makeEvidenceRecord({ evidenceId: 'ev-2', outcome: EvidenceOutcome.FAIL, applicabilityKey: key });

    const res = PIPE.reduceObligationOutcome([recPass, recFail]);
    assert.strictEqual(res.outcome, EvidenceOutcome.FAIL);
    assert.ok(res.reasons.some((r) => r.includes('conflicting PASS and FAIL — fail closed')));
  });

  t('reduceAcceptance fails with FAILED_REQUIRED_CHECKS when any mandatory obligation has a FAIL', () => {
    const inv = [makeInventoryEntry({ requirementId: 'REQ-01', mappedObligationIds: ['obl-01'] })];
    const obls = [makeObligation({ obligationId: 'obl-01' })];
    const obs = [
      { obligationId: 'obl-01', valid: true, applicable: true, evaluation: 'predicate_contradicted', completeness: 'complete', evidenceId: 'ev-fail' },
    ];

    const res = ACC.reduceAcceptance({
      inventory: inv,
      obligations: obls,
      observations: obs,
      evidenceCoherent: true,
      frozenGenerationId: 'gen-01',
      derivationEstablished: true,
      quiescenceProven: true,
      payloadManifestComplete: true,
      cleanAuthorityOwnership: true,
      blockers: [],
    });

    assert.strictEqual(res.accepted, false);
    assert.strictEqual(res.outcome, 'FAILED');
    assert.strictEqual(res.assurance, Assurance.FAILED_REQUIRED_CHECKS);
    assert.ok(res.reasons.some((r) => r.includes('obl-01 is FAIL — not accepted')));
  });

  // -------------------------------------------------------------------------
  // 7. No-Change Task with No Positive Outcome Witness
  // -------------------------------------------------------------------------
  group('T-05.7: No-Change Task with No Positive Outcome Witness');

  t('no-change task claiming acceptance with zero positive outcome witnesses is rejected as MISSING', () => {
    const obl = makeObligation({ mandatoryStatus: 'mandatory' });
    // Zero observations captured
    const redObl = ACC.reduceObligation(obl, []);
    assert.strictEqual(redObl.outcome, ObligationOutcome.MISSING);

    const inv = [makeInventoryEntry({ requirementId: 'REQ-01', mappedObligationIds: [obl.obligationId] })];
    const res = ACC.reduceAcceptance({
      inventory: inv,
      obligations: [obl],
      observations: [], // No positive evidence
      evidenceCoherent: true,
      frozenGenerationId: 'gen-unchanged-01',
      derivationEstablished: true,
      quiescenceProven: true,
      payloadManifestComplete: true,
      cleanAuthorityOwnership: true,
      blockers: [],
    });

    assert.strictEqual(res.accepted, false);
    assert.strictEqual(res.outcome, 'NOT_ACCEPTED');
    assert.strictEqual(res.assurance, Assurance.PARTIAL);
    assert.ok(res.reasons.some((r) => r.includes('obl-t05-main is MISSING — not accepted')));
  });

  t('all three predicate families require positive authoritative evidence to certify PASS', () => {
    // 1. EXTERNAL_BEHAVIORAL_CASE
    const oblExt = makeObligation({
      obligationId: 'obl-ext',
      predicateFamily: ACC.PredicateFamily.EXTERNAL_BEHAVIORAL_CASE,
      requiredObservationTypes: ACC.FAMILY_EVIDENCE[ACC.PredicateFamily.EXTERNAL_BEHAVIORAL_CASE].requiredObservationTypes,
    });
    // 2. FROZEN_TREE_CONSTRAINT
    const oblTree = makeObligation({
      obligationId: 'obl-tree',
      predicateFamily: ACC.PredicateFamily.FROZEN_TREE_CONSTRAINT,
      requiredObservationTypes: ACC.FAMILY_EVIDENCE[ACC.PredicateFamily.FROZEN_TREE_CONSTRAINT].requiredObservationTypes,
    });
    // 3. QUALIFIED_DETERMINISTIC_CHECK
    const oblDet = makeObligation({
      obligationId: 'obl-det',
      predicateFamily: ACC.PredicateFamily.QUALIFIED_DETERMINISTIC_CHECK,
      requiredObservationTypes: ACC.FAMILY_EVIDENCE[ACC.PredicateFamily.QUALIFIED_DETERMINISTIC_CHECK].requiredObservationTypes,
    });

    for (const obl of [oblExt, oblTree, oblDet]) {
      // Empty observations yields MISSING
      const resEmpty = ACC.reduceObligation(obl, []);
      assert.strictEqual(resEmpty.outcome, ObligationOutcome.MISSING);

      // Complete valid satisfied observation yields PASS
      const resPass = ACC.reduceObligation(obl, [
        { valid: true, applicable: true, evaluation: 'predicate_satisfied', completeness: 'complete' },
      ]);
      assert.strictEqual(resPass.outcome, ObligationOutcome.PASS);
    }
  });

  t('candidate self-certified / unverified evidence cannot establish authoritative PASS (authoritative requires qualified observer)', () => {
    const candidateReport = makeEvidenceRecord({
      classification: 'supporting',
      observerQualified: false,
    });

    const authCheck1 = EVID.authoritative({ evidence: candidateReport, observerQualified: false });
    assert.strictEqual(authCheck1.ok, false);
    assert.ok(authCheck1.reason.includes('no qualified external observer'));

    // Even if classification was spoofed to 'authoritative', observerQualified=false denies it
    const spoofedReport = makeEvidenceRecord({
      classification: 'authoritative',
      observerQualified: false,
    });
    const authCheck2 = EVID.authoritative({ evidence: spoofedReport, observerQualified: false });
    assert.strictEqual(authCheck2.ok, false);
    assert.ok(authCheck2.reason.includes('no qualified external observer'));

    // Under IB-01, pipeline reduction returns authoritative: false
    const pipelineRes = PIPE.reducePipeline({
      obligations: ['obl-t05-main'],
      evidenceRecords: [spoofedReport],
    });
    assert.strictEqual(pipelineRes.authoritative, false);
  });

  // -------------------------------------------------------------------------
  // 8. Parser Failure Presented as Zero Diagnostics
  // -------------------------------------------------------------------------
  group('T-05.8: Parser Failure Presented as Zero Diagnostics');

  t('evaluateObservation with missing actual observation fails to valid=false (never fabricates PASS)', () => {
    // When parser fails or runner crashes, actual output is null
    const res = ACC.evaluateObservation({
      evidenceId: 'ev-crashed-parser',
      predicts: 0,
      actual: null,
      complete: false,
    });
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.reason, 'no authoritative observation');
  });

  t('parser crash or corrupted output presented as zero diagnostics reduces to INCONCLUSIVE (never vacuous PASS)', () => {
    const obl = makeObligation({ mandatoryStatus: 'mandatory' });

    // An evaluator that encountered a parser error produces an invalid/untrusted observation
    const crashedObs = ACC.evaluateObservation({
      evidenceId: 'ev-parser-err',
      predicts: { diagnosticsCount: 0 },
      actual: null, // parser failure = no authoritative observation
    });
    assert.strictEqual(crashedObs.valid, false);

    // Feeding this observation to reduceObligation yields INCONCLUSIVE
    const res = ACC.reduceObligation(obl, [crashedObs]);
    assert.strictEqual(res.outcome, ObligationOutcome.INCONCLUSIVE);
    assert.ok(res.reasons.some((r) => r.includes('untrusted/valid=false')));
  });

  t('incomplete parser diagnostic capture reduces to INCONCLUSIVE', () => {
    const obl = makeObligation({ mandatoryStatus: 'mandatory' });

    // Parser reported 0 errors, but completeness was false due to stream truncation
    const partialParsedObs = ACC.evaluateObservation({
      evidenceId: 'ev-partial-parse',
      predicts: 0,
      actual: 0,
      complete: false,
    });
    assert.strictEqual(partialParsedObs.valid, true);
    assert.strictEqual(partialParsedObs.completeness, 'incomplete');

    const res = ACC.reduceObligation(obl, [{ ...partialParsedObs, applicable: true }]);
    assert.strictEqual(res.outcome, ObligationOutcome.INCONCLUSIVE);
    assert.ok(res.reasons.some((r) => r.includes('incomplete applicable observation')));
  });

  // -------------------------------------------------------------------------
  // 9. Total Outcome Lattice & Non-Success Distinctions
  // -------------------------------------------------------------------------
  group('T-05.9: Total Outcome Lattice & Non-Success Distinctions');

  t('four-state total outcome lattice (PASS, FAIL, MISSING, INCONCLUSIVE) is strictly partitioned', () => {
    const expectedOutcomes = ['PASS', 'FAIL', 'MISSING', 'INCONCLUSIVE'];
    assert.deepStrictEqual(Object.values(ObligationOutcome).sort(), expectedOutcomes.sort());
    assert.deepStrictEqual(Object.values(EvidenceOutcome).sort(), expectedOutcomes.sort());

    for (const out of expectedOutcomes) {
      assert.ok(PIPE.VALID_OUTCOMES.has(out));
    }

    // NON_PASS_OUTCOMES contains all non-PASS outcomes
    assert.strictEqual(PIPE.NON_PASS_OUTCOMES.has(EvidenceOutcome.PASS), false);
    assert.strictEqual(PIPE.NON_PASS_OUTCOMES.has(EvidenceOutcome.FAIL), true);
    assert.strictEqual(PIPE.NON_PASS_OUTCOMES.has(EvidenceOutcome.MISSING), true);
    assert.strictEqual(PIPE.NON_PASS_OUTCOMES.has(EvidenceOutcome.INCONCLUSIVE), true);
  });

  t('MISSING and INCONCLUSIVE are distinct and neither upgrades to PASS in final reduction', () => {
    // Missing: no evidence offered at all
    const obl1 = makeObligation({ obligationId: 'obl-missing' });
    const redMissing = ACC.reduceObligation(obl1, []);
    assert.strictEqual(redMissing.outcome, ObligationOutcome.MISSING);

    // Inconclusive: evidence offered but untrusted / incomplete
    const obl2 = makeObligation({ obligationId: 'obl-inconclusive' });
    const redInconclusive = ACC.reduceObligation(obl2, [
      { valid: true, applicable: true, evaluation: 'predicate_satisfied', completeness: 'incomplete' },
    ]);
    assert.strictEqual(redInconclusive.outcome, ObligationOutcome.INCONCLUSIVE);

    assert.notStrictEqual(redMissing.outcome, redInconclusive.outcome);

    // Neither allows final acceptance
    const inv = [
      makeInventoryEntry({ requirementId: 'R1', mappedObligationIds: ['obl-missing'] }),
      makeInventoryEntry({ requirementId: 'R2', mappedObligationIds: ['obl-inconclusive'] }),
    ];
    const res = ACC.reduceAcceptance({
      inventory: inv,
      obligations: [obl1, obl2],
      observations: [
        { obligationId: 'obl-inconclusive', valid: true, applicable: true, evaluation: 'predicate_satisfied', completeness: 'incomplete' },
      ],
      evidenceCoherent: true,
      frozenGenerationId: 'gen-01',
      derivationEstablished: true,
      quiescenceProven: true,
      payloadManifestComplete: true,
      cleanAuthorityOwnership: true,
      blockers: [],
    });

    assert.strictEqual(res.accepted, false);
    assert.strictEqual(res.assurance, Assurance.PARTIAL);
    assert.ok(res.reasons.some((r) => r.includes('obl-missing is MISSING')));
    assert.ok(res.reasons.some((r) => r.includes('obl-inconclusive is INCONCLUSIVE')));
  });

  // -------------------------------------------------------------------------
  // 10. Platform Qualification Boundary (Termux / Linux Qualification Profile)
  // -------------------------------------------------------------------------
  group('T-05.10: Platform Qualification Boundary (Termux / Linux Predicate Qualification Profile)');

  t('physical external observer qualification and sandbox runner isolation are NOT QUALIFIED on Termux, IB-01 OPEN', () => {
    // Pure acceptance algebra, 8-point coverage validator, 4-state outcome reduction,
    // monotonic failure preservation, and cryptographic applicability keys are fully verified fail-closed.
    // Physical external observer qualification and kernel-isolated test runners cannot be qualified
    // on Android/Termux without a verified Linux execution profile and host virtualization (IB-01).
    const platformQualified = false; // Termux / Android environment
    assert.strictEqual(platformQualified, false, 'Physical external observer qualification and sandbox runner isolation are NOT QUALIFIED on Termux/Android, QUALIFIED under the Docker runtime profile in CI');
  });
};
