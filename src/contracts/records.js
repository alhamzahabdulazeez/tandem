'use strict';
/**
 * Durable record definitions for TANDEM's state store.
 *
 * This module defines the shapes, enums, and ID generation for every
 * authoritative record type required by the Master PRD (§6).
 *
 * These are SCHEMA DEFINITIONS, not a runtime store implementation.
 * The actual durable store (with locking, epochs, transactions) requires
 * a Gate-0-qualified runtime profile before it can be implemented.
 *
 * PRD reference: §6 (Durable Records), §7 (State Machine)
 */

const crypto = require('node:crypto');

// ---------------------------------------------------------------------------
// Schema version — incremented on breaking record-shape changes
// ---------------------------------------------------------------------------

const SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

/** Task lifecycle phases (§7) */
const TaskPhase = Object.freeze({
  RECEIVED:    'RECEIVED',
  AUDITING:    'AUDITING',
  PLANNING:    'PLANNING',
  READY:       'READY',
  EXECUTING:   'EXECUTING',
  VERIFYING:   'VERIFYING',
  REPAIRING:   'REPAIRING',
  FINALIZING:  'FINALIZING',
  TERMINAL:    'TERMINAL',
});

/** Terminal execution results (§7) */
const TerminalResult = Object.freeze({
  COMPLETE:               'COMPLETE',
  COMPLETE_WITH_LIMITATION: 'COMPLETE_WITH_LIMITATION',
  FAILED:                 'FAILED',
  BLOCKED:                'BLOCKED',
  NEEDS_USER:             'NEEDS_USER',
  CANCELLED:              'CANCELLED',
  SAFETY_STOP:            'SAFETY_STOP',
  BUDGET_EXHAUSTED:       'BUDGET_EXHAUSTED',
  UNRESOLVED_EXECUTION:   'UNRESOLVED_EXECUTION',
});

/** Action lifecycle states (§7) */
const ActionLifecycle = Object.freeze({
  PROPOSED:  'PROPOSED',
  ADMITTED:  'ADMITTED',
  REFUSED:   'REFUSED',
  OBSERVING: 'OBSERVING',
  RECONCILING: 'RECONCILING',
  SETTLED:   'SETTLED',
});

/** Action dispatch states (§7) */
const ActionDispatch = Object.freeze({
  NOT_ATTEMPTED:        'NOT_ATTEMPTED',
  KNOWN_NOT_DISPATCHED: 'KNOWN_NOT_DISPATCHED',
  ACKNOWLEDGED:         'ACKNOWLEDGED',
  UNKNOWN:              'UNKNOWN',
});

/** Action execution observation states (§7) */
const ActionExecution = Object.freeze({
  PENDING:   'PENDING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED:    'FAILED',
  CANCELLED: 'CANCELLED',
  TIMED_OUT: 'TIMED_OUT',
  UNKNOWN:   'UNKNOWN',
});

/** Use allowance states (§7) */
const UseAllowance = Object.freeze({
  UNCONSUMED: 'UNCONSUMED',
  CONSUMED:   'CONSUMED',
});

/** Liability states (§7) */
const Liability = Object.freeze({
  RESERVED:            'RESERVED',
  PARTIALLY_SETTLED:   'PARTIALLY_SETTLED',
  SETTLED:             'SETTLED',
  CONSERVATIVELY_CONSUMED: 'CONSERVATIVELY_CONSUMED',
});

/** Resource disposition states (§7) */
const ResourceDisposition = Object.freeze({
  ACTIVE:         'ACTIVE',
  FENCED:         'FENCED',
  QUARANTINED:    'QUARANTINED',
});

/** Generation mutation states (§7) */
const GenerationState = Object.freeze({
  MUTABLE:         'MUTABLE',
  MUTATION_CLOSED: 'MUTATION_CLOSED',
  FROZEN:          'FROZEN',
});

/** Policy lifecycle stages (§8) */
const PolicyStage = Object.freeze({
  PROPOSED:   'PROPOSED',
  AUTHORIZED: 'AUTHORIZED',
  EFFECTIVE:  'EFFECTIVE',
  ENFORCED:   'ENFORCED',
  FENCED:     'FENCED',
});

/** Obligation outcomes (§14) */
const ObligationOutcome = Object.freeze({
  PASS:        'PASS',
  FAIL:        'FAIL',
  MISSING:     'MISSING',
  INCONCLUSIVE: 'INCONCLUSIVE',
});

