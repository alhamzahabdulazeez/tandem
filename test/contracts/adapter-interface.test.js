'use strict';
/**
 * Tests for src/contracts/adapter-interface.js — thin supervisor-side adapter
 * contract (PRD §2, §4, §25 forced shortcuts: no whole-session grants).
 */

const assert = require('node:assert');
const A = require('../../src/contracts/adapter-interface.js');

module.exports = function run(t, group) {
  group('interface validation');

  t('a compliant adapter validates', () => {
    const adapter = {
      identity: 'x@1.0.0',
      contractVersion: A.ADAPTER_CONTRACT_VERSION,
      translate: () => ({}),
      isMutating: () => false,
      cancel: () => ({}),
      toObservation: () => ({}),
    };
    assert.strictEqual(A.validateAdapterInterface(adapter).valid, true);
  });

  t('a missing method fails validation', () => {
    const adapter = {
      identity: 'x@1.0.0',
      contractVersion: A.ADAPTER_CONTRACT_VERSION,
      translate: () => ({}),
    };
    const r = A.validateAdapterInterface(adapter);
    assert.strictEqual(r.valid, false);
    assert.ok(r.problems.some((p) => p.includes('isMutating')));
    assert.ok(r.problems.some((p) => p.includes('cancel')));
    assert.ok(r.problems.some((p) => p.includes('toObservation')));
  });

  t('a wrong contract version fails validation', () => {
    const adapter = {
      identity: 'x@1.0.0',
      contractVersion: A.ADAPTER_CONTRACT_VERSION + 1,
      translate: () => ({}), isMutating: () => false, cancel: () => ({}), toObservation: () => ({}),
    };
    assert.strictEqual(A.validateAdapterInterface(adapter).valid, false);
  });

  t('a missing identity fails validation', () => {
    const adapter = {
      contractVersion: A.ADAPTER_CONTRACT_VERSION,
      translate: () => ({}), isMutating: () => false, cancel: () => ({}), toObservation: () => ({}),
    };
    assert.strictEqual(A.validateAdapterInterface(adapter).valid, false);
  });

  t('non-object candidate fails validation', () => {
    assert.strictEqual(A.validateAdapterInterface(null).valid, false);
    assert.strictEqual(A.validateAdapterInterface(undefined).valid, false);
  });

  group('event kinds');

  t('the neutral event kinds are the four tools plus turn_end and gate_failed', () => {
    for (const k of ['read', 'write', 'edit', 'bash', 'turn_end', 'gate_failed']) {
      assert.ok(Object.values(A.EVENT_KINDS).includes(k), k);
    }
  });

  t('write and edit are mutations; read and bash are not', () => {
    assert.strictEqual(A.isMutatingKind('write'), true);
    assert.strictEqual(A.isMutatingKind('edit'), true);
    assert.strictEqual(A.isMutatingKind('read'), false);
    assert.strictEqual(A.isMutatingKind('bash'), false);
  });

  t('effect scope ranks read < bash < write < edit', () => {
    assert.ok(A.compareEffectScope('read', 'bash') < 0);
    assert.ok(A.compareEffectScope('bash', 'write') < 0);
    assert.ok(A.compareEffectScope('write', 'edit') < 0);
    assert.ok(A.compareEffectScope('read', 'edit') < 0);
    assert.ok(A.compareEffectScope('edit', 'edit') === 0);
  });

  t('unknown kinds compare as the largest scope (conservative)', () => {
    assert.ok(A.compareEffectScope('read', 'unknown') < 0);
  });
};