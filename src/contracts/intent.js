'use strict';
/**
 * intent — §13 Intent Requirements: 5-way classification, provenance
 * integrity, mandatory-intent protection, and inventory digest.
 *
 * The supervisor retains the original user request unchanged and represents
 * admitted intent separately. Untrusted content MUST NOT delete mandatory
 * intent, widen authority, change trusted acceptance meaning, change safety
 * policy, or manufacture requirements or PASS evidence.
 *
 * Every function is pure (no I/O) and deterministic: a classification is
 * derived only from explicit facts, never inferred by model reasoning.
 * A fail-closed return applies when facts are absent or inconsistent.
 *
 * PRD references: §13 (Intent Requirements), §15 (Engineering Decisions),
 * §14 (Acceptance Obligations — inventory consumed without owning).
 */

const { contentId, canonicalJson } = require('./crypto.js');
const { createInventoryEntry } = require('./acceptance.js');

// ---------------------------------------------------------------------------
// §13 Intent classification (requirement 4: the five-way distinction)
// ---------------------------------------------------------------------------

const IntentClass = Object.freeze({
  USER_STATED:            'USER_STATED',            // explicit in the retained original user request
  SAFELY_INFERRED:        'SAFELY_INFERRED',        // ordinary inference, resolvable from evidence within scope
  CONSEQUENTIAL_AMBIGUITY:'CONSEQUENTIAL_AMBIGUITY', // ambiguity touching public/security/data/money/compatibility/scope, unresolved
  EXPLICIT_NON_GOAL:      'EXPLICIT_NON_GOAL',      // excluded explicitly after gap review
  UNSUPPORTED:            'UNSUPPORTED',             // beyond admitted domain; unresolved rather than disappearing
});

const INTENT_CLASSES = new Set(Object.values(IntentClass));

/** Domains where unresolved ambiguity is consequential (§13). */
const CONSEQUENTIAL_DOMAINS = new Set([
  'PUBLIC_BEHAVIOR', 'SECURITY', 'DATA', 'MONEY', 'COMPATIBILITY', 'SCOPE',
]);

/** Structural trigger categories for the §15 decision loop. */
const DECISION_TRIGGER = Object.freeze({
  SAFETY_AUTHORITY:      'SAFETY_AUTHORITY',
  HARD_STOP:             'HARD_STOP',
  CONSEQUENTIAL_AMBIGUITY:'CONSEQUENTIAL_AMBIGUITY',
  ACTIONS_NEED_RECONCILE:'ACTIONS_NEED_RECONCILE',
  EVIDENCE_INCOMPLETE:   'EVIDENCE_INCOMPLETE',
  ELIGIBLE_REPAIR:       'ELIGIBLE_REPAIR',
  ACCEPTANCE_ESTABLISHED:'ACCEPTANCE_ESTABLISHED',
  DISCRETIONARY_WORK:    'DISCRETIONARY_WORK',
});

const DECISION_TRIGGERS = new Set(Object.values(DECISION_TRIGGER));

// ---------------------------------------------------------------------------
// §13 Classification (fail-closed, deterministic)
// ---------------------------------------------------------------------------

/**
 * Deterministically classify a proposed intent record.
 *
 * Priority order (fail-closed):
 *  1. UNSUPPORTED  — outside admitted domain, unresolved rather than vanishing
 *  2. EXPLICIT_NON_GOAL — excluded after gap review, never active
 *  3. CONSEQUENTIAL_AMBIGUITY — unresolved consequential uncertainty, must
 *     terminate or require user input before mutation
 *  4. USER_STATED  — explicit and attributable to the original user request
 *  5. SAFELY_INFERRED — ordinary inference from evidence, resolvable, provenance preserved
 *  6. null         — unclassifiable, fail closed
 *
 * "An inference must never silently become a user-stated requirement." A
 * SAFELY_INFERRED entry's sourceAndProvenance must never claim 'user-request'
 * origin (that would be silent upgrade); the explicit/inferred axis is orthogonal
 * to the 5-way classification axis.
 *
 * @param {object} rec — intent record fields (see createIntent)
 * @returns {{ intentClass: string|null, problems: string[] }}
 */
