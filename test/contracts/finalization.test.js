'use strict';
/**
 * Tests for src/contracts/finalization.js — §19 Universal Finalization.
 *
 * Every ending path invokes the SAME ten-step protocol. Success gates require
 * proven quiescence AND the §20 publication ordering before success is
 * committed; without the qualified runtime boundary (IB-01) quiescence is NOT
 * proven and the outcome is non-successful unresolved execution. The narrow
 * post-terminal exception is authenticated accounting settlement ONLY.
 */

const assert = require('node:assert');
const F = require('../../src/contracts/finalization.js');
const REC = require('../../src/contracts/records.js');
const { validateRecord } = require('../../src/contracts/validate.js');

const FULL = {
  stopReason: REC.TerminalResult.COMPLETE,
  admissionClosed: true,
  authorityRetired: true,
  fencingEstablished: true,
  reconciliationComplete: true,
  quarantineAppliedForUnresolved: true,
  truthfulResultReduced: true,
  publicationOrderingComplete: true,
  quiescenceProven: true,
};

module.exports = function run(t, group) {
  group('finalization: terminal treatment table (§19)');

  t('every TerminalResult has a known, specific treatment', () => {
    for (const sr of Object.values(REC.TerminalResult)) {
      const tr = F.terminalTreatment(sr);
      assert.strictEqual(tr.known, true, `${sr} must have a treatment`);
    }
  });

  t('COMPLETE and COMPLETE_WITH_LIMITATION share the success gate', () => {
    const c = F.terminalTreatment(REC.TerminalResult.COMPLETE);
    const cl = F.terminalTreatment(REC.TerminalResult.COMPLETE_WITH_LIMITATION);
    assert.strictEqual(c.successGate, true);
    assert.strictEqual(cl.successGate, true, 'limitation path still requires the full success gate');
    assert.strictEqual(c.publishesExactFrozen, true);
  });

  t('non-success paths NEVER publish an exact frozen identity as success', () => {
    for (const sr of [REC.TerminalResult.FAILED, REC.TerminalResult.BLOCKED, REC.TerminalResult.NEEDS_USER,
      REC.TerminalResult.CANCELLED, REC.TerminalResult.SAFETY_STOP, REC.TerminalResult.BUDGET_EXHAUSTED, REC.TerminalResult.UNRESOLVED_EXECUTION]) {
      const tr = F.terminalTreatment(sr);
      assert.strictEqual(tr.successGate, false, `${sr} must not be a success gate`);
    }
  });

  t('unknown stop reason fails closed', () => {
    const tr = F.terminalTreatment('BOGUS');
    assert.strictEqual(tr.known, false);
    assert.ok(tr.problems.some((p) => p.includes('unknown stop reason')));
  });

  group('finalization: quiescence (§19)');

  t('quiescence requires the qualified runtime boundary — IB-01 blocks otherwise', () => {
    const good = F.quiescenceConditions({ noAdmittedMutatorRemaining: true, noLateResultCommittable: true, reproducedByQualifiedRuntimeBoundary: true });
    assert.strictEqual(good.ok, true, JSON.stringify(good.problems));
    // A cancel acknowledgement / quiet log / PID list ALONE is insufficient.
    const noBoundary = F.quiescenceConditions({ noAdmittedMutatorRemaining: true, noLateResultCommittable: true, reproducedByQualifiedRuntimeBoundary: false });
    assert.strictEqual(noBoundary.ok, false);
    assert.ok(noBoundary.problems.some((p) => p.includes('qualified runtime boundary')));
  });

  group('finalization: the ten-step protocol');

  t('fully-attested success path => COMPLETE with exact-frozen publication', () => {
    const r = F.reduceFinalization(FULL);
    assert.strictEqual(r.status, F.FINALIZATION_STATUS.COMPLETE, JSON.stringify(r.problems));
    assert.strictEqual(r.terminalResult, REC.TerminalResult.COMPLETE);
    assert.strictEqual(r.quiescenceProven, true);
    assert.strictEqual(r.publishes, true);
    assert.strictEqual(r.unresolved, false);
  });

  
  t('success gate WITHOUT proven quiescence => UNRESOLVED_EXECUTION (publication must stay uncommitted)', () => {
    const r = F.reduceFinalization({ ...FULL, quiescenceProven: false });
    assert.strictEqual(r.status, F.FINALIZATION_STATUS.UNRESOLVED_EXECUTION);
    assert.strictEqual(r.terminalResult, REC.TerminalResult.UNRESOLVED_EXECUTION);
    assert.strictEqual(r.publishes, false);
    assert.ok(r.problems.some((p) => p.includes('quiescence is not proven')));
  });

  t('success gate WITHOUT §20 publication ordering => no publish', () => {
    const r = F.reduceFinalization({ ...FULL, publicationOrderingComplete: false });
    assert.strictEqual(r.publishes, false);
    assert.ok(r.problems.some((p) => p.includes('publication ordering')));
  });

  t('missing any of steps 2–6 on ANY path blocks the result', () => {
    for (const key of ['admissionClosed', 'authorityRetired', 'fencingEstablished', 'reconciliationComplete']) {
      const r = F.reduceFinalization({ ...FULL, [key]: false });
      assert.strictEqual(r.status, F.FINALIZATION_STATUS.UNRESOLVED_EXECUTION, key);
      assert.ok(r.problems.length >= 1, key + ' must surface a problem');
    }
  });

  t('unresolved resources MUST be quarantined (state/authority touch)', () => {
    const r = F.reduceFinalization({ ...FULL, quarantineAppliedForUnresolved: false });
    assert.strictEqual(r.status, F.FINALIZATION_STATUS.UNRESOLVED_EXECUTION);
    assert.ok(r.problems.some((p) => p.includes('quarantined')));
  });

  t('FAILED path with fence+quiescence still does NOT publish (preserves baseline/evidence)', () => {
    const r = F.reduceFinalization({
      ...FULL, stopReason: REC.TerminalResult.FAILED, quiescenceProven: true, publicationOrderingComplete: false,
    });
    assert.strictEqual(r.status, F.FINALIZATION_STATUS.COMPLETE, 'fenced FAILED finalization is a clean non-success terminal');
    assert.strictEqual(r.terminalResult, REC.TerminalResult.FAILED);
    assert.strictEqual(r.publishes, false, 'a FAILED result never publishes as success');
  });

  t('UNRESOLVED_EXECUTION stop reason never claims resources reusable', () => {
    const tr = F.terminalTreatment(REC.TerminalResult.UNRESOLVED_EXECUTION);
    assert.strictEqual(tr.successGate, false);
    assert.ok(tr.preserves.includes('resources'), 'resources must be declared not reusable');
  });

  group('finalization: late payloads (publication/evidence touch)');

  t('a pre-terminal payload is a normal result (not late)', () => {
    const r = F.latePayloadAllowed({ afterTerminal: false, authenticatedAccountingSettlement: false, reopensExecution: false, importsEvidence: false, mutatesCandidate: false, upgradesAssurance: false });
    assert.strictEqual(r.allowed, true);
  });

  t('only authenticated accounting settlement is allowed after the terminal', () => {
    const good = F.latePayloadAllowed({ afterTerminal: true, authenticatedAccountingSettlement: true, reopensExecution: false, importsEvidence: false, mutatesCandidate: false, upgradesAssurance: false });
    assert.strictEqual(good.allowed, true, 'narrow settlement survives');
    const bad = F.latePayloadAllowed({ afterTerminal: true, authenticatedAccountingSettlement: false, reopensExecution: false, importsEvidence: false, mutatesCandidate: false, upgradesAssurance: false });
    assert.strictEqual(bad.allowed, false, 'unauthorized late payload is rejected');
  });

  t('a post-terminal payload that reopens execution / imports evidence / mutates a candidate / upgrades assurance is refused even when authenticated', () => {
    const BASE = { afterTerminal: true, authenticatedAccountingSettlement: true, reopensExecution: false, importsEvidence: false, mutatesCandidate: false, upgradesAssurance: false };
    for (const key of ['reopensExecution', 'importsEvidence', 'mutatesCandidate', 'upgradesAssurance']) {
      const r = F.latePayloadAllowed({ ...BASE, [key]: true });
      assert.strictEqual(r.allowed, false, key + ' must be refused post-terminal');
    }
  });

  group('finalization: durable record validation (adversarial)');

  t('a finalization record validates and durable quiescence gates the store path', () => {
    const rec = REC.createFinalization({ finalizationId: 'fin-1', incarnationId: 'inc-1', stopReason: REC.TerminalResult.COMPLETE });
    rec.quiescenceProven = true;
    rec.fencingEstablished = true;
    rec.admissionClosed = true;
    rec.authorityRetired = true;
    const v = validateRecord(rec);
    assert.strictEqual(v.valid, true, JSON.stringify(v.problems));
  });

  t('an unknown stop reason in a finalization record is not accepted as TerminalResult', () => {
    const rec = REC.createFinalization({ finalizationId: 'fin-1', incarnationId: 'inc-1', stopReason: 'BOGUS' });
    // The finalization validator requires a stopReason string; the contract
    // layer refuses to treat BOGUS as a known ending path (§19 fail closed).
    const tr = F.terminalTreatment(rec.stopReason);
    assert.strictEqual(tr.known, false);
  });
};