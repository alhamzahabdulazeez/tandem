'use strict';
/**
 * repair — Bounded Repair (§18).
 *
 * The MVP supports a policy value of ZERO OR ONE repair after the initial
 * implementation attempt, never a higher ceiling. A repair is eligible only
 * when EVERY §18 condition holds; a fail-closed total outcome is reported
 * otherwise. Nothing here claims a qualified materializer or a protected
 * execution environment — repair algebra is pure over durable facts, and
 * frozen-byte re-verification still requires the §16/§20 machinery (IB-01
 * applies to the observer/materializer, not to this eligibility calculus).
 *
 * PRD references: §18 (Bounded Repair), §11 (failure identity), §7
 * (VERIFYING → REPAIRING → VERIFYING), §14 (obligations are immutable).
 */

const REPAIR_STATUS = Object.freeze({
  READY: 'READY',           // eligible: the one authorized repair may proceed
  DISALLOWED: 'DISALLOWED', // a concrete eligibility condition fails (§18 bullet list)
  EXHAUSTED: 'EXHAUSTED',   // the single repair allowance is already durably consumed
});

/** The MVP repair ceiling: zero or one repair, never higher (§18 first line). */
const REPAIR_CEILING = 1;

/** §18 severity levels (conservative, total). */
const FailureSeverity = Object.freeze({
  BLOCKING:      'BLOCKING',       // blocks any truthful success
  CONSEQUENTIAL: 'CONSEQUENTIAL',  // meaningful correctness/scope impact
  MINOR:         'MINOR',          // bounded, does not gate the outcome
});

/**
 * §18 failure identity — a failure identity MUST include the applicable
 * requirement/predicate or check, case/diagnostic identity, affected
 * component/location where available, severity, normalized signature,
 * generation, and raw-evidence reference.
 *
 * @param {object} f
 * @param {string} f.requirementOrCheck — applicable requirement/predicate/check id
 * @param {string} f.caseIdentity — case/diagnostic identity
 * @param {string|null} [f.affectedComponent] — component/location where available
 * @param {string} f.severity — one of FailureSeverity
 * @param {string} f.normalizedSignature — stable failure signature for repetition checks
 * @param {string|null} [f.generationId] — generation the failure applies to
 * @param {string} f.rawEvidenceReference — reference to the raw evidence
 * @returns {{ ok: boolean, identity: object|null, problems: string[] }}
 */
function rawFailureIdentity({
  requirementOrCheck, caseIdentity, affectedComponent,
  severity, normalizedSignature, generationId, rawEvidenceReference,
}) {
  const problems = [];
  if (typeof requirementOrCheck !== 'string' || requirementOrCheck.length === 0) {
    problems.push('failure identity: requirementOrCheck — applicable requirement/predicate/check required');
  }
  if (typeof caseIdentity !== 'string' || caseIdentity.length === 0) {
    problems.push('failure identity: caseIdentity — case/diagnostic identity required');
  }
  if (affectedComponent != null && (typeof affectedComponent !== 'string' || affectedComponent.length === 0)) {
    problems.push('failure identity: affected component/location must be a non-empty string when provided');
  }
  if (!Object.values(FailureSeverity).includes(severity)) {
    problems.push(`failure identity: severity must be one of ${Object.values(FailureSeverity).join(', ')}`);
  }
  if (typeof normalizedSignature !== 'string' || normalizedSignature.length === 0) {
    problems.push('failure identity: normalizedSignature — normalized signature required');
  }
  if (generationId != null && (typeof generationId !== 'string' || generationId.length === 0)) {
    problems.push('failure identity: generation id must be a non-empty string when provided');
  }
  if (typeof rawEvidenceReference !== 'string' || rawEvidenceReference.length === 0) {
    problems.push('failure identity: rawEvidenceReference — raw-evidence reference required');
  }
  if (problems.length > 0) return { ok: false, identity: null, problems };
  return {
    ok: true,
    identity: {
      requirementOrCheck,
      caseIdentity,
      affectedComponent: affectedComponent || null,
      severity,
      normalizedSignature,
      generationId: generationId || null,
      rawEvidenceReference,
    },
    problems,
  };
}

/**
 * §18 eligibility — a repair is eligible only when ALL conditions hold:
 *   - a concrete applicable failure is established;
 *   - its identity and affected requirement are recorded;
 *   - a minimal causal hypothesis is attributable to the failure;
 *   - the proposed correction stays inside the original admitted intent and
 *     change surface;
 *   - the acceptance contract and oracle remain unchanged;
 *   - the authorized repair allowance is unused;
 *   - the aggregate budget can cover mutation, full required re-verification,
 *     finalization, and retention;
 *   - prior actors are reconciled or fenced;
 *   - no control, oracle, ownership, or security compromise prevents
 *     trustworthy continuation.
 *
 * FAIL CLOSED: every condition must be explicitly true — an unstated
 * precondition is a `DISALLOWED` problem, never silently treated as met.
 *
 * @param {object} opts
 * @returns {{ status: string, problems: string[] }}
 */
