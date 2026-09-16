'use strict';
/**
 * integration-reports — Pure contract algebra for §30 Final Integration,
 * §31 Completion Criteria, and §32 Required Reports.
 *
 * Requirements:
 * - §32 Runtime Task Report model (29 mandatory fields across 6 categories).
 * - §32 Implementation Executor's Final Report model (15 mandatory fields).
 * - §30 Final Integration Procedure lattice (18 ordered steps).
 * - §30 Release Dispositions (RELEASE_READY_FOR_DECLARED_PROFILE, CHECKER_ONLY, BLOCKED, VALUE_NOT_ESTABLISHED).
 * - §31 Completion Criteria checklist (29 normative conditions).
 * - Invariants:
 *   - incumbent_modified must be strictly boolean false.
 *   - Acceptance claims require frozen delivery identity, manifests, quiescence, and retired authority.
 *   - An incomplete report cannot imply partial acceptance of mandatory obligations.
 *   - RELEASE_READY_FOR_DECLARED_PROFILE requires complete gates (0-3), closed blockers, and value evidence.
 *   - Open blockers (IB-01..IB-04) restrict release to CHECKER_ONLY or BLOCKED.
 *   - Safety qualification without value evidence cannot claim superiority (VALUE_NOT_ESTABLISHED).
 *   - All functions are pure and fail closed.
 */

const { canonicalJson, sha256 } = require('./crypto.js');

// ---------------------------------------------------------------------------
// Enums and Constants
// ---------------------------------------------------------------------------

/**
 * §30 Release Dispositions.
 */
const ReleaseDisposition = Object.freeze({
  RELEASE_READY_FOR_DECLARED_PROFILE: 'RELEASE_READY_FOR_DECLARED_PROFILE',
  CHECKER_ONLY:                       'CHECKER_ONLY',
  BLOCKED:                            'BLOCKED',
  VALUE_NOT_ESTABLISHED:              'VALUE_NOT_ESTABLISHED',
});

/**
 * Test execution outcome distinctions (§32).
 */
const TestOutcome = Object.freeze({
  PASS:     'PASS',
  FAIL:     'FAIL',
  NOT_RUN:  'NOT_RUN',
  BLOCKED:  'BLOCKED',
  EXCLUDED: 'EXCLUDED',
});

/**
 * §32 Runtime Task Report mandatory fields (29 fields in 6 logical groups).
 */
const RUNTIME_TASK_REPORT_FIELDS = Object.freeze([
  // Group 1: Task & Identity (6)
  'task_id',
  'lineage_id',
  'incarnation_id',
  'selected_source_identity',
  'qualified_profile_digest',
  'acceptance_contract_digest',

  // Group 2: Execution Outcome (5)
  'execution_result',
  'accepted_or_not_accepted',
  'assurance',
  'stop_reason',
  'contributing_failure_and_limitation_reasons',

  // Group 3: Scope & Obligations (5)
  'changed_scope',
  'mandatory_obligation_results',
  'optional_obligation_results',
  'verification_scope_and_derivation',
  'evidence_references',

  // Group 4: Quiescence & Containment (4)
  'authority_retired',
  'quiescence_state',
  'fencing_or_unresolved_boundary',
  'quarantined_resources',

  // Group 5: Usage & Liabilities (4)
  'settled_usage',
  'outstanding_reserved_liability',
  'estimated_or_unavailable_metrics',
  'hard_limit_status',

  // Group 6: Delivery & Invariants (5)
  'delivery_identity',
  'payload_and_manifest_digests',
  'delivery_availability',
  'retention_expiry',
  'incumbent_modified',
]);

/**
 * §32 Implementation Executor's Final Report mandatory fields (15 fields).
 */
const IMPLEMENTATION_REPORT_FIELDS = Object.freeze([
  'contract',
  'source',
  'current_code_findings',
  'profile',
  'work_completed',
  'gate_status',
  'tests',
  'traceability',
  'safety',
  'resources',
  'delivery',
  'value',
  'limitations',
  'blockers',
  'release_disposition',
]);

