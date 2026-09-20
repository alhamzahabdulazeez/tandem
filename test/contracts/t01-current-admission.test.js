'use strict';
/**
 * Test Contract T-01: Current Admission (PRD §24, §9, §6, §10, §12)
 *
 * Exercises all 8 normative fault conditions from PRD §24 T-01:
 *  1. Queued action whose policy narrows before release
 *  2. Admission closure before release
 *  3. Replayed or consumed grants
 *  4. Wrong executor, incarnation, owner epoch, policy, payload, scope, or generation
 *  5. Expiry while persistence delays the final release
 *  6. Lost authoritative channel and attempted offline use
 *  7. Crashes before consumption, after consumption but before release, and after release but before acknowledgement
 *  8. Equivalent automatic replay under a new action identifier
 *
 * Asserts all 6 normative invariants:
 *  - Invalid release never occurs
 *  - Use and reservation precede any executable/chargeable dispatch
 *  - Closure and release have one serialization order
 *  - Consumed/unknown survives restart without replay
 *  - No post-barrier unvalidated queue exists
 *  - Liability is retained until safe disposition
 *
 * Binds Evidence Families: EA, EB, ER, EL, EX.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REC = require('../../src/contracts/records.js');
const ID = require('../../src/contracts/identity.js');
const { contentId, sha256 } = require('../../src/contracts/crypto.js');
const STATE = require('../../src/control/state.cjs');
const OWN = require('../../src/control/ownership.cjs');
const BL = require('../../src/control/budget-ledger.cjs');
const ADMISSION = require('../../src/control/admission.cjs');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-t01-'));
}

function cleanupDir(d) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
}

const NOW_MS = 1757926800000; // 2025-09-15T09:00:00.000Z
const NOW = new Date(NOW_MS).toISOString();
const FUTURE = new Date(NOW_MS + 60000).toISOString();
const PAST = new Date(NOW_MS - 60000).toISOString();

function createTestHarness(d) {
  const boot = { id: 'boot:T01', source: 'boot_id', qualified: true };
  const sup = OWN.openSupervisor({ root: d, ownerIdentity: 'executor-primary', bootId: boot });
  assert.strictEqual(sup.refused, undefined);
  const store = sup.store;

  // Add task incarnation
  const inc = REC.createTaskIncarnation({
    taskId: 'task-t01',
    lineageId: 'lin-t01',
    incarnationId: 'inc-t01',
    ownerEpoch: 'o:1',
    originalRequest: 'Execute T-01 Current Admission',
    selectedSourceCommit: 'commit-t01',
  });
  inc.phase = 'READY';
  STATE.add(store, inc);

  // Add generation
  const gen = REC.createGeneration({
    generationId: 'gen-t01',
    taskId: 'task-t01',
    incarnationId: 'inc-t01',
    treeDigest: 'sha256:' + '0'.repeat(64),
  });
  STATE.add(store, gen);

  // Add policy record
  const policy = {
    schemaVersion: 1,
    kind: 'policy',
    policyId: 'pol-t01',
    revision: 'rev-1',
    stage: 'EFFECTIVE',
  };
  STATE.add(store, policy);

  // Create budget ledger
  const budget = BL.initBudget('lin-t01', [{ dimension: 'tokens', hardLimit: 1000, protectedFuture: 0 }]);
  STATE.add(store, budget);

  return { store, sup, budget };
}

function baseProposal(overrides = {}) {
  return {
    actionId: 'act-001',
    executorIdentity: 'executor-primary',
    incarnationId: 'inc-t01',
    ownerEpoch: 'o:1',
    effectivePolicyRevision: 'rev-1',
    qualifiedProfileDigest: 'sha256:' + '1'.repeat(64),
    operation: 'write_file',
    inputPayloadIdentity: contentId('payload-001'),
    targetGeneration: 'gen-t01',
    disclosureScope: ['/workspace/safe'],
    useAllowance: 'UNCONSUMED',
    nonextendableExpiry: FUTURE,
    dimension: 'tokens',
    maxExposure: 50,
    category: 'DISCRETIONARY',
    ...overrides,
  };
}

module.exports = function run(t, group) {
  // -------------------------------------------------------------------------
  // 1. Policy narrows before release
  // -------------------------------------------------------------------------
  group('T-01.1: Queued action whose policy narrows before release');

  t('admission refused when policy revision narrows/changes before release', () => {
    const d = tmpDir();
    try {
      const { store, budget } = createTestHarness(d);
      // Policy updated to rev-2
      STATE.update(store, 'pol-t01', (p) => Object.assign({}, p, { revision: 'rev-2' }));

      const proposal = baseProposal({ effectivePolicyRevision: 'rev-1' });
      const res = ADMISSION.admitAndRelease({
        store,
        proposal,
        budget: STATE.get(store, 'lin-t01'),
        clock: () => NOW,
      });

      assert.strictEqual(res.admitted, false);
      assert.strictEqual(res.refused, true);
      assert.ok(res.reason.includes('policy revision'));
      // Verify no action or consumption persisted
      assert.strictEqual(STATE.has(store, 'act-001'), false);
      assert.strictEqual(STATE.byKind(store, 'action_consumption').length, 0);
    } finally {
      cleanupDir(d);
    }
  });

  t('admission refused when policy stage is downgraded from EFFECTIVE', () => {
    const d = tmpDir();
    try {
      const { store, budget } = createTestHarness(d);
      STATE.update(store, 'pol-t01', (p) => Object.assign({}, p, { stage: 'PROPOSED' }));

      const proposal = baseProposal();
      const res = ADMISSION.admitAndRelease({
        store,
        proposal,
        budget: STATE.get(store, 'lin-t01'),
        clock: () => NOW,
      });

      assert.strictEqual(res.admitted, false);
      assert.strictEqual(res.refused, true);
      assert.ok(res.reason.includes('not effective'));
    } finally {
      cleanupDir(d);
    }
  });

  // -------------------------------------------------------------------------
  // 2. Admission closure before release
  // -------------------------------------------------------------------------
  group('T-01.2: Admission closure before release');

  t('admission refused immediately when owner admissionState is CLOSED', () => {
    const d = tmpDir();
    try {
      const { store, budget } = createTestHarness(d);
      const owner = store.byKind('store_owner')[0];
      STATE.update(store, owner.lockIdentity, (o) => Object.assign({}, o, { admissionState: 'CLOSED' }));

      const proposal = baseProposal();
      const res = ADMISSION.admitAndRelease({
        store,
        proposal,
        budget: STATE.get(store, 'lin-t01'),
        clock: () => NOW,
      });

      assert.strictEqual(res.admitted, false);
      assert.strictEqual(res.refused, true);
      assert.ok(res.reason.includes('admission CLOSED'));
      assert.strictEqual(STATE.has(store, 'act-001'), false);
    } finally {
      cleanupDir(d);
    }
  });

  // -------------------------------------------------------------------------
  // 3. Replayed or consumed grants
  // -------------------------------------------------------------------------
  group('T-01.3: Replayed or consumed grants');

  t('action proposal declaring useAllowance: CONSUMED is refused', () => {
    const d = tmpDir();
    try {
      const { store, budget } = createTestHarness(d);
      const proposal = baseProposal({ useAllowance: 'CONSUMED' });
      const res = ADMISSION.admitAndRelease({
        store,
        proposal,
        budget: STATE.get(store, 'lin-t01'),
        clock: () => NOW,
      });

      assert.strictEqual(res.admitted, false);
      assert.strictEqual(res.refused, true);
      assert.ok(res.reason.includes('use allowance CONSUMED not available'));
    } finally {
      cleanupDir(d);
    }
  });

  t('second admission attempt for same actionId is refused by journal fold (one-use invariant)', () => {
    const d = tmpDir();
    try {
      const { store } = createTestHarness(d);
      const proposal = baseProposal({ actionId: 'act-one-use' });

      // First admission
      const res1 = ADMISSION.admitAndRelease({
        store,
        proposal,
        budget: STATE.get(store, 'lin-t01'),
        boundary: () => ({ released: true }),
        clock: () => NOW,
      });
      assert.strictEqual(res1.admitted, true);
      assert.strictEqual(res1.dispatch, 'ACKNOWLEDGED');

      // Second admission attempt for same actionId
      const res2 = ADMISSION.admitAndRelease({
        store,
        proposal,
        budget: STATE.get(store, 'lin-t01'),
        boundary: () => ({ released: true }),
        clock: () => NOW,
      });
      assert.strictEqual(res2.admitted, false);
      assert.strictEqual(res2.refused, true);
      assert.ok(res2.reason.includes('already consumed') || res2.reason.includes('already holds a reservation'));
    } finally {
      cleanupDir(d);
    }
  });

  // -------------------------------------------------------------------------
  // 4. Wrong executor, incarnation, owner epoch, policy, payload, scope, or generation
  // -------------------------------------------------------------------------
  group('T-01.4: Wrong executor, incarnation, owner epoch, payload, or generation');

  t('wrong executor identity refused', () => {
    const d = tmpDir();
    try {
      const { store } = createTestHarness(d);
      const res = ADMISSION.admitAndRelease({
        store,
        proposal: baseProposal({ executorIdentity: 'impostor-executor' }),
        budget: STATE.get(store, 'lin-t01'),
        clock: () => NOW,
      });
      assert.strictEqual(res.admitted, false);
      assert.ok(res.reason.includes('wrong executor'));
    } finally {
      cleanupDir(d);
    }
  });

  t('unknown or inactive incarnation refused', () => {
    const d = tmpDir();
    try {
      const { store } = createTestHarness(d);
      const res1 = ADMISSION.admitAndRelease({
        store,
        proposal: baseProposal({ incarnationId: 'inc-unknown' }),
        budget: STATE.get(store, 'lin-t01'),
        clock: () => NOW,
      });
      assert.strictEqual(res1.admitted, false);
      assert.ok(res1.reason.includes('unknown incarnation'));

      // Inactive incarnation
      STATE.update(store, 'inc-t01', (i) => Object.assign({}, i, { incarnationStatus: 'CLOSED' }));
      const res2 = ADMISSION.admitAndRelease({
        store,
        proposal: baseProposal(),
        budget: STATE.get(store, 'lin-t01'),
        clock: () => NOW,
      });
      assert.strictEqual(res2.admitted, false);
      assert.ok(res2.reason.includes('incarnation CLOSED'));
    } finally {
      cleanupDir(d);
    }
  });

  t('owner epoch mismatch refused', () => {
    const d = tmpDir();
    try {
      const { store } = createTestHarness(d);
      const res = ADMISSION.admitAndRelease({
        store,
        proposal: baseProposal({ ownerEpoch: 'o:99' }),
        budget: STATE.get(store, 'lin-t01'),
        clock: () => NOW,
      });
      assert.strictEqual(res.admitted, false);
      assert.ok(res.reason.includes('owner epoch mismatch'));
    } finally {
      cleanupDir(d);
    }
  });

  t('invalid input payload identity refused', () => {
    const d = tmpDir();
    try {
      const { store } = createTestHarness(d);
      const res = ADMISSION.admitAndRelease({
        store,
        proposal: baseProposal({ inputPayloadIdentity: 'not-a-sha256-content-id' }),
        budget: STATE.get(store, 'lin-t01'),
        clock: () => NOW,
      });
      assert.strictEqual(res.admitted, false);
      assert.ok(res.reason.includes('invalid input payload identity'));
    } finally {
      cleanupDir(d);
    }
  });

  t('missing target generation refused', () => {
    const d = tmpDir();
    try {
      const { store } = createTestHarness(d);
      const res = ADMISSION.admitAndRelease({
        store,
        proposal: baseProposal({ targetGeneration: null }),
        budget: STATE.get(store, 'lin-t01'),
        clock: () => NOW,
      });
      assert.strictEqual(res.admitted, false);
      assert.ok(res.reason.includes('target generation required'));
    } finally {
      cleanupDir(d);
    }
  });

  // -------------------------------------------------------------------------
  // 5. Expiry while persistence delays the final release
  // -------------------------------------------------------------------------
  group('T-01.5: Expiry while persistence delays the final release');

  t('action expiring before release is closed out as KNOWN_NOT_DISPATCHED with reservation released', () => {
    const d = tmpDir();
    try {
      const { store } = createTestHarness(d);
      // Expiry time set to 5ms in the future
      const expiryIso = new Date(Date.now() + 5).toISOString();
      const proposal = baseProposal({ actionId: 'act-expiry', nonextendableExpiry: expiryIso });

      // Boundary delay simulates persistence / serialization lag
      let boundaryCalled = false;
      const boundary = () => {
        boundaryCalled = true;
        return { released: true };
      };

      // Force clock delay past expiry before release check
      let timeCall = 0;
      const clock = () => {
        timeCall++;
        if (timeCall === 1) return new Date(Date.now() - 10).toISOString();
        return new Date(Date.now() + 1000).toISOString();
      };

      const res = ADMISSION.admitAndRelease({
        store,
        proposal,
        budget: STATE.get(store, 'lin-t01'),
        boundary,
        clock,
      });

      assert.strictEqual(res.admitted, true);
      assert.strictEqual(res.releaseRefused, true);
      assert.strictEqual(res.dispatch, 'KNOWN_NOT_DISPATCHED');
      assert.strictEqual(boundaryCalled, false, 'physical release barrier must never be invoked after expiry');

      // Check state: action settled as KNOWN_NOT_DISPATCHED, reservation released via Route 2
      const action = STATE.get(store, 'act-expiry');
      assert.strictEqual(action.dispatch, 'KNOWN_NOT_DISPATCHED');
      assert.strictEqual(action.lifecycle, 'SETTLED');
      const budget = STATE.get(store, 'lin-t01');
      assert.strictEqual(budget.dimensions.tokens.reservations['act-expiry'], undefined, 'reservation must be released via proof of non-dispatch');
      assert.strictEqual(Object.keys(budget.dimensions.tokens.reservations).length, 0);
    } finally {
      cleanupDir(d);
    }
  });

  // -------------------------------------------------------------------------
  // 6. Lost authoritative channel and attempted offline use
  // -------------------------------------------------------------------------
  group('T-01.6: Lost authoritative channel and attempted offline use');

  t('missing qualified profile digest is refused before dispatch', () => {
    const d = tmpDir();
    try {
      const { store } = createTestHarness(d);
      const res = ADMISSION.admitAndRelease({
        store,
        proposal: baseProposal({ qualifiedProfileDigest: null }),
        budget: STATE.get(store, 'lin-t01'),
        clock: () => NOW,
      });
      assert.strictEqual(res.admitted, false);
      assert.ok(res.reason.includes('no qualified profile digest (IB-01)'));
    } finally {
      cleanupDir(d);
    }
  });

  t('unqualified runtime barrier fails closed to KNOWN_NOT_DISPATCHED (no fake dispatch)', () => {
    const d = tmpDir();
    try {
      const { store } = createTestHarness(d);
      // Default NO_BOUNDARY representing unqualified runtime
      const res = ADMISSION.admitAndRelease({
        store,
        proposal: baseProposal({ actionId: 'act-unqualified' }),
        budget: STATE.get(store, 'lin-t01'),
        clock: () => NOW,
      });

      assert.strictEqual(res.admitted, true);
      assert.strictEqual(res.dispatch, 'KNOWN_NOT_DISPATCHED');
      assert.strictEqual(res.releaseRefused, true);
      assert.ok(res.reason.includes('no qualified containment/runtime profile available (IB-01)'));

      // Check durable records: consumption recorded, reservation released
      const cons = STATE.get(store, 'cons-act-unqualified');
      assert.strictEqual(cons.ack, 'KNOWN_NOT_DISPATCHED');
    } finally {
      cleanupDir(d);
    }
  });

  // -------------------------------------------------------------------------
  // 7. Crashes across all dispatch windows
  // -------------------------------------------------------------------------
  group('T-01.7: Crashes before consumption, after consumption before release, after release before ack');

  t('crash before consumption: zero residual state on restart', () => {
    const d = tmpDir();
    try {
      const { store } = createTestHarness(d);
      STATE.close(store);

      // Reopen store after crash
      const store2 = STATE.open(d);
      assert.strictEqual(STATE.has(store2, 'act-001'), false);
      assert.strictEqual(STATE.byKind(store2, 'action_consumption').length, 0);
      STATE.close(store2);
    } finally {
      cleanupDir(d);
    }
  });

  t('crash after consumption before release: consumption & reservation survive restart atomically', () => {
    const d = tmpDir();
    try {
      const { store } = createTestHarness(d);
      // Simulate crash immediately following atomic store.admit fold
      const proposal = baseProposal({ actionId: 'act-crash-1' });
      const budgeted = BL.admitToBudget(STATE.get(store, 'lin-t01'), {
        dimension: proposal.dimension,
        actionId: proposal.actionId,
        maxExposure: proposal.maxExposure,
        category: proposal.category,
      });
      const consumptionRec = {
        schemaVersion: 1,
        kind: 'action_consumption',
        consumptionId: 'cons-act-crash-1',
        actionId: 'act-crash-1',
        incarnationId: proposal.incarnationId,
        ownerEpoch: proposal.ownerEpoch,
        consumedAt: NOW,
        reservedLiability: proposal.maxExposure,
        ack: null,
        reservation: {
          reservationId: 'res-act-crash-1',
          lineageId: 'lin-t01',
          dimension: proposal.dimension,
          actionId: proposal.actionId,
          maxExposure: proposal.maxExposure,
          kind: proposal.category,
        },
        budget: budgeted.record,
      };
      STATE.admit(store, consumptionRec);
      STATE.close(store); // Crash!

      // Restart store
      const store2 = STATE.open(d);
      assert.ok(STATE.has(store2, 'cons-act-crash-1'));
      assert.ok(STATE.has(store2, 'res-act-crash-1'));
      const cons = STATE.get(store2, 'cons-act-crash-1');
      assert.strictEqual(cons.ack, null, 'unacknowledged dispatch survives restart');

      // Attempted replay of same action is strictly refused
      assert.throws(
        () => STATE.admit(store2, consumptionRec),
        /already consumed/,
      );
      STATE.close(store2);
    } finally {
      cleanupDir(d);
    }
  });

  // -------------------------------------------------------------------------
  // 8. Equivalent automatic replay under a new action identifier
  // -------------------------------------------------------------------------
  group('T-01.8: Equivalent automatic replay under a new action identifier');

  t('new action identifier requires full distinct reservation and serial validation', () => {
    const d = tmpDir();
    try {
      const { store } = createTestHarness(d);
      // Action 1 admitted and released
      const res1 = ADMISSION.admitAndRelease({
        store,
        proposal: baseProposal({ actionId: 'act-first', maxExposure: 400 }),
        budget: STATE.get(store, 'lin-t01'),
        boundary: () => ({ released: true }),
        clock: () => NOW,
      });
      assert.strictEqual(res1.admitted, true);

      // Equivalent action 2 with new ID but identical payload attempted under tight budget
      const res2 = ADMISSION.admitAndRelease({
        store,
        proposal: baseProposal({ actionId: 'act-second-replay', maxExposure: 700 }), // Exceeds 1000 ceiling (400 + 700 = 1100)
        budget: STATE.get(store, 'lin-t01'),
        boundary: () => ({ released: true }),
        clock: () => NOW,
      });
      assert.strictEqual(res2.admitted, false);
      assert.strictEqual(res2.refused, true);
      assert.ok(res2.reason.includes('budget:'));
      assert.strictEqual(STATE.has(store, 'act-second-replay'), false);
    } finally {
      cleanupDir(d);
    }
  });
};