function classifyIntent(rec) {
  const problems = [];
  if (!rec || typeof rec !== 'object') {
    return { intentClass: null, problems: ['classifyIntent: intent record must be an object'] };
  }

  const {
    sourceAndProvenance,
    originalMeaning,
    admittedInterpretation,
    explicitOrInferred,
    uncertainty,
    unsupported,
    excludedByContract,
    verifiedInScope,
  } = rec;

  // Rule 1: UNSUPPORTED — outside admitted domain.
  if (unsupported === true || verifiedInScope === false) {
    return {
      intentClass: IntentClass.UNSUPPORTED,
      problems: problems.concat(['requirement is outside the admitted supported domain; remains unresolved']),
    };
  }

  // Rule 2: EXPLICIT_NON_GOAL — excluded after gap review.
  if (excludedByContract === true) {
    return {
      intentClass: IntentClass.EXPLICIT_NON_GOAL,
      problems,
    };
  }

  // Rule 3: CONSEQUENTIAL_AMBIGUITY — unresolved consequential uncertainty.
  if (uncertainty && uncertainty.consequentialDomains
      && uncertainty.consequentialDomains.length > 0
      && uncertainty.resolved !== true
      && uncertainty.authorizedSafeDefault !== true) {
    return {
      intentClass: IntentClass.CONSEQUENTIAL_AMBIGUITY,
      problems: problems.concat([
        `unresolved consequential ambiguity in: ${uncertainty.consequentialDomains.join(', ')}`,
        'must terminate or require user input before mutation',
      ]),
    };
  }

  // Rule 4: USER_STATED — explicit and traceable to the original user request.
  if (explicitOrInferred === 'explicit'
      && (typeof sourceAndProvenance === 'string' && sourceAndProvenance.includes('user-request'))
      && typeof originalMeaning === 'string'
      && originalMeaning.length > 0) {
    return { intentClass: IntentClass.USER_STATED, problems };
  }

  // Rule 5: SAFELY_INFERRED — ordinary inference (provenance preserved).
  // Any explicitOrInferred=explicit but non-user-provenance is SAFELY_INFERRED
  // (downgraded: treated as inference with explicit provenance, never user-stated).
  // explicitOrInferred=inferred is also SAFELY_INFERRED (unless consequential).
  if (typeof originalMeaning === 'string' && originalMeaning.length > 0) {
    if (explicitOrInferred === 'inferred') {
      // §15/§13: inferred requirements must have rationale, scope, uncertainty.
      if (!rec.rationale || typeof rec.rationale !== 'string' || rec.rationale.length === 0) {
        problems.push('safely inferred requirement must have a rationale (provenance required for inferences)');
      }
      if (!rec.scope || typeof rec.scope !== 'string' || rec.scope.length === 0) {
        problems.push('safely inferred requirement must have a declared scope');
      }
      if (!rec.uncertainty || typeof rec.uncertainty !== 'object') {
        problems.push('safely inferred requirement must have an explicit uncertainty description');
      }
      // An inference must never silently become user-stated.
      if (sourceAndProvenance && sourceAndProvenance.includes('user-request')) {
        problems.push('inferred requirement must not claim user-request origin (provenance corruption)');
      }
      if (problems.length > 0) {
        return { intentClass: null, problems };
      }
      return { intentClass: IntentClass.SAFELY_INFERRED, problems };
    }

    // explicitOrInferred='explicit' but NOT user-request provenance: downgrade
    // to SAFELY_INFERRED (agent-proposal, memory, repository-content can never
    // silently become user-stated, §15).
    if (explicitOrInferred === 'explicit') {
      return { intentClass: IntentClass.SAFELY_INFERRED, problems };
    }
  }

  // Rule 6: unclassifiable — fail closed.
  return {
    intentClass: null,
    problems: problems.concat(['unclassifiable intent — originalMeaning or classification facts are missing']),
  };
}

