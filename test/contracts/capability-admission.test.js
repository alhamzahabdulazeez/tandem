'use strict';
/**
 * Test suite for §29 Capability Admission Contract.
 *
 * Exercises:
 * - 14-field Proposal Lattice completeness, omissions, and corruption (fail closed)
 * - Deterministic proposal digests
 * - Prerequisite condition matrices for all 9 capability categories
 * - Live installation mutation boundary constraints and rejection of preflight-hash-only
 * - Prohibition of quiet task envelope widening on active tasks
 * - 3-pillar admission evaluation and invariant: listing does not admit
 * - Preservation of Gate 0 and authorityGranted: false
 */

const assert = require('node:assert');
const {
  CAPABILITY_PROPOSAL_FIELDS,
  CapabilityType,
  CapabilityAdmissionDecision,
  computeProposalDigest,
  validateCapabilityProposal,
  validateCapabilityPrerequisites,
  verifyLiveInstallationBoundary,
  checkEnvelopeWidening,
  evaluateCapabilityAdmission,
} = require('../../src/contracts/capability-admission.js');

function validProposal() {
  return {
    problem: 'Need bounded parallel inspection of independent sub-modules to reduce clock time',
    evidence_of_need: 'Observed 120s sequential overhead across 8 independent verification passes',
    why_existing_mechanisms_are_insufficient: 'Current single-process observer is strictly serial',
    smallest_capability_change: 'Add read-only parallel subagent spawning under aggregate budget',
    supported_scope: 'Direct-source JavaScript read-only verification passes only',
    authority_and_effect_changes: 'No new filesystem mutation; read-only child process dispatch',
    resource_and_disclosure_changes: 'Child processes share parent memory limit; aggregate timeout applies',
    new_failure_modes: 'Child process crash, timeout cascade, partial evidence collection',
    acceptance_tests: ['T-PARALLEL-01', 'T-PARALLEL-02'],
    qualification_changes: 'Requires concrete Linux cgroup / child pid containment qualification',
    measurable_value_hypothesis: 'Reduces verification clock time by >= 40% without increasing failure rate',
    ablation_protocol: 'Run identical test suites with parallel disabled and compare total metrics',
    compatibility_and_license_review_if_applicable: 'Uses standard Node.js child_process built-in APIs',
    removal_or_disable_plan: 'Feature flag disable falls back to single-threaded sequential observer',
  };
}

