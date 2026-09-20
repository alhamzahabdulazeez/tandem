'use strict';
/**
 * decisions — §15 Engineering Decisions: deterministic priority-ordered
 * decision loop, minimum-sufficient context selection, and static capability
 * registry.
 *
 * The supervisor applies hard authority, safety, ownership, budget, and
 * acceptance constraints before selecting the minimum sufficient next action.
 * The coding agent remains the code-level planner — the supervisor MUST NOT
 * introduce a competing detailed implementation plan or repeated multi-model
 * planning loop.
 *
 * Every function is pure (no I/O, no model calls) and deterministic: a
 * decision is derived from explicit durable facts, never model reasoning.
 * Safety/authority/ownership/control-integrity failures have HIGHEST priority;
 * efficiency and discretionary work have LOWEST priority.
 *
 * PRD references: §15 (Engineering Decisions), §13 (Intent Requirements),
 * §14 (Acceptance Obligations), §18 (Bounded Repair), §19 (Universal
 * Finalization), §21 (Acceptance Reduction).
 */

const { IntentClass, DECISION_TRIGGER } = require('./intent.js');
const { REPAIR_CEILING } = require('./repair.js');
const { ObligationOutcome } = require('./records.js');

// ---------------------------------------------------------------------------
// §15 Decision loop (8 prioritised gates, fail-closed)
// ---------------------------------------------------------------------------

/**
 * §15 prioritised decision gates. Safety/authority has HIGHEST priority;
 * discretionary work has LOWEST. Every gate is explicit and deterministic.
 */
const DECISION_GATES = Object.freeze([
  DECISION_TRIGGER.SAFETY_AUTHORITY,
  DECISION_TRIGGER.HARD_STOP,
  DECISION_TRIGGER.CONSEQUENTIAL_AMBIGUITY,
  DECISION_TRIGGER.ACTIONS_NEED_RECONCILE,
  DECISION_TRIGGER.EVIDENCE_INCOMPLETE,
  DECISION_TRIGGER.ELIGIBLE_REPAIR,
  DECISION_TRIGGER.ACCEPTANCE_ESTABLISHED,
  DECISION_TRIGGER.DISCRETIONARY_WORK,
]);

/**
 * Reduce a structured situation into the next highest-priority decision.
 * The reducer is monotonic: safety/authority always wins over efficiency.
 * An empty or contradictory situation fails closed to HARD_STOP.
 *
 * @param {object} facts — durable situation facts (see each field)
 * @returns {{ trigger: string, problems: string[], details: object }}
 *   trigger = DECISION_TRIGGER value; problems = empty when a clear decision
 *   is made; details = any supplementary fact (e.g., eligible repair id, etc).
 */
