'use strict';
/**
 * Test suite for §30 Final Integration, §31 Completion Criteria,
 * and §32 Required Reports.
 *
 * Exercises:
 * - 29-field Runtime Task Report model completeness, individual omission, corruption (fail closed)
 * - Invariant: incumbent_modified must be strictly boolean false
 * - Acceptance coherence rules (delivery_identity, digests, authority_retired, quiescence)
 * - 15-field Implementation Executor's Final Report model completeness & fail-closed checks
 * - Invariant: test outcome classifications (cannot count NOT_RUN / BLOCKED as PASS)
 * - §30 18-step sequential integration procedure lattice validation
 * - §30 Release disposition evaluation under open blockers / Gate 0 NOT PASSED
 * - §31 29-condition completion criteria evaluation
 * - Preservation of Gate 0 and authorityGranted: false
 */

const assert = require('node:assert');
const {
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
} = require('../../src/contracts/integration-reports.js');

function validTaskReport(overrides = {}) {
  return generateTaskReport(
    {},
    {
      task_id: 'task-001',
      lineage_id: 'lin-001',
      incarnation_id: 'inc-001',
      selected_source_identity: 'src-rev-abc123',
      qualified_profile_digest: 'a'.repeat(64),
      acceptance_contract_digest: 'b'.repeat(64),
      execution_result: 'COMPLETED_SUCCESS',
      accepted_or_not_accepted: true,
      assurance: 'High assurance qualified observation',
      stop_reason: 'TERMINAL_DELIVERY',
      contributing_failure_and_limitation_reasons: [],
      changed_scope: ['src/contracts/integration-reports.js'],
      mandatory_obligation_results: { 'OB-01': 'PASS', 'OB-02': { outcome: 'PASS' } },
      optional_obligation_results: {},
      verification_scope_and_derivation: 'DERIVATION_QUALIFIED',
      evidence_references: ['ref-01', 'ref-02'],
      authority_retired: true,
      quiescence_state: 'QUIESCENT',
      fencing_or_unresolved_boundary: 'FENCING_CONFIRMED',
      quarantined_resources: [],
      settled_usage: { cpuMs: 120, memoryBytes: 1048576, tokens: 450, wallClockMs: 250, costUsd: 0.005 },
      outstanding_reserved_liability: { cpuMs: 0, memoryBytes: 0, tokens: 0, costUsd: 0 },
      estimated_or_unavailable_metrics: [],
      hard_limit_status: 'WITHIN_HARD_LIMITS',
      delivery_identity: 'delivery-uuid-999',
      payload_and_manifest_digests: {
        payloadDigest: 'c'.repeat(64),
        manifestDigest: 'd'.repeat(64),
      },
      delivery_availability: 'AVAILABLE',
      retention_expiry: 1800000,
      ...overrides,
    },
  );
}

function validImplementationReport(overrides = {}) {
  return generateImplementationReport({
    contract: 'TANDEM_MASTER_EXECUTION_PRD_V1.md / V4',
    source: 'commit-9bc6f90-verified',
    current_code_findings: 'Gate 0 audit completed; IB-01..IB-04 identified',
    profile: 'termux-android-arm64-unqualified',
    work_completed: 'Units 1-19 contract and test suites complete',
    gate_status: {
      gate0: 'NOT_PASSED',
      gate1: 'NOT_RUN',
      gate2: 'NOT_RUN',
      gate3: 'NOT_RUN',
      gate4: 'NOT_RUN',
    },
    tests: {
      total: 730,
      passed: 730,
      failed: 0,
      not_run: 0,
      blocked: 0,
      excluded: 0,
    },
    traceability: 'INV-01..INV-25, T-01..T-14 bound to contract unit suites',
    safety: 'Protected roots intact; incumbent_modified: false; authorityGranted: false',
    resources: 'Conservative reservations; no uncontrolled consumption',
    delivery: 'Delivery publication algebras verified',
    value: 'Paired value evaluation unexecuted; IB-04 open',
    limitations: ['Host profile unqualified (IB-01)', 'Supervised execution unavailable'],
    blockers: ['IB-01', 'IB-02', 'IB-03', 'IB-04'],
    release_disposition: ReleaseDisposition.CHECKER_ONLY,
    ...overrides,
  });
}