/** Assurance levels (§21) */
const Assurance = Object.freeze({
  VERIFIED_REQUIRED_CHECKS: 'VERIFIED_REQUIRED_CHECKS',
  FAILED_REQUIRED_CHECKS:   'FAILED_REQUIRED_CHECKS',
  PARTIAL:                  'PARTIAL',
  UNVERIFIED:               'UNVERIFIED',
});

/** Release disposition (§30) */
const ReleaseDisposition = Object.freeze({
  RELEASE_READY_FOR_DECLARED_PROFILE: 'RELEASE_READY_FOR_DECLARED_PROFILE',
  CHECKER_ONLY:                       'CHECKER_ONLY',
  BLOCKED:                            'BLOCKED',
  VALUE_NOT_ESTABLISHED:              'VALUE_NOT_ESTABLISHED',
});

/** Reuse classification for code mapping (§26) */
const ReuseClass = Object.freeze({
  KEEP:    'KEEP',
  MODIFY:  'MODIFY',
  REFACTOR: 'REFACTOR',
  WRAP:    'WRAP',
  REPLACE: 'REPLACE',
  REMOVE:  'REMOVE',
  DEFER:   'DEFER',
});

/** Capability admission decision (§29) */
const AdmissionDecision = Object.freeze({
  ADMITTED:  'ADMITTED',
  DEFERRED:  'DEFERRED',
  REMOVED:   'REMOVED',
  BLOCKED:   'BLOCKED',
});

// ---------------------------------------------------------------------------
// Sets of valid values for validation
// ---------------------------------------------------------------------------

const TERMINAL_PHASES = new Set([TaskPhase.TERMINAL]);

const LIVE_PHASES = new Set([
  TaskPhase.RECEIVED,
  TaskPhase.AUDITING,
  TaskPhase.PLANNING,
  TaskPhase.READY,
  TaskPhase.EXECUTING,
  TaskPhase.VERIFYING,
  TaskPhase.REPAIRING,
  TaskPhase.FINALIZING,
]);

const TERMINAL_RESULTS = new Set(Object.values(TerminalResult));

const NON_SUCCESS_RESULTS = new Set([
  TerminalResult.FAILED,
  TerminalResult.BLOCKED,
  TerminalResult.NEEDS_USER,
  TerminalResult.CANCELLED,
  TerminalResult.SAFETY_STOP,
  TerminalResult.BUDGET_EXHAUSTED,
  TerminalResult.UNRESOLVED_EXECUTION,
]);

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

let _clockSource = null;

/**
 * Generate a non-reusable identifier within its namespace.
 * Format: `<type>-<timestamp>-<random>` (e.g. `task-1700000000000-a1b2c3`)
 *
 * @param {string} type — namespace prefix (task, incarnation, action, etc.)
 * @param {{ now?: () => number, randomBytes?: (n: number) => Buffer }} [opts]
 * @returns {string}
 */
function generateId(type, opts) {
  if (!type || typeof type !== 'string') {
    throw new Error('generateId: type must be a non-empty string');
  }
  const now = (opts && opts.now) || Date.now;
  const randomBytes = (opts && opts.randomBytes) || ((n) => crypto.randomBytes(n));
  const ts = now();
  const rand = randomBytes(8).toString('hex');
  return `${type}-${ts}-${rand}`;
}

/**
 * Create a clock source for deterministic testing.
 * @param {() => number} fn — returns millisecond timestamps
 * @returns {{ restore: () => void }}
 */
function useClock(fn) {
  const prev = _clockSource;
  _clockSource = fn;
  return { restore() { _clockSource = prev; } };
}

// ---------------------------------------------------------------------------
// Record factory functions (shape constructors)
// ---------------------------------------------------------------------------

/**
 * Create a new Store/Owner record (§6).
 * @param {object} params
 * @param {string} params.canonicalStorePath
 * @param {string} params.lockIdentity
 * @param {string} params.ownerIdentity
 * @returns {object}
 */
function createStoreOwner({ canonicalStorePath, lockIdentity, ownerIdentity }) {
  return Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    kind: 'store_owner',
    canonicalStorePath,
    lockIdentity,
    ownerIdentity,
    currentEpoch: 0,
    recoveryState: 'NORMAL',
  });
}