function decideNextAction(facts = {}) {
  const problems = [];

  const {
    // Priority 1: safety / authority / ownership / control-integrity failure
    safetyOrAuthorityFailure = false,
    authorityRetired = false,
    ownershipDisputed = false,

    // Priority 2: hard stop / cancellation
    cancellationRequested = false,
    budgetExhausted = false,
    safetyStopTriggered = false,

    // Priority 3: consequential ambiguity (must terminate or require user)
    consequentialAmbiguityUnresolved = false,

    // Priority 4: admitted actions need reconciliation before resource reuse
    admittedActionsUnresolved = false,
    resourceReusePending = false,

    // Priority 5: required evidence for current frozen generation
    currentGenerationFrozen = false,
    evidenceRequired = true,
    evidenceComplete = false,

    // Priority 6: one eligible repair
    eligibleRepairConditionsHold = false,
    repairAllowanceAvailable = true,
    repairCount = 0,

    // Priority 7: acceptance established
    acceptanceEstablished = false,

    // Priority 8: discretionary work
    discretionaryWorkJustified = false,
    identifiedRequirement = null,
    contextExpansionJustified = false,
  } = facts;

  // ------------------------------------------------------------------
  // Gate 1 (highest): safety / authority / ownership / control-integrity
  // ------------------------------------------------------------------
  if (safetyOrAuthorityFailure === true) {
    problems.push('safety, authority, ownership, or control-integrity failure: closing admission immediately');
    return {
      trigger: DECISION_TRIGGER.SAFETY_AUTHORITY,
      problems,
      details: { ownershipDisputed, authorityRetired },
    };
  }

  // ------------------------------------------------------------------
  // Gate 2: cancellation and hard stop conditions
  // ------------------------------------------------------------------
  if (cancellationRequested === true || budgetExhausted === true || safetyStopTriggered === true) {
    const reasons = [];
    if (cancellationRequested) reasons.push('cancellation requested');
    if (budgetExhausted) reasons.push('budget exhausted');
    if (safetyStopTriggered) reasons.push('safety stop triggered');
    return {
      trigger: DECISION_TRIGGER.HARD_STOP,
      problems,
      details: { reasons },
    };
  }

  // ------------------------------------------------------------------
  // Gate 3: consequential ambiguity must terminate or require user input
  //          BEFORE mutation
  // ------------------------------------------------------------------
  if (consequentialAmbiguityUnresolved === true) {
    problems.push('unresolved consequential ambiguity: must terminate or require user input before any mutation');
    return {
      trigger: DECISION_TRIGGER.CONSEQUENTIAL_AMBIGUITY,
      problems,
      details: {},
    };
  }

  // ------------------------------------------------------------------
  // Gate 4: reconcile admitted actions before resource reuse
  // ------------------------------------------------------------------
  if (admittedActionsUnresolved === true || resourceReusePending === true) {
    return {
      trigger: DECISION_TRIGGER.ACTIONS_NEED_RECONCILE,
      problems,
      details: { admittedActionsUnresolved, resourceReusePending },
    };
  }

  // ------------------------------------------------------------------
  // Gate 5: complete required evidence for the current frozen generation
  // ------------------------------------------------------------------
  if (currentGenerationFrozen === true && evidenceRequired === true && evidenceComplete !== true) {
    return {
      trigger: DECISION_TRIGGER.EVIDENCE_INCOMPLETE,
      problems,
      details: {},
    };
  }

  // ------------------------------------------------------------------
  // Gate 6: admit the one eligible repair only when its conditions hold
  // ------------------------------------------------------------------
  if (eligibleRepairConditionsHold === true && repairAllowanceAvailable === true && repairCount < REPAIR_CEILING) {
    return {
      trigger: DECISION_TRIGGER.ELIGIBLE_REPAIR,
      problems,
      details: { ceiling: REPAIR_CEILING, currentCount: repairCount },
    };
  }

  // ------------------------------------------------------------------
  // Gate 7: prepare immutable delivery and stop when acceptance established
  // ------------------------------------------------------------------
  if (acceptanceEstablished === true) {
    return {
      trigger: DECISION_TRIGGER.ACCEPTANCE_ESTABLISHED,
      problems,
      details: {},
    };
  }

  // ------------------------------------------------------------------
  // Gate 8 (lowest): justified discretionary work
  // ------------------------------------------------------------------
  if (discretionaryWorkJustified === true && identifiedRequirement) {
    return {
      trigger: DECISION_TRIGGER.DISCRETIONARY_WORK,
      problems,
      details: { identifiedRequirement, contextExpansionJustified },
    };
  }

  // Fail closed: no clear next action identified — treat as HARD_STOP
  // (an unclassifiable decision is never permitted).
  return {
    trigger: DECISION_TRIGGER.HARD_STOP,
    problems: problems.concat(['no lawful next action identified — fail closed to hard stop']),
    details: {},
  };
}

// ---------------------------------------------------------------------------
// §15 Context selection (smallest sufficient)
// ---------------------------------------------------------------------------

