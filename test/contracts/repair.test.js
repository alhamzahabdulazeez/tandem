'use strict';
/**
 * Tests for src/contracts/repair.js — §18 Bounded Repair.
 *
 * The MVP ceiling is exactly ONE repair. Every eligibility condition must be
 * explicitly true (fail closed), the failure identity is mandatory and must
 * carry the §18 fields, the MUST-NOT prohibitions are hard, and stop
 * conditions terminate repair truthfully. Nothing here claims a qualified
 * materializer or protected execution — that is IB-01's domain.
 */

const assert = require('node:assert');
const R = require('../../src/contracts/repair.js');
const REC = require('../../src/contracts/records.js');
const { validateRecord, validateStoreState } = require('../../src/contracts/validate.js');

/** A fully-attested §18 failure identity. */
function identity(over) {
  return {
    requirementOrCheck: 'obl-1',
    caseIdentity: 'case:exit-1',
    affectedComponent: 'src/cli.js',
    severity: R.FailureSeverity.BLOCKING,
    normalizedSignature: 'sig:exit1',
    generationId: 'gen-1',
    rawEvidenceReference: 'evidence/obs-1.json',
    ...(over || {}),
  };
}

/** All eligibility conditions true. */
function eligible({ allowanceUsed = false } = {}) {
  return {
    failure: true,
    identity: identity(),
    minimalCausalHypothesis: true,
    insideIntentSurface: true,
    contractAndOracleUnchanged: true,
    allowanceUsed,
    budgetCoversFullCycle: true,
    priorActorsReconciledOrFenced: true,
    noCompromise: true,
  };
}

