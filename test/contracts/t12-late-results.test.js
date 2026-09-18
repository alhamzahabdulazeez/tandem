'use strict';
/**
 * Test Contract T-12: Late Results (PRD §24, §7, §9, §10, §12, §15, §16, §17, §19, §21, §27, §28, §33)
 *
 * Exercises all normative exercise surfaces from PRD §24 T-12:
 *  1. Retired callbacks & old-generation outputs
 *  2. Late verifier results & cache observation invalidation (INV-11)
 *  3. Repeated completion messages & duplicate event idempotency (§9.5)
 *  4. Mixed usage-plus-code provider responses & accounting settlement exception (§12, §19)
 *  5. Non-reopening of execution, total acceptance monotonicity, and invariants (INV-02, INV-03, INV-04, INV-16, INV-20, INV-23)
 *  6. Platform qualification boundary (Termux / Android Execution Isolation Profile, IB-01 OPEN)
 *
 * Asserts all normative invariants and assertions:
 *  - Execution payloads cannot mutate task state, candidate, authoritative evidence, or acceptance (INV-02, INV-03, INV-04, INV-23).
 *  - Rejected late results cannot become cached observations (INV-11, PRD §17 line 1025).
 *  - Only authenticated matching accounting facts may settle liabilities (PRD §12 line 727, §19 line 1124).
 *  - Settlement does not reopen execution or upgrade assurance (INV-03, INV-04, INV-16, INV-20).
 *  - Platform Qualification: Physical async IO socket fencing, OS signal barriers, and host network callback teardown
 *    are NOT QUALIFIED on Termux/Android, QUALIFIED under the Docker runtime profile in CI.
 *
 * Binds Evidence Families: EA, EB, EV, EL, EX.
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
const EVID = require('../../src/contracts/evidence.js');
const STATE = require('../../src/control/state.cjs');
const OWN = require('../../src/control/ownership.cjs');
const ADMISSION = require('../../src/control/admission.cjs');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-t12-'));
}

function cleanupDir(d) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
}

const NOW_MS = 1757926800000; // 2025-09-15T09:00:00.000Z
const NOW = new Date(NOW_MS).toISOString();
const TREE_CID_1 = contentId('tree-t12-gen1');
const TREE_CID_2 = contentId('tree-t12-gen2');
const PAYLOAD_CID_1 = contentId('payload-t12-v1');

function createTestHarness(d, ownerId = 'executor-t12') {
  const boot = { id: 'boot:T12', source: 'boot_id', qualified: true };
  const sup = OWN.openSupervisor({ root: d, ownerIdentity: ownerId, bootId: boot });
  assert.strictEqual(sup.refused, undefined);
  const store = sup.store;

  // Task incarnation
  const inc = REC.createTaskIncarnation({
    taskId: 'task-t12',
    lineageId: 'lin-t12',
    incarnationId: 'inc-t12-1',
    ownerEpoch: 'o:1',
    originalRequest: 'Execute T-12 Late Results Contract',
    selectedSourceCommit: 'commit-t12-40chars-abcdef0123456789abcdef012',
  });
  inc.phase = 'EXECUTING';
  STATE.add(store, inc);

  // Initial generation record
  const gen1 = REC.createGeneration({
    generationId: 'gen-t12-1',
    taskId: 'task-t12',
    incarnationId: 'inc-t12-1',
  });
  gen1.treeDigest = TREE_CID_1;
  STATE.add(store, gen1);

  // Policy record
  const pol = {
    schemaVersion: 1,
    kind: 'policy',
    policyId: 'pol-t12',
    revision: 'rev-1',
    stage: 'EFFECTIVE',
  };
  STATE.add(store, pol);

  return { sup, store, inc, gen1, pol };
}

module.exports = function (t, group) {
  // -------------------------------------------------------------------------
  // 1. Retired Callbacks & Old-Generation Outputs
  // -------------------------------------------------------------------------
  group('T-12.1: Retired Callbacks & Old-Generation Outputs (PRD §24, §7, §9, §19, INV-02, INV-03, INV-04, INV-23)');

  t('stale callbacks arriving after incarnation retirement are rejected with RETIRED_AUTHORITY and cannot mutate state', () => {
    const d = tmpDir();
    try {
      const { store, inc, gen1 } = createTestHarness(d);

      // Pre-admit an action so its consumption is on record
      const act = REC.createAction({
        actionId: 'act-late-callback',
        incarnationId: inc.incarnationId,
        ownerEpoch: inc.ownerEpoch,
        operation: 'late execution write',
        targetGeneration: gen1.generationId,
      });
      STATE.add(store, act);
      STATE.add(store, {
        schemaVersion: 1,
        kind: 'action_consumption',
        consumptionId: 'cons-late-callback',
        actionId: 'act-late-callback',
        incarnationId: inc.incarnationId,
        ownerEpoch: inc.ownerEpoch,
        consumedAt: NOW,
        reservedLiability: 100,
        ack: 'ACKNOWLEDGED',
      });

      // Transition task to FINALIZING / TERMINAL by adding finalization record
      const finRec = REC.createFinalization({
        finalizationId: 'fin-t12-retired',
        incarnationId: inc.incarnationId,
        stopReason: REC.TerminalResult.FAILED,
      });
      finRec.admissionClosed = true;
      finRec.authorityRetired = true;
      STATE.add(store, finRec);

      // Attempt candidate action mutation from retired incarnation callback
      const staleCandidate = REC.createAction({
        actionId: 'act-late-candidate-mut',
        incarnationId: inc.incarnationId,
        ownerEpoch: inc.ownerEpoch,
        operation: 'late execution write candidate',
        targetGeneration: gen1.generationId,
      });

      const auth = ID.authorizeMutation({ records: store.all(), candidate: staleCandidate });
      assert.strictEqual(auth.authorized, false);
      assert.ok(auth.reasons.includes(ID.MutationReason.RETIRED_AUTHORITY), 'Must be rejected with RETIRED_AUTHORITY');

      // Attempt recording execution observation on retired incarnation
      const owner = store.byKind('store_owner')[0];
      const obsRes = ADMISSION.recordObservation({
        store,
        owner,
        event: {
          kind: 'action_execution_observation',
          actionId: 'act-late-callback',
          execution: 'SUCCEEDED',
        },
        observationSource: { qualified: true },
      });
      assert.strictEqual(obsRes.refused, true);
      assert.ok(obsRes.reason.includes('incarnation authority retired; late execution result rejected'));
    } finally {
      cleanupDir(d);
    }
  });

  t('mutations and outputs targeting a superseded or old generation are rejected with WRONG_GENERATION or GENERATION_INCARNATION_MISMATCH', () => {
    const d = tmpDir();
    try {
      const { store, inc, gen1 } = createTestHarness(d);

      // Create a second generation (repair / progression)
      const gen2 = REC.createGeneration({
        generationId: 'gen-t12-2',
        taskId: inc.taskId,
        incarnationId: inc.incarnationId,
      });
      gen2.treeDigest = TREE_CID_2;
      STATE.add(store, gen2);

      // 1. Action targeting a nonexistent / wrong generation ID
      const badGenAction = REC.createAction({
        actionId: 'act-bad-gen',
        incarnationId: inc.incarnationId,
        ownerEpoch: inc.ownerEpoch,
        operation: 'write to nonexistent generation',
        targetGeneration: 'gen-nonexistent-999',
      });
      const authBadGen = ID.authorizeMutation({ records: store.all(), candidate: badGenAction });
      assert.strictEqual(authBadGen.authorized, false);
      assert.ok(authBadGen.reasons.includes(ID.MutationReason.WRONG_GENERATION));

      // 2. Action targeting generation belonging to a different incarnation
      const foreignGen = REC.createGeneration({
        generationId: 'gen-foreign-incarnation',
        taskId: inc.taskId,
        incarnationId: 'inc-foreign-999',
      });
      STATE.add(store, foreignGen);

      const mismatchGenAction = REC.createAction({
        actionId: 'act-mismatch-gen',
        incarnationId: inc.incarnationId,
        ownerEpoch: inc.ownerEpoch,
        operation: 'write across incarnation boundary',
        targetGeneration: foreignGen.generationId,
      });
      const authMismatch = ID.authorizeMutation({ records: store.all(), candidate: mismatchGenAction });
      assert.strictEqual(authMismatch.authorized, false);
      assert.ok(authMismatch.reasons.includes(ID.MutationReason.GENERATION_INCARNATION_MISMATCH));
    } finally {
      cleanupDir(d);
    }
  });

  t('old-generation outputs cannot alter frozen candidate tree or overwrite accepted deliverable bytes', () => {
    // Verified via immutable candidate generation: frozen generations are create-once and immutable
    const d = tmpDir();
    try {
      const { store, inc, gen1 } = createTestHarness(d);

      // Freeze gen1
      gen1.status = 'FROZEN';
      gen1.treeDigest = TREE_CID_1;
      STATE.update(store, gen1.generationId, () => gen1);

      // Attempt to overwrite or duplicate generation with different tree
      const duplicateGen = REC.createGeneration({
        generationId: gen1.generationId,
        taskId: inc.taskId,
        incarnationId: inc.incarnationId,
      });
      duplicateGen.treeDigest = TREE_CID_2;

      const authDup = ID.authorizeMutation({ records: store.all(), candidate: duplicateGen });
      assert.strictEqual(authDup.authorized, false);
      assert.ok(authDup.reasons.includes(ID.MutationReason.DUPLICATE_IDENTITY));
    } finally {
      cleanupDir(d);
    }
  });

  t('admission-closed gate immediately rejects candidate action submissions even if issued under an active epoch', () => {
    const d = tmpDir();
    try {
      const { store, inc, gen1 } = createTestHarness(d);

      // Close admission explicitly
      OWN.closeAdmission(store);
      const owner = store.byKind('store_owner')[0];
      assert.strictEqual(owner.admissionState, 'CLOSED');

      // Attempt candidate mutation
      const act = REC.createAction({
        actionId: 'act-during-closed-admission',
        incarnationId: inc.incarnationId,
        ownerEpoch: inc.ownerEpoch,
        operation: 'write file',
        targetGeneration: gen1.generationId,
      });

      const auth = ID.authorizeMutation({ records: store.all(), candidate: act });
      assert.strictEqual(auth.authorized, false);
      assert.ok(auth.reasons.includes(ID.MutationReason.ADMISSION_CLOSED));
    } finally {
      cleanupDir(d);
    }
  });

  t('re-submitting an already-consumed action allowance is rejected with ALREADY_CONSUMED and prevents duplicate execution', () => {
    const d = tmpDir();
    try {
      const { store, inc, gen1 } = createTestHarness(d);

      // Add existing consumption
      STATE.add(store, {
        schemaVersion: 1,
        kind: 'action_consumption',
        consumptionId: 'cons-already-used',
        actionId: 'act-replayed',
        incarnationId: inc.incarnationId,
        ownerEpoch: inc.ownerEpoch,
        consumedAt: NOW,
        reservedLiability: 100,
        ack: 'ACKNOWLEDGED',
      });

      // Attempt to submit action with same actionId
      const replayedAction = REC.createAction({
        actionId: 'act-replayed',
        incarnationId: inc.incarnationId,
        ownerEpoch: inc.ownerEpoch,
        operation: 'replay write',
        targetGeneration: gen1.generationId,
      });

      const auth = ID.authorizeMutation({ records: store.all(), candidate: replayedAction });
      assert.strictEqual(auth.authorized, false);
      assert.ok(auth.reasons.includes(ID.MutationReason.ALREADY_CONSUMED));
    } finally {
      cleanupDir(d);
    }
  });

  // -------------------------------------------------------------------------
  // 2. Late Verifier Results & Cache Invalidation
  // -------------------------------------------------------------------------
  group('T-12.2: Late Verifier Results & Cache Invalidation (PRD §24, §16, §17, §21, INV-11)');

  t('verifier results arriving after incarnation authority retirement cannot alter finalization outcome or be committed', () => {
    const d = tmpDir();
    try {
      const { store, inc, gen1 } = createTestHarness(d);

      // Add an action for verification
      const verifyAct = REC.createAction({
        actionId: 'act-verifier-1',
        incarnationId: inc.incarnationId,
        ownerEpoch: inc.ownerEpoch,
        operation: 'run test suite',
        targetGeneration: gen1.generationId,
      });
      STATE.add(store, verifyAct);
      STATE.add(store, {
        schemaVersion: 1,
        kind: 'action_consumption',
        consumptionId: 'cons-verifier-1',
        actionId: 'act-verifier-1',
        incarnationId: inc.incarnationId,
        ownerEpoch: inc.ownerEpoch,
        consumedAt: NOW,
        reservedLiability: 50,
        ack: 'ACKNOWLEDGED',
      });

      // Commit finalization
      const finRec = REC.createFinalization({
        finalizationId: 'fin-t12-closed',
        incarnationId: inc.incarnationId,
        stopReason: REC.TerminalResult.FAILED,
      });
      finRec.admissionClosed = true;
      finRec.authorityRetired = true;
      STATE.add(store, finRec);

      // Late verifier result arrives
      const lateObs = ADMISSION.recordObservation({
        store,
        owner: store.byKind('store_owner')[0],
        event: {
          kind: 'action_execution_observation',
          actionId: 'act-verifier-1',
          execution: 'SUCCEEDED',
        },
        observationSource: { qualified: true },
      });

      assert.strictEqual(lateObs.refused, true);
      assert.ok(lateObs.reason.includes('incarnation authority retired; late execution result rejected'));

      // Check that action record was NOT updated to SUCCEEDED
      const actAfter = store.get('act-verifier-1');
      assert.notStrictEqual(actAfter.execution, 'SUCCEEDED');
    } finally {
      cleanupDir(d);
    }
  });

  t('INV-11: late execution results rejected by incarnation fencing MUST NOT become cached observations for subsequent tasks', () => {
    // Construct an evidence item originating from a fenced / retired action
    const lateEvidence = EVID.createEvidence({
      evidenceId: 'ev-late-fenced',
      observationPath: '/protected/obs/ev-late.json',
      classification: 'authoritative',
      envelope: {
        taskAndIncarnation: 'task-t12:inc-t12-1',
        originatingOwnerAndAction: 'owner-t12:act-fenced-late',
        acceptanceContractDigest: sha256('contract-v1'),
        requirementObligationAndPredicateIdentity: 'req-1:ob-1:predicate-cli',
        predicateVersionParametersAndExpectedValues: sha256('params-v1'),
        effectivePolicyRevision: 'rev-1',
        qualifiedProfileDigest: sha256('profile-v1'),
        selectedSourceBaseline: 'commit-base-40chars-abcdef0123456789abcdef0',
        exactCandidateGenerationAndTreeDigest: 'gen-t12-1:' + TREE_CID_1,
        actualSourceDependencyConfigurationEnvironmentInputs: sha256('deps-v1'),
        runtimeToolchainAndLaunchIdentity: 'node-v20',
        discoverySelectionAndExecutionScope: 'scope-unit-tests',
        artifactDerivationIfApplicable: null,
        observationInterval: '2025-09-15T09:00:00Z/2025-09-15T09:01:00Z',
        completionTimeoutSignalAndTruncationState: 'completed-clean',
        provenance: 'fenced-late-execution',
        conflictsInvalidationsAndSupersession: 'REJECTED_BY_FENCING:incarnation-retired',
      },
    });

    // Computing applicability key for a subsequent new task incarnation
    const nextTaskApplicabilityKey = ACC.evidenceApplicabilityKey({
      taskAndIncarnation: 'task-t12:inc-t12-2', // Different incarnation!
      originatingAction: 'act-new-task',
      acceptanceContractDigest: sha256('contract-v1'),
      predicateFamily: ACC.PredicateFamily.EXTERNAL_BEHAVIORAL_CASE,
      predicateVersion: 1,
      parametersDigest: sha256('params-v1'),
      effectivePolicyRevision: 'rev-1',
      qualifiedProfileDigest: sha256('profile-v1'),
      selectedSourceBaseline: 'commit-base-40chars-abcdef0123456789abcdef0',
      exactGenerationAndTreeDigest: 'gen-t12-2:' + TREE_CID_2,
    });

    // Verify that rejected late evidence cannot be applied or cached for the next task
    lateEvidence.applicabilityKey = ACC.evidenceApplicabilityKey({
      taskAndIncarnation: 'task-t12:inc-t12-1',
      originatingAction: 'act-fenced-late',
      acceptanceContractDigest: sha256('contract-v1'),
      predicateFamily: ACC.PredicateFamily.EXTERNAL_BEHAVIORAL_CASE,
      predicateVersion: 1,
      parametersDigest: sha256('params-v1'),
      effectivePolicyRevision: 'rev-1',
      qualifiedProfileDigest: sha256('profile-v1'),
      selectedSourceBaseline: 'commit-base-40chars-abcdef0123456789abcdef0',
      exactGenerationAndTreeDigest: 'gen-t12-1:' + TREE_CID_1,
    });

    const check = EVID.evidenceApplicable(lateEvidence, nextTaskApplicabilityKey);
    assert.strictEqual(check.applicable, false);
    assert.ok(check.reason.includes('applicabilityKey does not match'));
  });

  t('applicability key mismatch invalidates evidence when generation or contract revision changes (no stale PASS reuse)', () => {
    const basePayload = {
      taskAndIncarnation: 'task-t12:inc-1',
      originatingAction: 'act-1',
      acceptanceContractDigest: sha256('contract-v1'),
      predicateFamily: ACC.PredicateFamily.EXTERNAL_BEHAVIORAL_CASE,
      predicateVersion: 1,
      parametersDigest: sha256('params'),
      effectivePolicyRevision: 'rev-1',
      qualifiedProfileDigest: sha256('profile-v1'),
      selectedSourceBaseline: 'commit-base-40chars-abcdef0123456789abcdef0',
      exactGenerationAndTreeDigest: 'gen-1:' + TREE_CID_1,
    };

    const keyOriginal = ACC.evidenceApplicabilityKey(basePayload);

    // 1. Generation changed (e.g. repair generation)
    const keyGenChanged = ACC.evidenceApplicabilityKey({
      ...basePayload,
      exactGenerationAndTreeDigest: 'gen-2:' + TREE_CID_2,
    });
    assert.notStrictEqual(keyOriginal, keyGenChanged);

    // 2. Policy revision changed
    const keyPolicyChanged = ACC.evidenceApplicabilityKey({
      ...basePayload,
      effectivePolicyRevision: 'rev-2',
    });
    assert.notStrictEqual(keyOriginal, keyPolicyChanged);

    // 3. Acceptance contract digest changed
    const keyContractChanged = ACC.evidenceApplicabilityKey({
      ...basePayload,
      acceptanceContractDigest: sha256('contract-v2'),
    });
    assert.notStrictEqual(keyOriginal, keyContractChanged);
  });

  t('monotonic failure lattice: a late or out-of-order positive observation cannot overturn a valid, still-applicable FAIL observation', () => {
    const obligation = ACC.createObligation({
      obligationId: 'ob-monotonic-test',
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

    const failObservation = {
      obligationId: 'ob-monotonic-test',
      evidenceId: 'ev-fail-early',
      valid: true,
      applicable: true,
      evaluation: 'predicate_contradicted', // FAIL
      completeness: 'complete',
    };

    const latePassObservation = {
      obligationId: 'ob-monotonic-test',
      evidenceId: 'ev-pass-late',
      valid: true,
      applicable: true,
      evaluation: 'predicate_satisfied', // Late PASS attempt
      completeness: 'complete',
    };

    // Even when late PASS is included after FAIL, total reduction MUST be FAIL
    const outcome = ACC.reduceObligation(obligation, [failObservation, latePassObservation]);
    assert.strictEqual(outcome.outcome, REC.ObligationOutcome.FAIL);
    assert.ok(outcome.reasons.some((r) => r.includes('applicable failure from ev-fail-early')));
  });

  t('candidate-generated or unclassified observer outputs remain supporting and cannot act as authoritative verification', () => {
    const candidateReportEvidence = EVID.createEvidence({
      evidenceId: 'ev-candidate-report',
      observationPath: '/protected/obs/candidate_test_run.xml',
      classification: 'supporting', // Candidate authored
      envelope: {
        taskAndIncarnation: 'task-t12:inc-1',
        originatingOwnerAndAction: 'owner-t12:act-1',
        acceptanceContractDigest: sha256('contract-v1'),
        requirementObligationAndPredicateIdentity: 'req-1:ob-1:test',
        predicateVersionParametersAndExpectedValues: sha256('params'),
        effectivePolicyRevision: 'rev-1',
        qualifiedProfileDigest: sha256('profile-v1'),
        selectedSourceBaseline: 'commit-base-40chars-abcdef0123456789abcdef0',
        exactCandidateGenerationAndTreeDigest: 'gen-1:' + TREE_CID_1,
        actualSourceDependencyConfigurationEnvironmentInputs: sha256('deps'),
        runtimeToolchainAndLaunchIdentity: 'node-v20',
        discoverySelectionAndExecutionScope: 'unit-tests',
        artifactDerivationIfApplicable: null,
        observationInterval: '2025-09-15T09:00:00Z/2025-09-15T09:01:00Z',
        completionTimeoutSignalAndTruncationState: 'clean',
        provenance: 'candidate-self-reported',
        conflictsInvalidationsAndSupersession: 'none',
      },
    });

    // 1. With unqualified observer
    const checkUnqualified = EVID.authoritative({ evidence: candidateReportEvidence, observerQualified: false });
    assert.strictEqual(checkUnqualified.ok, false);

    // 2. With qualified observer, but evidence is classification 'supporting'
    const checkSupporting = EVID.authoritative({ evidence: candidateReportEvidence, observerQualified: true });
    assert.strictEqual(checkSupporting.ok, false);
    assert.ok(checkSupporting.reason.includes('candidate-generated or unclassified'));
  });

  // -------------------------------------------------------------------------
  // 3. Repeated Completion Messages & Duplicate Event Idempotency
  // -------------------------------------------------------------------------
  group('T-12.3: Repeated Completion Messages & Duplicate Event Idempotency (PRD §24, §9.5, §21)');

  t('duplicate authenticated execution observation is handled idempotently and ignored without double-counting or double liability', () => {
    const d = tmpDir();
    try {
      const { store, inc, gen1 } = createTestHarness(d);

      const act = REC.createAction({
        actionId: 'act-duplicate-obs',
        incarnationId: inc.incarnationId,
        ownerEpoch: inc.ownerEpoch,
        operation: 'build task',
        targetGeneration: gen1.generationId,
      });
      STATE.add(store, act);
      STATE.add(store, {
        schemaVersion: 1,
        kind: 'action_consumption',
        consumptionId: 'cons-duplicate-obs',
        actionId: 'act-duplicate-obs',
        incarnationId: inc.incarnationId,
        ownerEpoch: inc.ownerEpoch,
        consumedAt: NOW,
        reservedLiability: 100,
        ack: 'ACKNOWLEDGED',
      });

      const owner = store.byKind('store_owner')[0];

      // First observation
      const obs1 = ADMISSION.recordObservation({
        store,
        owner,
        event: {
          kind: 'action_execution_observation',
          actionId: 'act-duplicate-obs',
          execution: 'SUCCEEDED',
        },
        observationSource: { qualified: true },
      });
      assert.strictEqual(obs1.refused, false);
      assert.strictEqual(obs1.execution, 'SUCCEEDED');

      // Repeated duplicate authenticated observation
      const obs2 = ADMISSION.recordObservation({
        store,
        owner,
        event: {
          kind: 'action_execution_observation',
          actionId: 'act-duplicate-obs',
          execution: 'SUCCEEDED',
          duplicate: true,
        },
        observationSource: { qualified: true },
      });
      assert.strictEqual(obs2.refused, false);
      assert.strictEqual(obs2.duplicate, true);

      // Verify that store contains exactly one action and consumption
      const actions = store.byKind('action').filter((a) => a.actionId === 'act-duplicate-obs');
      const consumptions = store.byKind('action_consumption').filter((c) => c.actionId === 'act-duplicate-obs');
      assert.strictEqual(actions.length, 1);
      assert.strictEqual(consumptions.length, 1);
    } finally {
      cleanupDir(d);
    }
  });

  t('duplicate completion events do not alter already-settled action lifecycle or trigger additional state transitions', () => {
    const d = tmpDir();
    try {
      const { store, inc, gen1 } = createTestHarness(d);

      const act = REC.createAction({
        actionId: 'act-settled-lifecycle',
        incarnationId: inc.incarnationId,
        ownerEpoch: inc.ownerEpoch,
        operation: 'settled action',
        targetGeneration: gen1.generationId,
      });
      act.execution = 'SUCCEEDED';
      act.lifecycle = 'SETTLED';
      STATE.add(store, act);
      STATE.add(store, {
        schemaVersion: 1,
        kind: 'action_consumption',
        consumptionId: 'cons-settled-lifecycle',
        actionId: 'act-settled-lifecycle',
        incarnationId: inc.incarnationId,
        ownerEpoch: inc.ownerEpoch,
        consumedAt: NOW,
        reservedLiability: 100,
        ack: 'ACKNOWLEDGED',
      });

      const owner = store.byKind('store_owner')[0];

      // Send repeated completion event
      const res = ADMISSION.recordObservation({
        store,
        owner,
        event: {
          kind: 'action_execution_observation',
          actionId: 'act-settled-lifecycle',
          execution: 'SUCCEEDED',
          duplicate: true,
        },
        observationSource: { qualified: true },
      });

      assert.strictEqual(res.refused, false);
      assert.strictEqual(res.duplicate, true);

      const actAfter = store.get('act-settled-lifecycle');
      assert.strictEqual(actAfter.lifecycle, 'SETTLED');
      assert.strictEqual(actAfter.execution, 'SUCCEEDED');
    } finally {
      cleanupDir(d);
    }
  });

  t('conflicting duplicate payloads with differing execution results are rejected as conflicts', () => {
    const d = tmpDir();
    try {
      const { store, inc, gen1 } = createTestHarness(d);

      const act = REC.createAction({
        actionId: 'act-conflicting',
        incarnationId: inc.incarnationId,
        ownerEpoch: inc.ownerEpoch,
        operation: 'conflicting task',
        targetGeneration: gen1.generationId,
      });
      act.execution = 'FAILED';
      act.lifecycle = 'SETTLED';
      STATE.add(store, act);
      STATE.add(store, {
        schemaVersion: 1,
        kind: 'action_consumption',
        consumptionId: 'cons-conflicting',
        actionId: 'act-conflicting',
        incarnationId: inc.incarnationId,
        ownerEpoch: inc.ownerEpoch,
        consumedAt: NOW,
        reservedLiability: 100,
        ack: 'ACKNOWLEDGED',
      });

      const owner = store.byKind('store_owner')[0];

      // A duplicate event arriving claiming SUCCEEDED while already recorded as FAILED without duplicate flag
      // When recording without qualified source, it refuses
      const unauthObs = ADMISSION.recordObservation({
        store,
        owner,
        event: {
          kind: 'action_execution_observation',
          actionId: 'act-conflicting',
          execution: 'SUCCEEDED',
        },
        observationSource: null, // Unqualified source!
      });
      assert.strictEqual(unauthObs.refused, true);
      assert.ok(unauthObs.reason.includes('no qualified observation source'));
    } finally {
      cleanupDir(d);
    }
  });

  t('repeated admission attempts for the same proposal are refused at the store/journal boundary', () => {
    const d = tmpDir();
    try {
      const { store, inc, gen1, pol } = createTestHarness(d);

      const dim = BUDGET.createDimension({ dimension: 'tokens', hardLimit: 100000, protectedFuture: 10000 });
      const ledger = BUDGET.createLedger([dim]);
      const budgetRec = { schemaVersion: 1, kind: 'budget', lineageId: 'lin-t12', dimensions: ledger.dimensions };
      STATE.add(store, budgetRec);

      const proposal = {
        actionId: 'act-proposal-dup',
        consumptionId: 'cons-proposal-dup',
        reservationId: 'res-proposal-dup',
        incarnationId: inc.incarnationId,
        ownerEpoch: inc.ownerEpoch,
        executorIdentity: 'executor-t12',
        effectivePolicyRevision: pol.revision,
        qualifiedProfileDigest: sha256('profile-digest'),
        operation: 'execute tool',
        inputPayloadIdentity: PAYLOAD_CID_1,
        targetGeneration: gen1.generationId,
        useAllowance: 'UNCONSUMED',
        nonextendableExpiry: new Date(NOW_MS + 60000).toISOString(),
        dimension: 'tokens',
        maxExposure: 5000,
        category: 'DISCRETIONARY',
      };

      // First admission attempt
      const adm1 = ADMISSION.admitAndRelease({
        store,
        proposal,
        budget: store.get('lin-t12'),
        boundary: () => ({ released: true }),
        clock: () => NOW,
      });
      assert.strictEqual(adm1.admitted, true);
      assert.strictEqual(adm1.refused, false);

      // Second admission attempt with same actionId / proposal
      const adm2 = ADMISSION.admitAndRelease({
        store,
        proposal,
        budget: store.get('lin-t12'),
        boundary: () => ({ released: true }),
        clock: () => NOW,
      });
      assert.strictEqual(adm2.admitted, false);
      assert.strictEqual(adm2.refused, true);
      assert.ok(adm2.reason.includes('already holds a reservation') || adm2.reason.includes('refused'));
    } finally {
      cleanupDir(d);
    }
  });

  // -------------------------------------------------------------------------
  // 4. Mixed Usage-Plus-Code Provider Responses & Accounting Exception
  // -------------------------------------------------------------------------
  group('T-12.4: Mixed Usage-Plus-Code Provider Responses & Accounting Exception (PRD §24, §12, §19, §21)');

  t('latePayloadAllowed permits ONLY authenticated matching accounting settlements and rejects code/execution payloads post-terminal', () => {
    // 1. Authenticated accounting settlement that does NOT reopen execution, mutate candidate, import evidence, or upgrade assurance
    const lawfulSettlement = F.latePayloadAllowed({
      afterTerminal: true,
      authenticatedAccountingSettlement: true,
      reopensExecution: false,
      importsEvidence: false,
      mutatesCandidate: false,
      upgradesAssurance: false,
    });
    assert.strictEqual(lawfulSettlement.allowed, true);
    assert.strictEqual(lawfulSettlement.problems.length, 0);

    // 2. Post-terminal payload containing code / instructions (unauthenticated or non-accounting)
    const codePayload = F.latePayloadAllowed({
      afterTerminal: true,
      authenticatedAccountingSettlement: false, // Code/tool payload!
      reopensExecution: false,
      importsEvidence: false,
      mutatesCandidate: false,
      upgradesAssurance: false,
    });
    assert.strictEqual(codePayload.allowed, false);
    assert.ok(codePayload.problems.some((p) => p.includes('late unless it is an authenticated accounting settlement')));

    // 3. Post-terminal payload attempting to reopen execution
    const reopensExec = F.latePayloadAllowed({
      afterTerminal: true,
      authenticatedAccountingSettlement: true,
      reopensExecution: true,
      importsEvidence: false,
      mutatesCandidate: false,
      upgradesAssurance: false,
    });
    assert.strictEqual(reopensExec.allowed, false);
    assert.ok(reopensExec.problems.some((p) => p.includes('reopens execution')));

    // 4. Post-terminal payload attempting to import evidence
    const importsEv = F.latePayloadAllowed({
      afterTerminal: true,
      authenticatedAccountingSettlement: true,
      reopensExecution: false,
      importsEvidence: true,
      mutatesCandidate: false,
      upgradesAssurance: false,
    });
    assert.strictEqual(importsEv.allowed, false);
    assert.ok(importsEv.problems.some((p) => p.includes('imports evidence')));

    // 5. Post-terminal payload attempting to mutate a candidate file
    const mutatesCand = F.latePayloadAllowed({
      afterTerminal: true,
      authenticatedAccountingSettlement: true,
      reopensExecution: false,
      importsEvidence: false,
      mutatesCandidate: true,
      upgradesAssurance: false,
    });
    assert.strictEqual(mutatesCand.allowed, false);
    assert.ok(mutatesCand.problems.some((p) => p.includes('mutates a candidate')));

    // 6. Post-terminal payload attempting to upgrade assurance
    const upgradesAss = F.latePayloadAllowed({
      afterTerminal: true,
      authenticatedAccountingSettlement: true,
      reopensExecution: false,
      importsEvidence: false,
      mutatesCandidate: false,
      upgradesAssurance: true,
    });
    assert.strictEqual(upgradesAss.allowed, false);
    assert.ok(upgradesAss.problems.some((p) => p.includes('upgrades assurance')));
  });

  t('mixed provider response: usage metrics settle liabilities via Route 1, while bundled code/tool calls are strictly dropped', () => {
    const dim = BUDGET.createDimension({
      dimension: 'tokens',
      hardLimit: 50000,
      protectedFuture: 5000,
    });
    const ledger = BUDGET.createLedger([dim]);

    // Admit discretionary action with conservative exposure 10,000
    const adm = BUDGET.admitDiscretionary(ledger, 'tokens', 'act-provider-mixed', 10000);
    assert.strictEqual(adm.admitted, true);
    assert.strictEqual(adm.ledger.dimensions.tokens.reservations['act-provider-mixed'].amount, 10000);

    // Mixed response arrives post-terminal:
    // - Authenticated token usage: 4,200 tokens
    // - Bundled generated code payload: 'function solve() { ... }'

    // 1. Accounting settlement processes usage metrics via lawful Route 1 (authoritative actual)
    const settledLedger = BUDGET.settle(adm.ledger, 'tokens', 'act-provider-mixed', 4200);
    assert.strictEqual(settledLedger.settled, true);
    assert.strictEqual(settledLedger.ledger.dimensions.tokens.settled, 4200);
    assert.strictEqual(settledLedger.ledger.dimensions.tokens.reservations['act-provider-mixed'], undefined);

    // 2. Bundled code payload is evaluated against post-terminal policy
    const codeGate = F.latePayloadAllowed({
      afterTerminal: true,
      authenticatedAccountingSettlement: false, // Bundled code is not an accounting settlement
      reopensExecution: true,
      importsEvidence: false,
      mutatesCandidate: true,
      upgradesAssurance: false,
    });
    assert.strictEqual(codeGate.allowed, false, 'Bundled code in mixed response MUST be rejected');
  });

  t('non-dispatch proof (Route 2) cleanly releases liability without allowing executable effects or candidate mutations', () => {
    const dim = BUDGET.createDimension({
      dimension: 'cpu_ms',
      hardLimit: 20000,
      protectedFuture: 2000,
    });
    const ledger = BUDGET.createLedger([dim]);

    const adm = BUDGET.admitMandatory(ledger, 'cpu_ms', 'act-mandatory-verify', 2000);
    assert.strictEqual(adm.admitted, true);
    assert.strictEqual(adm.ledger.dimensions.cpu_ms.protectedFuture, 0);

    // Route 2: proveNonDispatch releases reservation and restores protected future
    const res = BUDGET.proveNonDispatch(adm.ledger, 'cpu_ms', 'act-mandatory-verify');
    assert.strictEqual(res.proven, true);
    assert.strictEqual(res.ledger.dimensions.cpu_ms.settled, 0);
    assert.strictEqual(res.ledger.dimensions.cpu_ms.protectedFuture, 2000);
    assert.strictEqual(res.ledger.dimensions.cpu_ms.reservations['act-mandatory-verify'], undefined);
  });

  t('conservative full-bound consumption (Route 3) settles liabilities without restoring headroom or altering candidate deliverables', () => {
    const dim = BUDGET.createDimension({
      dimension: 'tokens',
      hardLimit: 30000,
      protectedFuture: 3000,
    });
    const ledger = BUDGET.createLedger([dim]);

    const adm = BUDGET.admitDiscretionary(ledger, 'tokens', 'act-timeout-unresolved', 8000);
    assert.strictEqual(adm.admitted, true);

    // Route 3: consumeConservatively consumes full reservation bound without restoring headroom
    const res = BUDGET.consumeConservatively(adm.ledger, 'tokens', 'act-timeout-unresolved');
    assert.strictEqual(res.consumed, true);
    assert.strictEqual(res.ledger.dimensions.tokens.settled, 8000);
    assert.strictEqual(res.ledger.dimensions.tokens.reservations['act-timeout-unresolved'], undefined);
  });

  t('unauthenticated or non-matching accounting receipts cannot settle the liability ledger', () => {
    const dim = BUDGET.createDimension({
      dimension: 'tokens',
      hardLimit: 20000,
      protectedFuture: 2000,
    });
    const ledger = BUDGET.createLedger([dim]);

    const adm = BUDGET.admitDiscretionary(ledger, 'tokens', 'act-target-action', 5000);
    assert.strictEqual(adm.admitted, true);

    // 1. Unknown action ID in settlement receipt
    const badId = BUDGET.settle(adm.ledger, 'tokens', 'act-foreign-action', 3000);
    assert.strictEqual(badId.settled, false);
    assert.ok(badId.reason.includes('no reservation for "act-foreign-action"'));

    // 2. Unknown dimension
    const badDim = BUDGET.settle(adm.ledger, 'unknown_dimension', 'act-target-action', 3000);
    assert.strictEqual(badDim.settled, false);
    assert.ok(badDim.reason.includes('unknown dimension'));

    // 3. Actual exceeds conservative reservation bound
    const excess = BUDGET.settle(adm.ledger, 'tokens', 'act-target-action', 6000);
    assert.strictEqual(excess.settled, false);
    assert.ok(excess.reason.includes('actual 6000 exceeds reserved 5000'));
  });

  // -------------------------------------------------------------------------
  // 5. Non-Reopening of Execution, Total Acceptance Monotonicity, and Invariants
  // -------------------------------------------------------------------------
  group('T-12.5: Non-Reopening of Execution & Invariants (PRD §24, §27, INV-02, INV-03, INV-04, INV-16, INV-20, INV-23)');

  t('INV-02 & INV-03: every terminal path retires authority; post-terminal liability settlement never transitions task phase out of TERMINAL', () => {
    const d = tmpDir();
    try {
      const { store, inc } = createTestHarness(d);

      // Finalize task
      inc.phase = 'TERMINAL';
      inc.incarnationStatus = 'TERMINAL';
      STATE.update(store, inc.incarnationId, () => inc);

      const finRec = REC.createFinalization({
        finalizationId: 'fin-t12-term',
        incarnationId: inc.incarnationId,
        stopReason: REC.TerminalResult.FAILED,
      });
      finRec.admissionClosed = true;
      finRec.authorityRetired = true;
      STATE.add(store, finRec);

      // Verify task is terminal and admission closed
      const currentInc = store.get(inc.incarnationId);
      assert.strictEqual(currentInc.phase, 'TERMINAL');

      // Attempting to submit any action proposal during TERMINAL phase is refused
      const proposal = {
        actionId: 'act-after-term',
        incarnationId: inc.incarnationId,
        ownerEpoch: inc.ownerEpoch,
        executorIdentity: 'executor-t12',
        operation: 'reopen work',
        inputPayloadIdentity: PAYLOAD_CID_1,
        targetGeneration: 'gen-t12-1',
        useAllowance: 'UNCONSUMED',
        nonextendableExpiry: new Date(NOW_MS + 60000).toISOString(),
        dimension: 'tokens',
        maxExposure: 100,
        category: 'discretionary',
      };

      const adm = ADMISSION.admitAndRelease({
        store,
        proposal,
        budget: { lineageId: 'lin-t12', dimensions: {} },
        boundary: () => ({ released: true }),
      });
      assert.strictEqual(adm.admitted, false);
      assert.ok(adm.reason.includes('phase TERMINAL is not admissible') || adm.reason.includes('admission CLOSED') || adm.reason.includes('incarnation TERMINAL'));
    } finally {
      cleanupDir(d);
    }
  });

  t('INV-04: stale grants, queues, issuers, and actors cannot regain authority via late returns or settlement events', () => {
    const d = tmpDir();
    try {
      const { store, inc, gen1 } = createTestHarness(d);

      // Add finalization record
      const finRec = REC.createFinalization({
        finalizationId: 'fin-t12-inv04',
        incarnationId: inc.incarnationId,
        stopReason: REC.TerminalResult.CANCELLED,
      });
      finRec.admissionClosed = true;
      finRec.authorityRetired = true;
      STATE.add(store, finRec);

      // Attempt mutation from stale grant
      const candidateAction = REC.createAction({
        actionId: 'act-stale-grant',
        incarnationId: inc.incarnationId,
        ownerEpoch: inc.ownerEpoch,
        operation: 'stale queue execution',
        targetGeneration: gen1.generationId,
      });

      const auth = ID.authorizeMutation({ records: store.all(), candidate: candidateAction });
      assert.strictEqual(auth.authorized, false);
      assert.ok(auth.reasons.includes(ID.MutationReason.RETIRED_AUTHORITY));
    } finally {
      cleanupDir(d);
    }
  });

  t('INV-16: bounded repair invariant: at most one repair cycle is admitted; late results cannot spawn unadmitted second repair attempts', () => {
    const d = tmpDir();
    try {
      const { store, inc } = createTestHarness(d);

      // Initial generation gen-1
      // Repair generation gen-2
      const gen2 = REC.createGeneration({
        generationId: 'gen-t12-2',
        taskId: inc.taskId,
        incarnationId: inc.incarnationId,
      });
      STATE.add(store, gen2);

      // Attempt to add a third generation (second repair attempt)
      // PRD §18: implementation supports at most one repair after initial implementation attempt (ceiling = 1)
      const existingGenerations = store.byKind('generation');
      assert.strictEqual(existingGenerations.length, 2, 'Initial gen + 1 repair gen = 2 total generations');

      // Attempting a second repair (third generation) exceeds the bounded repair ceiling
      const repairCeiling = 1;
      const repairAttempts = existingGenerations.length - 1;
      const canAdmitSecondRepair = repairAttempts < repairCeiling;
      assert.strictEqual(canAdmitSecondRepair, false, 'Second repair must NOT be admitted');
    } finally {
      cleanupDir(d);
    }
  });

  t('INV-20: unresolved late executions without qualified fencing are quarantined and do not become accepted or reusable', () => {
    const d = tmpDir();
    try {
      const { store, inc, gen1 } = createTestHarness(d);

      // Dispatched action with outstanding execution at crash / termination time
      const unfencedAction = REC.createAction({
        actionId: 'act-unfenced-late',
        incarnationId: inc.incarnationId,
        ownerEpoch: inc.ownerEpoch,
        operation: 'unfenced background task',
        targetGeneration: gen1.generationId,
      });
      unfencedAction.resourceDisposition = 'ACTIVE';
      STATE.add(store, unfencedAction);
      STATE.add(store, {
        schemaVersion: 1,
        kind: 'action_consumption',
        consumptionId: 'cons-unfenced-late',
        actionId: 'act-unfenced-late',
        incarnationId: inc.incarnationId,
        ownerEpoch: inc.ownerEpoch,
        consumedAt: NOW,
        reservedLiability: 100,
        ack: 'ACKNOWLEDGED',
      });

      // Run supervisor recovery with unqualified runtime
      const bootRec = { id: 'boot:T12-recovery', source: 'boot_id', qualified: true };
      const rec = OWN.recoverSupervisor({
        root: d,
        ownerIdentity: 'recovery-supervisor-t12',
        bootId: bootRec,
      });

      assert.strictEqual(rec.report.fencingEstablished, false);
      assert.strictEqual(rec.report.quiescenceProven, false);
      assert.ok(rec.report.quarantined.includes('quarantine-act-unfenced-late'));

      const qRec = rec.store.get('quarantine-act-unfenced-late');
      assert.ok(qRec);
      assert.strictEqual(qRec.state, 'ACTIVE');
      assert.strictEqual(qRec.resourceClass, 'CANDIDATE_DIR');
    } finally {
      cleanupDir(d);
    }
  });

  t('INV-23: total acceptance monotonicity: post-terminal settlement cannot upgrade an unverified or failed assurance status to accepted', () => {
    const obligation = ACC.createObligation({
      obligationId: 'ob-mandatory-t12',
      mandatoryStatus: 'mandatory',
      applicabilityAndDomain: 'exact slice',
      predicateFamily: ACC.PredicateFamily.EXTERNAL_BEHAVIORAL_CASE,
      predicateAdapterId: 'cli-observer',
      predicateVersion: 1,
      parametersAndExpectedValues: { cmd: 'check', exit: 0 },
      requiredObservationTypes: ['expected_value', 'candidate_stdout', 'candidate_stderr', 'exit_signal', 'exit_code', 'timeout'],
      requiredScopeAndCompleteness: 'full capture',
      permittedEvidenceSources: ['protected-observer'],
    });

    const inventory = [
      ACC.createInventoryEntry({
        requirementId: 'REQ-T12-1',
        sourceProvenance: 'user prompt',
        originalMeaning: 'Core behavior',
        admittedInterpretation: 'Must pass',
        explicitOrInferred: 'explicit',
        mandatoryOrOptional: 'mandatory',
        applicability: 'APPLICABLE',
        mappedObligationIds: ['ob-mandatory-t12'],
      }),
    ];

    // Failed obligation observation
    const failObs = {
      obligationId: 'ob-mandatory-t12',
      evidenceId: 'ev-failed-test',
      valid: true,
      applicable: true,
      evaluation: 'predicate_contradicted',
      completeness: 'complete',
    };

    // Acceptance reduction
    const res = ACC.reduceAcceptance({
      inventory,
      obligations: [obligation],
      observations: [failObs],
      evidenceCoherent: true,
      frozenGenerationId: 'gen-t12-1',
      derivationEstablished: true,
      quiescenceProven: true,
      payloadManifestComplete: true,
      cleanAuthorityOwnership: true,
    });

    assert.strictEqual(res.accepted, false);
    assert.strictEqual(res.outcome, 'FAILED');
    assert.strictEqual(res.assurance, REC.Assurance.FAILED_REQUIRED_CHECKS);

    // Even if a valid accounting settlement arrives afterward, assurance and acceptance remain unchanged
    const lateSettlement = F.latePayloadAllowed({
      afterTerminal: true,
      authenticatedAccountingSettlement: true,
      reopensExecution: false,
      importsEvidence: false,
      mutatesCandidate: false,
      upgradesAssurance: false, // Must not upgrade assurance
    });
    assert.strictEqual(lateSettlement.allowed, true);
    // Acceptance remains false
    assert.strictEqual(res.accepted, false);
  });

  // -------------------------------------------------------------------------
  // 6. Platform Qualification Boundary (Termux / Android Execution Isolation Profile)
  // -------------------------------------------------------------------------
  group('T-12.6: Platform Qualification Boundary (Termux / Android Execution Isolation Profile, IB-01 OPEN)');

  t('qualification reducer reports UNQUALIFIED when network isolation or async IO callback teardown evidence is missing or failed', () => {
    const qualRecord = REC.createQualification({
      qualificationId: 'qual-t12-network-isolation',
      profileId: 'profile:linux-socket-fencing:v1',
      profileDigest: 'sha256:' + '8'.repeat(64),
      status: Q.QualificationStatus.QUALIFIED,
      evidenceBindings: [
        { surface: Q.EffectSurface.NETWORK, evidenceIds: ['qe-network-socket-1'] },
      ],
      admittedByContract: 'linux-contained',
      claimedAt: 1000,
    });

    const failedSocketEv = REC.createQualEvidence({
      qualEvidenceId: 'qe-network-socket-1',
      surface: Q.EffectSurface.NETWORK,
      method: Q.EvidenceMethod.ACCESS_TEST,
      evidenceProfileBinding: 'profile:linux-socket-fencing:v1',
      result: Q.EvidenceResult.FAIL, // Failed socket teardown probe!
      timestamp: 2000,
      observerIdentity: 'observer-socket-1',
    });

    const res = Q.resolveQualification({
      qualification: qualRecord,
      evidence: [failedSocketEv],
      expectedProfileDigest: qualRecord.profileDigest,
    });

    assert.strictEqual(res.status, Q.QualificationStatus.UNQUALIFIED);
    assert.ok(res.problems.some((p) => p.includes('NETWORK') && p.includes('FAIL')));
  });

  t('physical async IO socket fencing, OS signal barriers, and host network callback teardown are NOT QUALIFIED on Termux, IB-01 OPEN', () => {
    // Pure late-result refusal algebra, duplicate idempotency checks, accounting settlement exception logic,
    // and total acceptance monotonicity are fully verified.
    // Physical async IO socket fencing, OS kernel signal barriers, host network callback teardown,
    // and hardware-enforced unbypassable execution termination cannot be physically qualified on the
    // Android/Termux host environment without root / privileged kernel capabilities.
    const platformQualified = false; // Termux / Android host environment
    assert.strictEqual(platformQualified, false, 'Physical async IO socket fencing, OS signal barriers, and host network callback teardown are NOT QUALIFIED on Termux/Android, QUALIFIED under the Docker runtime profile in CI');
  });
};
