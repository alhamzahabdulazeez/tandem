'use strict';
/**
 * capability-admission — §29 Capability Admission Contract.
 *
 * Implements the normative 14-field Capability Proposal & Admission Lattice,
 * prerequisite condition matrices for post-MVP / advanced capabilities,
 * live installation mutation boundary constraints, and envelope widening protection.
 *
 * Fundamental Invariants (§29):
 * 1. POST-MVP capabilities are not implementation backlog commitments for V1.
 * 2. Every proposed capability MUST state all 14 required proposal fields.
 * 3. Listing a capability does NOT admit it.
 * 4. Admission requires explicit authority, affected safety qualification, and evidence of value.
 * 5. No capability may be enabled by quietly widening an existing live task envelope.
 * 6. Live installation MUST enforce expected-current-state and concurrent-writer protection
 *    at the mutation boundary itself. A preflight hash followed by replacement is insufficient.
 * 7. If an enforceable conditional writer model is unavailable, unattended installation remains refused.
 * 8. Git rollback is not remote compensation.
 *
 * PRD reference: §29.
 */

const { canonicalJson, sha256 } = require('./crypto.js');

// ---------------------------------------------------------------------------
// 14-field Proposal Lattice Constants
// ---------------------------------------------------------------------------

const CAPABILITY_PROPOSAL_FIELDS = Object.freeze([
  'problem',
  'evidence_of_need',
  'why_existing_mechanisms_are_insufficient',
  'smallest_capability_change',
  'supported_scope',
  'authority_and_effect_changes',
  'resource_and_disclosure_changes',
  'new_failure_modes',
  'acceptance_tests',
  'qualification_changes',
  'measurable_value_hypothesis',
  'ablation_protocol',
  'compatibility_and_license_review_if_applicable',
  'removal_or_disable_plan',
]);

const PROPOSAL_FIELD_SET = new Set(CAPABILITY_PROPOSAL_FIELDS);

// ---------------------------------------------------------------------------
// 9 Capability Prerequisite Categories
// ---------------------------------------------------------------------------

const CapabilityType = Object.freeze({
  ADDITIONAL_AGENTS_PROVIDERS: 'ADDITIONAL_AGENTS_PROVIDERS',
  PARALLEL_MULTI_AGENT: 'PARALLEL_MULTI_AGENT',
  MCP_EXTERNAL_TOOLS: 'MCP_EXTERNAL_TOOLS',
  PROVIDER_ROUTING: 'PROVIDER_ROUTING',
  BROADER_BUILDS_CACHES: 'BROADER_BUILDS_CACHES',
  MUTATION_SIMPLIFICATION: 'MUTATION_SIMPLIFICATION',
  LIVE_INSTALLATION_ROLLBACK: 'LIVE_INSTALLATION_ROLLBACK',
  EXTERNAL_IRREVERSIBLE_EFFECTS: 'EXTERNAL_IRREVERSIBLE_EFFECTS',
  DISTRIBUTED_PERSISTENT_EXECUTION: 'DISTRIBUTED_PERSISTENT_EXECUTION',
});

const VALID_CAPABILITY_TYPES = new Set(Object.values(CapabilityType));

// ---------------------------------------------------------------------------
// Admission Decisions
// ---------------------------------------------------------------------------

const CapabilityAdmissionDecision = Object.freeze({
  ADMITTED: 'ADMITTED',
  REFUSED: 'REFUSED',
  BLOCKED: 'BLOCKED',
});

// ---------------------------------------------------------------------------
// Proposal Validation & Digest
// ---------------------------------------------------------------------------

/**
 * Compute the deterministic cryptographic digest of a 14-field capability proposal.
 *
 * @param {object} proposal
 * @returns {string} sha256 hex digest of canonical JSON representation
 */
function computeProposalDigest(proposal) {
  if (!proposal || typeof proposal !== 'object') {
    throw new Error('computeProposalDigest: proposal must be an object');
  }
  const canonical = {};
  for (const field of CAPABILITY_PROPOSAL_FIELDS) {
    canonical[field] = proposal[field] != null ? proposal[field] : null;
  }
  return sha256(canonicalJson(canonical));
}

/**
 * Validate that a proposed capability record contains all 14 mandatory fields
 * with non-empty content (strings or arrays with content).
 *
 * Fails closed on any missing, null, undefined, whitespace-only, or empty fields.
 *
 * @param {object} proposal
 * @returns {{ valid: boolean, errors: string[], missingFields: string[] }}
 */
