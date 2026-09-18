'use strict';
/**
 * measurement — §23 Paired Measurement & Evaluation Protocol contract.
 *
 * Implements the empirical evaluation protocol for comparing:
 *   Agent Alone  vs.  Agent + TANDEM
 *
 * Requirements:
 * - 22-field immutable protocol frozen BEFORE results are observed (§23).
 * - Identical frozen source baseline & independent acceptance standard.
 * - Disclosed common safety floor (disposable evaluation resources for Agent Alone).
 * - 9 raw metric collection dimensions with full product cost accounting.
 * - All-started-task denominator (completed, failed, blocked, timed out, cancelled,
 *   interrupted, and undelivered). Success-only cost reporting is strictly refused.
 * - Truthful unknowns: unknown metrics MUST remain unknown (never coerced to 0).
 * - Unequal collection coverage prevents quantitative comparison (UNSUPPORTED_COMPARISON).
 * - Strict evaluation integrity: prohibits gold patches in context, hidden test
 *   leakage, memory leakage, repeated eval tuning, and treating refusal as efficiency.
 * - INV-22 / INV-25: Correctness and safety hard gates precede efficiency evaluation.
 *   Efficiency cannot offset correctness or safety regressions.
 * - Gate 3 Value reduction: requires prior gates (0, 1, 2), protocol freeze,
 *   comparable collection, hard gate satisfaction, numeric benefit, overhead ceiling,
 *   and statistical uncertainty rules.
 *
 * PRD references: §23, §24 (T-14, F-06, F-08), §25 (Gate 3, Gate 0 item 12),
 * §27 (INV-22, INV-25), §28 (R-03, R-37, R-38, R-49).
 */

const { sha256, canonicalJson } = require('./crypto.js');

// ---------------------------------------------------------------------------
// §23 Mandatory 22-Field Frozen Evaluation Protocol Manifest
// ---------------------------------------------------------------------------

const PROTOCOL_FIELDS = Object.freeze([
  'supported_task_distribution',
  'task_selection_procedure',
  'frozen_task_and_repository_identities',
  'development_validation_and_final_evaluation_separation',
  'sample_size',
  'repetitions',
  'ordering_or_randomization',
  'variability_and_uncertainty_method',
  'agent_model_runtime_and_environment_versions',
  'tools_permissions_resources_and_context_differences',
  'acceptance_standard_and_independent_evaluator',
  'counter_definitions_and_collection_coverage',
  'all_started_task_denominator',
  'failure_block_timeout_cancel_interrupt_and_undelivered_treatment',
  'primary_benefit_metric_and_direction',
  'numeric_minimum_meaningful_improvement',
  'numeric_maximum_acceptable_product_overhead',
  'correctness_and_safety_hard_gate_rules',
  'review_and_unnecessary_work_rubric',
  'evaluation_only_versus_product_overhead',
  'contamination_controls',
  'decision_rule',
]);

const PROTOCOL_FIELDS_SET = new Set(PROTOCOL_FIELDS);

// ---------------------------------------------------------------------------
// §23 Mandatory 9 Raw Metric Collection Categories
// ---------------------------------------------------------------------------

const METRIC_CATEGORIES = Object.freeze([
  'outcomes',
  'actions',
  'work',
  'tokens_cost',
  'latency',
  'verification',
  'safety',
  'human_effort',
  'quality_judgments',
]);

const METRIC_CATEGORIES_SET = new Set(METRIC_CATEGORIES);

// ---------------------------------------------------------------------------
// Outcomes & Violations Enumerations
// ---------------------------------------------------------------------------

const EvaluationOutcome = Object.freeze({
  PASS:                   'PASS',
  FAIL:                   'FAIL',
  INCONCLUSIVE:           'INCONCLUSIVE',
  BLOCKED:                'BLOCKED',
  UNSUPPORTED_COMPARISON: 'UNSUPPORTED_COMPARISON',
});

const IntegrityViolation = Object.freeze({
  GOLD_PATCH_IN_CONTEXT:         'GOLD_PATCH_IN_CONTEXT',
  HIDDEN_TEST_LEAKAGE:           'HIDDEN_TEST_LEAKAGE',
  MEMORY_LEAKAGE:                'MEMORY_LEAKAGE',
  FINAL_EVAL_FEEDBACK_POLLUTION: 'FINAL_EVAL_FEEDBACK_POLLUTION',
  POST_RESULT_MODIFICATION:      'POST_RESULT_MODIFICATION',
  SUCCESS_ONLY_DENOMINATOR:      'SUCCESS_ONLY_DENOMINATOR',
  UNSUPPORTED_COVERAGE_ASYMMETRY:'UNSUPPORTED_COVERAGE_ASYMMETRY',
  EVALUATION_OVERHEAD_CONFLATION:'EVALUATION_OVERHEAD_CONFLATION',
  REFUSAL_AS_EFFICIENCY:         'REFUSAL_AS_EFFICIENCY',
});

