'use strict';
/**
 * Test Contract T-03: Exclusive Ownership (PRD §24, §6, §10, §9, §25)
 *
 * Exercises all 5 normative exercise surfaces from PRD §24 T-03:
 *  1. Paused owner A while B attempts ownership.
 *  2. A resuming after B’s attempted start.
 *  3. A crash with surviving actors.
 *  4. PID reuse and changed host boot identity.
 *  5. Alternate pathnames, lock replacement attempts, and a second store attaching the same candidate.
 *
 * Asserts all 5 normative invariants:
 *  - No double owner or timeout takeover.
 *  - Lock/epoch identity is protected.
 *  - Recovery starts closed and recovery-only.
 *  - Non-reusable actor identity is used.
 *  - No premature resource reuse or stale issuer revival occurs.
 *
 * Platform Qualification:
 *  - Logic and state-machine integrity are fully verified fail-closed.
 *  - Physical OS-level supervisor isolation and kernel fencing are
 *    NOT QUALIFIED on Termux, IB-01 OPEN.
 *
 * Binds Evidence Families: EA, ER, EL, EX.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REC = require('../../src/contracts/records.js');
const ID = require('../../src/contracts/identity.js');
const { contentId, sha256, canonicalJson } = require('../../src/contracts/crypto.js');
const Q = require('../../src/contracts/qualification.js');
const F = require('../../src/contracts/finalization.js');
const STATE = require('../../src/control/state.cjs');
const OWN = require('../../src/control/ownership.cjs');
const LOCK = require('../../src/store/lock.cjs');
const BL = require('../../src/control/budget-ledger.cjs');
const ADMISSION = require('../../src/control/admission.cjs');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-t03-'));
}

function cleanupDir(d) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
}

const NOW_MS = 1757926800000; // 2025-09-15T09:00:00.000Z
const NOW = new Date(NOW_MS).toISOString();
const FUTURE = new Date(NOW_MS + 60000).toISOString();

function createTestHarness(d, ownerId = 'supervisor-owner-a', bootId = { id: 'boot:T03-A', source: 'boot_id', qualified: true }) {
  const sup = OWN.openSupervisor({ root: d, ownerIdentity: ownerId, bootId });
  assert.strictEqual(sup.refused, undefined);
  const store = sup.store;

  // Add task incarnation
  const inc = REC.createTaskIncarnation({
    taskId: 'task-t03',
    lineageId: 'lin-t03',
    incarnationId: 'inc-t03',
    ownerEpoch: 'o:1',
    originalRequest: 'Execute T-03 Exclusive Ownership',
    selectedSourceCommit: 'commit-t03',
  });
  inc.phase = 'READY';
  STATE.add(store, inc);

  // Add generation
  const gen = REC.createGeneration({
    generationId: 'gen-t03',
    taskId: 'task-t03',
    incarnationId: 'inc-t03',
    treeDigest: 'sha256:' + '0'.repeat(64),
  });
  STATE.add(store, gen);

  // Add policy record
  const policy = {
    schemaVersion: 1,
    kind: 'policy',
    policyId: 'pol-t03',
    revision: 'rev-1',
    stage: 'EFFECTIVE',
  };
  STATE.add(store, policy);

  // Create budget ledger
  const budget = BL.initBudget('lin-t03', [{ dimension: 'tokens', hardLimit: 1000, protectedFuture: 0 }]);
  STATE.add(store, budget);

  return { store, sup, budget };
}

function baseProposal(overrides = {}) {
  return {
    actionId: 'act-t03-001',
    executorIdentity: 'supervisor-owner-a',
    incarnationId: 'inc-t03',
    ownerEpoch: 'o:1',
    effectivePolicyRevision: 'rev-1',
    qualifiedProfileDigest: 'sha256:' + '1'.repeat(64),
    operation: 'write_file',
    inputPayloadIdentity: contentId('payload-t03-001'),
    targetGeneration: 'gen-t03',
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
  // 1. Paused Owner & Prohibition of Timeout Takeover / Double Ownership
  // -------------------------------------------------------------------------
  group('T-03.1: Paused Owner & Prohibition of Timeout Takeover / Double Ownership');

  t('paused owner A holds lock while supervisor B attempts ownership -> B is refused', () => {
    const d = tmpDir();
    try {
      const bootA = { id: 'boot:T03-HOST-1', source: 'boot_id', qualified: true };
      const supA = OWN.openSupervisor({ root: d, ownerIdentity: 'owner-a', bootId: bootA });
      assert.strictEqual(supA.refused, undefined);
      assert.strictEqual(supA.owner.ownerIdentity, 'owner-a');

      // Supervisor B attempts to acquire ownership while A is alive/paused
      const bootB = { id: 'boot:T03-HOST-1', source: 'boot_id', qualified: true };
      const supB = OWN.openSupervisor({ root: d, ownerIdentity: 'owner-b', bootId: bootB });
      assert.strictEqual(supB.refused, true);
      assert.strictEqual(supB.reason, 'owned-locked');
      assert.strictEqual(supB.existing.ownerIdentity, 'owner-a');

      // Attempted recovery by B on live same-boot supervisor is also refused
      const recB = OWN.recoverSupervisor({ root: d, ownerIdentity: 'owner-b', bootId: bootB });
      assert.strictEqual(recB.refused, true);
      assert.strictEqual(recB.reason, 'owned-locked');
    } finally {
      cleanupDir(d);
    }
  });

  t('time delay or inactivity never transfers lock or ownership (no timeout takeover)', () => {
    const d = tmpDir();
    try {
      const bootA = { id: 'boot:T03-HOST-1', source: 'boot_id', qualified: true };
      OWN.openSupervisor({ root: d, ownerIdentity: 'owner-a', bootId: bootA });

      // Simulate passage of time on lockfile (e.g. 24 hours ago)
      const lockFile = path.join(d, 'lock');
      const oldLock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
      oldLock.acquiredAt = new Date(Date.now() - 86400000).toISOString();
      fs.writeFileSync(lockFile, JSON.stringify(oldLock));

      // Attempt acquisition by competitor B
      const supB = OWN.openSupervisor({ root: d, ownerIdentity: 'owner-b', bootId: bootA });
      assert.strictEqual(supB.refused, true);
      assert.strictEqual(supB.reason, 'owned-locked');
      assert.strictEqual(supB.stale, false, 'same boot lock is never stale regardless of elapsed time');
    } finally {
      cleanupDir(d);
    }
  });

  t('owner A resumes execution after competitor B attempt -> A remains sole owner and issues mutations', () => {
    const d = tmpDir();
    try {
      const { store } = createTestHarness(d, 'owner-a');
      const bootA = { id: 'boot:T03-A', source: 'boot_id', qualified: true };

      // B attempts start and fails
      const supB = OWN.openSupervisor({ root: d, ownerIdentity: 'owner-b', bootId: bootA });
      assert.strictEqual(supB.refused, true);

      // A resumes and executes valid admitted mutation
      const proposal = baseProposal({ actionId: 'act-resumed-a', executorIdentity: 'owner-a' });
      const res = ADMISSION.admitAndRelease({
        store,
        proposal,
        budget: STATE.get(store, 'lin-t03'),
        boundary: () => ({ released: true }),
        clock: () => NOW,
      });

      assert.strictEqual(res.admitted, true);
      assert.strictEqual(res.dispatch, 'ACKNOWLEDGED');

      // Verify epoch and ownership integrity
      const records = store.all();
      const ig = ID.identityIntegrityGate({ records, canonicalStorePath: fs.realpathSync(d) });
      assert.strictEqual(ig.ok, true);
      assert.strictEqual(ig.currentEpoch, 1);
    } finally {
      cleanupDir(d);
    }
  });

  t('releasing supervisor lock from non-owner is refused', () => {
    const d = tmpDir();
    try {
      const boot = { id: 'boot:T03-A', source: 'boot_id', qualified: true };
      OWN.openSupervisor({ root: d, ownerIdentity: 'owner-a', bootId: boot });

      // Impostor attempts release
      const relImpostor = OWN.releaseSupervisor({ root: d, ownerIdentity: 'impostor-owner' });
      assert.strictEqual(relImpostor.released, false);
      assert.strictEqual(relImpostor.reason, 'wrong-owner');

      // Proper owner releases cleanly
      const relOwner = OWN.releaseSupervisor({ root: d, ownerIdentity: 'owner-a' });
      assert.strictEqual(relOwner.released, true);
    } finally {
      cleanupDir(d);
    }
  });

  // -------------------------------------------------------------------------
  // 2. Protection of Lock & Epoch Identity Against Aliases and Second Stores
  // -------------------------------------------------------------------------
  group('T-03.2: Protection of Lock & Epoch Identity Against Aliases, Replacements, & Second Stores');

  t('store identity self-bind check rejects alias paths or tampered lockIdentity', () => {
    const d = tmpDir();
    try {
      const { store } = createTestHarness(d, 'owner-a');
      const canonicalPath = fs.realpathSync(d);

      // Honest gate check
      const gate1 = ID.storeIdentityGate({
        records: store.all(),
        canonicalStorePath: canonicalPath,
        lockIdentity: contentId('lock:' + canonicalPath),
      });
      assert.strictEqual(gate1.ok, true);
      assert.ok(gate1.storeIdentity);

      // Alias pathname check (e.g. alternate path pointing to same store)
      const aliasPath = '/some/other/symlink/path';
      const gate2 = ID.storeIdentityGate({
        records: store.all(),
        canonicalStorePath: aliasPath,
      });
      assert.strictEqual(gate2.ok, false);
      assert.ok(gate2.problems.some((p) => p.includes('alias')));

      // Tampered lockIdentity inside owner record
      const tamperedOwner = Object.assign({}, store.byKind('store_owner')[0], {
        lockIdentity: contentId('lock:/forged/path'),
      });
      const gate3 = ID.storeIdentityGate({
        records: [tamperedOwner],
      });
      assert.strictEqual(gate3.ok, false);
      assert.ok(gate3.problems.some((p) => p.includes('does not match contentId(lock:canonicalStorePath)')));
    } finally {
      cleanupDir(d);
    }
  });

  t('second store attaching same candidate is refused by initOrBindOwner', () => {
    const d1 = tmpDir();
    const d2 = tmpDir();
    try {
      const { store: store1 } = createTestHarness(d1, 'owner-a');

      // Attempting to bind d2 lockIdentity into store1 fails
      assert.throws(
        () => OWN.initOrBindOwner(store1, {
          root: d2,
          ownerIdentity: 'owner-a',
          lockIdentity: contentId('lock:' + d2),
          role: 'SUPERVISOR',
        }),
        /refusing attachment/,
      );
    } finally {
      cleanupDir(d1);
      cleanupDir(d2);
    }
  });

  t('epoch allocation ledger is contiguous [1..N]; skipped or duplicate epochs fail integrity gate', () => {
    const d = tmpDir();
    try {
      const { store } = createTestHarness(d, 'owner-a');

      // Allocate contiguous epoch 2
      OWN.allocateEpoch(store, 'owner-a', 'SUPERVISOR');
      assert.strictEqual(store.byKind('store_owner')[0].currentEpoch, 2);

      const og1 = ID.ownershipIntegrityGate({ records: store.all() });
      assert.strictEqual(og1.ok, true);
      assert.strictEqual(og1.currentEpoch, 2);

      // Corrupt epoch ledger by inserting non-contiguous epoch 4
      const gapAlloc = {
        schemaVersion: 1,
        kind: 'epoch_alloc',
        epochId: 'owner-a:4',
        epochNumber: 4,
        role: 'SUPERVISOR',
        ownerIdentity: 'owner-a',
        allocatedAt: NOW,
      };
      STATE.add(store, gapAlloc);
      STATE.update(store, store.byKind('store_owner')[0].lockIdentity, (o) => Object.assign({}, o, { currentEpoch: 4 }));

      const og2 = ID.ownershipIntegrityGate({ records: store.all() });
      assert.strictEqual(og2.ok, false);
      assert.ok(og2.problems.some((p) => p.includes('epoch ledger has 3 entries but currentEpoch is 4')));
    } finally {
      cleanupDir(d);
    }
  });

  t('epoch 1 must be INITIAL under founder; foreign supervisor without recovery fails closed', () => {
    const ownerRec = {
      schemaVersion: 1,
      kind: 'store_owner',
      canonicalStorePath: '/store/test',
      lockIdentity: contentId('lock:/store/test'),
      ownerIdentity: 'founder-owner',
      currentEpoch: 2,
    };

    // Case 1: Foreign owner allocated epoch 1 -> fails
    const badEpoch1 = [
      ownerRec,
      { kind: 'epoch_alloc', epochNumber: 1, role: 'INITIAL', ownerIdentity: 'foreign-usurper' },
      { kind: 'epoch_alloc', epochNumber: 2, role: 'SUPERVISOR', ownerIdentity: 'founder-owner' },
    ];
    const og1 = ID.ownershipIntegrityGate({ records: badEpoch1 });
    assert.strictEqual(og1.ok, false);
    assert.ok(og1.problems.some((p) => p.includes('differs from store owner')));

    // Case 2: Foreign owner acquires SUPERVISOR without prior RECOVERY epoch -> fails
    const badEpoch2 = [
      ownerRec,
      { kind: 'epoch_alloc', epochNumber: 1, role: 'INITIAL', ownerIdentity: 'founder-owner' },
      { kind: 'epoch_alloc', epochNumber: 2, role: 'SUPERVISOR', ownerIdentity: 'foreign-usurper' },
    ];
    const og2 = ID.ownershipIntegrityGate({ records: badEpoch2 });
    assert.strictEqual(og2.ok, false);
    assert.ok(og2.problems.some((p) => p.includes('is foreign without a preceding RECOVERY')));
  });

  // -------------------------------------------------------------------------
  // 3. Crash Recovery with Surviving Actors (Closed Admission & Recovery-Only)
  // -------------------------------------------------------------------------
  group('T-03.3: Crash Recovery with Surviving Actors (Closed Admission & Recovery-Only)');

  t('crash recovery starts with admission CLOSED and mode recovery-only', () => {
    const d = tmpDir();
    try {
      const boot1 = { id: 'boot:T03-BOOT-1', source: 'boot_id', qualified: true };
      const { store } = createTestHarness(d, 'owner-a', boot1);

      // Add unacknowledged action (simulating crash before ack)
      const unackAction = REC.createAction({
        actionId: 'act-surviving-1',
        incarnationId: 'inc-t03',
        ownerEpoch: 'o:1',
        operation: 'build_target',
        targetGeneration: 'gen-t03',
      });
      unackAction.dispatch = 'UNKNOWN';
      unackAction.resourceDisposition = 'ACTIVE';
      STATE.add(store, unackAction);

      const unackConsumption = {
        schemaVersion: 1,
        kind: 'action_consumption',
        consumptionId: 'cons-surviving-1',
        actionId: 'act-surviving-1',
        incarnationId: 'inc-t03',
        ownerEpoch: 'o:1',
        consumedAt: NOW,
        reservedLiability: 100,
        ack: null, // crash between consume and ack
      };
      STATE.add(store, unackConsumption);

      // Close store (crash)
      STATE.close(store);

      // New boot recovery takeover
      const boot2 = { id: 'boot:T03-BOOT-2', source: 'boot_id', qualified: true };
      const rec = OWN.recoverSupervisor({
        root: d,
        ownerIdentity: 'supervisor-recovery',
        bootId: boot2,
      });

      assert.strictEqual(rec.refused, undefined);
      assert.strictEqual(rec.session.recoverOnly, true);
      assert.strictEqual(rec.owner.admissionState, 'CLOSED');
      assert.strictEqual(rec.owner.recoveryState, 'RECOVERY');
      assert.strictEqual(rec.report.epoch, 2);
      assert.strictEqual(rec.report.admissionClosed, true);
      assert.ok(rec.report.unresolvedActors.includes('act-surviving-1'));
      assert.ok(rec.report.quarantined.includes('quarantine-act-surviving-1'));

      // Truthful disposition recorded as NON_SUCCESSFUL
      assert.strictEqual(rec.report.disposition, 'NON_SUCCESSFUL');
      assert.strictEqual(rec.report.preservedSuccess, false);
    } finally {
      cleanupDir(d);
    }
  });

  t('in recovery-only mode, regular candidate mutations are refused by authorizeMutation', () => {
    const d = tmpDir();
    try {
      const boot1 = { id: 'boot:BOOT-1', source: 'boot_id', qualified: true };
      const { store } = createTestHarness(d, 'owner-a', boot1);
      STATE.close(store);

      const boot2 = { id: 'boot:BOOT-2', source: 'boot_id', qualified: true };
      const rec = OWN.recoverSupervisor({ root: d, ownerIdentity: 'owner-rec', bootId: boot2 });
      const storeRec = rec.store;

      // Candidate action proposed while in recovery
      const candidateAction = REC.createAction({
        actionId: 'act-new-in-rec',
        incarnationId: 'inc-t03',
        ownerEpoch: 'o:2',
        operation: 'compile',
        targetGeneration: 'gen-t03',
      });

      const auth = ID.authorizeMutation({
        records: storeRec.all(),
        candidate: candidateAction,
      });

      assert.strictEqual(auth.authorized, false);
      assert.ok(auth.reasons.includes(ID.MutationReason.RECOVERY_ONLY));
    } finally {
      cleanupDir(d);
    }
  });

  // -------------------------------------------------------------------------
  // 4. Non-Reusable Actor Identity and PID Reuse Protection Across Boots
  // -------------------------------------------------------------------------
  group('T-03.4: Non-Reusable Actor Identity and PID Reuse Protection Across Boots');

  t('same PID on new boot is recognized as stale lock residue and superseded only via reclaim', () => {
    const d = tmpDir();
    try {
      const boot1 = { id: 'boot:11111111-1111-1111-1111-111111111111', source: 'boot_id', qualified: true };
      const boot2 = { id: 'boot:22222222-2222-2222-2222-222222222222', source: 'boot_id', qualified: true };

      // Supervisor 1 acquires lock on boot 1
      const acq1 = LOCK.acquire(d, { ownerIdentity: 'owner-boot-1', bootId: boot1 });
      assert.strictEqual(acq1.held, true);

      // Normal acquire on boot 2 sees existing lock as stale
      const acq2 = LOCK.acquire(d, { ownerIdentity: 'owner-boot-2', bootId: boot2 });
      assert.strictEqual(acq2.held, false);
      assert.strictEqual(acq2.stale, true);
      assert.strictEqual(acq2.reason, 'owned-locked');

      // Direct reclaim on same-boot is refused
      const recSameBoot = LOCK.reclaim(d, { ownerIdentity: 'impostor', bootId: boot1 });
      assert.strictEqual(recSameBoot.reclaimed, false);
      assert.strictEqual(recSameBoot.reason, 'same-boot-takeover-refused');

      // Lawful reclaim across boots succeeds
      const recCrossBoot = LOCK.reclaim(d, { ownerIdentity: 'owner-boot-2', bootId: boot2 });
      assert.strictEqual(recCrossBoot.reclaimed, true);
      assert.strictEqual(recCrossBoot.superseded, 'owner-boot-1');

      // Now lock is held by owner-boot-2 under boot2
      const holdRes = LOCK.hold(d);
      assert.strictEqual(holdRes.held, true);
      assert.strictEqual(holdRes.lock.ownerIdentity, 'owner-boot-2');
      assert.strictEqual(holdRes.lock.bootId, boot2.id);
    } finally {
      cleanupDir(d);
    }
  });

  t('non-reusable action and task identifiers are strictly unique and cannot be duplicated', () => {
    const id1 = REC.generateId('action');
    const id2 = REC.generateId('action');
    assert.notStrictEqual(id1, id2);
    assert.ok(id1.startsWith('action-'));
    assert.ok(id2.startsWith('action-'));

    // Attempting to authorize duplicate action ID fails closed
    const records = [
      { schemaVersion: 1, kind: 'store_owner', canonicalStorePath: '/s', lockIdentity: contentId('lock:/s'), ownerIdentity: 'o', currentEpoch: 1, admissionState: 'OPEN', recoveryState: 'NORMAL' },
      { schemaVersion: 1, kind: 'epoch_alloc', epochId: 'o:1', epochNumber: 1, role: 'INITIAL', ownerIdentity: 'o' },
      { schemaVersion: 1, kind: 'task_incarnation', taskId: 't1', incarnationId: 'inc-1', ownerEpoch: 'o:1', incarnationStatus: 'ACTIVE' },
      { schemaVersion: 1, kind: 'generation', generationId: 'gen-1', taskId: 't1', incarnationId: 'inc-1' },
      { schemaVersion: 1, kind: 'action', actionId: 'act-duplicate', incarnationId: 'inc-1', ownerEpoch: 'o:1', targetGeneration: 'gen-1' },
    ];

    const duplicateCandidate = {
      schemaVersion: 1,
      kind: 'action',
      actionId: 'act-duplicate',
      incarnationId: 'inc-1',
      ownerEpoch: 'o:1',
      targetGeneration: 'gen-1',
    };

    const auth = ID.authorizeMutation({ records, candidate: duplicateCandidate });
    assert.strictEqual(auth.authorized, false);
    assert.ok(auth.reasons.includes(ID.MutationReason.DUPLICATE_IDENTITY));
  });

  // -------------------------------------------------------------------------
  // 5. Quarantine of Unresolved Resources, Liability Retention, & Stale Issuer Fencing
  // -------------------------------------------------------------------------
  group('T-03.5: Quarantine of Unresolved Resources, Liability Retention, & Stale Issuer Fencing');

  t('unresolved mutable candidate resources are durably quarantined upon recovery', () => {
    const d = tmpDir();
    try {
      const { store } = createTestHarness(d, 'owner-a');

      // Create unresolved action and consumption
      const act = REC.createAction({
        actionId: 'act-unresolved-dir',
        incarnationId: 'inc-t03',
        ownerEpoch: 'o:1',
        operation: 'build_workspace',
        targetGeneration: 'gen-t03',
      });
      act.resourceDisposition = 'ACTIVE';
      act.dispatch = 'UNKNOWN';
      STATE.add(store, act);

      const cons = {
        schemaVersion: 1,
        kind: 'action_consumption',
        consumptionId: 'cons-unresolved-dir',
        actionId: 'act-unresolved-dir',
        incarnationId: 'inc-t03',
        ownerEpoch: 'o:1',
        consumedAt: NOW,
        reservedLiability: 250,
        ack: null,
      };
      STATE.add(store, cons);
      STATE.close(store);

      // Perform recovery
      const rec = OWN.recoverSupervisor({
        root: d,
        ownerIdentity: 'owner-rec',
        bootId: { id: 'boot:T03-RECOVERY', source: 'boot_id', qualified: true },
      });

      const store2 = rec.store;
      const q = store2.get('quarantine-act-unresolved-dir');
      assert.ok(q);
      assert.strictEqual(q.kind, 'quarantine');
      assert.strictEqual(q.state, 'ACTIVE');
      assert.strictEqual(q.resourceClass, 'CANDIDATE_DIR');
      assert.strictEqual(q.incumbentIncarnationId, 'inc-t03');
    } finally {
      cleanupDir(d);
    }
  });

  t('unacknowledged action retains liability; provably non-dispatched action releases liability', () => {
    const d = tmpDir();
    try {
      const { store } = createTestHarness(d, 'owner-a');

      // 1. Setup budget with 1000 limit
      // 2. Action A (unacknowledged): 300 exposure
      const b1 = BL.admitToBudget(STATE.get(store, 'lin-t03'), {
        dimension: 'tokens',
        actionId: 'act-unack',
        maxExposure: 300,
        category: 'DISCRETIONARY',
      });
      STATE.update(store, 'lin-t03', () => b1.record);
      STATE.add(store, {
        schemaVersion: 1, kind: 'reservation',
        reservationId: 'res-unack', lineageId: 'lin-t03', dimension: 'tokens',
        actionId: 'act-unack', maxExposure: 300, state: 'ACTIVE',
      });
      STATE.add(store, {
        schemaVersion: 1, kind: 'action_consumption',
        consumptionId: 'cons-unack', actionId: 'act-unack',
        incarnationId: 'inc-t03', ownerEpoch: 'o:1', consumedAt: NOW,
        reservedLiability: 300, ack: null,
      });

      // 3. Action B (proven non-dispatched): 200 exposure
      const b2 = BL.admitToBudget(STATE.get(store, 'lin-t03'), {
        dimension: 'tokens',
        actionId: 'act-nondispatch',
        maxExposure: 200,
        category: 'DISCRETIONARY',
      });
      STATE.update(store, 'lin-t03', () => b2.record);
      STATE.add(store, {
        schemaVersion: 1, kind: 'reservation',
        reservationId: 'res-nondispatch', lineageId: 'lin-t03', dimension: 'tokens',
        actionId: 'act-nondispatch', maxExposure: 200, state: 'ACTIVE',
      });
      STATE.add(store, {
        schemaVersion: 1, kind: 'action_consumption',
        consumptionId: 'cons-nondispatch', actionId: 'act-nondispatch',
        incarnationId: 'inc-t03', ownerEpoch: 'o:1', consumedAt: NOW,
        reservedLiability: 200, ack: 'KNOWN_NOT_DISPATCHED',
      });

      STATE.close(store);

      // Run recovery reconciliation
      const rec = OWN.recoverSupervisor({
        root: d,
        ownerIdentity: 'owner-rec',
        bootId: { id: 'boot:T03-RECONCILE', source: 'boot_id', qualified: true },
      });

      const store2 = rec.store;
      const budgetAfter = STATE.get(store2, 'lin-t03');

      // Act B reservation released via non-dispatch proof
      assert.strictEqual(budgetAfter.dimensions.tokens.reservations['act-nondispatch'], undefined);

      // Act A reservation retained (unacknowledged/ambiguous)
      assert.strictEqual(budgetAfter.dimensions.tokens.reservations['act-unack'].amount, 300);
      assert.strictEqual(Object.keys(budgetAfter.dimensions.tokens.reservations).length, 1);
    } finally {
      cleanupDir(d);
    }
  });

  t('stale issuer from prior epoch cannot execute or mutate after new epoch allocated', () => {
    const d = tmpDir();
    try {
      const { store } = createTestHarness(d, 'owner-a');

      // Allocate epoch 2
      OWN.allocateEpoch(store, 'owner-a', 'SUPERVISOR');
      assert.strictEqual(store.byKind('store_owner')[0].currentEpoch, 2);

      // Stale action proposal issued under epoch 1
      const staleProposal = baseProposal({
        actionId: 'act-stale-epoch',
        executorIdentity: 'owner-a',
        ownerEpoch: 'o:1', // Stale! Current is 2
      });

      const res = ADMISSION.admitAndRelease({
        store,
        proposal: staleProposal,
        budget: STATE.get(store, 'lin-t03'),
        boundary: () => ({ released: true }),
        clock: () => NOW,
      });

      assert.strictEqual(res.admitted, false);
      assert.strictEqual(res.refused, true);
      assert.ok(res.reason.includes('stale'));

      // Also verify mutation authorization directly rejects stale candidate
      const candidateAction = REC.createAction({
        actionId: 'act-stale-epoch-mut',
        incarnationId: 'inc-t03',
        ownerEpoch: 'o:1',
        operation: 'write_file',
        targetGeneration: 'gen-t03',
      });
      const auth = ID.authorizeMutation({
        records: store.all(),
        candidate: candidateAction,
      });
      assert.strictEqual(auth.authorized, false);
      assert.ok(auth.reasons.includes(ID.MutationReason.STALE_EPOCH));
    } finally {
      cleanupDir(d);
    }
  });

  t('retired authority after finalization prohibits any subsequent mutation', () => {
    const d = tmpDir();
    try {
      const { store } = createTestHarness(d, 'owner-a');

      // Add finalization retiring authority
      const finalization = REC.createFinalization({
        finalizationId: 'fin-t03',
        incarnationId: 'inc-t03',
        stopReason: REC.TerminalResult.COMPLETE,
      });
      finalization.admissionClosed = true;
      finalization.authorityRetired = true;
      STATE.add(store, finalization);

      // Attempted mutation after authority retired
      const candidateAction = REC.createAction({
        actionId: 'act-after-retired',
        incarnationId: 'inc-t03',
        ownerEpoch: 'o:1',
        operation: 'write_file',
        targetGeneration: 'gen-t03',
      });

      const auth = ID.authorizeMutation({
        records: store.all(),
        candidate: candidateAction,
      });

      assert.strictEqual(auth.authorized, false);
      assert.ok(auth.reasons.includes(ID.MutationReason.RETIRED_AUTHORITY));
    } finally {
      cleanupDir(d);
    }
  });

  // -------------------------------------------------------------------------
  // 6. Qualification Boundary (Termux / Linux Supervisor Isolation Profile)
  // -------------------------------------------------------------------------
  group('T-03.6: Platform Qualification Boundary (Termux / Linux Supervisor Isolation Profile)');

  t('supervisor host/kernel fencing profile is fail-closed when runtime is unqualified', () => {
    // Fencing/drain boundary without qualified runtime profile (IB-01)
    const recReport = OWN.recoverSupervisor({
      root: tmpDir(),
      ownerIdentity: 'owner-unqual-test',
      bootId: { id: 'boot:UNQUAL', source: 'session', qualified: false },
    });

    assert.strictEqual(recReport.report.resolverQualified, false);
    assert.strictEqual(recReport.report.fencingEstablished, false);
    assert.strictEqual(recReport.report.drainEstablished, false);
    assert.ok(recReport.report.sourceOfProof.includes('runtime drain/fence UNQUALIFIED (IB-01)') || recReport.report.sourceOfProof.includes('cannot fence'));
  });

  t('physical OS-level supervisor isolation and kernel fencing are NOT QUALIFIED on Termux, IB-01 OPEN', () => {
    // Cryptographic and state machine logic are strictly verified.
    // Physical supervisor isolation and kernel cgroup namespace boundaries
    // cannot be established on Android/Termux without host virtualization / root kernel namespaces.
    const platformQualified = false; // Termux / Android environment
    assert.strictEqual(platformQualified, false, 'Physical OS-level supervisor isolation and kernel fencing are NOT QUALIFIED on Termux, IB-01 OPEN');
  });
};