function repairEligibility({
  failure,
  identity,
  minimalCausalHypothesis,
  insideIntentSurface,
  contractAndOracleUnchanged,
  allowanceUsed,
  budgetCoversFullCycle,
  priorActorsReconciledOrFenced,
  noCompromise,
}) {
  const problems = [];
  if (failure !== true) problems.push('no concrete applicable failure is established');
  if (!identity || typeof identity !== 'object') {
    problems.push('failure identity (with affected requirement) is not recorded');
  } else {
    if (!identity.requirementOrCheck || !identity.caseIdentity || !identity.normalizedSignature) {
      problems.push('recorded failure identity is incomplete (requirement/check, case, signature required)');
    }
  }
  if (minimalCausalHypothesis !== true) problems.push('minimal causal hypothesis is not attributable to the failure');
  if (insideIntentSurface !== true) problems.push('proposed correction is outside the original admitted intent and change surface');
  if (contractAndOracleUnchanged !== true) problems.push('acceptance contract or oracle would change');
  if (allowanceUsed === true) problems.push('the authorized repair allowance was already durably consumed');
  if (budgetCoversFullCycle !== true) problems.push('aggregate budget cannot cover mutation, full required re-verification, finalization, and retention');
  if (priorActorsReconciledOrFenced !== true) problems.push('prior actors are not reconciled or fenced');
  if (noCompromise !== true) problems.push('control, oracle, ownership, or security compromise prevents trustworthy continuation');

  if (allowanceUsed === true) {
    // The one authorized allowance is durably spent — the latch is monotonic:
    // even a nominally-clean eligibility call cannot authorize a second repair.
    return { status: REPAIR_STATUS.EXHAUSTED, problems };
  }
  if (problems.length === 0) return { status: REPAIR_STATUS.READY, problems };
  return { status: REPAIR_STATUS.DISALLOWED, problems };
}

/**
 * §18 MUST NOT — repair MUST NOT thaw a frozen generation, overwrite accepted
 * payloads, inherit old PASS labels, or reset the lineage budget. These are
 * hard prohibitions: any single violation makes the proposed repair invalid.
 *
 * @param {object} opts
 * @returns {{ ok: boolean, problems: string[] }}
 */
function repairMustNot({
  thawsFrozenGeneration,
  overwritesAcceptedPayload,
  inheritsOldPass,
  resetsLineageBudget,
}) {
  const problems = [];
  if (thawsFrozenGeneration === true) problems.push('repair MUST NOT thaw a frozen generation');
  if (overwritesAcceptedPayload === true) problems.push('repair MUST NOT overwrite an accepted payload');
  if (inheritsOldPass === true) problems.push('repair MUST NOT inherit old PASS labels');
  if (resetsLineageBudget === true) problems.push('repair MUST NOT reset the lineage budget');
  return { ok: problems.length === 0, problems };
}

/**
 * §18 stop conditions — stop repair on repeated signatures without new
 * evidence, exhausted capacity, increased scope, consequential uncertainty,
 * inconclusive verification, unavailable required knowledge,
 * oracle/control compromise, security-boundary issues, cancellation, or the
 * repair ceiling.
 *
 * @param {object} opts
 * @returns {{ stop: boolean, reasons: string[] }}
 */
function shouldStopRepair({
  repeatedSignatureWithoutNewEvidence,
  capacityExhausted,
  scopeIncreased,
  consequentialUncertainty,
  inconclusiveVerification,
  knowledgeUnavailable,
  compromise,
  securityBoundaryIssue,
  cancelled,
  ceilingReached,
}) {
  const reasons = [];
  if (repeatedSignatureWithoutNewEvidence === true) reasons.push('repeated failure signature without new evidence');
  if (capacityExhausted === true) reasons.push('capacity exhausted');
  if (scopeIncreased === true) reasons.push('increased scope');
  if (consequentialUncertainty === true) reasons.push('consequential uncertainty');
  if (inconclusiveVerification === true) reasons.push('inconclusive verification');
  if (knowledgeUnavailable === true) reasons.push('unavailable required knowledge');
  if (compromise === true) reasons.push('oracle/control compromise');
  if (securityBoundaryIssue === true) reasons.push('security-boundary issue');
  if (cancelled === true) reasons.push('cancellation');
  if (ceilingReached === true) reasons.push('repair ceiling reached');
  return { stop: reasons.length > 0, reasons };
}

/**
 * Compare two failure identities by their normalized signature and affected
 * requirement — used to prove whether a new candidate resolved the concrete
 * failure ("compare concrete failure identities and stop truthfully").
 * @param {object} a
 * @param {object} b
 * @returns {boolean} true when the same concrete failure is present
 */
function sameFailure(a, b) {
  if (!a || !b) return false;
  return a.normalizedSignature === b.normalizedSignature
    && a.requirementOrCheck === b.requirementOrCheck;
}

module.exports = {
  REPAIR_STATUS,
  REPAIR_CEILING,
  FailureSeverity,
  rawFailureIdentity,
  repairEligibility,
  repairMustNot,
  shouldStopRepair,
  sameFailure,
};