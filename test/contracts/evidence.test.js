'use strict';
/**
 * Tests for src/contracts/evidence.js — §17 envelope integrity, applicability
 * keys, candidate-vs-authoritative classification, and final coherence.
 */

const assert = require('node:assert');
const EV = require('../../src/contracts/evidence.js');
const ACC = require('../../src/contracts/acceptance.js');

function fullEvidence(over) {
  const env = {
    taskAndIncarnation: 'task-1/inc-1',
    originatingOwnerAndAction: 'owner@boot/action-1',
    acceptanceContractDigest: 'contract-d1',
    requirementObligationAndPredicateIdentity: 'R1/obl-1',
    predicateVersionParametersAndExpectedValues: 'v3:{"exit":0}',
    effectivePolicyRevision: 'policy-1',
    qualifiedProfileDigest: 'profile-q1',
    selectedSourceBaseline: 'commit-a',
    exactCandidateGenerationAndTreeDigest: 'gen-1/tree-1',
    actualSourceDependencyConfigurationEnvironmentInputs: 'node@26/root',
    runtimeToolchainAndLaunchIdentity: 'node-v26.x',
    discoverySelectionAndExecutionScope: 'full-native-suite',
    artifactDerivationIfApplicable: null,
    observationInterval: 'start=1 end=2',
    completionTimeoutSignalAndTruncationState: 'exit=0',
    provenance: 'protected-observer',
    conflictsInvalidationsAndSupersession: 'none',
  };
  return Object.assign(EV.createEvidence({
    evidenceId: 'ev-1',
    observationPath: 'protected/evidence/ev-1.json',
    classification: 'authoritative',
    envelope: env,
  }), over || {});
}