module.exports = function run(t, group) {
  group('repair: failure identity (§18)');

  t('a complete §18 failure identity normalizes ok', () => {
    const r = R.rawFailureIdentity(identity());
    assert.strictEqual(r.ok, true, JSON.stringify(r.problems));
    assert.strictEqual(r.identity.normalizedSignature, 'sig:exit1');
    assert.strictEqual(r.identity.rawEvidenceReference, 'evidence/obs-1.json');
  });

  t('failure identity fails closed when any mandatory §18 field is missing', () => {
    for (const key of ['requirementOrCheck', 'caseIdentity', 'normalizedSignature', 'rawEvidenceReference']) {
      const base = identity();
      delete base[key];
      const r = R.rawFailureIdentity(base);
      assert.strictEqual(r.ok, false, `${key} must be required`);
      assert.ok(r.problems.some((p) => p.includes(key)), `${key} problem must be surfaced`);
    }
  });

  t('unknown severity is rejected', () => {
    const r = R.rawFailureIdentity(identity({ severity: 'HUGE' }));
    assert.strictEqual(r.ok, false);
    assert.ok(r.problems.some((p) => p.includes('severity')));
  });

  group('repair: eligibility lattice — all conditions must hold');

  t('all §18 conditions true => READY (exactly one repair available)', () => {
    const r = R.repairEligibility(eligible());
    assert.strictEqual(r.status, R.REPAIR_STATUS.READY, JSON.stringify(r.problems));
    assert.strictEqual(R.REPAIR_CEILING, 1, 'the MVP ceiling is exactly one repair');
  });

  t('each missing condition alone => DISALLOWED with its own problem', () => {
    const cases = [
      ['failure', (o) => ({ ...o, failure: false })],
      ['hypothesis', (o) => ({ ...o, minimalCausalHypothesis: false })],
      ['intent', (o) => ({ ...o, insideIntentSurface: false })],
      ['contract/oracle', (o) => ({ ...o, contractAndOracleUnchanged: false })],
      ['budget', (o) => ({ ...o, budgetCoversFullCycle: false })],
      ['actors', (o) => ({ ...o, priorActorsReconciledOrFenced: false })],
      ['compromise', (o) => ({ ...o, noCompromise: false })],
    ];
    for (const [label, mutate] of cases) {
      const r = R.repairEligibility(mutate(eligible()));
      assert.strictEqual(r.status, R.REPAIR_STATUS.DISALLOWED, label);
      assert.ok(r.problems.length >= 1, label + ' must produce a problem');
    }
  });

  t('missing/incomplete recorded failure identity => DISALLOWED (authority/evidence touch)', () => {
    const noId = R.repairEligibility({ ...eligible(), identity: null });
    assert.strictEqual(noId.status, R.REPAIR_STATUS.DISALLOWED);
    assert.ok(noId.problems.some((p) => p.includes('identity')));
    const thinId = R.repairEligibility({ ...eligible(), identity: { caseIdentity: 'x' } });
    assert.strictEqual(thinId.status, R.REPAIR_STATUS.DISALLOWED);
  });

  t('consumed allowance => EXHAUSTED, monotonic even with a clean eligibility call', () => {
    const r = R.repairEligibility(eligible({ allowanceUsed: true }));
    assert.strictEqual(r.status, R.REPAIR_STATUS.EXHAUSTED);
    // A nominally-clean call cannot mint a second repair once the latch is spent.
    assert.ok(r.problems.some((p) => p.includes('allowance was already durably consumed')));
  });

  group('repair: MUST-NOT prohibitions (§18)');

  t('any MUST NOT violation rejects the proposed repair', () => {
    const ok = R.repairMustNot({ thawsFrozenGeneration: false, overwritesAcceptedPayload: false, inheritsOldPass: false, resetsLineageBudget: false });
    assert.strictEqual(ok.ok, true, JSON.stringify(ok.problems));
    const bad = R.repairMustNot({ thawsFrozenGeneration: true, overwritesAcceptedPayload: false, inheritsOldPass: false, resetsLineageBudget: false });
    assert.strictEqual(bad.ok, false);
    assert.ok(bad.problems.some((p) => p.includes('thaw')));
    const thawOld = R.repairMustNot({ thawsFrozenGeneration: true, inheritsOldPass: true });
    assert.strictEqual(thawOld.ok, false);
    assert.strictEqual(thawOld.problems.length, 2, 'each violation is independently reported');
  });

  group('repair: stop conditions');

  t('any stop condition stops; none stops only with no reasons', () => {
    const go = R.shouldStopRepair({});
    assert.strictEqual(go.stop, false);
    assert.strictEqual(go.reasons.length, 0);
    const stop = R.shouldStopRepair({ capacityExhausted: true, ceilingReached: true });
    assert.strictEqual(stop.stop, true);
    assert.deepStrictEqual(stop.reasons, ['capacity exhausted', 'repair ceiling reached']);
  });

  t('error-count reduction alone is not progress — repeated signature without new evidence stops', () => {
    const r = R.shouldStopRepair({ repeatedSignatureWithoutNewEvidence: true });
    assert.strictEqual(r.stop, true);
    assert.ok(r.reasons.some((x) => x.includes('repeated failure signature')));
  });

  group('repair: identity comparison — stop truthfully');

  t('sameFailure detects the same concrete failure across generations', () => {
    const a = R.rawFailureIdentity(identity()).identity;
    const b = R.rawFailureIdentity(identity({ generationId: 'gen-2' })).identity;
    assert.strictEqual(R.sameFailure(a, b), true, 'generation change with identical signature is the same failure');
    assert.strictEqual(R.sameFailure(a, R.rawFailureIdentity(identity({ normalizedSignature: 'sig:other' })).identity), false);
    assert.strictEqual(R.sameFailure(a, null), false);
  });

  group('repair: durable record through the store');

  t('a repair record with a full §18 identity validates and is store-addable', () => {
    const rec = REC.createRepair({
      repairId: 'rep-1', incarnationId: 'inc-1',
      failureIdentity: identity(),
      disposableGenerationId: 'gen-2',
    });
    const v = validateRecord(rec);
    assert.strictEqual(v.valid, true, JSON.stringify(v.problems));
    assert.strictEqual(rec.allowanceConsumed, true, 'creating the repair durably consumes the one allowance');
  });

  t('a malformed repair record fails closed (missing failure identity fields)', () => {
    const rec = REC.createRepair({ repairId: 'rep-1', incarnationId: 'inc-1', failureIdentity: { caseIdentity: 'x' } });
    const v = validateRecord(rec);
    assert.strictEqual(v.valid, false);
    assert.ok(v.problems.some((p) => p.includes('failureIdentity')));
  });

  t('duplicate repair identity is a store-invalid state (adversarial)', () => {
    const rec = REC.createRepair({ repairId: 'rep-1', incarnationId: 'inc-1', failureIdentity: identity() });
    const dup = { ...rec, disposableGenerationId: 'gen-2' };
    const s = validateStoreState({ records: [rec, dup] });
    assert.strictEqual(s.valid, false);
    assert.ok(s.problems.some((p) => p.includes('duplicate identity "rep-1"')));
  });
};