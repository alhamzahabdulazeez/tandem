'use strict';
/**
 * acceptance — pure obligation/inventory algebra for §14 (Acceptance
 * Obligations) and §21 (Acceptance Reduction).
 *
 * The obligation compiler CONSUMES the retained inventory without owning or
 * rewriting it (§14). This module owns:
 *   - the inventory entry shape required by §13;
 *   - the eight-point deterministic coverage validator (§14 steps 1-8);
 *   - the THREE predicate families (§14) — nothing more. No generalized
 *     predicate language; no dynamically loaded repository predicates;
 *   - the TOTAL outcome lattice (PASS/FAIL/MISSING/INCONCLUSIVE) and the
 *     monotonic-failure rule: a valid still-applicable failure is never
 *     overwritten by a later green observation (§14).
 *
 * Reduction (§21) is deterministic: an EMPTY conjunction is never accepted, and
 * MISSING/INCONCLUSIVE never upgrade to PASS.
 */

const { sha256, canonicalJson, isContentId } = require('./crypto.js');
const { ObligationOutcome, Assurance } = require('./records.js');

// ---------------------------------------------------------------------------
// Predicate families (§14)
// ---------------------------------------------------------------------------

const PredicateFamily = Object.freeze({
  EXTERNAL_BEHAVIORAL_CASE: 'EXTERNAL_BEHAVIORAL_CASE',
  FROZEN_TREE_CONSTRAINT: 'FROZEN_TREE_CONSTRAINT',
  QUALIFIED_DETERMINISTIC_CHECK: 'QUALIFIED_DETERMINISTIC_CHECK',
});

const PREDICATE_FAMILIES = new Set(Object.values(PredicateFamily));

/** Required positive evidence per family (§14 table). */
const FAMILY_EVIDENCE = Object.freeze({
  [PredicateFamily.EXTERNAL_BEHAVIORAL_CASE]: {
    description: 'trusted case/input identity; protected expected behavior; bounded candidate response; independent comparison of declared output/exit behavior',
    requiredObservationTypes: ['expected_value', 'candidate_stdout', 'candidate_stderr', 'exit_signal', 'exit_code', 'timeout'],
  },
  [PredicateFamily.FROZEN_TREE_CONSTRAINT]: {
    description: 'trusted complete enumeration/read of the frozen scope establishing required content, absence, supported types/modes, allowed change surface, or exact tree equality',
    requiredObservationTypes: ['tree_enumeration', 'content_digest', 'absence_check'],
  },
  [PredicateFamily.QUALIFIED_DETERMINISTIC_CHECK]: {
    description: 'a pinned qualified checker with protected assertion semantics and authoritative output path establishing its declared property',
    requiredObservationTypes: ['checker_identity', 'assertion_result', 'authoritative_output'],
  },
});

// ---------------------------------------------------------------------------
// Inventory (§13)
// ---------------------------------------------------------------------------

/**
 * Create the retained inventory entry. The supervisor retains the original
 * request unchanged; each entry carries provenance and admitted interpretation
 * (which is distinct from the original meaning).
 */
function createInventoryEntry({
  requirementId, parentRequirementId = null, sourceProvenance,
  originalMeaning, admittedInterpretation, explicitOrInferred,
  mandatoryOrOptional, applicability, scope, rationale, uncertainty,
  authorizedRevision = null, mappedObligationIds = [],
}) {
  if (typeof requirementId !== 'string' || requirementId.length === 0) throw new Error('createInventoryEntry: requirementId required');
  return {
    requirementId,
    parentRequirementOrSubconditionId: parentRequirementId,
    sourceAndProvenance: sourceProvenance || null,
    originalMeaning: originalMeaning ?? null,
    admittedInterpretation: admittedInterpretation ?? null,
    explicitOrInferred: explicitOrInferred || 'explicit',
    mandatoryOrOptional: mandatoryOrOptional || 'optional',
    applicability: applicability ?? 'UNRESOLVED',
    scope: scope ?? null,
    rationale: rationale ?? null,
    uncertainty: uncertainty ?? null,
    authorizedRevision: authorizedRevision,
    mappedObligationIds: Array.isArray(mappedObligationIds) ? mappedObligationIds.slice() : [],
  };
}

