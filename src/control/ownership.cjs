'use strict';
/**
 * ownership — exclusive supervision + §10 crash recovery orchestration over the
 * durable control store.
 *
 *  - {@link openSupervisor}  acquire same-boot exclusive lock, bind the control
 *    store to its canonical root, initialize store_owner/epochs. Refuses a
 *    second live supervisor; refuses a PREVIOUS boot's residue (that is
 *    recovery's job).
 *  - {@link recoverSupervisor} implement PRD §10 steps 1-10 with honest
 *    boundaries: fencing/drain use the qualified runtime (IB-01); where that is
 *    unavailable, recovery conservatively records unresolved execution and
 *    quarantines mutable resources instead of claiming quiescence.
 *  - {@link closeAdmission} / {@link openAdmission} shape the durable
 *    admission-state bit that the §9 gate checks.
 */

const path = require('node:path');
const fs = require('node:fs');
const LOCK = require('../store/lock.cjs');
const STATE = require('./state.cjs');
const BL = require('./budget-ledger.cjs');
const REC = require('../contracts/records.js');
const { contentId } = require('../contracts/crypto.js');

function lockIdentityFor(root) {
  const real = fs.realpathSync(root);
  return contentId('lock:' + real);
}

const DEFAULT_VERIFY_PAYLOAD = () => ({
  integrity: false,
  reason: 'no qualified payload verifier available in this runtime (IB-01)',
});

/**
 * Open a supervisor session on a canonical store root.
 * Returns { session, owner, store } or { refused, reason, stale }.
 */
function openSupervisor(opts) {
  const o = opts || {};
  const root = o.root;
  const ownerIdentity = o.ownerIdentity;
  const bootId = o.bootId;
  if (!root || !ownerIdentity) throw new Error('ownership: root and ownerIdentity are required');
  fs.mkdirSync(root, { recursive: true });

  const lock = LOCK.acquire(root, { ownerIdentity, bootId });
  if (!lock.held) return { refused: true, reason: lock.reason, stale: !!lock.stale, existing: lock.existing || null };

  let store;
  try {
    store = STATE.open(root);
  } catch (e) {
    LOCK.release(root, { ownerIdentity });
    throw e;
  }

  const owner = initOrBindOwner(store, { root, ownerIdentity, lockIdentity: lockIdentityFor(root), role: 'SUPERVISOR' });
  const session = { root, ownerIdentity, bootId, lock, store, recoverOnly: false };
  return { session, owner, store };
}

/** Initialize store_owner (first creation) or bind an existing one. */
function initOrBindOwner(store, { root, ownerIdentity, lockIdentity, role, admissionState, recoveryState }) {
  let rec = store.byKind('store_owner')[0];
  if (!rec) {
    const now = new Date().toISOString();
    const owner = Object.assign(
      {},
      REC.createStoreOwner({ canonicalStorePath: root, lockIdentity, ownerIdentity }),
      {
        currentEpoch: 1, // INITIAL is epoch 1
        recoveryState: recoveryState || 'NORMAL',
        admissionState: admissionState || 'OPEN',
      },
    );
    store.add(owner);
    store.add({
      schemaVersion: 1, kind: 'epoch_alloc',
      epochId: `${ownerIdentity}:1`, epochNumber: 1,
      role: 'INITIAL', ownerIdentity, allocatedAt: now,
    });
    return store.get(lockIdentity);
  }
  // A second store must not attach an existing candidate as newly owned work:
  if (rec.canonicalStorePath !== root || rec.lockIdentity !== lockIdentity) {
    throw new Error(`ownership: store already bound to "${rec.canonicalStorePath}" (${rec.lockIdentity}); refusing attachment`);
  }
  const next = (prev) => Object.assign({}, prev, {
    recoveryState: recoveryState || 'NORMAL',
    admissionState: admissionState || prev.admissionState || 'OPEN',
  });
  store.update(lockIdentity, next);
  return store.get(lockIdentity);
}

function allocateEpoch(store, ownerIdentity, role) {
  const owner = store.byKind('store_owner')[0];
  const n = owner.currentEpoch + 1;
  store.update(owner.lockIdentity, (prev) => Object.assign({}, prev, { currentEpoch: n }));
  const alloc = {
    schemaVersion: 1, kind: 'epoch_alloc',
    epochId: `${ownerIdentity}:${n}`, epochNumber: n,
    role, ownerIdentity, allocatedAt: new Date().toISOString(),
  };
  store.add(alloc);
  return alloc;
}

function setAdmission(store, state) {
  const owner = store.byKind('store_owner')[0];
  return store.update(owner.lockIdentity, (prev) => Object.assign({}, prev, { admissionState: state }));
}
const closeAdmission = (store) => setAdmission(store, 'CLOSED');
const openAdmission = (store) => setAdmission(store, 'OPEN');

