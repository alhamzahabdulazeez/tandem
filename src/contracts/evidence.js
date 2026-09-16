'use strict';
/**
 * evidence — pure evidence envelope integrity and final coherence (§17).
 *
 * Each evidence item MUST bind the complete validity envelope (§17) and be
 * stored outside candidate-writable authority. This module owns:
 *   - the envelope shape and its completeness check;
 *   - the applicability-key check (evidence cannot be reused for a different
 *     generation / contract / predicate — no stale `PASS` reuse, §14);
 *   - the FINAL COHERENCE reducer across inventory / contract / policy /
 *     profile / predicate definitions / evidence / source and dependency
 *     inputs / actual derivation / frozen generation / delivery (§17).
 *
 * Everything is pure and fails closed: an evidence item missing any envelope
 * field is NOT applicable; a coherence check that cannot be established is NOT
 * coherent. No MISSING/INCONCLUSIVE evidence can certify acceptance (§21).
 */

const { canonicalJson, sha256 } = require('./crypto.js');

// §17. A complete applicability envelope.
const ENVELOPE_FIELDS = [
  'taskAndIncarnation',
  'originatingOwnerAndAction',
  'acceptanceContractDigest',
  'requirementObligationAndPredicateIdentity',
  'predicateVersionParametersAndExpectedValues',
  'effectivePolicyRevision',
  'qualifiedProfileDigest',
  'selectedSourceBaseline',
  'exactCandidateGenerationAndTreeDigest',
  'actualSourceDependencyConfigurationEnvironmentInputs',
  'runtimeToolchainAndLaunchIdentity',
  'discoverySelectionAndExecutionScope',
  'artifactDerivationIfApplicable',
  'observationInterval',
  'completionTimeoutSignalAndTruncationState',
  'provenance',
  'conflictsInvalidationsAndSupersession',
];

/**
 * Create an evidence record. Envelope fields are required (non-null for the
 * fields that are normative for the exact slice); a record missing any field
 * fails {\p envelopeComplete} checks.
 */
function createEvidence({
  evidenceId, observationPath, classification = 'supporting', envelope = {},
}) {
  return {
    schemaVersion: 1,
    kind: 'evidence',
    evidenceId,
    observationPath,          // where the observation was actually taken
    classification,           // 'supporting' | 'authoritative' — candidate-
                              // generated reports stay 'supporting' even if copied
                              // into protected storage (§17)
    envelope,
    capturedAt: null,
    applicabilityKey: null,   // evidenceApplicabilityKey() result, set by caller
  };
}

/**
 * Envelope completeness. FAILS CLOSED: every §17 field must be present and
 * non-null. A missing field means the evidence cannot establish its own
 * validity interval.
 */
function envelopeComplete(evidence) {
  const problems = [];
  if (!evidence || typeof evidence !== 'object') return { ok: false, problems: ['no evidence record'] };
  const env = evidence.envelope || {};
  for (const field of ENVELOPE_FIELDS) {
    const v = env[field];
    if (v === undefined || v === '') {
      problems.push(`envelope missing "${field}"`);
      continue;
    }
    // artifactDerivationIfApplicable is legitimately null when the slice has no
    // artifact derivation (§16: generated artifacts as declared retained inputs,
    // not an undeclared build dependency). Absence (undefined) is still a gap;
    // an explicit null is a truthful "none".
    if (field === 'artifactDerivationIfApplicable') continue;
    if (v === null) problems.push(`envelope field "${field}" must not be null`);
  }
  if (typeof evidence.evidenceId !== 'string' || evidence.evidenceId.length === 0) {
    problems.push('evidence.evidenceId required');
  }
  if (typeof evidence.observationPath !== 'string' || evidence.observationPath.length === 0) {
    problems.push('evidence.observationPath required (observation path must be identified, §17)');
  }
  return { ok: problems.length === 0, problems };
}

/**
 * Candidate-generated reports cannot become authoritative just by inhabiting
 * protected storage. Reports authored by the candidate retain 'supporting'
 * classification; only a protected external observer's record may be
 * authoritative.
 */
function authoritative({ evidence, observerQualified }) {
  if (!observerQualified) return { ok: false, reason: 'no qualified external observer; evidence cannot be authoritative' };
  if (evidence && evidence.classification === 'authoritative') return { ok: true, reason: null };
  return { ok: false, reason: 'evidence is not authoritative (candidate-generated or unclassified)' };
}

/**
 * Coherence of a single evidence item against its applicability key: the
 * stored applicability key MUST match the freshly recomputed key for the
 * current contract/policy/profile/generation/view. A mismatch means the
 * evidence is stale or foreign and MUST NOT certify the current frozen
 * generation (§14 supersession; §17 mutation invalidation).
 */
function evidenceApplicable(evidence, expectedKey) {
  if (!expectedKey) return { applicable: false, reason: 'no expected applicability key' };
  if (!evidence || typeof evidence !== 'object') return { applicable: false, reason: 'no evidence' };
  if (evidence.applicabilityKey !== expectedKey) {
    return { applicable: false, reason: 'evidence applicabilityKey does not match current contract/policy/profile/generation' };
  }
  const complete = envelopeComplete(evidence);
  if (!complete.ok) return { applicable: false, reason: 'incomplete envelope: ' + complete.problems[0] };
  return { applicable: true, reason: null };
}

/**
 * The final §17 coherence check. Establishes ONE consistent acceptance state
 * across the ten listed domains. Any domain that cannot be established makes
 * the whole check not-coherent (never a vacuous yes).
 *
 * @param {object} state — { inventory, contract, policy, profile, predicates,
 *   evidence, sourceAndDependencyInputs, actualDerivation, frozenGeneration,
 *   delivery }
 * @returns {{ coherent: boolean, gaps: string[] }}
 */
function finalCoherence(state) {
  const gaps = [];
  const s = state || {};
  const require = (name, cond) => { if (!cond) gaps.push(name); };

  require('inventory', !!(s.inventory && Array.isArray(s.inventory) && s.inventory.length > 0));
  require('contract', !!s.contract);                 // acceptance-contract digest
  require('policy', !!s.policy);                     // effective policy revision
  require('profile', !!s.profile);                   // qualified profile digest
  require('predicates', !!s.predicates);             // pinned predicate definitions
  require('evidence', !!(s.evidence && Array.isArray(s.evidence) && s.evidence.length > 0));
  require('sourceAndDependencyInputs', !!s.sourceAndDependencyInputs);
  require('actualDerivation', s.actualDerivation === true);
  require('frozenGeneration', !!s.frozenGeneration); // exact frozen generation/tree digest
  require('delivery', !!s.delivery);                 // delivery representation identity

  return { coherent: gaps.length === 0, gaps };
}

/**
 * §17 degree of input closure demanded by the profile. Hashing an arbitrarily
 * selected subset is NOT input closure.
 */
function inputClosureState(state) {
  const required = [
    'selectedSourceBaseline', 'actualSourceDependencyConfigurationEnvironmentInputs',
    'runtimeToolchainAndLaunchIdentity', 'discoverySelectionAndExecutionScope',
  ];
  const missing = required.filter((k) => {
    const v = state && state.sourceAndDependencyInputs ? state.sourceAndDependencyInputs[k] : undefined;
    return v === undefined || v === null || v === '';
  });
  return { closed: missing.length === 0, missing };
}

module.exports = {
  ENVELOPE_FIELDS,
  createEvidence,
  envelopeComplete,
  authoritative,
  evidenceApplicable,
  finalCoherence,
  inputClosureState,
};