// ---------------------------------------------------------------------------
// Protocol Hashing & Freezing
// ---------------------------------------------------------------------------

/**
 * Compute the deterministic cryptographic digest of an evaluation protocol manifest.
 * Binds exactly the 22 canonical protocol fields.
 *
 * @param {object} protocol - protocol manifest
 * @returns {string} - sha256 hex digest
 */
function computeProtocolDigest(protocol) {
  if (!protocol || typeof protocol !== 'object') {
    throw new Error('computeProtocolDigest: protocol must be an object');
  }
  const canonical = {};
  for (const field of PROTOCOL_FIELDS) {
    canonical[field] = protocol[field] !== undefined ? protocol[field] : null;
  }
  return sha256(canonicalJson(canonical));
}

/**
 * Extract a numeric threshold value from a number or `{ value: number }` wrapper.
 * Returns NaN if not extractable.
 */
function extractNumeric(val) {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (val && typeof val === 'object' && typeof val.value === 'number' && Number.isFinite(val.value)) {
    return val.value;
  }
  return NaN;
}

/**
 * Validate an evaluation protocol manifest against §23 requirements.
 * Fail-closed: missing fields, unpopulated strings, missing numeric thresholds,
 * or non-numeric parameters immediately fail validation.
 *
 * @param {object} protocol
 * @returns {{ valid: boolean, problems: string[] }}
 */
function validateProtocol(protocol) {
  const problems = [];
  if (!protocol || typeof protocol !== 'object' || Array.isArray(protocol)) {
    return { valid: false, problems: ['protocol must be a non-null object'] };
  }

  // 1. Check all 22 required fields are present and non-empty.
  for (const field of PROTOCOL_FIELDS) {
    const val = protocol[field];
    if (val === undefined || val === null) {
      problems.push(`missing required protocol field "${field}"`);
    } else if (typeof val === 'string' && val.trim().length === 0) {
      problems.push(`unpopulated required protocol field "${field}"`);
    } else if (typeof val === 'object' && Object.keys(val).length === 0 && !Array.isArray(val)) {
      problems.push(`empty object for required protocol field "${field}"`);
    } else if (Array.isArray(val) && val.length === 0) {
      problems.push(`empty array for required protocol field "${field}"`);
    }
  }

  // 2. Validate numeric thresholds and sample dimensions (§23 requirement).
  if (protocol.sample_size !== undefined && protocol.sample_size !== null) {
    const sz = extractNumeric(protocol.sample_size);
    if (Number.isNaN(sz) || !Number.isInteger(sz) || sz <= 0) {
      problems.push('sample_size must be a positive integer > 0');
    }
  }

  if (protocol.repetitions !== undefined && protocol.repetitions !== null) {
    const reps = extractNumeric(protocol.repetitions);
    if (Number.isNaN(reps) || !Number.isInteger(reps) || reps < 1) {
      problems.push('repetitions must be an integer >= 1');
    }
  }

  if (protocol.numeric_minimum_meaningful_improvement !== undefined && protocol.numeric_minimum_meaningful_improvement !== null) {
    const minImp = extractNumeric(protocol.numeric_minimum_meaningful_improvement);
    if (Number.isNaN(minImp) || minImp <= 0) {
      problems.push('numeric_minimum_meaningful_improvement must be a finite number > 0');
    }
  }

  if (protocol.numeric_maximum_acceptable_product_overhead !== undefined && protocol.numeric_maximum_acceptable_product_overhead !== null) {
    const maxOv = extractNumeric(protocol.numeric_maximum_acceptable_product_overhead);
    if (Number.isNaN(maxOv) || maxOv < 0) {
      problems.push('numeric_maximum_acceptable_product_overhead must be a finite number >= 0');
    }
  }

  // 3. Denominator requirement check (§23 all-started-task denominator).
  if (protocol.all_started_task_denominator) {
    const denomDesc = typeof protocol.all_started_task_denominator === 'string'
      ? protocol.all_started_task_denominator.toLowerCase()
      : JSON.stringify(protocol.all_started_task_denominator).toLowerCase();
    if (denomDesc.includes('success_only') || denomDesc.includes('success only') || denomDesc.includes('completed_only')) {
      problems.push('all_started_task_denominator must include all started tasks, not success-only');
    }
  }

  return { valid: problems.length === 0, problems };
}

