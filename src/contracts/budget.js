'use strict';
/**
 * Hard-limit budget ledger — pure arithmetic for the Master PRD §12.
 *
 * Enforces the mandatory additive invariant:
 *
 *     settled + reservations + newReservation + remainingProtectedFuture <= hardLimit
 *
 * where:
 * - `reservations` is the sum of conservative outstanding reservations
 *   (justified maximum exposure, not average cost);
 * - `protectedFuture` is capacity reserved exclusively for mandatory work
 *   (verification, required review, fencing/reconciliation, journal/terminal
 *   recording, frozen delivery, and declared retention);
 * - a MANDATORY admission may *transfer* capacity out of `protectedFuture`
 *   into its reservation (the transfer is not double counted);
 * - a DISCRETIONARY admission must fit in headroom that never touches
 *   `protectedFuture`.
 *
 * Capacity is released ONLY by the three authoritative routes (§12):
 *   1. an authoritative settlement establishing the remaining maximum,
 *   2. an authoritative proof of non-dispatch,
 *   3. conservative consumption of the full reserved bound (restores no
 *      headroom).
 * A timeout, missing receipt, cancelled client wait, or new action identifier
 * releases nothing. Unknown usage (`unknown != null`) prevents hard admission.
 *
 * This module is PURE and immutable: every transition returns a new ledger and
 * never mutates its inputs. The actual qualified profile, the dimension
 * ceilings, and the authoritative receipts remain boundings owned by IB-03 /
 * the budget policy — this library enforces the arithmetic, not the policy.
 */

// ---------------------------------------------------------------------------
// Ledger construction
// ---------------------------------------------------------------------------

/**
 * Create a dimension state.
 * @param {object} params
 * @param {string} params.dimension
 * @param {number} params.hardLimit
 * @param {number} [params.protectedFuture=0]
 * @param {number} [params.softTarget=null]
 * @param {number} [params.estimated=null]
 * @param {number|null} [params.unknown=null] — non-null means usage is not
 *   conservatively boundable; hard admission on this dimension is refused.
 * @returns {object} frozen dimension state
 */
function createDimension({
  dimension, hardLimit, protectedFuture = 0,
  softTarget = null, estimated = null, unknown = null,
}) {
  if (typeof dimension !== 'string' || dimension.length === 0) {
    throw new Error('createDimension: dimension must be a non-empty string');
  }
  for (const [name, v] of [['hardLimit', hardLimit], ['protectedFuture', protectedFuture]]) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      throw new Error(`createDimension: ${name} must be a finite non-negative number`);
    }
  }
  if (protectedFuture > hardLimit) {
    throw new Error(`createDimension: protectedFuture (${protectedFuture}) exceeds hardLimit (${hardLimit}) for "${dimension}"`);
  }
  if (unknown != null) {
    if (typeof unknown !== 'number' || unknown < 0) {
      throw new Error(`createDimension: unknown must be a non-negative number or null`);
    }
  }
  return Object.freeze({
    dimension,
    hardLimit,
    softTarget: softTarget == null ? null : softTarget,
    estimated: estimated == null ? null : estimated,
    unknown: unknown == null ? null : unknown,
    protectedFuture,
    settled: 0,
    reservations: Object.freeze({}), // actionId -> { amount, category }
  });
}

/**
 * Create a fresh ledger from dimension specs.
 * @param {Array<object>} dimensionSpecs — objects passed to createDimension
 * @returns {object} frozen { dimensions: { name: dimState } }
 */
function createLedger(dimensionSpecs) {
  if (!Array.isArray(dimensionSpecs)) throw new Error('createLedger: dimensionSpecs must be an array');
  const dimensions = {};
  for (const spec of dimensionSpecs) {
    const dim = createDimension(spec);
    dimensions[dim.dimension] = dim;
  }
  return Object.freeze({ dimensions: Object.freeze(dimensions) });
}

// ---------------------------------------------------------------------------
// Core arithmetic
// ---------------------------------------------------------------------------

function reservationSum(reservations) {
  let sum = 0;
  for (const k of Object.keys(reservations)) sum += reservations[k].amount;
  return sum;
}

/**
 * Copy a dimension with a new reservations map (deep-shallow freeze).
 */
function withReservations(dim, reservations) {
  return Object.freeze({ ...dim, reservations: Object.freeze(reservations) });
}

function copyReservations(reservations) {
  const copy = {};
  for (const k of Object.keys(reservations)) copy[k] = { ...reservations[k] };
  return copy;
}

// ---------------------------------------------------------------------------
// Admission
// ---------------------------------------------------------------------------

/**
 * The mandatory additive invariant used by every admission:
 * settled + reservations + newReservation + protectedFuture <= hardLimit.
 */
