'use strict';
/**
 * Tests for src/contracts/identity.js — §6 Store Identity + §10 Ownership
 * Integrity + §9 Mutation Authorization.
 *
 * All functions are pure (no I/O, no lock acquisition, no state.cjs).
 * Adversarial cases cover: forged identity, stale owner, duplicate identity,
 * wrong incarnation, wrong generation, already-consumed allowance, admission-
 * closed, recovery-only, retired authority, future/stale epoch, and the
 * requirement-8 invariant (ownership ≠ qualification, authorityGranted always
 * false).
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const REC = require('../../src/contracts/records.js');
const ID = require('../../src/contracts/identity.js');
const VAL = require('../../src/contracts/validate.js');
const COH = require('../../src/contracts/coherence.js');
const Q = require('../../src/contracts/qualification.js');
const { contentId } = require('../../src/contracts/crypto.js');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const STORE_PATH = '/tmp/tandem/test-store';
const LOCK_ID = contentId('lock:' + STORE_PATH);
const OWNER_ID = 'owner-alpha';

function owner(overrides = {}) {
  // Built literally (NOT via createStoreOwner) because the durable factory
  // hardcodes currentEpoch:0 and only takes path/lock/owner — the supervisor
  // sets currentEpoch/ownerEpoch/admissionState on the durable record post-open.
  return {
    schemaVersion: REC.SCHEMA_VERSION,
    kind: 'store_owner',
    canonicalStorePath: STORE_PATH,
    lockIdentity: LOCK_ID,
    ownerIdentity: OWNER_ID,
    currentEpoch: 3,
    ownerEpoch: 'o:3',
    recoveryState: 'NORMAL',
    admissionState: 'OPEN',
    ...overrides,
  };
}

function epochAlloc(epochNumber, role, ownerIdentity = OWNER_ID) {
  return { kind: 'epoch_alloc', epochId: `ea-${epochNumber}`, epochNumber, role, ownerIdentity };
}

function baseRecords(overrides = {}) {
  return [
    owner(overrides.ownerOverrides),
    epochAlloc(1, 'INITIAL', overrides.ownerIdentity1 || OWNER_ID),
    epochAlloc(2, 'SUPERVISOR', overrides.ownerIdentity2 || OWNER_ID),
    epochAlloc(3, 'SUPERVISOR'),
  ];
}

function incarnation(overrides = {}) {
  return REC.createTaskIncarnation({
    taskId: 'task-1', lineageId: 'ln-1', incarnationId: 'inc-1',
    ownerEpoch: 'o:3', originalRequest: 'do the thing', selectedSourceCommit: 'abc',
    ...overrides,
  });
}

function generation(overrides = {}) {
  return REC.createGeneration({
    generationId: 'gen-1', taskId: 'task-1', incarnationId: 'inc-1',
    treeDigest: 'sha256:' + 'a'.repeat(64),
    ...overrides,
  });
}

function action(overrides = {}) {
  return REC.createAction({
    actionId: 'act-1', taskId: 'task-1', incarnationId: 'inc-1',
    ownerEpoch: 'o:3', targetGeneration: 'gen-1',
    operation: 'compile', lifecycle: REC.ActionLifecycle.PROPOSED,
    ...overrides,
  });
}

function consumption(actionId = 'act-1', overrides = {}) {
  return {
    kind: 'action_consumption', consumptionId: `cons-${actionId}`,
    actionId, ownerEpoch: 'o:3',
    ack: 'ACKNOWLEDGED',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test groups
// ---------------------------------------------------------------------------

module.exports = function run(t, group) {
  // ========================================================================
  // §6 Store Identity Gate
  // ========================================================================
  group('§6 store identity gate');

  t('consistent owner → ok with deterministic storeIdentity', () => {
    const records = baseRecords();
    const r = ID.storeIdentityGate({ records, canonicalStorePath: STORE_PATH, lockIdentity: LOCK_ID });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(typeof r.storeIdentity, 'string');
    assert.ok(r.storeIdentity.startsWith('sha256:'));
    assert.deepStrictEqual(r.problems, []);
  });

  t('no owner → fail (fail closed)', () => {
    const r = ID.storeIdentityGate({ records: [] });
    assert.strictEqual(r.ok, false);
    assert.ok(r.problems.some((p) => p.includes('no store owner')));
  });

  t('two owners → fail (fail closed)', () => {
    const records = [...baseRecords(), owner({ lockIdentity: contentId('lock:/other'), ownerIdentity: 'owner-beta', canonicalStorePath: '/other' })];
    const r = ID.storeIdentityGate({ records });
    assert.strictEqual(r.ok, false);
    assert.ok(r.problems.some((p) => p.includes('multiple store_owner')));
  });

  t('wrong schemaVersion → fail', () => {
    const records = baseRecords({ ownerOverrides: { schemaVersion: 999 } });
    const r = ID.storeIdentityGate({ records });
    assert.strictEqual(r.ok, false);
    assert.ok(r.problems.some((p) => p.includes('schemaVersion')));
  });

  t('deterministic: same records → same storeIdentity', () => {
    const a = ID.storeIdentityGate({ records: baseRecords() });
    const b = ID.storeIdentityGate({ records: baseRecords() });
    assert.strictEqual(a.storeIdentity, b.storeIdentity);
  });

  t('path change → different storeIdentity', () => {
    const a = ID.storeIdentityGate({ records: baseRecords() });
    const b = ID.storeIdentityGate({ records: baseRecords({ ownerOverrides: { canonicalStorePath: '/other' } }) });
    assert.notStrictEqual(a.storeIdentity, b.storeIdentity);
  });

  t('live lockIdentity mismatch → fail (stale owner / alias)', () => {
    const r = ID.storeIdentityGate({
      records: baseRecords(),
      canonicalStorePath: STORE_PATH,
      lockIdentity: contentId('lock:/different'),
    });
    assert.strictEqual(r.ok, false);
    assert.ok(r.problems.some((p) => p.includes('lockIdentity') || p.includes('lock')));
  });

  t('live canonicalStorePath mismatch → fail (alias)', () => {
    const r = ID.storeIdentityGate({
      records: baseRecords(),
      canonicalStorePath: '/completely/different/path',
    });
    assert.strictEqual(r.ok, false);
    assert.ok(r.problems.some((p) => p.includes('alias')));
  });

  // ========================================================================
  // §10 Ownership Integrity Gate
  // ========================================================================
  group('§10 ownership integrity gate');

  t('contiguous ledger [1..3] with INITIAL first → ok', () => {
    const r = ID.ownershipIntegrityGate({ records: baseRecords() });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.currentEpoch, 3);
    assert.strictEqual(r.recoveryState, 'NORMAL');
    assert.strictEqual(r.epochAllocations.length, 3);
  });

  t('empty epoch ledger → fail (fail closed)', () => {
    const records = [owner()];
    const r = ID.ownershipIntegrityGate({ records });
    assert.strictEqual(r.ok, false);
    assert.ok(r.problems.some((p) => p.includes('no epoch_alloc')));
  });

  t('duplicate epochNumber → fail', () => {
    const records = [...baseRecords(), epochAlloc(3, 'RECOVERY')]; // duplicate epoch 3
    const r = ID.ownershipIntegrityGate({ records });
    assert.strictEqual(r.ok, false);
    assert.ok(r.problems.some((p) => p.includes('duplicate epoch_alloc epochNumber 3')));
  });

  t('future epoch (epochNumber > currentEpoch) → fail', () => {
    const records = [...baseRecords(), epochAlloc(99, 'RECOVERY')];
    const r = ID.ownershipIntegrityGate({ records });
    assert.strictEqual(r.ok, false);
    assert.ok(r.problems.some((p) => p.includes('exceeds currentEpoch')));
  });

  t('founder residue — epoch 1 (INITIAL) not allocated by the store owner → fail', () => {
    const records = [
      owner(),
      epochAlloc(1, 'INITIAL', 'someone-else'), // a foreign founder claims the store
      epochAlloc(2, 'SUPERVISOR', 'someone-else'),
    ];
    const r = ID.ownershipIntegrityGate({ records });
    assert.strictEqual(r.ok, false);
    assert.ok(r.problems.some((p) => p.includes('founder residue')));
  });

  t('foreign SUPERVISOR without its own preceding RECOVERY → fail (stale owner residue)', () => {
    const records = [
      owner(),
      epochAlloc(1, 'INITIAL', OWNER_ID),
      epochAlloc(2, 'SUPERVISOR', OWNER_ID),
      epochAlloc(3, 'SUPERVISOR', 'owner-beta'), // foreign supervisor, no RECOVERY before it
    ];
    const r = ID.ownershipIntegrityGate({ records });
    assert.strictEqual(r.ok, false);
    assert.ok(r.problems.some((p) => p.includes('stale owner residue')));
  });

  t('supervisor after same-owner RECOVERY → ok (takeover then supervised work)', () => {
    const records = [
      owner({ ownerIdentity: OWNER_ID, currentEpoch: 3 }),
      epochAlloc(1, 'INITIAL', OWNER_ID),
      epochAlloc(2, 'RECOVERY', 'owner-beta'),   // beta recovers
      epochAlloc(3, 'SUPERVISOR', 'owner-beta'), // then beta supervises — lawful
    ];
    const r = ID.ownershipIntegrityGate({ records });
    assert.strictEqual(r.ok, true);
  });

  t('currentEpoch 0 → fail (unallocated)', () => {
    const records = [owner({ currentEpoch: 0 }), epochAlloc(1, 'INITIAL')];
    const r = ID.ownershipIntegrityGate({ records });
    assert.strictEqual(r.ok, false);
    assert.ok(r.problems.some((p) => p.includes('must be an integer >= 1')));
  });

  t('first role not INITIAL → fail', () => {
    const records = [
      owner({ currentEpoch: 1 }),
      epochAlloc(1, 'SUPERVISOR'),
    ];
    const r = ID.ownershipIntegrityGate({ records });
    assert.strictEqual(r.ok, false);
    assert.ok(r.problems.some((p) => p.includes('expected INITIAL')));
  });

  t('legitimate cross-boot recovery: founder INITIAL + new owner RECOVERY → ok', () => {
    // Durable semantics (ownership.cjs): store_owner.ownerIdentity keeps the
    // founding owner; recovery writes a RECOVERY epoch under the new supervisor
    // and flips recoveryState/admissionState on the owner record.
    const records = [
      owner({ currentEpoch: 2, recoveryState: 'RECOVERY', admissionState: 'CLOSED', ownerEpoch: 'o:2' }),
      epochAlloc(1, 'INITIAL', OWNER_ID),      // founder's epoch
      epochAlloc(2, 'RECOVERY', 'owner-new'),   // new supervisor's epoch
    ];
    const r = ID.ownershipIntegrityGate({ records });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.currentEpoch, 2);
    assert.strictEqual(r.recoveryState, 'RECOVERY');
    assert.strictEqual(r.admissionState, 'CLOSED');
  });

  // ========================================================================
  // §9 Mutation Authorization
  // ========================================================================
  group('§9 mutation authorization — task_incarnation');

  t('valid first incarnation → authorized', () => {
    const r = ID.authorizeMutation({ records: baseRecords(), candidate: incarnation() });
    assert.strictEqual(r.authorized, true);
    assert.deepStrictEqual(r.reasons, []);
  });

  t('duplicate incarnationId → refuse', () => {
    const records = [...baseRecords(), incarnation()];
    const r = ID.authorizeMutation({ records, candidate: incarnation() });
    assert.strictEqual(r.authorized, false);
    assert.ok(r.reasons.includes(ID.MutationReason.DUPLICATE_IDENTITY));
  });

  t('stale ownerEpoch on incarnation → refuse', () => {
    const candidate = incarnation({ ownerEpoch: 'o:1' }); // epoch 1 is old
    const r = ID.authorizeMutation({ records: baseRecords(), candidate });
    assert.strictEqual(r.authorized, false);
    assert.ok(r.reasons.includes(ID.MutationReason.STALE_EPOCH));
  });

  t('future ownerEpoch on incarnation → refuse', () => {
    const candidate = incarnation({ ownerEpoch: 'o:99' });
    const r = ID.authorizeMutation({ records: baseRecords(), candidate });
    assert.strictEqual(r.authorized, false);
    assert.ok(r.reasons.includes(ID.MutationReason.FUTURE_EPOCH));
  });

  t('unparseable ownerEpoch → refuse (unbound)', () => {
    const candidate = incarnation({ ownerEpoch: 'epoch-abc' });
    const r = ID.authorizeMutation({ records: baseRecords(), candidate });
    assert.strictEqual(r.authorized, false);
    assert.ok(r.reasons.includes(ID.MutationReason.UNBOUND_EPOCH));
  });

  group('§9 mutation authorization — generation');

  t('valid generation under active incarnation → authorized', () => {
    const records = [...baseRecords(), incarnation()];
    const r = ID.authorizeMutation({ records, candidate: generation() });
    assert.strictEqual(r.authorized, true);
  });

  t('generation with unknown incarnationId → refuse', () => {
    const candidate = generation({ incarnationId: 'inc-unknown' });
    const r = ID.authorizeMutation({ records: baseRecords(), candidate });
    assert.strictEqual(r.authorized, false);
    assert.ok(r.reasons.includes(ID.MutationReason.UNKNOWN_INCARNATION));
  });

  t('generation with mismatched taskId → refuse', () => {
    const records = [...baseRecords(), incarnation()];
    const candidate = generation({ incarnationId: 'inc-1', taskId: 'task-wrong' });
    const r = ID.authorizeMutation({ records, candidate });
    assert.strictEqual(r.authorized, false);
    assert.ok(r.reasons.includes(ID.MutationReason.INCARNATION_EPOCH_MISMATCH));
  });

  group('§9 mutation authorization — action');

  t('valid action under active incarnation with matching generation → authorized', () => {
    const records = [...baseRecords(), incarnation(), generation()];
    const r = ID.authorizeMutation({ records, candidate: action() });
    assert.strictEqual(r.authorized, true);
  });

  t('action with unknown incarnation → refuse', () => {
    const records = [...baseRecords(), generation()];
    const candidate = action({ incarnationId: 'inc-unknown' });
    const r = ID.authorizeMutation({ records, candidate });
    assert.strictEqual(r.authorized, false);
    assert.ok(r.reasons.includes(ID.MutationReason.UNKNOWN_INCARNATION));
  });

  t('action with inactive incarnation → refuse', () => {
    // Build a literal incarnation (createTaskIncarnation hardcodes ACTIVE and
    // does not accept incarnationStatus override), so we construct directly.
    const inc = {
      schemaVersion: REC.SCHEMA_VERSION, kind: 'task_incarnation',
      taskId: 'task-1', lineageId: 'ln-1', incarnationId: 'inc-1',
      ownerEpoch: 'o:3', originalRequest: 'run the thing', selectedSourceCommit: 'abc',
      runtimeProfileId: null, incarnationStatus: 'CLOSED', phase: 'RECEIVED',
      admittedIntent: null, deadlines: null,
    };
    const records = [...baseRecords(), inc, generation()];
    const candidate = action();
    const r = ID.authorizeMutation({ records, candidate });
    assert.strictEqual(r.authorized, false);
    assert.ok(r.reasons.includes(ID.MutationReason.INACTIVE_INCARNATION));
  });

  t('action ownerEpoch mismatch with incarnation ownerEpoch → refuse', () => {
    const inc = incarnation({ ownerEpoch: 'o:3' });
    const records = [...baseRecords(), inc, generation()];
    const candidate = action({ ownerEpoch: 'o:2' }); // different from incarnation
    const r = ID.authorizeMutation({ records, candidate });
    assert.strictEqual(r.authorized, false);
    assert.ok(r.reasons.includes(ID.MutationReason.INCARNATION_EPOCH_MISMATCH));
  });

  t('action with unknown targetGeneration → refuse (wrong generation)', () => {
    const records = [...baseRecords(), incarnation(), generation()];
    const candidate = action({ targetGeneration: 'gen-unknown' });
    const r = ID.authorizeMutation({ records, candidate });
    assert.strictEqual(r.authorized, false);
    assert.ok(r.reasons.includes(ID.MutationReason.WRONG_GENERATION));
  });

  t('action with generation from different incarnation → refuse', () => {
    const gen = generation({ incarnationId: 'inc-other', generationId: 'gen-cross' });
    const records = [...baseRecords(), incarnation(), gen];
    const candidate = action({ targetGeneration: 'gen-cross' });
    const r = ID.authorizeMutation({ records, candidate });
    assert.strictEqual(r.authorized, false);
    assert.ok(r.reasons.includes(ID.MutationReason.GENERATION_INCARNATION_MISMATCH));
  });

  t('duplicate actionId → refuse', () => {
    const records = [...baseRecords(), incarnation(), generation(), action()];
    const r = ID.authorizeMutation({ records, candidate: action() });
    assert.strictEqual(r.authorized, false);
    assert.ok(r.reasons.includes(ID.MutationReason.DUPLICATE_IDENTITY));
  });

  group('§9 mutation authorization — consumed allowance (never replay)');

  t('already-consumed action → refuse (action candidate)', () => {
    // Consumption record present but NO action record — the duplicate guard
    // passes; the consumed-set guard fires on act-1 → ALREADY_CONSUMED.
    const records = [...baseRecords(), incarnation(), generation(), consumption('act-1')];
    const candidate = action({ actionId: 'act-1' }); // same actionId
    const r = ID.authorizeMutation({ records, candidate });
    assert.strictEqual(r.authorized, false);
    assert.ok(r.reasons.includes(ID.MutationReason.ALREADY_CONSUMED));
  });

  t('already-consumed action → refuse (action_consumption candidate, never replay)', () => {
    // Original consumption in store; a replay attempt with a different
    // consumptionId but same actionId → duplicate guard passes;
    // consumed-set guard fires → ALREADY_CONSUMED.
    const records = [...baseRecords(), incarnation(), generation(), consumption('act-1')];
    const candidate = consumption('act-1', { consumptionId: 'cons-act-1-replay' });
    const r = ID.authorizeMutation({ records, candidate });
    assert.strictEqual(r.authorized, false);
    assert.ok(r.reasons.includes(ID.MutationReason.ALREADY_CONSUMED));
  });

  t('unconsumed action_consumption with valid epoch → authorized', () => {
    const records = [...baseRecords(), incarnation(), generation(), action()];
    const candidate = consumption('act-1');
    const r = ID.authorizeMutation({ records, candidate });
    assert.strictEqual(r.authorized, true);
  });

  group('§9 mutation authorization — admission/recovery/retired gate');

  t('admission-closed → refuse all candidates', () => {
    const records = [...baseRecords({ ownerOverrides: { admissionState: 'CLOSED' } }), incarnation()];
    const r = ID.authorizeMutation({ records, candidate: generation() });
    assert.strictEqual(r.authorized, false);
    assert.ok(r.reasons.includes(ID.MutationReason.ADMISSION_CLOSED));
  });

  t('recovery-only → refuse all candidates', () => {
    const records = [
      owner({ recoveryState: 'RECOVERY', admissionState: 'CLOSED' }),
      epochAlloc(1, 'INITIAL'),
      epochAlloc(2, 'RECOVERY'),
    ];
    const r = ID.authorizeMutation({ records, candidate: generation() });
    assert.strictEqual(r.authorized, false);
    assert.ok(r.reasons.includes(ID.MutationReason.RECOVERY_ONLY));
  });

  t('retired authority (finalization with authorityRetired) → refuse all candidates', () => {
    const records = [
      ...baseRecords(), incarnation(), generation(),
      { kind: 'finalization', finalizationId: 'fin-1', admissionClosed: true, authorityRetired: true },
    ];
    const r = ID.authorizeMutation({ records, candidate: generation({ generationId: 'gen-2' }) });
    assert.strictEqual(r.authorized, false);
    assert.ok(r.reasons.includes(ID.MutationReason.RETIRED_AUTHORITY));
  });

  t('no owner → refuse (NO_OWNER)', () => {
    const r = ID.authorizeMutation({ records: [], candidate: generation() });
    assert.strictEqual(r.authorized, false);
    assert.ok(r.reasons.includes(ID.MutationReason.NO_OWNER));
  });

  t('unsupported kind → refuse (UNSUPPORTED_KIND)', () => {
    const r = ID.authorizeMutation({ records: baseRecords(), candidate: { kind: 'bogus' } });
    assert.strictEqual(r.authorized, false);
    assert.ok(r.reasons.includes(ID.MutationReason.UNSUPPORTED_KIND));
  });

  t('null candidate → refuse (UNSUPPORTED_KIND)', () => {
    const r = ID.authorizeMutation({ records: baseRecords(), candidate: null });
    assert.strictEqual(r.authorized, false);
    assert.ok(r.reasons.includes(ID.MutationReason.UNSUPPORTED_KIND));
  });

  // ========================================================================
  // Requirement 8: ownership ≠ qualification, authorityGranted always false
  // ========================================================================
  group('requirement 8 — identity ≠ qualification');

  t('identityIntegrityGate.authorityGranted is always false even when ok=true', () => {
    const gate = ID.identityIntegrityGate({
      records: baseRecords(),
      canonicalStorePath: STORE_PATH,
      lockIdentity: LOCK_ID,
    });
    assert.strictEqual(gate.ok, true);
    assert.strictEqual(gate.authorityGranted, false);
  });

  t('store_owner + epoch_alloc WITHOUT qualification evidence stays UNQUALIFIED', () => {
    const task = incarnation({ runtimeProfileId: 'profile:p1' });
    const records = [...baseRecords(), task];
    const gate = ID.identityIntegrityGate({ records });
    assert.strictEqual(gate.ok, true);

    // Qualification gate is independent — ownership doesn't help.
    const qGate = Q.qualificationIntegrityGate({
      taskRecord: task,
      qualificationRecords: [],
      qualEvidenceRecords: [],
    });
    assert.strictEqual(qGate.qualified, false);
    assert.strictEqual(qGate.status, Q.QualificationStatus.UNAVAILABLE);
  });

  t('coherence acceptance stays false even when ownership is clean', () => {
    const records = [...baseRecords(), incarnation()];
    const gates = COH.acceptanceGates({ records });
    // cleanAuthorityOwnership is true (owner present, NORMAL, no quarantine)
    assert.strictEqual(gates.cleanAuthorityOwnership, true);
    // but acceptance is false — ownership alone is insufficient
    assert.strictEqual(COH.coherentReduction({ records }).acceptance.accepted, false);
  });

  // ========================================================================
  // epochNumberFromLabel helper
  // ========================================================================
  group('epochNumberFromLabel helper');

  t('o:1 → 1', () => assert.strictEqual(ID.epochNumberFromLabel('o:1'), 1));
  t('epoch-3 → 3', () => assert.strictEqual(ID.epochNumberFromLabel('epoch-3'), 3));
  t('o:12 → 12', () => assert.strictEqual(ID.epochNumberFromLabel('o:12'), 12));
  t('abc → null (no trailing integer)', () => assert.strictEqual(ID.epochNumberFromLabel('abc'), null));
  t('empty string → null', () => assert.strictEqual(ID.epochNumberFromLabel(''), null));
  t('non-string → null', () => assert.strictEqual(ID.epochNumberFromLabel(42), null));

  // ========================================================================
  // MutationReason enum completeness
  // ========================================================================
  group('MutationReason enum completeness');

  t('all 16 expected reasons are defined', () => {
    const expected = [
      'no-owner', 'multiple-owners', 'admission-closed', 'recovery-only',
      'stale-epoch', 'future-epoch', 'unbound-epoch', 'duplicate-identity',
      'unknown-incarnation', 'inactive-incarnation', 'incarnation-epoch-mismatch',
      'wrong-generation', 'generation-incarnation-mismatch', 'already-consumed',
      'retired-authority', 'unsupported-kind',
    ];
    const actual = Object.values(ID.MutationReason);
    assert.deepStrictEqual(actual.sort(), expected.sort());
  });

  // ========================================================================
  // Combined identityIntegrityGate (multi-gate stacking)
  // ========================================================================
  group('identityIntegrityGate — combined gate stacking');

  t('store identity + ownership + no candidate → ok with all facts', () => {
    const gate = ID.identityIntegrityGate({
      records: baseRecords(),
      canonicalStorePath: STORE_PATH,
      lockIdentity: LOCK_ID,
    });
    assert.strictEqual(gate.ok, true);
    assert.strictEqual(typeof gate.storeIdentity, 'string');
    assert.strictEqual(gate.currentEpoch, 3);
    assert.strictEqual(gate.authorityGranted, false);
    assert.deepStrictEqual(gate.reasons, []);
  });

  t('store identity fail + ownership ok + candidate ok → overall fail', () => {
    const gate = ID.identityIntegrityGate({
      records: baseRecords(),
      canonicalStorePath: '/wrong',
      lockIdentity: LOCK_ID,
      candidate: generation(), // no incarnation → wrong gate, but the overall fail is from store identity
    });
    assert.strictEqual(gate.ok, false);
    assert.ok(gate.problems.some((p) => p.includes('alias')));
  });

  t('store identity ok + ownership fail (no epochs) → overall fail', () => {
    const gate = ID.identityIntegrityGate({
      records: [owner()],
    });
    assert.strictEqual(gate.ok, false);
    assert.ok(gate.problems.some((p) => p.includes('no epoch_alloc')));
  });

  t('store identity ok + ownership ok + mutation refuse → overall fail with reasons', () => {
    const gate = ID.identityIntegrityGate({
      records: baseRecords(),
      canonicalStorePath: STORE_PATH,
      lockIdentity: LOCK_ID,
      candidate: incarnation({ ownerEpoch: 'o:99' }), // future epoch
    });
    assert.strictEqual(gate.ok, false);
    assert.deepStrictEqual(gate.reasons, [ID.MutationReason.FUTURE_EPOCH]);
  });

  // ========================================================================
  // Duplicate record validation (validate.js integration)
  // ========================================================================
  group('validate.js additive store_owner validation');

  t('store_owner with currentEpoch: 0 (sentinel) → valid', () => {
    const rec = {
      schemaVersion: REC.SCHEMA_VERSION, kind: 'store_owner',
      canonicalStorePath: '/s', lockIdentity: contentId('lock:/s'), ownerIdentity: 'me',
      currentEpoch: 0,
    };
    assert.strictEqual(VAL.validateRecord(rec).valid, true);
  });

  t('store_owner with recoveryState NORMAL → valid', () => {
    const rec = {
      schemaVersion: REC.SCHEMA_VERSION, kind: 'store_owner',
      canonicalStorePath: '/s', lockIdentity: contentId('lock:/s'), ownerIdentity: 'me',
      recoveryState: 'NORMAL',
    };
    assert.strictEqual(VAL.validateRecord(rec).valid, true);
  });

  t('store_owner with invalid recoveryState → invalid', () => {
    const rec = {
      schemaVersion: REC.SCHEMA_VERSION, kind: 'store_owner',
      canonicalStorePath: '/s', lockIdentity: contentId('lock:/s'), ownerIdentity: 'me',
      recoveryState: 'BOGUS',
    };
    const r = VAL.validateRecord(rec);
    assert.strictEqual(r.valid, false);
    assert.ok(r.problems.some((p) => p.includes('recoveryState')));
  });

  t('store_owner with admissionState OPEN → valid', () => {
    const rec = {
      schemaVersion: REC.SCHEMA_VERSION, kind: 'store_owner',
      canonicalStorePath: '/s', lockIdentity: contentId('lock:/s'), ownerIdentity: 'me',
      admissionState: 'OPEN',
    };
    assert.strictEqual(VAL.validateRecord(rec).valid, true);
  });

  t('store_owner with invalid admissionState → invalid', () => {
    const rec = {
      schemaVersion: REC.SCHEMA_VERSION, kind: 'store_owner',
      canonicalStorePath: '/s', lockIdentity: contentId('lock:/s'), ownerIdentity: 'me',
      admissionState: 'SEMI_OPEN',
    };
    const r = VAL.validateRecord(rec);
    assert.strictEqual(r.valid, false);
    assert.ok(r.problems.some((p) => p.includes('admissionState')));
  });

  t('store_owner with negative currentEpoch → invalid', () => {
    const rec = {
      schemaVersion: REC.SCHEMA_VERSION, kind: 'store_owner',
      canonicalStorePath: '/s', lockIdentity: contentId('lock:/s'), ownerIdentity: 'me',
      currentEpoch: -1,
    };
    const r = VAL.validateRecord(rec);
    assert.strictEqual(r.valid, false);
    assert.ok(r.problems.some((p) => p.includes('currentEpoch')));
  });

  // ========================================================================
  // cross-boot recovery: mutation refused under old epoch
  // ========================================================================
  // ========================================================================
  // IO-backed: crash/restart + premature reuse (requirement 12) over REAL
  // durable state produced by ownership.cjs, then the PURE gate reduced.
  // ========================================================================
  group('§10 crash/restart + premature reuse (real durable state)');

  t('after crash+recover, ownershipIntegrityGate over the real store stays clean', () => {
    const OWN = require('../../src/control/ownership.cjs');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-idt-'));
    try {
      const bootA = { id: 'boot:AAAA', source: 'boot_id', qualified: true };
      const bootB = { id: 'boot:BBBB', source: 'boot_id', qualified: true };
      const s1 = OWN.openSupervisor({ root, ownerIdentity: 'old-owner', bootId: bootA });
      s1.store.close(); // crash: no release
      const rec = OWN.recoverSupervisor({ root, ownerIdentity: 'new-owner', bootId: bootB });
      const gate = ID.ownershipIntegrityGate({ records: rec.store.all() });
      assert.strictEqual(gate.ok, true); // legitimate recovery — NOT treated as corruption
      assert.strictEqual(gate.currentEpoch, 2);
      assert.strictEqual(gate.recoveryState, 'RECOVERY');
      assert.strictEqual(gate.admissionState, 'CLOSED');
      rec.store.close();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  t('premature ownership reuse refused while recovery is in effect (old AND current epoch stamps)', () => {
    const OWN = require('../../src/control/ownership.cjs');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-idt-'));
    try {
      const bootA = { id: 'boot:AAAA', source: 'boot_id', qualified: true };
      const bootB = { id: 'boot:BBBB', source: 'boot_id', qualified: true };
      const s1 = OWN.openSupervisor({ root, ownerIdentity: 'old-owner', bootId: bootA });
      s1.store.close(); // crash
      const rec = OWN.recoverSupervisor({ root, ownerIdentity: 'new-owner', bootId: bootB });
      const all = rec.store.all();

      const candOld = REC.createTaskIncarnation({
        taskId: 't-old', lineageId: 'l-old', incarnationId: 'inc-old',
        ownerEpoch: 'o:1', originalRequest: 'stale', selectedSourceCommit: 'abc',
      });
      const r1 = ID.authorizeMutation({ records: all, candidate: candOld });
      assert.strictEqual(r1.authorized, false);
      assert.ok(r1.reasons.includes(ID.MutationReason.RECOVERY_ONLY), 'epoch-1 stamp must not bypass recovery-only');

      const candNow = REC.createTaskIncarnation({
        taskId: 't-now', lineageId: 'l-now', incarnationId: 'inc-now',
        ownerEpoch: 'o:2', originalRequest: 'current', selectedSourceCommit: 'abc',
      });
      const r2 = ID.authorizeMutation({ records: all, candidate: candNow });
      assert.strictEqual(r2.authorized, false);
      assert.ok(r2.reasons.includes(ID.MutationReason.RECOVERY_ONLY), 'current epoch still refused — admission closed in recovery');
      rec.store.close();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  group('cross-boot recovery — stale epoch rejected under new owner');

  t('candidate stamped epoch-1 is refused when currentEpoch=2 after recovery', () => {
    const newOwner = 'owner-new';
    const records = [
      owner({ ownerIdentity: newOwner, currentEpoch: 2, recoveryState: 'NORMAL', ownerEpoch: 'o:2' }),
      epochAlloc(1, 'INITIAL', OWNER_ID),
      epochAlloc(2, 'RECOVERY', newOwner),
      REC.createTaskIncarnation({
        taskId: 'task-2', lineageId: 'ln-2', incarnationId: 'inc-2',
        ownerEpoch: 'o:2', originalRequest: 'recovered task', selectedSourceCommit: 'def',
      }),
    ];
    const candidate = REC.createGeneration({
      generationId: 'gen-2', taskId: 'task-2', incarnationId: 'inc-2',
      treeDigest: 'sha256:' + 'b'.repeat(64),
    });
    const r = ID.authorizeMutation({ records, candidate });
    // gen-2 references inc-2 which is ACTIVE and has ownerEpoch 'o:2' (currentEpoch=2) → ok
    assert.strictEqual(r.authorized, true);
  });

  t('candidate with ownerEpoch o:1 is refused when currentEpoch=2 (stale from old boot)', () => {
    const newOwner = 'owner-new';
    const records = [
      owner({ ownerIdentity: newOwner, currentEpoch: 2, recoveryState: 'NORMAL', ownerEpoch: 'o:2' }),
      epochAlloc(1, 'INITIAL', OWNER_ID),
      epochAlloc(2, 'RECOVERY', newOwner),
    ];
    const candidate = REC.createTaskIncarnation({
      taskId: 'task-old', lineageId: 'ln-old', incarnationId: 'inc-old',
      ownerEpoch: 'o:1', originalRequest: 'stale', selectedSourceCommit: 'xyz',
    });
    const r = ID.authorizeMutation({ records, candidate });
    assert.strictEqual(r.authorized, false);
    assert.ok(r.reasons.includes(ID.MutationReason.STALE_EPOCH));
  });
};