/**
 * Select the minimum-sufficient context subset for an admitted requirement.
 *
 * §15: "Start with the smallest relevant source set. Expand only when missing
 * facts, interfaces, consumers, configuration, or verification justify it.
 * Retain provenance and validity conditions for task-local facts."
 *
 * Determination is a greedy minimal covering in candidate order (ties never
 * resolved toward "more context"). `initialSelection` carries the context that
 * was ALREADY settled — when an obligation's fact needs outgrow it, and only
 * then, the selection expands to the smallest set of additional sources that
 * provide the genuinely missing fact types. When no initial selection exists,
 * the minimal covering IS the initial selection, so `expanded` stays false
 * (nothing was grown). A fact type no source can provide is never imported
 * arbitrarily: it is flagged as an unresolved obligation.
 *
 * @param {object} opts
 * @param {object[]} opts.candidateSources — available source items ({ id, provides[] })
 * @param {string[]} opts.requiredFactTypes — what the obligation actually
 *   needs (e.g., ['interface', 'consumer', 'config'])
 * @param {object}   [opts.discoveryResults] — facts already known in scope
 * @param {string[]} [opts.initialSelection] — ids already settled in context
 * @returns {{ selected: object[], expanded: boolean, problems: string[] }}
 *   `expanded` = true only when the settled context had to GROW to satisfy a
 *   genuinely missing fact type.
 */
function selectContext({
  candidateSources = [],
  requiredFactTypes = [],
  discoveryResults = {},
  initialSelection = [],
}) {
  const problems = [];
  const knownFacts = new Set(Object.keys(discoveryResults || {}));
  const byId = new Map((candidateSources || []).filter((s) => s && s.id != null).map((s) => [s.id, s]));

  // Start from the settled context (default: nothing settled yet).
  const selected = [];
  const covered = new Set(knownFacts);
  const picked = new Set();
  const push = (s) => {
    picked.add(s.id);
    selected.push(s);
    for (const f of (s.provides || [])) covered.add(f);
  };
  for (const id of initialSelection) {
    const s = byId.get(id);
    if (s) push(s);
  }

  // Minimal covering: in candidate order, each source that introduces a
  // still-missing required fact is the smallest next addition (never "more
  // context for safety", §15).
  for (const s of candidateSources || []) {
    if (!s || typeof s !== 'object' || picked.has(s.id)) continue;
    const bringsRequired = (s.provides || []).some((f) => requiredFactTypes.includes(f) && !covered.has(f));
    if (bringsRequired) push(s);
  }

  // Expansion happened only when the settled context had to grow.
  const expanded = initialSelection.length > 0
    && selected.some((s) => !initialSelection.includes(s.id));

  // §15: expansion must be justified; a fact no source can supply is an
  // unresolved obligation, never a license to import arbitrary sources.
  const missingFactTypes = requiredFactTypes.filter((f) => !covered.has(f));
  for (const f of missingFactTypes) {
    problems.push(`fact type "${f}" not providable by any available source — obligation remains unresolved`);
  }

  // §15: scope/enforcement check — every selected source must be within the
  // readable-data/disclosure scope; no external network/credential sources
  // without explicit admission.
  for (const s of selected) {
    if (s.outOfScope === true) {
      problems.push(`source ${s.id || '?'} is outside the readable-data scope and must not be included`);
    }
  }

  return { selected, expanded, problems };
}

// ---------------------------------------------------------------------------
// §15 Static capability registry (minimal, §15: "static and small")
// ---------------------------------------------------------------------------

/**
 * Each declared capability must carry: identity, I/O contract, effect scope,
 * trust classification, permissions, network/disclosure, runtime enforcement,
 * max resource exposure, failure/replay, and evidence it can produce.
 *
 * The first slice does not require an analyzer installation; the registry
 * is intentionally minimal.
 */