function invariantOK(dim, newReservation) {
  if (dim.unknown != null) return { ok: false, reason: `unknown usage (${dim.unknown}) on "${dim.dimension}" prevents hard admission` };
  const lhs = dim.settled + reservationSum(dim.reservations) + newReservation + dim.protectedFuture;
  if (!(lhs <= dim.hardLimit)) {
    return { ok: false, reason: `hard limit exceeded on "${dim.dimension}": ${lhs} > ${dim.hardLimit}` };
  }
  return { ok: true };
}

/**
 * Attempt discretionary admission.
 * @param {object} ledger
 * @param {string} dimension
 * @param {string} actionId
 * @param {number} maxExposure — the conservative reservation amount
 * @returns {{ admitted: boolean, ledger?: object, reason?: string }}
 */
function admitDiscretionary(ledger, dimension, actionId, maxExposure) {
  return admit(ledger, dimension, actionId, maxExposure, 'discretionary');
}

/**
 * Attempt mandatory admission.
 * @param {object} ledger
 * @param {string} dimension
 * @param {string} actionId
 * @param {number} maxExposure
 * @returns {{ admitted: boolean, ledger?: object, reason?: string }}
 */
function admitMandatory(ledger, dimension, actionId, maxExposure) {
  return admit(ledger, dimension, actionId, maxExposure, 'mandatory');
}

function admit(ledger, dimension, actionId, maxExposure, category) {
  const dim = ledger.dimensions[dimension];
  if (!dim) return { admitted: false, reason: `unknown dimension "${dimension}"` };
  if (typeof actionId !== 'string' || actionId.length === 0) {
    return { admitted: false, reason: 'admit: actionId must be a non-empty string' };
  }
  if (Object.prototype.hasOwnProperty.call(dim.reservations, actionId)) {
    return { admitted: false, reason: `admit: "${actionId}" already holds a reservation on "${dimension}"` };
  }
  if (typeof maxExposure !== 'number' || !Number.isFinite(maxExposure) || maxExposure < 0) {
    return { admitted: false, reason: `admit: maxExposure must be a finite non-negative number` };
  }
  const check = invariantOK(dim, maxExposure);
  if (!check.ok) return { admitted: false, reason: check.reason };

  const res = copyReservations(dim.reservations);
  res[actionId] = { amount: maxExposure, category };
  let next = withReservations(dim, res);
  if (category === 'mandatory') {
    if (!(maxExposure <= dim.protectedFuture)) {
      return { admitted: false, reason: `mandatory reservation ${maxExposure} exceeds protected future capacity (${dim.protectedFuture}) on "${dimension}"` };
    }
    next = Object.freeze({ ...next, protectedFuture: dim.protectedFuture - maxExposure });
  }
  const dimensions = { ...ledger.dimensions, [dimension]: next };
  return { admitted: true, ledger: Object.freeze({ dimensions: Object.freeze(dimensions) }) };
}

// ---------------------------------------------------------------------------
// Release routes (the only three lawful ways capacity leaves the ledger)
// ---------------------------------------------------------------------------

function dimensionOf(ledger, dimension) {
  const dim = ledger.dimensions[dimension];
  if (!dim) return { error: `unknown dimension "${dimension}"` };
  return { dim };
}

/**
 * Route 1 — authoritative settlement establishing the remaining maximum.
 * @param {object} ledger
 * @param {string} dimension
 * @param {string} actionId
 * @param {number} authoritativeActual — proven final usage, 0 <= a <= reserved
 * @returns {{ settled: boolean, ledger?: object, reason?: string }}
 */
function settle(ledger, dimension, actionId, authoritativeActual) {
  const holder = dimensionOf(ledger, dimension);
  if (holder.error) return { settled: false, reason: holder.error };
  const dim = holder.dim;
  const res = dim.reservations[actionId];
  if (!res) return { settled: false, reason: `settle: no reservation for "${actionId}"` };
  if (typeof authoritativeActual !== 'number' || !Number.isFinite(authoritativeActual) || authoritativeActual < 0) {
    return { settled: false, reason: 'settle: authoritativeActual must be a finite non-negative number' };
  }
  if (authoritativeActual > res.amount) {
    return { settled: false, reason: `settle: actual ${authoritativeActual} exceeds reserved ${res.amount}` };
  }
  const reclaimed = res.amount - authoritativeActual;
  const reservations = copyReservations(dim.reservations);
  delete reservations[actionId];
  let next = withReservations(dim, reservations);
  const recharge = res.category === 'mandatory' ? reclaimed : 0; // mandatory floor never degrades
  next = Object.freeze({
    ...next,
    settled: dim.settled + authoritativeActual,
    protectedFuture: dim.protectedFuture + recharge, // discretionary reclaimed headroom becomes general headroom
  });
  const dimensions = { ...ledger.dimensions, [dimension]: next };
  return { settled: true, ledger: Object.freeze({ dimensions: Object.freeze(dimensions) }) };
}

/**
 * Route 2 — authoritative proof that the action was never dispatched.
 * Releases the full reservation. Freed capacity returns to protectedFuture.
 * @param {object} ledger
 * @param {string} dimension
 * @param {string} actionId
 * @returns {{ proven: boolean, ledger?: object, reason?: string }}
 */