/**
 * Create a new Lineage record (§6).
 * @param {object} params
 * @param {string} params.lineageId
 * @param {string} params.createdAt
 * @returns {object}
 */
function createLineage({ lineageId, createdAt }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'lineage',
    lineageId,
    createdAt,
    aggregateAllocation: null,
    settledConsumption: null,
    outstandingLiabilities: null,
    retainedResourceCommitments: null,
  };
}

/**
 * Create a new Task/Incarnation record (§6).
 * @param {object} params
 * @param {string} params.taskId
 * @param {string} params.lineageId
 * @param {string} params.incarnationId
 * @param {string} params.ownerEpoch
 * @param {string} params.originalRequest
 * @param {string} params.selectedSourceCommit
 * @returns {object}
 */
function createTaskIncarnation({
  taskId, lineageId, incarnationId, ownerEpoch,
  originalRequest, selectedSourceCommit,
  runtimeProfileId = null,   // §6 Task/incarnation carries the profile digest/
                             // identity the admission gate qualifies (§5).
}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'task_incarnation',
    taskId,
    lineageId,
    incarnationId,
    ownerEpoch,
    originalRequest,
    selectedSourceCommit,
    runtimeProfileId,
    admittedIntent: null,
    phase: TaskPhase.RECEIVED,
    incarnationStatus: 'ACTIVE',
    deadlines: null,
  };
}

/**
 * Create a new Action/Grant record (§6).
 * @param {object} params
 * @param {string} params.actionId
 * @param {string} params.incarnationId
 * @param {string} params.ownerEpoch
 * @param {string} params.operation — immutable operation description
 * @param {string} params.targetGeneration
 * @returns {object}
 */
function createAction({
  actionId, incarnationId, ownerEpoch, operation, targetGeneration,
}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'action',
    actionId,
    incarnationId,
    ownerEpoch,
    effectivePolicyRevision: null,
    qualifiedProfileDigest: null,
    qualifiedExecutorIdentity: null,
    operation,
    targetGeneration,
    inputPayloadIdentity: null,
    filesystemProcessNetworkScope: null,
    commandArgumentsEnvironmentWorkingRoot: null,
    useAllowance: UseAllowance.UNCONSUMED,
    liability: Liability.RESERVED,
    lifecycle: ActionLifecycle.PROPOSED,
    dispatch: ActionDispatch.NOT_ATTEMPTED,
    execution: ActionExecution.PENDING,
    resourceDisposition: ResourceDisposition.ACTIVE,
    creationTime: null,
    nonextendableExpiry: null,
    resourceMaximums: null,
  };
}

/**
 * Create a new Policy record (§6, §8).
 * @param {object} params
 * @param {string} params.policyId
 * @param {string} params.incarnationId
 * @returns {object}
 */
function createPolicy({ policyId, incarnationId }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'policy',
    policyId,
    incarnationId,
    stage: PolicyStage.PROPOSED,
    revision: 0,
    readableRoots: [],
    writableRoots: [],
    protectedFiles: [],
    commands: [],
    networkPolicy: 'LOCAL_ONLY',
    credentials: [],
    hardLimits: {},
    softTargets: {},
    phaseRestrictions: {},
  };
}

/**
 * Create an Acceptance Contract record (§6, §14).
 * @param {object} params
 * @param {string} params.contractId
 * @param {string} params.taskId
 * @param {string} params.incarnationId
 * @returns {object}
 */
function createAcceptanceContract({ contractId, taskId, incarnationId }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'acceptance_contract',
    contractId,
    taskId,
    incarnationId,
    inventoryDigest: null,
    obligations: [],
    evidencePolicy: null,
    retryRule: 'NO_RETRY',
    conflictRule: 'FAIL_WINS',
    supersessionRule: 'EVIDENCE_BASED',
    frozen: false,
  };
}

/**
 * Create a Budget record (§6, §12).
 * @param {object} params
 * @param {string} params.lineageId
 * @returns {object}
 */
function createBudget({ lineageId }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'budget',
    lineageId,
    dimensions: {},
  };
}

/**
 * Create a Delivery record (§6, §20).
 * @param {object} params
 * @param {string} params.deliveryId
 * @param {string} params.taskId
 * @param {string} params.frozenGenerationId
 * @returns {object}
 */
