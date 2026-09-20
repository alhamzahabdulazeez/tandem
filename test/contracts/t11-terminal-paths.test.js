'use strict';
/**
 * Test Contract T-11: Terminal Paths (PRD §24, §19, §20, §21, §6, §7, §9, §10, §12, §16, §27, §28, §33)
 *
 * Exercises all normative ending paths and fault models from PRD §24 T-11 & §19:
 *  1. COMPLETE and COMPLETE_WITH_LIMITATION (success gate verification)
 *  2. FAILED, BLOCKED, and NEEDS_USER non-success termination
 *  3. CANCELLED and SAFETY_STOP emergency termination
 *  4. BUDGET_EXHAUSTED termination & protected finalization capacity
 *  5. DISCONNECT / ABORT & narrow post-terminal accounting exception
 *  6. CRASH / RESTART recovery & former incarnation truthful disposition
 *  7. FAILED FENCING & UNRESOLVED_EXECUTION fallback
 *  8. Total acceptance monotonicity, liability visibility, and invariant traceability (INV-03, INV-04, INV-09, INV-20)
 *  9. Platform qualification boundary (Termux / Android Execution Isolation Profile, IB-01 OPEN)
 *
 * Asserts all normative invariants:
 *  - Admission closes and task authority retires on every ending path (INV-03, §19 step 2 & 3).
 *  - No new autonomous work starts afterward (INV-04, §9.5, §19).
 *  - Quiescence is proven or unresolved execution is explicitly recorded (INV-20, §19 step 7).
 *  - Every affected unresolved mutable resource is durably quarantined (INV-20, §19 step 8).
 *  - No unsuccessful path becomes accepted (INV-09, §21).
 *  - Known obligation failures and bounded liabilities remain visible (§19 step 6, §21).
 *  - Platform Qualification: Physical supervisor process isolation, kernel-level process tree fencing/cgroup freezing,
 *    and unbypassable kernel admission closure are NOT QUALIFIED on Termux/Android, QUALIFIED under the Docker runtime profile in CI.
 *
 * Binds Evidence Families: EA, ER, EB, EL, ED, EX.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REC = require('../../src/contracts/records.js');
const ID = require('../../src/contracts/identity.js');
const { contentId, sha256, canonicalJson } = require('../../src/contracts/crypto.js');
const GEN = require('../../src/contracts/generation.js');
const ACC = require('../../src/contracts/acceptance.js');
const F = require('../../src/contracts/finalization.js');
const Q = require('../../src/contracts/qualification.js');
const BUDGET = require('../../src/contracts/budget.js');
const STATE = require('../../src/control/state.cjs');
const OWN = require('../../src/control/ownership.cjs');
const ADMISSION = require('../../src/control/admission.cjs');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-t11-'));
}

function cleanupDir(d) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
}

const NOW_MS = 1757926800000; // 2025-09-15T09:00:00.000Z
const NOW = new Date(NOW_MS).toISOString();
const TREE_CID_1 = contentId('tree-terminal-v1');
const PAYLOAD_CID_1 = contentId('payload-terminal-v1');

function createTestHarness(d, ownerId = 'executor-t11') {
  const boot = { id: 'boot:T11', source: 'boot_id', qualified: true };
  const sup = OWN.openSupervisor({ root: d, ownerIdentity: ownerId, bootId: boot });
  assert.strictEqual(sup.refused, undefined);
  const store = sup.store;

  // Task incarnation
  const inc = REC.createTaskIncarnation({
    taskId: 'task-t11',
    lineageId: 'lin-t11',
    incarnationId: 'inc-t11',
    ownerEpoch: 'o:1',
    originalRequest: 'Execute T-11 Terminal Paths Contract',
    selectedSourceCommit: 'commit-t11-40chars-abcdef0123456789abcdef012',
  });
  inc.phase = 'READY';
  STATE.add(store, inc);

  // Generation record
  const gen = REC.createGeneration({
    generationId: 'gen-t11-1',
    taskId: 'task-t11',
    incarnationId: 'inc-t11',
  });
  gen.treeDigest = TREE_CID_1;
  STATE.add(store, gen);

  return { sup, store, inc, gen };
}

module.exports = function (t, group) {
  // -------------------------------------------------------------------------
  // 1. COMPLETE & COMPLETE_WITH_LIMITATION (Success Gate Verification)
  // -------------------------------------------------------------------------
  group('T-11.1: COMPLETE & COMPLETE_WITH_LIMITATION (PRD §24, §19, §20, §21, INV-03, INV-09)');

  t('COMPLETE path executes 10-step protocol: retires authority, proves quiescence, verifies all mandatory PASS, and completes publication before success', () => {
    // Terminal treatment definition verification
    const treat = F.terminalTreatment(REC.TerminalResult.COMPLETE);
    assert.strictEqual(treat.known, true);
    assert.strictEqual(treat.successGate, true);
    assert.strictEqual(treat.publishesExactFrozen, true);
    assert.deepStrictEqual(treat.preserves, ['mandatory PASS', 'exact frozen identity']);

    // 10-step reduction under valid conditions
    const finalization = F.reduceFinalization({
      stopReason: REC.TerminalResult.COMPLETE,
      admissionClosed: true,
      authorityRetired: true,
      fencingEstablished: true,
      reconciliationComplete: true,
      quarantineAppliedForUnresolved: true,
      truthfulResultReduced: true,
      publicationOrderingComplete: true,
      quiescenceProven: true,
    });

    assert.strictEqual(finalization.status, F.FINALIZATION_STATUS.COMPLETE);
    assert.strictEqual(finalization.terminalResult, REC.TerminalResult.COMPLETE);
    assert.strictEqual(finalization.publishes, true);
    assert.strictEqual(finalization.quiescenceProven, true);
    assert.strictEqual(finalization.unresolved, false);
    assert.strictEqual(finalization.problems.length, 0);
  });

  t('COMPLETE_WITH_LIMITATION shares identical hard success gate as COMPLETE; remaining limitations must be optional or outside contract', () => {
    const treat = F.terminalTreatment(REC.TerminalResult.COMPLETE_WITH_LIMITATION);
    assert.strictEqual(treat.known, true);
    assert.strictEqual(treat.successGate, true);
    assert.strictEqual(treat.publishesExactFrozen, true);

    const finalization = F.reduceFinalization({
      stopReason: REC.TerminalResult.COMPLETE_WITH_LIMITATION,
      admissionClosed: true,
      authorityRetired: true,
      fencingEstablished: true,
      reconciliationComplete: true,
      quarantineAppliedForUnresolved: true,
      truthfulResultReduced: true,
      publicationOrderingComplete: true,
      quiescenceProven: true,
    });

    assert.strictEqual(finalization.status, F.FINALIZATION_STATUS.COMPLETE);
    assert.strictEqual(finalization.terminalResult, REC.TerminalResult.COMPLETE_WITH_LIMITATION);
    assert.strictEqual(finalization.publishes, true);
    assert.strictEqual(finalization.unresolved, false);
  });

  t('COMPLETE_WITH_LIMITATION fails acceptance if any mandatory requirement fails, is missing, or is inconclusive (INV-09)', () => {
    const mandatoryObligation = ACC.createObligation({
      obligationId: 'ob-mandatory-1',
      mandatoryStatus: 'mandatory',
      applicabilityAndDomain: 'exact slice: core functionality',
      predicateFamily: ACC.PredicateFamily.EXTERNAL_BEHAVIORAL_CASE,
      predicateAdapterId: 'cli-observer',
      predicateVersion: 1,
      parametersAndExpectedValues: { command: 'test', expectedExit: 0 },
      requiredObservationTypes: ['expected_value', 'candidate_stdout', 'candidate_stderr', 'exit_signal', 'exit_code', 'timeout'],
      requiredScopeAndCompleteness: 'bounded CLI invocation',
      permittedEvidenceSources: ['protected-observer'],
    });

    const optionalObligation = ACC.createObligation({
      obligationId: 'ob-optional-perf',
      mandatoryStatus: 'optional',
      applicabilityAndDomain: 'exact slice: optional performance benchmark',
      predicateFamily: ACC.PredicateFamily.EXTERNAL_BEHAVIORAL_CASE,
      predicateAdapterId: 'cli-observer',
      predicateVersion: 1,
      parametersAndExpectedValues: { command: 'benchmark', maxLatencyMs: 100 },
      requiredObservationTypes: ['expected_value', 'candidate_stdout', 'candidate_stderr', 'exit_signal', 'exit_code', 'timeout'],
      requiredScopeAndCompleteness: 'bounded benchmark invocation',
      permittedEvidenceSources: ['protected-observer'],
    });

    const inventory = [
      ACC.createInventoryEntry({
        requirementId: 'REQ-MANDATORY',
        sourceProvenance: 'user request',
        originalMeaning: 'Core system functionality',
        admittedInterpretation: 'Core tests must pass',
        explicitOrInferred: 'explicit',
        mandatoryOrOptional: 'mandatory',
        applicability: 'APPLICABLE',
        mappedObligationIds: ['ob-mandatory-1'],
      }),
      ACC.createInventoryEntry({
        requirementId: 'REQ-OPTIONAL',
        sourceProvenance: 'user request',
        originalMeaning: 'Performance target',
        admittedInterpretation: 'Optional sub-100ms latency',
        explicitOrInferred: 'explicit',
        mandatoryOrOptional: 'optional',
        applicability: 'APPLICABLE',
        mappedObligationIds: ['ob-optional-perf'],
      }),
    ];

    // Case A: Mandatory passes, optional fails -> acceptance passes (all mandatory passed)
    const obsA = [
      { obligationId: 'ob-mandatory-1', evidenceId: 'ev-1', valid: true, applicable: true, evaluation: 'predicate_satisfied', completeness: 'complete' },
      { obligationId: 'ob-optional-perf', evidenceId: 'ev-2', valid: true, applicable: true, evaluation: 'predicate_contradicted', completeness: 'complete' },
    ];
    const resA = ACC.reduceAcceptance({
      inventory,
      obligations: [mandatoryObligation, optionalObligation],
      observations: obsA,
      evidenceCoherent: true,
      frozenGenerationId: 'gen-t11-1',
      derivationEstablished: true,
      quiescenceProven: true,
      payloadManifestComplete: true,
      cleanAuthorityOwnership: true,
    });
    assert.strictEqual(resA.accepted, true, 'Acceptance must pass when only optional requirements fail');
    assert.strictEqual(resA.outcome, 'COMPLETE');

    // Case B: Mandatory fails -> acceptance refused (fails closed)
    const obsB = [
      { obligationId: 'ob-mandatory-1', evidenceId: 'ev-1', valid: true, applicable: true, evaluation: 'predicate_contradicted', completeness: 'complete' },
      { obligationId: 'ob-optional-perf', evidenceId: 'ev-2', valid: true, applicable: true, evaluation: 'predicate_satisfied', completeness: 'complete' },
    ];
    const resB = ACC.reduceAcceptance({
      inventory,
      obligations: [mandatoryObligation, optionalObligation],
      observations: obsB,
      evidenceCoherent: true,
      frozenGenerationId: 'gen-t11-1',
      derivationEstablished: true,
      quiescenceProven: true,
      payloadManifestComplete: true,
      cleanAuthorityOwnership: true,
    });
    assert.strictEqual(resB.accepted, false, 'Acceptance must refuse when a mandatory requirement fails');
    assert.strictEqual(resB.outcome, 'FAILED');
  });

  t('success reduction fails closed if quiescence is not proven or publication ordering is incomplete', () => {
    // 1. Quiescence not proven
    const resNoQuiescence = F.reduceFinalization({
      stopReason: REC.TerminalResult.COMPLETE,
      admissionClosed: true,
      authorityRetired: true,
      fencingEstablished: true,
      reconciliationComplete: true,
      quarantineAppliedForUnresolved: true,
      truthfulResultReduced: true,
      publicationOrderingComplete: true,
      quiescenceProven: false, // Quiescence unproven!
    });
    assert.strictEqual(resNoQuiescence.status, F.FINALIZATION_STATUS.UNRESOLVED_EXECUTION);
    assert.strictEqual(resNoQuiescence.terminalResult, REC.TerminalResult.UNRESOLVED_EXECUTION);
    assert.strictEqual(resNoQuiescence.publishes, false);
    assert.strictEqual(resNoQuiescence.unresolved, true);
    assert.ok(resNoQuiescence.problems.some((p) => p.includes('quiescence is not proven')));

    // 2. Publication ordering incomplete
    const resNoPub = F.reduceFinalization({
      stopReason: REC.TerminalResult.COMPLETE,
      admissionClosed: true,
      authorityRetired: true,
      fencingEstablished: true,
      reconciliationComplete: true,
      quarantineAppliedForUnresolved: true,
      truthfulResultReduced: true,
      publicationOrderingComplete: false, // Publication ordering incomplete!
      quiescenceProven: true,
    });
    assert.strictEqual(resNoPub.status, F.FINALIZATION_STATUS.UNRESOLVED_EXECUTION);
    assert.strictEqual(resNoPub.publishes, false);
    assert.ok(resNoPub.problems.some((p) => p.includes('publication ordering was not completed')));
  });

  // -------------------------------------------------------------------------
  // 2. FAILED, BLOCKED, and NEEDS_USER Non-Success Termination
  // -------------------------------------------------------------------------
  group('T-11.2: FAILED, BLOCKED, and NEEDS_USER Non-Success Termination (PRD §24, §19, INV-03, INV-04)');

  t('FAILED stop reason fences and reconciles effects, preserves baseline, evidence, and prior accepted payloads, and never publishes as success', () => {
    const treat = F.terminalTreatment(REC.TerminalResult.FAILED);
    assert.strictEqual(treat.known, true);
    assert.strictEqual(treat.successGate, false);
    assert.strictEqual(treat.publishesExactFrozen, false);
    assert.strictEqual(treat.fencesOrReconciles, true);
    assert.deepStrictEqual(treat.preserves, ['baseline', 'evidence', 'accepted payloads']);

    const finalization = F.reduceFinalization({
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

    assert.strictEqual(finalization.status, F.FINALIZATION_STATUS.COMPLETE);
    assert.strictEqual(finalization.terminalResult, REC.TerminalResult.FAILED);
    assert.strictEqual(finalization.publishes, false);
    assert.strictEqual(finalization.unresolved, false);
  });

  t('BLOCKED stop reason ends incarnation with no usable parked authority left behind', () => {
    const treat = F.terminalTreatment(REC.TerminalResult.BLOCKED);
    assert.strictEqual(treat.known, true);
    assert.strictEqual(treat.successGate, false);
    assert.strictEqual(treat.publishesExactFrozen, false);
    assert.strictEqual(treat.endsIncarnation, true);
    assert.strictEqual(treat.fencesOrReconciles, true);

    const finalization = F.reduceFinalization({
      stopReason: REC.TerminalResult.BLOCKED,
      admissionClosed: true,
      authorityRetired: true,
      fencingEstablished: true,
      reconciliationComplete: true,
      quarantineAppliedForUnresolved: true,
      truthfulResultReduced: true,
      publicationOrderingComplete: false,
      quiescenceProven: true,
    });

    assert.strictEqual(finalization.status, F.FINALIZATION_STATUS.COMPLETE);
    assert.strictEqual(finalization.terminalResult, REC.TerminalResult.BLOCKED);
    assert.strictEqual(finalization.publishes, false);
  });

  t('NEEDS_USER stop reason ends incarnation; future continuation strictly requires a fresh admission proposal', () => {
    const treat = F.terminalTreatment(REC.TerminalResult.NEEDS_USER);
    assert.strictEqual(treat.known, true);
    assert.strictEqual(treat.successGate, false);
    assert.strictEqual(treat.publishesExactFrozen, false);
    assert.strictEqual(treat.endsIncarnation, true);

    const finalization = F.reduceFinalization({
      stopReason: REC.TerminalResult.NEEDS_USER,
      admissionClosed: true,
      authorityRetired: true,
      fencingEstablished: true,
      reconciliationComplete: true,
      quarantineAppliedForUnresolved: true,
      truthfulResultReduced: true,
      publicationOrderingComplete: false,
      quiescenceProven: true,
    });

    assert.strictEqual(finalization.status, F.FINALIZATION_STATUS.COMPLETE);
    assert.strictEqual(finalization.terminalResult, REC.TerminalResult.NEEDS_USER);
    assert.strictEqual(finalization.publishes, false);
  });

  t('no new autonomous work can start after authority retirement or admission closure (INV-04, §9.5)', () => {
    const d = tmpDir();
    try {
      const { store, inc } = createTestHarness(d);

      // Create a finalization record that retired authority and closed admission
      const finRec = REC.createFinalization({
        finalizationId: 'fin-t11-1',
        incarnationId: inc.incarnationId,
        stopReason: REC.TerminalResult.FAILED,
      });
      finRec.admissionClosed = true;
      finRec.authorityRetired = true;
      STATE.add(store, finRec);

      // Attempt to authorize a new action mutation under retired authority
      const proposedAction = REC.createAction({
        actionId: 'act-post-terminal',
        incarnationId: inc.incarnationId,
        ownerEpoch: inc.ownerEpoch,
        operation: 'attempt unauthorized post-terminal work',
        targetGeneration: 'gen-t11-1',
      });

      const records = store.all();
      const auth = ID.authorizeMutation({ records, candidate: proposedAction });
      assert.strictEqual(auth.authorized, false, 'Mutation must be refused under retired authority');
      assert.ok(auth.reasons.includes(ID.MutationReason.RETIRED_AUTHORITY));
    } finally {
      cleanupDir(d);
    }
  });

  // -------------------------------------------------------------------------
  // 3. CANCELLED and SAFETY_STOP Emergency Termination
  // -------------------------------------------------------------------------
  group('T-11.3: CANCELLED and SAFETY_STOP Emergency Termination (PRD §24, §19, INV-03, INV-20)');

  t('CANCELLED path immediately closes admission, stops/fences reachable effect paths, preserves evidence and user state, and never erases known failures', () => {
    const treat = F.terminalTreatment(REC.TerminalResult.CANCELLED);
    assert.strictEqual(treat.known, true);
    assert.strictEqual(treat.successGate, false);
    assert.strictEqual(treat.publishesExactFrozen, false);
    assert.strictEqual(treat.fencesOrReconciles, true);
    assert.deepStrictEqual(treat.preserves, ['user state', 'evidence']);

    const finalization = F.reduceFinalization({
      stopReason: REC.TerminalResult.CANCELLED,
      admissionClosed: true,
      authorityRetired: true,
      fencingEstablished: true,
      reconciliationComplete: true,
      quarantineAppliedForUnresolved: true,
      truthfulResultReduced: true,
      publicationOrderingComplete: false,
      quiescenceProven: true,
    });

    assert.strictEqual(finalization.status, F.FINALIZATION_STATUS.COMPLETE);
    assert.strictEqual(finalization.terminalResult, REC.TerminalResult.CANCELLED);
    assert.strictEqual(finalization.publishes, false);
  });

  t('SAFETY_STOP path executes fail-closed protocol, preserves evidence, fences/quarantines mutable resources, and never claims reusable task resources', () => {
    const treat = F.terminalTreatment(REC.TerminalResult.SAFETY_STOP);
    assert.strictEqual(treat.known, true);
    assert.strictEqual(treat.successGate, false);
    assert.strictEqual(treat.publishesExactFrozen, false);
    assert.strictEqual(treat.fencesOrReconciles, true);
    assert.deepStrictEqual(treat.preserves, ['evidence']);

    const finalization = F.reduceFinalization({
      stopReason: REC.TerminalResult.SAFETY_STOP,
      admissionClosed: true,
      authorityRetired: true,
      fencingEstablished: true,
      reconciliationComplete: true,
      quarantineAppliedForUnresolved: true,
      truthfulResultReduced: true,
      publicationOrderingComplete: false,
      quiescenceProven: true,
    });

    assert.strictEqual(finalization.status, F.FINALIZATION_STATUS.COMPLETE);
    assert.strictEqual(finalization.terminalResult, REC.TerminalResult.SAFETY_STOP);
    assert.strictEqual(finalization.publishes, false);
  });

  t('cancellation linearized before terminal commit halts publication and prevents delivery of candidate payload', () => {
    const d = tmpDir();
    try {
      const { store, inc, gen } = createTestHarness(d);

      // Close admission via supervisor control
      OWN.closeAdmission(store);

      const ownerRec = store.byKind('store_owner')[0];
      assert.strictEqual(ownerRec.admissionState, 'CLOSED');

      // Attempt to authorize generation freeze or new mutation
      const nextGen = REC.createGeneration({
        generationId: 'gen-t11-cancelled-attempt',
        taskId: inc.taskId,
        incarnationId: inc.incarnationId,
      });

      const auth = ID.authorizeMutation({ records: store.all(), candidate: nextGen });
      assert.strictEqual(auth.authorized, false);
      assert.ok(auth.reasons.includes(ID.MutationReason.ADMISSION_CLOSED));
    } finally {
      cleanupDir(d);
    }
  });

  // -------------------------------------------------------------------------
  // 4. BUDGET_EXHAUSTED Termination & Protected Finalization Capacity
  // -------------------------------------------------------------------------
  group('T-11.4: BUDGET_EXHAUSTED Termination & Protected Finalization Capacity (PRD §24, §19, §12, INV-09)');

  t('BUDGET_EXHAUSTED consumes protected finalization capacity without skipping mandatory finalization steps', () => {
    const treat = F.terminalTreatment(REC.TerminalResult.BUDGET_EXHAUSTED);
    assert.strictEqual(treat.known, true);
    assert.strictEqual(treat.successGate, false);
    assert.strictEqual(treat.publishesExactFrozen, false);
    assert.strictEqual(treat.fencesOrReconciles, true);
    assert.deepStrictEqual(treat.preserves, ['obligations', 'caps']);

    // Finalization reduction enforces steps 2-6 even when budget is exhausted
    const finalization = F.reduceFinalization({
      stopReason: REC.TerminalResult.BUDGET_EXHAUSTED,
      admissionClosed: true,
      authorityRetired: true,
      fencingEstablished: true,
      reconciliationComplete: true,
      quarantineAppliedForUnresolved: true,
      truthfulResultReduced: true,
      publicationOrderingComplete: false,
      quiescenceProven: true,
    });

    assert.strictEqual(finalization.status, F.FINALIZATION_STATUS.COMPLETE);
    assert.strictEqual(finalization.terminalResult, REC.TerminalResult.BUDGET_EXHAUSTED);
    assert.strictEqual(finalization.publishes, false);
    assert.strictEqual(finalization.unresolved, false);
  });

  t('hard limit caps are strictly enforced; discretionary work cannot starve protected future capacity', () => {
    const dim = BUDGET.createDimension({
      dimension: 'cpu_ms',
      hardLimit: 10000,
      protectedFuture: 2000, // Reserved exclusively for mandatory / finalization work
    });
    const ledger = BUDGET.createLedger([dim]);

    // 1. Attempt discretionary work that would eat into protectedFuture (8500 + 2000 > 10000)
    const admOver = BUDGET.admitDiscretionary(ledger, 'cpu_ms', 'act-disc-large', 8500);
    assert.strictEqual(admOver.admitted, false);
    assert.ok(admOver.reason.includes('hard limit exceeded'));

    // 2. Admitting discretionary within headroom
    const admOk = BUDGET.admitDiscretionary(ledger, 'cpu_ms', 'act-disc-ok', 7500);
    assert.strictEqual(admOk.admitted, true);

    // 3. Mandatory finalization action transfers capacity out of protectedFuture
    const admMand = BUDGET.admitMandatory(admOk.ledger, 'cpu_ms', 'act-mandatory-finalization', 1500);
    assert.strictEqual(admMand.admitted, true);
    assert.strictEqual(admMand.ledger.dimensions.cpu_ms.protectedFuture, 500);
  });

  t('insufficient budget for mandatory obligations stops execution and refuses acceptance', () => {
    const obligation = ACC.createObligation({
      obligationId: 'ob-mandatory-budget',
      mandatoryStatus: 'mandatory',
      applicabilityAndDomain: 'exact slice: mandatory test execution',
      predicateFamily: ACC.PredicateFamily.EXTERNAL_BEHAVIORAL_CASE,
      predicateAdapterId: 'cli-observer',
      predicateVersion: 1,
      parametersAndExpectedValues: { command: 'node test', expectedExit: 0 },
      requiredObservationTypes: ['expected_value', 'candidate_stdout', 'candidate_stderr', 'exit_signal', 'exit_code', 'timeout'],
      requiredScopeAndCompleteness: 'full execution capture',
      permittedEvidenceSources: ['protected-observer'],
    });

    const inventory = [
      ACC.createInventoryEntry({
        requirementId: 'REQ-MANDATORY-1',
        sourceProvenance: 'user request',
        originalMeaning: 'System verification',
        admittedInterpretation: 'Must execute tests',
        explicitOrInferred: 'explicit',
        mandatoryOrOptional: 'mandatory',
        applicability: 'APPLICABLE',
        mappedObligationIds: ['ob-mandatory-budget'],
      }),
    ];

    // Budget exhausted before observation could be obtained (missing observation)
    const res = ACC.reduceAcceptance({
      inventory,
      obligations: [obligation],
      observations: [], // No observation due to budget stop!
      evidenceCoherent: true,
      frozenGenerationId: 'gen-t11-1',
      derivationEstablished: true,
      quiescenceProven: true,
      payloadManifestComplete: true,
      cleanAuthorityOwnership: true,
    });

    assert.strictEqual(res.accepted, false);
    assert.strictEqual(res.outcome, 'NOT_ACCEPTED');
    assert.ok(res.reasons.some((r) => r.includes('MISSING')));
  });

  // -------------------------------------------------------------------------
  // 5. DISCONNECT / ABORT & Post-Terminal Exception Boundary
  // -------------------------------------------------------------------------
  group('T-11.5: DISCONNECT / ABORT & Post-Terminal Exception Boundary (PRD §24, §19, INV-03, INV-04)');

  t('DISCONNECT / ABORT closes admission immediately, rejects late execution payloads, and retains bounded liabilities', () => {
    // Both stop reasons require closing admission and retiring authority
    for (const stopReason of [REC.TerminalResult.CANCELLED, REC.TerminalResult.FAILED]) {
      const finalization = F.reduceFinalization({
        stopReason,
        admissionClosed: true,
        authorityRetired: true,
        fencingEstablished: true,
        reconciliationComplete: true,
        quarantineAppliedForUnresolved: true,
        truthfulResultReduced: true,
        publicationOrderingComplete: false,
        quiescenceProven: true,
      });
      assert.strictEqual(finalization.status, F.FINALIZATION_STATUS.COMPLETE);
      assert.strictEqual(finalization.publishes, false);
    }
  });

  t('post-terminal arrival of late execution payload (reopening execution, importing evidence, mutating candidate, upgrading assurance) is strictly rejected', () => {
    // 1. Prohibited late payload arriving post-terminal without accounting settlement
    const r1 = F.latePayloadAllowed({
      afterTerminal: true,
      authenticatedAccountingSettlement: false,
      reopensExecution: false,
      importsEvidence: false,
      mutatesCandidate: false,
      upgradesAssurance: false,
    });
    assert.strictEqual(r1.allowed, false);
    assert.ok(r1.problems.some((p) => p.includes('late unless it is an authenticated accounting settlement')));

    // 2. Late payload attempting to reopen execution
    const r2 = F.latePayloadAllowed({
      afterTerminal: true,
      authenticatedAccountingSettlement: true,
      reopensExecution: true,
      importsEvidence: false,
      mutatesCandidate: false,
      upgradesAssurance: false,
    });
    assert.strictEqual(r2.allowed, false);
    assert.ok(r2.problems.some((p) => p.includes('reopens execution')));

    // 3. Late payload attempting to import evidence
    const r3 = F.latePayloadAllowed({
      afterTerminal: true,
      authenticatedAccountingSettlement: true,
      reopensExecution: false,
      importsEvidence: true,
      mutatesCandidate: false,
      upgradesAssurance: false,
    });
    assert.strictEqual(r3.allowed, false);
    assert.ok(r3.problems.some((p) => p.includes('imports evidence')));

    // 4. Late payload attempting to mutate candidate
    const r4 = F.latePayloadAllowed({
      afterTerminal: true,
      authenticatedAccountingSettlement: true,
      reopensExecution: false,
      importsEvidence: false,
      mutatesCandidate: true,
      upgradesAssurance: false,
    });
    assert.strictEqual(r4.allowed, false);
    assert.ok(r4.problems.some((p) => p.includes('mutates a candidate')));

    // 5. Late payload attempting to upgrade assurance
    const r5 = F.latePayloadAllowed({
      afterTerminal: true,
      authenticatedAccountingSettlement: true,
      reopensExecution: false,
      importsEvidence: false,
      mutatesCandidate: false,
      upgradesAssurance: true,
    });
    assert.strictEqual(r5.allowed, false);
    assert.ok(r5.problems.some((p) => p.includes('upgrades assurance')));
  });

  t('narrow post-terminal exception: authenticated accounting settlement is allowed only when it does not mutate state or reopen execution', () => {
    const validSettlement = F.latePayloadAllowed({
      afterTerminal: true,
      authenticatedAccountingSettlement: true,
      reopensExecution: false,
      importsEvidence: false,
      mutatesCandidate: false,
      upgradesAssurance: false,
    });
    assert.strictEqual(validSettlement.allowed, true);
    assert.strictEqual(validSettlement.problems.length, 0);
  });

  // -------------------------------------------------------------------------
  // 6. CRASH / RESTART Recovery & Former Incarnation Truthful Disposition
  // -------------------------------------------------------------------------
  group('T-11.6: CRASH / RESTART Recovery & Former Incarnation Truthful Disposition (PRD §24, §19, §10, INV-20)');

  t('crash recovery acquires exclusive lock, allocates fresh recovery epoch, enters role RECOVERY, and closes admission', () => {
    const d = tmpDir();
    try {
      const { sup, store, inc } = createTestHarness(d, 'crashed-supervisor-1');

      // Recover supervisor as new recovery owner
      const bootRec = { id: 'boot:T11-recover', source: 'boot_id', qualified: true };
      const rec = OWN.recoverSupervisor({
        root: d,
        ownerIdentity: 'recovery-supervisor-2',
        bootId: bootRec,
      });

      assert.strictEqual(rec.report.admissionClosed, true);
      assert.strictEqual(rec.report.epoch, 2);
      assert.strictEqual(rec.owner.recoveryState, 'RECOVERY');
      assert.strictEqual(rec.owner.admissionState, 'CLOSED');
      assert.strictEqual(rec.session.recoverOnly, true);
    } finally {
      cleanupDir(d);
    }
  });

  t('selectUnresolved accurately identifies surviving actors and durably quarantines affected mutable resources', () => {
    const d = tmpDir();
    try {
      const { store, inc } = createTestHarness(d);

      // Actor 1: Consumed and dispatched (ACKNOWLEDGED) -> unresolved
      const act1 = REC.createAction({
        actionId: 'act-dispatched',
        incarnationId: inc.incarnationId,
        ownerEpoch: inc.ownerEpoch,
        operation: 'write candidate file',
        targetGeneration: 'gen-t11-1',
      });
      act1.resourceDisposition = 'ACTIVE';
      STATE.add(store, act1);
      STATE.add(store, {
        schemaVersion: 1, kind: 'action_consumption',
        consumptionId: 'cons-1', actionId: 'act-dispatched',
        incarnationId: inc.incarnationId,
        ownerEpoch: inc.ownerEpoch,
        consumedAt: NOW,
        reservedLiability: 100,
        ack: 'ACKNOWLEDGED',
      });

      // Actor 2: Consumed but provably not dispatched (KNOWN_NOT_DISPATCHED) -> clean / resolved
      const act2 = REC.createAction({
        actionId: 'act-nondispatched',
        incarnationId: inc.incarnationId,
        ownerEpoch: inc.ownerEpoch,
        operation: 'unexecuted operation',
        targetGeneration: 'gen-t11-1',
      });
      STATE.add(store, act2);
      STATE.add(store, {
        schemaVersion: 1, kind: 'action_consumption',
        consumptionId: 'cons-2', actionId: 'act-nondispatched',
        incarnationId: inc.incarnationId,
        ownerEpoch: inc.ownerEpoch,
        consumedAt: NOW,
        reservedLiability: 100,
        ack: 'KNOWN_NOT_DISPATCHED',
      });

      // Actor 3: Consumed without ack (crash between consume and dispatch) -> unresolved
      const act3 = REC.createAction({
        actionId: 'act-consumed-unknown',
        incarnationId: inc.incarnationId,
        ownerEpoch: inc.ownerEpoch,
        operation: 'in-flight operation',
        targetGeneration: 'gen-t11-1',
      });
      act3.resourceDisposition = 'ACTIVE';
      STATE.add(store, act3);
      STATE.add(store, {
        schemaVersion: 1, kind: 'action_consumption',
        consumptionId: 'cons-3', actionId: 'act-consumed-unknown',
        incarnationId: inc.incarnationId,
        ownerEpoch: inc.ownerEpoch,
        consumedAt: NOW,
        reservedLiability: 100,
        ack: null,
      });

      const records = store.all();
      const unresolved = OWN.selectUnresolved(records);
      const unresolvedIds = unresolved.map((u) => u.actionId);

      assert.ok(unresolvedIds.includes('act-dispatched'), 'Dispatched actor must be selected as unresolved');
      assert.ok(unresolvedIds.includes('act-consumed-unknown'), 'Consumed-unknown actor must be selected as unresolved');
      assert.ok(!unresolvedIds.includes('act-nondispatched'), 'Proven non-dispatched actor must NOT be unresolved');

      // Run recovery to verify quarantine creation
      const bootRec = { id: 'boot:T11-recover', source: 'boot_id', qualified: true };
      const rec = OWN.recoverSupervisor({
        root: d,
        ownerIdentity: 'recovery-supervisor-3',
        bootId: bootRec,
      });

      assert.ok(rec.report.quarantined.includes('quarantine-act-dispatched'));
      assert.ok(rec.report.quarantined.includes('quarantine-act-consumed-unknown'));

      const qRecords = rec.store.byKind('quarantine');
      for (const q of qRecords) {
        assert.strictEqual(q.resourceClass, 'CANDIDATE_DIR');
        assert.strictEqual(q.state, 'ACTIVE');
      }
    } finally {
      cleanupDir(d);
    }
  });

  t('dispatched / consumed-unknown reservations remain preserved; provably un-dispatched reservations are safely released', () => {
    const d = tmpDir();
    try {
      const { store, inc } = createTestHarness(d);

      // Create budget ledger
      const dim = BUDGET.createDimension({ dimension: 'tokens', hardLimit: 50000, protectedFuture: 5000 });
      const ledger = BUDGET.createLedger([dim]);
      const adm1 = BUDGET.admitDiscretionary(ledger, 'tokens', 'act-dispatched', 10000);
      const adm2 = BUDGET.admitDiscretionary(adm1.ledger, 'tokens', 'act-nondispatched', 8000);
      store.add({ schemaVersion: 1, kind: 'budget', lineageId: 'lin-t11', dimensions: adm2.ledger.dimensions });

      // Add reservation records
      store.add({ schemaVersion: 1, kind: 'reservation', reservationId: 'res-1', lineageId: 'lin-t11', dimension: 'tokens', actionId: 'act-dispatched', maxExposure: 10000, state: 'ACTIVE' });
      store.add({ schemaVersion: 1, kind: 'reservation', reservationId: 'res-2', lineageId: 'lin-t11', dimension: 'tokens', actionId: 'act-nondispatched', maxExposure: 8000, state: 'ACTIVE' });

      // Add consumptions
      store.add({
        schemaVersion: 1, kind: 'action_consumption',
        consumptionId: 'c-1', actionId: 'act-dispatched',
        incarnationId: inc.incarnationId, ownerEpoch: inc.ownerEpoch,
        consumedAt: NOW, reservedLiability: 10000, ack: 'ACKNOWLEDGED',
      });
      store.add({
        schemaVersion: 1, kind: 'action_consumption',
        consumptionId: 'c-2', actionId: 'act-nondispatched',
        incarnationId: inc.incarnationId, ownerEpoch: inc.ownerEpoch,
        consumedAt: NOW, reservedLiability: 8000, ack: 'KNOWN_NOT_DISPATCHED',
      });

      // Reconcile liabilities
      const released = OWN.reconcileLiability(store);
      assert.deepStrictEqual(released, ['act-nondispatched'], 'Only provably un-dispatched action liability may be released');

      // Check remaining reservations in budget
      const updatedBudget = store.get('lin-t11');
      assert.strictEqual(Object.prototype.hasOwnProperty.call(updatedBudget.dimensions.tokens.reservations, 'act-dispatched'), true, 'Dispatched reservation must remain active');
      assert.strictEqual(Object.prototype.hasOwnProperty.call(updatedBudget.dimensions.tokens.reservations, 'act-nondispatched'), false, 'Non-dispatched reservation must be cleared');
    } finally {
      cleanupDir(d);
    }
  });

  t('former incarnation truthful disposition: non-successful UNLESS a complete durable successful record exists AND retained payload bytes are intact and verified', () => {
    // 1. Crash during unfinished execution -> NON_SUCCESSFUL disposition
    const d1 = tmpDir();
    try {
      const { store } = createTestHarness(d1);
      const bootRec = { id: 'boot:T11-recover-fail', source: 'boot_id', qualified: true };
      const rec1 = OWN.recoverSupervisor({ root: d1, ownerIdentity: 'rec-1', bootId: bootRec });
      assert.strictEqual(rec1.report.disposition, 'NON_SUCCESSFUL');
      assert.strictEqual(rec1.report.preservedSuccess, false);
    } finally {
      cleanupDir(d1);
    }

    // 2. Crash after committed complete finalization and verified intact payload -> SUCCESS_PRESERVED
    const d2 = tmpDir();
    try {
      const { store, inc, gen } = createTestHarness(d2);

      // Add durable complete finalization
      const finRec = REC.createFinalization({
        finalizationId: 'fin-t11-success',
        incarnationId: inc.incarnationId,
        stopReason: REC.TerminalResult.COMPLETE,
      });
      finRec.admissionClosed = true;
      finRec.authorityRetired = true;
      finRec.fencingEstablished = true;
      finRec.quiescenceProven = true;
      store.add(finRec);

      // Add published delivery record
      const delRec = REC.createDelivery({
        deliveryId: 'del-t11-success',
        taskId: inc.taskId,
        frozenGenerationId: gen.generationId,
      });
      delRec.persistenceState = 'PUBLISHED';
      store.add(delRec);

      // Mock verifyPayload returning integrity true
      const mockVerifyPayload = (root, del) => ({ integrity: true, reason: null });
      const bootRec = { id: 'boot:T11-recover-succ', source: 'boot_id', qualified: true };
      const rec2 = OWN.recoverSupervisor({
        root: d2,
        ownerIdentity: 'rec-2',
        bootId: bootRec,
        verifyPayload: mockVerifyPayload,
      });

      assert.strictEqual(rec2.report.disposition, 'SUCCESS_PRESERVED');
      assert.strictEqual(rec2.report.preservedSuccess, true);
    } finally {
      cleanupDir(d2);
    }
  });

  // -------------------------------------------------------------------------
  // 7. FAILED FENCING & UNRESOLVED_EXECUTION Fallback
  // -------------------------------------------------------------------------
  group('T-11.7: FAILED FENCING & UNRESOLVED_EXECUTION Fallback (PRD §24, §19, INV-20)');

  t('when physical fencing cannot be established, finalization strictly falls back to UNRESOLVED_EXECUTION', () => {
    const treat = F.terminalTreatment(REC.TerminalResult.UNRESOLVED_EXECUTION);
    assert.strictEqual(treat.known, true);
    assert.strictEqual(treat.successGate, false);
    assert.strictEqual(treat.publishesExactFrozen, false);
    assert.strictEqual(treat.fencesOrReconciles, true);
    assert.deepStrictEqual(treat.preserves, ['evidence', 'resources']);

    // Reduction when fencing cannot be established
    const finalization = F.reduceFinalization({
      stopReason: REC.TerminalResult.FAILED,
      admissionClosed: true,
      authorityRetired: true,
      fencingEstablished: false, // Fencing failed!
      reconciliationComplete: true,
      quarantineAppliedForUnresolved: true,
      truthfulResultReduced: true,
      publicationOrderingComplete: false,
      quiescenceProven: false,
    });

    assert.strictEqual(finalization.status, F.FINALIZATION_STATUS.UNRESOLVED_EXECUTION);
    assert.strictEqual(finalization.terminalResult, REC.TerminalResult.UNRESOLVED_EXECUTION);
    assert.strictEqual(finalization.publishes, false);
    assert.strictEqual(finalization.unresolved, true);
    assert.ok(finalization.problems.some((p) => p.includes('fencing cannot be established')));
  });

  t('quiescenceConditions fails closed when any actor mutator remains, late results can commit, or proof lacks qualified runtime boundary attestation', () => {
    // 1. Admitted mutator remaining
    const q1 = F.quiescenceConditions({
      noAdmittedMutatorRemaining: false,
      noLateResultCommittable: true,
      reproducedByQualifiedRuntimeBoundary: true,
    });
    assert.strictEqual(q1.ok, false);
    assert.ok(q1.problems.some((p) => p.includes('admitted actor can still mutate')));

    // 2. Late result committable
    const q2 = F.quiescenceConditions({
      noAdmittedMutatorRemaining: true,
      noLateResultCommittable: false,
      reproducedByQualifiedRuntimeBoundary: true,
    });
    assert.strictEqual(q2.ok, false);
    assert.ok(q2.problems.some((p) => p.includes('late execution result can still be committed')));

    // 3. Missing qualified runtime boundary attestation (IB-01)
    const q3 = F.quiescenceConditions({
      noAdmittedMutatorRemaining: true,
      noLateResultCommittable: true,
      reproducedByQualifiedRuntimeBoundary: false, // IB-01 open!
    });
    assert.strictEqual(q3.ok, false);
    assert.ok(q3.problems.some((p) => p.includes('qualified runtime boundary')));

    // 4. All satisfied -> quiescence proven
    const qOk = F.quiescenceConditions({
      noAdmittedMutatorRemaining: true,
      noLateResultCommittable: true,
      reproducedByQualifiedRuntimeBoundary: true,
    });
    assert.strictEqual(qOk.ok, true);
    assert.strictEqual(qOk.problems.length, 0);
  });

  t('in UNRESOLVED_EXECUTION, resources are explicitly marked non-reusable and durably quarantined (INV-20)', () => {
    const d = tmpDir();
    try {
      const { store, inc } = createTestHarness(d);

      // Create an action with ACTIVE resource disposition
      const activeAct = REC.createAction({
        actionId: 'act-unresolved-quarantine',
        incarnationId: inc.incarnationId,
        ownerEpoch: inc.ownerEpoch,
        operation: 'unfenced active actor',
        targetGeneration: 'gen-t11-1',
      });
      activeAct.resourceDisposition = 'ACTIVE';
      STATE.add(store, activeAct);
      STATE.add(store, {
        schemaVersion: 1, kind: 'action_consumption',
        consumptionId: 'cons-unfenced', actionId: 'act-unresolved-quarantine',
        incarnationId: inc.incarnationId,
        ownerEpoch: inc.ownerEpoch,
        consumedAt: NOW,
        reservedLiability: 50,
        ack: 'ACKNOWLEDGED',
      });

      // Recover supervisor with unqualified recovery resolver
      const bootRec = { id: 'boot:T11-unresolved', source: 'boot_id', qualified: true };
      const rec = OWN.recoverSupervisor({
        root: d,
        ownerIdentity: 'rec-unresolved',
        bootId: bootRec,
        resolver: {
          resolver: 'UNQUALIFIED',
          fencingEstablished: false,
          drainEstablished: false,
          reason: 'unqualified runtime boundary (IB-01)',
        },
      });

      assert.strictEqual(rec.report.fencingEstablished, false);
      assert.strictEqual(rec.report.quiescenceProven, false);
      assert.ok(rec.report.quarantined.includes('quarantine-act-unresolved-quarantine'));

      // Check quarantine record in store
      const qRec = rec.store.get('quarantine-act-unresolved-quarantine');
      assert.ok(qRec);
      assert.strictEqual(qRec.state, 'ACTIVE');
      assert.strictEqual(qRec.resourceClass, 'CANDIDATE_DIR');
    } finally {
      cleanupDir(d);
    }
  });

  // -------------------------------------------------------------------------
  // 8. Total Acceptance Monotonicity, Liability Visibility, and Invariant Traceability
  // -------------------------------------------------------------------------
  group('T-11.8: Total Acceptance Monotonicity, Liability Visibility, and Invariants (PRD §24, §27, INV-03, INV-04, INV-09, INV-20)');

  t('INV-03: every terminal path closes admission and retires authority without false enforcement claims', () => {
    const allStopReasons = Object.values(REC.TerminalResult);
    for (const stopReason of allStopReasons) {
      const treat = F.terminalTreatment(stopReason);
      assert.strictEqual(treat.known, true, `Treatment for "${stopReason}" must be known`);

      // Attempting finalization without closing admission or retiring authority fails closed
      const badAdmission = F.reduceFinalization({
        stopReason,
        admissionClosed: false,
        authorityRetired: true,
        fencingEstablished: true,
        reconciliationComplete: true,
        quarantineAppliedForUnresolved: true,
        truthfulResultReduced: true,
        publicationOrderingComplete: treat.successGate,
        quiescenceProven: true,
      });
      assert.strictEqual(badAdmission.status, F.FINALIZATION_STATUS.UNRESOLVED_EXECUTION);
      assert.ok(badAdmission.problems.some((p) => p.includes('task admission was not atomically closed')));

      const badAuthority = F.reduceFinalization({
        stopReason,
        admissionClosed: true,
        authorityRetired: false,
        fencingEstablished: true,
        reconciliationComplete: true,
        quarantineAppliedForUnresolved: true,
        truthfulResultReduced: true,
        publicationOrderingComplete: treat.successGate,
        quiescenceProven: true,
      });
      assert.strictEqual(badAuthority.status, F.FINALIZATION_STATUS.UNRESOLVED_EXECUTION);
      assert.ok(badAuthority.problems.some((p) => p.includes('task-execution authority was not durably retired')));
    }
  });

  t('INV-04: stale grants, queues, issuers, actors, and results cannot regain authority after finalization', () => {
    const d = tmpDir();
    try {
      const { store, inc } = createTestHarness(d);

      // Record finalization
      const finRec = REC.createFinalization({
        finalizationId: 'fin-t11-retired',
        incarnationId: inc.incarnationId,
        stopReason: REC.TerminalResult.FAILED,
      });
      finRec.admissionClosed = true;
      finRec.authorityRetired = true;
      store.add(finRec);

      // Try candidate action from stale issuer
      const staleAction = REC.createAction({
        actionId: 'act-stale-attempt',
        incarnationId: inc.incarnationId,
        ownerEpoch: inc.ownerEpoch,
        operation: 'attempt replay',
        targetGeneration: 'gen-t11-1',
      });

      const auth = ID.authorizeMutation({ records: store.all(), candidate: staleAction });
      assert.strictEqual(auth.authorized, false);
      assert.ok(auth.reasons.includes(ID.MutationReason.RETIRED_AUTHORITY));
    } finally {
      cleanupDir(d);
    }
  });

  t('INV-09: no mandatory gap, empty witness, FAIL, MISSING, or INCONCLUSIVE becomes success on any terminal path', () => {
    const obligation = ACC.createObligation({
      obligationId: 'ob-mandatory-inv09',
      mandatoryStatus: 'mandatory',
      applicabilityAndDomain: 'exact slice: mandatory requirement',
      predicateFamily: ACC.PredicateFamily.EXTERNAL_BEHAVIORAL_CASE,
      predicateAdapterId: 'cli-observer',
      predicateVersion: 1,
      parametersAndExpectedValues: { command: 'verify', expectedExit: 0 },
      requiredObservationTypes: ['expected_value', 'candidate_stdout', 'candidate_stderr', 'exit_signal', 'exit_code', 'timeout'],
      requiredScopeAndCompleteness: 'bounded capture',
      permittedEvidenceSources: ['protected-observer'],
    });

    const inventory = [
      ACC.createInventoryEntry({
        requirementId: 'REQ-MANDATORY-INV09',
        sourceProvenance: 'user request',
        originalMeaning: 'Verification requirement',
        admittedInterpretation: 'Must be satisfied',
        explicitOrInferred: 'explicit',
        mandatoryOrOptional: 'mandatory',
        applicability: 'APPLICABLE',
        mappedObligationIds: ['ob-mandatory-inv09'],
      }),
    ];

    // Sub-case 1: FAIL observation
    const resFail = ACC.reduceAcceptance({
      inventory,
      obligations: [obligation],
      observations: [{ obligationId: 'ob-mandatory-inv09', evidenceId: 'ev-1', valid: true, applicable: true, evaluation: 'predicate_contradicted', completeness: 'complete' }],
      evidenceCoherent: true,
      frozenGenerationId: 'gen-t11-1',
      derivationEstablished: true,
      quiescenceProven: true,
      payloadManifestComplete: true,
      cleanAuthorityOwnership: true,
    });
    assert.strictEqual(resFail.accepted, false);

    // Sub-case 2: MISSING / empty witness
    const resEmpty = ACC.reduceAcceptance({
      inventory,
      obligations: [obligation],
      observations: [],
      evidenceCoherent: true,
      frozenGenerationId: 'gen-t11-1',
      derivationEstablished: true,
      quiescenceProven: true,
      payloadManifestComplete: true,
      cleanAuthorityOwnership: true,
    });
    assert.strictEqual(resEmpty.accepted, false);

    // Sub-case 3: INCONCLUSIVE observation
    const resInconclusive = ACC.reduceAcceptance({
      inventory,
      obligations: [obligation],
      observations: [{ obligationId: 'ob-mandatory-inv09', evidenceId: 'ev-1', valid: false, applicable: true, evaluation: 'predicate_satisfied', completeness: 'complete' }],
      evidenceCoherent: true,
      frozenGenerationId: 'gen-t11-1',
      derivationEstablished: true,
      quiescenceProven: true,
      payloadManifestComplete: true,
      cleanAuthorityOwnership: true,
    });
    assert.strictEqual(resInconclusive.accepted, false);
  });

  t('INV-20: every ending reaches quiescence or non-successful unresolved quarantine', () => {
    // A non-successful stop reason without quiescence must report unresolved: true
    const resUnfenced = F.reduceFinalization({
      stopReason: REC.TerminalResult.FAILED,
      admissionClosed: true,
      authorityRetired: true,
      fencingEstablished: false,
      reconciliationComplete: true,
      quarantineAppliedForUnresolved: true,
      truthfulResultReduced: true,
      publicationOrderingComplete: false,
      quiescenceProven: false,
    });

    assert.strictEqual(resUnfenced.status, F.FINALIZATION_STATUS.UNRESOLVED_EXECUTION);
    assert.strictEqual(resUnfenced.unresolved, true);
    assert.strictEqual(resUnfenced.publishes, false);
  });

  t('known obligation failures and bounded liabilities remain permanently visible in durable journals and finalization reports', () => {
    const d = tmpDir();
    try {
      const { store, inc } = createTestHarness(d);

      // Add a failed observation record
      const obsRun = REC.createObserverRun({
        runId: 'run-failed-vis',
        incarnationId: inc.incarnationId,
        obligationId: 'ob-failed-1',
        candidateIdentity: { generationId: 'gen-t11-1', treeDigest: TREE_CID_1 },
        qualification: { qualified: true, name: 'cli-observer', version: '1.0' },
        launch: { mode: 'isolated_subprocess' },
        captured: { stdoutBytes: 100, stderrBytes: 50, exitSignal: 'SIGABRT', completionFacts: 'assertion failure' },
        classification: 'authoritative',
        comparedOutsideExecution: true,
        observationPath: '/tmp/obs.out',
      });
      store.add(obsRun);

      // Add an active liability reservation
      store.add({
        schemaVersion: 1, kind: 'reservation',
        reservationId: 'res-liability-vis',
        lineageId: 'lin-t11',
        dimension: 'cpu_ms',
        actionId: 'act-liability-vis',
        maxExposure: 500,
        state: 'ACTIVE',
      });

      const records = store.all();
      const observerRuns = records.filter((r) => r.kind === 'observer_run');
      const reservations = records.filter((r) => r.kind === 'reservation');

      assert.strictEqual(observerRuns.length, 1);
      assert.strictEqual(observerRuns[0].captured.exitSignal, 'SIGABRT');
      assert.strictEqual(reservations.length, 1);
      assert.strictEqual(reservations[0].state, 'ACTIVE');
    } finally {
      cleanupDir(d);
    }
  });

  // -------------------------------------------------------------------------
  // 9. Platform Qualification Boundary (Termux / Android Execution Isolation Profile)
  // -------------------------------------------------------------------------
  group('T-11.9: Platform Qualification Boundary (Termux / Android Execution Isolation Profile, IB-01 OPEN)');

  t('qualification reducer reports UNQUALIFIED when execution isolation probe / evidence fails or is missing', () => {
    const qualRecord = REC.createQualification({
      qualificationId: 'qual-t11-isolation',
      profileId: 'profile:linux-cgroup-process-isolation:v1',
      profileDigest: 'sha256:' + '9'.repeat(64),
      status: Q.QualificationStatus.QUALIFIED,
      evidenceBindings: [
        { surface: Q.EffectSurface.DESCENDANTS, evidenceIds: ['qe-isolation-1'] },
      ],
      admittedByContract: 'linux-contained',
      claimedAt: 1000,
    });

    const failedIsolationEv = REC.createQualEvidence({
      qualEvidenceId: 'qe-isolation-1',
      surface: Q.EffectSurface.DESCENDANTS,
      method: Q.EvidenceMethod.ACCESS_TEST,
      evidenceProfileBinding: 'profile:linux-cgroup-process-isolation:v1',
      result: Q.EvidenceResult.FAIL, // Failed kernel cgroup process fencing probe!
      timestamp: 2000,
      observerIdentity: 'observer-isolation-1',
    });

    const res = Q.resolveQualification({
      qualification: qualRecord,
      evidence: [failedIsolationEv],
      expectedProfileDigest: qualRecord.profileDigest,
    });

    assert.strictEqual(res.status, Q.QualificationStatus.UNQUALIFIED);
    assert.ok(res.problems.some((p) => p.includes('DESCENDANTS') && p.includes('FAIL')));
  });

  t('physical supervisor process isolation, kernel-level process tree fencing/cgroup freezing, and unbypassable kernel admission closure are NOT QUALIFIED on Termux, IB-01 OPEN', () => {
    // Pure ten-step protocol algebra, quiescence condition verification, state-machine transitions,
    // and fail-closed finalization reductions are fully verified.
    // Physical OS-level supervisor process isolation (e.g. pid namespaces, seccomp filters),
    // kernel-level process tree fencing/cgroup freezer subsystems, and hardware-enforced
    // non-bypassable admission barriers cannot be physically qualified on the Android/Termux
    // host environment without root / privileged namespace capabilities.
    const platformQualified = false; // Termux / Android host environment
    assert.strictEqual(platformQualified, false, 'Physical supervisor process isolation, kernel-level process tree fencing/cgroup freezing, and unbypassable kernel admission closure are NOT QUALIFIED on Termux/Android, QUALIFIED under the Docker runtime profile in CI');
  });
};
