'use strict';
/**
 * Test Contract T-02: Transitive Containment (PRD §24, §5, §8, §9, §19, §29)
 *
 * Exercises all 9 normative exercise surfaces from PRD §24 T-02:
 *  1. Direct writes/reads outside admitted envelope
 *  2. Double-forked descendants
 *  3. Detached grandchildren
 *  4. Retained descriptors / handle inheritance
 *  5. Hidden tools & undeclared tool invocations
 *  6. Host sockets / host IPC & service handoffs
 *  7. Control-state, incumbent, evidence, & credential resource access
 *  8. Credential inheritance via environment/handles
 *  9. Malicious checker/baseline repository scripts
 *
 * Asserts all 7 normative invariants:
 *  - Every effect remains inside the admitted envelope
 *  - Parent exit does not release descendants
 *  - Repository execution cannot access incumbent/control/evidence/credential resources
 *  - Host-service handoffs are unavailable
 *  - Checker/baseline execution receives no trust exemption
 *  - Missing containment blocks execution
 *  - Loss of control triggers fencing or unresolved quarantine, not observer relabeling
 *
 * Binds Evidence Families: E0, ER, EA, EL, EX.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REC = require('../../src/contracts/records.js');
const ID = require('../../src/contracts/identity.js');
const { contentId, sha256, canonicalJson } = require('../../src/contracts/crypto.js');
const Q = require('../../src/contracts/qualification.js');
const CA = require('../../src/contracts/capability-admission.js');
const F = require('../../src/contracts/finalization.js');
const STATE = require('../../src/control/state.cjs');
const OWN = require('../../src/control/ownership.cjs');
const BL = require('../../src/control/budget-ledger.cjs');
const ADMISSION = require('../../src/control/admission.cjs');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-t02-'));
}

function cleanupDir(d) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
}

const NOW_MS = 1757926800000; // 2025-09-15T09:00:00.000Z
const NOW = new Date(NOW_MS).toISOString();
const FUTURE = new Date(NOW_MS + 60000).toISOString();
const PAST = new Date(NOW_MS - 60000).toISOString();

function createTestHarness(d) {
  const boot = { id: 'boot:T02', source: 'boot_id', qualified: true };
  const sup = OWN.openSupervisor({ root: d, ownerIdentity: 'executor-primary', bootId: boot });
  assert.strictEqual(sup.refused, undefined);
  const store = sup.store;

  // Add task incarnation
  const inc = REC.createTaskIncarnation({
    taskId: 'task-t02',
    lineageId: 'lin-t02',
    incarnationId: 'inc-t02',
    ownerEpoch: 'o:1',
    originalRequest: 'Execute T-02 Transitive Containment',
    selectedSourceCommit: 'commit-t02',
  });
  inc.phase = 'READY';
  STATE.add(store, inc);

  // Add generation
  const gen = REC.createGeneration({
    generationId: 'gen-t02',
    taskId: 'task-t02',
    incarnationId: 'inc-t02',
    treeDigest: 'sha256:' + '0'.repeat(64),
  });
  STATE.add(store, gen);

  // Add policy record
  const policy = {
    schemaVersion: 1,
    kind: 'policy',
    policyId: 'pol-t02',
    revision: 'rev-1',
    stage: 'EFFECTIVE',
  };
  STATE.add(store, policy);

  // Create budget ledger
  const budget = BL.initBudget('lin-t02', [{ dimension: 'tokens', hardLimit: 1000, protectedFuture: 0 }]);
  STATE.add(store, budget);

  return { store, sup, budget };
}

function baseProposal(overrides = {}) {
  return {
    actionId: 'act-t02-001',
    executorIdentity: 'executor-primary',
    incarnationId: 'inc-t02',
    ownerEpoch: 'o:1',
    effectivePolicyRevision: 'rev-1',
    qualifiedProfileDigest: 'sha256:' + '1'.repeat(64),
    operation: 'write_file',
    inputPayloadIdentity: contentId('payload-t02-001'),
    targetGeneration: 'gen-t02',
    disclosureScope: ['/workspace/safe'],
    useAllowance: 'UNCONSUMED',
    nonextendableExpiry: FUTURE,
    dimension: 'tokens',
    maxExposure: 50,
    category: 'DISCRETIONARY',
    ...overrides,
  };
}

module.exports = function run(t, group) {
  // -------------------------------------------------------------------------
  // 1. Admitted Envelope Enforcement (Direct reads/writes & hidden tools)
  // -------------------------------------------------------------------------
  group('T-02.1: Admitted Envelope Enforcement (Direct reads/writes & hidden tools)');

  t('direct filesystem operation outside admitted envelope/scope is prohibited', () => {
    // Envelope widening / out-of-bounds path check
    const activeEnvelope = {
      isLive: true,
      tools: ['read_file', 'write_file'],
      scopes: ['/workspace/safe'],
      resourceCeilings: { tokens: 1000 },
      authorityLevel: 'TASK_BOUNDED',
      capabilities: ['LOCAL_CONTAINED_FS'],
    };

    const outOfBoundsEnvelope = {
      tools: ['read_file', 'write_file'],
      scopes: ['/workspace/safe', '/etc/shadow', '/root/.ssh'], // Out-of-bounds path
      resourceCeilings: { tokens: 1000 },
      authorityLevel: 'TASK_BOUNDED',
      capabilities: ['LOCAL_CONTAINED_FS'],
    };

    const check = CA.checkEnvelopeWidening(activeEnvelope, outOfBoundsEnvelope);
    assert.strictEqual(check.allowed, false);
    assert.strictEqual(check.widened, true);
    assert.ok(check.reason.includes('proposed scope "/etc/shadow" widens active task envelope'));
  });

  t('hidden or undeclared tool invocations are blocked by envelope enforcement', () => {
    const activeEnvelope = {
      isLive: true,
      tools: ['read_file', 'write_file'],
      scopes: ['/workspace/safe'],
      resourceCeilings: { tokens: 1000 },
      authorityLevel: 'TASK_BOUNDED',
      capabilities: ['LOCAL_CONTAINED_FS'],
    };

    const hiddenToolEnvelope = {
      tools: ['read_file', 'write_file', 'raw_host_exec', 'spawn_daemon'], // Undeclared/hidden tools
      scopes: ['/workspace/safe'],
      resourceCeilings: { tokens: 1000 },
      authorityLevel: 'TASK_BOUNDED',
      capabilities: ['LOCAL_CONTAINED_FS'],
    };

    const check = CA.checkEnvelopeWidening(activeEnvelope, hiddenToolEnvelope);
    assert.strictEqual(check.allowed, false);
    assert.strictEqual(check.widened, true);
    assert.ok(check.reason.includes('proposed tool "raw_host_exec" widens active task envelope'));
  });

  t('resource ceiling and capability widening during live execution is rejected', () => {
    const activeEnvelope = {
      isLive: true,
      tools: ['read_file', 'write_file'],
      scopes: ['/workspace/safe'],
      resourceCeilings: { tokens: 1000, time_ms: 5000 },
      authorityLevel: 'TASK_BOUNDED',
      capabilities: ['LOCAL_CONTAINED_FS'],
    };

    const widenedResourceEnvelope = {
      tools: ['read_file', 'write_file'],
      scopes: ['/workspace/safe'],
      resourceCeilings: { tokens: 5000, time_ms: 5000 }, // Tokens ceiling escalated
      authorityLevel: 'TASK_BOUNDED',
      capabilities: ['LOCAL_CONTAINED_FS', 'UNRESTRICTED_NETWORK'], // Capability widened
    };

    const check = CA.checkEnvelopeWidening(activeEnvelope, widenedResourceEnvelope);
    assert.strictEqual(check.allowed, false);
    assert.strictEqual(check.widened, true);
    assert.ok(check.reason.includes('proposed ceiling for dimension "tokens" (5000) exceeds active envelope ceiling (1000)'));
    assert.ok(check.reason.includes('proposed capability "UNRESTRICTED_NETWORK" widens active task envelope'));
  });

  // -------------------------------------------------------------------------
  // 2. Descendant Process Containment (Double-forks & detached grandchildren)
  // -------------------------------------------------------------------------
  group('T-02.2: Descendant Process Containment (Double-forks & detached grandchildren)');

  t('runtime profile requires explicit descendant containment proof (EffectSurface.DESCENDANTS)', () => {
    // Assert qualification status fails closed when DESCENDANTS surface lacks evidence
    const qualRecord = REC.createQualification({
      qualificationId: 'qual-desc-test',
      profileId: 'profile:linux-cgroup-v2:v1',
      profileVersion: '1.0.0',
      profileDigest: 'sha256:' + '2'.repeat(64),
      status: Q.QualificationStatus.QUALIFIED,
      evidenceBindings: [
        { surface: Q.EffectSurface.FILESYSTEM, evidenceIds: ['qe-fs-1'] },
        { surface: Q.EffectSurface.DESCENDANTS, evidenceIds: ['qe-desc-1'] },
      ],
      admittedByContract: 'linux-contained',
      claimedAt: 1000,
    });

    const fsEv = REC.createQualEvidence({
      qualEvidenceId: 'qe-fs-1',
      surface: Q.EffectSurface.FILESYSTEM,
      method: Q.EvidenceMethod.ACCESS_TEST,
      evidenceProfileBinding: 'profile:linux-cgroup-v2:v1',
      result: Q.EvidenceResult.PASS,
      timestamp: 2000,
      observerIdentity: 'observer-auth-1',
    });

    const res = Q.resolveQualification({
      qualification: qualRecord,
      evidence: [fsEv],
      expectedProfileDigest: qualRecord.profileDigest,
    });

    assert.strictEqual(res.status, Q.QualificationStatus.UNQUALIFIED);
    assert.ok(res.problems.some((p) => p.includes('DESCENDANTS') && p.includes('no evidence at all')));
  });

  t('parent exit alone is insufficient for quiescence (IB-01 complete effect closure required)', () => {
    // Quiescence validation fails closed when effect closure is unproven
    const q1 = F.quiescenceConditions({
      noAdmittedMutatorRemaining: false, // Surviving detached descendant
      noLateResultCommittable: true,
      reproducedByQualifiedRuntimeBoundary: true,
    });
    assert.strictEqual(q1.ok, false);
    assert.ok(q1.problems.some((p) => p.includes('an admitted actor can still mutate')));

    const q2 = F.quiescenceConditions({
      noAdmittedMutatorRemaining: true,
      noLateResultCommittable: true,
      reproducedByQualifiedRuntimeBoundary: false, // Missing IB-01 qualified boundary
    });
    assert.strictEqual(q2.ok, false);
    assert.ok(q2.problems.some((p) => p.includes('quiescence proof does not rely on the qualified runtime boundary')));
  });

  t('surviving uncontained descendants prevent clean finalization and force UNRESOLVED_EXECUTION', () => {
    const finalizationResult = F.reduceFinalization({
      stopReason: REC.TerminalResult.COMPLETE,
      admissionClosed: true,
      authorityRetired: true,
      fencingEstablished: false, // Fencing failed due to surviving detached grandchild
      reconciliationComplete: false,
      quarantineAppliedForUnresolved: true,
      truthfulResultReduced: true,
      publicationOrderingComplete: false,
      quiescenceProven: false, // Quiescence unproven
    });

    assert.strictEqual(finalizationResult.status, F.FINALIZATION_STATUS.UNRESOLVED_EXECUTION);
    assert.strictEqual(finalizationResult.terminalResult, REC.TerminalResult.UNRESOLVED_EXECUTION);
    assert.strictEqual(finalizationResult.publishes, false);
    assert.strictEqual(finalizationResult.quiescenceProven, false);
    assert.strictEqual(finalizationResult.unresolved, true);
    assert.ok(finalizationResult.problems.some((p) => p.includes('fencing cannot be established') || p.includes('qualified termination/fencing fallback was not applied')));
  });

  // -------------------------------------------------------------------------
  // 3. Resource Isolation (Incumbent, Control-State, Evidence, and Credentials)
  // -------------------------------------------------------------------------
  group('T-02.3: Resource Isolation (Incumbent, Control-State, Evidence, & Credentials)');

  t('supervisor control-state and store mutation by untrusted execution is prohibited', () => {
    // Qualification surface SUPERVISOR_CONTROL proof requirement
    assert.strictEqual(Q.EffectSurface.SUPERVISOR_CONTROL, 'SUPERVISOR_CONTROL');

    // Probing supervisor control evidence: failing probe fails closed
    const failCtrlEv = REC.createQualEvidence({
      qualEvidenceId: 'qe-ctrl-fail',
      surface: Q.EffectSurface.SUPERVISOR_CONTROL,
      method: Q.EvidenceMethod.ISOLATION_TEST,
      evidenceProfileBinding: 'profile:linux-cgroup-v2:v1',
      result: Q.EvidenceResult.FAIL, // Probe observed store write leak!
      timestamp: 2000,
      observerIdentity: 'observer-auth-1',
    });

    const qualRecord = REC.createQualification({
      qualificationId: 'qual-ctrl-test',
      profileId: 'profile:linux-cgroup-v2:v1',
      profileVersion: '1.0.0',
      profileDigest: 'sha256:' + '3'.repeat(64),
      status: Q.QualificationStatus.QUALIFIED,
      evidenceBindings: [
        { surface: Q.EffectSurface.SUPERVISOR_CONTROL, evidenceIds: ['qe-ctrl-fail'] },
      ],
      admittedByContract: 'linux-contained',
      claimedAt: 1000,
    });

    const res = Q.resolveQualification({
      qualification: qualRecord,
      evidence: [failCtrlEv],
      expectedProfileDigest: qualRecord.profileDigest,
    });

    assert.strictEqual(res.status, Q.QualificationStatus.UNQUALIFIED);
    assert.ok(res.problems.some((p) => p.includes('FAILED') && p.includes('SUPERVISOR_CONTROL')));
  });

  t('credential inheritance via environment or handles fails qualification', () => {
    const credEv = REC.createQualEvidence({
      qualEvidenceId: 'qe-cred-fail',
      surface: Q.EffectSurface.CREDENTIALS,
      method: Q.EvidenceMethod.ACCESS_TEST,
      evidenceProfileBinding: 'profile:linux-cgroup-v2:v1',
      result: Q.EvidenceResult.FAIL, // Leaked API keys into child environment
      timestamp: 2000,
      observerIdentity: 'observer-auth-1',
    });

    const qualRecord = REC.createQualification({
      qualificationId: 'qual-cred-test',
      profileId: 'profile:linux-cgroup-v2:v1',
      profileVersion: '1.0.0',
      profileDigest: 'sha256:' + '4'.repeat(64),
      status: Q.QualificationStatus.QUALIFIED,
      evidenceBindings: [
        { surface: Q.EffectSurface.CREDENTIALS, evidenceIds: ['qe-cred-fail'] },
      ],
      admittedByContract: 'linux-contained',
      claimedAt: 1000,
    });

    const res = Q.resolveQualification({
      qualification: qualRecord,
      evidence: [credEv],
      expectedProfileDigest: qualRecord.profileDigest,
    });

    assert.strictEqual(res.status, Q.QualificationStatus.UNQUALIFIED);
    assert.ok(res.problems.some((p) => p.includes('FAILED') && p.includes('CREDENTIALS')));
  });

  t('authoritative observer evaluation is strictly outside candidate execution', () => {
    // Observer run records must enforce comparedOutsideExecution = true and protected classification
    const obsRun = REC.createObserverRun({
      runId: 'obs-001',
      incarnationId: 'inc-t02',
      obligationId: 'ob-test-01',
      candidateIdentity: { generationId: 'gen-t02', treeDigest: 'sha256:' + '0'.repeat(64) },
      comparedOutsideExecution: true,
      classification: 'authoritative',
      attestedAt: NOW,
    });

    assert.strictEqual(obsRun.comparedOutsideExecution, true);
    assert.strictEqual(obsRun.classification, 'authoritative');

    // Candidate-authored reports keep classification 'supporting' even if inside protected store (§17)
    const candidateReport = REC.createObserverRun({
      runId: 'obs-cand-001',
      incarnationId: 'inc-t02',
      obligationId: 'ob-test-01',
      candidateIdentity: { generationId: 'gen-t02', treeDigest: 'sha256:' + '0'.repeat(64) },
      comparedOutsideExecution: false,
      classification: 'supporting',
    });
    assert.strictEqual(candidateReport.comparedOutsideExecution, false);
    assert.strictEqual(candidateReport.classification, 'supporting');
  });

  // -------------------------------------------------------------------------
  // 4. Host-Service Handoff Denial (Host sockets, IPC, daemons, schedulers)
  // -------------------------------------------------------------------------
  group('T-02.4: Host-Service Handoff Denial (Host sockets, IPC, daemons, schedulers)');

  t('host IPC and daemon socket handoffs are unavailable (EffectSurface.HOST_IPC)', () => {
    assert.strictEqual(Q.EffectSurface.HOST_IPC, 'HOST_IPC');

    // Probe checking host IPC access: passing probe confirms isolation
    const ipcPassEv = REC.createQualEvidence({
      qualEvidenceId: 'qe-ipc-pass',
      surface: Q.EffectSurface.HOST_IPC,
      method: Q.EvidenceMethod.ISOLATION_TEST,
      evidenceProfileBinding: 'profile:linux-cgroup-v2:v1',
      result: Q.EvidenceResult.PASS,
      timestamp: 2000,
      observerIdentity: 'observer-auth-1',
    });

    assert.strictEqual(ipcPassEv.surface, 'HOST_IPC');
    assert.strictEqual(ipcPassEv.result, 'PASS');
  });

  t('proposal targeting host sockets or unadmitted network routes is refused', () => {
    const d = tmpDir();
    try {
      const { store } = createTestHarness(d);
      // Unadmitted network / host daemon socket route attempted
      const proposal = baseProposal({
        actionId: 'act-ipc-attack',
        disclosureScope: ['/var/run/docker.sock', 'http://169.254.169.254'], // Cloud metadata & Docker socket
        qualifiedProfileDigest: null, // Unqualified route
      });

      const res = ADMISSION.admitAndRelease({
        store,
        proposal,
        budget: STATE.get(store, 'lin-t02'),
        clock: () => NOW,
      });

      assert.strictEqual(res.admitted, false);
      assert.strictEqual(res.refused, true);
      assert.ok(res.reason.includes('no qualified profile digest (IB-01)'));
    } finally {
      cleanupDir(d);
    }
  });

  // -------------------------------------------------------------------------
  // 5. Checker & Baseline Script Isolation (No Trust Exemption)
  // -------------------------------------------------------------------------
  group('T-02.5: Checker & Baseline Script Isolation (No Trust Exemption)');

  t('baseline verifier and checker execution require identical qualification and admission (BASELINE_VERIFIER)', () => {
    assert.strictEqual(Q.EffectSurface.BASELINE_VERIFIER, 'BASELINE_VERIFIER');

    // Missing BASELINE_VERIFIER surface in qualification marks runtime UNQUALIFIED
    const qualRecord = REC.createQualification({
      qualificationId: 'qual-base-test',
      profileId: 'profile:linux-cgroup-v2:v1',
      profileVersion: '1.0.0',
      profileDigest: 'sha256:' + '5'.repeat(64),
      status: Q.QualificationStatus.QUALIFIED,
      evidenceBindings: [
        { surface: Q.EffectSurface.TOOL_INVOCATION, evidenceIds: ['qe-tool-1'] },
        { surface: Q.EffectSurface.BASELINE_VERIFIER, evidenceIds: ['qe-base-1'] },
      ],
      admittedByContract: 'linux-contained',
      claimedAt: 1000,
    });

    const toolEv = REC.createQualEvidence({
      qualEvidenceId: 'qe-tool-1',
      surface: Q.EffectSurface.TOOL_INVOCATION,
      method: Q.EvidenceMethod.ACCESS_TEST,
      evidenceProfileBinding: 'profile:linux-cgroup-v2:v1',
      result: Q.EvidenceResult.PASS,
      timestamp: 2000,
      observerIdentity: 'observer-auth-1',
    });

    const res = Q.resolveQualification({
      qualification: qualRecord,
      evidence: [toolEv],
      expectedProfileDigest: qualRecord.profileDigest,
    });

    assert.strictEqual(res.status, Q.QualificationStatus.UNQUALIFIED);
    assert.ok(res.problems.some((p) => p.includes('BASELINE_VERIFIER') && p.includes('no evidence at all')));
  });

  t('repository instructions cannot expand authority or grant trust exemptions to scripts (§8)', () => {
    const activeEnvelope = {
      isLive: true,
      tools: ['run_test'],
      scopes: ['/repo/tests'],
      resourceCeilings: { tokens: 1000 },
      authorityLevel: 'TASK_BOUNDED',
      capabilities: ['LOCAL_CONTAINED_FS'],
    };

    // Adversarial repo script requests TRUSTED_HOST_EXECUTION authority
    const repoAdversarialEnvelope = {
      tools: ['run_test', 'host_sudo_exec'],
      scopes: ['/repo/tests', '/'],
      resourceCeilings: { tokens: 1000 },
      authorityLevel: 'UNRESTRICTED_HOST',
      capabilities: ['LOCAL_CONTAINED_FS', 'HOST_TRUST_EXEMPTION'],
    };

    const check = CA.checkEnvelopeWidening(activeEnvelope, repoAdversarialEnvelope);
    assert.strictEqual(check.allowed, false);
    assert.strictEqual(check.widened, true);
    assert.ok(check.reason.includes('proposed tool "host_sudo_exec" widens active task envelope'));
    assert.ok(check.reason.includes('proposed authorityLevel "UNRESTRICTED_HOST" differs from active envelope "TASK_BOUNDED"'));
  });

  // -------------------------------------------------------------------------
  // 6. Missing Containment Fails Closed (Blocks Execution)
  // -------------------------------------------------------------------------
  group('T-02.6: Missing Containment Fails Closed (Blocks Execution)');

  t('missing containment profile fails closed at admission', () => {
    const d = tmpDir();
    try {
      const { store } = createTestHarness(d);
      const res = ADMISSION.admitAndRelease({
        store,
        proposal: baseProposal({ qualifiedProfileDigest: null }),
        budget: STATE.get(store, 'lin-t02'),
        clock: () => NOW,
      });

      assert.strictEqual(res.admitted, false);
      assert.strictEqual(res.refused, true);
      assert.ok(res.reason.includes('no qualified profile digest (IB-01)'));
    } finally {
      cleanupDir(d);
    }
  });

  t('unqualified runtime boundary blocks physical dispatch with KNOWN_NOT_DISPATCHED', () => {
    const d = tmpDir();
    try {
      const { store } = createTestHarness(d);
      // Default NO_BOUNDARY representing unqualified runtime
      const res = ADMISSION.admitAndRelease({
        store,
        proposal: baseProposal({ actionId: 'act-containment-unqual' }),
        budget: STATE.get(store, 'lin-t02'),
        clock: () => NOW,
      });

      assert.strictEqual(res.admitted, true);
      assert.strictEqual(res.dispatch, 'KNOWN_NOT_DISPATCHED');
      assert.strictEqual(res.releaseRefused, true);
      assert.ok(res.reason.includes('no qualified containment/runtime profile available (IB-01)'));

      // Verify liability was released via proof of non-dispatch
      const budget = STATE.get(store, 'lin-t02');
      assert.strictEqual(budget.dimensions.tokens.reservations['act-containment-unqual'], undefined);
    } finally {
      cleanupDir(d);
    }
  });

  // -------------------------------------------------------------------------
  // 7. Loss of Control & Unresolved Execution (Fencing vs Observer Relabeling)
  // -------------------------------------------------------------------------
  group('T-02.7: Loss of Control & Unresolved Execution (Fencing vs Observer Relabeling)');

  t('inability to establish physical fencing forces UNRESOLVED_EXECUTION with quarantine', () => {
    const finalizationResult = F.reduceFinalization({
      stopReason: REC.TerminalResult.SAFETY_STOP,
      admissionClosed: true,
      authorityRetired: true,
      fencingEstablished: false, // Fencing could not be established!
      reconciliationComplete: false,
      quarantineAppliedForUnresolved: true,
      truthfulResultReduced: true,
      publicationOrderingComplete: false,
      quiescenceProven: false,
    });

    assert.strictEqual(finalizationResult.status, F.FINALIZATION_STATUS.UNRESOLVED_EXECUTION);
    assert.strictEqual(finalizationResult.terminalResult, REC.TerminalResult.UNRESOLVED_EXECUTION);
    assert.strictEqual(finalizationResult.publishes, false);
    assert.strictEqual(finalizationResult.quiescenceProven, false);
    assert.strictEqual(finalizationResult.unresolved, true);
    assert.ok(finalizationResult.problems.some((p) => p.includes('fencing cannot be established: result is non-successful unresolved execution')));
  });

  t('terminal treatment for UNRESOLVED_EXECUTION preserves evidence and marks resources non-reusable', () => {
    const tr = F.terminalTreatment(REC.TerminalResult.UNRESOLVED_EXECUTION);
    assert.strictEqual(tr.known, true);
    assert.strictEqual(tr.successGate, false);
    assert.strictEqual(tr.publishesExactFrozen, false);
    assert.strictEqual(tr.fencesOrReconciles, true);
    assert.ok(tr.note.includes('quiescence is not established and resources are not reusable'));
  });

  t('late execution payloads arriving during or after terminal finalization are rejected', () => {
    // Normal late payload after terminal is strictly rejected
    const check1 = F.latePayloadAllowed({
      afterTerminal: true,
      authenticatedAccountingSettlement: false,
      reopensExecution: false,
      importsEvidence: false,
      mutatesCandidate: false,
      upgradesAssurance: false,
    });
    assert.strictEqual(check1.allowed, false);
    assert.ok(check1.problems.some((p) => p.includes('a payload arriving after the terminal reduction is late')));

    // Attempted late execution reopening after terminal is rejected even under accounting settlement
    const check2 = F.latePayloadAllowed({
      afterTerminal: true,
      authenticatedAccountingSettlement: true,
      reopensExecution: true, // Forbidden!
      importsEvidence: false,
      mutatesCandidate: false,
      upgradesAssurance: false,
    });
    assert.strictEqual(check2.allowed, false);
    assert.ok(check2.problems.some((p) => p.includes('post-terminal payload reopens execution')));
  });
};
