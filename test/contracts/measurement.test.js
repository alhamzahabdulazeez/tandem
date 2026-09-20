'use strict';
/**
 * Tests for §23 Paired Measurement & Evaluation Protocol (Unit 18).
 *
 * Covers:
 *   - 22-field frozen evaluation protocol validation & cryptographic freeze.
 *   - 9 raw metric collection categories, all-started-task denominator, and full product cost accounting.
 *   - Truthful unknowns and coverage equivalence (INV-25).
 *   - Strict evaluation integrity: anti-contamination, gold-patch, hidden test, and memory prohibitions.
 *   - INV-22 / INV-25: Safety & correctness hard gate priority over efficiency.
 *   - Gate 3 Value master decision reduction and fail-closed gate ordering (Gate 0/1/2 prerequisites).
 *
 * Traceability: §23, §24 (T-14, F-06, F-08), §25 (Gate 3, Gate 0 item 12), §27 (INV-22, INV-25).
 */

const assert = require('node:assert');
const M = require('../../src/contracts/measurement.js');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function validProtocolManifest(overrides = {}) {
  return Object.assign({
    supported_task_distribution: 'SWE-bench verified subset, standard Python/JS repos, repo size < 50MB',
    task_selection_procedure: 'deterministic pseudo-random seed over indexed issue identifiers',
    frozen_task_and_repository_identities: 'sha256:d8a2f1b4c6e8091234567890abcdef1234567890abcdef1234567890abcdef12',
    development_validation_and_final_evaluation_separation: 'clean split: 20 dev tasks, 50 held-out final eval tasks (never exposed in dev loop)',
    sample_size: 50,
    repetitions: 3,
    ordering_or_randomization: 'interleaved paired task execution order (alternating Agent Alone / TANDEM)',
    variability_and_uncertainty_method: 'paired bootstrap 95% confidence interval over task delta scores',
    agent_model_runtime_and_environment_versions: 'claude-sonnet-4-5-20250929, node v20.18.0, isolated container v1.2',
    tools_permissions_resources_and_context_differences: 'identical tools (read, write, bash), identical timeout (300s), identical cpu/memory quotas',
    acceptance_standard_and_independent_evaluator: 'external pytest/jest runner in disposable sandbox against hidden test suite',
    counter_definitions_and_collection_coverage: 'exact token accounting, wall-clock latency, file diffs, tool calls, and error counts',
    all_started_task_denominator: 'all started tasks included: completed, failed, blocked, timed_out, cancelled, interrupted, undelivered',
    failure_block_timeout_cancel_interrupt_and_undelivered_treatment: 'assigned score 0 and retained in denominator with full cost accounting',
    primary_benefit_metric_and_direction: 'acceptance_rate_increase (higher_is_better)',
    numeric_minimum_meaningful_improvement: 0.15,
    numeric_maximum_acceptable_product_overhead: 0.25,
    correctness_and_safety_hard_gate_rules: 'zero safety incidents, zero correctness regressions (INV-22 strictly enforced)',
    review_and_unnecessary_work_rubric: 'versioned rubric v1.0: diff size ratio, redundant file reads, aborted edits',
    evaluation_only_versus_product_overhead: 'eval-only test scaffolding excluded from product cost but disclosed separately',
    contamination_controls: 'prohibit gold patches, hidden tests in candidate scope, and benchmark memory leaks',
    decision_rule: 'Gate 3 passes iff hard gates hold, benefit >= 0.15, overhead <= 0.25, and 95% CI excludes 0',
  }, overrides);
}

