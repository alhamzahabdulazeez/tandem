'use strict';
/**
 * Tests for src/contracts/acceptance.js — inventory/obligation algebra,
 * §14 coverage validator, §14 outcome reduction, §21 final reduction, and
 * evidence applicability keys.
 */

const assert = require('node:assert');
const ACC = require('../../src/contracts/acceptance.js');
const REC = require('../../src/contracts/records.js');
const { ObligationOutcome } = REC;

function oblig(over) {
  over = over || {};
  return ACC.createObligation({
    obligationId: over.obligationId || 'obl-1',
    mandatoryStatus: 'mandatory',
    applicabilityAndDomain: 'exact slice: verify command exit behavior',
    predicateFamily: ACC.PredicateFamily.EXTERNAL_BEHAVIORAL_CASE,
    predicateAdapterId: 'native-cli-observer',
    predicateVersion: 3,
    parametersAndExpectedValues: { command: 'node', arg: '--version', expectedExit: 0 },
    requiredObservationTypes: ['candidate_stdout', 'candidate_stderr', 'exit_code', 'exit_signal', 'timeout', 'expected_value'],
    requiredScopeAndCompleteness: 'full generated CLI invocation, bounded capture',
    permittedEvidenceSources: ['protected-observer'],
    ...over,
  });
}

function entry(over) {
  over = over || {};
  return ACC.createInventoryEntry({
    requirementId: over.requirementId || 'R1',
    sourceProvenance: 'original prompt, exact slice',
    originalMeaning: 'CLI exits deterministically',
    admittedInterpretation: 'verify deterministic exit under qualified native recipe',
    explicitOrInferred: 'explicit',
    mandatoryOrOptional: 'mandatory',
    applicability: 'APPLICABLE',
    ...over,
  });
}