// ---------------------------------------------------------------------------
// §13 Provenance integrity
// ---------------------------------------------------------------------------

/**
 * Validate that an inference has not silently been relabeled as user-stated
 * (requirement 5). Returns ok/problems. Pure over the inventory.
 *
 * @param {object[]} inventory — intent records in the store
 * @returns {{ ok: boolean, problems: string[] }}
 */
function validateProvenanceIntegrity(inventory) {
  const problems = [];
  for (const rec of inventory || []) {
    if (!rec || typeof rec !== 'object') {
      problems.push('intent inventory: malformed record');
      continue;
    }
    if (rec.explicitOrInferred === 'inferred') {
      if (rec.sourceAndProvenance
          && typeof rec.sourceAndProvenance === 'string'
          && rec.sourceAndProvenance.includes('user-request')) {
        problems.push(
          `intent ${rec.requirementId || '?'}: inferred requirement must not claim user-request origin (provenance corruption)`
        );
      }
    }
  }
  return { ok: problems.length === 0, problems };
}

/**
 * Validate that mandatory intent has not been silently deleted (requirement 6).
 * @param {object} opts
 * @param {string} opts.originalRequest — the retained original user request
 * @param {object[]} opts.intentRecords — the current intent inventory
 * @returns {{ ok: boolean, problems: string[] }}
 */
