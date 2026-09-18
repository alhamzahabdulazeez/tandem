'use strict';
/**
 * budget-ledger — durable, journal-persisted budget record algebra (PRD §12).
 *
 * `src/contracts/budget.js` is the PURE arithmetic for hard-limit invariants
 * over a fresh ledger. This module maps that same algebra onto a durable
 * `budget` record (one per lineage) so demands are checked and reserved ATOMIC
 * with action consumption (§12: "Checks and reservations occur atomically
 * with action consumption before executable or chargeable dispatch"), and the
 * full ledger state survives crash/restart.
 *
 * All transitions are pure (return a NEW record) and fail closed:
 *  - unknown usage on a dimension prevents hard admission;
 *  - capacity leaves the ledger ONLY by the three lawful routes
 *    (settle / proveNonDispatch / consumeConservatively);
 *  - a MANDATORY reservation only ever draws from protected-future capacity
 *    and the transfer is not double counted.
 */

function sumReservations(reservations) {
  let s = 0;
  for (const k of Object.keys(reservations || {})) s += reservations[k].amount;
  return s;
}

function dimState(d) {
  return {
    dimension: d.dimension,
    hardLimit: d.hardLimit,
    softTarget: d.softTarget == null ? null : d.softTarget,
    estimated: d.estimated == null ? null : d.estimated,
    unknown: d.unknown == null ? null : d.unknown,
    protectedFuture: d.protectedFuture,
    settled: d.settled == null ? 0 : d.settled,
    reservations: (function () {
      const out = {};
      for (const k of Object.keys(d.reservations || {})) out[k] = { amount: d.reservations[k].amount, category: d.reservations[k].category };
      return out;
    })(),
  };
}

/** Serialize a pure budget.js ledger into the durable record shape. */
function budgetRecordFromLedger(lineageId, ledger) {
  const dimensions = {};
  for (const name of Object.keys(ledger.dimensions)) {
    dimensions[name] = dimState(ledger.dimensions[name]);
  }
  return { schemaVersion: 1, kind: 'budget', lineageId, dimensions };
}

/** Plain view of a durable budget record usable by the algebra below. */
function plainView(rec) {
  const dimensions = {};
  for (const name of Object.keys(rec.dimensions || {})) dimensions[name] = dimState(rec.dimensions[name]);
  return { lineageId: rec.lineageId, dimensions };
}

/**
 * Initialize a budget record from dimension specs — the same specs
 * `budget.createLedger` accepts ({dimension, hardLimit, protectedFuture,
 * softTarget, estimated, unknown}).
 */
function initBudget(lineageId, dimensionSpecs) {
  const BUDGET = require('../contracts/budget.js');
  const ledger = BUDGET.createLedger(dimensionSpecs);
  return budgetRecordFromLedger(lineageId, ledger);
}

function nextRecord(rec, dimensions) {
  return { schemaVersion: 1, kind: 'budget', lineageId: rec.lineageId, dimensions };
}

/**
 * Atomic budget check-and-reserve for one action (PRD §12 + §9.5).
 * category: 'DISCRETIONARY' | 'MANDATORY'.
 */