const CAPABILITY_REGISTRY = Object.freeze([
  {
    identityAndVersion: 'protected-cli-observer@1',
    inputOutputContract: 'command args in → stdout/stderr/exit/signal out',
    supportedTaskAndProjectShape: 'small JS single-package project with node',
    directAndTransitiveEffectScope: 'read-only execution of admitted commands',
    trustClassification: 'TRUSTED',
    permissions: ['execute_admitted_command'],
    networkAndDisclosureNeeds: [],
    runtimeEnforcement: 'isolated-scratch',
    maximumResourceExposure: 'soft-target-bounded',
    failureAndReplayBehavior: 'deterministic-replay',
    evidenceItCanActuallyProduce: ['stdout', 'stderr', 'exit_code', 'exit_signal', 'timeout'],
    rank: 1, // native deterministic — preferred
  },
  {
    identityAndVersion: 'trusted-inspection-reader@1',
    inputOutputContract: 'file path in → bytes/hash out',
    supportedTaskAndProjectShape: 'any source file in readable scope',
    directAndTransitiveEffectScope: 'read-only file access within admitted roots',
    trustClassification: 'TRUSTED',
    permissions: ['read_file'],
    networkAndDisclosureNeeds: [],
    runtimeEnforcement: 'path-bounded',
    maximumResourceExposure: 'file-size-limited',
    failureAndReplayBehavior: 'deterministic',
    evidenceItCanActuallyProduce: ['file_hash', 'file_content', 'tree_enumeration'],
    rank: 1, // native deterministic
  },
  {
    identityAndVersion: 'admitted-static-analyzer@1',
    inputOutputContract: 'source path in → findings out',
    supportedTaskAndProjectShape: 'narrowly admitted project shape',
    directAndTransitiveEffectScope: 'read-only analysis of admitted source',
    trustClassification: 'ADMITTED',
    permissions: ['analyze_admitted_source'],
    networkAndDisclosureNeeds: [],
    runtimeEnforcement: 'isolated-scratch',
    maximumResourceExposure: 'analysis-limited',
    failureAndReplayBehavior: 'deterministic-replay',
    evidenceItCanActuallyProduce: ['static_findings'],
    rank: 2, // admitted analyzer — after native
  },
  {
    identityAndVersion: 'model-reasoning@1',
    inputOutputContract: 'prompt in → structured reasoning out',
    supportedTaskAndProjectShape: 'only where deterministic evidence is insufficient',
    directAndTransitiveEffectScope: 'NO mutation, NO admission, advisory only',
    trustClassification: 'UNTRUSTED',
    permissions: ['propose'],
    networkAndDisclosureNeeds: ['requires_disclosed_read_only_context'],
    runtimeEnforcement: 'none — advisory only',
    maximumResourceExposure: 'budget-limited',
    failureAndReplayBehavior: 'non-deterministic',
    evidenceItCanActuallyProduce: ['proposal_text'],
    rank: 3, // lowest: model reasoning, last resort
  },
]);

const CAPABILITY_RANKS = Object.freeze({
  NATIVE_DETERMINISTIC: 1,
  ADMITTED_ANALYZER: 2,
  MODEL_REASONING: 3,
});

/**
 * Select the minimum qualified capability that answers the necessary question.
 * §15: "prefer native deterministic mechanisms, trusted search/inspection,
 * then any specifically admitted analyzer, then model reasoning where
 * deterministic evidence is insufficient."
 *
 * @param {object} opts
 * @param {string} opts.questionType — e.g. 'exit_behavior', 'file_hash', 'static_analysis'
 * @param {string[]} opts.requiredEvidence — evidence the capability must produce
 * @param {object}   [opts.contextExpansionJustified] — whether expansion was justified
 * @returns {{ selected: object|null, rank: number|null, problems: string[] }}
 */
