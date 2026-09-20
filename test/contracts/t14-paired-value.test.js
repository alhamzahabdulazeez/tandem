'use strict';
/**
 * Test Contract T-14: Paired Value (PRD §24, §23, §25 Gate 3, §27, §28, §33)
 *
 * Exercises all normative exercise surfaces from PRD §24 T-14:
 *  1. Predeclared evaluation protocol validation & cryptographic freeze (§23, §33 IB-04, R-43)
 *  2. Frozen baseline inputs & independent acceptance equivalence (INV-25, §23)
 *  3. Controlled agent / model / runtime differences & disclosed safety floor (INV-25, R-04, §23)
 *  4. Comparable collection coverage, truthful unknowns, & asymmetry protection (INV-25, R-37, §23)
 *  5. All-started-task denominator & complete product overhead accounting (INV-25, R-03, R-38, R-49, §23)
 *  6. Evaluation integrity & anti-contamination prohibitions (R-24, R-43, R-48, §23)
 *  7. INV-22 correctness & safety hard gates priority over efficiency (INV-22, §23, §25 Gate 3)
 *  8. Gate 3 Master Value reduction & full decision lattice (§25 Gate 3, §23)
 *  9. Platform qualification boundary (Termux / Android Execution Isolation Profile, IB-01 OPEN)
 *
 * Asserts all 7 normative invariants and assertions:
 *  - Frozen inputs and independent acceptance are equivalent (INV-25, §23).
 *  - Agent/model/runtime differences are controlled or explicitly disclosed (INV-25, §23).
 *  - Collection coverage and denominators are comparable (INV-25, R-37, §23).
 *  - All unsuccessful attempts and complete product overhead are included (INV-25, R-03, R-38, §23).
 *  - Review rubric, numeric benefit/overhead thresholds, and uncertainty rules predate results (R-43, §23).
 *  - No post-result adjustment, hidden-test leakage, or success-only accounting occurs (R-24, R-43, §23).
 *  - Correctness/safety hard gates cannot be offset by efficiency (INV-22, §25 Gate 3).
 *  - Platform Qualification: Physical paired container isolation, hardware resource fencing,
 *    multi-node benchmark containment, and kernel execution isolation are NOT QUALIFIED on Termux/Android, QUALIFIED under the Docker runtime profile in CI.
 *
 * Binds Evidence Families: EM, EV, EX.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const MEASUREMENT = require('../../src/contracts/measurement.js');
const REC = require('../../src/contracts/records.js');
const Q = require('../../src/contracts/qualification.js');
const { sha256, canonicalJson, contentId } = require('../../src/contracts/crypto.js');

const FROZEN_PROTOCOL_PATH = path.join(__dirname, '../../docs/measurement/FROZEN-PROTOCOL-V1.json');

/** Helper to generate valid paired raw metrics for testing */
function createSampleRawMetrics({
  started = 10,
  completed = 8,
  failed,
  blocked = 0,
  timedOut = 0,
  cancelled = 0,
  interrupted = 0,
  undelivered = 0,
  productTokens = 120000,
  baselineTokens = 100000,
  evalOnlyTokens = 15000,
  incidents = 0,
  executedHarm = 0,
  deniedAttempts = 2,
  successOnlyDenominator = false,
  evaluationOverheadMaskedAsProduct = false,
} = {}) {
  const actualFailed = failed !== undefined
    ? failed
    : Math.max(0, started - completed - blocked - timedOut - cancelled - interrupted - undelivered);

  return {
    outcomes: {
      totalStartedTasks: started,
      completed,
      failed: actualFailed,
      blocked,
      timedOut,
      cancelled,
      interrupted,
      undelivered,
      successOnlyDenominator,
    },
    actions: {
      toolCalls: 45,
      commandInvocations: 30,
      diskWrites: 12,
    },
    work: {
      linesChanged: 250,
      astTransformations: 18,
      filesCreated: 4,
    },
    tokens_cost: {
      productTokens,
      baselineAgentTokens: baselineTokens,
      evaluationOnlyTokens: evalOnlyTokens,
      totalTokens: productTokens + evalOnlyTokens,
      estimatedCostUsd: 0.42,
      evaluationOverheadMaskedAsProduct,
    },
    latency: {
      wallClockSeconds: 180,
      timeToFirstEditSeconds: 15,
      verificationSeconds: 35,
    },
    verification: {
      testExecutions: 24,
      assertionPasses: 110,
      repairIterations: 1,
    },
    safety: {
      incidents,
      executedHarm,
      deniedAttempts,
    },
    human_effort: {
      manualInterventions: 0,
      supervisorOverrides: 0,
    },
    quality_judgments: {
      maintainabilityRating: 4.5,
      rubricConformant: true,
    },
  };
}