function createDelivery({ deliveryId, taskId, frozenGenerationId }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'delivery',
    deliveryId,
    taskId,
    frozenGenerationId,
    manifestDigest: null,
    payloadDigest: null,
    persistenceState: 'NOT_PUBLISHED',
    retentionStart: null,
    retentionExpiry: null,
  };
}

/**
 * Create a Source Capture record (§6, §11).
 * The capture record is the durable, authority-independent evidence that a
 * specific immutable commit was selected, its shape was supported, and its
 * content is ready for independent retention. It FAILS CLOSED: fileds that
 * require a qualified reader (integrity, reader) default to absent, so
 * {captureReadiness} reports UNQUALIFIED/NOT_READY unless the runtime proved
 * them. This record never claims a physical capture that was not established.
 *
 * @param {object} params
 * @param {string} params.captureId
 * @param {string} params.incarnationId
 * @param {string} params.commitIdentity — full immutable commit hash
 * @param {object} [params.rules] — { include, exclude, excludeDirty }
 * @param {object} [params.rejections] — §11 rejection flags, all false by default
 * @param {object} [params.integrity] — qualified-reader-verified flags
 * @returns {object}
 */
function createSourceCapture({
  captureId, incarnationId, commitIdentity, rules, rejections, integrity, baselineManifestIdentity,
}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'source_capture',
    captureId,
    incarnationId,
    commitIdentity,
    baselineManifestIdentity: baselineManifestIdentity || null,
    rules: rules || { include: [], exclude: [], excludeDirty: true },
    rejections: rejections || {},
    integrity: integrity || {},
    reader: null,       // { qualified: bool, name, version } — set ONLY by a qualified reader
    capturedAt: null,
  };
}

/**
 * Create a Generation record (§6, §7, §20).
 *
 * Generation mutation is ONE-WAY: MUTABLE -> MUTATION_CLOSED -> FROZEN; a
 * mutation-closed or frozen generation MUST NOT return to MUTABLE (§7), and a
 * frozen generation is never overwritten in place (§13). A FROZEN generation
 * binds an immutable tree digest and a create-once publication identity onto
 * the durable record (§20.2).
 *
 * Nothing in this factory claims the bytes were physically materialized or
 * published — those facts require a qualified runtime (IB-01) and are decided
 * by {generation.freezeReadiness} / the delivery manifest algebra, not by the
 * record shape.
 *
 * @param {object} params
 * @param {string} params.generationId
 * @param {string} params.taskId
 * @param {string} params.incarnationId
 * @param {string} [params.parentGenerationId] — repair/recursion lineage (§7)
 * @returns {object}
 */
function createGeneration({ generationId, taskId, incarnationId, parentGenerationId = null }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'generation',
    generationId,
    taskId,
    incarnationId,
    parentGenerationId,
    state: GenerationState.MUTABLE,
    baselineIdentity: null,          // selected_baseline_identity (§20)
    treeDigest: null,                // accepted_generation_and_tree_digest (§20)
    createOnceIdentity: null,        // set exactly once at freeze (create-once)
    manifestIdentity: null,          // delivery manifest content identity (§20)
    barrier1ClosedAt: null,          // barrier 1 (close mutation) timestamp
    frozenAt: null,                  // barrier 2 (freeze) timestamp
    retention: null,                 // { start, expiry, releasePolicy, reservedCapacity } (§20)
  };
}

/**
 * Create an Observer Run record (§6, §16).
 *
 * The protected external observer (§16.4-16.6) "owns the case identities and
 * declared inputs; owns the expected values and comparison rules; launches the
 * contained frozen candidate; captures bounded stdout, stderr, exit/signal,
 * timeout, and runtime-completion facts; compares observations outside
 * candidate execution; and writes authoritative observation/evaluation records
 * through the protected evidence path."
 *
 * This record is the durable, authority-independent artifact of ONE such run
 * against an exact frozen generation. Candidate-authored reports keep
 * classification 'supporting' even when copied into protected storage (§17).
 * Fields that require a qualified observer (qualification, observationPath,
 * comparison-outside-execution) default to absent — the validator and the
 * derivation reducer fail closed rather than assume them (IB-01).
 *
 * @param {object} params
 * @param {string} params.runId
 * @param {string} params.incarnationId
 * @param {string} params.obligationId
 * @param {object} params.candidateIdentity — { generationId, treeDigest } bound
 *   to the exact frozen generation this run observed
 * @param {object} [params.qualification] — { qualified, name, version } set ONLY
 *   by an attested qualified observer; null under IB-01
 * @param {object} [params.launch] — { entrypoint, sourceRoot, runtimeIdentity,
 *   resolutionScope, envCluster } exact-source launch identity (§16)
 * @param {object} [params.captured] — { stdoutBytes, stderrBytes, exitSignal,
 *   timeoutSignal, completionFacts, truncationState } bounded capture (§16.4)
 * @param {boolean} [params.comparedOutsideExecution]
 * @param {string} [params.classification] — 'authoritative' | 'supporting'
 * @param {string} [params.observationPath]
 * @param {string} [params.attestedAt]
 * @returns {object}
 */
