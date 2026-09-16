'use strict';
/**
 * Tests for src/contracts/validate.js — fail-closed record validation (PRD §6, §14, §21).
 */

const assert = require('node:assert');
const R = require('../../src/contracts/records.js');
const V = require('../../src/contracts/validate.js');

module.exports = function run(t, group) {
  const E = V.ENUMS;

  function baseTask() {
    return R.createTaskIncarnation({
      taskId: 'task-1', lineageId: 'lineage-1', incarnationId: 'inc-1',
      ownerEpoch: 'epoch-1', originalRequest: 'fix bug', selectedSourceCommit: 'deadbeef',
    });
  }

  group('validateRecord');

  t('a factory-built task record validates', () => {
    assert.strictEqual(V.validateRecord(baseTask()).valid, true);
  });

  t('a malformed record fails closed', () => {
    const r = V.validateRecord({ kind: 'task_incarnation', taskId: '', phase: 'BOGUS' });
    assert.strictEqual(r.valid, false);
    assert.ok(r.problems.length > 0);
  });

  t('an unknown kind fails closed', () => {
    const r = V.validateRecord({ kind: 'mystery_record', anything: true });
    assert.strictEqual(r.valid, false);
    assert.ok(r.problems.some((p) => p.includes('mystery_record')));
  });

  t('a record without a kind fails closed', () => {
    assert.strictEqual(V.validateRecord({ a: 1 }).valid, false);
    assert.strictEqual(V.validateRecord(null).valid, false);
  });

  t('an invalid enum value fails closed', () => {
    const rec = baseTask();
    rec.phase = 'NOT_A_PHASE';
    const r = V.validateRecord(rec);
    assert.strictEqual(r.valid, false);
    assert.ok(r.problems.some((p) => p.includes('NOT_A_PHASE')));
  });

  t('an invalid schemaVersion fails closed', () => {
    const rec = baseTask();
    rec.schemaVersion = 9999;
    assert.strictEqual(V.validateRecord(rec).valid, false);
  });

  t('a consumed allowance on an unattempted action fails closed', () => {
    const rec = R.createAction({ actionId: 'a', incarnationId: 'i', ownerEpoch: 'e', operation: 'op', targetGeneration: 'g' });
    rec.useAllowance = 'CONSUMED'; // but dispatch stays NOT_ATTEMPTED — contradiction, §7
    const r = V.validateRecord(rec);
    assert.strictEqual(r.valid, false);
    assert.ok(r.problems.some((p) => p.includes('CONSUMED allowance with NOT_ATTEMPTED dispatch')));
  });

  t('an action with all default values validates', () => {
    const rec = R.createAction({ actionId: 'a', incarnationId: 'i', ownerEpoch: 'e', operation: 'op', targetGeneration: 'g' });
    assert.strictEqual(V.validateRecord(rec).valid, true);
  });

  t('a finalization with default (unproven) flags validates as a record', () => {
    const rec = R.createFinalization({ finalizationId: 'f', incarnationId: 'i', stopReason: 'CANCELLED' });
    assert.strictEqual(V.validateRecord(rec).valid, true);
  });

  group('validateStoreState');

  t('a store with one valid record validates', () => {
    const r = V.validateStoreState({ records: [baseTask()] });
    assert.strictEqual(r.valid, true);
  });

  t('duplicate identities fail closed within a store', () => {
    const a = R.createAction({ actionId: 'dup', incarnationId: 'i', ownerEpoch: 'e', operation: 'op', targetGeneration: 'g' });
    const b = R.createAction({ actionId: 'dup', incarnationId: 'i2', ownerEpoch: 'e2', operation: 'op2', targetGeneration: 'g2' });
    const r = V.validateStoreState({ records: [a, b] });
    assert.strictEqual(r.valid, false);
    assert.ok(r.problems.some((p) => p.includes('duplicate identity')));
  });

  t('a non-array records list fails closed', () => {
    assert.strictEqual(V.validateStoreState({ records: 'nope' }).valid, false);
    assert.strictEqual(V.validateStoreState(null).valid, false);
  });

  group('digest refs');

  t('a well-formed content id validates as a digest ref', () => {
    assert.strictEqual(V.validateContentId('sha256:' + 'a'.repeat(64)), true);
    assert.strictEqual(V.validateContentId('sha256:' + 'b'.repeat(63)), false);
  });

  t('digest references accept null (unset) but not arbitrary strings', () => {
    assert.strictEqual(V.validateDigestRef(null), true);
    assert.strictEqual(V.validateDigestRef('not-a-digest'), false);
  });

  group('recordDigest');

  t('identical records produce identical digests', () => {
    const a = baseTask();
    const b = baseTask();
    assert.strictEqual(V.recordDigest(a), V.recordDigest(b));
  });

  t('different records produce different digests', () => {
    const a = baseTask();
    const b = baseTask();
    b.phase = R.TaskPhase.AUDITING;
    assert.notStrictEqual(V.recordDigest(a), V.recordDigest(b));
  });
};