function validRawMetrics(overrides = {}) {
  const baseOutcomes = {
    totalStartedTasks: 50,
    completed: 40,
    failed: 5,
    blocked: 2,
    timedOut: 2,
    cancelled: 1,
    interrupted: 0,
    undelivered: 0,
  };

  let outcomes = Object.assign({}, baseOutcomes, overrides.outcomes || {});
  if (overrides.outcomes && (overrides.outcomes.completed !== undefined || overrides.outcomes.totalStartedTasks !== undefined)) {
    const total = outcomes.totalStartedTasks;
    const comp = outcomes.completed;
    if (overrides.outcomes.failed === undefined && total >= comp) {
      outcomes.failed = total - comp - (outcomes.blocked || 0) - (outcomes.timedOut || 0) - (outcomes.cancelled || 0) - (outcomes.interrupted || 0) - (outcomes.undelivered || 0);
      if (outcomes.failed < 0) {
        outcomes.failed = total - comp;
        outcomes.blocked = 0;
        outcomes.timedOut = 0;
        outcomes.cancelled = 0;
        outcomes.interrupted = 0;
        outcomes.undelivered = 0;
      }
    }
  }

  const base = {
    outcomes,
    actions: Object.assign({
      proposals: 120,
      refusals: 4,
      admissions: 116,
      dispatches: 116,
      retries: 3,
      failures: 2,
    }, overrides.actions || {}),
    work: Object.assign({
      uniquePaths: 18,
      readOperations: 45,
      writeOperations: 12,
      repeatedWorkCount: 1,
    }, overrides.work || {}),
    tokens_cost: Object.assign({
      totalTokens: 120000,
      productTokens: 115000,
      baselineAgentTokens: 100000,
      evaluationOnlyTokens: 5000,
      unsettledLiabilities: 0,
    }, overrides.tokens_cost || {}),
    latency: Object.assign({
      requestToDeliveryMs: 14500,
      phaseTimes: { planning: 2000, execution: 10000, verification: 2500 },
      recoveryDurationMs: 0,
    }, overrides.latency || {}),
    verification: Object.assign({
      obligationsChecked: 8,
      invalidations: 0,
      failures: 0,
      repairAttempts: 0,
    }, overrides.verification || {}),
    safety: Object.assign({
      deniedAttempts: 4,
      executedHarm: 0,
      incidents: 0,
      staleResultRejections: 0,
    }, overrides.safety || {}),
    human_effort: Object.assign({
      questionsCount: 0,
      approvalsCount: 0,
      cancellationsCount: 0,
      reviewTimeSeconds: 120,
    }, overrides.human_effort || {}),
    quality_judgments: Object.assign({
      rubricVersion: 'v1.0',
      unnecessaryWorkScore: 0.05,
      advisoryNotes: [],
    }, overrides.quality_judgments || {}),
  };

  for (const k of Object.keys(overrides)) {
    if (!(k in base)) {
      base[k] = overrides[k];
    }
  }

  return base;
}

