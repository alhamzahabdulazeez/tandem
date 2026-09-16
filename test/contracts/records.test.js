'use strict';
/**
 * Tests for src/contracts/records.js — durable record definitions (PRD §6, §7).
 */

const assert = require('node:assert');
const R = require('../../src/contracts/records.js');

module.exports = function run(t, group) {
  group('enums');

  t('TaskPhase contains all phase values from PRD §7', () => {
    for (const phase of [
      'RECEIVED', 'AUDITING', 'PLANNING', 'READY',
      'EXECUTING', 'VERIFYING', 'REPAIRING', 'FINALIZING', 'TERMINAL',
    ]) {
      assert.ok(R.TaskPhase[phase] === phase, phase);
    }
  });

  t('TaskPhase is frozen — no mutation at runtime', () => {
    assert.throws(() => { 'use strict'; R.TaskPhase.INVALID = 'x'; }, TypeError);
  });

  t('TerminalResult contains all nine terminal results from §7', () => {
    for (const r of [
      'COMPLETE', 'COMPLETE_WITH_LIMITATION', 'FAILED', 'BLOCKED', 'NEEDS_USER',
      'CANCELLED', 'SAFETY_STOP', 'BUDGET_EXHAUSTED', 'UNRESOLVED_EXECUTION',
    ]) {
      assert.ok(R.TerminalResult[r] === r, r);
    }
  });

  t('NON_SUCCESS_RESULTS excludes COMPLETE variants', () => {
    assert.ok(!R.NON_SUCCESS_RESULTS.has(R.TerminalResult.COMPLETE));
    assert.ok(!R.NON_SUCCESS_RESULTS.has(R.TerminalResult.COMPLETE_WITH_LIMITATION));
    assert.ok(R.NON_SUCCESS_RESULTS.has(R.TerminalResult.FAILED));
    assert.ok(R.NON_SUCCESS_RESULTS.has(R.TerminalResult.UNRESOLVED_EXECUTION));
  });

  t('GenerationState has exactly the three one-way states from §7', () => {
    assert.deepStrictEqual(
      Object.values(R.GenerationState).sort(),
      ['MUTABLE', 'MUTATION_CLOSED', 'FROZEN'].sort());
  });

  t('ObligationOutcome has exactly the four total outcomes from §14', () => {
    assert.deepStrictEqual(
      Object.values(R.ObligationOutcome).sort(),
      ['PASS', 'FAIL', 'MISSING', 'INCONCLUSIVE'].sort());
  });

  t('Assurance has exactly the four meanings from §21', () => {
    assert.deepStrictEqual(
      Object.values(R.Assurance).sort(),
      ['VERIFIED_REQUIRED_CHECKS', 'FAILED_REQUIRED_CHECKS', 'PARTIAL', 'UNVERIFIED'].sort());
  });

  t('PolicyStage has exactly the five stages from §8', () => {
    assert.deepStrictEqual(
      Object.values(R.PolicyStage).sort(),
      ['PROPOSED', 'AUTHORIZED', 'EFFECTIVE', 'ENFORCED', 'FENCED'].sort());
  });

  t('ReleaseDisposition matches §30 disposal set', () => {
    for (const d of ['RELEASE_READY_FOR_DECLARED_PROFILE', 'CHECKER_ONLY', 'BLOCKED', 'VALUE_NOT_ESTABLISHED']) {
      assert.ok(R.ReleaseDisposition[d] === d, d);
    }
  });

  group('ID generation');

  t('generateId produces a namespaced id with timestamp and randomness', () => {
    const id = R.generateId('task', {
      now: () => 1700000000000,
      randomBytes: () => Buffer.from('0102030405060708', 'hex'),
    });
    assert.strictEqual(id, 'task-1700000000000-0102030405060708');
  });

  t('generateId rejects a missing or empty type', () => {
    assert.throws(() => R.generateId(''), /type must be a non-empty string/);
    assert.throws(() => R.generateId(undefined), /type must be a non-empty string/);
  });

  t('generateId produces non-reusable ids for distinct randomness', () => {
    const a = R.generateId('action');
    const b = R.generateId('action');
    assert.notStrictEqual(a, b);
  });

  group('record factories');

  t('createStoreOwner binds canonical path, lock, and owner identity', () => {
    const rec = R.createStoreOwner({
      canonicalStorePath: '/srv/tandem/state',
      lockIdentity: 'lock-1',
      ownerIdentity: 'owner-1',
    });
    assert.strictEqual(rec.kind, 'store_owner');
    assert.strictEqual(rec.currentEpoch, 0);
    assert.strictEqual(rec.recoveryState, 'NORMAL');
  });

  t('createTaskIncarnation defaults to RECEIVED phase with active status', () => {
    const rec = R.createTaskIncarnation({
      taskId: 'task-1', lineageId: 'lineage-1', incarnationId: 'inc-1',
      ownerEpoch: 'epoch-1', originalRequest: 'do a thing', selectedSourceCommit: 'abc123',
    });
    assert.strictEqual(rec.phase, R.TaskPhase.RECEIVED);
    assert.strictEqual(rec.incarnationStatus, 'ACTIVE');
  });

  t('createAction defaults to unconsumed allowance and pending execution', () => {
    const rec = R.createAction({
      actionId: 'act-1', incarnationId: 'inc-1', ownerEpoch: 'epoch-1',
      operation: 'run', targetGeneration: 'gen-1',
    });
    assert.strictEqual(rec.useAllowance, R.UseAllowance.UNCONSUMED);
    assert.strictEqual(rec.dispatch, R.ActionDispatch.NOT_ATTEMPTED);
    assert.strictEqual(rec.execution, R.ActionExecution.PENDING);
    assert.strictEqual(rec.lifecycle, R.ActionLifecycle.PROPOSED);
  });

  t('createPolicy defaults to LOCAL_ONLY network policy and PROPOSED stage', () => {
    const rec = R.createPolicy({ policyId: 'p-1', incarnationId: 'inc-1' });
    assert.strictEqual(rec.stage, R.PolicyStage.PROPOSED);
    assert.strictEqual(rec.networkPolicy, 'LOCAL_ONLY');
    assert.deepStrictEqual(rec.writableRoots, []);
  });

  t('createAcceptanceContract defaults to not frozen with NO_RETRY rule', () => {
    const rec = R.createAcceptanceContract({ contractId: 'c-1', taskId: 'task-1', incarnationId: 'inc-1' });
    assert.strictEqual(rec.frozen, false);
    assert.strictEqual(rec.retryRule, 'NO_RETRY');
  });

  t('createDelivery defaults to NOT_PUBLISHED persistence', () => {
    const rec = R.createDelivery({ deliveryId: 'd-1', taskId: 'task-1', frozenGenerationId: 'gen-1' });
    assert.strictEqual(rec.persistenceState, 'NOT_PUBLISHED');
  });

  t('createFinalization defaults to the un-proven finalization flags', () => {
    const rec = R.createFinalization({ finalizationId: 'f-1', incarnationId: 'inc-1', stopReason: 'CANCELLED' });
    [rec.admissionClosed, rec.authorityRetired, rec.fencingEstablished, rec.quiescenceProven]
      .forEach((f) => assert.strictEqual(f, false));
    assert.strictEqual(rec.unresolvedExecution, false);
  });

  t('every record factory stamps the current schema version', () => {
    const wrappers = [
      () => R.createStoreOwner({ canonicalStorePath: 'p', lockIdentity: 'l', ownerIdentity: 'o' }),
      () => R.createLineage({ lineageId: 'l', createdAt: 't' }),
      () => R.createTaskIncarnation({ taskId: 't', lineageId: 'l', incarnationId: 'i', ownerEpoch: 'e', originalRequest: 'r', selectedSourceCommit: 'c' }),
      () => R.createAction({ actionId: 'a', incarnationId: 'i', ownerEpoch: 'e', operation: 'op', targetGeneration: 'g' }),
      () => R.createPolicy({ policyId: 'p', incarnationId: 'i' }),
      () => R.createAcceptanceContract({ contractId: 'c', taskId: 't', incarnationId: 'i' }),
      () => R.createBudget({ lineageId: 'l' }),
      () => R.createDelivery({ deliveryId: 'd', taskId: 't', frozenGenerationId: 'g' }),
      () => R.createFinalization({ finalizationId: 'f', incarnationId: 'i', stopReason: 's' }),
    ];
    for (const make of wrappers) {
      const rec = make();
      assert.strictEqual(rec.schemaVersion, R.SCHEMA_VERSION, rec.kind);
    }
  });
};