function proveNonDispatch(ledger, dimension, actionId) {
  const holder = dimensionOf(ledger, dimension);
  if (holder.error) return { proven: false, reason: holder.error };
  const dim = holder.dim;
  const res = dim.reservations[actionId];
  if (!res) return { proven: false, reason: `proveNonDispatch: no reservation for "${actionId}"` };
  const reclaimed = res.amount;
  const reservations = copyReservations(dim.reservations);
  delete reservations[actionId];
  const recharge = res.category === 'mandatory' ? reclaimed : 0;
  const next = Object.freeze({
    ...withReservations(dim, reservations),
    protectedFuture: dim.protectedFuture + recharge,
  });
  const dimensions = { ...ledger.dimensions, [dimension]: next };
  return { proven: true, ledger: Object.freeze({ dimensions: Object.freeze(dimensions) }) };
}

/**
 * Route 3 — conservative consumption of the full reserved bound.
 * The full reservation becomes settled. No headroom is restored (§12).
 * @param {object} ledger
 * @param {string} dimension
 * @param {string} actionId
 * @returns {{ consumed: boolean, ledger?: object, reason?: string }}
 */
function consumeConservatively(ledger, dimension, actionId) {
  const holder = dimensionOf(ledger, dimension);
  if (holder.error) return { consumed: false, reason: holder.error };
  const dim = holder.dim;
  const res = dim.reservations[actionId];
  if (!res) return { consumed: false, reason: `consumeConservatively: no reservation for "${actionId}"` };
  const reservations = copyReservations(dim.reservations);
  delete reservations[actionId];
  const next = Object.freeze({
    ...withReservations(dim, reservations),
    settled: dim.settled + res.amount,
    // protectedFuture unchanged: no headroom restored.
  });
  const dimensions = { ...ledger.dimensions, [dimension]: next };
  return { consumed: true, ledger: Object.freeze({ dimensions: Object.freeze(dimensions) }) };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Report the structured ledger for a dimension (§12 fields).
 * @param {object} ledger
 * @param {string} dimension
 * @returns {object}
 */
function reportDimension(ledger, dimension) {
  const holder = dimensionOf(ledger, dimension);
  if (holder.error) return { error: holder.error };
  const dim = holder.dim;
  return {
    dimension: dim.dimension,
    hardLimit: dim.hardLimit,
    softTarget: dim.softTarget,
    settled: dim.settled,
    reservations: reservationSum(dim.reservations),
    outstanding: Object.keys(dim.reservations).length,
    estimated: dim.estimated,
    unknown: dim.unknown,
    protectedFuture: dim.protectedFuture,
  };
}

/**
 * Confirm the additive invariant currently holds for every dimension.
 * @param {object} ledger
 * @returns {{ valid: boolean, violations: string[] }}
 */
function assertInvariants(ledger) {
  const violations = [];
  for (const name of Object.keys(ledger.dimensions)) {
    const dim = ledger.dimensions[name];
    const lhs = dim.settled + reservationSum(dim.reservations) + dim.protectedFuture;
    if (lhs > dim.hardLimit) violations.push(`${name}: ${lhs} > ${dim.hardLimit}`);
  }
  return { valid: violations.length === 0, violations };
}

// ---------------------------------------------------------------------------
// Non-additive ceilings (concurrent active actions, processes, etc.)
// ---------------------------------------------------------------------------

/**
 * A simple runtime ceiling for a non-additive resource (e.g. concurrent
 * processes): at most `max` distinct active actors at once. Pure set tracking.
 * @param {number} max
 * @returns {object} { ceiling, active, tryAdmit, release }
 */
function createCeiling(max) {
  if (typeof max !== 'number' || !Number.isFinite(max) || max < 1) {
    throw new Error('createCeiling: max must be a positive finite number');
  }
  let active = new Set();
  return {
    ceiling: max,
    get activeCount() { return active.size; },
    get active() { return Array.from(active).sort(); },
    tryAdmit(id) {
      if (typeof id !== 'string' || id.length === 0) return { admitted: false, reason: 'id must be a non-empty string' };
      if (active.has(id)) return { admitted: false, reason: `id "${id}" already active` };
      if (active.size >= max) return { admitted: false, reason: `ceiling ${max} reached` };
      active = new Set(active).add(id);
      return { admitted: true };
    },
    release(id) {
      if (!active.has(id)) return { released: false, reason: `id "${id}" not active` };
      active = new Set(active);
      active.delete(id);
      return { released: true };
    },
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  BUDGET_CONTRACT_VERSION: 1,
  createDimension,
  createLedger,
  admitDiscretionary,
  admitMandatory,
  settle,
  proveNonDispatch,
  consumeConservatively,
  reportDimension,
  assertInvariants,
  reservationSum,
  createCeiling,
};