function run(t, group) {
  group('§32 Runtime Task Report Model (29 mandatory fields)');

  t('valid task report passes schema validation', () => {
    const rep = validTaskReport();
    const res = validateTaskReport(rep);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.errors.length, 0);
    assert.strictEqual(res.missingFields.length, 0);
  });

  t('task report digest computation is deterministic', () => {
    const rep1 = validTaskReport();
    const rep2 = validTaskReport();
    const d1 = computeTaskReportDigest(rep1);
    const d2 = computeTaskReportDigest(rep2);
    assert.strictEqual(typeof d1, 'string');
    assert.strictEqual(d1.length, 64);
    assert.strictEqual(d1, d2);

    rep2.task_id = 'task-different';
    assert.notStrictEqual(computeTaskReportDigest(rep1), computeTaskReportDigest(rep2));
  });

  t('non-object / null / array task reports fail closed', () => {
    assert.strictEqual(validateTaskReport(null).valid, false);
    assert.strictEqual(validateTaskReport(undefined).valid, false);
    assert.strictEqual(validateTaskReport('string').valid, false);
    assert.strictEqual(validateTaskReport(123).valid, false);
    assert.strictEqual(validateTaskReport([]).valid, false);
  });

  // Verify omission of each of the 29 mandatory fields fails closed
  for (const field of RUNTIME_TASK_REPORT_FIELDS) {
    t(`task report fails closed when field "${field}" is omitted`, () => {
      const rep = validTaskReport();
      delete rep[field];
      const res = validateTaskReport(rep);
      assert.strictEqual(res.valid, false);
      assert.ok(res.missingFields.includes(field));
      assert.ok(res.errors.some((e) => e.includes(field)));
    });
  }

  group('§32 Task Report Invariant: incumbent_modified must be strictly false');

  t('task report with incumbent_modified: true fails validation', () => {
    const rep = validTaskReport();
    rep.incumbent_modified = true;
    const res = validateTaskReport(rep);
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes('incumbent_modified')));
  });

  t('task report with non-boolean incumbent_modified fails validation', () => {
    const rep = validTaskReport();
    rep.incumbent_modified = 'false';
    const res = validateTaskReport(rep);
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes('incumbent_modified')));
  });

  group('§32 Task Report Acceptance Coherence Invariants');

  t('accepted task report without delivery_identity fails closed', () => {
    const rep = validTaskReport({ delivery_identity: null });
    const res = validateTaskReport(rep);
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes('delivery_identity')));
  });

  t('accepted task report with missing payload/manifest digests fails closed', () => {
    const rep = validTaskReport({
      payload_and_manifest_digests: { payloadDigest: null, manifestDigest: 'd'.repeat(64) },
    });
    const res = validateTaskReport(rep);
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes('payloadDigest')));
  });

  t('accepted task report with authority_retired: false fails closed', () => {
    const rep = validTaskReport({ authority_retired: false });
    const res = validateTaskReport(rep);
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes('authority_retired')));
  });

  t('accepted task report with non-QUIESCENT state fails closed', () => {
    const rep = validTaskReport({ quiescence_state: 'UNRESOLVED_EXECUTION' });
    const res = validateTaskReport(rep);
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes('quiescence_state')));
  });

  t('accepted task report with non-passing mandatory obligation fails closed', () => {
    const rep = validTaskReport({
      mandatory_obligation_results: { 'OB-01': 'PASS', 'OB-02': 'FAIL' },
    });
    const res = validateTaskReport(rep);
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes('non-passing mandatory obligation')));
  });

  group('§32 Implementation Executor\'s Final Report Model (15 mandatory fields)');

  t('valid implementation report passes validation', () => {
    const rep = validImplementationReport();
    const res = validateImplementationReport(rep);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.errors.length, 0);
    assert.strictEqual(res.missingFields.length, 0);
  });

  t('implementation report digest computation is deterministic', () => {
    const rep1 = validImplementationReport();
    const rep2 = validImplementationReport();
    const d1 = computeImplementationReportDigest(rep1);
    const d2 = computeImplementationReportDigest(rep2);
    assert.strictEqual(typeof d1, 'string');
    assert.strictEqual(d1.length, 64);
    assert.strictEqual(d1, d2);

    rep2.work_completed = 'Different work description';
    assert.notStrictEqual(computeImplementationReportDigest(rep1), computeImplementationReportDigest(rep2));
  });

  // Verify omission of each of the 15 mandatory fields fails closed
  for (const field of IMPLEMENTATION_REPORT_FIELDS) {
    t(`implementation report fails closed when field "${field}" is omitted`, () => {
      const rep = validImplementationReport();
      delete rep[field];
      const res = validateImplementationReport(rep);
      assert.strictEqual(res.valid, false);
      assert.ok(res.missingFields.includes(field));
      assert.ok(res.errors.some((e) => e.includes(field)));
    });
  }

  t('invalid release_disposition fails closed', () => {
    const rep = validImplementationReport({ release_disposition: 'INVALID_RELEASE_STATE' });
    const res = validateImplementationReport(rep);
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes('Invalid release_disposition')));
  });

  t('test summary falsification: NOT_RUN / BLOCKED cannot be claimed as passed', () => {
    const badTests = {
      total: 10,
      passed: 10,
      failed: 0,
      not_run: 10,
      blocked: 0,
      excluded: 0,
    };
    const rep = validImplementationReport({ tests: badTests });
    const res = validateImplementationReport(rep);
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes('falsification')));
  });

  t('RELEASE_READY_FOR_DECLARED_PROFILE forbidden while blockers are open', () => {
    const rep = validImplementationReport({
      release_disposition: ReleaseDisposition.RELEASE_READY_FOR_DECLARED_PROFILE,
      blockers: ['IB-01', 'IB-02'],
      gate_status: { gate0: 'PASSED' },
      value: { valueEstablished: true },
    });
    const res = validateImplementationReport(rep);
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes('forbidden while implementation blockers are open')));
  });

  t('RELEASE_READY_FOR_DECLARED_PROFILE forbidden when Gate 0 is NOT_PASSED', () => {
    const rep = validImplementationReport({
      release_disposition: ReleaseDisposition.RELEASE_READY_FOR_DECLARED_PROFILE,
      blockers: [],
      gate_status: { gate0: 'NOT_PASSED' },
      value: { valueEstablished: true },
    });
    const res = validateImplementationReport(rep);
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes('Gate 0 to be PASSED')));
  });

  t('RELEASE_READY_FOR_DECLARED_PROFILE forbidden without empirical value evidence', () => {
    const rep = validImplementationReport({
      release_disposition: ReleaseDisposition.RELEASE_READY_FOR_DECLARED_PROFILE,
      blockers: [],
      gate_status: { gate0: 'PASSED' },
      value: 'Paired value evaluation unexecuted; IB-04 open',
    });
    const res = validateImplementationReport(rep);
    assert.strictEqual(res.valid, false);
    assert.ok(res.errors.some((e) => e.includes('empirical value evidence')));
  });

  group('§30 18-Step Integration Procedure Lattice');

  t('complete 18-step sequential execution in order passes', () => {
    const steps = FINAL_INTEGRATION_STEPS.map((s) => ({
      step: s.step,
      name: s.name,
      status: 'PASS',
      evidence: `Evidence for step ${s.step}`,
    }));
    const res = validateIntegrationProcedure(steps);
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.completedSteps, 18);
    assert.strictEqual(res.errors.length, 0);
  });

  t('out of order step execution fails closed', () => {
    const steps = [
      { step: 1, name: 'SOURCE_REVISION_IDENTIFICATION', status: 'PASS' },
      { step: 3, name: 'BLOCKER_CHECK', status: 'PASS' }, // Skipped step 2
    ];
    const res = validateIntegrationProcedure(steps);
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.completedSteps, 1);
    assert.ok(res.errors.some((e) => e.includes('Out of order')));
  });

  t('step non-PASS status stops procedure progression', () => {
    const steps = [
      { step: 1, name: 'SOURCE_REVISION_IDENTIFICATION', status: 'PASS' },
      { step: 2, name: 'CODE_MAP_AND_PROFILE_CONFIRMATION', status: 'FAIL' },
    ];
    const res = validateIntegrationProcedure(steps);
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.completedSteps, 1);
    assert.ok(res.errors.some((e) => e.includes('did not PASS')));
  });

  group('§30 Release Disposition Evaluation');

  t('incumbent modification forces BLOCKED disposition', () => {
    const res = evaluateReleaseDisposition({
      incumbentModified: true,
      checkerOnlyValid: true,
    });
    assert.strictEqual(res.disposition, ReleaseDisposition.BLOCKED);
    assert.ok(res.reasons.some((r) => r.includes('incumbent')));
  });

  t('test failures force BLOCKED disposition', () => {
    const res = evaluateReleaseDisposition({
      testsPassed: false,
      checkerOnlyValid: true,
    });
    assert.strictEqual(res.disposition, ReleaseDisposition.BLOCKED);
    assert.ok(res.reasons.some((r) => r.includes('test failures')));
  });

  t('open blockers + Gate 0 NOT passed evaluate to CHECKER_ONLY when checker valid', () => {
    const res = evaluateReleaseDisposition({
      blockers: ['IB-01', 'IB-02', 'IB-03', 'IB-04'],
      gate0Passed: false,
      checkerOnlyValid: true,
      testsPassed: true,
    });
    assert.strictEqual(res.disposition, ReleaseDisposition.CHECKER_ONLY);
    assert.ok(res.reasons.some((r) => r.includes('IB-01')));
    assert.ok(res.reasons.some((r) => r.includes('Gate 0 has NOT passed')));
  });

  t('open blockers evaluate to BLOCKED when checker is invalid', () => {
    const res = evaluateReleaseDisposition({
      blockers: ['IB-01'],
      gate0Passed: false,
      checkerOnlyValid: false,
      testsPassed: true,
    });
    assert.strictEqual(res.disposition, ReleaseDisposition.BLOCKED);
  });

  t('safety qualified without value evidence evaluates to VALUE_NOT_ESTABLISHED', () => {
    const res = evaluateReleaseDisposition({
      blockers: [],
      gate0Passed: true,
      gatesPassed: true,
      safetyQualified: true,
      valueEvidenceEstablished: false,
    });
    assert.strictEqual(res.disposition, ReleaseDisposition.VALUE_NOT_ESTABLISHED);
    assert.ok(res.reasons.some((r) => r.includes('value evidence')));
  });

  t('all gates + safety qualified + value evidence evaluates to RELEASE_READY_FOR_DECLARED_PROFILE', () => {
    const res = evaluateReleaseDisposition({
      blockers: [],
      gate0Passed: true,
      gatesPassed: true,
      safetyQualified: true,
      valueEvidenceEstablished: true,
      incumbentModified: false,
      testsPassed: true,
    });
    assert.strictEqual(res.disposition, ReleaseDisposition.RELEASE_READY_FOR_DECLARED_PROFILE);
    assert.strictEqual(res.reasons.length, 0);
  });

  group('§31 Completion Criteria Checklist (29 conditions)');

  t('all 29 completion criteria satisfied passes check', () => {
    const ctx = {};
    for (const c of COMPLETION_CRITERIA_CONDITIONS) {
      ctx[c] = true;
    }
    const res = checkCompletionCriteria(ctx);
    assert.strictEqual(res.satisfied, true);
    assert.strictEqual(res.passingConditions.length, 29);
    assert.strictEqual(res.failingConditions.length, 0);
  });

  t('omission or false value in completion criteria fails check', () => {
    const ctx = {};
    for (const c of COMPLETION_CRITERIA_CONDITIONS) {
      ctx[c] = true;
    }
    ctx.incumbent_and_git_protected_from_agents_and_helpers = false;
    delete ctx.all_inv01_through_inv25_covered_by_applicable_tests;

    const res = checkCompletionCriteria(ctx);
    assert.strictEqual(res.satisfied, false);
    assert.strictEqual(res.failingConditions.length, 2);
    assert.ok(res.failingConditions.includes('incumbent_and_git_protected_from_agents_and_helpers'));
    assert.ok(res.failingConditions.includes('all_inv01_through_inv25_covered_by_applicable_tests'));
  });
}

module.exports = run;