module.exports = function run(t, group) {
  group('acceptance: obligation construction');

  t('only the three predicate families are supported', () => {
    assert.throws(() => ACC.createObligation(oblig({ predicateFamily: 'LLM_JUDGMENT' })), /unknown predicate family/);
    for (const f of Object.values(ACC.PredicateFamily)) {
      assert.doesNotThrow(() => ACC.createObligation(oblig({ predicateFamily: f })));
    }
  });

  group('acceptance: §14 coverage validator (8 points)');

  t('a complete inventory+obligation pair passes all 8 points', () => {
    const inv = [entry({ requirementId: 'R1', mappedObligationIds: ['obl-1'] })];
    const r = ACC.validateCoverage({ inventory: inv, obligations: [oblig({ obligationId: 'obl-1' })], claimedOutcome: true });
    assert.strictEqual(r.ok, true, JSON.stringify(r.problems));
  });

  t('point 1: empty mandatory inventory for a claimed outcome', () => {
    const r = ACC.validateCoverage({ inventory: [entry({ mandatoryOrOptional: 'optional' })], obligations: [oblig()], claimedOutcome: true });
    assert.ok(r.problems.some((p) => p.startsWith('1')));
  });

  t('point 2 + 7: mandatory requirement with no obligation mapping', () => {
    const inv = [entry({ requirementId: 'R2', mappedObligationIds: [] })];
    const r = ACC.validateCoverage({ inventory: inv, obligations: [], claimedOutcome: true });
    assert.ok(r.problems.some((p) => p.includes('R2 has no obligation mapping')));
    assert.ok(r.problems.some((p) => p.includes('silently optional')));
  });

  t('point 4: unsupported predicate family fails coverage and construction', () => {
    const inv = [entry({ requirementId: 'R1', mappedObligationIds: ['o-x'] })];
    // Spread to create a mutable plain-object copy (createObligation returns frozen)
    const bad = { ...oblig({ obligationId: 'o-x' }), predicateFamily: 'BOGUS' };
    const r = ACC.validateCoverage({ inventory: inv, obligations: [bad], claimedOutcome: true });
    assert.ok(r.problems.some((p) => p.includes('unsupported predicate family')));
  });

  t('point 5: missing predicate adapter/version or expected values', () => {
    const inv = [entry({ requirementId: 'R1', mappedObligationIds: ['o-5'] })];
    const o = oblig({ obligationId: 'o-5', predicateAdapterId: null, predicateVersion: null, parametersAndExpectedValues: {} });
    const r = ACC.validateCoverage({ inventory: inv, obligations: [o], claimedOutcome: true });
    assert.ok(r.problems.some((p) => p.includes('no predicateAdapterId')));
    assert.ok(r.problems.some((p) => p.includes('no predicateVersion')));
    assert.ok(r.problems.some((p) => p.includes('no parametersAndExpectedValues')));
  });

  t('point 4 requires the family observation types (EXTERNAL case needs exit evidence)', () => {
    const inv = [entry({ requirementId: 'R1', mappedObligationIds: ['o-4'] })];
    const o = oblig({ obligationId: 'o-4', requiredObservationTypes: ['stdout'] });
    const r = ACC.validateCoverage({ inventory: inv, obligations: [o], claimedOutcome: true });
    assert.ok(r.problems.some((p) => p.includes('required observation type "exit_code"')));
  });

  t('point 8: empty conjunction cannot establish acceptance', () => {
    const r = ACC.validateCoverage({ inventory: [entry()], obligations: [], claimedOutcome: true });
    assert.ok(r.problems.some((p) => p.startsWith('8')));
    assert.strictEqual(r.ok, false);
  });

  group('acceptance: total outcome reduction');

  t('PASS only from complete, valid, applicable, satisfied evidence', () => {
    const r = ACC.reduceObligation(oblig({ mandatoryStatus: 'mandatory' }), [
      { valid: true, applicable: true, evaluation: 'predicate_satisfied', completeness: 'complete' },
    ]);
    assert.strictEqual(r.outcome, ObligationOutcome.PASS);
  });

  t('an applicable failure FAILs even with a later green observation (monotonic)', () => {
    const r = ACC.reduceObligation(oblig(), [
      { valid: true, applicable: true, evaluation: 'predicate_satisfied', completeness: 'complete' },
      { valid: true, applicable: true, evaluation: 'predicate_contradicted', completeness: 'complete' },
    ]);
    assert.strictEqual(r.outcome, ObligationOutcome.FAIL);
    assert.ok(r.reasons.some((x) => x.includes('failure')));
  });

  t('no observations for a mandatory obligation is MISSING, never PASS', () => {
    const r = ACC.reduceObligation(oblig({ mandatoryStatus: 'mandatory' }), []);
    assert.strictEqual(r.outcome, ObligationOutcome.MISSING);
  });

  t('invalid/untrusted observation produces INCONCLUSIVE, not PASS', () => {
    const r = ACC.reduceObligation(oblig({ mandatoryStatus: 'mandatory' }), [
      { valid: false, applicable: true, evaluation: 'predicate_satisfied', completeness: 'complete' },
    ]);
    assert.strictEqual(r.outcome, ObligationOutcome.INCONCLUSIVE);
  });

  t('incomplete applicable observation for mandatory obligation is INCONCLUSIVE', () => {
    const r = ACC.reduceObligation(oblig({ mandatoryStatus: 'mandatory' }), [
      { valid: true, applicable: true, evaluation: 'predicate_satisfied', completeness: 'incomplete' },
    ]);
    assert.strictEqual(r.outcome, ObligationOutcome.INCONCLUSIVE);
  });

  t('evaluateObservation never fabricates validity on missing actual', () => {
    const r = ACC.evaluateObservation({ evidenceId: 'e', predicts: '0', actual: null });
    assert.strictEqual(r.valid, false);
  });

  t('evaluateObservation contradicts on mismatch', () => {
    const r = ACC.evaluateObservation({ predicts: '0', actual: '1', complete: true });
    assert.strictEqual(r.evaluation, 'predicate_contradicted');
  });

  group('acceptance: §21 final reduction');

  function goodReductionInputs(over) {
    return {
      inventory: [entry({ requirementId: 'R1', mappedObligationIds: ['obl-1'] })],
      obligations: [oblig({ obligationId: 'obl-1' })],
      observations: [{ obligationId: 'obl-1', valid: true, applicable: true, evaluation: 'predicate_satisfied', completeness: 'complete' }],
      evidenceCoherent: true,
      frozenGenerationId: 'gen:1',
      derivationEstablished: true,
      quiescenceProven: true,
      payloadManifestComplete: true,
      cleanAuthorityOwnership: true,
      blockers: [],
      ...over,
    };
  }

  t('all §21 preconditions met => accepted', () => {
    const r = ACC.reduceAcceptance(goodReductionInputs());
    assert.strictEqual(r.accepted, true);
    assert.strictEqual(r.assurance, REC.Assurance.VERIFIED_REQUIRED_CHECKS);
  });

  t('empty conjunction is never accepted', () => {
    const r = ACC.reduceAcceptance(goodReductionInputs({ obligations: [], observations: [] }));
    assert.strictEqual(r.accepted, false);
    assert.ok(r.reasons.some((x) => x.includes('empty conjunction')));
  });

  t('MISSING mandatory obligation blocks acceptance (never upgrades to PASS)', () => {
    const r = ACC.reduceAcceptance(goodReductionInputs({
      obligations: [oblig({ obligationId: 'obl-1' }), oblig({ obligationId: 'obl-2' })],
      inventory: [
        entry({ requirementId: 'R1', mappedObligationIds: ['obl-1'] }),
        entry({ requirementId: 'R2', mappedObligationIds: ['obl-2'] }),
      ],
      observations: [{ obligationId: 'obl-1', valid: true, applicable: true, evaluation: 'predicate_satisfied', completeness: 'complete' }],
    }));
    assert.strictEqual(r.accepted, false);
    assert.strictEqual(r.assurance, REC.Assurance.PARTIAL);
    assert.ok(r.reasons.some((x) => x.includes('obl-2 is MISSING')));
  });

  t('an applicable FAIL yields FAILED_REQUIRED_CHECKS', () => {
    const r = ACC.reduceAcceptance(goodReductionInputs({
      observations: [{ obligationId: 'obl-1', valid: true, applicable: true, evaluation: 'predicate_contradicted', completeness: 'complete' }],
    }));
    assert.strictEqual(r.accepted, false);
    assert.strictEqual(r.assurance, REC.Assurance.FAILED_REQUIRED_CHECKS);
    assert.strictEqual(r.outcome, 'FAILED');
  });

  t('missing quiescence or payload blocks acceptance', () => {
    const noQ = ACC.reduceAcceptance(goodReductionInputs({ quiescenceProven: false }));
    assert.strictEqual(noQ.accepted, false);
    const noP = ACC.reduceAcceptance(goodReductionInputs({ payloadManifestComplete: false }));
    assert.strictEqual(noP.accepted, false);
  });

  group('acceptance: evidence applicability keys');

  t('applicability key differs across generation, contract, predicate, policy, profile', () => {
    const base = {
      taskAndIncarnation: 't:1/i:1', originatingAction: 'a:1', acceptanceContractDigest: 'c:1',
      predicateFamily: ACC.PredicateFamily.EXTERNAL_BEHAVIORAL_CASE, predicateVersion: 1,
      parametersDigest: 'p:1', effectivePolicyRevision: 'pol:1', qualifiedProfileDigest: 'q:1',
      selectedSourceBaseline: 'src:1', exactGenerationAndTreeDigest: 'gen:1',
    };
    const k1 = ACC.evidenceApplicabilityKey(base);
    assert.strictEqual(k1, ACC.evidenceApplicabilityKey(base));
    assert.notStrictEqual(k1, ACC.evidenceApplicabilityKey({ ...base, exactGenerationAndTreeDigest: 'gen:2' }));
    assert.notStrictEqual(k1, ACC.evidenceApplicabilityKey({ ...base, acceptanceContractDigest: 'c:2' }));
    assert.notStrictEqual(k1, ACC.evidenceApplicabilityKey({ ...base, predicateVersion: 2 }));
    assert.notStrictEqual(k1, ACC.evidenceApplicabilityKey({ ...base, effectivePolicyRevision: 'pol:2' }));
  });
};