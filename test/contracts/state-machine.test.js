'use strict';
/**
 * Tests for src/contracts/state-machine.js — lifecycle state transitions (PRD §7, §8).
 */

const assert = require('node:assert');
const S = require('../../src/contracts/state-machine.js');
const R = require('../../src/contracts/records.js');

module.exports = function run(t, group) {
  group('phase transitions');

  t('RECEIVED -> AUDITING is the lawful first step', () => {
    assert.strictEqual(S.canTransitionPhase(R.TaskPhase.RECEIVED, R.TaskPhase.AUDITING).allowed, true);
  });

  t('every happy-path hop is allowed', () => {
    const hops = [
      [R.TaskPhase.RECEIVED, R.TaskPhase.AUDITING],
      [R.TaskPhase.AUDITING, R.TaskPhase.PLANNING],
      [R.TaskPhase.PLANNING, R.TaskPhase.READY],
      [R.TaskPhase.READY, R.TaskPhase.EXECUTING],
      [R.TaskPhase.EXECUTING, R.TaskPhase.VERIFYING],
      [R.TaskPhase.VERIFYING, R.TaskPhase.FINALIZING],
      [R.TaskPhase.FINALIZING, R.TaskPhase.TERMINAL],
    ];
    for (const [a, b] of hops) {
      assert.strictEqual(S.canTransitionPhase(a, b).allowed, true, `${a} -> ${b}`);
    }
  });

  t('VERIFYING -> REPAIRING is allowed (the one repair branch)', () => {
    assert.strictEqual(S.canTransitionPhase(R.TaskPhase.VERIFYING, R.TaskPhase.REPAIRING).allowed, true);
  });

  t('REPAIRING -> VERIFYING is allowed (re-verification of new generation)', () => {
    assert.strictEqual(S.canTransitionPhase(R.TaskPhase.REPAIRING, R.TaskPhase.VERIFYING).allowed, true);
  });

  t('skipping phases is rejected — RECEIVED cannot jump to VERIFYING', () => {
    assert.strictEqual(S.canTransitionPhase(R.TaskPhase.RECEIVED, R.TaskPhase.VERIFYING).allowed, false);
  });

  t('TERMINAL is a sink — no transitions out', () => {
    for (const p of Object.values(R.TaskPhase)) {
      assert.strictEqual(S.canTransitionPhase(R.TaskPhase.TERMINAL, p).allowed, false);
    }
  });

  t('no transition back into RECEIVED from any later phase', () => {
    for (const p of Object.values(R.TaskPhase)) {
      if (p === R.TaskPhase.RECEIVED) continue;
      assert.strictEqual(S.canTransitionPhase(p, R.TaskPhase.RECEIVED).allowed, false, `${p} -> RECEIVED`);
    }
  });

  t('no transition from a phase to itself', () => {
    for (const p of Object.values(R.TaskPhase)) {
      assert.strictEqual(S.canTransitionPhase(p, p).allowed, false, `${p} -> ${p}`);
    }
  });

  t('every live phase can reach FINALIZING (ending reason covers all live phases)', () => {
    for (const p of [R.TaskPhase.RECEIVED, R.TaskPhase.AUDITING, R.TaskPhase.PLANNING,
      R.TaskPhase.READY, R.TaskPhase.EXECUTING, R.TaskPhase.VERIFYING, R.TaskPhase.REPAIRING]) {
      assert.strictEqual(S.canTransitionPhase(p, R.TaskPhase.FINALIZING).allowed, true, `${p} -> FINALIZING`);
    }
  });

  t('unknown phases fail closed', () => {
    assert.strictEqual(S.canTransitionPhase('BOGUS', R.TaskPhase.FINALIZING).allowed, false);
    assert.strictEqual(S.canTransitionPhase(R.TaskPhase.RECEIVED, 'BOGUS').allowed, false);
  });

  group('phase queries');

  t('isLivePhase / isTerminalPhase partition the phase set', () => {
    for (const p of Object.values(R.TaskPhase)) {
      assert.strictEqual(S.isLivePhase(p) || S.isTerminalPhase(p), true, p);
      assert.strictEqual(S.isLivePhase(p) && S.isTerminalPhase(p), false, p);
    }
  });

  t('TERMINAL is not live; FINALIZING is live', () => {
    assert.strictEqual(S.isLivePhase(R.TaskPhase.FINALIZING), true);
    assert.strictEqual(S.isLivePhase(R.TaskPhase.TERMINAL), false);
    assert.strictEqual(S.isTerminalPhase(R.TaskPhase.TERMINAL), true);
  });

  t('happyPathNext walks RECEIVED all the way to TERMINAL', () => {
    assert.strictEqual(S.happyPathNext(R.TaskPhase.RECEIVED), R.TaskPhase.AUDITING);
    assert.strictEqual(S.happyPathNext(R.TaskPhase.EXECUTING), R.TaskPhase.VERIFYING);
    assert.strictEqual(S.happyPathNext(R.TaskPhase.FINALIZING), R.TaskPhase.TERMINAL);
    assert.strictEqual(S.happyPathNext(R.TaskPhase.TERMINAL), null);
  });

  group('generation one-way transitions');

  t('MUTABLE -> MUTATION_CLOSED -> FROZEN is valid', () => {
    assert.strictEqual(S.validateGenerationOneWay(R.GenerationState.MUTABLE, R.GenerationState.MUTATION_CLOSED).valid, true);
    assert.strictEqual(S.validateGenerationOneWay(R.GenerationState.MUTATION_CLOSED, R.GenerationState.FROZEN).valid, true);
  });

  t('FROZEN must never thaw back to MUTABLE (§7)', () => {
    assert.strictEqual(S.validateGenerationOneWay(R.GenerationState.FROZEN, R.GenerationState.MUTABLE).valid, false);
    assert.strictEqual(S.validateGenerationOneWay(R.GenerationState.FROZEN, R.GenerationState.MUTATION_CLOSED).valid, false);
    assert.strictEqual(S.validateGenerationOneWay(R.GenerationState.MUTATION_CLOSED, R.GenerationState.MUTABLE).valid, false);
  });

  t('canTransitionGeneration rejects a thaw', () => {
    assert.strictEqual(S.canTransitionGeneration(R.GenerationState.FROZEN, R.GenerationState.MUTABLE).allowed, false);
  });

  group('action lifecycle');

  t('PROPOSED admits or refuses; nothing else', () => {
    assert.strictEqual(S.canTransitionAction(R.ActionLifecycle.PROPOSED, R.ActionLifecycle.ADMITTED).allowed, true);
    assert.strictEqual(S.canTransitionAction(R.ActionLifecycle.PROPOSED, R.ActionLifecycle.REFUSED).allowed, true);
    assert.strictEqual(S.canTransitionAction(R.ActionLifecycle.PROPOSED, R.ActionLifecycle.SETTLED).allowed, false);
  });

  t('OBSERVING -> RECONCILING -> SETTLED is the settling path', () => {
    assert.strictEqual(S.canTransitionAction(R.ActionLifecycle.OBSERVING, R.ActionLifecycle.RECONCILING).allowed, true);
    assert.strictEqual(S.canTransitionAction(R.ActionLifecycle.RECONCILING, R.ActionLifecycle.SETTLED).allowed, true);
  });

  t('a settled action cannot be re-opened', () => {
    assert.strictEqual(S.canTransitionAction(R.ActionLifecycle.SETTLED, R.ActionLifecycle.OBSERVING).allowed, false);
    assert.strictEqual(S.canTransitionAction(R.ActionLifecycle.SETTLED, R.ActionLifecycle.RECONCILING).allowed, false);
  });

  t('a refused action stays refused', () => {
    assert.strictEqual(S.canTransitionAction(R.ActionLifecycle.REFUSED, R.ActionLifecycle.ADMITTED).allowed, false);
  });

  group('policy stages');

  t('policy stages must flow PROPOSED -> AUTHORIZED -> EFFECTIVE -> ENFORCED', () => {
    assert.strictEqual(S.canTransitionPolicy(R.PolicyStage.PROPOSED, R.PolicyStage.AUTHORIZED).allowed, true);
    assert.strictEqual(S.canTransitionPolicy(R.PolicyStage.AUTHORIZED, R.PolicyStage.EFFECTIVE).allowed, true);
    assert.strictEqual(S.canTransitionPolicy(R.PolicyStage.EFFECTIVE, R.PolicyStage.ENFORCED).allowed, true);
  });

  t('narrowing takes EFFECTIVE/ENFORCED to FENCED', () => {
    assert.strictEqual(S.canTransitionPolicy(R.PolicyStage.EFFECTIVE, R.PolicyStage.FENCED).allowed, true);
    assert.strictEqual(S.canTransitionPolicy(R.PolicyStage.ENFORCED, R.PolicyStage.FENCED).allowed, true);
  });

  t('policy cannot skip from PROPOSED directly to EFFECTIVE (§8)', () => {
    assert.strictEqual(S.canTransitionPolicy(R.PolicyStage.PROPOSED, R.PolicyStage.EFFECTIVE).allowed, false);
  });

  t('a fenced policy cannot reopen', () => {
    assert.strictEqual(S.canTransitionPolicy(R.PolicyStage.FENCED, R.PolicyStage.EFFECTIVE).allowed, false);
  });

  group('terminal results');

  t('COMPLETE_WITH_LIMITATION is not a non-success result', () => {
    assert.strictEqual(S.isNonSuccess(R.TerminalResult.COMPLETE), false);
    assert.strictEqual(S.isNonSuccess(R.TerminalResult.COMPLETE_WITH_LIMITATION), false);
  });

  t('FAILED, BLOCKED, NEEDS_USER, CANCELLED, SAFETY_STOP, BUDGET_EXHAUSTED, UNRESOLVED_EXECUTION are non-success', () => {
    for (const r of [R.TerminalResult.FAILED, R.TerminalResult.BLOCKED, R.TerminalResult.NEEDS_USER,
      R.TerminalResult.CANCELLED, R.TerminalResult.SAFETY_STOP, R.TerminalResult.BUDGET_EXHAUSTED,
      R.TerminalResult.UNRESOLVED_EXECUTION]) {
      assert.strictEqual(S.isNonSuccess(r), true, r);
    }
  });
};