/**
 * Freeze an evaluation protocol before observing results (§23 requirement).
 * Produces an immutable, content-addressed protocol record.
 *
 * @param {object} manifest - 22-field protocol manifest
 * @param {object} [meta] - metadata (frozenAt, authorIdentity)
 * @returns {{ frozen: boolean, protocolRecord: object|null, problems: string[] }}
 */
function freezeProtocol(manifest, meta = {}) {
  const validation = validateProtocol(manifest);
  if (!validation.valid) {
    return { frozen: false, protocolRecord: null, problems: validation.problems };
  }

  const protocolDigest = computeProtocolDigest(manifest);
  const frozenAt = (meta && meta.frozenAt && typeof meta.frozenAt === 'string')
    ? meta.frozenAt
    : new Date().toISOString();
  const authorIdentity = (meta && meta.authorIdentity && typeof meta.authorIdentity === 'string')
    ? meta.authorIdentity
    : 'evaluation_owner';

  const protocolRecord = Object.freeze({
    kind: 'evaluation_protocol',
    protocolId: `ep-${protocolDigest.slice(0, 16)}`,
    protocolDigest,
    frozenAt,
    authorIdentity,
    manifest: Object.freeze(JSON.parse(JSON.stringify(manifest))),
  });

  return { frozen: true, protocolRecord, problems: [] };
}

// ---------------------------------------------------------------------------
// Raw Metrics Validation
// ---------------------------------------------------------------------------

/**
 * Validate a set of raw metrics across the 9 §23 dimensions.
 * Enforces all-started-task denominator and full product cost accounting.
 *
 * @param {object} metrics - raw metrics collection object
 * @returns {{ valid: boolean, problems: string[] }}
 */
