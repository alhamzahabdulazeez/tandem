'use strict';
/**
 * admission — §9 admission gate as a deterministic control operation.
 *
 * admitAndRelease implements the required ORDER with one honest boundary:
 * the physical "last trusted execution barrier" is an injected {@link boundary}
 * whose qualification is the runtime profile's job (IB-01). The default — the
 * current environment — REFUSES release, so the deterministic control steps are
 * exercised and the refusal is recorded as authoritative proof of non-dispatch
 * (consumed + reservation released), never as a fake "dispatched".
 *
 * Durable atomicity (PRD §9.5): the ONE journal event `admit` folds, from a
 * single persisted entry:
 *   - the action's immutable grant record (one-use),
 *   - the action_consumption (allowance consumed durably),
 *   - the conservative liability reservation,
 *   - the next durable budget state.
 * A crash can never split consume from reserve, and a second admit of the same
 * action is refused (replay/duplicate/late).
 *
 * {@link ackDispatch} records dispatch acknowledgement / known non-dispatch.
 * {@link recordObservation} applies the §9 observation preconditions: wrong
 * owner, wrong incarnation, wrong generation, retired authority, or an
 * unqualified observation source ALL refuse; a duplicate authenticated event is
 * ignored idempotently, never counted twice.
 */

const { isContentId } = require('../contracts/crypto.js');
const REC = require('../contracts/records.js');
const BL = require('./budget-ledger.cjs');

const ADMISSIBLE_PHASES = new Set(['READY', 'EXECUTING', 'VERIFYING', 'REPAIRING']);

/** Default boundary for the current runtime: supervised release is UNAVAILABLE. */
const NO_BOUNDARY = () => ({
  released: false,
  refusedReason: 'no qualified containment/runtime profile available (IB-01); supervised dispatch unavailable',
  dispatch: 'KNOWN_NOT_DISPATCHED',
});

function refuse(reason) {
  return { admitted: false, refused: true, reason, attributable: true };
}

/** Fully-bound immutable action grant for a proposal (§9 binding list). */
function prepareAction(proposal, clock) {
  const a = REC.createAction({
    actionId: proposal.actionId,
    incarnationId: proposal.incarnationId,
    ownerEpoch: proposal.ownerEpoch,
    operation: proposal.operation,
    targetGeneration: proposal.targetGeneration,
  });
  a.effectivePolicyRevision = proposal.effectivePolicyRevision;
  a.qualifiedProfileDigest = proposal.qualifiedProfileDigest;
  a.qualifiedExecutorIdentity = proposal.executorIdentity;
  a.inputPayloadIdentity = proposal.inputPayloadIdentity;
  a.filesystemProcessNetworkScope = proposal.disclosureScope || null;
  a.commandArgumentsEnvironmentWorkingRoot = proposal.commandUnity || ({
    commandArguments: proposal.commandArguments || null,
    environment: proposal.environment || null,
    workingRoot: proposal.workingRoot || null,
  });
  a.creationTime = clock();
  a.nonextendableExpiry = proposal.nonextendableExpiry;
  a.resourceMaximums = proposal.resourceMaximums || null;
  return a;
}

function ownerRecord(store) {
  return store.byKind('store_owner')[0] || null;
}

/**
 * §9 admitAndRelease. `proposal` is the immutable proposal; `budget` is the
 * lineage's durable budget record; `boundary` injects the release barrier.
 */