/**
 * Select actors that may still have mutable reachable effects after a crash
 * (PRD §9/§10). The authority is the CONSUMPTION record — the allowance is
 * consumed durably BEFORE dispatch is known — so a consumption takes
 * precedence over a paired action record:
 *   - ack 'KNOWN_NOT_DISPATCHED'  -> provably never released — clean;
 *   - ack 'ACKNOWLEDGED'          -> was dispatched, effects must be fenced
 *                                    by a qualified runtime — unresolved here;
 *   - ack null / 'UNKNOWN'        -> crash between consume and ack — the
 *                                    consumed/unknown case — unresolved;
 *   - action quarantined          -> unresolved by arrangement.
 * A bare ACTION record (no consumption, e.g. a direct unit fixture) is judged
 * by its own dispatch: only 'KNOWN_NOT_DISPATCHED' is provably clean.
 * @param {Array} records — folded record list
 * @returns {Array<object>} the unresolved actor records (consumption or action)
 */
function selectUnresolved(records) {
  const actionsById = new Map();
  for (const r of records) if (r.kind === 'action') actionsById.set(r.actionId, r);

  const consumed = new Set();
  const candidates = new Map(); // actionId -> record, or null once proven clean
  for (const c of records) {
    if (c.kind !== 'action_consumption') continue;
    consumed.add(c.actionId);
    const a = actionsById.get(c.actionId);
    if (a && a.resourceDisposition === 'QUARANTINED') { candidates.set(c.actionId, c); continue; }
    if (c.ack === 'KNOWN_NOT_DISPATCHED') { candidates.set(c.actionId, null); continue; }
    candidates.set(c.actionId, c);
  }
  for (const a of records) {
    if (a.kind !== 'action') continue;
    if (consumed.has(a.actionId)) continue; // already judged through its consumption
    if (a.dispatch === 'KNOWN_NOT_DISPATCHED') { candidates.set(a.actionId, null); continue; }
    candidates.set(a.actionId, a);
  }
  const out = [];
  for (const rec of candidates.values()) if (rec) out.push(rec);
  return out;
}

/**
 * §10.6 reconcile known liabilities: a consumption acknowledged as never
 * dispatched must release its reservation (the authoritative non-dispatch
 * route, §12). Dispatched/consumed-unknown reservations are kept (liability
 * outstanding until authoritative settlement).
 */
function reconcileLiability(store) {
  const released = [];
  for (const r of store.byKind('reservation')) {
    if (r.state !== 'ACTIVE') continue;
    const consumption = store.byKind('action_consumption').find((c) => c.actionId === r.actionId);
    if (consumption && consumption.ack === 'KNOWN_NOT_DISPATCHED') {
      const budget = store.get(r.lineageId);
      if (budget) {
        const res = BL.releaseBudget(budget, { dimension: r.dimension, actionId: r.actionId, route: 'proveNonDispatch' });
        if (res.ok) { store.update(r.lineageId, () => res.record); released.push(r.actionId); }
      }
    }
  }
  return released;
}

const DEFAULT_RECOVERY = () => ({
  resolver: 'UNQUALIFIED',
  fencingEstablished: false,
  drainEstablished: false,
  reason: 'no qualified runtime profile available (IB-01)',
});

/**
 * PRD §10 recovery. Returns a report after durably closing admission,
 * allocating a recovery epoch, reconciling/quarantining unresolved resources,
 * and recording the former incarnation's truthful disposition.
 */
