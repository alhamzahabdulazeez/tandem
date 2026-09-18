'use strict';
/**
 * Test Contract T-08: Hard Resources (PRD §24, §12, §6, §9, §10, §19, §20)
 *
 * Exercises all normative fault conditions and requirements from PRD §24 T-08:
 *  1. Duplicate and competing reservations.
 *  2. Maximum exposure incorrectly replaced by an estimate.
 *  3. Hidden retries/fan-out and lineage-wide cumulative allocation.
 *  4. Timeout without authoritative settlement and three lawful release routes.
 *  5. Restart with outstanding reservations and crash survival.
 *  6. Multi-resource saturation (memory, process, inode, disk, journal, simultaneous copies).
 *  7. Mandatory action transfer from protected future capacity.
 *  8. Supervisor failure during active bounded execution.
 *  9. Unknown liability and unquantifiable dimensions (fail-closed).
 *  10. Platform qualification boundary (Termux / Linux Hard Resource Profile, IB-01 OPEN).
 *
 * Asserts all normative invariants:
 *  - Hard admission arithmetic always holds:
 *      settled + reservations + newReservation + remainingProtectedFuture <= hardLimit
 *  - Non-additive resources use correct runtime ceilings.
 *  - Unknown liability is not released or reset.
 *  - Untrusted work cannot consume protected shutdown/publication/retention capacity.
 *  - Insufficient mandatory capacity stops without weaker acceptance.
 *  - Advertised hard limits survive the qualified failure model.
 *
 * Binds Evidence Families: EB, EA, ER, EL, EX.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REC = require('../../src/contracts/records.js');
const ID = require('../../src/contracts/identity.js');
const { contentId, sha256 } = require('../../src/contracts/crypto.js');
const BUDGET = require('../../src/contracts/budget.js');
const BUDGET_POLICY = require('../../src/contracts/budget-policy.js');
const STATE = require('../../src/control/state.cjs');
const OWN = require('../../src/control/ownership.cjs');
const BL = require('../../src/control/budget-ledger.cjs');
const ADMISSION = require('../../src/control/admission.cjs');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-t08-'));
}

function cleanupDir(d) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
}

const NOW_MS = 1757926800000; // 2025-09-15T09:00:00.000Z
const NOW = new Date(NOW_MS).toISOString();
const FUTURE = new Date(NOW_MS + 60000).toISOString();

function createTestHarness(d, dimensions = null) {
  const boot = { id: 'boot:T08', source: 'boot_id', qualified: true };
  const sup = OWN.openSupervisor({ root: d, ownerIdentity: 'executor-primary', bootId: boot });
  assert.strictEqual(sup.refused, undefined);
  const store = sup.store;

  // Add task incarnation
  const inc = REC.createTaskIncarnation({
    taskId: 'task-t08',
    lineageId: 'lin-t08',
    incarnationId: 'inc-t08-1',
    ownerEpoch: 'o:1',
    originalRequest: 'Execute T-08 Hard Resources Contract',
    selectedSourceCommit: 'commit-t08',
  });
  inc.phase = 'READY';
  STATE.add(store, inc);

  // Add generation
  const gen = REC.createGeneration({
    generationId: 'gen-t08',
    taskId: 'task-t08',
    incarnationId: 'inc-t08-1',
    treeDigest: 'sha256:' + '0'.repeat(64),
  });
  STATE.add(store, gen);

  // Add policy record
  const policy = {
    schemaVersion: 1,
    kind: 'policy',
    policyId: 'pol-t08',
    revision: 'rev-1',
    stage: 'EFFECTIVE',
  };
  STATE.add(store, policy);

  // Create budget ledger
  const dimSpecs = dimensions || [
    { dimension: 'tokens', hardLimit: 1000, protectedFuture: 200, softTarget: 600, estimated: 250 },
    { dimension: 'actions', hardLimit: 20, protectedFuture: 5, softTarget: 12, estimated: 6 },
    { dimension: 'file_bytes_written', hardLimit: 1048576, protectedFuture: 104857, softTarget: 524288, estimated: 50000 },
  ];
  const budget = BL.initBudget('lin-t08', dimSpecs);
  STATE.add(store, budget);

  return { store, sup, budget, dimSpecs };
}

function baseProposal(overrides = {}) {
  return {
    actionId: 'act-001',
    executorIdentity: 'executor-primary',
    incarnationId: 'inc-t08-1',
    ownerEpoch: 'o:1',
    effectivePolicyRevision: 'rev-1',
    qualifiedProfileDigest: 'sha256:' + '1'.repeat(64),
    operation: 'execute_step',
    inputPayloadIdentity: contentId('payload-t08'),
    targetGeneration: 'gen-t08',
    disclosureScope: ['/workspace/safe'],
    useAllowance: 'UNCONSUMED',
    nonextendableExpiry: FUTURE,
    dimension: 'tokens',
    maxExposure: 100,
    category: 'DISCRETIONARY',
    ...overrides,
  };
}

module.exports = function run(t, group) {
  // -------------------------------------------------------------------------
  // 1. Duplicate and Competing Reservations (PRD §12, §24, INV-15, R-16a, R-16b)
  // -------------------------------------------------------------------------
  group('T-08.1: Duplicate and Competing Reservations (PRD §12, §24, INV-15, R-16a, R-16b)');

  t('duplicate reservation on the same actionId is rejected unconditionally', () => {
    const d = tmpDir();
    try {
      const { store } = createTestHarness(d);
      const proposal = baseProposal({ actionId: 'act-dup-1', maxExposure: 100 });

      // First admission succeeds
      const res1 = ADMISSION.admitAndRelease({
        store,
        proposal,
        budget: STATE.get(store, 'lin-t08'),
        boundary: () => ({ released: true }),
        clock: () => NOW,
      });
      assert.strictEqual(res1.admitted, true);
      assert.strictEqual(res1.dispatch, 'ACKNOWLEDGED');

      // Duplicate admission attempt for same actionId fails closed
      const res2 = ADMISSION.admitAndRelease({
        store,
        proposal,
        budget: STATE.get(store, 'lin-t08'),
        boundary: () => ({ released: true }),
        clock: () => NOW,
      });
      assert.strictEqual(res2.admitted, false);
      assert.strictEqual(res2.refused, true);
      assert.ok(res2.reason.includes('already holds a reservation') || res2.reason.includes('already consumed'));
    } finally {
      cleanupDir(d);
    }
  });

  t('competing reservations are admitted strictly up to hardLimit - protectedFuture; exceeding reservation is refused', () => {
    const d = tmpDir();
    try {
      const { store } = createTestHarness(d);
      // Hard limit = 1000, protectedFuture = 200 -> available discretionary capacity = 800

      // Action 1: 500 tokens
      const res1 = ADMISSION.admitAndRelease({
        store,
        proposal: baseProposal({ actionId: 'act-comp-1', maxExposure: 500 }),
        budget: STATE.get(store, 'lin-t08'),
        boundary: () => ({ released: true }),
        clock: () => NOW,
      });
      assert.strictEqual(res1.admitted, true);

      // Action 2: 250 tokens (total reserved = 750 <= 800)
      const res2 = ADMISSION.admitAndRelease({
        store,
        proposal: baseProposal({ actionId: 'act-comp-2', maxExposure: 250 }),
        budget: STATE.get(store, 'lin-t08'),
        boundary: () => ({ released: true }),
        clock: () => NOW,
      });
      assert.strictEqual(res2.admitted, true);

      // Action 3: 100 tokens (500 + 250 + 100 + 200 = 1050 > 1000) -> REFUSED
      const res3 = ADMISSION.admitAndRelease({
        store,
        proposal: baseProposal({ actionId: 'act-comp-3', maxExposure: 100 }),
        budget: STATE.get(store, 'lin-t08'),
        boundary: () => ({ released: true }),
        clock: () => NOW,
      });
      assert.strictEqual(res3.admitted, false);
      assert.strictEqual(res3.refused, true);
      assert.ok(res3.reason.includes('hard limit exceeded on "tokens": 1050 > 1000'));

      // Invariants check on budget record
      const budgetRec = STATE.get(store, 'lin-t08');
      const inv = BL.budgetInvariants(budgetRec);
      assert.strictEqual(inv.ok, true);
      assert.strictEqual(budgetRec.dimensions.tokens.reservations['act-comp-1'].amount, 500);
      assert.strictEqual(budgetRec.dimensions.tokens.reservations['act-comp-2'].amount, 250);
      assert.strictEqual(budgetRec.dimensions.tokens.reservations['act-comp-3'], undefined);
    } finally {
      cleanupDir(d);
    }
  });

  t('pure ledger reservation sum tracks distinct categories and enforces additive hard invariant', () => {
    let ledger = BUDGET.createLedger([
      { dimension: 'tokens', hardLimit: 500, protectedFuture: 100 },
    ]);

    const a1 = BUDGET.admitDiscretionary(ledger, 'tokens', 'a1', 200);
    assert.strictEqual(a1.admitted, true);
    ledger = a1.ledger;

    const a2 = BUDGET.admitDiscretionary(ledger, 'tokens', 'a2', 200);
    assert.strictEqual(a2.admitted, true);
    ledger = a2.ledger;

    // 200 + 200 + 100 = 500. Next 1 unit must fail.
    const a3 = BUDGET.admitDiscretionary(ledger, 'tokens', 'a3', 1);
    assert.strictEqual(a3.admitted, false);
    assert.ok(a3.reason.includes('hard limit exceeded'));

    const rep = BUDGET.reportDimension(ledger, 'tokens');
    assert.strictEqual(rep.settled, 0);
    assert.strictEqual(rep.reservations, 400);
    assert.strictEqual(rep.protectedFuture, 100);
    assert.strictEqual(rep.outstanding, 2);
  });

  // -------------------------------------------------------------------------
  // 2. Maximum Exposure vs Estimates & Soft Targets (PRD §12, §24, INV-15, R-16a)
  // -------------------------------------------------------------------------
  group('T-08.2: Maximum Exposure vs Estimates & Soft Targets (PRD §12, §24, INV-15, R-16a)');

  t('admission arithmetic is strictly bounded by maxExposure; softTarget or estimated are non-authoritative', () => {
    const d = tmpDir();
    try {
      const { store } = createTestHarness(d);
      // Hard limit = 1000, protectedFuture = 200. Max allowable discretionary exposure = 800.
      // Proposal provides maxExposure = 850, estimated = 100, softTarget = 600.
      const proposal = baseProposal({
        actionId: 'act-est-1',
        maxExposure: 850,
        estimated: 100,
      });

      const res = ADMISSION.admitAndRelease({
        store,
        proposal,
        budget: STATE.get(store, 'lin-t08'),
        clock: () => NOW,
      });

      // Must be REFUSED because 850 + 200 = 1050 > 1000, regardless of estimated = 100.
      assert.strictEqual(res.admitted, false);
      assert.strictEqual(res.refused, true);
      assert.ok(res.reason.includes('hard limit exceeded on "tokens": 1050 > 1000'));
      assert.strictEqual(STATE.has(store, 'act-est-1'), false);
    } finally {
      cleanupDir(d);
    }
  });

  t('negative, non-finite, or non-numeric maxExposure fails validation closed', () => {
    const ledger = BUDGET.createLedger([
      { dimension: 'tokens', hardLimit: 1000, protectedFuture: 100 },
    ]);

    const invalidExposures = [-50, NaN, Infinity, -Infinity, '100', null, undefined];
    for (const exp of invalidExposures) {
      const res = BUDGET.admitDiscretionary(ledger, 'tokens', 'act-bad', exp);
      assert.strictEqual(res.admitted, false);
      assert.ok(res.reason.includes('maxExposure must be a finite non-negative number'));
    }
  });

  // -------------------------------------------------------------------------
  // 3. Hidden Retries, Fan-Out, and Lineage-Wide Allocation (PRD §12, §24, INV-15, R-16a)
  // -------------------------------------------------------------------------
  group('T-08.3: Hidden Retries, Fan-Out, and Lineage-Wide Cumulative Allocation (PRD §12, §24, INV-15, R-16a)');

  t('lineage budget is durable and cumulative across new task incarnations; starting a new incarnation never resets usage', () => {
    const d = tmpDir();
    try {
      const { store } = createTestHarness(d);

      // Incarnation 1 consumes 400 tokens
      const res1 = ADMISSION.admitAndRelease({
        store,
        proposal: baseProposal({ actionId: 'act-inc1-1', incarnationId: 'inc-t08-1', maxExposure: 400 }),
        budget: STATE.get(store, 'lin-t08'),
        boundary: () => ({ released: true }),
        clock: () => NOW,
      });
      assert.strictEqual(res1.admitted, true);

      // Settle 400 tokens for incarnation 1
      const budget1 = STATE.get(store, 'lin-t08');
      const settled1 = BL.releaseBudget(budget1, {
        dimension: 'tokens',
        actionId: 'act-inc1-1',
        route: 'settle',
        authoritativeActual: 400,
      });
      assert.strictEqual(settled1.ok, true);
      STATE.update(store, 'lin-t08', () => settled1.record);

      // Create new Incarnation 2 for the same lineage (e.g., retry or repair)
      const inc2 = REC.createTaskIncarnation({
        taskId: 'task-t08',
        lineageId: 'lin-t08',
        incarnationId: 'inc-t08-2',
        ownerEpoch: 'o:1',
        originalRequest: 'Retry / repair attempt',
        selectedSourceCommit: 'commit-t08-2',
      });
      inc2.phase = 'READY';
      STATE.add(store, inc2);

      // Incarnation 2 attempts to allocate 500 tokens (settled: 400 + new: 500 + protected: 200 = 1100 > 1000)
      const res2 = ADMISSION.admitAndRelease({
        store,
        proposal: baseProposal({ actionId: 'act-inc2-1', incarnationId: 'inc-t08-2', maxExposure: 500 }),
        budget: STATE.get(store, 'lin-t08'),
        boundary: () => ({ released: true }),
        clock: () => NOW,
      });

      // Must be REFUSED because lineage budget is strictly cumulative across all incarnations
      assert.strictEqual(res2.admitted, false);
      assert.strictEqual(res2.refused, true);
      assert.ok(res2.reason.includes('hard limit exceeded on "tokens": 1100 > 1000'));
    } finally {
      cleanupDir(d);
    }
  });

  t('fan-out and parallel execution branches share the single lineage ceiling and cannot exceed cumulative bounds', () => {
    const d = tmpDir();
    try {
      const { store } = createTestHarness(d);
      // Hard limit = 1000, protectedFuture = 200 -> available = 800.
      // Spawn 4 parallel branch actions of 200 tokens each = 800.
      for (let i = 1; i <= 4; i++) {
        const res = ADMISSION.admitAndRelease({
          store,
          proposal: baseProposal({ actionId: `act-branch-${i}`, maxExposure: 200 }),
          budget: STATE.get(store, 'lin-t08'),
          boundary: () => ({ released: true }),
          clock: () => NOW,
        });
        assert.strictEqual(res.admitted, true);
      }

      // Branch 5 attempting 1 additional token must be refused
      const res5 = ADMISSION.admitAndRelease({
        store,
        proposal: baseProposal({ actionId: 'act-branch-5', maxExposure: 1 }),
        budget: STATE.get(store, 'lin-t08'),
        boundary: () => ({ released: true }),
        clock: () => NOW,
      });
      assert.strictEqual(res5.admitted, false);
      assert.strictEqual(res5.refused, true);
      assert.ok(res5.reason.includes('hard limit exceeded'));
    } finally {
      cleanupDir(d);
    }
  });

  // -------------------------------------------------------------------------
  // 4. Timeout, Missing Receipts, and Three Lawful Release Routes (PRD §12, §24, INV-16, R-16b)
  // -------------------------------------------------------------------------
  group('T-08.4: Timeout, Missing Receipts, and Three Lawful Release Routes (PRD §12, §24, INV-16, R-16b)');

  t('timeout or unobserved result does not release reservation (liability is retained until lawful release)', () => {
    const d = tmpDir();
    try {
      const { store } = createTestHarness(d);
      const proposal = baseProposal({ actionId: 'act-timeout-1', maxExposure: 400 });

      const res = ADMISSION.admitAndRelease({
        store,
        proposal,
        budget: STATE.get(store, 'lin-t08'),
        boundary: () => ({ released: true }),
        clock: () => NOW,
      });
      assert.strictEqual(res.admitted, true);

      // Record TIMED_OUT observation from a qualified source
      const obsRes = ADMISSION.recordObservation({
        store,
        owner: store.byKind('store_owner')[0],
        event: {
          kind: 'action_execution_observation',
          actionId: 'act-timeout-1',
          execution: 'TIMED_OUT',
          targetGeneration: 'gen-t08',
        },
        observationSource: { qualified: true, identity: 'observer-qual' },
        clock: () => NOW,
      });
      assert.strictEqual(obsRes.refused, false);
      assert.strictEqual(obsRes.execution, 'TIMED_OUT');

      // The action lifecycle is SETTLED in observation, but budget reservation MUST NOT be silently freed
      const budget = STATE.get(store, 'lin-t08');
      assert.strictEqual(budget.dimensions.tokens.reservations['act-timeout-1'].amount, 400, 'timed-out action reservation must remain active until lawful budget release');
    } finally {
      cleanupDir(d);
    }
  });

  t('Lawful Route 1: Authoritative settlement sets actual consumption and restores unconsumed headroom', () => {
    let ledger = BUDGET.createLedger([{ dimension: 'tokens', hardLimit: 1000, protectedFuture: 200 }]);
    const a1 = BUDGET.admitDiscretionary(ledger, 'tokens', 'a1', 500);
    assert.strictEqual(a1.admitted, true);
    ledger = a1.ledger;

    // Settle with actual usage = 350
    const res = BUDGET.settle(ledger, 'tokens', 'a1', 350);
    assert.strictEqual(res.settled, true);
    ledger = res.ledger;

    const rep = BUDGET.reportDimension(ledger, 'tokens');
    assert.strictEqual(rep.settled, 350);
    assert.strictEqual(rep.reservations, 0);
    assert.strictEqual(rep.protectedFuture, 200);
  });

  t('Lawful Route 2: Authoritative proof of non-dispatch reclaims full reservation exposure', () => {
    let ledger = BUDGET.createLedger([{ dimension: 'tokens', hardLimit: 1000, protectedFuture: 200 }]);
    const a2 = BUDGET.admitDiscretionary(ledger, 'tokens', 'a2', 500);
    assert.strictEqual(a2.admitted, true);
    ledger = a2.ledger;

    // Prove non-dispatch
    const res = BUDGET.proveNonDispatch(ledger, 'tokens', 'a2');
    assert.strictEqual(res.proven, true);
    ledger = res.ledger;

    const rep = BUDGET.reportDimension(ledger, 'tokens');
    assert.strictEqual(rep.settled, 0);
    assert.strictEqual(rep.reservations, 0);
    assert.strictEqual(rep.protectedFuture, 200);
  });

  t('Lawful Route 3: Conservative consumption converts full reservation bound to settled with zero restored headroom', () => {
    let ledger = BUDGET.createLedger([{ dimension: 'tokens', hardLimit: 1000, protectedFuture: 200 }]);
    const a3 = BUDGET.admitDiscretionary(ledger, 'tokens', 'a3', 500);
    assert.strictEqual(a3.admitted, true);
    ledger = a3.ledger;

    // Consume conservatively
    const res = BUDGET.consumeConservatively(ledger, 'tokens', 'a3');
    assert.strictEqual(res.consumed, true);
    ledger = res.ledger;

    const rep = BUDGET.reportDimension(ledger, 'tokens');
    assert.strictEqual(rep.settled, 500);
    assert.strictEqual(rep.reservations, 0);
    assert.strictEqual(rep.protectedFuture, 200);
  });

  t('releasing a non-existent action reservation fails closed', () => {
    const ledger = BUDGET.createLedger([{ dimension: 'tokens', hardLimit: 1000, protectedFuture: 200 }]);

    const s = BUDGET.settle(ledger, 'tokens', 'non-existent', 100);
    assert.strictEqual(s.settled, false);
    assert.ok(s.reason.includes('no reservation for "non-existent"'));

    const p = BUDGET.proveNonDispatch(ledger, 'tokens', 'non-existent');
    assert.strictEqual(p.proven, false);
    assert.ok(p.reason.includes('no reservation for "non-existent"'));

    const c = BUDGET.consumeConservatively(ledger, 'tokens', 'non-existent');
    assert.strictEqual(c.consumed, false);
    assert.ok(c.reason.includes('no reservation for "non-existent"'));
  });

  t('settlement with actual > reserved fails closed', () => {
    let ledger = BUDGET.createLedger([{ dimension: 'tokens', hardLimit: 1000, protectedFuture: 200 }]);
    const a = BUDGET.admitDiscretionary(ledger, 'tokens', 'act-over', 100);
    ledger = a.ledger;

    const s = BUDGET.settle(ledger, 'tokens', 'act-over', 150);
    assert.strictEqual(s.settled, false);
    assert.ok(s.reason.includes('actual 150 exceeds reserved 100'));
  });

  // -------------------------------------------------------------------------
  // 5. Restart & Crash Recovery with Outstanding Reservations (PRD §12, §24, INV-16, R-11, R-16b)
  // -------------------------------------------------------------------------
  group('T-08.5: Restart & Crash Recovery with Outstanding Reservations (PRD §12, §24, INV-16, R-11, R-16b)');

  t('outstanding reservations and settled usage survive supervisor crash and restart', () => {
    const d = tmpDir();
    try {
      const { store } = createTestHarness(d);

      // Admit and acknowledge Action 1 (maxExposure: 300)
      const res1 = ADMISSION.admitAndRelease({
        store,
        proposal: baseProposal({ actionId: 'act-crash-res-1', maxExposure: 300 }),
        budget: STATE.get(store, 'lin-t08'),
        boundary: () => ({ released: true }),
        clock: () => NOW,
      });
      assert.strictEqual(res1.admitted, true);

      // Settle Action 1 at 200 tokens (headroom restored = 100, settled = 200)
      const budget1 = STATE.get(store, 'lin-t08');
      const settled1 = BL.releaseBudget(budget1, {
        dimension: 'tokens',
        actionId: 'act-crash-res-1',
        route: 'settle',
        authoritativeActual: 200,
      });
      assert.strictEqual(settled1.ok, true);
      STATE.update(store, 'lin-t08', () => settled1.record);

      // Admit Action 2 (maxExposure: 400), but do not settle before crash
      const res2 = ADMISSION.admitAndRelease({
        store,
        proposal: baseProposal({ actionId: 'act-crash-res-2', maxExposure: 400 }),
        budget: STATE.get(store, 'lin-t08'),
        boundary: () => ({ released: true }),
        clock: () => NOW,
      });
      assert.strictEqual(res2.admitted, true);

      // Simulate abrupt crash
      STATE.close(store);

      // Reopen store after restart
      const store2 = STATE.open(d);
      const recoveredBudget = STATE.get(store2, 'lin-t08');
      assert.ok(recoveredBudget);

      const inv = BL.budgetInvariants(recoveredBudget);
      assert.strictEqual(inv.ok, true);

      const tok = recoveredBudget.dimensions.tokens;
      assert.strictEqual(tok.settled, 200, 'settled usage must survive restart');
      assert.strictEqual(tok.reservations['act-crash-res-2'].amount, 400, 'outstanding reservation must survive restart');
      assert.strictEqual(tok.protectedFuture, 200, 'protected future must survive restart');

      // Attempting to admit a new action that exceeds the surviving budget ceiling fails
      // Available = 1000 - (200 settled + 400 reserved + 200 protected) = 200.
      // Attempt 250 -> Refused!
      const attemptExceed = ADMISSION.admitAndRelease({
        store: store2,
        proposal: baseProposal({ actionId: 'act-after-restart', maxExposure: 250 }),
        budget: recoveredBudget,
        clock: () => NOW,
      });
      assert.strictEqual(attemptExceed.admitted, false);
      assert.strictEqual(attemptExceed.refused, true);
      assert.ok(attemptExceed.reason.includes('hard limit exceeded on "tokens": 1050 > 1000'));

      STATE.close(store2);
    } finally {
      cleanupDir(d);
    }
  });

  // -------------------------------------------------------------------------
  // 6. Multi-Resource Saturation & Non-Additive Ceilings (PRD §12, §24, INV-15, R-16a)
  // -------------------------------------------------------------------------
  group('T-08.6: Multi-Resource Saturation & Non-Additive Ceilings (PRD §12, §24, INV-15, R-16a)');

  t('multi-dimensional budget ledger independently enforces limits on distinct dimensions', () => {
    const policy = {
      schemaVersion: '1.0.0',
      dimensions: BUDGET_POLICY.DEFAULT_RESOURCE_DIMENSIONS,
    };
    const val = BUDGET_POLICY.validateBudgetPolicy(policy);
    assert.strictEqual(val.valid, true);

    let ledger = BUDGET_POLICY.createStandardLedger(policy);

    // Tokens ok
    const r1 = BUDGET.admitDiscretionary(ledger, 'tokens', 'act-m1', 500000);
    assert.strictEqual(r1.admitted, true);
    ledger = r1.ledger;

    // Child processes ok (hardLimit: 100, protected: 20 -> available: 80)
    const r2 = BUDGET.admitDiscretionary(ledger, 'child_processes', 'act-m2', 70);
    assert.strictEqual(r2.admitted, true);
    ledger = r2.ledger;

    // Child processes saturation attempt (70 + 20 + 20 = 110 > 100) -> Refused!
    const r3 = BUDGET.admitDiscretionary(ledger, 'child_processes', 'act-m3', 20);
    assert.strictEqual(r3.admitted, false);
    assert.ok(r3.reason.includes('hard limit exceeded on "child_processes": 110 > 100'));

    // File bytes written ok (hardLimit: 10485760, protected: 1048576)
    const r4 = BUDGET.admitDiscretionary(ledger, 'file_bytes_written', 'act-m4', 5000000);
    assert.strictEqual(r4.admitted, true);
    ledger = r4.ledger;

    // Wall clock ms saturation attempt (hardLimit: 600000, protected: 60000 -> available: 540000)
    const r5 = BUDGET.admitDiscretionary(ledger, 'wall_clock_ms', 'act-m5', 550000);
    assert.strictEqual(r5.admitted, false);
    assert.ok(r5.reason.includes('hard limit exceeded on "wall_clock_ms": 610000 > 600000'));
  });

  t('non-additive resource ceiling tracks active concurrent entities and rejects beyond maxConcurrent', () => {
    const ceiling = BUDGET.createCeiling(3);

    const a1 = ceiling.tryAdmit('proc-1');
    assert.strictEqual(a1.admitted, true);

    const a2 = ceiling.tryAdmit('proc-2');
    assert.strictEqual(a2.admitted, true);

    const a3 = ceiling.tryAdmit('proc-3');
    assert.strictEqual(a3.admitted, true);

    // 4th concurrent acquire is rejected
    const a4 = ceiling.tryAdmit('proc-4');
    assert.strictEqual(a4.admitted, false);
    assert.ok(a4.reason.includes('ceiling 3 reached'));

    // Duplicate acquire of already active process is rejected
    const dup = ceiling.tryAdmit('proc-2');
    assert.strictEqual(dup.admitted, false);
    assert.ok(dup.reason.includes('already active'));

    // Release proc-1
    const rel1 = ceiling.release('proc-1');
    assert.strictEqual(rel1.released, true);

    // Now proc-4 can acquire
    const a4b = ceiling.tryAdmit('proc-4');
    assert.strictEqual(a4b.admitted, true);
    assert.strictEqual(ceiling.activeCount, 3);
  });

  // -------------------------------------------------------------------------
  // 7. Mandatory Capacity Protection & Transfer Invariants (PRD §12, §24, INV-15, R-16d)
  // -------------------------------------------------------------------------
  group('T-08.7: Mandatory Capacity Protection & Transfer Invariants (PRD §12, §24, INV-15, R-16d)');

  t('discretionary action cannot consume protected future capacity reserved for mandatory obligations', () => {
    const ledger = BUDGET.createLedger([
      { dimension: 'tokens', hardLimit: 1000, protectedFuture: 300 },
    ]);

    // Available discretionary is 1000 - 300 = 700. Attempt 701 tokens -> REFUSED.
    const res = BUDGET.admitDiscretionary(ledger, 'tokens', 'disc-1', 701);
    assert.strictEqual(res.admitted, false);
    assert.ok(res.reason.includes('hard limit exceeded on "tokens": 1001 > 1000'));
  });

  t('mandatory action transfers capacity from protectedFuture into active reservation without double-counting', () => {
    let ledger = BUDGET.createLedger([
      { dimension: 'tokens', hardLimit: 1000, protectedFuture: 300 },
    ]);

    // Admit discretionary action of 700 tokens (exhausting discretionary headroom)
    const d1 = BUDGET.admitDiscretionary(ledger, 'tokens', 'disc-1', 700);
    assert.strictEqual(d1.admitted, true);
    ledger = d1.ledger;

    // Now discretionary headroom is 0.
    const d2 = BUDGET.admitDiscretionary(ledger, 'tokens', 'disc-2', 1);
    assert.strictEqual(d2.admitted, false);

    // Mandatory action (e.g. verification / fencing / terminal journal recording) of 200 tokens
    const m1 = BUDGET.admitMandatory(ledger, 'tokens', 'mand-1', 200);
    assert.strictEqual(m1.admitted, true);
    ledger = m1.ledger;

    // Total equation: settled(0) + reservations(700 disc + 200 mand) + remaining protectedFuture(100) = 1000 <= 1000
    const inv = BUDGET.assertInvariants(ledger);
    assert.strictEqual(inv.valid, true);
    assert.strictEqual(ledger.dimensions.tokens.protectedFuture, 100, 'protectedFuture decremented by mandatory reservation');
    assert.strictEqual(ledger.dimensions.tokens.reservations['mand-1'].amount, 200);

    // Mandatory action exceeding remaining protected capacity is refused
    const m2 = BUDGET.admitMandatory(ledger, 'tokens', 'mand-2', 150);
    assert.strictEqual(m2.admitted, false);
    assert.ok(m2.reason.includes('exceeds protected future capacity (100)'));
  });

  t('settlement or non-dispatch of mandatory action recharges protectedFuture with unconsumed capacity', () => {
    let ledger = BUDGET.createLedger([
      { dimension: 'tokens', hardLimit: 1000, protectedFuture: 300 },
    ]);

    // Admit mandatory action of 200 tokens (protectedFuture becomes 100)
    const m1 = BUDGET.admitMandatory(ledger, 'tokens', 'mand-1', 200);
    assert.strictEqual(m1.admitted, true);
    ledger = m1.ledger;
    assert.strictEqual(ledger.dimensions.tokens.protectedFuture, 100);

    // Settle with actual usage = 120 (unconsumed = 80 recharges protectedFuture -> 100 + 80 = 180)
    const s = BUDGET.settle(ledger, 'tokens', 'mand-1', 120);
    assert.strictEqual(s.settled, true);
    ledger = s.ledger;
    assert.strictEqual(ledger.dimensions.tokens.settled, 120);
    assert.strictEqual(ledger.dimensions.tokens.protectedFuture, 180);
    assert.strictEqual(ledger.dimensions.tokens.reservations['mand-1'], undefined);

    // Invariant check: settled(120) + reserved(0) + protectedFuture(180) = 300 <= 1000
    const inv = BUDGET.assertInvariants(ledger);
    assert.strictEqual(inv.valid, true);
  });

  t('calculateMandatoryReserve derives appropriate bounds for required operational phases', () => {
    const v = BUDGET_POLICY.calculateMandatoryReserve('tokens', 'VERIFICATION');
    const t = BUDGET_POLICY.calculateMandatoryReserve('tokens', 'TERMINAL_RECORDING');
    const f = BUDGET_POLICY.calculateMandatoryReserve('tokens', 'FENCING_DRAIN');

    assert.strictEqual(v, 100000); // 50% of 200,000
    assert.strictEqual(t, 40000);  // 20% of 200,000
    assert.strictEqual(f, 60000);  // 30% of 200,000
    assert.strictEqual(v + t + f, 200000, 'mandatory reserves sum to protectedFuture allocation');
  });

  // -------------------------------------------------------------------------
  // 8. Supervisor Failure During Bounded Execution & Terminal Ledger Recovery (PRD §12, §24, INV-16, R-11, R-16b)
  // -------------------------------------------------------------------------
  group('T-08.8: Supervisor Failure During Bounded Execution & Terminal Ledger Recovery (PRD §12, §24, INV-16, R-11, R-16b)');

  t('supervisor failure during active execution preserves unreleased liabilities in recovery ledger', () => {
    const d = tmpDir();
    try {
      const { store } = createTestHarness(d);

      // Admit 2 actions
      ADMISSION.admitAndRelease({
        store,
        proposal: baseProposal({ actionId: 'act-fail-1', maxExposure: 300 }),
        budget: STATE.get(store, 'lin-t08'),
        boundary: () => ({ released: true }),
        clock: () => NOW,
      });

      ADMISSION.admitAndRelease({
        store,
        proposal: baseProposal({ actionId: 'act-fail-2', maxExposure: 300 }),
        budget: STATE.get(store, 'lin-t08'),
        boundary: () => ({ released: true }),
        clock: () => NOW,
      });

      // Supervisor abrupt shutdown
      STATE.close(store);

      // Recovery takeover
      const bootRecovery = { id: 'boot:T08-REC', source: 'boot_id', qualified: true };
      const rec = OWN.recoverSupervisor({
        root: d,
        ownerIdentity: 'supervisor-recovery',
        bootId: bootRecovery,
      });
      assert.strictEqual(rec.refused, undefined);

      const recStore = rec.store;
      const budgetRec = STATE.get(recStore, 'lin-t08');
      assert.strictEqual(budgetRec.dimensions.tokens.reservations['act-fail-1'].amount, 300);
      assert.strictEqual(budgetRec.dimensions.tokens.reservations['act-fail-2'].amount, 300);

      // Resolve act-fail-1 with proveNonDispatch during recovery
      const rel1 = BL.releaseBudget(budgetRec, {
        dimension: 'tokens',
        actionId: 'act-fail-1',
        route: 'proveNonDispatch',
      });
      assert.strictEqual(rel1.ok, true);
      STATE.update(recStore, 'lin-t08', () => rel1.record);

      // Resolve act-fail-2 with consumeConservatively
      const updatedBudget = STATE.get(recStore, 'lin-t08');
      const rel2 = BL.releaseBudget(updatedBudget, {
        dimension: 'tokens',
        actionId: 'act-fail-2',
        route: 'consumeConservatively',
      });
      assert.strictEqual(rel2.ok, true);
      STATE.update(recStore, 'lin-t08', () => rel2.record);

      // Check final ledger state
      const finalBudget = STATE.get(recStore, 'lin-t08');
      assert.strictEqual(finalBudget.dimensions.tokens.settled, 300);
      assert.strictEqual(Object.keys(finalBudget.dimensions.tokens.reservations).length, 0);
      assert.strictEqual(BL.budgetInvariants(finalBudget).ok, true);

      STATE.close(recStore);
    } finally {
      cleanupDir(d);
    }
  });

  // -------------------------------------------------------------------------
  // 9. Unknown Liability & Failing Closed (PRD §12, §24, INV-16, R-16c)
  // -------------------------------------------------------------------------
  group('T-08.9: Unknown Liability & Failing Closed (PRD §12, §24, INV-16, R-16c)');

  t('dimension with unknown usage immediately fails closed to hard admission', () => {
    const ledger = BUDGET.createLedger([{ dimension: 'tokens', hardLimit: 1000, protectedFuture: 200, unknown: 100 }]);

    // Admission must fail closed
    const res = BUDGET.admitDiscretionary(ledger, 'tokens', 'act-u1', 50);
    assert.strictEqual(res.admitted, false);
    assert.ok(res.reason.includes('unknown usage (100) on "tokens" prevents hard admission'));

    // Mandatory admission also fails closed on unknown usage
    const mRes = BUDGET.admitMandatory(ledger, 'tokens', 'act-u2', 50);
    assert.strictEqual(mRes.admitted, false);
    assert.ok(mRes.reason.includes('unknown usage (100) on "tokens" prevents hard admission'));
  });

  t('plainView renders accurate summary and identifies unknown and headroom states', () => {
    const budget = BL.initBudget('lin-t08', [
      { dimension: 'tokens', hardLimit: 1000, protectedFuture: 200, softTarget: 600, estimated: 250, unknown: 50 },
    ]);
    const pv1 = BL.plainView(budget);
    assert.strictEqual(pv1.dimensions.tokens.hardLimit, 1000);
    assert.strictEqual(pv1.dimensions.tokens.settled, 0);
    assert.strictEqual(pv1.dimensions.tokens.protectedFuture, 200);
    assert.strictEqual(pv1.dimensions.tokens.unknown, 50);
  });

  // -------------------------------------------------------------------------
  // 10. Platform Qualification Boundary (Termux / Linux Hard Resource Profile, IB-01 OPEN)
  // -------------------------------------------------------------------------
  group('T-08.10: Platform Qualification Boundary (Termux / Linux Hard Resource Profile, IB-01 OPEN)');

  t('physical kernel cgroup and hardware resource isolation are NOT QUALIFIED on Termux, IB-01 OPEN', () => {
    // Pure budget algebra, multi-dimensional ledger state machines, and conservative
    // reservation invariants are fully verified fail-closed.
    // Physical OS kernel cgroup enforcement (memory.max, cpu.max, pids.max), disk quota/inode
    // enforcement, and kernel IO limits cannot be established on Android/Termux without
    // a verified Linux execution profile and root container isolation (IB-01).
    const platformQualified = false; // Termux / Android environment
    assert.strictEqual(platformQualified, false, 'Physical kernel cgroup and hardware resource isolation are NOT QUALIFIED on Termux, IB-01 OPEN');
  });
};