const EXPLICIT_KINDS = new Set(['explicit', 'inferred']);
const MANDATORY_KINDS = new Set(['mandatory', 'optional']);

// ---------------------------------------------------------------------------
// Obligation (§14)
// ---------------------------------------------------------------------------

/**
 * Create an obligation with the full §14 field set. Every field is admitted by
 * the supervisor; there is no implicit or defaulted discovery of what to check.
 */
function createObligation({
  obligationId, sourceRequirementAndSubconditionLinks = [],
  mandatoryStatus, applicabilityAndDomain, predicateFamily,
  predicateAdapterId, predicateVersion, parametersAndExpectedValues = {},
  requiredObservationTypes = [], requiredScopeAndCompleteness = null,
  permittedEvidenceSources = [], candidateAndInputApplicability = null,
  retryRule = 'NO_RETRY', conflictRule = 'FAIL_WINS', supersessionRule = 'EVIDENCE_BASED',
  outcomeAndReasons = null,
}) {
  if (typeof obligationId !== 'string' || obligationId.length === 0) throw new Error('createObligation: obligationId required');
  if (!PREDICATE_FAMILIES.has(predicateFamily)) throw new Error(`createObligation: unknown predicate family "${predicateFamily}"`);
  return Object.freeze({
    obligationId,
    sourceRequirementAndSubconditionLinks: sourceRequirementAndSubconditionLinks.slice(),
    mandatoryStatus: mandatoryStatus || 'optional',
    applicabilityAndDomain: applicabilityAndDomain ?? 'UNRESOLVED',
    predicateFamily,
    predicateAdapterId: predicateAdapterId || null,
    predicateVersion: predicateVersion == null ? null : predicateVersion,
    parametersAndExpectedValues,
    requiredObservationTypes,
    requiredScopeAndCompleteness: requiredScopeAndCompleteness ?? null,
    permittedEvidenceSources,
    candidateAndInputApplicability: candidateAndInputApplicability ?? null,
    retryRule,
    conflictRule,
    supersessionRule,
    outcomeAndReasons,
  });
}

function isInventoryEntry(e) {
  return !!e && typeof e === 'object'
    && typeof e.requirementId === 'string'
    && e.mandatoryOrOptional !== undefined;
}

function isObligation(o) {
  return !!o && typeof o === 'object'
    && typeof o.obligationId === 'string'
    && PREDICATE_FAMILIES.has(o.predicateFamily);
}

// ---------------------------------------------------------------------------
// Coverage validator (§14 steps 1-8)
// ---------------------------------------------------------------------------

/**
 * Deterministic 8-point coverage validator. Returns a list of problems; empty
 * means every applicable rule holds. Fail closed on every point — a validator
 * that finds a gap reports it.
 *
 * @param {object} opts
 * @param {object[]} opts.inventory — retained inventory entries
 * @param {object[]} opts.obligations — obligation records
 * @param {boolean} [opts.claimedOutcome] — whether a task outcome is claimed
 * @returns {{ ok: boolean, problems: string[] }}
 */