function recoverSupervisor(opts) {
  const o = opts || {};
  const root = o.root;
  const ownerIdentity = o.ownerIdentity;
  const bootId = o.bootId;
  const resolver = o.resolver || DEFAULT_RECOVERY();
  const verifyPayload = o.verifyPayload || DEFAULT_VERIFY_PAYLOAD;
  if (!root || !ownerIdentity) throw new Error('ownership: root and ownerIdentity are required for recovery');
  fs.mkdirSync(root, { recursive: true });

  // §10: lock acquisition grants recovery ownership ONLY; no timeout takeover.
  const existingLock = LOCK.hold(root);
  if (existingLock.held && existingLock.lock && existingLock.lock.bootId === bootId.id && existingLock.lock.ownerIdentity !== ownerIdentity) {
    return { refused: true, reason: 'owned-locked', existing: existingLock.lock };
  }
  const lock = LOCK.acquire(root, { ownerIdentity, bootId });
  if (!lock.held) {
    const reclaimed = LOCK.reclaim(root, { ownerIdentity, bootId });
    if (!reclaimed.reclaimed) return { refused: true, reason: reclaimed.reason, existing: reclaimed.existing || null };
  }

  let store;
  try {
    store = STATE.open(root);
  } catch (e) {
    LOCK.release(root, { ownerIdentity });
    throw e;
  }

  // §10.1 & .2 — admission closed, new durable recovery epoch.
  const owner = initOrBindOwner(store, { root, ownerIdentity, lockIdentity: lockIdentityFor(root), role: 'RECOVERY', admissionState: 'CLOSED', recoveryState: 'RECOVERY' });
  const epoch = allocateEpoch(store, ownerIdentity, 'RECOVERY');

  const records = store.all();
  const unresolved = selectUnresolved(records);

  // §10.6a reconcile known liabilities: consumption acknowledged as
  // non-dispatched releases its reservation via the lawful route.
  const reconciled = reconcileLiability(store);

  // §10.6 fencing/drain — honest boundary: without a qualified runtime we CANNOT
  // fence. Some scope is provably clean without a runtime: an action that was
  // never released (ack KNOWN_NOT_DISPATCHED) has no live actor.
  const releasedUnaccounted = unresolved;

  let fencingEstablished = false;
  let drainEstablished = false;
  let sourceOfProof = null;
  if (releasedUnaccounted.length === 0 && resolver.fencingEstablished === true && resolver.drainEstablished === true) {
    fencingEstablished = true;
    drainEstablished = true;
    sourceOfProof = resolver.reason;
  } else if (releasedUnaccounted.length === 0) {
    // No actor was ever released, so quiescence holds by construction — but
    // that is a property of THIS runtime's refusal boundary, not a qualified
    // fence. Record it honestly as provenance, not as runtime fencing.
    sourceOfProof = 'all consumed actions were acknowledged as never dispatched; runtime drain/fence UNQUALIFIED (IB-01)';
  } else {
    sourceOfProof = `cannot fence ${releasedUnaccounted.length} unresolved actor(s) without qualified runtime`;
  }

  // §10.7 preserve immutables: the journal is the authority; nothing is erased.

  // §10.8 quarantine unresolved mutable resources (durable ownership restriction).
  const quarantined = [];
  for (const c of unresolved) {
    const action = records.find((r) => r.kind === 'action' && r.actionId === c.actionId) || null;
    const qid = `quarantine-${c.actionId}`;
    if (store.has(qid)) continue;
    const q = {
      schemaVersion: 1, kind: 'quarantine',
      quarantineId: qid,
      resource: `action-scope:${c.actionId}`,
      resourceClass: (action && action.resourceDisposition === 'QUARANTINED') || (action && action.resourceDisposition === 'ACTIVE') ? 'CANDIDATE_DIR' : 'OTHER',
      incumbentIncarnationId: c.incarnationId,
      reason: `unresolved actor after recovery (nondispatch=${c.ack != null ? c.ack : (c.dispatch != null ? c.dispatch : 'unset')})`,
      state: 'ACTIVE',
      createdAt: new Date().toISOString(),
    };
    try { store.add(q); quarantined.push(qid); } catch { /* already quarantined */ }
  }

  // §10.9 truthful former-incarnation disposition: non-successful UNLESS a
  // complete durable successful record already exists AND its payload
  // integrity is verified against retained bytes.
  const priorComplete = records.filter((r) => r.kind === 'finalization' && (r.result === 'COMPLETE' || r.result === 'COMPLETE_WITH_LIMITATION'));
  const published = records.filter((r) => r.kind === 'delivery' && r.persistenceState === 'PUBLISHED');
  let preservedSuccess = false;
  if (priorComplete.length > 0 && published.length > 0) {
    const pv = verifyPayload(root, published[0]);
    preservedSuccess = pv.integrity === true;
  }
  const finalization = REC.createFinalization({
    finalizationId: REC.generateId('finalization'),
    incarnationId: 'previous',
    stopReason: preservedSuccess ? 'REOPENED_FOR_RECOVERY' : 'CRASH_RECOVERED_UNRESOLVED',
  });
  finalization.admissionClosed = true;
  finalization.authorityRetired = true;
  finalization.fencingEstablished = fencingEstablished;
  finalization.quiescenceProven = releasedUnaccounted.length === 0;
  finalization.quarantinedResources = quarantined;
  finalization.unresolvedExecution = releasedUnaccounted.length > 0 && !preservedSuccess;
  finalization.supervisorResult = preservedSuccess ? 'COMPLETE' : 'FAILED';
  finalization.recoverySourceNote = sourceOfProof;
  try { store.add(finalization); } catch { /* guard */ }

  const report = {
    epoch: epoch.epochNumber,
    admissionClosed: true,
    unresolvedActors: unresolved.map((a) => a.actionId),
    quarantined,
    fencingEstablished,
    drainEstablished,
    quiescenceProven: releasedUnaccounted.length === 0,
    preservedSuccess,
    disposition: preservedSuccess ? 'SUCCESS_PRESERVED' : 'NON_SUCCESSFUL',
    sourceOfProof,
    resolverQualified: resolver.fencingEstablished === true && resolver.drainEstablished === true,
  };
  return { session: { root, ownerIdentity, bootId, lock, store, recoverOnly: true }, owner, store, report };
}

function releaseSupervisor({ root, ownerIdentity }) {
  return LOCK.release(root, { ownerIdentity });
}

module.exports = {
  lockIdentityFor,
  openSupervisor,
  recoverSupervisor,
  releaseSupervisor,
  allocateEpoch,
  initOrBindOwner,
  closeAdmission,
  openAdmission,
  selectUnresolved,
  DEFAULT_VERIFY_PAYLOAD,
  DEFAULT_RECOVERY,
};