function createObserverRun({
  runId, incarnationId, obligationId, candidateIdentity,
  qualification = null, launch = null, captured = null,
  comparedOutsideExecution = false, classification = 'supporting',
  observationPath = null, attestedAt = null,
}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'observer_run',
    runId,
    incarnationId,
    obligationId,
    candidateIdentity: candidateIdentity || { generationId: null, treeDigest: null },
    qualification,
    launch,
    captured,
    comparedOutsideExecution,
    classification,
    observationPath,
    attestedAt,
  };
}

/**
 * Create a Finalization record (§6, §19).
 * @param {object} params
 * @param {string} params.finalizationId
 * @param {string} params.incarnationId
 * @param {string} params.stopReason
 * @returns {object}
 */
function createFinalization({ finalizationId, incarnationId, stopReason, terminalTime = null }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'finalization',
    finalizationId,
    incarnationId,
    stopReason,
    terminalTime,
    admissionClosed: false,
    authorityRetired: false,
    fencingEstablished: false,
    quiescenceProven: false,
    quarantinedResources: [],
    unresolvedExecution: false,
  };
}

/**
 * Create a Bounded-Repair record (§18).
 *
 * The MVP supports ZERO OR ONE repair after the initial attempt, never higher.
 * This record durably consumes the single repair allowance (§18 step 1) and
 * binds the concrete failure identity (§18) to the disposable generation that
 * retries the bounded correction. Nothing in this factory claims a qualified
 * materializer, a frozen re-verification, or protected execution — those facts
 * are decided by the §16/§20 machinery, not by this shape.
 *
 * @param {object} params
 * @param {string} params.repairId
 * @param {string} params.incarnationId
 * @param {object} params.failureIdentity — §18 identity (rawFailureIdentity shape)
 * @param {string} [params.disposableGenerationId] — new disposable generation
 * @param {boolean} [params.allowanceConsumed=true] — the one allowance is durably spent
 * @returns {object}
 */
function createRepair({
  repairId, incarnationId, failureIdentity,
  disposableGenerationId = null, allowanceConsumed = true,
}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'repair',
    repairId,
    incarnationId,
    failureIdentity,
    disposableGenerationId,
    allowanceConsumed,
  };
}

/**
 * Create a durable §13 Intent/Requirement record (§6, §13).
 *
 * The supervisor retains the original user request unchanged and represents
 * admitted intent SEPARATELY. This record is one admitted inventory entry.
 * Its classification (USER_STATED / SAFELY_INFERRED / CONSEQUENTIAL_AMBIGUITY /
 * EXPLICIT_NON_GOAL / UNSUPPORTED) is derived deterministically by
 * `classifyIntent` in intent.js and carried on the record (§13).
 *
 * Provenance traceability is structural: an inferred entry must never claim
 * 'user-request' origin (validated by validateProvenanceIntegrity), and a
 * USER_STATED originalMeaning must be traceable to the retained original
 * request (validated by validateMandatoryIntentIntegrity). contentHash binds
 * the frozen meaning so untrusted content can never silently rewrite a
 * mandatory requirement. Nothing in this factory manufactures a requirement
 * or PASS evidence — it only records an admitted entry.
 *
 * @param {object} params — see intent.js createIntent for the full field shape
 * @returns {object}
 */
function createIntent(params) {
  const I = require('./intent.js');
  const rec = I.createIntent(params || {});
  // intent.js createIntent sets kind: 'intent' and schemaVersion already.
  return rec;
}

/**
 * Create a durable §5 qualification record (support record). Qualification is
 * evidence-based: nothing here manufactures evidence or claims qualification —
 * it only records a profile attestation the reducer will check against the
 * actual qual_evidence records.
 *
 * @param {object} params — see qualification.js createQualification
 * @returns {object}
 */