function selectCapability({ questionType, requiredEvidence = [], contextExpansionJustified = false }) {
  const problems = [];
  if (!questionType || typeof questionType !== 'string') {
    return { selected: null, rank: null, problems: ['selectCapability: questionType required'] };
  }

  // Find the lowest-rank (best) capability that can produce ALL required evidence.
  const candidates = CAPABILITY_REGISTRY.filter((cap) => {
    return requiredEvidence.every((e) => cap.evidenceItCanActuallyProduce.includes(e));
  }).sort((a, b) => a.rank - b.rank);

  if (candidates.length === 0) {
    problems.push(`no capability in the static registry can produce evidence: [${requiredEvidence.join(', ')}]`);
    return { selected: null, rank: null, problems };
  }

  const best = candidates[0];

  // §15: model reasoning (rank 3) may only be selected when deterministic
  // evidence is genuinely insufficient — that requires context expansion to
  // be explicitly justified.
  if (best.rank === CAPABILITY_RANKS.MODEL_REASONING && !contextExpansionJustified) {
    problems.push(
      'model reasoning selected but context expansion not justified — deterministic capability must be exhausted first'
    );
    return { selected: null, rank: null, problems };
  }

  return { selected: best, rank: best.rank, problems };
}

// ---------------------------------------------------------------------------
// §15 Impact analysis (distinguishable from verification per §15)
// ---------------------------------------------------------------------------

/**
 * §15: "Impact analysis MUST remain distinguishable from verification. It must
 * record input identities, assumptions, discovery limits, unsupported dynamic
 * behavior, and uncertainty."
 *
 * @param {object} opts
 * @param {object[]} opts.inputs — input facts/identities
 * @param {string[]} opts.discovered — facts discovered by search/inspection
 * @param {number}   opts.discoveryLimit — maximum sources inspected
 * @param {boolean}  opts.hasUnresolvedDynamic — whether dynamic behavior is unknown
 * @returns {{ impact: string, assumptions: string[], uncertainty: string[] }}
 */
function impactAnalysis({ inputs = [], discovered = [], discoveryLimit = 0, hasUnresolvedDynamic = false }) {
  const assumptions = [];
  const uncertainty = [];

  if (inputs.length < discoveryLimit) {
    assumptions.push('all relevant source inputs are within the discovery limit');
  }
  if (hasUnresolvedDynamic) {
    uncertainty.push('dynamic runtime behavior is not statically determinable — unverified');
  }
  if (discovered.length === 0) {
    assumptions.push('empty discovery set may indicate no impact or insufficient search');
  }

  return {
    impact: `impacted scope: ${inputs.length} inputs, ${discovered.length} discovered facts, limit=${discoveryLimit}`,
    assumptions,
    uncertainty,
  };
}

// ---------------------------------------------------------------------------
// §15 Review classification (bounded read-only task-diff review)
// ---------------------------------------------------------------------------

const ReviewClassification = Object.freeze({
  DETERMINISTIC_FACT:  'DETERMINISTIC_FACT',   // within qualified scope → may gate acceptance
  AUTHORIZED_RULE:      'AUTHORIZED_RULE',       // explicit project rule → enforced per obligation
  HEURISTIC_JUDGMENT:   'HEURISTIC_JUDGMENT',    // advisory only — cannot invalidate acceptance alone
});

/**
 * §15 bounded read-only review of a proposed change. Returns classifications
 * per item. Heuristic quality opinions MUST NOT invalidate otherwise sound
 * acceptance by themselves.
 *
 * @param {object[]} items — proposed review items [{ id, isDeterministicFact, isAuthorizedRule }]
 * @returns {object[]}
 */
function reviewClassifications(items = []) {
  return items.map((item) => {
    if (!item || typeof item !== 'object') return { id: null, classification: ReviewClassification.HEURISTIC_JUDGMENT, advisory: true };
    if (item.isDeterministicFact) return { id: item.id, classification: ReviewClassification.DETERMINISTIC_FACT, advisory: false };
    if (item.isAuthorizedRule) return { id: item.id, classification: ReviewClassification.AUTHORIZED_RULE, advisory: false };
    return { id: item.id, classification: ReviewClassification.HEURISTIC_JUDGMENT, advisory: true };
  });
}

module.exports = {
  DECISION_GATES,
  decideNextAction,
  selectContext,
  CAPABILITY_REGISTRY,
  CAPABILITY_RANKS,
  selectCapability,
  impactAnalysis,
  ReviewClassification,
  reviewClassifications,
};