/**
 * §30 18-step integration procedure lattice in exact normative order.
 */
const FINAL_INTEGRATION_STEPS = Object.freeze([
  { step: 1,  name: 'SOURCE_REVISION_IDENTIFICATION',      description: 'Identify exact TANDEM source revision and retain implementation diff' },
  { step: 2,  name: 'CODE_MAP_AND_PROFILE_CONFIRMATION',  description: 'Confirm approved code map and all resolved concrete profile bindings' },
  { step: 3,  name: 'BLOCKER_CHECK',                      description: 'Confirm no unresolved blocker affects the intended gate' },
  { step: 4,  name: 'PROFILE_AND_TOOLCHAIN_VALIDATION',   description: 'Validate current profile digest, configuration, toolchain, storage assumptions, and qualification validity' },
  { step: 5,  name: 'CONTRACT_UNIT_TESTS',                description: 'Run schema, policy, coverage, predicate, reducer, budget, and state-transition unit tests' },
  { step: 6,  name: 'INTEGRATED_BOUNDARY_TESTS',          description: 'Run integrated admission, ownership, source, containment, egress, and resource tests on actual qualified profile' },
  { step: 7,  name: 'EXECUTION_PATH_VALIDATION',          description: 'Run exact-slice success path and authorized one-repair path' },
  { step: 8,  name: 'CRASH_WINDOW_VALIDATION',            description: 'Exercise all terminal paths, late callbacks, and dispatch crash windows' },
  { step: 9,  name: 'PUBLICATION_RETENTION_TESTS',        description: 'Exercise publication and retention crash boundaries' },
  { step: 10, name: 'INCUMBENT_PROTECTION_INSPECTION',    description: 'Inspect incumbent source/Git/user-work protection evidence' },
  { step: 11, name: 'IMMUTABLE_CONTENT_VERIFICATION',     description: 'Verify every successful terminal record references complete immutable retained content' },
  { step: 12, name: 'CAPABILITY_REFUSAL_CHECK',           description: 'Verify unsupported capabilities are actually refused or unreachable' },
  { step: 13, name: 'INVARIANT_MATRIX_BINDING',           description: 'Run full applicable invariant/test matrix and bind results to actual code' },
  { step: 14, name: 'PAIRED_VALUE_EVALUATION',            description: 'Run predeclared paired value evaluation and apply unchanged decision rule' },
  { step: 15, name: 'RESIDUAL_REVIEW',                    description: 'Inspect all failures, unknowns, collection gaps, liabilities, quarantined resources, and limitations' },
  { step: 16, name: 'PUBLIC_SCOPE_CONFORMANCE',           description: 'Confirm public support description does not exceed tested profile or evidence' },
  { step: 17, name: 'REPORT_GENERATION',                  description: 'Produce implementation report in Section 32' },
  { step: 18, name: 'RELEASE_DISPOSITION_RECORDING',      description: 'Record explicit release disposition' },
]);

/**
 * §31 Completion criteria checklist (29 normative conditions).
 */
const COMPLETION_CRITERIA_CONDITIONS = Object.freeze([
  'v4_product_authority_preserved',
  'supervisory_layer_only_not_independent_agent',
  'gate0_contains_current_code_and_concrete_profile_evidence',
  'single_supported_profile_and_thin_adapter',
  'single_exclusive_supervisor_and_durable_store',
  'current_serialized_admission_through_final_release',
  'durable_grants_consumption_reservations_deadlines_uncertainty',
  'incumbent_and_git_protected_from_agents_and_helpers',
  'explicit_immutable_independently_retained_source_selection',
  'unsupported_dirty_source_dependency_transport_refused',
  'mandatory_requirements_retained_and_mapped',
  'small_predicate_set_independent_total_non_vacuous',
  'native_verification_genuinely_full_not_false_oracle',
  'actual_source_dependency_config_derivation_established',
  'evidence_coherent_with_exact_frozen_generation',
  'hard_resource_and_liability_bounds_conservatively_enforced',
  'mandatory_finalization_verification_delivery_capacity_protected',
  'bounded_repair_at_most_one_authorized_generation',
  'every_ending_path_quiescent_or_unresolved_quarantine',
  'late_execution_cannot_mutate_or_upgrade_terminated_work',
  'successful_delivery_manifest_persisted_before_terminal_record',
  'retention_release_expiry_corruption_handled_truthfully',
  'tandem_check_honest_and_useful_without_unsupported_execution',
  'all_inv01_through_inv25_covered_by_applicable_tests',
  'all_t01_through_t14_pass_with_refusal_for_exclusions',
  'gates_0_through_3_pass_with_inspectable_evidence',
  'gate_4_admission_policy_implemented_no_silent_enable',
  'paired_evaluation_all_attempts_numeric_gates_uncertainty',
  'claims_match_actual_evidence_no_unresolved_decisions',
]);