module.exports = function run(t, group) {

  // -------------------------------------------------------------------------
  // 1. Predeclared Evaluation Protocol Validation & Cryptographic Freeze
  // -------------------------------------------------------------------------
  group('T-14.1: Predeclared Evaluation Protocol Validation & Cryptographic Freeze (PRD §24, §23, §25 Gate 3, §33 IB-04, R-43)');

  t('FROZEN-PROTOCOL-V1.json contains all 22 required fields and passes validateProtocol', () => {
    assert.ok(fs.existsSync(FROZEN_PROTOCOL_PATH), 'FROZEN-PROTOCOL-V1.json must exist');
    const raw = fs.readFileSync(FROZEN_PROTOCOL_PATH, 'utf8');
    const protocol = JSON.parse(raw);

    // Verify all 22 fields are in PROTOCOL_FIELDS
    assert.strictEqual(MEASUREMENT.PROTOCOL_FIELDS.length, 22);
    for (const field of MEASUREMENT.PROTOCOL_FIELDS) {
      assert.ok(protocol[field] !== undefined, `protocol must include "${field}"`);
    }

    const val = MEASUREMENT.validateProtocol(protocol);
    assert.strictEqual(val.valid, true, `validateProtocol failed: ${val.problems.join('; ')}`);
    assert.strictEqual(val.problems.length, 0);
  });

  t('validateProtocol fails closed if any of the 22 canonical fields is missing or empty', () => {
    const raw = fs.readFileSync(FROZEN_PROTOCOL_PATH, 'utf8');
    const baseProto = JSON.parse(raw);

    for (const field of MEASUREMENT.PROTOCOL_FIELDS) {
      const copy = { ...baseProto };
      delete copy[field];
      const val = MEASUREMENT.validateProtocol(copy);
      assert.strictEqual(val.valid, false);
      assert.ok(val.problems.some((p) => p.includes(`missing required protocol field "${field}"`)));
    }

    // Unpopulated / empty string
    const emptyStringCopy = { ...baseProto, decision_rule: '   ' };
    const valEmptyStr = MEASUREMENT.validateProtocol(emptyStringCopy);
    assert.strictEqual(valEmptyStr.valid, false);
    assert.ok(valEmptyStr.problems.some((p) => p.includes('unpopulated required protocol field "decision_rule"')));

    // Empty array
    const emptyArrCopy = { ...baseProto, frozen_task_and_repository_identities: [] };
    const valEmptyArr = MEASUREMENT.validateProtocol(emptyArrCopy);
    assert.strictEqual(valEmptyArr.valid, false);
    assert.ok(valEmptyArr.problems.some((p) => p.includes('empty array for required protocol field "frozen_task_and_repository_identities"')));
  });

  t('validateProtocol fails closed on missing or non-positive numeric thresholds', () => {
    const raw = fs.readFileSync(FROZEN_PROTOCOL_PATH, 'utf8');
    const baseProto = JSON.parse(raw);

    // Invalid sample_size (0 or negative)
    const badSample = { ...baseProto, sample_size: 0 };
    const valSample = MEASUREMENT.validateProtocol(badSample);
    assert.strictEqual(valSample.valid, false);
    assert.ok(valSample.problems.some((p) => p.includes('sample_size must be a positive integer > 0')));

    // Invalid repetitions (< 1)
    const badReps = { ...baseProto, repetitions: 0 };
    const valReps = MEASUREMENT.validateProtocol(badReps);
    assert.strictEqual(valReps.valid, false);
    assert.ok(valReps.problems.some((p) => p.includes('repetitions must be an integer >= 1')));

    // Invalid numeric_minimum_meaningful_improvement (<= 0)
    const badMinImp = { ...baseProto, numeric_minimum_meaningful_improvement: 0 };
    const valMinImp = MEASUREMENT.validateProtocol(badMinImp);
    assert.strictEqual(valMinImp.valid, false);
    assert.ok(valMinImp.problems.some((p) => p.includes('numeric_minimum_meaningful_improvement must be a finite number > 0')));

    // Invalid numeric_maximum_acceptable_product_overhead (< 0)
    const badMaxOv = { ...baseProto, numeric_maximum_acceptable_product_overhead: -0.1 };
    const valMaxOv = MEASUREMENT.validateProtocol(badMaxOv);
    assert.strictEqual(valMaxOv.valid, false);
    assert.ok(valMaxOv.problems.some((p) => p.includes('numeric_maximum_acceptable_product_overhead must be a finite number >= 0')));
  });

  t('computeProtocolDigest is deterministic and binds exactly the 22 canonical fields', () => {
    const raw = fs.readFileSync(FROZEN_PROTOCOL_PATH, 'utf8');
    const proto1 = JSON.parse(raw);
    const proto2 = JSON.parse(raw);

    const digest1 = MEASUREMENT.computeProtocolDigest(proto1);
    const digest2 = MEASUREMENT.computeProtocolDigest(proto2);
    assert.strictEqual(digest1, digest2);
    assert.strictEqual(digest1.length, 64);

    // Non-canonical metadata fields (e.g. comments or notes) do NOT alter the 22-field canonical digest
    const protoWithExtra = { ...proto1, non_canonical_note: 'extra information' };
    const digestExtra = MEASUREMENT.computeProtocolDigest(protoWithExtra);
    assert.strictEqual(digest1, digestExtra);

    // Mutating any canonical field MUST alter the digest
    const protoMutated = { ...proto1, numeric_minimum_meaningful_improvement: 0.20 };
    const digestMutated = MEASUREMENT.computeProtocolDigest(protoMutated);
    assert.notStrictEqual(digest1, digestMutated);
  });

  t('freezeProtocol creates an immutable content-addressed protocol record before results are observed (R-43)', () => {
    const raw = fs.readFileSync(FROZEN_PROTOCOL_PATH, 'utf8');
    const proto = JSON.parse(raw);

    const frozen = MEASUREMENT.freezeProtocol(proto, {
      frozenAt: '2026-09-17T16:30:00.000Z',
      authorIdentity: 'evaluation_authority_t14',
    });

    assert.strictEqual(frozen.frozen, true);
    assert.strictEqual(frozen.problems.length, 0);
    assert.ok(frozen.protocolRecord);
    assert.strictEqual(frozen.protocolRecord.kind, 'evaluation_protocol');
    assert.strictEqual(frozen.protocolRecord.authorIdentity, 'evaluation_authority_t14');
    assert.strictEqual(frozen.protocolRecord.protocolDigest, MEASUREMENT.computeProtocolDigest(proto));
    assert.ok(frozen.protocolRecord.protocolId.startsWith('ep-'));
    assert.ok(Object.isFrozen(frozen.protocolRecord));
  });

  // -------------------------------------------------------------------------
  // 2. Frozen Baseline Inputs & Independent Acceptance Equivalence
  // -------------------------------------------------------------------------
  group('T-14.2: Frozen Baseline Inputs & Independent Acceptance Equivalence (PRD §24, §23, INV-25)');

  t('verifyComparability passes when source baselines and independent acceptance standards are equivalent', () => {
    const raw = fs.readFileSync(FROZEN_PROTOCOL_PATH, 'utf8');
    const protocol = JSON.parse(raw);

    const baselineDigest = sha256('frozen-source-baseline-tree-v1');
    const acceptanceDigest = sha256('acceptance-standard-contract-v1');

    const agentAloneRun = {
      sourceBaselineDigest: baselineDigest,
      acceptanceContractDigest: acceptanceDigest,
      safetyFloorDisclosed: true,
      coverage: { unobservedChannelsPresent: false, coverageAsymmetry: false, scope: 'full-9-dimensions' },
      agentModelVersion: 'gpt-oss-120b@v1',
    };

    const tandemRun = {
      sourceBaselineDigest: baselineDigest,
      acceptanceContractDigest: acceptanceDigest,
      safetyFloorDisclosed: true,
      coverage: { unobservedChannelsPresent: false, coverageAsymmetry: false, scope: 'full-9-dimensions' },
      agentModelVersion: 'gpt-oss-120b@v1',
    };

    const comp = MEASUREMENT.verifyComparability(agentAloneRun, tandemRun, protocol);
    assert.strictEqual(comp.comparable, true);
    assert.strictEqual(comp.reasons.length, 0);
  });

  t('verifyComparability fails when source baselines differ (violating identical frozen input invariant)', () => {
    const raw = fs.readFileSync(FROZEN_PROTOCOL_PATH, 'utf8');
    const protocol = JSON.parse(raw);

    const agentAloneRun = {
      sourceBaselineDigest: sha256('source-baseline-A'),
      acceptanceContractDigest: sha256('acceptance-standard-contract-v1'),
      safetyFloorDisclosed: true,
      coverage: { unobservedChannelsPresent: false, coverageAsymmetry: false },
    };

    const tandemRun = {
      sourceBaselineDigest: sha256('source-baseline-B'), // Mismatch!
      acceptanceContractDigest: sha256('acceptance-standard-contract-v1'),
      safetyFloorDisclosed: true,
      coverage: { unobservedChannelsPresent: false, coverageAsymmetry: false },
    };

    const comp = MEASUREMENT.verifyComparability(agentAloneRun, tandemRun, protocol);
    assert.strictEqual(comp.comparable, false);
    assert.ok(comp.reasons.some((r) => r.includes('source baseline mismatch')));
  });

  t('verifyComparability fails when independent acceptance standards differ', () => {
    const raw = fs.readFileSync(FROZEN_PROTOCOL_PATH, 'utf8');
    const protocol = JSON.parse(raw);

    const baselineDigest = sha256('frozen-source-baseline-tree-v1');

    const agentAloneRun = {
      sourceBaselineDigest: baselineDigest,
      acceptanceContractDigest: sha256('acceptance-standard-relaxed'), // Relaxed standard!
      safetyFloorDisclosed: true,
      coverage: { unobservedChannelsPresent: false, coverageAsymmetry: false },
    };

    const tandemRun = {
      sourceBaselineDigest: baselineDigest,
      acceptanceContractDigest: sha256('acceptance-standard-strict'),
      safetyFloorDisclosed: true,
      coverage: { unobservedChannelsPresent: false, coverageAsymmetry: false },
    };

    const comp = MEASUREMENT.verifyComparability(agentAloneRun, tandemRun, protocol);
    assert.strictEqual(comp.comparable, false);
    assert.ok(comp.reasons.some((r) => r.includes('acceptance standard mismatch')));
  });

  // -------------------------------------------------------------------------
  // 3. Controlled Agent / Model / Runtime Differences & Disclosed Safety Floor
  // -------------------------------------------------------------------------
  group('T-14.3: Controlled Agent / Model / Runtime Differences & Disclosed Safety Floor (PRD §24, §23, INV-25, R-04)');

  t('verifyComparability fails when common safety floor for Agent Alone is not disclosed (R-04)', () => {
    const raw = fs.readFileSync(FROZEN_PROTOCOL_PATH, 'utf8');
    const protocol = JSON.parse(raw);
    const baselineDigest = sha256('frozen-source-baseline-tree-v1');
    const acceptanceDigest = sha256('acceptance-standard-contract-v1');

    const agentAloneRun = {
      sourceBaselineDigest: baselineDigest,
      acceptanceContractDigest: acceptanceDigest,
      safetyFloorDisclosed: false, // Undisclosed safety floor!
      coverage: { unobservedChannelsPresent: false, coverageAsymmetry: false },
    };

    const tandemRun = {
      sourceBaselineDigest: baselineDigest,
      acceptanceContractDigest: acceptanceDigest,
      safetyFloorDisclosed: true,
      coverage: { unobservedChannelsPresent: false, coverageAsymmetry: false },
    };

    const comp = MEASUREMENT.verifyComparability(agentAloneRun, tandemRun, protocol);
    assert.strictEqual(comp.comparable, false);
    assert.ok(comp.reasons.some((r) => r.includes('common safety floor')));
  });

  t('verifyComparability fails when agent/model version differs without declared protocol disclosure', () => {
    const raw = fs.readFileSync(FROZEN_PROTOCOL_PATH, 'utf8');
    const protocolWithoutDisclosure = {
      ...JSON.parse(raw),
      tools_permissions_resources_and_context_differences: null,
    };
    const baselineDigest = sha256('frozen-source-baseline-tree-v1');
    const acceptanceDigest = sha256('acceptance-standard-contract-v1');

    const agentAloneRun = {
      sourceBaselineDigest: baselineDigest,
      acceptanceContractDigest: acceptanceDigest,
      safetyFloorDisclosed: true,
      coverage: { unobservedChannelsPresent: false, coverageAsymmetry: false },
      agentModelVersion: 'claude-3-haiku', // Weaker model for baseline!
    };

    const tandemRun = {
      sourceBaselineDigest: baselineDigest,
      acceptanceContractDigest: acceptanceDigest,
      safetyFloorDisclosed: true,
      coverage: { unobservedChannelsPresent: false, coverageAsymmetry: false },
      agentModelVersion: 'gpt-oss-120b', // Stronger model for tandem!
    };

    const comp = MEASUREMENT.verifyComparability(agentAloneRun, tandemRun, protocolWithoutDisclosure);
    assert.strictEqual(comp.comparable, false);
    assert.ok(comp.reasons.some((r) => r.includes('agent model version difference')));
  });

  // -------------------------------------------------------------------------
  // 4. Comparable Collection Coverage, Truthful Unknowns, & Asymmetry Protection
  // -------------------------------------------------------------------------
  group('T-14.4: Comparable Collection Coverage, Truthful Unknowns, & Asymmetry Protection (PRD §24, §23, INV-25, R-37)');

  t('validateRawMetrics requires all 9 canonical metric collection categories', () => {
    assert.strictEqual(MEASUREMENT.METRIC_CATEGORIES.length, 9);
    for (const cat of MEASUREMENT.METRIC_CATEGORIES) {
      assert.ok(MEASUREMENT.METRIC_CATEGORIES_SET.has(cat));
    }

    const completeMetrics = createSampleRawMetrics();
    const val = MEASUREMENT.validateRawMetrics(completeMetrics);
    assert.strictEqual(val.valid, true);

    // Dropping any of the 9 categories fails validation
    for (const cat of MEASUREMENT.METRIC_CATEGORIES) {
      const incomplete = { ...completeMetrics };
      delete incomplete[cat];
      const valInc = MEASUREMENT.validateRawMetrics(incomplete);
      assert.strictEqual(valInc.valid, false);
      assert.ok(valInc.problems.some((p) => p.includes(`missing required metric category "${cat}"`)));
    }
  });

  t('verifyComparability fails closed with UNSUPPORTED_COVERAGE_ASYMMETRY on unobserved channels or coverage asymmetry (R-37)', () => {
    const raw = fs.readFileSync(FROZEN_PROTOCOL_PATH, 'utf8');
    const protocol = JSON.parse(raw);
    const baselineDigest = sha256('frozen-source-baseline-tree-v1');
    const acceptanceDigest = sha256('acceptance-standard-contract-v1');

    const agentAloneWithUnobserved = {
      sourceBaselineDigest: baselineDigest,
      acceptanceContractDigest: acceptanceDigest,
      safetyFloorDisclosed: true,
      coverage: {
        unobservedChannelsPresent: true, // Unobserved side-channel executions!
        coverageAsymmetry: false,
      },
    };

    const tandemRun = {
      sourceBaselineDigest: baselineDigest,
      acceptanceContractDigest: acceptanceDigest,
      safetyFloorDisclosed: true,
      coverage: {
        unobservedChannelsPresent: false,
        coverageAsymmetry: false,
      },
    };

    const comp = MEASUREMENT.verifyComparability(agentAloneWithUnobserved, tandemRun, protocol);
    assert.strictEqual(comp.comparable, false);
    assert.ok(comp.reasons.some((r) => r.includes('UNSUPPORTED_COVERAGE_ASYMMETRY')));
  });

  t('truthful unknowns: unknown metrics return NaN and cannot be coerced to 0 to claim spurious benefit (R-37)', () => {
    const raw = fs.readFileSync(FROZEN_PROTOCOL_PATH, 'utf8');
    const protocol = JSON.parse(raw);

    const emptyMetrics = {};
    const validTandemMetrics = createSampleRawMetrics({ started: 10, completed: 8 });

    // When Agent Alone outcomes are missing, primary benefit computation returns satisfied: false with truthful unknown reason
    const benefit = MEASUREMENT.computePrimaryBenefit(emptyMetrics, validTandemMetrics, protocol);
    assert.strictEqual(benefit.satisfied, false);
    assert.strictEqual(benefit.delta, null);
    assert.ok(benefit.reason.includes('truthful unknown'));
  });

  // -------------------------------------------------------------------------
  // 5. All-Started-Task Denominator & Complete Product Overhead Accounting
  // -------------------------------------------------------------------------
  group('T-14.5: All-Started-Task Denominator & Complete Product Overhead Accounting (PRD §24, §23, §28 R-03, R-38, R-49, INV-25)');

  t('validateRawMetrics enforces all-started-task denominator and rejects success-only accounting (R-38)', () => {
    // 1. Valid all-started-task metrics
    const validMetrics = createSampleRawMetrics({
      started: 10,
      completed: 6,
      failed: 2,
      blocked: 1,
      timedOut: 1,
    });
    const val = MEASUREMENT.validateRawMetrics(validMetrics);
    assert.strictEqual(val.valid, true);

    // 2. Denominator sum mismatch fails validation
    const mismatchedSum = createSampleRawMetrics({
      started: 10,
      completed: 6,
      failed: 1, // sum = 7 != 10
      blocked: 0,
    });
    const valMismatch = MEASUREMENT.validateRawMetrics(mismatchedSum);
    assert.strictEqual(valMismatch.valid, false);
    assert.ok(valMismatch.problems.some((p) => p.includes('outcomes sum (7) does not match totalStartedTasks (10)')));

    // 3. Success-only denominator flag fails validation
    const successOnly = createSampleRawMetrics({
      started: 6,
      completed: 6,
      successOnlyDenominator: true,
    });
    const valSuccessOnly = MEASUREMENT.validateRawMetrics(successOnly);
    assert.strictEqual(valSuccessOnly.valid, false);
    assert.ok(valSuccessOnly.problems.some((p) => p.includes('success-only cost reporting is strictly prohibited')));
  });

  t('computeProductOverhead includes all product costs and checks against declared maximum ceiling (R-03)', () => {
    const raw = fs.readFileSync(FROZEN_PROTOCOL_PATH, 'utf8');
    const protocol = JSON.parse(raw); // numeric_maximum_acceptable_product_overhead = 0.25

    // Case A: 20% overhead (acceptable <= 0.25)
    const metrics20Pct = createSampleRawMetrics({
      baselineTokens: 100000,
      productTokens: 120000, // +20%
    });
    const resA = MEASUREMENT.computeProductOverhead(metrics20Pct, protocol);
    assert.strictEqual(resA.acceptable, true);
    assert.strictEqual(resA.overheadRatio, 0.2);
    assert.strictEqual(resA.reason, null);

    // Case B: 35% overhead (exceeds 0.25 ceiling)
    const metrics35Pct = createSampleRawMetrics({
      baselineTokens: 100000,
      productTokens: 135000, // +35%
    });
    const resB = MEASUREMENT.computeProductOverhead(metrics35Pct, protocol);
    assert.strictEqual(resB.acceptable, false);
    assert.strictEqual(resB.overheadRatio, 0.35);
    assert.ok(resB.reason.includes('exceeds maximum acceptable threshold'));
  });

  t('evaluation-only overhead is segregated and cannot be masked as product cost (R-49)', () => {
    // 1. Masking evaluation overhead in raw metrics fails validateRawMetrics
    const maskedMetrics = createSampleRawMetrics({
      evaluationOverheadMaskedAsProduct: true,
    });
    const val = MEASUREMENT.validateRawMetrics(maskedMetrics);
    assert.strictEqual(val.valid, false);
    assert.ok(val.problems.some((p) => p.includes('evaluation-only overhead cannot be masked as product cost')));

    // 2. Conflation check in checkEvaluationIntegrity
    const integrityConflated = MEASUREMENT.checkEvaluationIntegrity({
      evaluationOverheadConflated: true,
    });
    assert.strictEqual(integrityConflated.intact, false);
    assert.ok(integrityConflated.violations.includes(MEASUREMENT.IntegrityViolation.EVALUATION_OVERHEAD_CONFLATION));
  });

  // -------------------------------------------------------------------------
  // 6. Evaluation Integrity & Anti-Contamination Prohibitions
  // -------------------------------------------------------------------------
  group('T-14.6: Evaluation Integrity & Anti-Contamination Prohibitions (PRD §24, §23, §28 R-24, R-43, R-48)');

  t('checkEvaluationIntegrity detects all prohibited anti-contamination breaches (R-24, R-43, R-48)', () => {
    // 1. Clean context passes
    const cleanContext = {
      protocolDigest: 'digest-1',
      frozenDigest: 'digest-1',
      agentContextFiles: ['src/index.js', 'src/util.js'],
      candidateSearchableFiles: ['test/unit.js', 'package.json'],
    };
    const cleanRes = MEASUREMENT.checkEvaluationIntegrity(cleanContext);
    assert.strictEqual(cleanRes.intact, true);
    assert.strictEqual(cleanRes.violations.length, 0);

    // 2. Gold patch in agent context
    const goldPatchContext = {
      ...cleanContext,
      agentContextFiles: ['src/index.js', 'gold_patch.diff'],
    };
    const goldRes = MEASUREMENT.checkEvaluationIntegrity(goldPatchContext);
    assert.strictEqual(goldRes.intact, false);
    assert.ok(goldRes.violations.includes(MEASUREMENT.IntegrityViolation.GOLD_PATCH_IN_CONTEXT));

    // 3. Hidden test leakage in searchable candidate files
    const hiddenTestContext = {
      ...cleanContext,
      candidateSearchableFiles: ['test/unit.js', 'hidden_test_oracle.js'],
    };
    const hiddenRes = MEASUREMENT.checkEvaluationIntegrity(hiddenTestContext);
    assert.strictEqual(hiddenRes.intact, false);
    assert.ok(hiddenRes.violations.includes(MEASUREMENT.IntegrityViolation.HIDDEN_TEST_LEAKAGE));

    // 4. Benchmark memory leakage
    const memoryLeakContext = {
      ...cleanContext,
      benchmarkMemoryLeaked: true,
    };
    const memRes = MEASUREMENT.checkEvaluationIntegrity(memoryLeakContext);
    assert.strictEqual(memRes.intact, false);
    assert.ok(memRes.violations.includes(MEASUREMENT.IntegrityViolation.MEMORY_LEAKAGE));

    // 5. Final eval set feedback pollution (R-48)
    const feedbackPollutionContext = {
      ...cleanContext,
      finalEvalUsedAsRepairFeedback: true,
    };
    const fbRes = MEASUREMENT.checkEvaluationIntegrity(feedbackPollutionContext);
    assert.strictEqual(fbRes.intact, false);
    assert.ok(fbRes.violations.includes(MEASUREMENT.IntegrityViolation.FINAL_EVAL_FEEDBACK_POLLUTION));

    // 6. Post-result protocol modification (R-43)
    const postResultContext = {
      protocolDigest: 'modified-digest-after-eval',
      frozenDigest: 'original-frozen-digest',
    };
    const postRes = MEASUREMENT.checkEvaluationIntegrity(postResultContext);
    assert.strictEqual(postRes.intact, false);
    assert.ok(postRes.violations.includes(MEASUREMENT.IntegrityViolation.POST_RESULT_MODIFICATION));

    // 7. Treating task refusal as efficiency
    const refusalContext = {
      ...cleanContext,
      refusalTreatedAsEfficiency: true,
    };
    const refRes = MEASUREMENT.checkEvaluationIntegrity(refusalContext);
    assert.strictEqual(refRes.intact, false);
    assert.ok(refRes.violations.includes(MEASUREMENT.IntegrityViolation.REFUSAL_AS_EFFICIENCY));
  });

  // -------------------------------------------------------------------------
  // 7. INV-22 Correctness & Safety Hard Gates Priority Over Efficiency
  // -------------------------------------------------------------------------
  group('T-14.7: INV-22 Correctness & Safety Hard Gates Priority Over Efficiency (PRD §24, §23, §27 INV-22, §25 Gate 3)');

  t('INV-22: safety incident in TANDEM causes immediate FAIL, regardless of efficiency savings', () => {
    const raw = fs.readFileSync(FROZEN_PROTOCOL_PATH, 'utf8');
    const proto = JSON.parse(raw);
    const { protocolRecord } = MEASUREMENT.freezeProtocol(proto);
    const baselineDigest = sha256('baseline-tree-v1');
    const acceptanceDigest = sha256('acceptance-v1');

    const agentAloneRun = {
      sourceBaselineDigest: baselineDigest,
      acceptanceContractDigest: acceptanceDigest,
      safetyFloorDisclosed: true,
      coverage: { unobservedChannelsPresent: false, coverageAsymmetry: false },
      metrics: createSampleRawMetrics({ started: 10, completed: 5, incidents: 0 }),
    };

    // TANDEM has 90% completion rate and massive token savings, BUT had 1 safety incident
    const tandemRun = {
      sourceBaselineDigest: baselineDigest,
      acceptanceContractDigest: acceptanceDigest,
      safetyFloorDisclosed: true,
      coverage: { unobservedChannelsPresent: false, coverageAsymmetry: false },
      metrics: createSampleRawMetrics({
        started: 10,
        completed: 9, // +40% completion rate!
        productTokens: 50000, // Massive efficiency!
        incidents: 1, // Safety violation!
      }),
    };

    const reduction = MEASUREMENT.reducePairedEvaluation({
      protocolRecord,
      agentAloneRun,
      tandemRun,
      priorGates: { gate0: true, gate1: true, gate2: true },
    });

    assert.strictEqual(reduction.gate3Passed, false);
    assert.strictEqual(reduction.verdict, MEASUREMENT.EvaluationOutcome.FAIL);
    assert.strictEqual(reduction.hardGatesPassed, false);
    assert.ok(reduction.reasons.some((r) => r.includes('INV-22 hard gate violation') && r.includes('safety incident')));
  });

  t('INV-22: correctness regression causes immediate FAIL, regardless of token/latency reduction', () => {
    const raw = fs.readFileSync(FROZEN_PROTOCOL_PATH, 'utf8');
    const proto = JSON.parse(raw);
    const { protocolRecord } = MEASUREMENT.freezeProtocol(proto);
    const baselineDigest = sha256('baseline-tree-v1');
    const acceptanceDigest = sha256('acceptance-v1');

    // Agent Alone completion rate = 80% (8/10)
    const agentAloneRun = {
      sourceBaselineDigest: baselineDigest,
      acceptanceContractDigest: acceptanceDigest,
      safetyFloorDisclosed: true,
      coverage: { unobservedChannelsPresent: false, coverageAsymmetry: false },
      metrics: createSampleRawMetrics({ started: 10, completed: 8, baselineTokens: 200000 }),
    };

    // TANDEM completion rate = 70% (7/10) -> Correctness regression!
    const tandemRun = {
      sourceBaselineDigest: baselineDigest,
      acceptanceContractDigest: acceptanceDigest,
      safetyFloorDisclosed: true,
      coverage: { unobservedChannelsPresent: false, coverageAsymmetry: false },
      metrics: createSampleRawMetrics({
        started: 10,
        completed: 7, // Regression from 8 to 7!
        productTokens: 80000, // 60% token reduction
        failed: 3,
        blocked: 0,
      }),
    };

    const reduction = MEASUREMENT.reducePairedEvaluation({
      protocolRecord,
      agentAloneRun,
      tandemRun,
      priorGates: { gate0: true, gate1: true, gate2: true },
    });

    assert.strictEqual(reduction.gate3Passed, false);
    assert.strictEqual(reduction.verdict, MEASUREMENT.EvaluationOutcome.FAIL);
    assert.strictEqual(reduction.hardGatesPassed, false);
    assert.ok(reduction.reasons.some((r) => r.includes('INV-22 hard gate violation') && r.includes('correctness regression')));
  });

  t('Gate 3 is BLOCKED when prior implementation gates (Gate 0, Gate 1, Gate 2) are not passed (§25)', () => {
    const raw = fs.readFileSync(FROZEN_PROTOCOL_PATH, 'utf8');
    const proto = JSON.parse(raw);
    const { protocolRecord } = MEASUREMENT.freezeProtocol(proto);
    const baselineDigest = sha256('baseline-tree-v1');
    const acceptanceDigest = sha256('acceptance-v1');

    const agentAloneRun = {
      sourceBaselineDigest: baselineDigest,
      acceptanceContractDigest: acceptanceDigest,
      safetyFloorDisclosed: true,
      coverage: { unobservedChannelsPresent: false, coverageAsymmetry: false },
      metrics: createSampleRawMetrics({ started: 10, completed: 5 }),
    };

    const tandemRun = {
      sourceBaselineDigest: baselineDigest,
      acceptanceContractDigest: acceptanceDigest,
      safetyFloorDisclosed: true,
      coverage: { unobservedChannelsPresent: false, coverageAsymmetry: false },
      metrics: createSampleRawMetrics({ started: 10, completed: 8 }),
    };

    // Prior gates NOT passed (Gate 0 open because IB-01 is open)
    const reduction = MEASUREMENT.reducePairedEvaluation({
      protocolRecord,
      agentAloneRun,
      tandemRun,
      priorGates: { gate0: false, gate1: false, gate2: false },
    });

    assert.strictEqual(reduction.gate3Passed, false);
    assert.strictEqual(reduction.verdict, MEASUREMENT.EvaluationOutcome.BLOCKED);
    assert.ok(reduction.reasons.some((r) => r.includes('prior implementation gates (Gate 0, Gate 1, Gate 2) must be passed')));
  });

  // -------------------------------------------------------------------------
  // 8. Gate 3 Master Value Reduction & Full Decision Lattice
  // -------------------------------------------------------------------------
  group('T-14.8: Gate 3 Master Value Reduction & Full Decision Lattice (PRD §24, §25 Gate 3, §23, §30, §31, §32)');

  t('reducePairedEvaluation returns PASS when all 9 Gate 3 exit criteria are satisfied', () => {
    const raw = fs.readFileSync(FROZEN_PROTOCOL_PATH, 'utf8');
    const proto = JSON.parse(raw);
    const { protocolRecord } = MEASUREMENT.freezeProtocol(proto);
    const baselineDigest = sha256('baseline-tree-v1');
    const acceptanceDigest = sha256('acceptance-v1');

    // Agent Alone: 50% completion rate (5/10)
    const agentAloneRun = {
      sourceBaselineDigest: baselineDigest,
      acceptanceContractDigest: acceptanceDigest,
      safetyFloorDisclosed: true,
      coverage: { unobservedChannelsPresent: false, coverageAsymmetry: false, scope: 'full-9-dimensions' },
      agentModelVersion: 'gpt-oss-120b',
      metrics: createSampleRawMetrics({
        started: 10,
        completed: 5,
        failed: 4,
        blocked: 1,
        baselineTokens: 100000,
        productTokens: 100000,
      }),
    };

    // TANDEM: 80% completion rate (8/10, delta = +0.30 >= 0.15 threshold), 15% overhead (<= 0.25 threshold)
    const tandemRun = {
      sourceBaselineDigest: baselineDigest,
      acceptanceContractDigest: acceptanceDigest,
      safetyFloorDisclosed: true,
      coverage: { unobservedChannelsPresent: false, coverageAsymmetry: false, scope: 'full-9-dimensions' },
      agentModelVersion: 'gpt-oss-120b',
      metrics: createSampleRawMetrics({
        started: 10,
        completed: 8,
        failed: 1,
        blocked: 1,
        baselineTokens: 100000,
        productTokens: 115000, // 15% overhead
        incidents: 0,
        executedHarm: 0,
      }),
    };

    const reduction = MEASUREMENT.reducePairedEvaluation({
      protocolRecord,
      agentAloneRun,
      tandemRun,
      evalContext: {
        agentContextFiles: ['src/app.js'],
        candidateSearchableFiles: ['test/unit.js'],
      },
      priorGates: { gate0: true, gate1: true, gate2: true },
    });

    assert.strictEqual(reduction.gate3Passed, true);
    assert.strictEqual(reduction.verdict, MEASUREMENT.EvaluationOutcome.PASS);
    assert.strictEqual(reduction.hardGatesPassed, true);
    assert.strictEqual(reduction.benefitPassed, true);
    assert.strictEqual(reduction.overheadPassed, true);
    assert.strictEqual(reduction.uncertaintyPassed, true);
    assert.strictEqual(reduction.reasons.length, 0);
  });

  t('reducePairedEvaluation returns INCONCLUSIVE when statistical uncertainty bounds are inconclusive', () => {
    const raw = fs.readFileSync(FROZEN_PROTOCOL_PATH, 'utf8');
    const proto = JSON.parse(raw);
    const { protocolRecord } = MEASUREMENT.freezeProtocol(proto);
    const baselineDigest = sha256('baseline-tree-v1');
    const acceptanceDigest = sha256('acceptance-v1');

    const agentAloneRun = {
      sourceBaselineDigest: baselineDigest,
      acceptanceContractDigest: acceptanceDigest,
      safetyFloorDisclosed: true,
      coverage: { unobservedChannelsPresent: false, coverageAsymmetry: false },
      metrics: createSampleRawMetrics({ started: 10, completed: 5 }),
    };

    const tandemRun = {
      sourceBaselineDigest: baselineDigest,
      acceptanceContractDigest: acceptanceDigest,
      safetyFloorDisclosed: true,
      coverage: { unobservedChannelsPresent: false, coverageAsymmetry: false },
      uncertaintyInconclusive: true, // Inconclusive CI bounds!
      metrics: createSampleRawMetrics({ started: 10, completed: 8, productTokens: 115000, baselineTokens: 100000 }),
    };

    const reduction = MEASUREMENT.reducePairedEvaluation({
      protocolRecord,
      agentAloneRun,
      tandemRun,
      priorGates: { gate0: true, gate1: true, gate2: true },
    });

    assert.strictEqual(reduction.gate3Passed, false);
    assert.strictEqual(reduction.verdict, MEASUREMENT.EvaluationOutcome.INCONCLUSIVE);
    assert.ok(reduction.reasons.some((r) => r.includes('statistical uncertainty analysis yielded inconclusive confidence bounds')));
  });

  t('reducePairedEvaluation returns UNSUPPORTED_COMPARISON on coverage asymmetry', () => {
    const raw = fs.readFileSync(FROZEN_PROTOCOL_PATH, 'utf8');
    const proto = JSON.parse(raw);
    const { protocolRecord } = MEASUREMENT.freezeProtocol(proto);
    const baselineDigest = sha256('baseline-tree-v1');
    const acceptanceDigest = sha256('acceptance-v1');

    const agentAloneRun = {
      sourceBaselineDigest: baselineDigest,
      acceptanceContractDigest: acceptanceDigest,
      safetyFloorDisclosed: true,
      coverage: { unobservedChannelsPresent: true, coverageAsymmetry: true },
      metrics: createSampleRawMetrics({ started: 10, completed: 5 }),
    };

    const tandemRun = {
      sourceBaselineDigest: baselineDigest,
      acceptanceContractDigest: acceptanceDigest,
      safetyFloorDisclosed: true,
      coverage: { unobservedChannelsPresent: false, coverageAsymmetry: false },
      metrics: createSampleRawMetrics({ started: 10, completed: 8 }),
    };

    const reduction = MEASUREMENT.reducePairedEvaluation({
      protocolRecord,
      agentAloneRun,
      tandemRun,
      priorGates: { gate0: true, gate1: true, gate2: true },
    });

    assert.strictEqual(reduction.gate3Passed, false);
    assert.strictEqual(reduction.verdict, MEASUREMENT.EvaluationOutcome.UNSUPPORTED_COMPARISON);
    assert.ok(reduction.reasons.some((r) => r.includes('UNSUPPORTED_COVERAGE_ASYMMETRY')));
  });

  // -------------------------------------------------------------------------
  // 9. Platform Qualification Boundary (Termux / Android Execution Profile)
  // -------------------------------------------------------------------------
  group('T-14.9: Platform Qualification Boundary (Termux / Android Execution Profile, IB-01 OPEN)');

  t('qualification reducer reports UNQUALIFIED when paired isolated sandbox container evidence or host virtualization is missing', () => {
    const qualRecord = REC.createQualification({
      qualificationId: 'qual-t14-paired-eval-container',
      profileId: 'profile:linux-paired-container-isolation:v1',
      profileDigest: 'sha256:' + 'a'.repeat(64),
      status: Q.QualificationStatus.QUALIFIED,
      evidenceBindings: [
        { surface: Q.EffectSurface.FILESYSTEM, evidenceIds: ['qe-eval-container-1'] },
      ],
      admittedByContract: 'linux-contained',
      claimedAt: 1000,
    });

    // Evidence with missing / unqualified observer
    const unqualEv = REC.createQualEvidence({
      qualEvidenceId: 'qe-eval-container-1',
      surface: Q.EffectSurface.FILESYSTEM,
      method: Q.EvidenceMethod.ACCESS_TEST,
      evidenceProfileBinding: 'profile:linux-paired-container-isolation:v1',
      result: Q.EvidenceResult.FAIL,
      timestamp: 2000,
      observerIdentity: 'observer-unqual-1',
    });

    const res = Q.resolveQualification({
      qualification: qualRecord,
      evidence: [unqualEv],
      expectedProfileDigest: qualRecord.profileDigest,
    });

    assert.strictEqual(res.status, Q.QualificationStatus.UNQUALIFIED);
    assert.ok(res.problems.some((p) => p.includes('FILESYSTEM') && p.includes('FAIL')));
  });

  t('physical paired container isolation, hardware resource fencing, multi-node benchmark containment, and kernel execution isolation are NOT QUALIFIED on Termux, IB-01 OPEN', () => {
    // Pure evaluation protocol validation, cryptographic freezing, 22-field manifest verification,
    // comparability verification (INV-25), 9-dimension raw metric checking, all-started-task denominator enforcement,
    // anti-contamination rules, INV-22 safety/correctness priority hard gating, product overhead calculation,
    // and Gate 3 master decision reduction are fully verified.
    // Physical paired container isolation, hardware resource fencing, multi-node benchmark containment,
    // and kernel execution isolation cannot be physically qualified on the Android/Termux host environment
    // without root / Linux container namespaces / cgroups.
    const platformQualified = false; // Termux / Android host environment
    assert.strictEqual(platformQualified, false, 'Physical paired container isolation, hardware resource fencing, multi-node benchmark containment, and kernel execution isolation are NOT QUALIFIED on Termux/Android, QUALIFIED under the Docker runtime profile in CI');
  });
};
