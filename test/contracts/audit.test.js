'use strict';
/**
 * Tests for Deterministic Repository Auditor (bin/audit.cjs).
 *
 * Verifies that each of the 6 defect detectors correctly fires on synthetic/seeded
 * defects and passes on compliant inputs:
 *   1. QUALIFIED without evidence
 *   2. Partial-sample reporting
 *   3. Grader reachable by candidate
 *   4. Post-hoc-only enforcement
 *   5. Claim-evidence mismatch
 *   6. Completion claim & fingerprint consistency
 *   7. Unified runAllAudits runner
 */

const assert = require('node:assert');
const path = require('node:path');
const {
  auditQualifiedWithoutEvidence,
  auditPartialSampleReporting,
  auditGraderReachable,
  auditPostHocOnlyEnforcement,
  auditClaimEvidenceMismatch,
  auditCompletionClaimMismatch,
  computeStateFingerprint,
  runAllAudits,
} = require('../../bin/audit.cjs');

module.exports = function run(t, group) {
  group('Auditor Detector 1: QUALIFIED without evidence');

  t('fires when a blocker is marked QUALIFIED without commit hash or CI run ID', () => {
    const seededMarkdown = `
# Qualification
| Blocker | Description | Owner Decision Status | Qualification Status |
| :--- | :--- | :--- | :--- |
| **IB-01** | Runtime profile | **DECIDED** | **QUALIFIED** |

## IB-01: Runtime Profile
- Qualification State: **QUALIFIED**
- Notes: We tested this manually and it looks good. No commits or run IDs listed here.
`;
    const defects = auditQualifiedWithoutEvidence({
      content: seededMarkdown,
      filePath: 'docs/QUALIFICATION.md',
    });

    assert.ok(defects.length >= 1, 'Expected defect for unevidenced QUALIFIED blocker');
    const d = defects.find((x) => x.type === 'QUALIFIED_WITHOUT_EVIDENCE');
    assert.ok(d, 'Expected QUALIFIED_WITHOUT_EVIDENCE defect');
    assert.ok(d.message.includes('IB-01'));
    assert.ok(d.line > 0);
  });

  t('passes when a blocker has valid commit hash or CI run ID', () => {
    const validMarkdown = `
# Qualification
| Blocker | Description | Owner Decision Status | Qualification Status |
| :--- | :--- | :--- | :--- |
| **IB-01** | Runtime profile | **DECIDED** | **QUALIFIED** (run 35397253342) |

## IB-01: Runtime Profile
- Qualification State: **QUALIFIED** (Commit a2187aa, CI run 35397253342)
- Network isolation verified with exit code 1.
`;
    const defects = auditQualifiedWithoutEvidence({
      content: validMarkdown,
      filePath: 'docs/QUALIFICATION.md',
    });

    assert.strictEqual(defects.length, 0, 'Expected zero defects for evidenced blocker');
  });

  group('Auditor Detector 2: Partial-sample reporting');

  t('fires when percentage denominator does not match completed runs count in state.json', () => {
    const seededMarkdown = `
## Summary
- Arm A Pass Rate: 50.00% ($5 / 10$)
- Arm B Pass Rate: 75.00% ($12 / 16$)
`;
    const mockState = {
      runs: [
        ...Array(18).fill(null).map((_, i) => ({ id: `run-a-${i}`, arm: 'A', status: 'COMPLETED' })),
        ...Array(16).fill(null).map((_, i) => ({ id: `run-b-${i}`, arm: 'B', status: 'COMPLETED' })),
      ],
    };

    const defects = auditPartialSampleReporting({
      resultsContent: seededMarkdown,
      stateData: mockState,
      resultsPath: 'docs/PAIRED_EVALUATION_RESULTS.md',
    });

    assert.ok(defects.length >= 1, 'Expected defect for denominator mismatch');
    const d = defects.find((x) => x.type === 'PARTIAL_SAMPLE_REPORTING');
    assert.ok(d, 'Expected PARTIAL_SAMPLE_REPORTING defect');
    assert.ok(d.message.includes('10') && d.message.includes('18'));
  });

  t('passes when percentage denominators strictly match state.json completed runs', () => {
    const validMarkdown = `
## Summary
- Arm A Pass Rate: 0.00% ($0 / 18$)
- Arm B Pass Rate: 75.00% ($12 / 16$)
`;
    const mockState = {
      runs: [
        ...Array(18).fill(null).map((_, i) => ({ id: `run-a-${i}`, arm: 'A', status: 'COMPLETED' })),
        ...Array(16).fill(null).map((_, i) => ({ id: `run-b-${i}`, arm: 'B', status: 'COMPLETED' })),
      ],
    };

    const defects = auditPartialSampleReporting({
      resultsContent: validMarkdown,
      stateData: mockState,
      resultsPath: 'docs/PAIRED_EVALUATION_RESULTS.md',
    });

    assert.strictEqual(defects.length, 0, 'Expected zero defects for matching sample sizes');
  });

  group('Auditor Detector 3: Grader reachable by candidate');

  t('fires when grader file is included in allowed mutation scope', () => {
    const seededManifest = {
      tasks: [
        {
          id: 'TASK-01',
          grader_rel_path: 'bench/graders/task-01.grader.cjs',
          allowed_files: [
            'src/index.cjs',
            'bench/graders/task-01.grader.cjs',
          ],
        },
      ],
    };

    const defects = auditGraderReachable({
      manifestsData: [seededManifest],
      manifestPaths: ['bench/tasks/manifest.json'],
    });

    assert.ok(defects.length >= 1, 'Expected defect when grader is reachable in allowed_files');
    const d = defects.find((x) => x.type === 'GRADER_REACHABLE');
    assert.ok(d, 'Expected GRADER_REACHABLE defect');
    assert.ok(d.message.includes('bench/graders/task-01.grader.cjs'));
    assert.ok(d.message.includes('TASK-01'));
  });

  t('passes when grader file is completely excluded from allowed mutation scope', () => {
    const validManifest = {
      tasks: [
        {
          id: 'TASK-01',
          grader_rel_path: 'bench/graders/task-01.grader.cjs',
          allowed_files: [
            'src/gates/detect.cjs',
          ],
        },
      ],
    };

    const defects = auditGraderReachable({
      manifestsData: [validManifest],
      manifestPaths: ['bench/tasks/manifest.json'],
    });

    assert.strictEqual(defects.length, 0, 'Expected zero defects when grader is isolated');
  });

  group('Auditor Detector 4: Post-hoc-only enforcement');

  t('fires when beforeTool lacks active write-time blocking checks', () => {
    const seededIndexCjs = `
class Tandem {
  beforeTool(rawEvent) {
    // Post-hoc only: just log the event without blocking
    console.log('Tool called:', rawEvent);
    return { block: false };
  }
}
module.exports = { Tandem };
`;

    const defects = auditPostHocOnlyEnforcement({
      content: seededIndexCjs,
      filePath: 'src/index.cjs',
    });

    assert.ok(defects.length >= 1, 'Expected defect for missing write-time blocking in beforeTool');
    const d = defects.find((x) => x.type === 'POST_HOC_ONLY_ENFORCEMENT');
    assert.ok(d, 'Expected POST_HOC_ONLY_ENFORCEMENT defect');
  });

  t('passes when beforeTool has active write-time blocking checks', () => {
    const validIndexCjs = `
class Tandem {
  beforeTool(rawEvent) {
    if (this.scope) {
      const allowed = this.scope.getAllowedFiles();
      if (!allowed.includes(rawEvent.file)) {
        return { block: true, reason: 'DISALLOWED_MUTATION' };
      }
    }
    if (this.workingSet && !this.workingSet.inWorkingSet(rawEvent.file)) {
      return { block: true, reason: 'OUT_OF_WORKING_SET' };
    }
    const check = BC.check(this.counters);
    if (!check.within) {
      return { block: true, reason: 'BUDGET_EXCEEDED' };
    }
    return { block: false };
  }
}
module.exports = { Tandem };
`;

    const defects = auditPostHocOnlyEnforcement({
      content: validIndexCjs,
      filePath: 'src/index.cjs',
    });

    assert.strictEqual(defects.length, 0, 'Expected zero defects for active write-time checks');
  });

  group('Auditor Detector 5: Claim-evidence mismatch');

  t('fires when claimed metric in results document differs from ground truth in state.json', () => {
    const mockState = {
      runs: [
        { id: '1', arm: 'A', status: 'COMPLETED', stage2_passed: true, passed: false, tool_calls: 10, wall_time_ms: 1000, lines_added: 5, lines_removed: 0 },
        { id: '2', arm: 'B', status: 'COMPLETED', stage2_passed: true, passed: true, tool_calls: 10, wall_time_ms: 1000, lines_added: 5, lines_removed: 0 },
      ],
    };

    // False claim: Solution quality claimed as 99.99% when actual is 100% (1/1 = 100.00%)
    const seededMarkdown = `
| Metric Dimension | Arm A | Arm B |
| **Solution Quality (\`stage2_passed\`)** | **99.99%** | **50.00%** |
`;

    const defects = auditClaimEvidenceMismatch({
      resultsContent: seededMarkdown,
      stateData: mockState,
      resultsPath: 'docs/PAIRED_EVALUATION_RESULTS.md',
    });

    assert.ok(defects.length >= 1, 'Expected defect for claim-evidence mismatch');
    const d = defects.find((x) => x.type === 'CLAIM_EVIDENCE_MISMATCH');
    assert.ok(d, 'Expected CLAIM_EVIDENCE_MISMATCH defect');
  });

  t('passes when claimed metrics in results document match ground truth in state.json', () => {
    const mockState = {
      runs: [
        { id: '1', arm: 'A', status: 'COMPLETED', stage2_passed: true, passed: false, tool_calls: 10, wall_time_ms: 1000, lines_added: 20, lines_removed: 0 },
        { id: '2', arm: 'B', status: 'COMPLETED', stage2_passed: true, passed: true, tool_calls: 10, wall_time_ms: 1000, lines_added: 10, lines_removed: 0 },
      ],
    };

    const validMarkdown = `
| Metric Dimension | Arm A | Arm B |
| **Solution Quality (\`stage2_passed\`)** | **100.00%** | **100.00%** |
| **Overall Pass Rate ($P$)** | **0.00%** | **100.00%** |
| **Mean Tool Calls** | 10.00 calls | 10.00 calls | 1.00× |
| **Mean Lines Changed** | 20.00 lines | 10.00 lines | 0.50× |
`;

    const defects = auditClaimEvidenceMismatch({
      resultsContent: validMarkdown,
      stateData: mockState,
      resultsPath: 'docs/PAIRED_EVALUATION_RESULTS.md',
    });

    assert.strictEqual(defects.length, 0, 'Expected zero defects for matching claims and evidence');
  });

  group('Auditor Detector 6: Completion claim & fingerprint consistency');

  t('fires when document claims all 60 runs completed but state.json has incomplete/invalid runs', () => {
    const mockState = {
      baseline_commit: 'afa46cd',
      total_tasks: 30,
      total_runs: 60,
      completed_runs: 41,
      invalid_runs: 19,
      runs: [
        ...Array(41).fill(null).map((_, i) => ({ run_index: i + 1, arm: i % 2 === 0 ? 'A' : 'B', status: 'COMPLETED' })),
        ...Array(19).fill(null).map((_, i) => ({ run_index: i + 42, arm: i % 2 === 0 ? 'A' : 'B', status: 'INVALID' })),
      ],
    };
    const fp = computeStateFingerprint(mockState);

    const seededMarkdown = `
<!-- state_fingerprint: ${fp} -->
# Evaluation Results
We executed the evaluation and all 60 paired runs completed successfully.
`;

    const defects = auditCompletionClaimMismatch({
      stateData: mockState,
      documents: [{ filePath: 'docs/PAIRED_EVALUATION_RESULTS.md', content: seededMarkdown }],
    });

    assert.ok(defects.length >= 1, 'Expected defect when claiming all 60 completed with only 41 completed runs');
    const d = defects.find((x) => x.type === 'COMPLETION_CLAIM_MISMATCH');
    assert.ok(d, 'Expected COMPLETION_CLAIM_MISMATCH defect');
    assert.ok(d.message.includes('41 completed'));
  });

  t('fires when document is missing state fingerprint', () => {
    const mockState = {
      baseline_commit: 'afa46cd',
      total_tasks: 30,
      total_runs: 60,
      completed_runs: 41,
      invalid_runs: 19,
      runs: [],
    };

    const seededMarkdown = `
# Evaluation Results
- Arm A completed: 22
- Arm B completed: 19
`;

    const defects = auditCompletionClaimMismatch({
      stateData: mockState,
      documents: [{ filePath: 'docs/PAIRED_EVALUATION_RESULTS.md', content: seededMarkdown }],
    });

    assert.ok(defects.length >= 1, 'Expected defect for missing fingerprint');
    const d = defects.find((x) => x.type === 'COMPLETION_CLAIM_MISMATCH');
    assert.ok(d, 'Expected COMPLETION_CLAIM_MISMATCH defect');
    assert.ok(d.message.includes('missing an evaluation state fingerprint'));
  });

  t('fires when state fingerprint in document does not match updated state.json', () => {
    const mockStateBefore = {
      baseline_commit: 'afa46cd',
      total_tasks: 30,
      total_runs: 60,
      completed_runs: 40,
      invalid_runs: 0,
      runs: Array(40).fill(null).map((_, i) => ({ run_index: i + 1, arm: 'A', status: 'COMPLETED' })),
    };
    const oldFp = computeStateFingerprint(mockStateBefore);

    // Now state is updated with a 41st run (denominator/data changed)
    const mockStateAfter = {
      baseline_commit: 'afa46cd',
      total_tasks: 30,
      total_runs: 60,
      completed_runs: 41,
      invalid_runs: 0,
      runs: Array(41).fill(null).map((_, i) => ({ run_index: i + 1, arm: 'A', status: 'COMPLETED' })),
    };

    const seededMarkdown = `
<!-- state_fingerprint: ${oldFp} -->
# Evaluation Results
- Completed valid trials: 40
`;

    const defects = auditCompletionClaimMismatch({
      stateData: mockStateAfter,
      documents: [{ filePath: 'docs/PAIRED_EVALUATION_RESULTS.md', content: seededMarkdown }],
    });

    assert.ok(defects.length >= 1, 'Expected defect for fingerprint mismatch when state changes');
    const d = defects.find((x) => x.type === 'COMPLETION_CLAIM_MISMATCH');
    assert.ok(d, 'Expected COMPLETION_CLAIM_MISMATCH defect');
    assert.ok(d.message.includes('does not match current state.json fingerprint'));
  });

  t('passes when completion claims and state fingerprint strictly match state.json', () => {
    const mockState = {
      baseline_commit: 'afa46cd',
      total_tasks: 30,
      total_runs: 60,
      completed_runs: 41,
      invalid_runs: 19,
      runs: [
        ...Array(41).fill(null).map((_, i) => ({ run_index: i + 1, arm: i % 2 === 0 ? 'A' : 'B', status: 'COMPLETED' })),
        ...Array(19).fill(null).map((_, i) => ({ run_index: i + 42, arm: i % 2 === 0 ? 'A' : 'B', status: 'INVALID' })),
      ],
    };
    const fp = computeStateFingerprint(mockState);

    const validMarkdown = `
<!-- state_fingerprint: ${fp} -->
# Evaluation Results
- Total scheduled runs: 60
- Completed valid trials: 41 (22 in Arm A, 19 in Arm B)
- Invalid timeout runs: 19 (8 in Arm A, 11 in Arm B)
`;

    const defects = auditCompletionClaimMismatch({
      stateData: mockState,
      documents: [{ filePath: 'docs/PAIRED_EVALUATION_RESULTS.md', content: validMarkdown }],
    });

    assert.strictEqual(defects.length, 0, 'Expected zero defects for matching state fingerprint and claims');
  });

  group('Auditor Integration: Live repository audit');

  t('runAllAudits passes on actual repository state with 0 defects', () => {
    const result = runAllAudits();
    if (!result.passed) {
      const msgs = result.defects.map((d) => `${d.type}: ${d.message} (${d.file}:${d.line})`).join('\n');
      assert.fail(`Live repo audit failed with ${result.defects.length} defect(s):\n${msgs}`);
    }
    assert.strictEqual(result.passed, true);
    assert.strictEqual(result.defects.length, 0);
  });
};