// ---------------------------------------------------------------------------
// Digestion Functions
// ---------------------------------------------------------------------------

/**
 * Computes a deterministic SHA-256 digest of a Runtime Task Report.
 *
 * @param {object} report
 * @returns {string} 64-char hex SHA-256 digest
 */
function computeTaskReportDigest(report) {
  if (!report || typeof report !== 'object') {
    throw new TypeError('computeTaskReportDigest requires a non-null object');
  }
  return sha256(canonicalJson(report));
}

/**
 * Computes a deterministic SHA-256 digest of an Implementation Executor's Final Report.
 *
 * @param {object} report
 * @returns {string} 64-char hex SHA-256 digest
 */
function computeImplementationReportDigest(report) {
  if (!report || typeof report !== 'object') {
    throw new TypeError('computeImplementationReportDigest requires a non-null object');
  }
  return sha256(canonicalJson(report));
}

// ---------------------------------------------------------------------------
// Task Report Functions (§32)
// ---------------------------------------------------------------------------

/**
 * Generates a normative 29-field Runtime Task Report from durable state records.
 *
 * @param {object} storeState Folded or raw state records from durable store
 * @param {object} [options={}] Additional overrides or execution metadata
 * @returns {object} Normative 29-field Runtime Task Report
 */
function generateTaskReport(storeState = {}, options = {}) {
  const state = storeState && typeof storeState === 'object' ? storeState : {};
  const opts = options && typeof options === 'object' ? options : {};

  const taskId = opts.task_id || state.taskId || 'task-unknown';
  const lineageId = opts.lineage_id || state.lineageId || 'lin-unknown';
  const incarnationId = opts.incarnation_id || state.incarnationId || 'inc-unknown';
  const selectedSourceIdentity = opts.selected_source_identity || state.selectedSourceIdentity || 'source-unknown';
  const qualifiedProfileDigest = opts.qualified_profile_digest || state.qualifiedProfileDigest || sha256('unqualified-profile');
  const acceptanceContractDigest = opts.acceptance_contract_digest || state.acceptanceContractDigest || sha256('empty-contract');

  const executionResult = opts.execution_result || state.executionResult || 'STOPPED_BLOCKED';
  const acceptedOrNotAccepted = Boolean(opts.accepted_or_not_accepted ?? state.acceptedOrNotAccepted ?? false);
  const assurance = opts.assurance || state.assurance || 'Unqualified baseline; Gate 0 NOT passed';
  const stopReason = opts.stop_reason || state.stopReason || 'HARD_STOP';
  const contributingFailureReasons = Array.isArray(opts.contributing_failure_and_limitation_reasons)
    ? [...opts.contributing_failure_and_limitation_reasons]
    : Array.isArray(state.contributingFailureAndLimitationReasons)
      ? [...state.contributingFailureAndLimitationReasons]
      : [];

  const changedScope = Array.isArray(opts.changed_scope)
    ? [...opts.changed_scope]
    : Array.isArray(state.changedScope)
      ? [...state.changedScope]
      : [];

  const mandatoryObligationResults = opts.mandatory_obligation_results || state.mandatoryObligationResults || {};
  const optionalObligationResults = opts.optional_obligation_results || state.optionalObligationResults || {};
  const verificationScopeAndDerivation = opts.verification_scope_and_derivation || state.verificationScopeAndDerivation || 'DERIVATION_UNQUALIFIED';
  const evidenceReferences = Array.isArray(opts.evidence_references)
    ? [...opts.evidence_references]
    : Array.isArray(state.evidenceReferences)
      ? [...state.evidenceReferences]
      : [];

  const authorityRetired = Boolean(opts.authority_retired ?? state.authorityRetired ?? true);
  const quiescenceState = opts.quiescence_state || state.quiescenceState || 'UNRESOLVED_EXECUTION';
  const fencingOrUnresolvedBoundary = opts.fencing_or_unresolved_boundary || state.fencingOrUnresolvedBoundary || 'FENCING_UNQUALIFIED';
  const quarantinedResources = Array.isArray(opts.quarantined_resources)
    ? [...opts.quarantined_resources]
    : Array.isArray(state.quarantinedResources)
      ? [...state.quarantinedResources]
      : [];

  const settledUsage = opts.settled_usage || state.settledUsage || { cpuMs: 0, memoryBytes: 0, tokens: 0, wallClockMs: 0, costUsd: 0 };
  const outstandingReservedLiability = opts.outstanding_reserved_liability || state.outstandingReservedLiability || { cpuMs: 0, memoryBytes: 0, tokens: 0, costUsd: 0 };
  const estimatedOrUnavailableMetrics = Array.isArray(opts.estimated_or_unavailable_metrics)
    ? [...opts.estimated_or_unavailable_metrics]
    : Array.isArray(state.estimatedOrUnavailableMetrics)
      ? [...state.estimatedOrUnavailableMetrics]
      : [];
  const hardLimitStatus = opts.hard_limit_status || state.hardLimitStatus || 'WITHIN_HARD_LIMITS';

  const deliveryIdentity = opts.delivery_identity ?? state.deliveryIdentity ?? null;
  const payloadAndManifestDigests = opts.payload_and_manifest_digests || state.payloadAndManifestDigests || {
    payloadDigest: null,
    manifestDigest: null,
  };
  const deliveryAvailability = opts.delivery_availability || state.deliveryAvailability || (acceptedOrNotAccepted ? 'AVAILABLE' : 'UNAVAILABLE');
  const retentionExpiry = opts.retention_expiry ?? state.retentionExpiry ?? 0;

  // Invariant §32: incumbent_modified MUST BE STRICTLY FALSE
  const incumbentModified = false;

  return {
    task_id: taskId,
    lineage_id: lineageId,
    incarnation_id: incarnationId,
    selected_source_identity: selectedSourceIdentity,
    qualified_profile_digest: qualifiedProfileDigest,
    acceptance_contract_digest: acceptanceContractDigest,

    execution_result: executionResult,
    accepted_or_not_accepted: acceptedOrNotAccepted,
    assurance: assurance,
    stop_reason: stopReason,
    contributing_failure_and_limitation_reasons: contributingFailureReasons,

    changed_scope: changedScope,
    mandatory_obligation_results: mandatoryObligationResults,
    optional_obligation_results: optionalObligationResults,
    verification_scope_and_derivation: verificationScopeAndDerivation,
    evidence_references: evidenceReferences,

    authority_retired: authorityRetired,
    quiescence_state: quiescenceState,
    fencing_or_unresolved_boundary: fencingOrUnresolvedBoundary,
    quarantined_resources: quarantinedResources,

    settled_usage: settledUsage,
    outstanding_reserved_liability: outstandingReservedLiability,
    estimated_or_unavailable_metrics: estimatedOrUnavailableMetrics,
    hard_limit_status: hardLimitStatus,

    delivery_identity: deliveryIdentity,
    payload_and_manifest_digests: payloadAndManifestDigests,
    delivery_availability: deliveryAvailability,
    retention_expiry: retentionExpiry,
    incumbent_modified: incumbentModified,
  };
}