function admitToBudget(rec, { dimension, actionId, maxExposure, category }) {
  if (category !== 'DISCRETIONARY' && category !== 'MANDATORY') return { ok: false, reason: `unknown reservation category "${category}"` };
  const view = plainView(rec);
  const d = view.dimensions[dimension];
  if (!d) return { ok: false, reason: `unknown dimension "${dimension}"` };
  if (d.unknown != null) {
    return { ok: false, reason: `unknown usage (${d.unknown}) on "${dimension}" prevents hard admission` };
  }
  if (typeof maxExposure !== 'number' || !Number.isFinite(maxExposure) || maxExposure < 0) {
    return { ok: false, reason: 'maxExposure must be a finite non-negative number' };
  }
  if (d.reservations[actionId]) return { ok: false, reason: `action "${actionId}" already holds a reservation on "${dimension}"` };
  if (category === 'MANDATORY') {
    if (!(maxExposure <= d.protectedFuture)) {
      return { ok: false, reason: `mandatory reservation ${maxExposure} exceeds protected future capacity (${d.protectedFuture}) on "${dimension}"` };
    }
  } else {
    const lhs = d.settled + sumReservations(d.reservations) + maxExposure + d.protectedFuture;
    if (!(lhs <= d.hardLimit)) {
      return { ok: false, reason: `hard limit exceeded on "${dimension}": ${lhs} > ${d.hardLimit}` };
    }
  }
  const reservations = Object.assign({}, d.reservations, { [actionId]: { amount: maxExposure, category } });
  const next = Object.assign({}, d, {
    reservations,
    protectedFuture: category === 'MANDATORY' ? d.protectedFuture - maxExposure : d.protectedFuture,
  });
  return { ok: true, record: nextRecord(rec, Object.assign({}, view.dimensions, { [dimension]: next })) };
}

/**
 * The ONLY three lawful capacity-release routes (§12). A timeout, missing
 * receipt, cancelled client wait, or new action identifier releases nothing.
 */
function releaseBudget(rec, { dimension, actionId, route, authoritativeActual }) {
  const view = plainView(rec);
  const d = view.dimensions[dimension];
  if (!d) return { ok: false, reason: `unknown dimension "${dimension}"` };
  const res = d.reservations[actionId];
  if (!res) return { ok: false, reason: `no reservation for "${actionId}" on "${dimension}"` };

  if (route === 'settle') {
    if (typeof authoritativeActual !== 'number' || !Number.isFinite(authoritativeActual) || authoritativeActual < 0) {
      return { ok: false, reason: 'settle requires authoritativeActual (finite non-negative)' };
    }
    if (authoritativeActual > res.amount) return { ok: false, reason: `actual ${authoritativeActual} exceeds reserved ${res.amount}` };
    const reclaimed = res.amount - authoritativeActual;
    const reservations = Object.assign({}, d.reservations);
    delete reservations[actionId];
    const next = Object.assign({}, d, {
      reservations,
      settled: d.settled + authoritativeActual,
      protectedFuture: d.protectedFuture + (res.category === 'MANDATORY' ? reclaimed : 0),
    });
    return { ok: true, record: nextRecord(rec, Object.assign({}, view.dimensions, { [dimension]: next })) };
  }

  if (route === 'proveNonDispatch') {
    const reservations = Object.assign({}, d.reservations);
    delete reservations[actionId];
    const next = Object.assign({}, d, {
      reservations,
      protectedFuture: d.protectedFuture + (res.category === 'MANDATORY' ? res.amount : 0),
    });
    return { ok: true, record: nextRecord(rec, Object.assign({}, view.dimensions, { [dimension]: next })) };
  }

  if (route === 'consumeConservatively') {
    const reservations = Object.assign({}, d.reservations);
    delete reservations[actionId];
    const next = Object.assign({}, d, {
      reservations,
      settled: d.settled + res.amount,
      // protectedFuture unchanged: conservative full consumption restores no headroom.
    });
    return { ok: true, record: nextRecord(rec, Object.assign({}, view.dimensions, { [dimension]: next })) };
  }

  return { ok: false, reason: `unknown release route "${route}"` };
}

function budgetInvariants(rec) {
  const violations = [];
  for (const name of Object.keys(rec.dimensions || {})) {
    const d = rec.dimensions[name];
    const lhs = d.settled + sumReservations(d.reservations) + d.protectedFuture;
    if (!(lhs <= d.hardLimit)) violations.push(`${name}: ${lhs} > ${d.hardLimit}`);
  }
  return { ok: violations.length === 0, violations };
}

module.exports = {
  budgetRecordFromLedger,
  plainView,
  initBudget,
  admitToBudget,
  releaseBudget,
  budgetInvariants,
};