function validateCapabilityProposal(proposal) {
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) {
    return {
      valid: false,
      errors: ['proposal must be a non-null object'],
      missingFields: [...CAPABILITY_PROPOSAL_FIELDS],
    };
  }

  const missingFields = [];
  const errors = [];

  for (const field of CAPABILITY_PROPOSAL_FIELDS) {
    if (!(field in proposal) || proposal[field] == null) {
      missingFields.push(field);
      errors.push(`missing mandatory field "${field}"`);
      continue;
    }

    const val = proposal[field];
    if (typeof val === 'string') {
      if (val.trim().length === 0) {
        missingFields.push(field);
        errors.push(`field "${field}" must not be empty or whitespace-only`);
      }
    } else if (Array.isArray(val)) {
      if (val.length === 0) {
        missingFields.push(field);
        errors.push(`field "${field}" must not be an empty array`);
      }
    } else if (typeof val === 'object') {
      if (Object.keys(val).length === 0) {
        missingFields.push(field);
        errors.push(`field "${field}" must not be an empty object`);
      }
    } else {
      missingFields.push(field);
      errors.push(`field "${field}" has invalid type "${typeof val}"`);
    }
  }

  return {
    valid: missingFields.length === 0 && errors.length === 0,
    errors,
    missingFields,
  };
}

// ---------------------------------------------------------------------------
// Prerequisite Matrix Validation (9 Categories)
// ---------------------------------------------------------------------------

/**
 * Validate category-specific prerequisites for one of the 9 §29 capability types.
 *
 * @param {string} capabilityType
 * @param {object} evidence
 * @returns {{ satisfied: boolean, missingPrerequisites: string[], reasons: string[] }}
 */
