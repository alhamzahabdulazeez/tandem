'use strict';
/**
 * Tests for src/control/ownership.cjs — exclusive supervision, epoch
 * allocation, admission closing, and §10 crash recovery (T-01/T-03 logic).
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const LOCK = require('../../src/store/lock.cjs');
const OWN = require('../../src/control/ownership.cjs');
const REC = require('../../src/contracts/records.js');

function dir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-own-')); }
function tear(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }

const bootA = { id: 'boot:AAAA', source: 'boot_id', qualified: true };
const bootB = { id: 'boot:BBBB', source: 'boot_id', qualified: true };

const NOW = '2026-09-15T09:00:00.000Z';

function action(actionId, dispatch, over) {
  const a = REC.createAction({
    actionId, incarnationId: 'inc-1', ownerEpoch: 'o:1',
    operation: `op(${actionId})`, targetGeneration: 'gen:0',
  });
  a.creationTime = NOW;
  a.useAllowance = 'CONSUMED';
  a.dispatch = dispatch;
  a.execution = dispatch === 'KNOWN_NOT_DISPATCHED' || dispatch === 'UNKNOWN' ? 'UNKNOWN' : 'SUCCEEDED';
  a.lifecycle = 'SETTLED';
  a.liability = 'RESERVED';
  a.resourceDisposition = 'ACTIVE';
  return Object.assign(a, over || {});
}

module.exports = function run(t, group) {
  group('ownership: exclusive supervision');

  t('openSupervisor initializes owner, NORMAL state and one INITIAL epoch', () => {
    const d = dir();
    const r = OWN.openSupervisor({ root: d, ownerIdentity: 'supervisor-1', bootId: bootA });
    assert.strictEqual(r.refused, undefined, JSON.stringify(r));
    const owner = r.owner;
    assert.strictEqual(owner.kind, 'store_owner');
    assert.strictEqual(owner.recoveryState, 'NORMAL');
    assert.strictEqual(owner.admissionState, 'OPEN');
    const epochs = r.store.byKind('epoch_alloc');
    assert.strictEqual(epochs.length, 1);
    assert.strictEqual(epochs[0].role, 'INITIAL');
    assert.strictEqual(epochs[0].epochNumber, 1);
    OWN.releaseSupervisor({ root: d, ownerIdentity: 'supervisor-1' });
    tear(d);
  });

  t('a second supervisor in the same boot is refused (no double owner, T-01)', () => {
    const d = dir();
    OWN.openSupervisor({ root: d, ownerIdentity: 's1', bootId: bootA });
    const r = OWN.openSupervisor({ root: d, ownerIdentity: 's2', bootId: bootA });
    assert.strictEqual(r.refused, true);
    assert.strictEqual(r.reason, 'owned-locked');
    tear(d);
  });

  t('a PREVIOUS boot residue is refused by openSupervisor and requires recovery', () => {
    const d = dir();
    OWN.openSupervisor({ root: d, ownerIdentity: 's-prev', bootId: bootA });
    const r = OWN.openSupervisor({ root: d, ownerIdentity: 's-this', bootId: bootB });
    assert.strictEqual(r.refused, true);
    assert.strictEqual(r.stale, true);
    tear(d);
  });

  t('clock/lock identity is bound to the canonical root (no alternate attachment)', () => {
    const d = dir();
    OWN.openSupervisor({ root: d, ownerIdentity: 's1', bootId: bootA });
    OWN.releaseSupervisor({ root: d, ownerIdentity: 's1' });
    // A second store root that aliases the same underlying directory
    // (symlink alternate pathname) must not attach it as newly owned work.
    const link = d + '-alias';
    fs.symlinkSync(d, link);
    let threw = false;
    try { OWN.openSupervisor({ root: link, ownerIdentity: 's2', bootId: bootA }); } catch (e) { threw = true; }
    assert.strictEqual(threw, true, 'alternate pathname must not attach the store');
    tear(d);
  });

  t('allocateEpoch bumps the owner epoch durably', () => {
    const d = dir();
    const r = OWN.openSupervisor({ root: d, ownerIdentity: 's1', bootId: bootA });
    OWN.allocateEpoch(r.store, 's1', 'SUPERVISOR');
    OWN.allocateEpoch(r.store, 's1', 'RECOVERY');
    const owner = r.store.byKind('store_owner')[0];
    assert.strictEqual(owner.currentEpoch, 3);
    assert.deepStrictEqual(r.store.byKind('epoch_alloc').map((e) => e.role), ['INITIAL', 'SUPERVISOR', 'RECOVERY']);
    tear(d);
  });

  group('ownership: admission bit');

  t('closeAdmission and openAdmission are durable and reflected in state', () => {
    const d = dir();
    const r = OWN.openSupervisor({ root: d, ownerIdentity: 's1', bootId: bootA });
    OWN.closeAdmission(r.store);
    assert.strictEqual(r.store.byKind('store_owner')[0].admissionState, 'CLOSED');
    OWN.openAdmission(r.store);
    assert.strictEqual(r.store.byKind('store_owner')[0].admissionState, 'OPEN');
    tear(d);
  });

  group('ownership: unresolved selection');

  t('selectUnresolved flags only possibly-released actors', () => {
    const both = [
      action('a-known', 'KNOWN_NOT_DISPATCHED'),          // never released — clean
      action('a-unknown', 'UNKNOWN'),                      // crash before ack — unresolved
      { ...action('a-consumed', 'KNOWN_NOT_DISPATCHED'), useAllowance: 'CONSUMED' }, // still clean
    ];
    const ids = OWN.selectUnresolved(both).map((a) => a.actionId);
    assert.deepStrictEqual(ids, ['a-unknown']);
  });

  group('ownership: §10 recovery');

  t('recovery starts admission closed, allocates a RECOVERY epoch, reclaims stale lock', () => {
    const d = dir();
    OWN.openSupervisor({ root: d, ownerIdentity: 'crashbuddy', bootId: bootA });
    // crash: no release. Next boot, recovery supersedes the stale lock.
    const r = OWN.recoverSupervisor({ root: d, ownerIdentity: 'recovery-1', bootId: bootB });
    assert.strictEqual(r.refused, undefined, JSON.stringify(r));
    assert.strictEqual(r.report.admissionClosed, true);
    assert.strictEqual(r.report.epoch, 2);
    assert.strictEqual(r.store.byKind('store_owner')[0].recoveryState, 'RECOVERY');
    assert.strictEqual(r.store.byKind('store_owner')[0].admissionState, 'CLOSED');
    assert.ok(r.store.byKind('epoch_alloc').some((e) => e.role === 'RECOVERY' && e.epochNumber === 2));
    tear(d);
  });

  t('recovery with never-released actions: quiescent by construction, no quarantine', () => {
    const d = dir();
    const s1 = OWN.openSupervisor({ root: d, ownerIdentity: 's1', bootId: bootA });
    // enroll a never-released action and an admission
    s1.store.admit({
      schemaVersion: 1, kind: 'action_consumption', consumptionId: 'cons-known',
      actionId: 'act-known', incarnationId: 'inc-1', ownerEpoch: 'o:1',
      consumedAt: NOW, reservedLiability: 5, ack: 'KNOWN_NOT_DISPATCHED',
      reservation: { reservationId: 'res-known', lineageId: 'lin-1', dimension: 'tokens', actionId: 'act-known', maxExposure: 5, kind: 'DISCRETIONARY' },
    });
    s1.store.add(action('act-known', 'KNOWN_NOT_DISPATCHED'));
    OWN.releaseSupervisor({ root: d, ownerIdentity: 's1' });
    const r = OWN.recoverSupervisor({ root: d, ownerIdentity: 'r1', bootId: bootB });
    assert.strictEqual(r.report.quiescenceProven, true);
    assert.strictEqual(r.report.fencingEstablished, false, 'runtime fence still UNQUALIFIED');
    assert.deepStrictEqual(r.report.quarantined, []);
    assert.strictEqual(r.report.unresolvedActors.length, 0);
    assert.strictEqual(r.report.disposition, 'NON_SUCCESSFUL');
    tear(d);
  });

  t('recovery with an unresolved release: unresolved execution and quarantine', () => {
    const d = dir();
    const s1 = OWN.openSupervisor({ root: d, ownerIdentity: 's1', bootId: bootA });
    s1.store.admit({
      schemaVersion: 1, kind: 'action_consumption', consumptionId: 'cons-unk',
      actionId: 'act-unk', incarnationId: 'inc-1', ownerEpoch: 'o:1',
      consumedAt: NOW, reservedLiability: 5, ack: null,
      reservation: { reservationId: 'res-unk', lineageId: 'lin-1', dimension: 'tokens', actionId: 'act-unk', maxExposure: 5, kind: 'DISCRETIONARY' },
    });
    s1.store.add(action('act-unk', 'UNKNOWN'));
    OWN.releaseSupervisor({ root: d, ownerIdentity: 's1' });
    const r = OWN.recoverSupervisor({ root: d, ownerIdentity: 'r1', bootId: bootB });
    assert.strictEqual(r.report.quiescenceProven, false);
    assert.strictEqual(r.report.fencingEstablished, false);
    assert.ok(r.report.quarantined.some((q) => q.includes('act-unk')));
    assert.strictEqual(r.report.disposition, 'NON_SUCCESSFUL');
    const fin = r.store.byKind('finalization').filter((f) => f.recoverySourceNote)[0];
    assert.strictEqual(fin.unresolvedExecution, true);
    assert.strictEqual(fin.authorityRetired, true);
    assert.deepStrictEqual(fin.quarantinedResources, r.report.quarantined);
    tear(d);
  });

  t('recovery preserves success only when a completed record AND verified payload exist', () => {
    const d = dir();
    const s1 = OWN.openSupervisor({ root: d, ownerIdentity: 's1', bootId: bootA });
    const fin = REC.createFinalization({ finalizationId: REC.generateId('finalization'), incarnationId: 'inc-1', stopReason: 'user' });
    fin.result = 'COMPLETE';
    fin.admissionClosed = true;
    fin.authorityRetired = true;
    const del = REC.createDelivery({ deliveryId: 'del-1', taskId: 'task-1', frozenGenerationId: 'gen:1' });
    del.persistenceState = 'PUBLISHED';
    s1.store.add(fin);
    s1.store.add(del);
    OWN.releaseSupervisor({ root: d, ownerIdentity: 's1' });

    const verifyTrue = () => ({ integrity: true });
    const rOk = OWN.recoverSupervisor({ root: d, ownerIdentity: 'r1', bootId: bootB, verifyPayload: verifyTrue });
    assert.strictEqual(rOk.report.preservedSuccess, true);
    assert.strictEqual(rOk.report.disposition, 'SUCCESS_PRESERVED');
    OWN.releaseSupervisor({ root: d, ownerIdentity: 'r1' });

    const verifyFalse = () => ({ integrity: false, reason: 'bytes missing' });
    const rBad = OWN.recoverSupervisor({ root: d, ownerIdentity: 'r2', bootId: bootB, verifyPayload: verifyFalse });
    assert.strictEqual(rBad.report.preservedSuccess, false);
    tear(d);
  });

  t('a qualified runtime resolver moves fencing flags only when both proven', () => {
    const d = dir();
    OWN.openSupervisor({ root: d, ownerIdentity: 's1', bootId: bootA });
    OWN.releaseSupervisor({ root: d, ownerIdentity: 's1' });
    const resolver = { fencingEstablished: true, drainEstablished: true, reason: 'qualified profile probe' };
    const r = OWN.recoverSupervisor({ root: d, ownerIdentity: 'r1', bootId: bootB, resolver });
    assert.strictEqual(r.report.fencingEstablished, true);
    assert.strictEqual(r.report.resolverQualified, true);
    tear(d);
  });

  t('recovery refuses a same-boot live incumbent', () => {
    const d = dir();
    OWN.openSupervisor({ root: d, ownerIdentity: 's1', bootId: bootA });
    const r = OWN.recoverSupervisor({ root: d, ownerIdentity: 'someone-else', bootId: bootA });
    assert.strictEqual(r.refused, true);
    assert.strictEqual(r.reason, 'owned-locked');
    tear(d);
  });
};