function admitAndRelease({ store, proposal, budget, boundary, clock }) {
  const now = typeof clock === 'function' ? clock() : new Date().toISOString();

  // 1. serialization boundary — the caller holds the exclusive lock; assert identity.
  // 2. authenticate executor + ownership/incarnation.
  const owner = ownerRecord(store);
  if (!owner) return refuse('no store owner (store not initialized)');
  if (proposal.executorIdentity !== owner.ownerIdentity) return refuse(`wrong executor: "${proposal.executorIdentity}"`);
  if (owner.admissionState !== 'OPEN') return refuse(`admission ${owner.admissionState}`);
  const task = store.byKind('task_incarnation').find((t) => t.incarnationId === proposal.incarnationId);
  if (!task) return refuse(`unknown incarnation "${proposal.incarnationId}"`);
  if (task.incarnationStatus !== 'ACTIVE') return refuse(`incarnation ${task.incarnationStatus}`);
  if (String(task.ownerEpoch) !== String(proposal.ownerEpoch)) return refuse(`owner epoch mismatch (${task.ownerEpoch} != ${proposal.ownerEpoch})`);
  if (!ADMISSIBLE_PHASES.has(task.phase)) return refuse(`phase ${task.phase} is not admissible`);

  // policy/grants.
  const policy = store.byKind('policy')[0];
  if (!policy) return refuse('no policy record');
  if (policy.stage !== 'EFFECTIVE' && policy.stage !== 'ENFORCED') return refuse(`policy ${policy.stage} not effective`);
  if (proposal.effectivePolicyRevision !== policy.revision) return refuse(`policy revision ${policy.revision} differs from proposal ${proposal.effectivePolicyRevision}`);

  // profile qualification.
  if (!proposal.qualifiedProfileDigest) return refuse('no qualified profile digest (IB-01)');

  // 3. immutable resolution.
  if (typeof proposal.operation !== 'string' || proposal.operation.length === 0) return refuse('operation must be immutable and non-empty');
  if (!proposal.inputPayloadIdentity || !isContentId(proposal.inputPayloadIdentity)) return refuse('invalid input payload identity');
  if (proposal.targetGeneration == null) return refuse('target generation required');

  // 4. allowance + deadlines.
  if (proposal.useAllowance !== 'UNCONSUMED') return refuse(`use allowance ${proposal.useAllowance} not available`);
  if (!proposal.nonextendableExpiry) return refuse('missing nonextendable expiry');
  const tNow = Date.parse(now);
  if (tNow >= Date.parse(proposal.nonextendableExpiry)) return refuse('action expired');

  // 5+6. check-and-reserve atomically with consumption, plus containment
  // attribution. If the budget arithmetic refuses, admission is refused
  // BEFORE anything is persisted.
  const budgeted = BL.admitToBudget(budget, {
    dimension: proposal.dimension,
    actionId: proposal.actionId,
    maxExposure: proposal.maxExposure,
    category: proposal.category,
  });
  if (!budgeted.ok) return refuse('budget: ' + budgeted.reason);

  const action = prepareAction(proposal, () => now);
  const consumption = {
    schemaVersion: 1,
    kind: 'action_consumption',
    consumptionId: proposal.consumptionId || `cons-${proposal.actionId}`,
    actionId: proposal.actionId,
    incarnationId: proposal.incarnationId,
    ownerEpoch: proposal.ownerEpoch,
    consumedAt: now,
    reservedLiability: proposal.maxExposure,
    ack: null,
    containmentIdentity: proposal.containmentIdentity || null, // runtime-attributed; UNQUALIFIED today
    action,
    reservation: {
      reservationId: proposal.reservationId || `res-${proposal.actionId}`,
      lineageId: budget.lineageId,
      dimension: proposal.dimension,
      actionId: proposal.actionId,
      maxExposure: proposal.maxExposure,
      kind: proposal.category,
    },
    budget: budgeted.record,
  };

  let decision;
  try {
    store.admit(consumption);
    decision = { admitted: true, refused: false, actionId: proposal.actionId, consumptionId: consumption.consumptionId, reservation: consumption.reservation, budget: budgeted.record };
  } catch (e) {
    return refuse('admission persist refused: ' + e.message);
  }

  // 7. recheck expiry while still serialized.
  if (Date.now() >= Date.parse(proposal.nonextendableExpiry)) {
    // expired between check and commit: close out as known-not-dispatched.
    closeOut(store, decision, { disposition: 'KNOWN_NOT_DISPATCHED', clock });
    return Object.assign({}, decision, { dispatch: 'KNOWN_NOT_DISPATCHED', releaseRefused: true, reason: 'expired before release' });
  }

  // 8. release through the boundary.
  const bound = typeof boundary === 'function' ? boundary : NO_BOUNDARY;
  const rel = bound({ action, proposal });
  if (rel && rel.released) {
    // 9. ack dispatch
    closeOut(store, decision, { disposition: 'ACKNOWLEDGED', clock });
    decision.dispatch = 'ACKNOWLEDGED';
    return decision;
  }
  // Not released: authoritative proof of non-dispatch. Consumed; reservation
  // released via that proof. No automatic replay under any identifier.
  closeOut(store, decision, { disposition: 'KNOWN_NOT_DISPATCHED', clock });
  decision.dispatch = 'KNOWN_NOT_DISPATCHED';
  decision.releaseRefused = true;
  decision.reason = (rel && rel.refusedReason) || 'release refused';
  return decision;
}