function run(t, group) {
  group('§29 Capability Proposal Lattice (14 mandatory fields)');

  t('valid 14-field proposal passes validation', () => {
    const p = validProposal();
    const res = validateCapabilityProposal(p);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.errors.length, 0);
    assert.strictEqual(res.missingFields.length, 0);
  });

  t('deterministic proposal digest computation', () => {
    const p1 = validProposal();
    const p2 = validProposal();
    const d1 = computeProposalDigest(p1);
    const d2 = computeProposalDigest(p2);
    assert.strictEqual(typeof d1, 'string');
    assert.strictEqual(d1.length, 64);
    assert.strictEqual(d1, d2);

    // Mutating a field changes digest
    p2.problem = 'Different problem statement';
    assert.notStrictEqual(computeProposalDigest(p1), computeProposalDigest(p2));
  });

  t('non-object / null / array proposals fail closed', () => {
    assert.strictEqual(validateCapabilityProposal(null).valid, false);
    assert.strictEqual(validateCapabilityProposal(undefined).valid, false);
    assert.strictEqual(validateCapabilityProposal('string').valid, false);
    assert.strictEqual(validateCapabilityProposal(123).valid, false);
    assert.strictEqual(validateCapabilityProposal([]).valid, false);
  });

  // Test individual omission for each of the 14 required fields
  for (const field of CAPABILITY_PROPOSAL_FIELDS) {
    t(`omission of field "${field}" fails closed`, () => {
      const p = validProposal();
      delete p[field];
      const res = validateCapabilityProposal(p);
      assert.strictEqual(res.valid, false);
      assert.ok(res.missingFields.includes(field));
      assert.ok(res.errors.some((e) => e.includes(field)));
    });

    t(`empty/whitespace string for field "${field}" fails closed`, () => {
      const p = validProposal();
      p[field] = '   \t\n  ';
      const res = validateCapabilityProposal(p);
      assert.strictEqual(res.valid, false);
      assert.ok(res.missingFields.includes(field));
    });
  }

  t('empty array or empty object fields fail closed', () => {
    const p = validProposal();
    p.acceptance_tests = [];
    assert.strictEqual(validateCapabilityProposal(p).valid, false);

    const p2 = validProposal();
    p2.supported_scope = {};
    assert.strictEqual(validateCapabilityProposal(p2).valid, false);
  });

  group('§29 Prerequisite Matrices (9 Capability Categories)');

  t('ADDITIONAL_AGENTS_PROVIDERS: brand-name inheritance rejected; separate qualification required', () => {
    const badEvidence = {
      hasSeparateProfileQualification: false,
      reliesOnBrandNameGuarantee: true,
    };
    const res = validateCapabilityPrerequisites(CapabilityType.ADDITIONAL_AGENTS_PROVIDERS, badEvidence);
    assert.strictEqual(res.satisfied, false);
    assert.ok(res.reasons.some((r) => r.includes('brand name')));
    assert.ok(res.reasons.some((r) => r.includes('separate concrete profile qualification')));

    const goodEvidence = {
      hasSeparateProfileQualification: true,
      reliesOnBrandNameGuarantee: false,
    };
    const goodRes = validateCapabilityPrerequisites(CapabilityType.ADDITIONAL_AGENTS_PROVIDERS, goodEvidence);
    assert.strictEqual(goodRes.satisfied, true);
  });

  t('PARALLEL_MULTI_AGENT: uncontrolled nested delegation rejected; aggregate budget required', () => {
    const badEvidence = {
      hasPerChildScope: true,
      hasCurrentAuthority: true,
      hasAggregateBudget: false, // missing
      hasEvidenceOwnership: true,
      hasCancellationProtocol: true,
      uncontrolledNestedDelegationProhibited: false, // bad
    };
    const res = validateCapabilityPrerequisites(CapabilityType.PARALLEL_MULTI_AGENT, badEvidence);
    assert.strictEqual(res.satisfied, false);
    assert.ok(res.reasons.some((r) => r.includes('aggregate budget')));
    assert.ok(res.reasons.some((r) => r.includes('nested delegation')));

    const goodEvidence = {
      hasPerChildScope: true,
      hasCurrentAuthority: true,
      hasAggregateBudget: true,
      hasEvidenceOwnership: true,
      hasCancellationProtocol: true,
      uncontrolledNestedDelegationProhibited: true,
    };
    assert.strictEqual(validateCapabilityPrerequisites(CapabilityType.PARALLEL_MULTI_AGENT, goodEvidence).satisfied, true);
  });

  t('MCP_EXTERNAL_TOOLS: incomplete disclosure/effect closure and unqualified credentials rejected', () => {
    const badEvidence = {
      hasEffectAndDisclosureClosure: false,
      hasReplayAndUnknownOutcomeSemantics: true,
      hasQualifiedCredentials: false,
      hasQualifiedDestinations: true,
    };
    const res = validateCapabilityPrerequisites(CapabilityType.MCP_EXTERNAL_TOOLS, badEvidence);
    assert.strictEqual(res.satisfied, false);
    assert.ok(res.reasons.some((r) => r.includes('effect and disclosure closure')));
    assert.ok(res.reasons.some((r) => r.includes('qualified credentials')));

    const goodEvidence = {
      hasEffectAndDisclosureClosure: true,
      hasReplayAndUnknownOutcomeSemantics: true,
      hasQualifiedCredentials: true,
      hasQualifiedDestinations: true,
    };
    assert.strictEqual(validateCapabilityPrerequisites(CapabilityType.MCP_EXTERNAL_TOOLS, goodEvidence).satisfied, true);
  });

  t('PROVIDER_ROUTING: permission widening and unkept liabilities rejected', () => {
    const badEvidence = {
      preservesOrNarrowsPermissions: false,
      retainsLiabilitiesAcrossFailure: false,
    };
    const res = validateCapabilityPrerequisites(CapabilityType.PROVIDER_ROUTING, badEvidence);
    assert.strictEqual(res.satisfied, false);
    assert.ok(res.reasons.some((r) => r.includes('preserve or narrow')));
    assert.ok(res.reasons.some((r) => r.includes('retain liabilities')));

    const goodEvidence = {
      preservesOrNarrowsPermissions: true,
      retainsLiabilitiesAcrossFailure: true,
    };
    assert.strictEqual(validateCapabilityPrerequisites(CapabilityType.PROVIDER_ROUTING, goodEvidence).satisfied, true);
  });

  t('BROADER_BUILDS_CACHES: missing artifact derivation or input identity rejected', () => {
    const badEvidence = {
      hasActualArtifactDerivation: false,
      hasFullRelevantInputIdentity: true,
      hasQualifiedResolution: false,
      hasCacheValidityProtocol: true,
    };
    const res = validateCapabilityPrerequisites(CapabilityType.BROADER_BUILDS_CACHES, badEvidence);
    assert.strictEqual(res.satisfied, false);
    assert.ok(res.reasons.some((r) => r.includes('actual artifact derivation')));
    assert.ok(res.reasons.some((r) => r.includes('qualified resolution')));

    const goodEvidence = {
      hasActualArtifactDerivation: true,
      hasFullRelevantInputIdentity: true,
      hasQualifiedResolution: true,
      hasCacheValidityProtocol: true,
    };
    assert.strictEqual(validateCapabilityPrerequisites(CapabilityType.BROADER_BUILDS_CACHES, goodEvidence).satisfied, true);
  });

  t('MUTATION_SIMPLIFICATION: unpreserved accepted bytes or missing fresh verification rejected', () => {
    const badEvidence = {
      usesNewDisposableCandidate: true,
      preservesAcceptedBytes: false,
      hasFreshAuthority: true,
      hasFreshVerification: false,
    };
    const res = validateCapabilityPrerequisites(CapabilityType.MUTATION_SIMPLIFICATION, badEvidence);
    assert.strictEqual(res.satisfied, false);
    assert.ok(res.reasons.some((r) => r.includes('preserve accepted candidate bytes')));
    assert.ok(res.reasons.some((r) => r.includes('fresh verification')));

    const goodEvidence = {
      usesNewDisposableCandidate: true,
      preservesAcceptedBytes: true,
      hasFreshAuthority: true,
      hasFreshVerification: true,
    };
    assert.strictEqual(validateCapabilityPrerequisites(CapabilityType.MUTATION_SIMPLIFICATION, goodEvidence).satisfied, true);
  });

  t('LIVE_INSTALLATION_ROLLBACK: preflight-hash-only rejected; conditional writer required', () => {
    const badEvidence = {
      hasDurablePrepareBeforeEffect: true,
      hasRetainedRestorationBytes: true,
      hasExplicitCommitPoint: true,
      preservesUntouchedIndexWorktreeUntrackedIgnored: true,
      hasOwnershipSafeRestoration: true,
      hasCrashSafeIdempotentReconciliation: true,
      enforcesExpectedCurrentStateAtBoundary: true,
      preflightHashOnly: true, // Prohibited
    };
    const res = validateCapabilityPrerequisites(CapabilityType.LIVE_INSTALLATION_ROLLBACK, badEvidence);
    assert.strictEqual(res.satisfied, false);
    assert.ok(res.reasons.some((r) => r.includes('preflight hash')));

    const goodEvidence = {
      hasDurablePrepareBeforeEffect: true,
      hasRetainedRestorationBytes: true,
      hasExplicitCommitPoint: true,
      preservesUntouchedIndexWorktreeUntrackedIgnored: true,
      hasOwnershipSafeRestoration: true,
      hasCrashSafeIdempotentReconciliation: true,
      enforcesExpectedCurrentStateAtBoundary: true,
      preflightHashOnly: false,
    };
    assert.strictEqual(validateCapabilityPrerequisites(CapabilityType.LIVE_INSTALLATION_ROLLBACK, goodEvidence).satisfied, true);
  });

  t('EXTERNAL_IRREVERSIBLE_EFFECTS: missing payload authority or unproven recovery rejected', () => {
    const badEvidence = {
      hasExplicitOperationAuthority: true,
      hasExplicitCredentialAuthority: true,
      hasExplicitDestinationAuthority: true,
      hasExplicitPayloadAuthority: false,
      hasReplaySemantics: true,
      hasUnknownOutcomeHandling: true,
      hasProvenReconciliationRecovery: false,
    };
    const res = validateCapabilityPrerequisites(CapabilityType.EXTERNAL_IRREVERSIBLE_EFFECTS, badEvidence);
    assert.strictEqual(res.satisfied, false);
    assert.ok(res.reasons.some((r) => r.includes('payload authority')));
    assert.ok(res.reasons.some((r) => r.includes('reconciliation and recovery')));

    const goodEvidence = {
      hasExplicitOperationAuthority: true,
      hasExplicitCredentialAuthority: true,
      hasExplicitDestinationAuthority: true,
      hasExplicitPayloadAuthority: true,
      hasReplaySemantics: true,
      hasUnknownOutcomeHandling: true,
      hasProvenReconciliationRecovery: true,
    };
    assert.strictEqual(validateCapabilityPrerequisites(CapabilityType.EXTERNAL_IRREVERSIBLE_EFFECTS, goodEvidence).satisfied, true);
  });

  t('DISTRIBUTED_PERSISTENT_EXECUTION: missing failure/ownership contracts rejected', () => {
    const badEvidence = {
      hasSeparateJustification: true,
      hasCompleteAuthorityContract: true,
      hasCompleteOwnershipContract: false,
      hasCompleteResourceContract: true,
      hasCompleteFailureContract: false,
    };
    const res = validateCapabilityPrerequisites(CapabilityType.DISTRIBUTED_PERSISTENT_EXECUTION, badEvidence);
    assert.strictEqual(res.satisfied, false);
    assert.ok(res.reasons.some((r) => r.includes('ownership contract')));
    assert.ok(res.reasons.some((r) => r.includes('failure contract')));

    const goodEvidence = {
      hasSeparateJustification: true,
      hasCompleteAuthorityContract: true,
      hasCompleteOwnershipContract: true,
      hasCompleteResourceContract: true,
      hasCompleteFailureContract: true,
    };
    assert.strictEqual(validateCapabilityPrerequisites(CapabilityType.DISTRIBUTED_PERSISTENT_EXECUTION, goodEvidence).satisfied, true);
  });

  t('unknown capability type fails closed', () => {
    const res = validateCapabilityPrerequisites('UNKNOWN_CUSTOM_CAPABILITY', {});
    assert.strictEqual(res.satisfied, false);
    assert.ok(res.reasons.some((r) => r.includes('unknown or unrecognised')));
  });

  group('§29 Live Installation Mutation Boundary Verification');

  t('preflight hash check followed by replacement is rejected', () => {
    const spec = {
      preflightHashOnly: true,
      enforcesConcurrentWriterAtBoundary: true,
      enforcesExpectedCurrentState: true,
    };
    const res = verifyLiveInstallationBoundary(spec);
    assert.strictEqual(res.allowed, false);
    assert.ok(res.reason.includes('preflight hash check followed by replacement is insufficient'));
  });

  t('missing concurrent-writer or expected-current-state protection at boundary is rejected', () => {
    assert.strictEqual(
      verifyLiveInstallationBoundary({ enforcesConcurrentWriterAtBoundary: false, enforcesExpectedCurrentState: true }).allowed,
      false,
    );
    assert.strictEqual(
      verifyLiveInstallationBoundary({ enforcesConcurrentWriterAtBoundary: true, enforcesExpectedCurrentState: false }).allowed,
      false,
    );
  });

  t('unattended installation without enforceable conditional writer model is rejected', () => {
    const spec = {
      enforcesConcurrentWriterAtBoundary: true,
      enforcesExpectedCurrentState: true,
      unattended: true,
      hasConditionalWriterModel: false,
    };
    const res = verifyLiveInstallationBoundary(spec);
    assert.strictEqual(res.allowed, false);
    assert.ok(res.reason.includes('unattended installation is refused'));
  });

  t('concurrent changes require: no install, retained candidate, authenticated user decision', () => {
    const badConflictSpec = {
      enforcesConcurrentWriterAtBoundary: true,
      enforcesExpectedCurrentState: true,
      concurrentConflictDetected: true,
      installAttempted: true, // Bad: attempted install despite conflict
      candidateRetained: true,
      authenticatedUserDecisionRequired: true,
    };
    assert.strictEqual(verifyLiveInstallationBoundary(badConflictSpec).allowed, false);

    const goodConflictSpec = {
      enforcesConcurrentWriterAtBoundary: true,
      enforcesExpectedCurrentState: true,
      concurrentConflictDetected: true,
      installAttempted: false,
      candidateRetained: true,
      authenticatedUserDecisionRequired: true,
    };
    assert.strictEqual(verifyLiveInstallationBoundary(goodConflictSpec).allowed, true);
  });

  t('Git rollback is NOT remote compensation', () => {
    const spec = {
      enforcesConcurrentWriterAtBoundary: true,
      enforcesExpectedCurrentState: true,
      usesGitRollbackAsRemoteCompensation: true,
    };
    const res = verifyLiveInstallationBoundary(spec);
    assert.strictEqual(res.allowed, false);
    assert.ok(res.reason.includes('Git rollback is not remote compensation'));
  });

  group('§29 Envelope Widening Protection');

  t('quiet tool widening on active live task is rejected', () => {
    const active = { isLive: true, tools: ['read', 'test'] };
    const proposed = { tools: ['read', 'test', 'write_unrestricted'] };
    const res = checkEnvelopeWidening(active, proposed);
    assert.strictEqual(res.allowed, false);
    assert.strictEqual(res.widened, true);
    assert.ok(res.reason.includes('proposed tool "write_unrestricted" widens active task envelope'));
  });

  t('quiet scope widening on active live task is rejected', () => {
    const active = { isLive: true, scopes: ['src/'] };
    const proposed = { scopes: ['src/', '.git/'] };
    const res = checkEnvelopeWidening(active, proposed);
    assert.strictEqual(res.allowed, false);
    assert.strictEqual(res.widened, true);
  });

  t('resource ceiling expansion on active live task is rejected', () => {
    const active = { isLive: true, resourceCeilings: { cpuTimeMs: 10000 } };
    const proposed = { resourceCeilings: { cpuTimeMs: 50000 } };
    const res = checkEnvelopeWidening(active, proposed);
    assert.strictEqual(res.allowed, false);
    assert.strictEqual(res.widened, true);
  });

  t('non-live task allows new envelope', () => {
    const active = { isLive: false, tools: ['read'] };
    const proposed = { tools: ['read', 'write'] };
    const res = checkEnvelopeWidening(active, proposed);
    assert.strictEqual(res.allowed, true);
    assert.strictEqual(res.widened, false);
  });

  group('§29 Admission Evaluation (The 3 Pillars & Listing Non-Admission)');

  t('listing a capability does NOT admit it (empty/unauthenticated context)', () => {
    const p = validProposal();
    const res = evaluateCapabilityAdmission(p, {});
    assert.strictEqual(res.admitted, false);
    assert.strictEqual(res.decision, CapabilityAdmissionDecision.REFUSED);
    assert.ok(res.reasons.some((r) => r.includes('listing a capability does not admit it')));
  });

  t('missing explicit authority (authorityGranted: false) fails closed / BLOCKED', () => {
    const p = validProposal();
    const context = {
      authority: { authenticated: true, explicitApproval: false, authorityGranted: false },
      qualification: { isQualified: true, affectedSafetyQualified: true },
      valueEvidence: { valueEstablished: true, evidenceOfValue: true },
    };
    const res = evaluateCapabilityAdmission(p, context);
    assert.strictEqual(res.admitted, false);
    assert.strictEqual(res.decision, CapabilityAdmissionDecision.BLOCKED);
    assert.ok(res.reasons.some((r) => r.includes('authorityGranted must be true')));
  });

  t('missing safety qualification fails closed / BLOCKED', () => {
    const p = validProposal();
    const context = {
      authority: { authenticated: true, explicitApproval: true, authorityGranted: true },
      qualification: { isQualified: false, affectedSafetyQualified: false },
      valueEvidence: { valueEstablished: true, evidenceOfValue: true },
    };
    const res = evaluateCapabilityAdmission(p, context);
    assert.strictEqual(res.admitted, false);
    assert.strictEqual(res.decision, CapabilityAdmissionDecision.BLOCKED);
    assert.ok(res.reasons.some((r) => r.includes('lacks affected safety qualification')));
  });

  t('missing evidence of value fails closed / REFUSED', () => {
    const p = validProposal();
    const context = {
      authority: { authenticated: true, explicitApproval: true, authorityGranted: true },
      qualification: { isQualified: true, affectedSafetyQualified: true },
      valueEvidence: { valueEstablished: false, evidenceOfValue: false },
    };
    const res = evaluateCapabilityAdmission(p, context);
    assert.strictEqual(res.admitted, false);
    assert.ok(res.reasons.some((r) => r.includes('lacks empirical evidence of value')));
  });

  t('all 3 pillars satisfied + valid proposal + satisfied prerequisites = ADMITTED', () => {
    const p = validProposal();
    const context = {
      capabilityType: CapabilityType.PARALLEL_MULTI_AGENT,
      prerequisiteEvidence: {
        hasPerChildScope: true,
        hasCurrentAuthority: true,
        hasAggregateBudget: true,
        hasEvidenceOwnership: true,
        hasCancellationProtocol: true,
        uncontrolledNestedDelegationProhibited: true,
      },
      authority: { authenticated: true, explicitApproval: true, authorityGranted: true },
      qualification: { isQualified: true, affectedSafetyQualified: true },
      valueEvidence: { valueEstablished: true, evidenceOfValue: true },
    };
    const res = evaluateCapabilityAdmission(p, context);
    assert.strictEqual(res.admitted, true);
    assert.strictEqual(res.decision, CapabilityAdmissionDecision.ADMITTED);
    assert.strictEqual(res.reasons.length, 0);
  });
}

module.exports = run;
