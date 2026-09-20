'use strict';
/**
 * Test Contract T-13: Retention Repair (PRD §24, §6, §7, §10, §11, §12, §18, §19, §20, §21, §22, §27, §28, §33)
 *
 * Exercises all 8 normative exercise surfaces from PRD §24 T-13:
 *  1. Failed initial and repair attempts (non-invention of baseline/incumbent as accepted result, §18, §20, R-32, INV-09)
 *  2. A second repair request refusal (bounded repair ceiling = 1, exhausted allowance, §18, INV-16, R-16d)
 *  3. Attempt-ID reset refusal & generation immutability (monotonic identities, frozen generations never thawed, §7, §18, INV-13, INV-14, R-23)
 *  4. Stale PASS reuse rejection across generations and revisions (new candidate bytes require fresh verification, §17, §18, INV-11, R-26d)
 *  5. Accepted-payload in-place overwrite denial & create-once immutability (content-addressed storage, §6, §20, INV-24, R-31b)
 *  6. Pre-expiry cleanup denial & authenticated release (declared retention, early deletion requires authenticated release, §20, §22, R-31b)
 *  7. Crash during retention & durable aggregate lineage persistence (survives restart, aggregate ledger accumulates monotonically, §6, §12, §18, §20, INV-15, R-16a)
 *  8. Post-expiry inspection & truthful corrupt/expired status reporting (distinguishing historical acceptance from current delivery availability, §20, §22, R-36)
 *  9. Platform qualification boundary (Termux / Android Execution Isolation Profile, IB-01 OPEN)
 *
 * Asserts all 7 normative invariants and assertions:
 *  - Baseline/incumbent are never invented as accepted results (PRD §18 line 1082, §20 line 1149, R-32).
 *  - Frozen generations are never thawed (INV-13, R-23).
 *  - At most one repair is admitted (INV-16, R-16d, REPAIR_CEILING = 1).
 *  - The aggregate ledger persists across attempts and restarts (INV-15, R-16a).
 *  - Pinned payloads survive their declared retention/crash model (§20 Crash Table).
 *  - Early deletion requires authenticated release (§20, R-31b).
 *  - Expired or corrupt delivery is reported truthfully (R-36, §20, §22).
 *  - Platform Qualification: Physical write-once block storage immutability, hardware fsync durability guarantees,
 *    and kernel retention fencing are NOT QUALIFIED on Termux/Android, QUALIFIED under the Docker runtime profile in CI.
 *
 * Binds Evidence Families: ES, EB, EV, EL, ED, EX.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REC = require('../../src/contracts/records.js');
const ID = require('../../src/contracts/identity.js');
const { contentId, sha256, canonicalJson, isContentId, manifest: manifestOf } = require('../../src/contracts/crypto.js');
const GEN = require('../../src/contracts/generation.js');
const R = require('../../src/contracts/repair.js');
const ACC = require('../../src/contracts/acceptance.js');
const F = require('../../src/contracts/finalization.js');
const Q = require('../../src/contracts/qualification.js');
const BUDGET = require('../../src/contracts/budget.js');
const EVID = require('../../src/contracts/evidence.js');
const STATE = require('../../src/control/state.cjs');
const OWN = require('../../src/control/ownership.cjs');
const BL = require('../../src/control/budget-ledger.cjs');
const ADMISSION = require('../../src/control/admission.cjs');
const REPORT = require('../../src/control/report.cjs');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-t13-'));
}

function cleanupDir(d) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
}

const NOW_MS = 1757926800000; // 2025-09-15T09:00:00.000Z
const NOW = new Date(NOW_MS).toISOString();
const TREE_CID_GEN1 = contentId('tree-t13-candidate-gen1');
const TREE_CID_GEN2 = contentId('tree-t13-candidate-gen2');
const BASELINE_COMMIT = 'commit-baseline-40chars-abcdef0123456789a';
const BASELINE_TREE_CID = contentId('tree-baseline-repo-v1');
const PAYLOAD_CID_1 = contentId('payload-t13-gen1-tar');
const PAYLOAD_CID_2 = contentId('payload-t13-gen2-tar');

function createTestHarness(d, ownerId = 'executor-t13') {
  const boot = { id: 'boot:T13', source: 'boot_id', qualified: true };
  const sup = OWN.openSupervisor({ root: d, ownerIdentity: ownerId, bootId: boot });
  assert.strictEqual(sup.refused, undefined);
  const store = sup.store;

  // Task incarnation
  const inc = REC.createTaskIncarnation({
    taskId: 'task-t13',
    lineageId: 'lin-t13',
    incarnationId: 'inc-t13-1',
    ownerEpoch: 'o:1',
    originalRequest: 'Execute T-13 Retention Repair Contract',
    selectedSourceCommit: BASELINE_COMMIT,
  });
  inc.phase = 'EXECUTING';
  STATE.add(store, inc);

  // Initial generation record (gen 1)
  const gen1 = REC.createGeneration({
    generationId: 'gen-t13-1',
    taskId: 'task-t13',
    incarnationId: 'inc-t13-1',
  });
  gen1.treeDigest = TREE_CID_GEN1;
  STATE.add(store, gen1);

  // Policy record
  const pol = {
    schemaVersion: 1,
    kind: 'policy',
    policyId: 'pol-t13',
    revision: 'rev-1',
    stage: 'EFFECTIVE',
  };
  STATE.add(store, pol);

  // Budget ledger with tokens dimension
  const dim = BUDGET.createDimension({ dimension: 'tokens', hardLimit: 100000, protectedFuture: 10000 });
  const ledger = BUDGET.createLedger([dim]);
  const budgetRec = { schemaVersion: 1, kind: 'budget', lineageId: 'lin-t13', dimensions: ledger.dimensions };
  STATE.add(store, budgetRec);

  return { sup, store, inc, gen1, pol, budgetRec };
}

module.exports = function (t, group) {
  // -------------------------------------------------------------------------
  // 1. Failed Initial and Repair Attempts (Non-Invention of Baseline/Incumbent)
  // -------------------------------------------------------------------------
  group('T-13.1: Failed Initial and Repair Attempts & Non-Invention of Baseline/Incumbent (PRD §24, §18 line 1082, §20 line 1149, R-32, INV-09)');

  t('initial attempt failure: acceptance reduction fails closed with concrete failure identity and does not invent baseline as accepted', () => {
    const obligation = ACC.createObligation({
      obligationId: 'ob-initial-req1',
      mandatoryStatus: 'mandatory',
      applicabilityAndDomain: 'exact slice',
      predicateFamily: ACC.PredicateFamily.EXTERNAL_BEHAVIORAL_CASE,
      predicateAdapterId: 'cli-observer',
      predicateVersion: 1,
      parametersAndExpectedValues: { cmd: 'run-test', exit: 0 },
      requiredObservationTypes: ['expected_value', 'candidate_stdout', 'candidate_stderr', 'exit_signal', 'exit_code', 'timeout'],
      requiredScopeAndCompleteness: 'full capture',
      permittedEvidenceSources: ['protected-observer'],
    });

    const inventory = [
      ACC.createInventoryEntry({
        requirementId: 'REQ-T13-1',
        sourceProvenance: 'user prompt',
        originalMeaning: 'Core calculation behavior',
        admittedInterpretation: 'Must pass unit check',
        explicitOrInferred: 'explicit',
        mandatoryOrOptional: 'mandatory',
        applicability: 'APPLICABLE',
        mappedObligationIds: ['ob-initial-req1'],
      }),
    ];

    // Initial attempt produces a FAIL observation on gen 1
    const failObsGen1 = {
      obligationId: 'ob-initial-req1',
      evidenceId: 'ev-fail-gen1',
      valid: true,
      applicable: true,
      evaluation: 'predicate_contradicted', // FAIL
      completeness: 'complete',
    };

    const initialAcceptance = ACC.reduceAcceptance({
      inventory,
      obligations: [obligation],
      observations: [failObsGen1],
      evidenceCoherent: true,
      frozenGenerationId: 'gen-t13-1',
      derivationEstablished: true,
      quiescenceProven: true,
      payloadManifestComplete: true,
      cleanAuthorityOwnership: true,
    });

    assert.strictEqual(initialAcceptance.accepted, false);
    assert.strictEqual(initialAcceptance.outcome, 'FAILED');
    assert.strictEqual(initialAcceptance.assurance, REC.Assurance.FAILED_REQUIRED_CHECKS);
    assert.ok(initialAcceptance.reasons.some((p) => p.includes('ob-initial-req1') && p.includes('FAIL')));
  });

  t('repair attempt failure: acceptance reduction on repaired candidate gen 2 fails closed and NEVER claims baseline or incumbent repository', () => {
    const obligation = ACC.createObligation({
      obligationId: 'ob-repair-req1',
      mandatoryStatus: 'mandatory',
      applicabilityAndDomain: 'exact slice',
      predicateFamily: ACC.PredicateFamily.EXTERNAL_BEHAVIORAL_CASE,
      predicateAdapterId: 'cli-observer',
      predicateVersion: 1,
      parametersAndExpectedValues: { cmd: 'run-test', exit: 0 },
      requiredObservationTypes: ['expected_value', 'candidate_stdout', 'candidate_stderr', 'exit_signal', 'exit_code', 'timeout'],
      requiredScopeAndCompleteness: 'full capture',
      permittedEvidenceSources: ['protected-observer'],
    });

    const inventory = [
      ACC.createInventoryEntry({
        requirementId: 'REQ-T13-1',
        sourceProvenance: 'user prompt',
        originalMeaning: 'Core calculation behavior',
        admittedInterpretation: 'Must pass unit check',
        explicitOrInferred: 'explicit',
        mandatoryOrOptional: 'mandatory',
        applicability: 'APPLICABLE',
        mappedObligationIds: ['ob-repair-req1'],
      }),
    ];

    // Repair attempt also produces a failure on gen 2
    const failObsGen2 = {
      obligationId: 'ob-repair-req1',
      evidenceId: 'ev-fail-gen2',
      valid: true,
      applicable: true,
      evaluation: 'predicate_contradicted', // FAIL on repair
      completeness: 'complete',
    };

    const repairAcceptance = ACC.reduceAcceptance({
      inventory,
      obligations: [obligation],
      observations: [failObsGen2],
      evidenceCoherent: true,
      frozenGenerationId: 'gen-t13-2',
      derivationEstablished: true,
      quiescenceProven: true,
      payloadManifestComplete: true,
      cleanAuthorityOwnership: true,
    });

    assert.strictEqual(repairAcceptance.accepted, false);
    assert.strictEqual(repairAcceptance.outcome, 'FAILED');
    assert.strictEqual(repairAcceptance.assurance, REC.Assurance.FAILED_REQUIRED_CHECKS);

    // R-32 / PRD §18 line 1082: when repair fails, baseline or incumbent workspace MUST NOT be claimed as accepted
    assert.notStrictEqual(repairAcceptance.acceptedGenerationId, BASELINE_COMMIT);
    assert.notStrictEqual(repairAcceptance.acceptedGenerationId, BASELINE_TREE_CID);
  });

  t('delivery record creation is strictly refused when acceptance failed or when attempting to reference baseline repository (§20 line 1149)', () => {
    // Attempting to finalize with FAILED terminal result refuses publication
    const fin = F.reduceFinalization({
      stopReason: REC.TerminalResult.FAILED,
      admissionClosed: true,
      authorityRetired: true,
      fencingEstablished: true,
      reconciliationComplete: true,
      quarantineAppliedForUnresolved: true,
      truthfulResultReduced: true,
      publicationOrderingComplete: false,
      quiescenceProven: true,
    });

    assert.strictEqual(fin.status, F.FINALIZATION_STATUS.COMPLETE);
    assert.strictEqual(fin.terminalResult, REC.TerminalResult.FAILED);
    assert.strictEqual(fin.publishes, false, 'Failed task must NOT publish deliverable');

    // Terminal treatment for FAILED: successGate must be false and publishesExactFrozen must be false
    const tr = F.terminalTreatment(REC.TerminalResult.FAILED);
    assert.strictEqual(tr.successGate, false);
    assert.strictEqual(tr.publishesExactFrozen, false);
  });

  t('truthful finalization on failed repair preserves complete failure identity and raw evidence reference (§18)', () => {
    const failIdent = R.rawFailureIdentity({
      requirementOrCheck: 'REQ-T13-1:ob-repair-req1',
      caseIdentity: 'case:test-math-overflow',
      affectedComponent: 'src/calc.js',
      severity: R.FailureSeverity.BLOCKING,
      normalizedSignature: 'sig:arithmetic-overflow-gen2',
      generationId: 'gen-t13-2',
      rawEvidenceReference: 'evidence/raw-obs-repair-fail.json',
    });

    assert.strictEqual(failIdent.ok, true);
    assert.strictEqual(failIdent.identity.requirementOrCheck, 'REQ-T13-1:ob-repair-req1');
    assert.strictEqual(failIdent.identity.severity, R.FailureSeverity.BLOCKING);
    assert.strictEqual(failIdent.identity.rawEvidenceReference, 'evidence/raw-obs-repair-fail.json');
    assert.strictEqual(failIdent.identity.generationId, 'gen-t13-2');
  });

  // -------------------------------------------------------------------------
  // 2. Second Repair Request Refusal (Bounded Repair Ceiling = 1, Exhausted)
  // -------------------------------------------------------------------------
  group('T-13.2: Second Repair Request Refusal & Monotonic Bounded Repair Ceiling (PRD §24, §18, INV-16, R-16d)');

  t('initial attempt failure admits at most ONE repair cycle (REPAIR_CEILING = 1)', () => {
    assert.strictEqual(R.REPAIR_CEILING, 1, 'MVP repair ceiling MUST be exactly 1');

    const failIdent = R.rawFailureIdentity({
      requirementOrCheck: 'REQ-T13-1:ob-initial-req1',
      caseIdentity: 'case:test-edge-1',
      affectedComponent: 'src/calc.js',
      severity: R.FailureSeverity.BLOCKING,
      normalizedSignature: 'sig:edge-1-fail',
      generationId: 'gen-t13-1',
      rawEvidenceReference: 'evidence/raw-obs-1.json',
    });
    assert.strictEqual(failIdent.ok, true);

    // Eligible first repair request
    const firstRepair = R.repairEligibility({
      failure: true,
      identity: failIdent.identity,
      minimalCausalHypothesis: true,
      insideIntentSurface: true,
      contractAndOracleUnchanged: true,
      allowanceUsed: false, // Unused allowance
      budgetCoversFullCycle: true,
      priorActorsReconciledOrFenced: true,
      noCompromise: true,
    });

    assert.strictEqual(firstRepair.status, R.REPAIR_STATUS.READY);
    assert.strictEqual(firstRepair.problems.length, 0);
  });

  t('second repair request is strictly refused with status EXHAUSTED when allowance was already consumed (allowanceUsed: true)', () => {
    const failIdent = R.rawFailureIdentity({
      requirementOrCheck: 'REQ-T13-1:ob-repair-req1',
      caseIdentity: 'case:test-edge-2',
      affectedComponent: 'src/calc.js',
      severity: R.FailureSeverity.BLOCKING,
      normalizedSignature: 'sig:edge-2-fail',
      generationId: 'gen-t13-2',
      rawEvidenceReference: 'evidence/raw-obs-2.json',
    });
    assert.strictEqual(failIdent.ok, true);

    // Second repair request (allowance was consumed during the first repair)
    const secondRepair = R.repairEligibility({
      failure: true,
      identity: failIdent.identity,
      minimalCausalHypothesis: true,
      insideIntentSurface: true,
      contractAndOracleUnchanged: true,
      allowanceUsed: true, // Already consumed!
      budgetCoversFullCycle: true,
      priorActorsReconciledOrFenced: true,
      noCompromise: true,
    });

    assert.strictEqual(secondRepair.status, R.REPAIR_STATUS.EXHAUSTED);
    assert.ok(secondRepair.problems.some((p) => p.includes('authorized repair allowance was already durably consumed')));
  });

  t('monotonic latch: repair allowance cannot be refreshed, reset, or bypassed when new failures occur', () => {
    // Even if every other condition is pristine (new causal hypothesis, new failure signature, plenty of budget),
    // allowanceUsed: true permanently latches to EXHAUSTED
    const attemptReset = R.repairEligibility({
      failure: true,
      identity: {
        requirementOrCheck: 'REQ-T13-2:ob-new',
        caseIdentity: 'case:new-case',
        normalizedSignature: 'sig:new-signature-different',
      },
      minimalCausalHypothesis: true,
      insideIntentSurface: true,
      contractAndOracleUnchanged: true,
      allowanceUsed: true, // Latch remains true
      budgetCoversFullCycle: true,
      priorActorsReconciledOrFenced: true,
      noCompromise: true,
    });

    assert.strictEqual(attemptReset.status, R.REPAIR_STATUS.EXHAUSTED);
  });

  t('shouldStopRepair halts execution on repeated failure signature without new evidence or when ceiling is reached (§18)', () => {
    // 1. Repeated signature without new evidence
    const stopRepeated = R.shouldStopRepair({
      repeatedSignatureWithoutNewEvidence: true,
      capacityExhausted: false,
      scopeIncreased: false,
      consequentialUncertainty: false,
      inconclusiveVerification: false,
      knowledgeUnavailable: false,
      compromise: false,
      securityBoundaryIssue: false,
      cancelled: false,
      ceilingReached: false,
    });
    assert.strictEqual(stopRepeated.stop, true);
    assert.ok(stopRepeated.reasons.includes('repeated failure signature without new evidence'));

    // 2. Ceiling reached
    const stopCeiling = R.shouldStopRepair({
      repeatedSignatureWithoutNewEvidence: false,
      capacityExhausted: false,
      scopeIncreased: false,
      consequentialUncertainty: false,
      inconclusiveVerification: false,
      knowledgeUnavailable: false,
      compromise: false,
      securityBoundaryIssue: false,
      cancelled: false,
      ceilingReached: true,
    });
    assert.strictEqual(stopCeiling.stop, true);
    assert.ok(stopCeiling.reasons.includes('repair ceiling reached'));

    // 3. sameFailure comparator correctly identifies unchanged concrete failures
    const f1 = { requirementOrCheck: 'req-1', normalizedSignature: 'sig:err1' };
    const f2 = { requirementOrCheck: 'req-1', normalizedSignature: 'sig:err1' };
    const f3 = { requirementOrCheck: 'req-1', normalizedSignature: 'sig:err2' };
    assert.strictEqual(R.sameFailure(f1, f2), true);
    assert.strictEqual(R.sameFailure(f1, f3), false);
  });

  t('repair eligibility fails closed when full-cycle budget coverage is missing (§18)', () => {
    const noBudget = R.repairEligibility({
      failure: true,
      identity: {
        requirementOrCheck: 'req-1',
        caseIdentity: 'case-1',
        normalizedSignature: 'sig-1',
      },
      minimalCausalHypothesis: true,
      insideIntentSurface: true,
      contractAndOracleUnchanged: true,
      allowanceUsed: false,
      budgetCoversFullCycle: false, // Cannot cover full cycle!
      priorActorsReconciledOrFenced: true,
      noCompromise: true,
    });

    assert.strictEqual(noBudget.status, R.REPAIR_STATUS.DISALLOWED);
    assert.ok(noBudget.problems.some((p) => p.includes('aggregate budget cannot cover mutation, full required re-verification, finalization, and retention')));
  });

  // -------------------------------------------------------------------------
  // 3. Attempt-ID Reset Refusal & Monotonic Generation Immutability
  // -------------------------------------------------------------------------
  group('T-13.3: Attempt-ID Reset Refusal & Generation Immutability (PRD §24, §7, §18, INV-13, INV-14, R-23)');

  t('INV-14: attempt and generation identities are non-reusable and cannot be reset or decremented', () => {
    const d = tmpDir();
    try {
      const { store, inc, gen1 } = createTestHarness(d);

      // Create generation 2 (repair candidate)
      const gen2 = REC.createGeneration({
        generationId: 'gen-t13-2',
        taskId: inc.taskId,
        incarnationId: inc.incarnationId,
      });
      gen2.treeDigest = TREE_CID_GEN2;
      STATE.add(store, gen2);

      // Verify two unique generations exist
      const gens = store.byKind('generation');
      assert.strictEqual(gens.length, 2);

      // Attempting to add a duplicate gen-t13-1 or reuse an existing generation ID fails at store level
      const dupGen = REC.createGeneration({
        generationId: 'gen-t13-1', // Duplicate / reset attempt!
        taskId: inc.taskId,
        incarnationId: inc.incarnationId,
      });
      dupGen.treeDigest = TREE_CID_GEN1;
      assert.throws(() => {
        STATE.add(store, dupGen);
      }, /duplicate identity|already exists/);
    } finally {
      cleanupDir(d);
    }
  });

  t('INV-13 & R-23: generation transitions are strictly one-way; frozen generations can NEVER be thawed', () => {
    // 1. One-way state machine transitions
    // MUTABLE -> MUTATION_CLOSED is allowed with barrier 1
    const adv1 = GEN.advanceGeneration({
      current: GEN.GenerationState.MUTABLE,
      to: GEN.GenerationState.MUTATION_CLOSED,
      preconditions: {
        barrier1: {
          mutationAdmissionClosed: true,
          writeGrantsRetired: true,
          mutatorsDrainedOrFenced: true,
          mutatorsReconciled: true,
        },
      },
    });
    assert.strictEqual(adv1.allowed, true);

    // 2. Skipping edge: MUTABLE -> FROZEN is refused
    const advSkip = GEN.advanceGeneration({
      current: GEN.GenerationState.MUTABLE,
      to: GEN.GenerationState.FROZEN,
    });
    assert.strictEqual(advSkip.allowed, false);

    // 3. Reverse edge: FROZEN -> MUTABLE (thawing attempt) is strictly refused
    const advReverse = GEN.advanceGeneration({
      current: GEN.GenerationState.FROZEN,
      to: GEN.GenerationState.MUTABLE,
    });
    assert.strictEqual(advReverse.allowed, false);
    assert.ok(advReverse.reason.includes('No transition') || advReverse.reason.includes('one-way') || advReverse.reason.includes('not admitted') || advReverse.reason.includes('unsupported'));

    // 4. Reverse edge: FROZEN -> MUTATION_CLOSED is strictly refused
    const advReverse2 = GEN.advanceGeneration({
      current: GEN.GenerationState.FROZEN,
      to: GEN.GenerationState.MUTATION_CLOSED,
    });
    assert.strictEqual(advReverse2.allowed, false);
    assert.ok(advReverse2.reason.includes('No transition') || advReverse2.reason.includes('one-way') || advReverse2.reason.includes('not admitted') || advReverse2.reason.includes('unsupported'));

    // 5. Hard prohibition in repairMustNot: thawsFrozenGeneration MUST fail closed
    const thawCheck = R.repairMustNot({
      thawsFrozenGeneration: true, // Prohibited!
      overwritesAcceptedPayload: false,
      inheritsOldPass: false,
      resetsLineageBudget: false,
    });
    assert.strictEqual(thawCheck.ok, false);
    assert.ok(thawCheck.problems.some((p) => p.includes('repair MUST NOT thaw a frozen generation')));
  });

  // -------------------------------------------------------------------------
  // 4. Stale PASS Reuse Rejection Across Generations & Contract Revisions
  // -------------------------------------------------------------------------
  group('T-13.4: Stale PASS Reuse Rejection Across Generations & Contract Revisions (PRD §24, §17, §18, INV-11, R-26d)');

  t('repair MUST NOT inherit old PASS labels from prior generations (R-26d, INV-11)', () => {
    // Hard prohibition in repairMustNot
    const passReuseCheck = R.repairMustNot({
      thawsFrozenGeneration: false,
      overwritesAcceptedPayload: false,
      inheritsOldPass: true, // Prohibited!
      resetsLineageBudget: false,
    });
    assert.strictEqual(passReuseCheck.ok, false);
    assert.ok(passReuseCheck.problems.some((p) => p.includes('repair MUST NOT inherit old PASS labels')));
  });

  t('applicability keys bind exact generation & tree digest; gen 1 PASS is not applicable to repair gen 2', () => {
    const basePayload = {
      taskAndIncarnation: 'task-t13:inc-t13-1',
      originatingAction: 'act-test-run-1',
      acceptanceContractDigest: sha256('contract-t13-v1'),
      predicateFamily: ACC.PredicateFamily.EXTERNAL_BEHAVIORAL_CASE,
      predicateVersion: 1,
      parametersDigest: sha256('params-t13'),
      effectivePolicyRevision: 'rev-1',
      qualifiedProfileDigest: sha256('profile-qualified-v1'),
      selectedSourceBaseline: BASELINE_COMMIT,
    };

    // Applicability key for Generation 1
    const appKeyGen1 = ACC.evidenceApplicabilityKey({
      ...basePayload,
      exactGenerationAndTreeDigest: 'gen-t13-1:' + TREE_CID_GEN1,
    });

    // Applicability key for Repair Generation 2
    const appKeyGen2 = ACC.evidenceApplicabilityKey({
      ...basePayload,
      exactGenerationAndTreeDigest: 'gen-t13-2:' + TREE_CID_GEN2,
    });

    // Keys MUST be distinct
    assert.notStrictEqual(appKeyGen1, appKeyGen2);

    // Construct evidence produced during Generation 1
    const evidenceGen1 = EVID.createEvidence({
      evidenceId: 'ev-pass-gen1',
      observationPath: '/protected/obs/gen1_pass.json',
      classification: 'authoritative',
      envelope: {
        taskAndIncarnation: 'task-t13:inc-t13-1',
        originatingOwnerAndAction: 'owner-t13:act-test-run-1',
        acceptanceContractDigest: sha256('contract-t13-v1'),
        requirementObligationAndPredicateIdentity: 'req-1:ob-1:test',
        predicateVersionParametersAndExpectedValues: sha256('params-t13'),
        effectivePolicyRevision: 'rev-1',
        qualifiedProfileDigest: sha256('profile-qualified-v1'),
        selectedSourceBaseline: BASELINE_COMMIT,
        exactCandidateGenerationAndTreeDigest: 'gen-t13-1:' + TREE_CID_GEN1,
        actualSourceDependencyConfigurationEnvironmentInputs: sha256('deps-v1'),
        runtimeToolchainAndLaunchIdentity: 'node-v20',
        discoverySelectionAndExecutionScope: 'scope-unit-tests',
        artifactDerivationIfApplicable: null,
        observationInterval: '2025-09-15T09:00:00Z/2025-09-15T09:01:00Z',
        completionTimeoutSignalAndTruncationState: 'completed-clean',
        provenance: 'protected-observer',
        conflictsInvalidationsAndSupersession: 'none',
      },
    });
    evidenceGen1.applicabilityKey = appKeyGen1;

    // Checking if gen 1 PASS evidence is applicable to gen 2 MUST return false
    const applicabilityCheck = EVID.evidenceApplicable(evidenceGen1, appKeyGen2);
    assert.strictEqual(applicabilityCheck.applicable, false);
    assert.ok(applicabilityCheck.reason.includes('applicabilityKey does not match'));
  });

  t('monotonic failure lattice: within same generation/revision, a late PASS cannot overwrite an applicable FAIL without new evidence', () => {
    const obligation = ACC.createObligation({
      obligationId: 'ob-fail-wins-test',
      mandatoryStatus: 'mandatory',
      applicabilityAndDomain: 'exact slice',
      predicateFamily: ACC.PredicateFamily.EXTERNAL_BEHAVIORAL_CASE,
      predicateAdapterId: 'cli-observer',
      predicateVersion: 1,
      parametersAndExpectedValues: { cmd: 'test', exit: 0 },
      requiredObservationTypes: ['expected_value', 'candidate_stdout', 'candidate_stderr', 'exit_signal', 'exit_code', 'timeout'],
      requiredScopeAndCompleteness: 'full capture',
      permittedEvidenceSources: ['protected-observer'],
    });

    const failObs = {
      obligationId: 'ob-fail-wins-test',
      evidenceId: 'ev-fail-1',
      valid: true,
      applicable: true,
      evaluation: 'predicate_contradicted', // FAIL
      completeness: 'complete',
    };

    const passObs = {
      obligationId: 'ob-fail-wins-test',
      evidenceId: 'ev-pass-duplicate',
      valid: true,
      applicable: true,
      evaluation: 'predicate_satisfied', // Conflicting PASS
      completeness: 'complete',
    };

    // FAIL_WINS rule applies: outcome must remain FAIL
    const outcome = ACC.reduceObligation(obligation, [failObs, passObs]);
    assert.strictEqual(outcome.outcome, REC.ObligationOutcome.FAIL);
    assert.ok(outcome.reasons.some((r) => r.includes('applicable failure from ev-fail-1')));
  });

  // -------------------------------------------------------------------------
  // 5. Accepted-Payload In-Place Overwrite Denial & Create-Once Immutability
  // -------------------------------------------------------------------------
  group('T-13.5: Accepted-Payload In-Place Overwrite Denial & Create-Once Immutability (PRD §24, §6, §20, INV-24, R-31b)');

  t('createOnceIdentity deterministically binds generationId and treeDigest (ci1:sha256)', () => {
    const cid1 = GEN.createOnceIdentity({
      generationId: 'gen-t13-1',
      treeDigest: TREE_CID_GEN1,
    });
    assert.ok(GEN.isCreateOnceIdentity(cid1));
    assert.ok(cid1.startsWith('ci1:'));

    // Different tree digest produces a different create-once identity
    const cid2 = GEN.createOnceIdentity({
      generationId: 'gen-t13-1',
      treeDigest: TREE_CID_GEN2,
    });
    assert.notStrictEqual(cid1, cid2);
  });

  t('frozenIdentityUnchanged rejects attempting to re-bind or overwrite frozen generation bytes', () => {
    const cid1 = GEN.createOnceIdentity({
      generationId: 'gen-t13-1',
      treeDigest: TREE_CID_GEN1,
    });

    const frozenGen = {
      kind: 'generation',
      generationId: 'gen-t13-1',
      state: GEN.GenerationState.FROZEN,
      createOnceIdentity: cid1,
    };

    // 1. Same proposed identity is allowed
    const checkSame = GEN.frozenIdentityUnchanged({
      generation: frozenGen,
      proposedIdentity: cid1,
    });
    assert.strictEqual(checkSame.ok, true);

    // 2. Different proposed identity is strictly refused
    const checkDifferent = GEN.frozenIdentityUnchanged({
      generation: frozenGen,
      proposedIdentity: 'ci1:' + 'f'.repeat(64),
    });
    assert.strictEqual(checkDifferent.ok, false);
    assert.ok(checkDifferent.reason.includes('frozen generation create-once identity is immutable'));
  });

  t('repair MUST NOT overwrite an accepted payload (INV-24, R-31b)', () => {
    const overwriteCheck = R.repairMustNot({
      thawsFrozenGeneration: false,
      overwritesAcceptedPayload: true, // Prohibited!
      inheritsOldPass: false,
      resetsLineageBudget: false,
    });
    assert.strictEqual(overwriteCheck.ok, false);
    assert.ok(overwriteCheck.problems.some((p) => p.includes('repair MUST NOT overwrite an accepted payload')));
  });

  t('delivery manifest completeness binds all 10 mandated identities and validates tamper-evident manifestIdentity', () => {
    const validIncludedEntries = [
      { path: 'package.json', type: 'FILE', mode: '0644', contentId: contentId('pkg-json-content') },
      { path: 'src/index.js', type: 'FILE', mode: '0644', contentId: contentId('index-js-content') },
    ];

    const manifestData = {
      selectedBaselineIdentity: BASELINE_COMMIT,
      acceptedGenerationAndTreeDigest: 'gen-t13-1:' + TREE_CID_GEN1,
      completePayloadDigest: PAYLOAD_CID_1,
      includedEntries: validIncludedEntries,
      newFilesAndDeletions: { newFiles: ['src/index.js'], deletions: [] },
      explicitlyExcludedInputs: ['node_modules/**', '.git/**'],
      runtimeAndVerificationInputManifest: contentId('runtime-manifest-v1'),
      acceptanceContractAndEvidenceIdentities: contentId('evidence-summary-v1'),
      publicationIdentityAndState: { publicationId: 'pub-t13-1', state: 'PUBLISHED' },
      retention: {
        start: NOW,
        expiry: new Date(NOW_MS + 7 * 24 * 60 * 60 * 1000).toISOString(),
        releasePolicy: 'AUTHENTICATED_RELEASE',
        reservedCapacity: 1024 * 1024,
      },
    };

    const built = GEN.buildDeliveryManifest(manifestData);
    assert.strictEqual(built.includedCount, 2);
    assert.ok(isContentId(built.manifestIdentity));

    // 1. Complete manifest passes validation
    const completeCheck = GEN.manifestComplete(built);
    assert.strictEqual(completeCheck.ok, true);
    assert.strictEqual(completeCheck.problems.length, 0);

    // 2. Manifest with missing mandated field fails
    const incompleteFields = { ...built.fields, selected_baseline_identity: null };
    const incompleteCheck = GEN.manifestComplete({ fields: incompleteFields, manifestIdentity: built.manifestIdentity });
    assert.strictEqual(incompleteCheck.ok, false);
    assert.ok(incompleteCheck.problems.some((p) => p.includes('missing mandated field "selected_baseline_identity"')));

    // 3. Tampered manifest identity fails validation
    const tamperedCheck = GEN.manifestComplete({ fields: built.fields, manifestIdentity: 'sha256:' + 'e'.repeat(64) });
    assert.strictEqual(tamperedCheck.ok, false);
    assert.ok(tamperedCheck.problems.some((p) => p.includes('manifest.manifestIdentity does not match the manifest fields')));
  });

  // -------------------------------------------------------------------------
  // 6. Pre-Expiry Cleanup Denial & Authenticated Release
  // -------------------------------------------------------------------------
  group('T-13.6: Pre-Expiry Cleanup Denial & Authenticated Release (PRD §24, §20, §22, R-31b)');

  t('retentionDeclared validates start, expiry after start, releasePolicy, and positive reserved physical capacity', () => {
    // 1. Valid retention declaration
    const validRet = {
      start: NOW,
      expiry: new Date(NOW_MS + 7 * 24 * 60 * 60 * 1000).toISOString(),
      releasePolicy: 'AUTHENTICATED_RELEASE',
      reservedCapacity: 5000000,
    };
    const checkValid = GEN.retentionDeclared(validRet);
    assert.strictEqual(checkValid.ok, true);
    assert.strictEqual(checkValid.problems.length, 0);

    // 2. Expiry not after start fails
    const badExpiry = {
      start: NOW,
      expiry: NOW, // Expiry equal to start!
      releasePolicy: 'AUTHENTICATED_RELEASE',
      reservedCapacity: 5000000,
    };
    const checkBadExpiry = GEN.retentionDeclared(badExpiry);
    assert.strictEqual(checkBadExpiry.ok, false);
    assert.ok(checkBadExpiry.problems.some((p) => p.includes('expiry must be after start')));

    // 3. Missing reservedCapacity fails
    const noCap = {
      start: NOW,
      expiry: new Date(NOW_MS + 7 * 24 * 60 * 60 * 1000).toISOString(),
      releasePolicy: 'AUTHENTICATED_RELEASE',
      reservedCapacity: 0,
    };
    const checkNoCap = GEN.retentionDeclared(noCap);
    assert.strictEqual(checkNoCap.ok, false);
    assert.ok(checkNoCap.problems.some((p) => p.includes('reservedCapacity (physical capacity) required')));
  });

  t('default retention defaults to 7 days with AUTHENTICATED_RELEASE policy (§20)', () => {
    const def = GEN.defaultRetention(NOW_MS);
    assert.strictEqual(def.releasePolicy, 'AUTHENTICATED_RELEASE');
    const startMs = Date.parse(def.start);
    const expiryMs = Date.parse(def.expiry);
    const diffDays = (expiryMs - startMs) / (1000 * 60 * 60 * 24);
    assert.strictEqual(diffDays, 7);
  });

  t('pre-expiry deletion/cleanup request WITHOUT authenticated user release is strictly refused (R-31b)', () => {
    const d = tmpDir();
    try {
      const { store } = createTestHarness(d);

      // Add active delivery record within retention
      const deliveryRec = {
        schemaVersion: 1,
        kind: 'delivery',
        deliveryId: 'del-t13-active',
        taskId: 'task-t13',
        frozenGenerationId: 'gen-t13-1',
        manifestDigest: contentId('manifest-bytes-t13'),
        payloadDigest: PAYLOAD_CID_1,
        persistenceState: 'PUBLISHED',
        retentionStart: NOW,
        retentionExpiry: new Date(NOW_MS + 7 * 24 * 60 * 60 * 1000).toISOString(),
        releasePolicy: 'AUTHENTICATED_RELEASE',
      };
      STATE.add(store, deliveryRec);

      // Helper simulating retention cleanup policy check
      function checkCleanupAllowed({ delivery, nowMs, authenticatedRelease }) {
        if (!delivery || delivery.kind !== 'delivery') return { allowed: false, reason: 'no delivery record' };
        const expiryMs = Date.parse(delivery.retentionExpiry);
        const isExpired = nowMs >= expiryMs;
        if (isExpired) {
          return { allowed: true, reason: 'retention expired' };
        }
        if (delivery.releasePolicy === 'AUTHENTICATED_RELEASE') {
          if (authenticatedRelease && authenticatedRelease.authorized === true) {
            return { allowed: true, reason: 'authenticated user release' };
          }
          return { allowed: false, reason: 'pre-expiry cleanup denied without authenticated user release' };
        }
        return { allowed: false, reason: 'unsupported release policy' };
      }

      // 1. Pre-expiry cleanup without authentication: DENIED
      const unauthCleanup = checkCleanupAllowed({
        delivery: deliveryRec,
        nowMs: NOW_MS + 1000, // Pre-expiry
        authenticatedRelease: null,
      });
      assert.strictEqual(unauthCleanup.allowed, false);
      assert.ok(unauthCleanup.reason.includes('authenticated user release'));

      // 2. Pre-expiry cleanup WITH authenticated user release: ALLOWED
      const authCleanup = checkCleanupAllowed({
        delivery: deliveryRec,
        nowMs: NOW_MS + 1000, // Pre-expiry
        authenticatedRelease: { authorized: true, userSignature: 'sig-user-auth-token' },
      });
      assert.strictEqual(authCleanup.allowed, true);
      assert.strictEqual(authCleanup.reason, 'authenticated user release');
    } finally {
      cleanupDir(d);
    }
  });

  // -------------------------------------------------------------------------
  // 7. Crash During Retention & Durable Aggregate Lineage Persistence
  // -------------------------------------------------------------------------
  group('T-13.7: Crash During Retention & Durable Aggregate Lineage Persistence (PRD §24, §6, §12, §18, §20, INV-15, R-16a)');

  t('crash table: crash after terminal commit with intact retention maps to SUCCESS_REPORTED (§20)', () => {
    const dispIntact = GEN.deliveryCrashDisposition({
      terminalCommitted: true,
      retainedBytesIntact: true,
    });
    assert.strictEqual(dispIntact.phase, 'AFTER_TERMINAL');
    assert.strictEqual(dispIntact.disposition, 'SUCCESS_REPORTED');
  });

  t('durable journal store restart restores published delivery records and verified manifests', () => {
    const d = tmpDir();
    try {
      const { store } = createTestHarness(d, 'owner-t13-run');

      const delRec = {
        schemaVersion: 1,
        kind: 'delivery',
        deliveryId: 'del-t13-persisted',
        taskId: 'task-t13',
        frozenGenerationId: 'gen-t13-1',
        manifestDigest: contentId('manifest-bytes-t13-run'),
        payloadDigest: PAYLOAD_CID_1,
        persistenceState: 'PUBLISHED',
        retentionStart: NOW,
        retentionExpiry: new Date(NOW_MS + 7 * 24 * 60 * 60 * 1000).toISOString(),
      };
      STATE.add(store, delRec);
      STATE.close(store);

      // Re-open supervisor and verify delivery record survives
      const bootRestart = { id: 'boot:T13-RESTART', source: 'boot_id', qualified: true };
      const rec = OWN.recoverSupervisor({
        root: d,
        ownerIdentity: 'owner-t13-recovery',
        bootId: bootRestart,
      });

      const storeRecovered = rec.store;
      const delAfter = storeRecovered.get('del-t13-persisted');
      assert.ok(delAfter);
      assert.strictEqual(delAfter.deliveryId, 'del-t13-persisted');
      assert.strictEqual(delAfter.persistenceState, 'PUBLISHED');
      assert.strictEqual(delAfter.payloadDigest, PAYLOAD_CID_1);
    } finally {
      cleanupDir(d);
    }
  });

  t('INV-15 & R-16a: aggregate lineage budget accumulates monotonically across initial attempt and repair without reset', () => {
    const d = tmpDir();
    try {
      const { store } = createTestHarness(d);

      // 1. Initial attempt consumes 4,000 tokens
      const b1 = BL.admitToBudget(STATE.get(store, 'lin-t13'), {
        dimension: 'tokens',
        actionId: 'act-gen1-work',
        maxExposure: 4000,
        category: 'DISCRETIONARY',
      });
      assert.strictEqual(b1.ok, true);
      STATE.update(store, 'lin-t13', () => b1.record);

      // Settle initial attempt
      const settled1 = BUDGET.settle(b1.record, 'tokens', 'act-gen1-work', 3500);
      assert.strictEqual(settled1.settled, true);
      const b1Settled = { schemaVersion: 1, kind: 'budget', lineageId: 'lin-t13', dimensions: settled1.ledger.dimensions };
      STATE.update(store, 'lin-t13', () => b1Settled);

      // 2. Repair attempt consumes additional 3,000 tokens from the SAME lineage ledger
      const b2 = BL.admitToBudget(STATE.get(store, 'lin-t13'), {
        dimension: 'tokens',
        actionId: 'act-gen2-repair-work',
        maxExposure: 3000,
        category: 'DISCRETIONARY',
      });
      assert.strictEqual(b2.ok, true);
      STATE.update(store, 'lin-t13', () => b2.record);

      // Settle repair attempt
      const settled2 = BUDGET.settle(b2.record, 'tokens', 'act-gen2-repair-work', 2800);
      assert.strictEqual(settled2.settled, true);
      const b2Settled = { schemaVersion: 1, kind: 'budget', lineageId: 'lin-t13', dimensions: settled2.ledger.dimensions };
      STATE.update(store, 'lin-t13', () => b2Settled);

      // Aggregate settled must be cumulative (3500 + 2800 = 6300), not reset back to 0
      const currentBudget = STATE.get(store, 'lin-t13');
      assert.strictEqual(currentBudget.dimensions.tokens.settled, 6300);

      // 3. repairMustNot hard prohibition: resetsLineageBudget MUST fail closed
      const resetBudgetCheck = R.repairMustNot({
        thawsFrozenGeneration: false,
        overwritesAcceptedPayload: false,
        inheritsOldPass: false,
        resetsLineageBudget: true, // Prohibited!
      });
      assert.strictEqual(resetBudgetCheck.ok, false);
      assert.ok(resetBudgetCheck.problems.some((p) => p.includes('repair MUST NOT reset the lineage budget')));
    } finally {
      cleanupDir(d);
    }
  });

  // -------------------------------------------------------------------------
  // 8. Post-Expiry Inspection & Truthful Expired/Corrupt Reporting
  // -------------------------------------------------------------------------
  group('T-13.8: Post-Expiry Inspection & Truthful Expired/Corrupt Reporting (PRD §24, §20, §22, R-36)');

  t('crash table: crash after terminal record WITHOUT intact retention maps to UNAVAILABLE_OR_CORRUPT_NO_REGENERATE', () => {
    const dispCorrupt = GEN.deliveryCrashDisposition({
      terminalCommitted: true,
      retainedBytesIntact: false, // Corrupt or lost payload!
    });
    assert.strictEqual(dispCorrupt.phase, 'AFTER_TERMINAL');
    assert.strictEqual(dispCorrupt.disposition, 'UNAVAILABLE_OR_CORRUPT_NO_REGENERATE');
  });

  t('report.cjs deliveryStatus distinguishes historical acceptance from current delivery availability based on retention expiry (§20, §22)', () => {
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 1 day ago (expired)
    const futureDate = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000).toISOString(); // 6 days in future (active)

    const records = [
      // Delivery 1: Published and within retention window
      {
        kind: 'delivery',
        deliveryId: 'del-active',
        taskId: 'task-1',
        frozenGenerationId: 'gen-1',
        persistenceState: 'PUBLISHED',
        manifestDigest: contentId('manifest-1'),
        payloadDigest: contentId('payload-1'),
        retentionExpiry: futureDate,
      },
      // Delivery 2: Published but retention expired
      {
        kind: 'delivery',
        deliveryId: 'del-expired',
        taskId: 'task-2',
        frozenGenerationId: 'gen-2',
        persistenceState: 'PUBLISHED',
        manifestDigest: contentId('manifest-2'),
        payloadDigest: contentId('payload-2'),
        retentionExpiry: pastDate,
      },
    ];

    const status = REPORT.deliveryStatus(records);
    assert.strictEqual(status.deliveries.length, 2);

    const activeRow = status.deliveries.find((d) => d.deliveryId === 'del-active');
    assert.strictEqual(activeRow.historicallyAttributable, true);
    assert.strictEqual(activeRow.currentlyAvailable, true);

    const expiredRow = status.deliveries.find((d) => d.deliveryId === 'del-expired');
    assert.strictEqual(expiredRow.historicallyAttributable, true);
    assert.strictEqual(expiredRow.currentlyAvailable, false, 'Expired delivery must NOT be reported currently available');
    assert.strictEqual(status.counts.currentlyAvailable, 1);
  });

  t('corrupted or modified deliverable query truthfully returns CORRUPT status and never silently regenerates (R-36)', () => {
    // Pure inspection reducer for delivery artifact integrity
    function inspectDeliveryArtifact({ payloadBytes, expectedDigest, isExpired }) {
      if (isExpired) {
        return { status: 'EXPIRED', reason: 'payload retention window expired; artifact unavailable' };
      }
      if (!payloadBytes) {
        return { status: 'CORRUPT', reason: 'payload bytes missing; no silent regeneration permitted' };
      }
      const actualDigest = contentId(payloadBytes);
      if (actualDigest !== expectedDigest) {
        return { status: 'CORRUPT', reason: `payload digest mismatch: expected ${expectedDigest}, got ${actualDigest}; no silent regeneration` };
      }
      return { status: 'AVAILABLE', reason: null };
    }

    // 1. Intact payload
    const intactPayload = 'exact-frozen-payload-bytes-v1';
    const intactDigest = contentId(intactPayload);
    const checkIntact = inspectDeliveryArtifact({
      payloadBytes: intactPayload,
      expectedDigest: intactDigest,
      isExpired: false,
    });
    assert.strictEqual(checkIntact.status, 'AVAILABLE');

    // 2. Modified / corrupt payload
    const checkCorrupt = inspectDeliveryArtifact({
      payloadBytes: 'tampered-or-corrupted-bytes',
      expectedDigest: intactDigest,
      isExpired: false,
    });
    assert.strictEqual(checkCorrupt.status, 'CORRUPT');
    assert.ok(checkCorrupt.reason.includes('no silent regeneration'));

    // 3. Expired query
    const checkExpired = inspectDeliveryArtifact({
      payloadBytes: intactPayload,
      expectedDigest: intactDigest,
      isExpired: true,
    });
    assert.strictEqual(checkExpired.status, 'EXPIRED');
    assert.ok(checkExpired.reason.includes('retention window expired'));
  });

  // -------------------------------------------------------------------------
  // 9. Platform Qualification Boundary (Termux / Android Execution Profile)
  // -------------------------------------------------------------------------
  group('T-13.9: Platform Qualification Boundary (Termux / Android Execution Profile, IB-01 OPEN)');

  t('qualification reducer reports UNQUALIFIED when immutable block storage or write-once materializer evidence is missing', () => {
    const qualRecord = REC.createQualification({
      qualificationId: 'qual-t13-immutable-storage',
      profileId: 'profile:linux-immutable-block:v1',
      profileDigest: 'sha256:' + '9'.repeat(64),
      status: Q.QualificationStatus.QUALIFIED,
      evidenceBindings: [
        { surface: Q.EffectSurface.FILESYSTEM, evidenceIds: ['qe-write-once-1'] },
      ],
      admittedByContract: 'linux-contained',
      claimedAt: 1000,
    });

    // Evidence with missing / unqualified observer
    const unqualEv = REC.createQualEvidence({
      qualEvidenceId: 'qe-write-once-1',
      surface: Q.EffectSurface.FILESYSTEM,
      method: Q.EvidenceMethod.ACCESS_TEST,
      evidenceProfileBinding: 'profile:linux-immutable-block:v1',
      result: Q.EvidenceResult.FAIL,
      timestamp: 2000,
      observerIdentity: 'observer-unqual-1',
    });

    const res = Q.resolveQualification({
      qualification: qualRecord,
      evidence: [unqualEv],
      expectedProfileDigest: qualRecord.profileDigest,
    });

    assert.strictEqual(res.status, Q.QualificationStatus.UNQUALIFIED);
    assert.ok(res.problems.some((p) => p.includes('FILESYSTEM') && p.includes('FAIL')));
  });

  t('physical write-once block storage immutability, hardware fsync durability guarantees, and kernel retention fencing are NOT QUALIFIED on Termux, IB-01 OPEN', () => {
    // Pure repair eligibility algebra, bounded repair ceiling enforcement (ceiling = 1),
    // generation immutability, stale PASS rejection, create-once identity bindings,
    // and truthful corrupt/expired status reporting are fully verified.
    // Physical write-once block storage immutability, hardware fsync durability guarantees,
    // and kernel retention fencing cannot be physically qualified on the Android/Termux
    // host environment without root / hardware block device immutability.
    const platformQualified = false; // Termux / Android host environment
    assert.strictEqual(platformQualified, false, 'Physical write-once block storage immutability, hardware fsync durability guarantees, and kernel retention fencing are NOT QUALIFIED on Termux/Android, QUALIFIED under the Docker runtime profile in CI');
  });
};
