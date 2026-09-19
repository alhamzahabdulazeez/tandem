'use strict';
/**
 * test/contracts/ib04-paired-evaluation.test.js
 *
 * Contract test suite for IB-04 Paired Evaluation Protocol:
 *   1. Frozen protocol document docs/PAIRED_EVALUATION.md compliance
 *   2. Task manifest (bench/paired/tasks.json) contains exactly 30 distinct tasks
 *   3. All 30 held-out graders exist and export runGrader(targetDir)
 *   4. Resumable runner schedule (60 runs: 30 tasks x 2 arms A/B)
 *   5. Statistical decision rules via bench/stats.cjs Wilson confidence intervals
 *   6. State checkpointing and resumability invariants
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const stats = require('../../bench/stats.cjs');
const runner = require('../../bench/paired/runner.cjs');

module.exports = function run(t, group) {
  group('IB-04 Paired Evaluation: Protocol Document & Invariants');

  t('docs/PAIRED_EVALUATION.md exists and freezes protocol parameters', () => {
    const docPath = path.join(REPO_ROOT, 'docs', 'PAIRED_EVALUATION.md');
    assert.ok(fs.existsSync(docPath), 'docs/PAIRED_EVALUATION.md must exist');
    const content = fs.readFileSync(docPath, 'utf8');

    assert.ok(content.includes('30') && (content.includes('tasks') || content.includes('Tasks')), 'Must specify 30 tasks');
    assert.ok(content.includes('pass rate') || content.includes('Pass Rate'), 'Must specify primary metric pass rate');
    assert.ok(content.includes('0.15') || content.includes('+15'), 'Must specify +0.15 (+15%) benefit threshold');
    assert.ok(content.includes('1.8') || content.includes('1.80'), 'Must specify 1.8x max overhead ratio');
    assert.ok(content.includes('Wilson') || content.includes('wilson'), 'Must specify Wilson score interval');
    assert.ok(content.includes('afa46cd'), 'Must specify baseline commit afa46cd');
    assert.ok(content.includes('TANDEM_HOOKS=off') && content.includes('TANDEM_HOOKS=on'), 'Must specify two experimental arms');
  });

  group('IB-04 Paired Evaluation: 30-Task Manifest & Grader Integrity');

  t('bench/paired/tasks.json contains exactly 30 tasks with unique IDs and valid allow-lists', () => {
    const tasks = runner.loadTasks();
    assert.strictEqual(tasks.length, 30, 'Manifest must contain exactly 30 tasks');

    const ids = new Set();
    const indices = new Set();

    tasks.forEach((task, idx) => {
      assert.strictEqual(task.index, idx + 1);
      assert.ok(task.id.startsWith('TASK-P'));
      assert.ok(task.title && task.title.length > 0);
      assert.ok(task.module && task.module.startsWith('src/'));
      assert.ok(Array.isArray(task.allowed_files) && task.allowed_files.length > 0);
      assert.ok(task.prompt && task.prompt.length > 0);
      assert.ok(task.grader_rel_path && task.grader_rel_path.startsWith('bench/paired/graders/'));

      ids.add(task.id);
      indices.add(task.index);
    });

    assert.strictEqual(ids.size, 30, 'All task IDs must be unique');
    assert.strictEqual(indices.size, 30, 'All task indices must be unique');
  });

  t('all 30 held-out grader files exist and export runGrader function', () => {
    const tasks = runner.loadTasks();
    for (const task of tasks) {
      const graderPath = path.join(REPO_ROOT, task.grader_rel_path);
      assert.ok(fs.existsSync(graderPath), `Grader file must exist: ${task.grader_rel_path}`);
      const graderMod = require(graderPath);
      assert.strictEqual(typeof graderMod.runGrader, 'function', `${task.grader_rel_path} must export runGrader`);
    }
  });

  group('IB-04 Paired Evaluation: Runner Schedule & Statistical Summary');

  t('buildRunSchedule generates 60 scheduled runs with balanced A/B arms', () => {
    const tasks = runner.loadTasks();
    const runs = runner.buildRunSchedule(tasks);

    assert.strictEqual(runs.length, 60, 'Schedule must contain 60 runs');
    const armA = runs.filter(r => r.arm === 'A' && r.tandem_hooks === 'off');
    const armB = runs.filter(r => r.arm === 'B' && r.tandem_hooks === 'on');

    assert.strictEqual(armA.length, 30, 'Arm A must have 30 runs with hooks off');
    assert.strictEqual(armB.length, 30, 'Arm B must have 30 runs with hooks on');
  });

  t('computeSummary computes Wilson intervals and decision criteria correctly', () => {
    const tasks = runner.loadTasks();
    const runs = runner.buildRunSchedule(tasks);

    // Simulate 30 runs for Arm A (15 pass, 15 fail) and 30 runs for Arm B (25 pass, 5 fail)
    runs.forEach(r => {
      r.status = 'COMPLETED';
      if (r.arm === 'A') {
        r.passed = r.task_index <= 15;
        r.tool_calls = 10;
        r.wall_time_ms = 1000;
        r.lines_added = 5;
        r.lines_removed = 2;
      } else {
        r.passed = r.task_index <= 25;
        r.tool_calls = 12; // 1.2x overhead
        r.wall_time_ms = 1200;
        r.lines_added = 5;
        r.lines_removed = 2;
      }
    });

    const summary = runner.computeSummary(runs);

    assert.strictEqual(summary.arm_A.trials, 30);
    assert.strictEqual(summary.arm_A.successes, 15);
    assert.strictEqual(summary.arm_A.pass_rate, 0.5);

    assert.strictEqual(summary.arm_B.trials, 30);
    assert.strictEqual(summary.arm_B.successes, 25);
    assert.strictEqual(summary.arm_B.pass_rate, parseFloat((25 / 30).toFixed(4)));

    assert.strictEqual(summary.comparison.delta_pass_rate, parseFloat(((25 - 15) / 30).toFixed(4)));
    assert.strictEqual(summary.comparison.benefit_threshold_met, true);
    assert.strictEqual(summary.comparison.overhead_ratio, 1.2);
    assert.strictEqual(summary.comparison.overhead_acceptable, true);

    // Verify Wilson score interval calculation
    const expectedCiA = stats.wilson(15, 30, 1.96);
    const expectedCiB = stats.wilson(25, 30, 1.96);

    assert.strictEqual(summary.arm_A.wilson_ci.lo, parseFloat(expectedCiA.lo.toFixed(4)));
    assert.strictEqual(summary.arm_A.wilson_ci.hi, parseFloat(expectedCiA.hi.toFixed(4)));
    assert.strictEqual(summary.arm_B.wilson_ci.lo, parseFloat(expectedCiB.lo.toFixed(4)));
    assert.strictEqual(summary.arm_B.wilson_ci.hi, parseFloat(expectedCiB.hi.toFixed(4)));
  });

  t('loadState initializes cleanly and provides valid summary', () => {
    const state = runner.loadState();
    assert.strictEqual(state.document_type, 'PAIRED_EVALUATION_STATE_V1');
    assert.strictEqual(state.total_tasks, 30);
    assert.strictEqual(state.total_runs, 60);
    assert.strictEqual(state.runs.length, 60);
    assert.ok(state.summary && state.summary.arm_A && state.summary.arm_B);
  });
};