/** Apply a dispatch acknowledgement or authoritative non-dispatch (§9.9). */
function closeOut(store, decision, { disposition, clock }) {
  const now = typeof clock === 'function' ? clock() : new Date().toISOString();
  const cid = decision.consumptionId;
  const actionId = decision.actionId;

  store.update(cid, (p) => Object.assign({}, p, { ack: disposition, ackedAt: now }));

  const action = store.get(actionId);
  if (action) {
    store.update(actionId, (p) => Object.assign({}, p, {
      useAllowance: 'CONSUMED',
      dispatch: disposition,
      execution: disposition === 'ACKNOWLEDGED' ? 'PENDING' : 'UNKNOWN',
      lifecycle: disposition === 'ACKNOWLEDGED' ? 'OBSERVING' : 'SETTLED',
    }));
  }

  if (disposition === 'KNOWN_NOT_DISPATCHED') {
    // Authoritative non-dispatch proof releases the reservation (§12 route 2).
    const budget = store.get(decision.reservation.lineageId);
    if (budget) {
      const released = BL.releaseBudget(budget, {
        dimension: decision.reservation.dimension,
        actionId,
        route: 'proveNonDispatch',
      });
      if (released.ok) store.update(budget.lineageId, () => released.record);
    }
  }
}

/** Record an authenticated execution observation (§9 observation preconditions). */
function recordObservation({ store, owner, event, observationSource, clock }) {
  const now = typeof clock === 'function' ? clock() : new Date().toISOString();
  if (!event || event.kind !== 'action_execution_observation') return { refused: true, reason: 'event must be an action_execution_observation' };
  const actionId = event.actionId;

  const consumption = store.byKind('action_consumption').find((c) => c.actionId === actionId);
  if (!consumption) return { refused: true, reason: 'action was never admitted (no consumption)' };

  if (owner && event.ownerRec && event.ownerRec.ownerIdentity !== owner.ownerIdentity) return { refused: true, reason: 'wrong current owner' };

  // authority retired (late result) refuses.
  const retired = store.byKind('finalization').some((f) => f.admissionClosed === true && f.authorityRetired === true);
  if (retired) return { refused: true, reason: 'incarnation authority retired; late execution result rejected' };

  const action = store.get(actionId);
  if (!action) return { refused: true, reason: 'no action record' };

  // expected generation.
  if (event.targetGeneration != null && action.targetGeneration !== event.targetGeneration) {
    return { refused: true, reason: `generation mismatch (${event.targetGeneration} vs ${action.targetGeneration})` };
  }

  // qualified observation source: without one, nothing may be recorded as fact.
  if (!observationSource || observationSource.qualified !== true) {
    return { refused: true, reason: 'no qualified observation source (IB-01); refusing to record unqualified execution fact' };
  }

  // duplicate identical event: idempotently ignored, never counted twice.
  if (event.duplicate === true && action.execution === event.execution) {
    return { refused: false, duplicate: true, actionId };
  }

  store.update(actionId, (p) => Object.assign({}, p, {
    execution: event.execution,
    lifecycle: event.execution === 'SUCCEEDED' || event.execution === 'FAILED' || event.execution === 'TIMED_OUT' ? 'SETTLED' : p.lifecycle,
    executionObservedAt: now,
  }));
  return { refused: false, actionId, execution: event.execution };
}

module.exports = {
  ADMISSIBLE_PHASES,
  NO_BOUNDARY,
  refuse,
  prepareAction,
  admitAndRelease,
  closeOut,
  recordObservation,
};