function validateCapabilityPrerequisites(capabilityType, evidence) {
  if (!VALID_CAPABILITY_TYPES.has(capabilityType)) {
    return {
      satisfied: false,
      missingPrerequisites: ['VALID_CAPABILITY_TYPE'],
      reasons: [`unknown or unrecognised capabilityType "${capabilityType}"`],
    };
  }

  const ev = evidence && typeof evidence === 'object' ? evidence : {};
  const missingPrerequisites = [];
  const reasons = [];

  switch (capabilityType) {
    case CapabilityType.ADDITIONAL_AGENTS_PROVIDERS: {
      if (ev.hasSeparateProfileQualification !== true) {
        missingPrerequisites.push('hasSeparateProfileQualification');
        reasons.push('requires separate concrete profile qualification');
      }
      if (ev.reliesOnBrandNameGuarantee === true) {
        missingPrerequisites.push('noInheritedBrandNameGuarantee');
        reasons.push('no inherited guarantee from a brand name is permitted');
      }
      break;
    }

    case CapabilityType.PARALLEL_MULTI_AGENT: {
      if (ev.hasPerChildScope !== true) {
        missingPrerequisites.push('hasPerChildScope');
        reasons.push('requires per-child scope specification');
      }
      if (ev.hasCurrentAuthority !== true) {
        missingPrerequisites.push('hasCurrentAuthority');
        reasons.push('requires explicit current authority for all child agents');
      }
      if (ev.hasAggregateBudget !== true) {
        missingPrerequisites.push('hasAggregateBudget');
        reasons.push('requires aggregate budget bounding all child executions');
      }
      if (ev.hasEvidenceOwnership !== true) {
        missingPrerequisites.push('hasEvidenceOwnership');
        reasons.push('requires evidence ownership tracking across child executions');
      }
      if (ev.hasCancellationProtocol !== true) {
        missingPrerequisites.push('hasCancellationProtocol');
        reasons.push('requires explicit cancellation and quiescence protocol');
      }
      if (ev.uncontrolledNestedDelegationProhibited !== true) {
        missingPrerequisites.push('uncontrolledNestedDelegationProhibited');
        reasons.push('uncontrolled nested delegation must be strictly prohibited');
      }
      break;
    }

    case CapabilityType.MCP_EXTERNAL_TOOLS: {
      if (ev.hasEffectAndDisclosureClosure !== true) {
        missingPrerequisites.push('hasEffectAndDisclosureClosure');
        reasons.push('requires complete effect and disclosure closure');
      }
      if (ev.hasReplayAndUnknownOutcomeSemantics !== true) {
        missingPrerequisites.push('hasReplayAndUnknownOutcomeSemantics');
        reasons.push('requires replay and unknown-outcome semantics');
      }
      if (ev.hasQualifiedCredentials !== true) {
        missingPrerequisites.push('hasQualifiedCredentials');
        reasons.push('requires qualified credentials specification');
      }
      if (ev.hasQualifiedDestinations !== true) {
        missingPrerequisites.push('hasQualifiedDestinations');
        reasons.push('requires qualified network/host destinations');
      }
      break;
    }

    case CapabilityType.PROVIDER_ROUTING: {
      if (ev.preservesOrNarrowsPermissions !== true) {
        missingPrerequisites.push('preservesOrNarrowsPermissions');
        reasons.push('must preserve or narrow recipient and payload permissions');
      }
      if (ev.retainsLiabilitiesAcrossFailure !== true) {
        missingPrerequisites.push('retainsLiabilitiesAcrossFailure');
        reasons.push('must retain liabilities across failure');
      }
      break;
    }

    case CapabilityType.BROADER_BUILDS_CACHES: {
      if (ev.hasActualArtifactDerivation !== true) {
        missingPrerequisites.push('hasActualArtifactDerivation');
        reasons.push('requires actual artifact derivation proof');
      }
      if (ev.hasFullRelevantInputIdentity !== true) {
        missingPrerequisites.push('hasFullRelevantInputIdentity');
        reasons.push('requires full relevant input identity binding');
      }
      if (ev.hasQualifiedResolution !== true) {
        missingPrerequisites.push('hasQualifiedResolution');
        reasons.push('requires qualified resolution mechanism');
      }
      if (ev.hasCacheValidityProtocol !== true) {
        missingPrerequisites.push('hasCacheValidityProtocol');
        reasons.push('requires qualified cache validity protocol');
      }
      break;
    }

    case CapabilityType.MUTATION_SIMPLIFICATION: {
      if (ev.usesNewDisposableCandidate !== true) {
        missingPrerequisites.push('usesNewDisposableCandidate');
        reasons.push('must create a new disposable candidate');
      }
      if (ev.preservesAcceptedBytes !== true) {
        missingPrerequisites.push('preservesAcceptedBytes');
        reasons.push('must preserve accepted candidate bytes');
      }
      if (ev.hasFreshAuthority !== true) {
        missingPrerequisites.push('hasFreshAuthority');
        reasons.push('requires fresh authority for simplification mutations');
      }
      if (ev.hasFreshVerification !== true) {
        missingPrerequisites.push('hasFreshVerification');
        reasons.push('requires fresh verification for simplification outputs');
      }
      break;
    }

    case CapabilityType.LIVE_INSTALLATION_ROLLBACK: {
      if (ev.hasDurablePrepareBeforeEffect !== true) {
        missingPrerequisites.push('hasDurablePrepareBeforeEffect');
        reasons.push('requires durable prepare-before-effect ordering');
      }
      if (ev.hasRetainedRestorationBytes !== true) {
        missingPrerequisites.push('hasRetainedRestorationBytes');
        reasons.push('requires retained restoration bytes');
      }
      if (ev.hasExplicitCommitPoint !== true) {
        missingPrerequisites.push('hasExplicitCommitPoint');
        reasons.push('requires explicit commit point');
      }
      if (ev.preservesUntouchedIndexWorktreeUntrackedIgnored !== true) {
        missingPrerequisites.push('preservesUntouchedIndexWorktreeUntrackedIgnored');
        reasons.push('must preserve index, worktree, untracked, and ignored files where touched');
      }
      if (ev.hasOwnershipSafeRestoration !== true) {
        missingPrerequisites.push('hasOwnershipSafeRestoration');
        reasons.push('requires ownership-safe restoration');
      }
      if (ev.hasCrashSafeIdempotentReconciliation !== true) {
        missingPrerequisites.push('hasCrashSafeIdempotentReconciliation');
        reasons.push('requires crash-safe idempotent reconciliation');
      }
      if (ev.enforcesExpectedCurrentStateAtBoundary !== true) {
        missingPrerequisites.push('enforcesExpectedCurrentStateAtBoundary');
        reasons.push('must enforce expected-current-state and concurrent-writer protection at the mutation boundary itself');
      }
      if (ev.preflightHashOnly === true) {
        missingPrerequisites.push('preflightHashOnlyProhibited');
        reasons.push('preflight hash followed by replacement is insufficient; conditional writer protection required');
      }
      break;
    }

    case CapabilityType.EXTERNAL_IRREVERSIBLE_EFFECTS: {
      if (ev.hasExplicitOperationAuthority !== true) {
        missingPrerequisites.push('hasExplicitOperationAuthority');
        reasons.push('requires explicit operation authority');
      }
      if (ev.hasExplicitCredentialAuthority !== true) {
        missingPrerequisites.push('hasExplicitCredentialAuthority');
        reasons.push('requires explicit credential authority');
      }
      if (ev.hasExplicitDestinationAuthority !== true) {
        missingPrerequisites.push('hasExplicitDestinationAuthority');
        reasons.push('requires explicit destination authority');
      }
      if (ev.hasExplicitPayloadAuthority !== true) {
        missingPrerequisites.push('hasExplicitPayloadAuthority');
        reasons.push('requires explicit payload authority');
      }
      if (ev.hasReplaySemantics !== true) {
        missingPrerequisites.push('hasReplaySemantics');
        reasons.push('requires explicit replay semantics');
      }
      if (ev.hasUnknownOutcomeHandling !== true) {
        missingPrerequisites.push('hasUnknownOutcomeHandling');
        reasons.push('requires unknown-outcome handling');
      }
      if (ev.hasProvenReconciliationRecovery !== true) {
        missingPrerequisites.push('hasProvenReconciliationRecovery');
        reasons.push('requires proven reconciliation and recovery mechanism');
      }
      break;
    }

    case CapabilityType.DISTRIBUTED_PERSISTENT_EXECUTION: {
      if (ev.hasSeparateJustification !== true) {
        missingPrerequisites.push('hasSeparateJustification');
        reasons.push('requires separate justification');
      }
      if (ev.hasCompleteAuthorityContract !== true) {
        missingPrerequisites.push('hasCompleteAuthorityContract');
        reasons.push('requires complete authority contract');
      }
      if (ev.hasCompleteOwnershipContract !== true) {
        missingPrerequisites.push('hasCompleteOwnershipContract');
        reasons.push('requires complete ownership contract');
      }
      if (ev.hasCompleteResourceContract !== true) {
        missingPrerequisites.push('hasCompleteResourceContract');
        reasons.push('requires complete resource contract');
      }
      if (ev.hasCompleteFailureContract !== true) {
        missingPrerequisites.push('hasCompleteFailureContract');
        reasons.push('requires complete failure contract');
      }
      break;
    }
  }

  return {
    satisfied: missingPrerequisites.length === 0,
    missingPrerequisites,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Live Installation Mutation Boundary Verification
// ---------------------------------------------------------------------------

/**
 * Verify live installation specification against §29 boundary invariants.
 *
 * Rules (fail-closed):
 * 1. Preflight hash alone followed by replacement is insufficient and REFUSED.
 * 2. Expected-current-state and concurrent-writer protection at the mutation boundary itself are mandatory.
 * 3. If an enforceable conditional writer model is unavailable, unattended installation remains REFUSED.
 * 4. Concurrent changes require: no install, retained candidate, and an authenticated user decision.
 * 5. Git rollback is NOT remote compensation and cannot replace proven reconciliation.
 *
 * @param {object} spec
 * @returns {{ allowed: boolean, reason: string|null }}
 */
function verifyLiveInstallationBoundary(spec) {
  if (!spec || typeof spec !== 'object') {
    return { allowed: false, reason: 'installation specification must be an object' };
  }

  if (spec.preflightHashOnly === true) {
    return {
      allowed: false,
      reason: 'preflight hash check followed by replacement is insufficient; must enforce concurrent-writer protection at mutation boundary',
    };
  }

  if (spec.enforcesConcurrentWriterAtBoundary !== true) {
    return {
      allowed: false,
      reason: 'concurrent-writer protection at the mutation boundary itself is mandatory',
    };
  }

  if (spec.enforcesExpectedCurrentState !== true) {
    return {
      allowed: false,
      reason: 'expected-current-state check at the mutation boundary itself is mandatory',
    };
  }

  // Unattended installation rule
  if (spec.unattended === true && spec.hasConditionalWriterModel !== true) {
    return {
      allowed: false,
      reason: 'unattended installation is refused when an enforceable conditional writer model is unavailable',
    };
  }

  // Concurrent changes handling rule
  if (spec.concurrentConflictDetected === true) {
    if (
      spec.installAttempted === true ||
      spec.candidateRetained !== true ||
      spec.authenticatedUserDecisionRequired !== true
    ) {
      return {
        allowed: false,
        reason: 'concurrent changes require: no install, retained candidate, and an authenticated user decision',
      };
    }
  }

  // Git rollback compensation rule
  if (spec.usesGitRollbackAsRemoteCompensation === true) {
    return {
      allowed: false,
      reason: 'Git rollback is not remote compensation',
    };
  }

  return { allowed: true, reason: null };
}

// ---------------------------------------------------------------------------
// Envelope Widening Protection
// ---------------------------------------------------------------------------

/**
 * Verify that a proposed envelope does not quietly widen an active live task envelope (§29).
 *
 * @param {object} activeTaskEnvelope
 * @param {object} proposedEnvelope
 * @returns {{ allowed: boolean, widened: boolean, reason: string|null }}
 */
function checkEnvelopeWidening(activeTaskEnvelope, proposedEnvelope) {
  if (!activeTaskEnvelope || typeof activeTaskEnvelope !== 'object') {
    return { allowed: false, widened: false, reason: 'activeTaskEnvelope must be an object' };
  }
  if (!proposedEnvelope || typeof proposedEnvelope !== 'object') {
    return { allowed: false, widened: false, reason: 'proposedEnvelope must be an object' };
  }

  // If task is not live, envelope check passes
  if (activeTaskEnvelope.isLive !== true) {
    return { allowed: true, widened: false, reason: null };
  }

  const widenedReasons = [];

  // Check tool widening
  if (proposedEnvelope.tools && activeTaskEnvelope.tools) {
    const activeTools = new Set(activeTaskEnvelope.tools);
    for (const t of proposedEnvelope.tools) {
      if (!activeTools.has(t)) {
        widenedReasons.push(`proposed tool "${t}" widens active task envelope`);
      }
    }
  }

  // Check path scope widening
  if (proposedEnvelope.scopes && activeTaskEnvelope.scopes) {
    const activeScopes = new Set(activeTaskEnvelope.scopes);
    for (const s of proposedEnvelope.scopes) {
      if (!activeScopes.has(s)) {
        widenedReasons.push(`proposed scope "${s}" widens active task envelope`);
      }
    }
  }

  // Check budget / resource ceiling widening
  if (proposedEnvelope.resourceCeilings && activeTaskEnvelope.resourceCeilings) {
    for (const [dim, ceil] of Object.entries(proposedEnvelope.resourceCeilings)) {
      const activeCeil = activeTaskEnvelope.resourceCeilings[dim];
      if (activeCeil != null && typeof ceil === 'number' && ceil > activeCeil) {
        widenedReasons.push(`proposed ceiling for dimension "${dim}" (${ceil}) exceeds active envelope ceiling (${activeCeil})`);
      }
    }
  }

  // Check authority / permission widening
  if (proposedEnvelope.authorityLevel && activeTaskEnvelope.authorityLevel) {
    if (proposedEnvelope.authorityLevel !== activeTaskEnvelope.authorityLevel) {
      widenedReasons.push(`proposed authorityLevel "${proposedEnvelope.authorityLevel}" differs from active envelope "${activeTaskEnvelope.authorityLevel}"`);
    }
  }

  // Check capability flags
  if (proposedEnvelope.capabilities && activeTaskEnvelope.capabilities) {
    const activeCaps = new Set(activeTaskEnvelope.capabilities);
    for (const c of proposedEnvelope.capabilities) {
      if (!activeCaps.has(c)) {
        widenedReasons.push(`proposed capability "${c}" widens active task envelope`);
      }
    }
  }

  if (widenedReasons.length > 0) {
    return {
      allowed: false,
      widened: true,
      reason: `no capability may be enabled by quietly widening an existing live task envelope: ${widenedReasons.join('; ')}`,
    };
  }

  return { allowed: true, widened: false, reason: null };
}

// ---------------------------------------------------------------------------
// Capability Admission Evaluation (The 3 Pillars)
// ---------------------------------------------------------------------------

/**
 * Evaluate a capability proposal for admission against §29 rules.
 *
 * Admission requires:
 * 1. Valid 14-field proposal lattice.
 * 2. Explicit authenticated authority (`authority.authenticated === true` && `authority.explicitApproval === true`).
 * 3. Affected safety qualification (`qualification.affectedSafetyQualified === true`).
 * 4. Evidence of value (`valueEvidence.evidenceOfValue === true`).
 * 5. Type-specific prerequisite satisfaction (if capabilityType is specified).
 * 6. No quiet widening of an active live task envelope.
 *
 * Listing a capability does NOT admit it. Fails closed.
 *
 * @param {object} proposal — the 14-field proposal object
 * @param {object} context — admission context
 * @param {string} [context.capabilityType] — one of CapabilityType
 * @param {object} [context.prerequisiteEvidence] — evidence for category prerequisites
 * @param {object} [context.authority] — authenticated authority record
 * @param {object} [context.qualification] — safety qualification record
 * @param {object} [context.valueEvidence] — value evidence record
 * @param {object} [context.activeTaskEnvelope] — active task envelope if task is live
 * @param {object} [context.proposedEnvelope] — proposed task envelope
 * @returns {{ admitted: boolean, decision: string, reasons: string[] }}
 */
function evaluateCapabilityAdmission(proposal, context) {
  const ctx = context && typeof context === 'object' ? context : {};
  const reasons = [];

  // 1. Validate proposal lattice
  const propVal = validateCapabilityProposal(proposal);
  if (!propVal.valid) {
    reasons.push(...propVal.errors);
    return {
      admitted: false,
      decision: CapabilityAdmissionDecision.REFUSED,
      reasons,
    };
  }

  // 2. Listing alone never admits
  if (!ctx.authority && !ctx.qualification && !ctx.valueEvidence) {
    reasons.push('listing a capability does not admit it; explicit authority, safety qualification, and value evidence required');
    return {
      admitted: false,
      decision: CapabilityAdmissionDecision.REFUSED,
      reasons,
    };
  }

  // 3. Pillar 1: Explicit Authority
  const auth = ctx.authority;
  if (!auth || auth.authenticated !== true || auth.explicitApproval !== true || auth.authorityGranted !== true) {
    reasons.push('lacks explicit authenticated authority approval (authorityGranted must be true)');
  }

  // 4. Pillar 2: Affected Safety Qualification
  const qual = ctx.qualification;
  if (!qual || qual.affectedSafetyQualified !== true || qual.isQualified !== true) {
    reasons.push('lacks affected safety qualification for the declared profile');
  }

  // 5. Pillar 3: Evidence of Value
  const valEv = ctx.valueEvidence;
  if (!valEv || valEv.evidenceOfValue !== true || valEv.valueEstablished !== true) {
    reasons.push('lacks empirical evidence of value establishing superiority/necessity');
  }

  // 6. Category-specific prerequisites
  if (ctx.capabilityType) {
    const prereqCheck = validateCapabilityPrerequisites(ctx.capabilityType, ctx.prerequisiteEvidence);
    if (!prereqCheck.satisfied) {
      reasons.push(...prereqCheck.reasons);
    }
  }

  // 7. Envelope widening check
  if (ctx.activeTaskEnvelope && ctx.proposedEnvelope) {
    const widening = checkEnvelopeWidening(ctx.activeTaskEnvelope, ctx.proposedEnvelope);
    if (!widening.allowed) {
      reasons.push(widening.reason);
    }
  }

  const admitted = reasons.length === 0;
  const decision = admitted
    ? CapabilityAdmissionDecision.ADMITTED
    : reasons.some((r) => r.includes('lacks affected safety qualification') || r.includes('authorityGranted'))
      ? CapabilityAdmissionDecision.BLOCKED
      : CapabilityAdmissionDecision.REFUSED;

  return {
    admitted,
    decision,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Module Exports
// ---------------------------------------------------------------------------

module.exports = {
  CAPABILITY_PROPOSAL_FIELDS,
  CapabilityType,
  CapabilityAdmissionDecision,
  computeProposalDigest,
  validateCapabilityProposal,
  validateCapabilityPrerequisites,
  verifyLiveInstallationBoundary,
  checkEnvelopeWidening,
  evaluateCapabilityAdmission,
};