function validateCoverage({ inventory, obligations, claimedOutcome = true }) {
  const problems = [];

  // 1. Mandatory inventory is nonempty for a claimed task outcome.
  const mandatory = (inventory || []).filter((e) => e.mandatoryOrOptional === 'mandatory');
  if (claimedOutcome && mandatory.length === 0) {
    problems.push('1: mandatory inventory is empty for a claimed task outcome');
  }
  if (!inventory || !Array.isArray(inventory) || inventory.length === 0) {
    problems.push('1: inventory is empty');
  }

  const obls = obligations || [];
  const oblsById = new Map(obls.map((o) => [o.obligationId, o]));

  // 2. Every mandatory requirement and required subcondition has explicit
  //    obligation mappings.
  for (const entry of inventory || []) {
    if (entry.mandatoryOrOptional !== 'mandatory') continue;
    if (!Array.isArray(entry.mappedObligationIds) || entry.mappedObligationIds.length === 0) {
      problems.push(`2: mandatory requirement ${entry.requirementId} has no obligation mapping`);
    }
    for (const oid of entry.mappedObligationIds || []) {
      if (!oblsById.has(oid)) problems.push(`2: mandatory requirement ${entry.requirementId} maps to unknown obligation ${oid}`);
    }
  }

  // 3. Each mapping states the meaning and acceptance scope it covers.
  for (const o of obls) {
    if (!o.applicabilityAndDomain) problems.push(`3: obligation ${o.obligationId} lacks applicabilityAndDomain (meaning/scope)`);
    if (!o.requiredScopeAndCompleteness) problems.push(`3: obligation ${o.obligationId} lacks requiredScopeAndCompleteness`);
  }

  // 4. The predicate supports that domain. Only the three supported families
  //    may appear, and each family supplies the required observation types.
  for (const o of obls) {
    if (!PREDICATE_FAMILIES.has(o.predicateFamily)) {
      problems.push(`4: obligation ${o.obligationId} uses unsupported predicate family "${o.predicateFamily}"`);
    }
  }
  for (const o of obls) {
    const familyReq = FAMILY_EVIDENCE[o.predicateFamily];
    if (!familyReq) continue;
    for (const reqType of familyReq.requiredObservationTypes) {
      if (!(o.requiredObservationTypes || []).includes(reqType)) {
        problems.push(`4: obligation ${o.obligationId} (${o.predicateFamily}) lacks required observation type "${reqType}"`);
      }
    }
  }

  // 5. Required witnesses, expected values, and observation types are defined.
  for (const o of obls) {
    if (!o.parametersAndExpectedValues || Object.keys(o.parametersAndExpectedValues).length === 0) {
      problems.push(`5: obligation ${o.obligationId} has no parametersAndExpectedValues`);
    }
    if (!Array.isArray(o.requiredObservationTypes) || o.requiredObservationTypes.length === 0) {
      problems.push(`5: obligation ${o.obligationId} has no requiredObservationTypes`);
    }
    if (!o.predicateAdapterId) problems.push(`5: obligation ${o.obligationId} has no predicateAdapterId`);
    if (o.predicateVersion == null) problems.push(`5: obligation ${o.obligationId} has no predicateVersion`);
  }

  // 6. Applicability is resolved or remains explicitly unresolved.
  for (const e of inventory || []) {
    if (!e.applicability) problems.push(`6: inventory ${e.requirementId} has no applicability`);
  }
  for (const o of obls) {
    if (!o.applicabilityAndDomain) problems.push(`6: obligation ${o.obligationId} has no applicability`);
  }

  // 7. No mandatory item was omitted or silently made optional.
  for (const e of inventory || []) {
    if (e.mandatoryOrOptional === 'mandatory') {
      if (!Array.isArray(e.mappedObligationIds) || e.mappedObligationIds.length === 0) {
        problems.push(`7: mandatory ${e.requirementId} silently optional (no obligations)`);
      }
      for (const oid of e.mappedObligationIds || []) {
        const o = oblsById.get(oid);
        if (o && o.mandatoryStatus !== 'mandatory') {
          problems.push(`7: mandatory ${e.requirementId} maps to obligation ${oid} marked optional`);
        }
      }
    }
  }

  // 8. No empty selection or empty conjunction can establish acceptance.
  if (claimedOutcome && obls.length === 0) {
    problems.push('8: empty obligation conjunction cannot establish acceptance');
  }

  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// Outcome reduction (§14 / §21)
// ---------------------------------------------------------------------------

/**
 * Reduce one obligation's observations to a total outcome.
 *
 * An observation is one evaluator/witness/observation/proof of that
 * obligation. The reduction is MONOTONIC for FAIL: a valid, still-applicable
 * failure may not be overwritten by a later green observation.
 *
 * @param {object} obligation
 * @param {object[]} observations — each { obligatory, evidenceId, valid,
 *   applicable, evaluation: 'predicate_satisfied'|'predicate_contradicted',
 *   completeness: 'complete'|'incomplete', provenance }
 * @returns {{ outcome: string, reasons: string[] }}
 */
function reduceObligation(obligation, observations) {
  const reasons = [];
  const obs = Array.isArray(observations) ? observations : [];

  let haveAny = false;              // at least one valid, applicable observation
  let haveCompleteSatisfied = false;
  let haveContradiction = false;
  let haveIncompleteOrInvalid = false; // observed but untrustworthy/incomplete

  for (const o of obs) {
    if (!o || typeof o !== 'object') { haveIncompleteOrInvalid = true; reasons.push('malformed observation'); continue; }
    if (o.valid !== true) { haveIncompleteOrInvalid = true; reasons.push(`untrusted/valid=${String(o.valid)} evidence ${o.evidenceId || ''}`); continue; }
    if (obligation.mandatoryStatus === 'mandatory' && o.applicable !== true) {
      // Applicable observations must indicate applicability explicitly; a
      // non-applicable observation for a mandatory obligation cannot PASS it.
      continue;
    }
    haveAny = true;
    if (o.evaluation === 'predicate_contradicted') {
      haveContradiction = true;
      reasons.push(`applicable failure from ${o.evidenceId || '?'}`);
    } else if (o.evaluation === 'predicate_satisfied') {
      if (o.completeness === 'complete') haveCompleteSatisfied = true;
      else if (obligation.mandatoryStatus === 'mandatory') { haveIncompleteOrInvalid = true; reasons.push('incomplete applicable observation'); }
    }
  }

  if (haveContradiction) {
    return { outcome: ObligationOutcome.FAIL, reasons };
  }
  if (haveIncompleteOrInvalid) {
    // Evidence WAS offered but cannot establish a reliable result:
    // INCONCLUSIVE, never PASS (§14). This covers malformed, untrusted,
    // duplicate, or incomplete observations. Checked before MISSING so
    // that present-but-untrustworthy evidence yields INCONCLUSIVE (not MISSING).
    return { outcome: ObligationOutcome.INCONCLUSIVE, reasons: reasons.length ? reasons : ['present evidence cannot establish a reliable result'] };
  }
  if (!haveAny && obligation.mandatoryStatus === 'mandatory') {
    // No evaluator/witness/observation/proof at all: MISSING (§14).
    return { outcome: ObligationOutcome.MISSING, reasons: ['no evaluator/witness/observation/proof for mandatory obligation'] };
  }
  if (!haveCompleteSatisfied) {
    return { outcome: ObligationOutcome.INCONCLUSIVE, reasons: ['required complete applicable observation not established'] };
  }
  return { outcome: ObligationOutcome.PASS, reasons: [] };
}

/** Individual observation pre-evaluation (§16 step 5: comparison outside execution). */
function evaluateObservation({ evidenceId, predicts, actual, outcomeOfInterest, complete }) {
  // every failure to produce an authoritative observation is a MISSING/INCONCLUSIVE input,
  // never a PASS input.
  if (actual == null) return { valid: false, reason: 'no authoritative observation' };
  const satisfied = outcomeOfInterest ? (actual === outcomeOfInterest) : (actual === predicts);
  return {
    valid: true,
    evaluation: satisfied ? 'predicate_satisfied' : 'predicate_contradicted',
    completeness: complete === true ? 'complete' : 'incomplete',
  };
}

// ---------------------------------------------------------------------------
// §21 final reduction
// ---------------------------------------------------------------------------

/**
 * Deterministic final acceptance reduction (§21). Requires the preconditions in
 * the §21 block: nonempty mandatory inventory, complete coverage, every
 * mandatory obligation PASS, coherent evidence, frozen identity, no blocker.
 *
 * Returns an accepted/not-accepted decision. MISSING or INCONCLUSIVE on any
 * mandatory obligation, or an empty conjunction, is never accepted.
 *
 * @param {object} opts
 * @param {object[]} opts.inventory
 * @param {object[]} opts.obligations
 * @param {object[]} opts.observations — flat list {obligationId, ...} applicable
 * @param {boolean} opts.evidenceCoherent
 * @param {string|null} opts.frozenGenerationId
 * @param {boolean} opts.derivationEstablished
 * @param {boolean} opts.quiescenceProven
 * @param {boolean} opts.payloadManifestComplete
 * @param {boolean} opts.cleanAuthorityOwnership
 * @param {string[]} [opts.blockers]
 * @returns {{ accepted: boolean, outcome: string, assurance: string, reasons: string[] }}
 */
function reduceAcceptance({
  inventory, obligations, observations, evidenceCoherent,
  frozenGenerationId, derivationEstablished, quiescenceProven,
  payloadManifestComplete, cleanAuthorityOwnership, blockers = [],
}) {
  const reasons = [...blockers];

  // Coverage must be coherent and complete (§14 steps 1, 8).
  const cov = validateCoverage({ inventory, obligations });
  if (!cov.ok) reasons.push(...cov.problems.slice(0, 3));

  const mandatoryObligations = (obligations || []).filter((o) => o.mandatoryStatus === 'mandatory');
  if (mandatoryObligations.length === 0) {
    reasons.push('no mandatory obligations — empty conjunction cannot establish acceptance');
  }

  const obsByObligation = new Map();
  for (const o of observations || []) {
    if (!obsByObligation.has(o.obligationId)) obsByObligation.set(o.obligationId, []);
    obsByObligation.get(o.obligationId).push(o);
  }

  const failed = [];
  const notPass = [];
  for (const ob of mandatoryObligations) {
    const r = reduceObligation(ob, obsByObligation.get(ob.obligationId) || []);
    if (r.outcome !== ObligationOutcome.PASS) {
      notPass.push(`${ob.obligationId}:${r.outcome}`);
      if (r.outcome === ObligationOutcome.FAIL) failed.push(ob.obligationId);
      reasons.push(`${ob.obligationId} is ${r.outcome} — not accepted`);
    }
  }

  if (evidenceCoherent !== true) reasons.push('evidence is not coherent');
  if (!frozenGenerationId) reasons.push('no exact frozen deliverable identity');
  if (derivationEstablished !== true) reasons.push('actual source/input derivation not established');
  if (quiescenceProven !== true) reasons.push('quiescence not proven');
  if (payloadManifestComplete !== true) reasons.push('durable payload and manifest not complete');
  if (cleanAuthorityOwnership !== true) reasons.push('authority/ownership history not clean');

  if (reasons.length > 0) {
    const assurance = failed.length > 0 ? Assurance.FAILED_REQUIRED_CHECKS
      : notPass.length > 0 ? Assurance.PARTIAL
        : Assurance.UNVERIFIED;
    return { accepted: false, outcome: failed.length > 0 ? 'FAILED' : 'NOT_ACCEPTED', assurance, reasons };
  }
  return { accepted: true, outcome: 'COMPLETE', assurance: Assurance.VERIFIED_REQUIRED_CHECKS, reasons: [] };
}

// ---------------------------------------------------------------------------
// Evidence applicability (§17): generation binding, no stale reuse
// ---------------------------------------------------------------------------

/**
 * Build the evidence applicability digest binding an evidence record to its
 * exact contract/policy/profile/generation/inputs/predicate. Reuse of evidence
 * for another generation, contract revision, or predicate version is
 * prohibited (the digest differs).
 */
function evidenceApplicabilityKey({
  taskAndIncarnation, originatingAction, acceptanceContractDigest,
  predicateFamily, predicateVersion, parametersDigest, effectivePolicyRevision,
  qualifiedProfileDigest, selectedSourceBaseline, exactGenerationAndTreeDigest,
}) {
  const payload = {
    taskAndIncarnation, originatingAction, acceptanceContractDigest, predicateFamily,
    predicateVersion, parametersDigest, effectivePolicyRevision, qualifiedProfileDigest,
    selectedSourceBaseline, exactGenerationAndTreeDigest,
  };
  return sha256(canonicalJson(payload));
}

function isContentIdentity(v) { return isContentId(v); }

module.exports = {
  PredicateFamily,
  PREDICATE_FAMILIES,
  FAMILY_EVIDENCE,
  createInventoryEntry,
  createObligation,
  isInventoryEntry,
  isObligation,
  validateCoverage,
  reduceObligation,
  evaluateObservation,
  reduceAcceptance,
  evidenceApplicabilityKey,
  isContentIdentity,
};