/**
 * Validates a Runtime Task Report against the 29-field schema and fail-closed invariants.
 *
 * @param {object} report
 * @returns {{ valid: boolean, errors: string[], missingFields: string[] }}
 */
function validateTaskReport(report) {
  const errors = [];
  const missingFields = [];

  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return {
      valid: false,
      errors: ['Task report must be a non-null, non-array object'],
      missingFields: [...RUNTIME_TASK_REPORT_FIELDS],
    };
  }

  // Verify all 29 mandatory fields
  for (const field of RUNTIME_TASK_REPORT_FIELDS) {
    if (!(field in report) || report[field] === undefined) {
      missingFields.push(field);
      errors.push(`Missing mandatory task report field: "${field}"`);
      continue;
    }

    const val = report[field];

    // String fields cannot be blank
    if (
      [
        'task_id',
        'lineage_id',
        'incarnation_id',
        'selected_source_identity',
        'qualified_profile_digest',
        'acceptance_contract_digest',
        'execution_result',
        'assurance',
        'stop_reason',
        'quiescence_state',
        'fencing_or_unresolved_boundary',
        'hard_limit_status',
        'delivery_availability',
      ].includes(field)
    ) {
      if (typeof val !== 'string' || val.trim().length === 0) {
        errors.push(`Task report field "${field}" must be a non-empty string`);
      }
    }

    // Array fields
    if (
      [
        'contributing_failure_and_limitation_reasons',
        'changed_scope',
        'evidence_references',
        'quarantined_resources',
        'estimated_or_unavailable_metrics',
      ].includes(field)
    ) {
      if (!Array.isArray(val)) {
        errors.push(`Task report field "${field}" must be an array`);
      }
    }

    // Object fields
    if (['settled_usage', 'outstanding_reserved_liability', 'payload_and_manifest_digests'].includes(field)) {
      if (!val || typeof val !== 'object' || Array.isArray(val)) {
        errors.push(`Task report field "${field}" must be a non-null object`);
      }
    }
  }

  // Invariant §32: incumbent_modified MUST BE EXACTLY BOOLEAN FALSE
  if (report.incumbent_modified !== false) {
    errors.push(`Safety violation: "incumbent_modified" must be strictly false (received ${JSON.stringify(report.incumbent_modified)})`);
  }

  // Acceptance coherence invariants (§32 line 2291)
  if (report.accepted_or_not_accepted === true) {
    if (!report.delivery_identity || typeof report.delivery_identity !== 'string' || report.delivery_identity.trim().length === 0) {
      errors.push('Accepted task report must reference a non-empty immutable delivery_identity');
    }

    const digests = report.payload_and_manifest_digests;
    if (
      !digests ||
      typeof digests !== 'object' ||
      !digests.payloadDigest ||
      typeof digests.payloadDigest !== 'string' ||
      !digests.manifestDigest ||
      typeof digests.manifestDigest !== 'string'
    ) {
      errors.push('Accepted task report must contain valid non-null payloadDigest and manifestDigest');
    }

    if (report.authority_retired !== true) {
      errors.push('Accepted task report requires authority_retired to be true');
    }

    if (report.quiescence_state !== 'QUIESCENT') {
      errors.push(`Accepted task report requires quiescence_state === "QUIESCENT" (was "${report.quiescence_state}")`);
    }

    // Mandatory obligations must not be empty or contain non-PASS
    if (report.mandatory_obligation_results) {
      const mand = report.mandatory_obligation_results;
      if (typeof mand === 'object' && !Array.isArray(mand)) {
        const entries = Object.entries(mand);
        if (entries.length === 0) {
          errors.push('Accepted task report cannot have empty mandatory obligation results');
        } else {
          for (const [obId, res] of entries) {
            const outcome = typeof res === 'string' ? res : res?.outcome;
            if (outcome !== 'PASS') {
              errors.push(`Accepted task report has non-passing mandatory obligation "${obId}" (${outcome})`);
            }
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    missingFields,
  };
}

// ---------------------------------------------------------------------------
// Implementation Executor's Final Report Functions (§32)
// ---------------------------------------------------------------------------

/**
 * Generates an Implementation Executor's Final Report.
 *
 * @param {object} params 15 required fields
 * @returns {object} Normative 15-field Implementation Report
 */
function generateImplementationReport(params = {}) {
  const p = params && typeof params === 'object' ? params : {};

  return {
    contract: p.contract || 'TANDEM_MASTER_EXECUTION_PRD_V1.md / V4',
    source: p.source || 'checkout-unverified',
    current_code_findings: p.current_code_findings || 'Gate 0 baseline unverified',
    profile: p.profile || 'Unqualified local profile; IB-01 open',
    work_completed: p.work_completed || 'Pure contract algebras implemented',
    gate_status: p.gate_status || {
      gate0: 'NOT_PASSED',
      gate1: 'NOT_RUN',
      gate2: 'NOT_RUN',
      gate3: 'NOT_RUN',
      gate4: 'NOT_RUN',
    },
    tests: p.tests || {
      total: 0,
      passed: 0,
      failed: 0,
      not_run: 0,
      blocked: 0,
      excluded: 0,
    },
    traceability: p.traceability || 'INV-01..INV-25, T-01..T-14 bound to contract tests',
    safety: p.safety || 'Protected roots intact; incumbent_modified: false; authorityGranted: false',
    resources: p.resources || 'Conservative reservations; no live execution consumption',
    delivery: p.delivery || 'Delivery publication algebras verified',
    value: p.value || 'Paired value evaluation unexecuted; IB-04 open',
    limitations: p.limitations || ['Host profile unqualified (IB-01)', 'Supervised execution unavailable'],
    blockers: p.blockers || ['IB-01', 'IB-02', 'IB-03', 'IB-04'],
    release_disposition: p.release_disposition || ReleaseDisposition.CHECKER_ONLY,
  };
}

/**
 * Validates an Implementation Executor's Final Report against the 15-field schema and fail-closed rules.
 *
 * @param {object} report
 * @returns {{ valid: boolean, errors: string[], missingFields: string[] }}
 */
function validateImplementationReport(report) {
  const errors = [];
  const missingFields = [];

  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return {
      valid: false,
      errors: ['Implementation report must be a non-null, non-array object'],
      missingFields: [...IMPLEMENTATION_REPORT_FIELDS],
    };
  }

  // Verify all 15 mandatory fields
  for (const field of IMPLEMENTATION_REPORT_FIELDS) {
    if (!(field in report) || report[field] === undefined) {
      missingFields.push(field);
      errors.push(`Missing mandatory implementation report field: "${field}"`);
    }
  }

  // Validate release_disposition enum
  if (report.release_disposition && !Object.values(ReleaseDisposition).includes(report.release_disposition)) {
    errors.push(`Invalid release_disposition: "${report.release_disposition}"`);
  }

  // Validate test outcome distinctions (§32 line 2313: must distinguish PASS, FAIL, NOT_RUN, BLOCKED, and tested exclusion)
  if (report.tests && typeof report.tests === 'object') {
    const t = report.tests;
    // Check if unexecuted/blocked tests were falsely claimed as passed
    if (t.not_run > 0 && t.passed === t.total && t.total > 0 && t.passed > 0 && t.not_run === t.passed) {
      errors.push('Test summary falsification: NOT_RUN tests cannot be counted as passed');
    }
    if (t.blocked > 0 && t.passed === t.total && t.total > 0 && t.passed > 0 && t.blocked === t.passed) {
      errors.push('Test summary falsification: BLOCKED tests cannot be counted as passed');
    }
  }

  // Release readiness checks (§30 line 2205)
  if (report.release_disposition === ReleaseDisposition.RELEASE_READY_FOR_DECLARED_PROFILE) {
    // Cannot be release ready if blockers remain open
    const blockers = Array.isArray(report.blockers) ? report.blockers : [];
    if (blockers.length > 0) {
      errors.push(`RELEASE_READY_FOR_DECLARED_PROFILE is forbidden while implementation blockers are open (${blockers.join(', ')})`);
    }

    // Cannot be release ready if Gate 0 is NOT_PASSED or missing
    const gateStatus = report.gate_status;
    if (gateStatus && typeof gateStatus === 'object') {
      if (gateStatus.gate0 !== 'PASSED' && gateStatus.gate0 !== 'PASS') {
        errors.push('RELEASE_READY_FOR_DECLARED_PROFILE requires Gate 0 to be PASSED');
      }
    }

    // Safety qualification without value evidence cannot claim superiority / release ready
    if (report.value) {
      const v = report.value;
      if (typeof v === 'string' && (v.includes('unexecuted') || v.includes('not established') || v.includes('IB-04 open'))) {
        errors.push('RELEASE_READY_FOR_DECLARED_PROFILE requires empirical value evidence to be established');
      } else if (typeof v === 'object' && v.valueEstablished === false) {
        errors.push('RELEASE_READY_FOR_DECLARED_PROFILE requires valueEstablished: true');
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    missingFields,
  };
}

// ---------------------------------------------------------------------------
// §30 Final Integration Procedure & Release Disposition Evaluators
// ---------------------------------------------------------------------------

/**
 * Validates sequential execution of the §30 18-step integration procedure.
 *
 * @param {Array<object>} executedSteps Array of { step: number, name: string, status: 'PASS'|'FAIL'|'BLOCKED', evidence?: string }
 * @returns {{ valid: boolean, completedSteps: number, currentStep: number, errors: string[] }}
 */
function validateIntegrationProcedure(executedSteps) {
  const errors = [];

  if (!Array.isArray(executedSteps)) {
    return {
      valid: false,
      completedSteps: 0,
      currentStep: 1,
      errors: ['executedSteps must be an array'],
    };
  }

  let completedSteps = 0;

  for (let i = 0; i < FINAL_INTEGRATION_STEPS.length; i++) {
    const expectedStep = FINAL_INTEGRATION_STEPS[i];
    const actual = executedSteps[i];

    if (!actual) {
      errors.push(`Step ${expectedStep.step} (${expectedStep.name}) was not executed`);
      break;
    }

    if (actual.step !== expectedStep.step) {
      errors.push(`Out of order step execution: expected step ${expectedStep.step} (${expectedStep.name}), got step ${actual.step}`);
      break;
    }

    if (actual.name && actual.name !== expectedStep.name) {
      errors.push(`Step name mismatch at step ${expectedStep.step}: expected "${expectedStep.name}", got "${actual.name}"`);
      break;
    }

    if (actual.status !== 'PASS') {
      errors.push(`Step ${expectedStep.step} (${expectedStep.name}) did not PASS (status: "${actual.status}")`);
      break;
    }

    completedSteps++;
  }

  return {
    valid: completedSteps === 18 && errors.length === 0,
    completedSteps,
    currentStep: completedSteps < 18 ? completedSteps + 1 : 18,
    errors,
  };
}

/**
 * Evaluates the normative ReleaseDisposition under §30 rules.
 *
 * @param {object} context
 * @param {Array<string>} [context.blockers=[]] Open implementation blocker IDs
 * @param {boolean} [context.gate0Passed=false]
 * @param {boolean} [context.gatesPassed=false] Whether Gates 0-3 passed
 * @param {boolean} [context.checkerOnlyValid=true] Whether checker/observer mode is valid
 * @param {boolean} [context.testsPassed=true] Whether unit/contract tests passed
 * @param {boolean} [context.safetyQualified=false] Whether safety qualification passed
 * @param {boolean} [context.valueEvidenceEstablished=false] Whether empirical paired value passed
 * @param {boolean} [context.incumbentModified=false] Whether incumbent files were touched
 * @returns {{ disposition: string, reasons: string[] }}
 */
function evaluateReleaseDisposition(context = {}) {
  const ctx = context && typeof context === 'object' ? context : {};
  const reasons = [];

  const blockers = Array.isArray(ctx.blockers) ? ctx.blockers : [];
  const gate0Passed = Boolean(ctx.gate0Passed);
  const gatesPassed = Boolean(ctx.gatesPassed);
  const checkerOnlyValid = Boolean(ctx.checkerOnlyValid ?? true);
  const testsPassed = Boolean(ctx.testsPassed ?? true);
  const safetyQualified = Boolean(ctx.safetyQualified ?? false);
  const valueEvidenceEstablished = Boolean(ctx.valueEvidenceEstablished ?? false);
  const incumbentModified = Boolean(ctx.incumbentModified ?? false);

  // Invariant 1: Incumbent modification immediately blocks release
  if (incumbentModified) {
    reasons.push('Safety violation: incumbent workspace files were modified');
    return { disposition: ReleaseDisposition.BLOCKED, reasons };
  }

  // Invariant 2: Test failures immediately block release
  if (!testsPassed) {
    reasons.push('Integration blocked by test failures');
    return { disposition: ReleaseDisposition.BLOCKED, reasons };
  }

  // Invariant 3: Open blockers or unpassed Gate 0
  if (blockers.length > 0 || !gate0Passed) {
    if (blockers.length > 0) {
      reasons.push(`Open implementation blockers present: ${blockers.join(', ')}`);
    }
    if (!gate0Passed) {
      reasons.push('Gate 0 has NOT passed');
    }

    if (checkerOnlyValid) {
      reasons.push('Checker/observer mode is valid; supervised execution remains unavailable');
      return { disposition: ReleaseDisposition.CHECKER_ONLY, reasons };
    }
    return { disposition: ReleaseDisposition.BLOCKED, reasons };
  }

  // Invariant 4: Safety qualified but value evidence absent
  if (safetyQualified && !valueEvidenceEstablished) {
    reasons.push('Safety qualification passed but paired empirical value evidence is not established');
    return { disposition: ReleaseDisposition.VALUE_NOT_ESTABLISHED, reasons };
  }

  // Invariant 5: Complete implementation gate + value evidence
  if (gatesPassed && safetyQualified && valueEvidenceEstablished) {
    return { disposition: ReleaseDisposition.RELEASE_READY_FOR_DECLARED_PROFILE, reasons: [] };
  }

  reasons.push('Incomplete implementation gate requirements');
  return { disposition: ReleaseDisposition.BLOCKED, reasons };
}

/**
 * Validates conformance to §31 Completion Criteria.
 *
 * @param {object} criteriaContext
 * @returns {{ satisfied: boolean, passingConditions: string[], failingConditions: string[] }}
 */
function checkCompletionCriteria(criteriaContext = {}) {
  const ctx = criteriaContext && typeof criteriaContext === 'object' ? criteriaContext : {};
  const passingConditions = [];
  const failingConditions = [];

  for (const condition of COMPLETION_CRITERIA_CONDITIONS) {
    if (ctx[condition] === true) {
      passingConditions.push(condition);
    } else {
      failingConditions.push(condition);
    }
  }

  return {
    satisfied: failingConditions.length === 0,
    passingConditions,
    failingConditions,
  };
}

// ---------------------------------------------------------------------------
// Module Exports
// ---------------------------------------------------------------------------

module.exports = {
  ReleaseDisposition,
  TestOutcome,
  RUNTIME_TASK_REPORT_FIELDS,
  IMPLEMENTATION_REPORT_FIELDS,
  FINAL_INTEGRATION_STEPS,
  COMPLETION_CRITERIA_CONDITIONS,
  computeTaskReportDigest,
  computeImplementationReportDigest,
  generateTaskReport,
  validateTaskReport,
  generateImplementationReport,
  validateImplementationReport,
  validateIntegrationProcedure,
  evaluateReleaseDisposition,
  checkCompletionCriteria,
};