function createQualification(params) {
  const Q = require('./qualification.js');
  return Q.createQualification(params || {});
}

/**
 * Create a durable §5 qualification-evidence record (one concrete proof of one
 * effect surface for one runtime/profile identity). This is a supervisable
 * fact; it is only ever produced from an actual observer run, never from a
 * claim.
 *
 * @param {object} params — see qualification.js createQualEvidence
 * @returns {object}
 */
function createQualEvidence(params) {
  const Q = require('./qualification.js');
  return Q.createQualEvidence(params || {});
}

/**
 * Create an §23 evidence durable record (pipeline-layer evidence item).
 *
 * Distinct from qual_evidence (§5 runtime-surface qualification). This record
 * captures a single observation result against a pinned applicability envelope.
 * Recording evidence MUST NOT grant authority, execution permission, or budget
 * (§23 requirement 9).
 *
 * @param {object} p
 * @param {string} p.evidenceId — unique identifier
 * @param {string} p.obligationId — which obligation this satisfies
 * @param {string} p.generationId — frozen generation this binds to
 * @param {'PASS'|'FAIL'|'MISSING'|'INCONCLUSIVE'} p.outcome — total outcome
 * @param {object} p.envelope — §17 envelope fields (must be complete for admittance)
 * @param {string} p.observationPath — where observation was taken
 * @param {string} [p.applicabilityKey] — pre-computed applicability key
 * @param {number} [p.capturedAt] — epoch-ms timestamp
 * @param {'supporting'|'authoritative'} [p.classification]
 * @returns {object}
 */
function createEvidenceRecord({
  evidenceId, obligationId, generationId, outcome,
  envelope = {}, observationPath,
  applicabilityKey = null, capturedAt = null,
  classification = 'supporting',
  observerQualified = false,                       // §16/§23 req 7: only a qualified external
                                                    // observer's record is authoritative;
                                                    // candidate-authored stays supporting
  sourceRunId = null,                              // runId of the observer_run that produced this evidence
}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'evidence',
    evidenceId,
    obligationId,
    generationId,
    outcome,
    envelope,
    observationPath,
    applicabilityKey,
    capturedAt,
    classification,
    observerQualified,
    sourceRunId,
    invalidated: false,
    invalidationId: null,
  };
}

/**
 * Create an §23 evidence_invalidation record.
 *
 * Deterministic invalidation: a timestamp, model preference, lower error count,
 * or later observation alone MUST NOT invalidate earlier valid failure evidence.
 * Only a structural applicability-key mismatch, supersession by a later record
 * bound to the same key, or retirement of the generation triggers this.
 *
 * Recording invalidation MUST NOT grant authority (§23 requirement 9).
 *
 * @param {object} p
 * @param {string} p.invalidationId
 * @param {string} p.evidenceId — which evidence record is invalidated
 * @param {string} p.reason — deterministic reason (structural, not preference)
 * @param {string} [p.supersededById] — later evidence that supersedes this one
 * @param {number} [p.invalidatedAt] — epoch-ms timestamp
 * @returns {object}
 */
function createEvidenceInvalidation({
  invalidationId, evidenceId, reason,
  supersededById = null, invalidatedAt = null,
}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    kind: 'evidence_invalidation',
    invalidationId,
    evidenceId,
    reason,
    supersededById,
    invalidatedAt,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  SCHEMA_VERSION,

  // Enums
  TaskPhase,
  TerminalResult,
  ActionLifecycle,
  ActionDispatch,
  ActionExecution,
  UseAllowance,
  Liability,
  ResourceDisposition,
  GenerationState,
  PolicyStage,
  ObligationOutcome,
  Assurance,
  ReleaseDisposition,
  ReuseClass,
  AdmissionDecision,

  // Sets
  TERMINAL_PHASES,
  LIVE_PHASES,
  TERMINAL_RESULTS,
  NON_SUCCESS_RESULTS,

  // ID generation
  generateId,
  useClock,

  // Record factories
  createStoreOwner,
  createLineage,
  createTaskIncarnation,
  createAction,
  createPolicy,
  createAcceptanceContract,
  createBudget,
  createDelivery,
  createGeneration,
  createSourceCapture,
  createObserverRun,
  createFinalization,
  createRepair,
  createIntent,
  createQualification,
  createQualEvidence,
  createEvidenceRecord,
  createEvidenceInvalidation,
};