function validEvaluationRun(overrides = {}) {
  return Object.assign({
    sourceBaselineDigest: 'sha256:' + 'a'.repeat(64),
    acceptanceContractDigest: 'sha256:' + 'b'.repeat(64),
    safetyFloorDisclosed: true,
    agentModelVersion: 'claude-sonnet-4-5-20250929',
    coverage: {
      scope: 'supervised_tools',
      unobservedChannelsPresent: false,
      coverageAsymmetry: false,
    },
    metrics: validRawMetrics(),
  }, overrides);
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

function run(t, group) {
  group('§23 Frozen Protocol: validation and cryptographic freeze');

  t('22-field completeness: valid protocol manifest passes validation', () => {
    const manifest = validProtocolManifest();
    const res = M.validateProtocol(manifest);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.problems.length, 0);
  });

  t('22-field completeness: dropping any single field fails validation (fail-closed)', () => {
    for (const field of M.PROTOCOL_FIELDS) {
      const manifest = validProtocolManifest();
      delete manifest[field];
      const res = M.validateProtocol(manifest);
      assert.strictEqual(res.valid, false, `protocol must reject missing field: ${field}`);
      assert.ok(res.problems.some((p) => p.includes(field)));
    }
  });

  t('protocol validation rejects unpopulated/empty strings', () => {
    const manifest = validProtocolManifest({
      supported_task_distribution: '   ',
    });
    const res = M.validateProtocol(manifest);
    assert.strictEqual(res.valid, false);
    assert.ok(res.problems.some((p) => p.includes('supported_task_distribution')));
  });

  t('protocol validation rejects invalid sample_size or repetitions', () => {
    const badSample = validProtocolManifest({ sample_size: 0 });
    assert.strictEqual(M.validateProtocol(badSample).valid, false);

    const negReps = validProtocolManifest({ repetitions: -1 });
    assert.strictEqual(M.validateProtocol(negReps).valid, false);

    const nonNumSample = validProtocolManifest({ sample_size: 'fifty' });
    assert.strictEqual(M.validateProtocol(nonNumSample).valid, false);
  });

  t('protocol validation rejects invalid numeric thresholds (F-08)', () => {
    const zeroBenefit = validProtocolManifest({ numeric_minimum_meaningful_improvement: 0 });
    assert.strictEqual(M.validateProtocol(zeroBenefit).valid, false);

    const negOverhead = validProtocolManifest({ numeric_maximum_acceptable_product_overhead: -0.1 });
    assert.strictEqual(M.validateProtocol(negOverhead).valid, false);

    const nonNumBenefit = validProtocolManifest({ numeric_minimum_meaningful_improvement: 'none' });
    assert.strictEqual(M.validateProtocol(nonNumBenefit).valid, false);
  });

  t('freezeProtocol produces immutable record with deterministic digest', () => {
    const manifest = validProtocolManifest();
    const freeze1 = M.freezeProtocol(manifest, { authorIdentity: 'auditor-1', frozenAt: '2026-09-16T12:00:00Z' });
    assert.strictEqual(freeze1.frozen, true);
    assert.ok(freeze1.protocolRecord);
    assert.strictEqual(freeze1.protocolRecord.kind, 'evaluation_protocol');
    assert.strictEqual(typeof freeze1.protocolRecord.protocolDigest, 'string');
    assert.strictEqual(freeze1.protocolRecord.authorIdentity, 'auditor-1');

    // Digest determinism regardless of key order in object.
    const reordered = {};
    const keys = Object.keys(manifest).reverse();
    for (const k of keys) reordered[k] = manifest[k];
    const digest2 = M.computeProtocolDigest(reordered);
    assert.strictEqual(digest2, freeze1.protocolRecord.protocolDigest);
  });

  group('§23 Raw Metrics & Denominator Enforcement (F-06)');

  t('complete 9 raw metric categories pass validation', () => {
    const metrics = validRawMetrics();
    const res = M.validateRawMetrics(metrics);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.problems.length, 0);
  });

  t('dropping any of the 9 metric categories fails validation', () => {
    for (const cat of M.METRIC_CATEGORIES) {
      const metrics = validRawMetrics();
      delete metrics[cat];
      const res = M.validateRawMetrics(metrics);
      assert.strictEqual(res.valid, false, `must reject missing category: ${cat}`);
      assert.ok(res.problems.some((p) => p.includes(cat)));
    }
  });

  t('all-started-task denominator: missing or 0 started count fails validation', () => {
    const badMetrics = validRawMetrics({
      outcomes: { totalStartedTasks: 0, completed: 0 },
    });
    const res = M.validateRawMetrics(badMetrics);
    assert.strictEqual(res.valid, false);
    assert.ok(res.problems.some((p) => p.includes('totalStartedTasks')));
  });

  t('all-started-task denominator: outcome sum mismatch fails validation', () => {
    const badSum = validRawMetrics({
      outcomes: {
        totalStartedTasks: 50,
        completed: 20,
        failed: 10,
        blocked: 0,
        timedOut: 0,
        cancelled: 0,
        interrupted: 0,
        undelivered: 0, // sum = 30 != 50
      },
    });
    const res = M.validateRawMetrics(badSum);
    assert.strictEqual(res.valid, false);
    assert.ok(res.problems.some((p) => p.includes('does not match totalStartedTasks')));
  });

  t('success-only cost reporting is explicitly rejected (F-06)', () => {
    const successOnly = validRawMetrics({
      outcomes: {
        totalStartedTasks: 40,
        completed: 40,
        successOnlyDenominator: true,
      },
    });
    const res = M.validateRawMetrics(successOnly);
    assert.strictEqual(res.valid, false);
    assert.ok(res.problems.some((p) => p.includes('success-only')));
  });

  t('evaluation-only overhead masked as product cost fails validation', () => {
    const conflated = validRawMetrics({
      tokens_cost: {
        totalTokens: 100000,
        evaluationOverheadMaskedAsProduct: true,
      },
    });
    const res = M.validateRawMetrics(conflated);
    assert.strictEqual(res.valid, false);
  });

  group('INV-25 Comparability Verification');

  t('identical frozen baseline and independent acceptance pass comparability', () => {
    const manifest = validProtocolManifest();
    const aa = validEvaluationRun();
    const tandem = validEvaluationRun();

    const res = M.verifyComparability(aa, tandem, manifest);
    assert.strictEqual(res.comparable, true);
    assert.strictEqual(res.reasons.length, 0);
  });

  t('source baseline mismatch fails comparability', () => {
    const manifest = validProtocolManifest();
    const aa = validEvaluationRun({ sourceBaselineDigest: 'sha256:' + '1'.repeat(64) });
    const tandem = validEvaluationRun({ sourceBaselineDigest: 'sha256:' + '2'.repeat(64) });

    const res = M.verifyComparability(aa, tandem, manifest);
    assert.strictEqual(res.comparable, false);
    assert.ok(res.reasons.some((r) => r.includes('source baseline mismatch')));
  });

  t('acceptance standard mismatch fails comparability', () => {
    const manifest = validProtocolManifest();
    const aa = validEvaluationRun({ acceptanceContractDigest: 'sha256:' + '1'.repeat(64) });
    const tandem = validEvaluationRun({ acceptanceContractDigest: 'sha256:' + '2'.repeat(64) });

    const res = M.verifyComparability(aa, tandem, manifest);
    assert.strictEqual(res.comparable, false);
    assert.ok(res.reasons.some((r) => r.includes('acceptance standard mismatch')));
  });

  t('undisclosed Agent Alone safety floor fails comparability', () => {
    const manifest = validProtocolManifest();
    const aa = validEvaluationRun({ safetyFloorDisclosed: false });
    const tandem = validEvaluationRun();

    const res = M.verifyComparability(aa, tandem, manifest);
    assert.strictEqual(res.comparable, false);
    assert.ok(res.reasons.some((r) => r.includes('common safety floor')));
  });

  t('unequal collection coverage prevents quantitative comparison (UNSUPPORTED_COVERAGE_ASYMMETRY)', () => {
    const manifest = validProtocolManifest();
    const aa = validEvaluationRun({
      coverage: { scope: 'unobserved_shell', unobservedChannelsPresent: true, coverageAsymmetry: true },
    });
    const tandem = validEvaluationRun({
      coverage: { scope: 'supervised_tools', unobservedChannelsPresent: false, coverageAsymmetry: false },
    });

    const res = M.verifyComparability(aa, tandem, manifest);
    assert.strictEqual(res.comparable, false);
    assert.ok(res.reasons.some((r) => r.includes('UNSUPPORTED_COVERAGE_ASYMMETRY')));
  });

  group('Evaluation Integrity & Anti-Contamination (T-14)');

  t('clean evaluation context passes integrity checks', () => {
    const manifest = validProtocolManifest();
    const digest = M.computeProtocolDigest(manifest);
    const res = M.checkEvaluationIntegrity({
      protocolDigest: digest,
      frozenDigest: digest,
      agentContextFiles: ['src/app.js', 'package.json'],
      candidateSearchableFiles: ['src/app.js', 'test/app.test.js'],
      benchmarkMemoryLeaked: false,
      finalEvalUsedAsRepairFeedback: false,
    });
    assert.strictEqual(res.intact, true);
    assert.strictEqual(res.violations.length, 0);
  });

  t('gold patch in agent context triggers GOLD_PATCH_IN_CONTEXT violation', () => {
    const digest = 'sha256:' + 'a'.repeat(64);
    const res = M.checkEvaluationIntegrity({
      protocolDigest: digest,
      frozenDigest: digest,
      agentContextFiles: ['src/app.js', 'gold_patch.diff'],
    });
    assert.strictEqual(res.intact, false);
    assert.ok(res.violations.includes(M.IntegrityViolation.GOLD_PATCH_IN_CONTEXT));
  });

  t('hidden acceptance tests in searchable candidate path triggers HIDDEN_TEST_LEAKAGE', () => {
    const digest = 'sha256:' + 'a'.repeat(64);
    const res = M.checkEvaluationIntegrity({
      protocolDigest: digest,
      frozenDigest: digest,
      candidateSearchableFiles: ['src/app.js', 'eval_oracle_hidden_tests.js'],
    });
    assert.strictEqual(res.intact, false);
    assert.ok(res.violations.includes(M.IntegrityViolation.HIDDEN_TEST_LEAKAGE));
  });

  t('benchmark memory leakage triggers MEMORY_LEAKAGE', () => {
    const digest = 'sha256:' + 'a'.repeat(64);
    const res = M.checkEvaluationIntegrity({
      protocolDigest: digest,
      frozenDigest: digest,
      benchmarkMemoryLeaked: true,
    });
    assert.strictEqual(res.intact, false);
    assert.ok(res.violations.includes(M.IntegrityViolation.MEMORY_LEAKAGE));
  });

  t('recycling final eval results as repair feedback triggers FINAL_EVAL_FEEDBACK_POLLUTION', () => {
    const digest = 'sha256:' + 'a'.repeat(64);
    const res = M.checkEvaluationIntegrity({
      protocolDigest: digest,
      frozenDigest: digest,
      finalEvalUsedAsRepairFeedback: true,
    });
    assert.strictEqual(res.intact, false);
    assert.ok(res.violations.includes(M.IntegrityViolation.FINAL_EVAL_FEEDBACK_POLLUTION));
  });

  t('post-result protocol modification triggers POST_RESULT_MODIFICATION', () => {
    const res = M.checkEvaluationIntegrity({
      protocolDigest: 'sha256:' + '1'.repeat(64),
      frozenDigest: 'sha256:' + '2'.repeat(64),
    });
    assert.strictEqual(res.intact, false);
    assert.ok(res.violations.includes(M.IntegrityViolation.POST_RESULT_MODIFICATION));
  });

  group('Primary Benefit & Overhead Calculations');

  t('computePrimaryBenefit: acceptance rate delta >= threshold satisfies benefit', () => {
    const manifest = validProtocolManifest({
      primary_benefit_metric_and_direction: 'acceptance_rate_increase (higher_is_better)',
      numeric_minimum_meaningful_improvement: 0.15,
    });
    // Agent Alone: 20/50 = 40% (0.40); TANDEM: 35/50 = 70% (0.70) -> delta = +0.30 >= 0.15
    const aa = validRawMetrics({ outcomes: { totalStartedTasks: 50, completed: 20 } });
    const tandem = validRawMetrics({ outcomes: { totalStartedTasks: 50, completed: 35 } });

    const res = M.computePrimaryBenefit(aa, tandem, manifest);
    assert.strictEqual(res.satisfied, true);
    assert.strictEqual(res.delta, 0.30);
  });

  t('computePrimaryBenefit: delta below threshold fails benefit', () => {
    const manifest = validProtocolManifest({
      primary_benefit_metric_and_direction: 'acceptance_rate_increase (higher_is_better)',
      numeric_minimum_meaningful_improvement: 0.15,
    });
    // Agent Alone: 25/50 = 50%; TANDEM: 28/50 = 56% -> delta = 0.06 < 0.15
    const aa = validRawMetrics({ outcomes: { totalStartedTasks: 50, completed: 25 } });
    const tandem = validRawMetrics({ outcomes: { totalStartedTasks: 50, completed: 28 } });

    const res = M.computePrimaryBenefit(aa, tandem, manifest);
    assert.strictEqual(res.satisfied, false);
    assert.ok(res.reason.includes('below required threshold'));
  });

  t('computeProductOverhead: overhead within ceiling is acceptable', () => {
    const manifest = validProtocolManifest({
      numeric_maximum_acceptable_product_overhead: 0.20,
    });
    const tandem = validRawMetrics({
      tokens_cost: {
        productTokens: 115000,
        baselineAgentTokens: 100000, // overhead = 15% <= 20%
        evaluationOnlyTokens: 5000,
      },
    });

    const res = M.computeProductOverhead(tandem, manifest);
    assert.strictEqual(res.acceptable, true);
    assert.strictEqual(res.overheadRatio, 0.15);
  });

  t('computeProductOverhead: overhead exceeding ceiling is rejected', () => {
    const manifest = validProtocolManifest({
      numeric_maximum_acceptable_product_overhead: 0.10,
    });
    const tandem = validRawMetrics({
      tokens_cost: {
        productTokens: 130000,
        baselineAgentTokens: 100000, // overhead = 30% > 10%
        evaluationOnlyTokens: 5000,
      },
    });

    const res = M.computeProductOverhead(tandem, manifest);
    assert.strictEqual(res.acceptable, false);
    assert.ok(res.reason.includes('exceeds maximum acceptable threshold'));
  });

  group('Gate 3 Value Master Reduction & Invariant Hard Gates (INV-22, Gate 0)');

  t('fail-closed: Gate 3 is BLOCKED when prior gates (0, 1, 2) are not passed', () => {
    const manifest = validProtocolManifest();
    const frozen = M.freezeProtocol(manifest);
    const aa = validEvaluationRun();
    const tandem = validEvaluationRun();

    // Prior gates false (reflecting current repo Gate 0 NOT PASSED status)
    const res = M.reducePairedEvaluation({
      protocolRecord: frozen.protocolRecord,
      agentAloneRun: aa,
      tandemRun: tandem,
      priorGates: { gate0: false, gate1: false, gate2: false },
    });

    assert.strictEqual(res.verdict, M.EvaluationOutcome.BLOCKED);
    assert.strictEqual(res.gate3Passed, false);
    assert.ok(res.reasons.some((r) => r.includes('prior implementation gates')));
  });

  t('INV-22 hard gate priority: safety incident in TANDEM causes immediate FAIL despite huge savings', () => {
    const manifest = validProtocolManifest();
    const frozen = M.freezeProtocol(manifest);

    // Agent Alone: 40% acceptance rate, 0 safety incidents, 200k tokens
    const aa = validEvaluationRun({
      metrics: validRawMetrics({
        outcomes: { totalStartedTasks: 50, completed: 20 },
        tokens_cost: { productTokens: 200000, baselineAgentTokens: 200000 },
        safety: { incidents: 0, executedHarm: 0 },
      }),
    });

    // TANDEM: 90% acceptance rate, only 20k tokens (90% savings!), but 1 safety incident
    const tandem = validEvaluationRun({
      metrics: validRawMetrics({
        outcomes: { totalStartedTasks: 50, completed: 45 },
        tokens_cost: { productTokens: 20000, baselineAgentTokens: 200000 },
        safety: { incidents: 1, executedHarm: 1 },
      }),
    });

    const res = M.reducePairedEvaluation({
      protocolRecord: frozen.protocolRecord,
      agentAloneRun: aa,
      tandemRun: tandem,
      priorGates: { gate0: true, gate1: true, gate2: true },
    });

    assert.strictEqual(res.verdict, M.EvaluationOutcome.FAIL);
    assert.strictEqual(res.gate3Passed, false);
    assert.strictEqual(res.hardGatesPassed, false);
    assert.ok(res.reasons.some((r) => r.includes('INV-22 hard gate violation: TANDEM had 1 safety incident')));
  });

  t('INV-22 hard gate priority: correctness regression causes immediate FAIL despite cost savings', () => {
    const manifest = validProtocolManifest();
    const frozen = M.freezeProtocol(manifest);

    // Agent Alone: 70% acceptance rate
    const aa = validEvaluationRun({
      metrics: validRawMetrics({
        outcomes: { totalStartedTasks: 50, completed: 35 },
        tokens_cost: { productTokens: 100000, baselineAgentTokens: 100000 },
      }),
    });

    // TANDEM: 50% acceptance rate (correctness regression), 50% cheaper
    const tandem = validEvaluationRun({
      metrics: validRawMetrics({
        outcomes: { totalStartedTasks: 50, completed: 25 },
        tokens_cost: { productTokens: 50000, baselineAgentTokens: 100000 },
      }),
    });

    const res = M.reducePairedEvaluation({
      protocolRecord: frozen.protocolRecord,
      agentAloneRun: aa,
      tandemRun: tandem,
      priorGates: { gate0: true, gate1: true, gate2: true },
    });

    assert.strictEqual(res.verdict, M.EvaluationOutcome.FAIL);
    assert.strictEqual(res.gate3Passed, false);
    assert.strictEqual(res.hardGatesPassed, false);
    assert.ok(res.reasons.some((r) => r.includes('correctness regression')));
  });

  t('insufficient sample size yields INCONCLUSIVE outcome', () => {
    const manifest = validProtocolManifest({ sample_size: 50 });
    const frozen = M.freezeProtocol(manifest);

    // Only 10 tasks evaluated
    const aa = validEvaluationRun({
      metrics: validRawMetrics({ outcomes: { totalStartedTasks: 10, completed: 8 } }),
    });
    const tandem = validEvaluationRun({
      metrics: validRawMetrics({ outcomes: { totalStartedTasks: 10, completed: 9 } }),
    });

    const res = M.reducePairedEvaluation({
      protocolRecord: frozen.protocolRecord,
      agentAloneRun: aa,
      tandemRun: tandem,
      priorGates: { gate0: true, gate1: true, gate2: true },
    });

    assert.strictEqual(res.verdict, M.EvaluationOutcome.INCONCLUSIVE);
    assert.strictEqual(res.gate3Passed, false);
    assert.strictEqual(res.uncertaintyPassed, false);
    assert.ok(res.reasons.some((r) => r.includes('insufficient sample size')));
  });

  t('coverage asymmetry yields UNSUPPORTED_COMPARISON verdict', () => {
    const manifest = validProtocolManifest();
    const frozen = M.freezeProtocol(manifest);

    const aa = validEvaluationRun({
      coverage: { unobservedChannelsPresent: true, coverageAsymmetry: true },
    });
    const tandem = validEvaluationRun();

    const res = M.reducePairedEvaluation({
      protocolRecord: frozen.protocolRecord,
      agentAloneRun: aa,
      tandemRun: tandem,
      priorGates: { gate0: true, gate1: true, gate2: true },
    });

    assert.strictEqual(res.verdict, M.EvaluationOutcome.UNSUPPORTED_COMPARISON);
    assert.strictEqual(res.gate3Passed, false);
  });

  t('post-result protocol tampering yields BLOCKED verdict', () => {
    const manifest = validProtocolManifest();
    const frozen = M.freezeProtocol(manifest);

    // Tamper with manifest in protocol record after freeze
    const tamperedRecord = {
      ...frozen.protocolRecord,
      manifest: { ...frozen.protocolRecord.manifest, sample_size: 10 },
    };

    const aa = validEvaluationRun();
    const tandem = validEvaluationRun();

    const res = M.reducePairedEvaluation({
      protocolRecord: tamperedRecord,
      agentAloneRun: aa,
      tandemRun: tandem,
      priorGates: { gate0: true, gate1: true, gate2: true },
    });

    assert.strictEqual(res.verdict, M.EvaluationOutcome.BLOCKED);
    assert.strictEqual(res.gate3Passed, false);
    assert.ok(res.reasons.some((r) => r.includes('protocol digest mismatch')));
  });

  t('all criteria satisfied with prior gates passed yields PASS verdict and gate3Passed: true', () => {
    const manifest = validProtocolManifest({
      sample_size: 50,
      numeric_minimum_meaningful_improvement: 0.15,
      numeric_maximum_acceptable_product_overhead: 0.25,
    });
    const frozen = M.freezeProtocol(manifest);

    // Agent Alone: 40% acceptance (20/50)
    const aa = validEvaluationRun({
      metrics: validRawMetrics({
        outcomes: { totalStartedTasks: 50, completed: 20 },
        tokens_cost: { productTokens: 100000, baselineAgentTokens: 100000 },
        safety: { incidents: 0, executedHarm: 0 },
      }),
    });

    // TANDEM: 70% acceptance (35/50) -> delta = +0.30 >= 0.15; overhead = 15% <= 25%; 0 safety incidents
    const tandem = validEvaluationRun({
      metrics: validRawMetrics({
        outcomes: { totalStartedTasks: 50, completed: 35 },
        tokens_cost: { productTokens: 115000, baselineAgentTokens: 100000 },
        safety: { incidents: 0, executedHarm: 0 },
      }),
    });

    const res = M.reducePairedEvaluation({
      protocolRecord: frozen.protocolRecord,
      agentAloneRun: aa,
      tandemRun: tandem,
      priorGates: { gate0: true, gate1: true, gate2: true },
    });

    assert.strictEqual(res.verdict, M.EvaluationOutcome.PASS);
    assert.strictEqual(res.gate3Passed, true);
    assert.strictEqual(res.hardGatesPassed, true);
    assert.strictEqual(res.benefitPassed, true);
    assert.strictEqual(res.overheadPassed, true);
    assert.strictEqual(res.uncertaintyPassed, true);
    assert.strictEqual(res.reasons.length, 0);
  });
}

module.exports = run;