function validateMandatoryIntentIntegrity({ originalRequest, intentRecords }) {
  const problems = [];
  if (!originalRequest || typeof originalRequest !== 'string' || originalRequest.length === 0) {
    problems.push('mandatory intent integrity: original request is missing or empty');
    return { ok: false, problems };
  }
  if (!Array.isArray(intentRecords)) {
    problems.push('mandatory intent integrity: intent records must be an array');
    return { ok: false, problems };
  }
  if (intentRecords.length === 0) {
    problems.push('mandatory intent integrity: intent inventory is empty for an active task');
    return { ok: false, problems };
  }
  // Every USER_STATED entry must be traceable to the original request.
  for (const rec of intentRecords) {
    if (!rec || typeof rec !== 'object') {
      problems.push('mandatory intent integrity: malformed record');
      continue;
    }
    if (rec.intentClass === IntentClass.USER_STATED) {
      if (!rec.originalMeaning || typeof rec.originalMeaning !== 'string') {
        problems.push(`mandatory intent ${rec.requirementId || '?'}: USER_STATED entry missing originalMeaning`);
        continue;
      }
      // Provenance trace: originalMeaning must be a substring or semantically
      // attributable to the original request. We check substring containment
      // (fail closed: if the text doesn't appear, the claim is suspect).
      if (!originalRequest.includes(rec.originalMeaning)) {
        problems.push(
          `mandatory intent ${rec.requirementId}: USER_STATED originalMeaning is not traceable to the retained original request`
        );
      }
    }
  }
  return { ok: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// §13 Intent record shape
// ---------------------------------------------------------------------------

/**
 * Create a durable §13 intent record.
 * The inventory fields follow the PRD §13 shape exactly, plus the 5-way
 * intentClass (derived by classifyIntent) and content integrity (requirement 6).
 */
function createIntent({
  requirementId,
  parentRequirementOrSubconditionId = null,
  sourceAndProvenance = null,
  originalMeaning,
  admittedInterpretation,
  explicitOrInferred,
  mandatoryOrOptional,
  applicability,
  scope = null,
  rationale = null,
  uncertainty = null,
  authorizedRevision = null,
  mappedObligationIds = [],
  intentClass,
  // §15/§13 untrusted-content protection flags (all false by default)
  unsupported = false,
  excludedByContract = false,
  verifiedInScope = true,
  // Content integrity hash: invariant that originalMeaning is never silently
  // changed once frozen in a durable record.
  contentHash = null,
}) {
  if (typeof requirementId !== 'string' || requirementId.length === 0) {
    throw new Error('createIntent: requirementId required');
  }
  const computedContentHash = contentId(canonicalJson({
    requirementId,
    originalMeaning,
    mandatoryOrOptional,
    applicability,
    intentClass,
  }));
  return {
    schemaVersion: require('./records.js').SCHEMA_VERSION,
    kind: 'intent',
    requirementId,
    parentRequirementOrSubconditionId,
    sourceAndProvenance,
    originalMeaning: originalMeaning || null,
    admittedInterpretation: admittedInterpretation || null,
    explicitOrInferred: explicitOrInferred || 'explicit',
    mandatoryOrOptional: mandatoryOrOptional || 'optional',
    applicability: applicability || 'UNRESOLVED',
    scope,
    rationale,
    uncertainty,
    authorizedRevision,
    mappedObligationIds: Array.isArray(mappedObligationIds) ? mappedObligationIds.slice() : [],
    intentClass: intentClass || IntentClass.UNSUPPORTED,
    unsupported,
    excludedByContract,
    verifiedInScope,
    contentHash: contentHash || computedContentHash,
  };
}

// ---------------------------------------------------------------------------
// §13 Inventory digest (for §14 acceptance contract binding)
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic content identity over the full intent inventory.
 * The acceptance contract's inventoryDigest MUST bind this to prevent
 * inventory drift after contract freeze (§13: "freeze acceptance meaning").
 */
function intentDigest(intentRecords) {
  const sorted = (intentRecords || [])
    .slice()
    .sort((a, b) => (a.requirementId || '').localeCompare(b.requirementId || ''));
  return contentId(canonicalJson(sorted));
}

// ---------------------------------------------------------------------------
// §13 Coherence gate (integrated into coherence/§21 plane)
// ---------------------------------------------------------------------------

/**
 * Reduce intent-integrity facts for the §21 acceptance plane.
 * Called from acceptanceGates when intent records are present.
 * @param {object} opts
 * @param {object} opts.taskRecord — the task_incarnation record (carries originalRequest)
 * @param {object[]} opts.intentRecords — intent records from the store
 * @returns {{ intentIntact: boolean, problems: string[] }}
 */
function intentIntegrityGate({ taskRecord, intentRecords }) {
  const problems = [];
  const list = Array.isArray(intentRecords) ? intentRecords : [];

  if (list.length === 0) {
    return { intentIntact: false, problems: ['no intent records for an active task (§13)'] };
  }

  const classification = validateProvenanceIntegrity(list);
  if (!classification.ok) problems.push(...classification.problems);

  const originalRequest = taskRecord ? (taskRecord.originalRequest || '') : '';
  const mandatoryIntegrity = validateMandatoryIntentIntegrity({ originalRequest, intentRecords: list });
  if (!mandatoryIntegrity.ok) problems.push(...mandatoryIntegrity.problems);

  // Every entry must be classifiable (fail closed on unclassifiable).
  for (const rec of list) {
    if (!rec || typeof rec !== 'object') {
      problems.push('intentIntegrityGate: malformed record');
      continue;
    }
    if (!rec.intentClass || !INTENT_CLASSES.has(rec.intentClass)) {
      problems.push(`intent ${rec.requirementId || '?'}: unclassifiable intent — cannot gate acceptance`);
    }
    if (rec.mandatoryOrOptional === 'mandatory' && rec.applicability !== 'APPLICABLE') {
      problems.push(`intent ${rec.requirementId}: mandatory entry not APPLICABLE cannot contribute to acceptance`);
    }
  }

  return { intentIntact: problems.length === 0, problems };
}

module.exports = {
  IntentClass,
  INTENT_CLASSES,
  CONSEQUENTIAL_DOMAINS,
  DECISION_TRIGGER,
  DECISION_TRIGGERS,
  classifyIntent,
  validateProvenanceIntegrity,
  validateMandatoryIntentIntegrity,
  createIntent,
  intentDigest,
  intentIntegrityGate,
};