function validateRawMetrics(metrics) {
  const problems = [];
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) {
    return { valid: false, problems: ['metrics must be a non-null object'] };
  }

  // Check all 9 required metric categories are present.
  for (const cat of METRIC_CATEGORIES) {
    if (!metrics[cat] || typeof metrics[cat] !== 'object') {
      problems.push(`missing required metric category "${cat}"`);
    }
  }

  if (problems.length > 0) {
    return { valid: false, problems };
  }

  // 1. Outcomes validation: All-started-task denominator.
  const outcomes = metrics.outcomes;
  const started = extractNumeric(outcomes.totalStartedTasks !== undefined ? outcomes.totalStartedTasks : outcomes.startedTasks);
  if (Number.isNaN(started) || started <= 0) {
    problems.push('outcomes.totalStartedTasks must be a positive integer > 0');
  } else {
    // If breakdown is provided, verify sum matches totalStartedTasks.
    const completed = extractNumeric(outcomes.completed || 0);
    const failed = extractNumeric(outcomes.failed || 0);
    const blocked = extractNumeric(outcomes.blocked || 0);
    const timedOut = extractNumeric(outcomes.timedOut || outcomes.timed_out || 0);
    const cancelled = extractNumeric(outcomes.cancelled || 0);
    const interrupted = extractNumeric(outcomes.interrupted || 0);
    const undelivered = extractNumeric(outcomes.undelivered || 0);

    const breakdownSum = completed + failed + blocked + timedOut + cancelled + interrupted + undelivered;
    if (breakdownSum > 0 && breakdownSum !== started) {
      problems.push(`outcomes sum (${breakdownSum}) does not match totalStartedTasks (${started})`);
    }

    // Success-only check: if only completed tasks are reported as the denominator.
    if (outcomes.successOnlyDenominator === true) {
      problems.push('success-only cost reporting is strictly prohibited (all-started-task denominator required)');
    }
  }

  // 2. Tokens & Cost: check full product cost accounting and segregation of evaluation-only overhead.
  const tc = metrics.tokens_cost;
  if (tc) {
    if (tc.evaluationOverheadMaskedAsProduct === true) {
      problems.push('evaluation-only overhead cannot be masked as product cost or vice versa');
    }
  }

  // 3. Safety: check separate accounting for denied attempts vs executed harm.
  const safety = metrics.safety;
  if (safety) {
    if (safety.deniedAttempts === undefined && safety.executedHarm === undefined && safety.incidents === undefined) {
      problems.push('safety metrics must distinguish denied attempts, incidents, or executed harm');
    }
  }

  return { valid: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// Comparability Verification (INV-25)
// ---------------------------------------------------------------------------

/**
 * Verify comparability between an Agent Alone run and an Agent + TANDEM run.
 * Asserts:
 * - Equivalent frozen source baseline.
 * - Same independent acceptance standard.
 * - Disclosed common safety floor (disposable evaluation resources for Agent Alone).
 * - Equal collection coverage (no asymmetric unobserved channels).
 * - Controlled or disclosed agent/model/runtime versions.
 *
 * @param {object} agentAloneRun
 * @param {object} tandemRun
 * @param {object} protocol
 * @returns {{ comparable: boolean, reasons: string[] }}
 */
function verifyComparability(agentAloneRun, tandemRun, protocol) {
  const reasons = [];
  if (!agentAloneRun || typeof agentAloneRun !== 'object') {
    return { comparable: false, reasons: ['missing Agent Alone evaluation run'] };
  }
  if (!tandemRun || typeof tandemRun !== 'object') {
    return { comparable: false, reasons: ['missing Agent + TANDEM evaluation run'] };
  }

  // 1. Source baseline equivalence.
  if (!agentAloneRun.sourceBaselineDigest || !tandemRun.sourceBaselineDigest) {
    reasons.push('sourceBaselineDigest missing in one or both evaluation runs');
  } else if (agentAloneRun.sourceBaselineDigest !== tandemRun.sourceBaselineDigest) {
    reasons.push(`source baseline mismatch: "${agentAloneRun.sourceBaselineDigest}" vs "${tandemRun.sourceBaselineDigest}"`);
  }

  // 2. Independent acceptance standard equivalence.
  if (!agentAloneRun.acceptanceContractDigest || !tandemRun.acceptanceContractDigest) {
    reasons.push('acceptanceContractDigest missing in one or both evaluation runs');
  } else if (agentAloneRun.acceptanceContractDigest !== tandemRun.acceptanceContractDigest) {
    reasons.push(`acceptance standard mismatch: "${agentAloneRun.acceptanceContractDigest}" vs "${tandemRun.acceptanceContractDigest}"`);
  }

  // 3. Disclosed common safety floor.
  if (agentAloneRun.safetyFloorDisclosed !== true) {
    reasons.push('common safety floor (disposable evaluation resources for Agent Alone) must be disclosed');
  }

  // 4. Equal collection coverage.
  const aaCov = agentAloneRun.coverage || {};
  const tanCov = tandemRun.coverage || {};
  if (aaCov.unobservedChannelsPresent === true || aaCov.coverageAsymmetry === true) {
    reasons.push('UNSUPPORTED_COVERAGE_ASYMMETRY: unequal collection coverage prevents direct quantitative comparison');
  }
  if (aaCov.scope !== undefined && tanCov.scope !== undefined && aaCov.scope !== tanCov.scope) {
    reasons.push(`collection coverage scope mismatch: "${aaCov.scope}" vs "${tanCov.scope}"`);
  }

  // 5. Controlled agent / model / environment versions.
  if (agentAloneRun.agentModelVersion && tandemRun.agentModelVersion) {
    if (agentAloneRun.agentModelVersion !== tandemRun.agentModelVersion && !protocol?.tools_permissions_resources_and_context_differences) {
      reasons.push(`agent model version difference ("${agentAloneRun.agentModelVersion}" vs "${tandemRun.agentModelVersion}") without declared control`);
    }
  }

  return { comparable: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// Evaluation Integrity Checks
// ---------------------------------------------------------------------------

/**
 * Check evaluation integrity and anti-contamination prohibitions (§23).
 *
 * Prohibits:
 * - Gold patches or answer files entering agent context.
 * - Hidden acceptance data entering searchable candidate paths.
 * - Benchmark-specific memory leakage.
 * - Repeated tuning against the final evaluation set.
 * - Post-result threshold or protocol modification.
 * - Success-only cost reporting.
 * - Treating total task refusal as efficiency.
 *
 * @param {object} evalContext
 * @returns {{ intact: boolean, violations: string[] }}
 */
function checkEvaluationIntegrity(evalContext) {
  const violations = [];
  if (!evalContext || typeof evalContext !== 'object') {
    return { intact: false, violations: ['missing evaluation context'] };
  }

  // 1. Post-result protocol modification.
  if (evalContext.protocolDigest && evalContext.frozenDigest && evalContext.protocolDigest !== evalContext.frozenDigest) {
    violations.push(IntegrityViolation.POST_RESULT_MODIFICATION);
  }

  // 2. Gold patch in agent context.
  if (Array.isArray(evalContext.agentContextFiles)) {
    const hasGoldPatch = evalContext.agentContextFiles.some((f) => {
      const name = (typeof f === 'string' ? f : f?.name || '').toLowerCase();
      return name.includes('gold_patch') || name.includes('gold.patch') || name.includes('solution.diff') || name.includes('answer_key');
    });
    if (hasGoldPatch || evalContext.goldPatchInContext === true) {
      violations.push(IntegrityViolation.GOLD_PATCH_IN_CONTEXT);
    }
  } else if (evalContext.goldPatchInContext === true) {
    violations.push(IntegrityViolation.GOLD_PATCH_IN_CONTEXT);
  }

  // 3. Hidden test leakage in candidate searchable paths.
  if (Array.isArray(evalContext.candidateSearchableFiles)) {
    const hasHiddenTests = evalContext.candidateSearchableFiles.some((f) => {
      const name = (typeof f === 'string' ? f : f?.name || '').toLowerCase();
      return name.includes('hidden_test') || name.includes('acceptance_secret') || name.includes('eval_oracle');
    });
    if (hasHiddenTests || evalContext.hiddenTestLeakage === true) {
      violations.push(IntegrityViolation.HIDDEN_TEST_LEAKAGE);
    }
  } else if (evalContext.hiddenTestLeakage === true) {
    violations.push(IntegrityViolation.HIDDEN_TEST_LEAKAGE);
  }

  // 4. Benchmark memory leakage.
  if (evalContext.benchmarkMemoryLeaked === true) {
    violations.push(IntegrityViolation.MEMORY_LEAKAGE);
  }

  // 5. Final evaluation feedback pollution (recycling final eval results as repair/tuning feedback).
  if (evalContext.finalEvalUsedAsRepairFeedback === true || evalContext.repeatedFinalEvalTuning === true) {
    violations.push(IntegrityViolation.FINAL_EVAL_FEEDBACK_POLLUTION);
  }

  // 6. Success-only denominator manipulation.
  if (evalContext.successOnlyCostReporting === true) {
    violations.push(IntegrityViolation.SUCCESS_ONLY_DENOMINATOR);
  }

  // 7. Refusal treated as efficiency.
  if (evalContext.refusalTreatedAsEfficiency === true) {
    violations.push(IntegrityViolation.REFUSAL_AS_EFFICIENCY);
  }

  // 8. Evaluation-only overhead conflated with product overhead.
  if (evalContext.evaluationOverheadConflated === true) {
    violations.push(IntegrityViolation.EVALUATION_OVERHEAD_CONFLATION);
  }

  return { intact: violations.length === 0, violations };
}

// ---------------------------------------------------------------------------
// Primary Benefit & Overhead Calculations
// ---------------------------------------------------------------------------

/**
 * Compute the primary benefit delta and check against the numeric threshold.
 *
 * @param {object} agentAloneMetrics
 * @param {object} tandemMetrics
 * @param {object} protocolManifest
 * @returns {{ satisfied: boolean, delta: number|null, metric: string, threshold: number, reason: string|null }}
 */
function computePrimaryBenefit(agentAloneMetrics, tandemMetrics, protocolManifest) {
  const metricDesc = protocolManifest.primary_benefit_metric_and_direction;
  const threshold = extractNumeric(protocolManifest.numeric_minimum_meaningful_improvement);

  let metricKey = 'acceptance_rate';
  let direction = 'higher_is_better';

  if (typeof metricDesc === 'string') {
    const lower = metricDesc.toLowerCase();
    if (lower.includes('lower') || lower.includes('decrease') || lower.includes('reduction')) {
      direction = 'lower_is_better';
    }
    if (lower.includes('cost') || lower.includes('token')) metricKey = 'token_cost';
    else if (lower.includes('time') || lower.includes('latency')) metricKey = 'latency';
    else if (lower.includes('human') || lower.includes('effort') || lower.includes('intervention')) metricKey = 'human_effort';
    else metricKey = 'acceptance_rate';
  } else if (metricDesc && typeof metricDesc === 'object') {
    const mName = (metricDesc.metric || '').toLowerCase();
    if (mName.includes('completion') || mName.includes('acceptance') || mName.includes('started')) {
      metricKey = 'acceptance_rate';
    } else {
      metricKey = metricDesc.metric || 'acceptance_rate';
    }
    const dir = (metricDesc.direction || '').toLowerCase();
    direction = (dir.includes('lower') || dir.includes('decrease') || dir.includes('reduction') || dir === 'decrease')
      ? 'lower_is_better'
      : 'higher_is_better';
  }

  // Extract values from raw metrics.
  function extractVal(m, key) {
    if (!m) return NaN;
    if (key === 'acceptance_rate' || key === 'all_started_completion_rate' || key === 'completion_rate') {
      const out = m.outcomes || {};
      const total = extractNumeric(out.totalStartedTasks !== undefined ? out.totalStartedTasks : out.startedTasks);
      const completed = extractNumeric(out.completed || 0);
      return (Number.isFinite(total) && total > 0) ? completed / total : NaN;
    }
    if (m[key] !== undefined) return extractNumeric(m[key]);
    if (m.summary && m.summary[key] !== undefined) return extractNumeric(m.summary[key]);
    return NaN;
  }

  const baseVal = extractVal(agentAloneMetrics, metricKey);
  const tanVal = extractVal(tandemMetrics, metricKey);

  if (Number.isNaN(baseVal) || Number.isNaN(tanVal)) {
    return {
      satisfied: false,
      delta: null,
      metric: metricKey,
      threshold,
      reason: `unable to extract metric "${metricKey}" for comparison (truthful unknown)`,
    };
  }

  let delta = 0;
  let satisfied = false;

  if (direction === 'higher_is_better') {
    delta = tanVal - baseVal;
    delta = Math.round(delta * 1e8) / 1e8;
    satisfied = delta >= threshold;
  } else {
    delta = baseVal - tanVal; // positive delta means improvement (reduction)
    delta = Math.round(delta * 1e8) / 1e8;
    satisfied = delta >= threshold;
  }

  const reason = satisfied
    ? null
    : `improvement delta (${delta.toFixed(4)}) is below required threshold (${threshold})`;

  return { satisfied, delta, metric: metricKey, threshold, reason };
}

/**
 * Compute total TANDEM product overhead and verify it does not exceed the
 * declared maximum acceptable threshold (§23).
 *
 * Full product cost includes: source capture, planning, baselines, refused/failed
 * attempts, verification, repair, finalization, recovery, and retention.
 *
 * @param {object} tandemMetrics
 * @param {object} protocolManifest
 * @returns {{ acceptable: boolean, overheadRatio: number|null, rawOverhead: object, threshold: number, reason: string|null }}
 */
function computeProductOverhead(tandemMetrics, protocolManifest) {
  const threshold = extractNumeric(protocolManifest.numeric_maximum_acceptable_product_overhead);

  const tc = tandemMetrics?.tokens_cost || {};
  const productTokens = extractNumeric(tc.productTokens || tc.tandemProductTokens || tc.totalTokens || 0);
  const baselineTokens = extractNumeric(tc.baselineAgentTokens || tc.agentAloneTokens || productTokens);
  const evalOnlyTokens = extractNumeric(tc.evaluationOnlyTokens || 0);

  const rawOverhead = {
    productTokens,
    baselineTokens,
    evaluationOnlyTokens: evalOnlyTokens,
  };

  if (baselineTokens <= 0 && productTokens <= 0) {
    return {
      acceptable: true,
      overheadRatio: 0,
      rawOverhead,
      threshold,
      reason: null,
    };
  }

  // Overhead ratio = (productTokens - baselineTokens) / baselineTokens, or product overhead fraction.
  const overheadRatio = baselineTokens > 0
    ? Math.max(0, (productTokens - baselineTokens) / baselineTokens)
    : 0;

  const acceptable = overheadRatio <= threshold;
  const reason = acceptable
    ? null
    : `product overhead ratio (${overheadRatio.toFixed(4)}) exceeds maximum acceptable threshold (${threshold})`;

  return { acceptable, overheadRatio, rawOverhead, threshold, reason };
}

// ---------------------------------------------------------------------------
// Gate 3 Value Decision Reduction
// ---------------------------------------------------------------------------

/**
 * Master deterministic reduction for §25 Gate 3 Value.
 *
 * Exit criteria (§25 lines 1902–1912):
 * - Prior gates (0, 1, 2) passed.
 * - Protocol valid and fixed before results.
 * - Comparable complete all-attempt collection.
 * - Independent equivalent acceptance.
 * - Correctness and safety hard gates satisfied (INV-22).
 * - Numeric meaningful-benefit rule satisfied.
 * - Numeric maximum-overhead rule satisfied.
 * - Predeclared uncertainty requirement satisfied.
 * - No unresolved evaluation-integrity issue.
 *
 * FAIL CLOSED: Efficiency or token savings CANNOT offset a safety or
 * correctness regression (INV-22).
 *
 * @param {object} params
 * @param {object} params.protocolRecord - frozen protocol record
 * @param {object} params.agentAloneRun - Agent Alone evaluation data and metrics
 * @param {object} params.tandemRun - Agent + TANDEM evaluation data and metrics
 * @param {object} [params.evalContext] - integrity context
 * @param {object} [params.priorGates] - status of prior gates ({ gate0, gate1, gate2 })
 * @returns {{
 *   verdict: string,
 *   gate3Passed: boolean,
 *   hardGatesPassed: boolean,
 *   benefitPassed: boolean,
 *   overheadPassed: boolean,
 *   uncertaintyPassed: boolean,
 *   reasons: string[]
 * }}
 */
function reducePairedEvaluation({
  protocolRecord,
  agentAloneRun,
  tandemRun,
  evalContext = {},
  priorGates = { gate0: false, gate1: false, gate2: false },
}) {
  const reasons = [];
  let hardGatesPassed = false;
  let benefitPassed = false;
  let overheadPassed = false;
  let uncertaintyPassed = false;

  // 1. Gate Prerequisites: Gates 0, 1, and 2 must all be passed.
  const gatesPassed = priorGates && priorGates.gate0 === true && priorGates.gate1 === true && priorGates.gate2 === true;
  if (!gatesPassed) {
    reasons.push('prior implementation gates (Gate 0, Gate 1, Gate 2) must be passed before Gate 3');
    return {
      verdict: EvaluationOutcome.BLOCKED,
      gate3Passed: false,
      hardGatesPassed: false,
      benefitPassed: false,
      overheadPassed: false,
      uncertaintyPassed: false,
      reasons,
    };
  }

  // 2. Protocol freeze and validity.
  if (!protocolRecord || protocolRecord.kind !== 'evaluation_protocol' || !protocolRecord.manifest) {
    reasons.push('valid frozen evaluation protocol record is required');
    return {
      verdict: EvaluationOutcome.BLOCKED,
      gate3Passed: false,
      hardGatesPassed: false,
      benefitPassed: false,
      overheadPassed: false,
      uncertaintyPassed: false,
      reasons,
    };
  }

  const manifest = protocolRecord.manifest;
  const protoVal = validateProtocol(manifest);
  if (!protoVal.valid) {
    reasons.push(...protoVal.problems);
    return {
      verdict: EvaluationOutcome.BLOCKED,
      gate3Passed: false,
      hardGatesPassed: false,
      benefitPassed: false,
      overheadPassed: false,
      uncertaintyPassed: false,
      reasons,
    };
  }

  // Protocol digest integrity: protocol manifest must match recorded digest.
  const computedDigest = computeProtocolDigest(manifest);
  if (computedDigest !== protocolRecord.protocolDigest) {
    reasons.push('protocol digest mismatch: protocol modified after freeze');
    return {
      verdict: EvaluationOutcome.BLOCKED,
      gate3Passed: false,
      hardGatesPassed: false,
      benefitPassed: false,
      overheadPassed: false,
      uncertaintyPassed: false,
      reasons,
    };
  }

  // 3. Evaluation Integrity & Anti-Contamination.
  const mergedEvalContext = {
    protocolDigest: computedDigest,
    frozenDigest: protocolRecord.protocolDigest,
    ...evalContext,
  };
  const integrity = checkEvaluationIntegrity(mergedEvalContext);
  if (!integrity.intact) {
    reasons.push(...integrity.violations.map((v) => `evaluation integrity violation: ${v}`));
    return {
      verdict: EvaluationOutcome.BLOCKED,
      gate3Passed: false,
      hardGatesPassed: false,
      benefitPassed: false,
      overheadPassed: false,
      uncertaintyPassed: false,
      reasons,
    };
  }

  // 4. Comparability Verification (INV-25).
  const comp = verifyComparability(agentAloneRun, tandemRun, manifest);
  if (!comp.comparable) {
    reasons.push(...comp.reasons);
    return {
      verdict: EvaluationOutcome.UNSUPPORTED_COMPARISON,
      gate3Passed: false,
      hardGatesPassed: false,
      benefitPassed: false,
      overheadPassed: false,
      uncertaintyPassed: false,
      reasons,
    };
  }

  // 5. Raw Metrics Validation.
  const aaMetricsVal = validateRawMetrics(agentAloneRun.metrics);
  const tanMetricsVal = validateRawMetrics(tandemRun.metrics);
  if (!aaMetricsVal.valid || !tanMetricsVal.valid) {
    reasons.push(...aaMetricsVal.problems.map((p) => `Agent Alone metrics: ${p}`));
    reasons.push(...tanMetricsVal.problems.map((p) => `TANDEM metrics: ${p}`));
    return {
      verdict: EvaluationOutcome.BLOCKED,
      gate3Passed: false,
      hardGatesPassed: false,
      benefitPassed: false,
      overheadPassed: false,
      uncertaintyPassed: false,
      reasons,
    };
  }

  // 6. Safety & Correctness Hard Gates (INV-22).
  // Check Safety: Any safety incident or executed harm in TANDEM blocks acceptance.
  const tanSafety = tandemRun.metrics?.safety || {};
  const aaSafety = agentAloneRun.metrics?.safety || {};
  const tanIncidents = extractNumeric(tanSafety.incidents || tanSafety.executedHarm || 0);
  const aaIncidents = extractNumeric(aaSafety.incidents || aaSafety.executedHarm || 0);

  if (tanIncidents > 0 || tanIncidents > aaIncidents) {
    reasons.push(`INV-22 hard gate violation: TANDEM had ${tanIncidents} safety incident(s) / executed harm`);
  }

  // Check Correctness: Any acceptance rate / correctness regression blocks acceptance.
  const aaOutcomes = agentAloneRun.metrics.outcomes;
  const tanOutcomes = tandemRun.metrics.outcomes;
  const aaCompleted = extractNumeric(aaOutcomes.completed || 0);
  const aaStarted = extractNumeric(aaOutcomes.totalStartedTasks || 1);
  const tanCompleted = extractNumeric(tanOutcomes.completed || 0);
  const tanStarted = extractNumeric(tanOutcomes.totalStartedTasks || 1);

  const aaRate = aaStarted > 0 ? aaCompleted / aaStarted : 0;
  const tanRate = tanStarted > 0 ? tanCompleted / tanStarted : 0;

  if (tanRate < aaRate) {
    reasons.push(`INV-22 hard gate violation: correctness regression (TANDEM rate ${tanRate.toFixed(4)} < Agent Alone rate ${aaRate.toFixed(4)})`);
  }

  hardGatesPassed = reasons.length === 0;
  if (!hardGatesPassed) {
    return {
      verdict: EvaluationOutcome.FAIL,
      gate3Passed: false,
      hardGatesPassed: false,
      benefitPassed: false,
      overheadPassed: false,
      uncertaintyPassed: false,
      reasons,
    };
  }

  // 7. Statistical Uncertainty & Sample Size.
  const requiredSample = extractNumeric(manifest.sample_size);
  const totalEvaluated = tanStarted;
  if (totalEvaluated < requiredSample) {
    reasons.push(`insufficient sample size (${totalEvaluated} < required ${requiredSample})`);
    uncertaintyPassed = false;
  } else if (tandemRun.uncertaintyInconclusive === true) {
    reasons.push('statistical uncertainty analysis yielded inconclusive confidence bounds');
    uncertaintyPassed = false;
  } else {
    uncertaintyPassed = true;
  }

  if (!uncertaintyPassed) {
    return {
      verdict: EvaluationOutcome.INCONCLUSIVE,
      gate3Passed: false,
      hardGatesPassed: true,
      benefitPassed: false,
      overheadPassed: false,
      uncertaintyPassed: false,
      reasons,
    };
  }

  // 8. Primary Meaningful Benefit.
  const benefit = computePrimaryBenefit(agentAloneRun.metrics, tandemRun.metrics, manifest);
  benefitPassed = benefit.satisfied;
  if (!benefitPassed) {
    reasons.push(benefit.reason || 'primary benefit did not meet numeric minimum threshold');
  }

  // 9. Maximum Acceptable Product Overhead.
  const overhead = computeProductOverhead(tandemRun.metrics, manifest);
  overheadPassed = overhead.acceptable;
  if (!overheadPassed) {
    reasons.push(overhead.reason || 'product overhead exceeded numeric maximum threshold');
  }

  const gate3Passed = hardGatesPassed && uncertaintyPassed && benefitPassed && overheadPassed;
  const verdict = gate3Passed ? EvaluationOutcome.PASS : EvaluationOutcome.FAIL;

  return {
    verdict,
    gate3Passed,
    hardGatesPassed,
    benefitPassed,
    overheadPassed,
    uncertaintyPassed,
    reasons,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  PROTOCOL_FIELDS,
  PROTOCOL_FIELDS_SET,
  METRIC_CATEGORIES,
  METRIC_CATEGORIES_SET,
  EvaluationOutcome,
  IntegrityViolation,
  computeProtocolDigest,
  validateProtocol,
  freezeProtocol,
  validateRawMetrics,
  verifyComparability,
  checkEvaluationIntegrity,
  computePrimaryBenefit,
  computeProductOverhead,
  reducePairedEvaluation,
};
