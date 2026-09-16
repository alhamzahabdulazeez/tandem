'use strict';
/**
 * evidence-pipeline — §23 Evidence Pipeline foundation.
 *
 * Implements the durable evidence lifecycle:
 *   observation → evidence → applicability → invalidation/supersession →
 *   retention → final outcome reduction.
 *
 * Every evidence item MUST bind a complete applicability key (generation-
 * specific). Evidence from an older generation MUST NOT certify a
 * repaired/new generation. A valid failure MUST NOT be silently overwritten by
 * a later green observation.
 *
 * Total outcomes only: PASS | FAIL | MISSING | INCONCLUSIVE.
 * Malformed, stale, wrong-generation, duplicate, truncated, conflicting, or
 * unsupported evidence MUST NOT become PASS.
 *
 * FAIL CLOSED: any missing, inconclusive, or non-applicable evidence does not
 * establish acceptance. Recording evidence MUST NOT grant authority, execution
 * permission, or budget (§23 requirement 9).
 *
 * PRD references: §14, §16, §17, §21, §23.
 */

const { canonicalJson, sha256 } = require('./crypto.js');
const { envelopeComplete, evidenceApplicable, ENVELOPE_FIELDS } = require('./evidence.js');

// ---------------------------------------------------------------------------
// §23 outcome enumeration — total; no partial states
// ---------------------------------------------------------------------------

const EvidenceOutcome = Object.freeze({
  PASS:        'PASS',
  FAIL:        'FAIL',
  MISSING:     'MISSING',
  INCONCLUSIVE: 'INCONCLUSIVE',
});

const VALID_OUTCOMES = new Set(Object.values(EvidenceOutcome));

// Outcomes that can never establish acceptance (§21, §23 requirement 4).
const NON_PASS_OUTCOMES = new Set([
  EvidenceOutcome.FAIL,
  EvidenceOutcome.MISSING,
  EvidenceOutcome.INCONCLUSIVE,
]);

// Truncation states that still certify a PASS — the same bounded/known set
// derivation.js enforces for observer runs (§16.4). Anything else
// (unbounded, unknown, or declared-but-unrecognised) makes the capture
// truncated and MUST NOT certify PASS (Finding A fix, §23 audit).
const SAFE_TRUNCATION_STATES = new Set(['NONE', 'TRUNCATED_BOUNDED']);

// ---------------------------------------------------------------------------
// Invalidation reasons (deterministic — never stylistic or preference-based)
// ---------------------------------------------------------------------------

const InvalidationReason = Object.freeze({
  KEY_MISMATCH:        'KEY_MISMATCH',        // applicability key does not match active key
  GENERATION_RETIRED:  'GENERATION_RETIRED',  // generation was repaired/replaced
  SUPERSEDED:          'SUPERSEDED',          // later record for same obligation/key admitted
  ENVELOPE_INCOMPLETE: 'ENVELOPE_INCOMPLETE', // envelope fields missing at admission time
  POST_FINALIZATION:   'POST_FINALIZATION',   // arrived after task finalized (late evidence)
});

// ---------------------------------------------------------------------------
// Truncation-state extraction (fail-closed §16/§23)
// ---------------------------------------------------------------------------

/**
 * Return the truncation state string declared by a evidence record, or null when
 * no truncation state is declared. Checks the envelope's combined field
 * (supervisor-supplied §17) first, then falls back to captured.truncationState
 * (observer-run shape). An absent/null/empty value means the truncation state
 * is not declared — the admission gate (envelopeCompleteness) demands this
 * field; the reduction gate treats an absent declaration as "not truncated" for
 * records that passed admission, and as a reason to fail-closed for records
 * that are fed directly.
 */