module.exports = function run(t, group) {
  group('evidence: envelope completeness');

  t('a fully populated envelope is complete', () => {
    const r = EV.envelopeComplete(fullEvidence());
    assert.strictEqual(r.ok, true, JSON.stringify(r.problems));
  });

  t('dropping any §17 field makes the envelope incomplete (fail closed)', () => {
    for (const field of EV.ENVELOPE_FIELDS) {
      const env = fullEvidence().envelope;
      const truncated = fullEvidence({ envelope: { ...env, [field]: undefined } });
      const r = EV.envelopeComplete(truncated);
      assert.strictEqual(r.ok, false, `field ${field} must be mandatory`);
      assert.ok(r.problems.some((p) => p.includes(field)));
    }
  });

  t('artifactDerivationIfApplicable may be explicitly null but not absent', () => {
    const env = fullEvidence().envelope;
    assert.strictEqual(EV.envelopeComplete(fullEvidence({ envelope: { ...env, artifactDerivationIfApplicable: null } })).ok, true);
    const absent = fullEvidence({ envelope: { ...env, artifactDerivationIfApplicable: undefined } });
    assert.strictEqual(EV.envelopeComplete(absent).ok, false);
  });

  t('missing evidenceId or observationPath is incomplete', () => {
    assert.strictEqual(EV.envelopeComplete(fullEvidence({ evidenceId: null })).ok, false);
    assert.strictEqual(EV.envelopeComplete(fullEvidence({ observationPath: '' })).ok, false);
    assert.strictEqual(EV.envelopeComplete(null).ok, false);
  });

  group('evidence: authoritative classification');

  t('candidate-authored evidence stays supporting even in protected storage', () => {
    const supporting = fullEvidence({ classification: 'supporting' });
    const r = EV.authoritative({ evidence: supporting, observerQualified: false });
    assert.strictEqual(r.ok, false);
    const r2 = EV.authoritative({ evidence: supporting, observerQualified: true });
    assert.strictEqual(r2.ok, false);
  });

  t('only a qualified external observer record can be authoritative', () => {
    const r = EV.authoritative({ evidence: fullEvidence(), observerQualified: true });
    assert.strictEqual(r.ok, true);
    const r2 = EV.authoritative({ evidence: fullEvidence(), observerQualified: false });
    assert.strictEqual(r2.ok, false);
  });

  group('evidence: applicability and no-stale-reuse');

  t('an applicable key matches and a foreign key is rejected (§17 stale reuse)', () => {
    const env = fullEvidence().envelope;
    const key = ACC.evidenceApplicabilityKey({
      taskAndIncarnation: env.taskAndIncarnation,
      originatingAction: env.originatingOwnerAndAction,
      acceptanceContractDigest: env.acceptanceContractDigest,
      predicateFamily: ACC.PredicateFamily.EXTERNAL_BEHAVIORAL_CASE,
      predicateVersion: 3,
      parametersDigest: env.predicateVersionParametersAndExpectedValues,
      effectivePolicyRevision: env.effectivePolicyRevision,
      qualifiedProfileDigest: env.qualifiedProfileDigest,
      selectedSourceBaseline: env.selectedSourceBaseline,
      exactGenerationAndTreeDigest: env.exactCandidateGenerationAndTreeDigest,
    });
    const ev = fullEvidence({ applicabilityKey: key });
    assert.strictEqual(EV.evidenceApplicable(ev, key).applicable, true);

    const other = ACC.evidenceApplicabilityKey({
      taskAndIncarnation: 'task-1/inc-1', originatingAction: 'owner@boot/action-1',
      acceptanceContractDigest: 'contract-d1',
      predicateFamily: ACC.PredicateFamily.EXTERNAL_BEHAVIORAL_CASE, predicateVersion: 3,
      parametersDigest: 'v3:{"exit":0}', effectivePolicyRevision: 'policy-1',
      qualifiedProfileDigest: 'profile-q1', selectedSourceBaseline: 'commit-a',
      exactGenerationAndTreeDigest: 'gen-2/tree-2', // different generation
    });
    assert.strictEqual(EV.evidenceApplicable(ev, other).applicable, false);
  });

  group('evidence: §17 final coherence');

  t('a fully consistent state is coherent across all ten domains', () => {
    const r = EV.finalCoherence({
      inventory: [{ requirementId: 'R1' }],
      contract: 'contract-d1',
      policy: 'policy-1',
      profile: 'profile-q1',
      predicates: [{ predicateAdapterId: 'native-cli-observer', predicateVersion: 3 }],
      evidence: [fullEvidence()],
      sourceAndDependencyInputs: { selectedSourceBaseline: 'commit-a', actualSourceDependencyConfigurationEnvironmentInputs: 'node@26/root', runtimeToolchainAndLaunchIdentity: 'node-v26.x', discoverySelectionAndExecutionScope: 'full-native-suite' },
      actualDerivation: true,
      frozenGeneration: 'gen-1/tree-1',
      delivery: { deliveryId: 'del-1', frozenGenerationId: 'gen-1' },
    });
    assert.strictEqual(r.coherent, true, JSON.stringify(r.gaps));
  });

  t('an empty evidence set or empty inventory breaks coherence', () => {
    const base = {
      inventory: [{ requirementId: 'R1' }], contract: 'c', policy: 'p', profile: 'q',
      predicates: ['pd'], evidence: [fullEvidence()],
      sourceAndDependencyInputs: { selectedSourceBaseline: 'a', actualSourceDependencyConfigurationEnvironmentInputs: 'n', runtimeToolchainAndLaunchIdentity: 'r', discoverySelectionAndExecutionScope: 's' },
      actualDerivation: true, frozenGeneration: 'g', delivery: 'd',
    };
    assert.strictEqual(EV.finalCoherence({ ...base, evidence: [] }).coherent, false);
    assert.strictEqual(EV.finalCoherence({ ...base, inventory: [] }).coherent, false);
    assert.strictEqual(EV.finalCoherence({ ...base, actualDerivation: false }).coherent, false);
    assert.strictEqual(EV.finalCoherence({}).coherent, false);
  });

  t('input closure requires all four derivation-envelope keys', () => {
    const closed = EV.inputClosureState({ sourceAndDependencyInputs: { selectedSourceBaseline: 'a', actualSourceDependencyConfigurationEnvironmentInputs: 'b', runtimeToolchainAndLaunchIdentity: 'c', discoverySelectionAndExecutionScope: 'd' } });
    assert.strictEqual(closed.closed, true);
    const open = EV.inputClosureState({ sourceAndDependencyInputs: { selectedSourceBaseline: 'a' } });
    assert.strictEqual(open.closed, false);
    assert.ok(open.missing.length >= 3);
  });
};