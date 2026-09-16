'use strict';
/**
 * Tests for src/control/state.cjs — event-folded durable control store,
 * compound atomic admission (consume + reserve, §9.5), crash/restart/replay,
 * duplicate & identity-stability fail-closed rules.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const STATE = require('../../src/control/state.cjs');
const REC = require('../../src/contracts/records.js');

function dir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-state-')); }
function tear(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }

const NOW = '2026-09-15T09:00:00.000Z';

function baseAction(actionId, over) {
  const a = REC.createAction({
    actionId, incarnationId: 'inc-1', ownerEpoch: 'o:1',
    operation: 'read file:a', targetGeneration: 'gen:0',
  });
  a.creationTime = NOW;
  return Object.assign(a, over || {});
}

function consumption(actionId, over) {
  const base = {
    schemaVersion: 1, kind: 'action_consumption',
    consumptionId: 'cons-' + actionId,
    actionId, incarnationId: 'inc-1', ownerEpoch: 'o:1',
    consumedAt: NOW, reservedLiability: 10, ack: null,
  };
  return Object.assign(base, over || {});
}

function reservation(rejectionLineage) {
  return {
    reservationId: 'res-1', lineageId: 'lin-1', dimension: 'tokens',
    actionId: 'act-1', maxExposure: 10, kind: 'DISCRETIONARY',
  };
}

function validAll(control) {
  const v = STATE.validateState(control);
  assert.deepStrictEqual(v.problems, []);
  assert.strictEqual(v.valid, true);
}

module.exports = function run(t, group) {
  group('state: basic persistence');

  t('a fresh store is empty, valid, and has a stable state id', () => {
    const d = dir();
    const c = STATE.open(d);
    assert.strictEqual(STATE.all(c).length, 0);
    validAll(c);
    assert.strictEqual(STATE.stateId(c), STATE.stateId(c));
    tear(d);
  });

  t('records persist across restart (crash/restart replay)', () => {
    const d = dir();
    const c = STATE.open(d);
    STATE.add(c, REC.createLineage({ lineageId: 'lin-1', createdAt: NOW }));
    STATE.add(c, baseAction('act-1'));
    const id1 = STATE.stateId(c);
    STATE.close(c);

    const c2 = STATE.open(d);
    assert.strictEqual(STATE.get(c2, 'act-1').operation, 'read file:a');
    assert.strictEqual(STATE.get(c2, 'lin-1').kind, 'lineage');
    assert.strictEqual(STATE.stateId(c2), id1, 'replay converges to identical state');
    validAll(c2);
    tear(d);
  });

  t('stateId changes when a record changes, deterministically', () => {
    const d = dir();
    const c = STATE.open(d);
    STATE.add(c, baseAction('act-1'));
    const id1 = STATE.stateId(c);
    STATE.update(c, 'act-1', (p) => Object.assign({}, p, { execution: 'SUCCEEDED' }));
    const id2 = STATE.stateId(c);
    assert.notStrictEqual(id2, id1);
    assert.ok(id2.startsWith('sha256:'));
    tear(d);
  });

  group('state: identity stability (fail closed)');

  t('duplicate add of an identity is refused and not persisted', () => {
    const d = dir();
    const c = STATE.open(d);
    STATE.add(c, baseAction('act-1'));
    assert.throws(() => STATE.add(c, baseAction('act-1')), /duplicate identity/);
    assert.strictEqual(STATE.all(c).filter((r) => r.kind === 'action').length, 1);
    tear(d);
  });

  t('update of a missing record is refused', () => {
    const d = dir();
    const c = STATE.open(d);
    assert.throws(() => STATE.update(c, 'nope', (p) => p), /cannot update missing/);
    tear(d);
  });

  t('update may not change the identity', () => {
    const d = dir();
    const c = STATE.open(d);
    STATE.add(c, baseAction('act-1'));
    assert.throws(() => STATE.update(c, 'act-1', (p) => Object.assign({}, p, { actionId: 'act-2' })), /changed the identity/);
    tear(d);
  });

  t('update may not change the kind', () => {
    const d = dir();
    const c = STATE.open(d);
    STATE.add(c, baseAction('act-1'));
    // same identity value ('act-1') but a different kind: must trip the kind rule
    assert.throws(() => STATE.update(c, 'act-1', (p) => Object.assign({}, p, { kind: 'lineage', lineageId: p.actionId })), /changed the kind/);
    tear(d);
  });

  t('an event with an invalid record is refused', () => {
    const d = dir();
    const c = STATE.open(d);
    assert.throws(() => STATE.add(c, { kind: 'action', actionId: 'x' }), /refused event/);
    tear(d);
  });

  group('state: compound atomic admission (§9.5)');

  t('admit derives consumption AND reservation from one durable event', () => {
    const d = dir();
    const c = STATE.open(d);
    const rec = consumption('act-1', { reservation: reservation('lin-1') });
    STATE.admit(c, rec);
    const cons = STATE.get(c, 'cons-act-1');
    const res = STATE.get(c, 'res-1');
    assert.strictEqual(cons.kind, 'action_consumption');
    assert.strictEqual(cons.reservedLiability, 10);
    assert.strictEqual(cons.ack, null);
    assert.strictEqual(STATE.consumptionFor(c, 'act-1').consumptionId, 'cons-act-1');
    assert.strictEqual(res.kind, 'reservation');
    assert.strictEqual(res.state, 'ACTIVE');
    assert.strictEqual(res.actionId, 'act-1');
    validAll(c);
    tear(d);
  });

  t('admit and consumption/reservation survive restart as a pair', () => {
    const d = dir();
    const c = STATE.open(d);
    STATE.admit(c, consumption('act-1', { reservation: reservation('lin-1') }));
    STATE.close(c);
    const c2 = STATE.open(d);
    assert.ok(STATE.has(c2, 'cons-act-1'));
    assert.ok(STATE.has(c2, 'res-1'));
    assert.strictEqual(STATE.get(c2, 'res-1').state, 'ACTIVE');
    tear(d);
  });

  t('a second admit for the same action is refused (one-use allowance)', () => {
    const d = dir();
    const c = STATE.open(d);
    STATE.admit(c, consumption('act-1', { reservation: reservation('lin-1') }));
    assert.throws(
      () => STATE.admit(c, consumption('act-1', { reservation: Object.assign({}, reservation('lin-1'), { reservationId: 'res-2' }) })),
      /already consumed/,
    );
    assert.strictEqual(STATE.byKind(c, 'action_consumption').length, 1);
    tear(d);
  });

  t('admit refuses a reservation missing mandatory fields', () => {
    const d = dir();
    const c = STATE.open(d);
    const rec = consumption('act-1', { reservation: { reservationId: 'r', lineageId: 'lin-1' } }); // no dimension/maxExposure
    assert.throws(() => STATE.admit(c, rec), /refused event/);
    tear(d);
  });

  group('state: consumption & reservation lifecycle');

  t('settling a reservation and settling liability are orderly updates', () => {
    const d = dir();
    const c = STATE.open(d);
    STATE.admit(c, consumption('act-1', { reservation: reservation('lin-1') }));
    STATE.update(c, 'res-1', (p) => Object.assign({}, p, { state: 'SETTLED' }));
    STATE.update(c, 'cons-act-1', (p) => Object.assign({}, p, { reservedLiability: 10, ack: 'ACKNOWLEDGED' }));
    assert.strictEqual(STATE.get(c, 'res-1').state, 'SETTLED');
    assert.strictEqual(STATE.get(c, 'cons-act-1').ack, 'ACKNOWLEDGED');
    validAll(c);
    tear(d);
  });

  t('an invalid ack value is refused', () => {
    const d = dir();
    const c = STATE.open(d);
    assert.throws(() => STATE.add(c, { schemaVersion: 1, kind: 'action_consumption', actionId: 'a', incarnationId: 'i', ownerEpoch: 'o', consumedAt: NOW, reservedLiability: 1, ack: 'MAYBE' }), /invalid ack/);
    tear(d);
  });

  group('state: store failure modes');

  t('a corrupt journal marks the control store corrupt and refuses ops', () => {
    const d = dir();
    const c = STATE.open(d);
    STATE.add(c, REC.createLineage({ lineageId: 'lin-1', createdAt: NOW }));
    // Corrupt the live journal entry (no compact has happened, file exists):
    const jf = fs.readdirSync(path.join(d, 'journal')).filter((f) => f.endsWith('.json'))[0];
    fs.writeFileSync(path.join(d, 'journal', jf), '{tampered');
    const c2 = STATE.open(d);
    assert.ok(c2.corrupt, 'must fail closed');
    assert.throws(() => STATE.all(c2), /corrupt/);
    tear(d);
  });

  group('state: helpers');

  t('byKind filters and all() returns a snapshot', () => {
    const d = dir();
    const c = STATE.open(d);
    STATE.add(c, REC.createLineage({ lineageId: 'lin-1', createdAt: NOW }));
    STATE.add(c, baseAction('act-1'));
    assert.strictEqual(STATE.byKind(c, 'action').length, 1);
    assert.strictEqual(STATE.byKind(c, 'lineage').length, 1);
    tear(d);
  });

  t('recordId resolves per-kind identity fields', () => {
    assert.strictEqual(STATE.recordId({ kind: 'action', actionId: 'a' }), 'a');
    assert.strictEqual(STATE.recordId({ kind: 'lineage', lineageId: 'l' }), 'l');
    assert.strictEqual(STATE.recordId({ kind: 'weird' }), null);
  });
};