function evidenceTruncationState(record) {
  if (!record || typeof record !== 'object') return null;
  const env = record.envelope;
  if (env && typeof env === 'object') {
    const st = env.completionTimeoutSignalAndTruncationState;
    if (typeof st === 'string' && st.length > 0) return st;
  }
  if (record.captured && typeof record.captured === 'object') {
    const st = record.captured.truncationState;
    if (typeof st === 'string' && st.length > 0) return st;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Applicability key
// ---------------------------------------------------------------------------

/**
 * Compute the deterministic applicability key for an evidence item.
 *
 * The key binds: generationId, obligationId, acceptanceContractDigest,
 * effectivePolicyRevision, qualifiedProfileDigest, selectedSourceBaseline,
 * exactCandidateGenerationAndTreeDigest, requirementObligationAndPredicateIdentity,
 * predicateVersionParametersAndExpectedValues.
 *
 * A key mismatch means the evidence was captured for a different
 * contract/policy/profile/generation slice and MUST NOT certify this one.
 *
 * @param {object} binding — the fields that define the slice's identity
 * @returns {string} — sha256 hex of the canonical JSON
 */
function computeApplicabilityKey(binding) {
  if (!binding || typeof binding !== 'object') {
    throw new Error('computeApplicabilityKey: binding must be an object');
  }
  const canonical = {
    generationId: binding.generationId || null,
    obligationId: binding.obligationId || null,
    acceptanceContractDigest: binding.acceptanceContractDigest || null,
    effectivePolicyRevision: binding.effectivePolicyRevision || null,
    qualifiedProfileDigest: binding.qualifiedProfileDigest || null,
    selectedSourceBaseline: binding.selectedSourceBaseline || null,
    exactCandidateGenerationAndTreeDigest: binding.exactCandidateGenerationAndTreeDigest || null,
    requirementObligationAndPredicateIdentity: binding.requirementObligationAndPredicateIdentity || null,
    predicateVersionParametersAndExpectedValues: binding.predicateVersionParametersAndExpectedValues || null,
  };
  return sha256(canonicalJson(canonical));
}

// ---------------------------------------------------------------------------
// Evidence admission
// ---------------------------------------------------------------------------

/**
 * Admit one evidence record into the pipeline.
 *
 * Admission checks (fail-closed):
 * 1. outcome must be a valid total outcome
 * 2. generationId must match the expected (active) generation
 * 3. applicability key must match
 * 4. §17 envelope must be complete
 * 5. evidence must not arrive after the task has been finalized
 *
 * Does NOT grant authority, budget, or execution permission.
 *
 * @param {object} evidence — evidence record (kind: 'evidence')
 * @param {object} context
 * @param {string} context.activeGenerationId — the current frozen generation
 * @param {string} context.expectedApplicabilityKey — pre-computed key for this slice
 * @param {boolean} [context.taskFinalized] — true if finalization record present
 * @returns {{ admitted: boolean, reason: string|null, invalidationReason: string|null }}
 */
function admitEvidence(evidence, context) {
  const ctx = context || {};
  if (!evidence || typeof evidence !== 'object') {
    return { admitted: false, reason: 'no evidence record', invalidationReason: null };
  }

  // Outcome must be a known total outcome (no partial states).
  if (!VALID_OUTCOMES.has(evidence.outcome)) {
    return {
      admitted: false,
      reason: `invalid outcome "${evidence.outcome}"; must be PASS/FAIL/MISSING/INCONCLUSIVE`,
      invalidationReason: null,
    };
  }

  // Evidence cannot arrive after finalization.
  if (ctx.taskFinalized === true) {
    return {
      admitted: false,
      reason: 'evidence arrived after task finalization',
      invalidationReason: InvalidationReason.POST_FINALIZATION,
    };
  }

  // Generation-specificity: evidence must match the active generation exactly.
  if (!ctx.activeGenerationId) {
    return { admitted: false, reason: 'no active generation established', invalidationReason: null };
  }
  if (evidence.generationId !== ctx.activeGenerationId) {
    return {
      admitted: false,
      reason: `evidence generationId "${evidence.generationId}" does not match active generation "${ctx.activeGenerationId}"`,
      invalidationReason: InvalidationReason.GENERATION_RETIRED,
    };
  }

  // Applicability key must match.
  const keyCheck = evidenceApplicable(
    { ...evidence, applicabilityKey: evidence.applicabilityKey },
    ctx.expectedApplicabilityKey,
  );
  if (!keyCheck.applicable) {
    return {
      admitted: false,
      reason: keyCheck.reason,
      invalidationReason: evidence.applicabilityKey !== ctx.expectedApplicabilityKey
        ? InvalidationReason.KEY_MISMATCH
        : InvalidationReason.ENVELOPE_INCOMPLETE,
    };
  }

  // §17 envelope completeness.
  const complete = envelopeComplete(evidence);
  if (!complete.ok) {
    return {
      admitted: false,
      reason: `incomplete envelope: ${complete.problems[0]}`,
      invalidationReason: InvalidationReason.ENVELOPE_INCOMPLETE,
    };
  }

  return { admitted: true, reason: null, invalidationReason: null };
}

// ---------------------------------------------------------------------------
// Valid-failure preservation
// ---------------------------------------------------------------------------

/**
 * Determine whether a later evidence record for the same obligation may
 * supersede an earlier one.
 *
 * §23 requirement 5: a later green observation MUST NOT silently overwrite a
 * still-applicable valid failure. Supersession is only structural: a later
 * record with the SAME applicability key for the same obligation supersedes
 * only when the earlier record is not an applicable FAIL.
 *
 * Returns the reason code when supersession is BLOCKED; null when it is
 * permitted.
 *
 * @param {object} existing — currently admitted evidence for this obligation/key
 * @param {object} incoming — newly admitted evidence
 * @returns {string|null} — InvalidationReason value blocking supersession, or null
 */
function supersessionBlocked(existing, incoming) {
  if (!existing) return null;
  // A valid FAIL with a matching applicability key is a preserved failure.
  // The incoming record may not supersede it.
  if (
    existing.outcome === EvidenceOutcome.FAIL
    && existing.invalidated !== true
    && existing.applicabilityKey === incoming.applicabilityKey
  ) {
    return 'valid-failure preservation: a later PASS may not erase an applicable FAIL';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Outcome reduction across all admitted evidence for one obligation
// ---------------------------------------------------------------------------

/**
 * Reduce all admitted, non-invalidated evidence for one obligation into a
 * single total outcome.
 *
 * Rules (fail-closed):
 * - No evidence → MISSING
 * - Any FAIL → FAIL (valid failure preserves)
 * - Any INCONCLUSIVE (no FAIL) → INCONCLUSIVE
 * - All PASS → PASS (only when every record is PASS, none invalidated, none truncated)
 * - Conflicting PASS + FAIL → FAIL (fail closed)
 *
 * @param {object[]} evidenceItems — all evidence records for one obligation
 * @returns {{ outcome: string, reasons: string[] }}
 */
function reduceObligationOutcome(evidenceItems) {
  const items = Array.isArray(evidenceItems) ? evidenceItems : [];
  const active = items.filter((e) => e.invalidated !== true);

  if (active.length === 0) {
    return { outcome: EvidenceOutcome.MISSING, reasons: ['no admitted evidence for obligation'] };
  }

  const outcomes = active.map((e) => e.outcome);
  const reasons = [];

  // Any unknown/invalid outcome → INCONCLUSIVE (defensive; admission should catch these).
  const invalid = outcomes.filter((o) => !VALID_OUTCOMES.has(o));
  if (invalid.length > 0) {
    reasons.push(`${invalid.length} record(s) with invalid outcome: ${invalid.join(', ')}`);
    return { outcome: EvidenceOutcome.INCONCLUSIVE, reasons };
  }

  const hasFail = outcomes.includes(EvidenceOutcome.FAIL);
  const hasPass = outcomes.includes(EvidenceOutcome.PASS);
  const hasInconclusive = outcomes.includes(EvidenceOutcome.INCONCLUSIVE);
  const hasMissing = outcomes.includes(EvidenceOutcome.MISSING);

  if (hasFail) {
    if (hasPass) reasons.push('conflicting PASS and FAIL — fail closed');
    return { outcome: EvidenceOutcome.FAIL, reasons };
  }

  // An active record with an unbounded or unknown truncation declaration
  // cannot certify a PASS; the capture is incomplete (§16, Finding A fix).
  // When the truncation state is explicitly absent the record is treated as
  // truncation-free (the admission gate is responsible for demanding it); when
  // it IS present but not in {NONE, TRUNCATED_BOUNDED} the capture is
  // unambiguously incomplete and MUST NOT certify.
  const hasTruncated = active.some((e) => {
    const st = evidenceTruncationState(e);
    return st !== null && !SAFE_TRUNCATION_STATES.has(st);
  });
  if (hasTruncated) reasons.push('unbounded/unknown truncation present — cannot certify PASS');

  if (hasInconclusive || hasMissing || hasTruncated) {
    if (hasInconclusive) reasons.push('INCONCLUSIVE evidence present');
    if (hasMissing) reasons.push('MISSING evidence present');
    return { outcome: EvidenceOutcome.INCONCLUSIVE, reasons };
  }
  return { outcome: EvidenceOutcome.PASS, reasons };
}

// ---------------------------------------------------------------------------
// Pipeline reduction across all obligations
// ---------------------------------------------------------------------------

/**
 * Reduce the full evidence pipeline across all obligations.
 *
 * Returns a per-obligation breakdown and a final pipeline verdict:
 * - PASS only when every obligation has a non-invalidated PASS
 * - FAIL when any obligation fails
 * - MISSING when any obligation has no admitted evidence
 * - INCONCLUSIVE otherwise
 *
 * Candidate-produced reports stay 'supporting' and MUST NOT become PASS
 * without an authoritative observer (§23 requirement 7). Under IB-01 no
 * qualified observer is available, so all authoritative slots are UNAVAILABLE.
 *
 * @param {object} opts
 * @param {string[]} opts.obligations — required obligation IDs
 * @param {object[]} opts.evidenceRecords — all admitted evidence records (kind: 'evidence')
 * @param {object[]} [opts.invalidations] — evidence_invalidation records
 * @returns {{ verdict: string, byObligation: object, authoritative: boolean }}
 */
function reducePipeline({ obligations, evidenceRecords, invalidations = [] }) {
  const obls = Array.isArray(obligations) ? obligations : [];
  const records = Array.isArray(evidenceRecords) ? evidenceRecords : [];
  const invSet = new Set(
    (Array.isArray(invalidations) ? invalidations : [])
      .map((inv) => inv.evidenceId)
      .filter(Boolean),
  );

  // Mark records as invalidated if they appear in the invalidation set.
  const annotated = records.map((e) => ({
    ...e,
    invalidated: e.invalidated === true || invSet.has(e.evidenceId),
  }));

  const byObligation = {};
  for (const oblId of obls) {
    const items = annotated.filter((e) => e.obligationId === oblId);
    byObligation[oblId] = reduceObligationOutcome(items);
  }

  // Obligations with no evidence records at all.
  for (const oblId of obls) {
    if (!byObligation[oblId]) {
      byObligation[oblId] = { outcome: EvidenceOutcome.MISSING, reasons: ['no evidence records for obligation'] };
    }
  }

  const outcomes = obls.map((id) => byObligation[id].outcome);
  let verdict;
  if (outcomes.length === 0) {
    verdict = EvidenceOutcome.MISSING;
  } else if (outcomes.includes(EvidenceOutcome.FAIL)) {
    verdict = EvidenceOutcome.FAIL;
  } else if (outcomes.includes(EvidenceOutcome.MISSING) || outcomes.includes(EvidenceOutcome.INCONCLUSIVE)) {
    verdict = EvidenceOutcome.INCONCLUSIVE;
  } else if (outcomes.every((o) => o === EvidenceOutcome.PASS)) {
    verdict = EvidenceOutcome.PASS;
  } else {
    verdict = EvidenceOutcome.INCONCLUSIVE;
  }

  // Authoritative only when at least one record is classified authoritative,
  // is stamped by a qualified external observer, AND has not been invalidated.
  // A candidate-authored (or forged) authoritative label alone is never
  // authoritative (§17/§23 req 7, Finding B fix). Under IB-01 this will
  // always be false.
  const authoritative = annotated.some(
    (e) => e.classification === 'authoritative'
      && e.observerQualified === true
      && e.invalidated !== true,
  );

  return { verdict, byObligation, authoritative };
}

// ---------------------------------------------------------------------------
// Coherence integration helper
// ---------------------------------------------------------------------------

/**
 * Derive the evidence domain contribution for §21 coherence from the pipeline.
 *
 * Returns the list of admitted, non-invalidated observer_run records for use
 * in the coherence assembly — identical to what coherence.js already uses,
 * but now also accounting for evidence_invalidation records in the store.
 *
 * @param {object[]} records — all store records
 * @returns {object[]} — admitted, non-invalidated observer_run records
 */
function activeObserverRuns(records) {
  const list = Array.isArray(records) ? records : [];

  // Build evidenceId → sourceRunId map from evidence records.
  const evidenceRunMap = new Map();
  for (const r of list) {
    if (r.kind === 'evidence' && r.evidenceId && r.sourceRunId) {
      evidenceRunMap.set(r.evidenceId, r.sourceRunId);
    }
  }

  // Resolve each invalidation's evidenceId to the originating observer_run's runId.
  const invalidatedRunIds = new Set();
  for (const r of list) {
    if (r.kind === 'evidence_invalidation' && r.evidenceId) {
      const runId = evidenceRunMap.get(r.evidenceId);
      if (runId) invalidatedRunIds.add(runId);
    }
  }

  return list.filter(
    (r) => r.kind === 'observer_run' && !invalidatedRunIds.has(r.runId),
  );
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  EvidenceOutcome,
  VALID_OUTCOMES,
  NON_PASS_OUTCOMES,
  InvalidationReason,
  SAFE_TRUNCATION_STATES,
  computeApplicabilityKey,
  admitEvidence,
  supersessionBlocked,
  reduceObligationOutcome,
  reducePipeline,
  activeObserverRuns,
  evidenceTruncationState,
};
