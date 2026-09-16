'use strict';
/**
 * state — record-level control store built on the durable journal (PRD §6,
 * §9.5, §25/F-07).
 *
 * The journal persists *events*; the current record state is a pure fold of
 * those events, so crash/restart/replay is deterministic and unbounded
 * history is kept for audit. Identity stability is enforced: an 'add' cannot
 * collide with an existing identity, an 'update' cannot change a record's kind
 * or identity, and a duplicate consumption of the same action is refused.
 *
 * Event ops (all validated fail-closed by {validateRecord}):
 *   - 'add'    insert a new record (duplicate identity refused)
 *   - 'update' replace the record with the given id
 *   - 'admit'  ONE compound journal entry that atomically consumes a use
 *              allowance AND reserves conservative maximum liability (PRD §9
 *              step 5). Folding derives an action_consumption and a
 *              reservation from the single event, so a crash can never split
 *              the pair. A second 'admit' for the same action is a store
 *              corruption (fail closed) — the allowance is one-use.
 *
 * The whole current state can be summarized with {stateId}, a deterministic
 * content identity over the folded records (used by §17 coherence).
 */

const path = require('node:path');
const JOURNAL = require('../store/journal.cjs');
const {
  validateRecord,
  validateStoreState,
  RECORD_ID_FIELDS,
} = require('../contracts/validate.js');
const { canonicalJson, contentId } = require('../contracts/crypto.js');

const CONTROL_VERSION = 1;

function recordId(record) {
  if (!record || typeof record !== 'object') return null;
  const f = RECORD_ID_FIELDS[record.kind];
  return f ? record[f] : null;
}

function eventValidate(event) {
  if (!event || typeof event !== 'object') return 'event must be an object';
  if (event.kind !== 'event') return 'event must have kind "event"';
  const op = event.op;
  if (op !== 'add' && op !== 'update' && op !== 'admit') {
    return `event: unknown op "${String(op)}"`;
  }
  const rec = event.record;
  if (!rec || typeof rec !== 'object') return 'event.record must be an object';
  const v = validateRecord(rec);
  if (!v.valid) return `event.record invalid: ${v.problems.join('; ')}`;
  if (op === 'admit') {
    if (rec.kind !== 'action_consumption') return 'admit: record must be an action_consumption';
    if (typeof rec.consumptionId !== 'string' || !rec.consumptionId.length) return 'admit: consumptionId required';
    if (rec.action !== undefined) {
      if (!rec.action || typeof rec.action !== 'object') return 'admit: action must be an object';
      const va = validateRecord(rec.action);
      if (!va.valid) return 'admit: action invalid: ' + va.problems.join('; ');
    }
    if (rec.budget !== undefined) {
      if (!rec.budget || typeof rec.budget !== 'object' || rec.budget.kind !== 'budget') return 'admit: budget must be the durable budget record';
      if (typeof rec.budget.lineageId !== 'string' || !rec.budget.lineageId.length) return 'admit: budget.lineageId required';
    }
    if (!rec.reservation || typeof rec.reservation !== 'object') return 'admit: reservation is required and must be an object';
    if (typeof rec.reservation.reservationId !== 'string' || !rec.reservation.reservationId.length) return 'admit: reservation.reservationId required';
    if (typeof rec.reservation.lineageId !== 'string' || !rec.reservation.lineageId.length) return 'admit: reservation.lineageId required';
    if (typeof rec.reservation.dimension !== 'string' || !rec.reservation.dimension.length) return 'admit: reservation.dimension required';
    if (!(typeof rec.reservation.maxExposure === 'number' && Number.isFinite(rec.reservation.maxExposure) && rec.reservation.maxExposure >= 0)) return 'admit: reservation.maxExposure must be a non-negative number';
    if (rec.reservation.kind !== 'DISCRETIONARY' && rec.reservation.kind !== 'MANDATORY') return 'admit: reservation.kind must be DISCRETIONARY or MANDATORY';
  }
  return null;
}

/**
 * Pure fold of events -> Map<id, record>. Deterministic; a duplicate 'admit'
 * (second consumption of the same action) throws, making recovery fail closed.
 */
function fold(events) {
  const byId = new Map();
  const consumedActions = new Set();
  for (const ev of events) {
    if (!ev || ev.kind !== 'event') throw new Error(`fold: corrupt event (expected kind "event")`);
    foldInto(byId, consumedActions, ev);
  }
  return byId;
}

function stateIdOf(byId) {
  const recs = Array.from(byId.values()).sort((a, b) => {
    const ka = recordId(a), kb = recordId(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return contentId(canonicalJson(recs));
}

/** Open (or create) a control store at a canonical root. */
function open(root) {
  if (typeof root !== 'string' || root.length === 0) throw new Error('state: root required');
  const j = JOURNAL.open(path.join(root), { validate: eventValidate });
  const control = {
    version: CONTROL_VERSION,
    root,
    journal: j,
    corrupt: null,
    _byId: null,
    // Bound instance API (module functions also accept a handle).
    add: (rec) => add(control, rec),
    update: (id, apply) => update(control, id, apply),
    admit: (rec) => admit(control, rec),
    appendEvent: (ev) => append(control, ev),
    get: (id) => get(control, id),
    has: (id) => has(control, id),
    all: () => all(control),
    byKind: (kind) => byKind(control, kind),
    stateId: () => stateId(control),
    validateState: () => validateState(control),
    meta: () => meta(control),
    close: () => close(control),
    get seq() { return j.seq; },
  };
  safeRebuild(control);
  return control;
}

function guard(control) {
  if (control.corrupt) throw new Error(`state: store corrupt (${control.corrupt.reason}); operations refused`);
}

/** Rebuild the folded view from journal events; fail closed on fold errors. */
function safeRebuild(control) {
  if (control.journal.corrupt) {
    control.corrupt = Object.assign({}, control.journal.corrupt);
    return;
  }
  try {
    control._byId = fold(JOURNAL.list(control.journal));
    control.corrupt = null;
  } catch (e) {
    control.corrupt = { at: null, reason: `fold failed: ${e.message}` };
  }
}

function current(control) {
  guard(control);
  return control._byId;
}

function append(control, event) {
  guard(control);
  const err = eventValidate(event);
  if (err) throw new Error(`state: refused event: ${err}`);
  if (event.op === 'add') {
    const id = recordId(event.record);
    if (id != null && control._byId.has(id)) throw new Error(`state: duplicate identity "${id}" (add refused)`);
  }
  if (event.op === 'admit') {
    if (consumedActionsOf(control._byId).has(event.record.actionId)) throw new Error(`state: action "${event.record.actionId}" already consumed (one-use allowance)`);
  }
  // Pre-flight the fold so an invalid sequence cannot be persisted:
  const trial = new Map(control._byId);
  foldInto(trial, consumedActionsOf(control._byId), event);
  JOURNAL.append(control.journal, event);
  control._byId = trial;
  return { seq: control.journal.seq, id: recordId(event.record) || event.record.consumptionId || null };
}

/** Set of actionIds already consumed, derived from folded consumption records. */
function consumedActionsOf(byId) {
  const s = new Set();
  for (const r of byId.values()) if (r.kind === 'action_consumption') s.add(r.actionId);
  return s;
}

/** Apply a single validated event into a Map (throws on invariant break). */
function foldInto(byId, consumedActions, ev) {
  const rec = ev.record;
  const id = recordId(rec);
  if (id == null) throw new Error(`foldInto: no identity for kind "${rec && rec.kind}"`);
  if (ev.op === 'add') {
    if (byId.has(id)) throw new Error(`foldInto: duplicate add "${id}"`);
    byId.set(id, rec);
  } else if (ev.op === 'update') {
    const prev = byId.get(id);
    if (!prev) throw new Error(`foldInto: update of missing "${id}"`);
    if (prev.kind !== rec.kind) throw new Error(`foldInto: update changed kind of "${id}"`);
    byId.set(id, rec);
  } else if (ev.op === 'admit') {
    if (consumedActions.has(rec.actionId)) throw new Error(`foldInto: duplicate consumption of action "${rec.actionId}"`);
    consumedActions.add(rec.actionId);
    const res = rec.reservation;
    const consumption = Object.assign({}, rec);
    delete consumption.reservation;
    delete consumption.action;
    delete consumption.budget;
    const reservation = {
      schemaVersion: 1,
      kind: 'reservation',
      reservationId: res.reservationId,
      lineageId: res.lineageId,
      dimension: res.dimension,
      actionId: rec.actionId,
      maxExposure: res.maxExposure,
      consumptionKind: res.kind,
      state: 'ACTIVE',
    };
    if (byId.has(rec.consumptionId)) throw new Error(`foldInto: duplicate consumption id "${rec.consumptionId}"`);
    byId.set(rec.consumptionId, consumption);
    if (byId.has(res.reservationId)) throw new Error(`foldInto: duplicate reservation "${res.reservationId}"`);
    byId.set(res.reservationId, reservation);
    // The same durable entry also folds the immutable grant and the next budget
    // state: consume + reserve + ledger + grant attribution share one journal file.
    if (rec.action) {
      if (byId.has(rec.action.actionId)) throw new Error(`foldInto: duplicate action "${rec.action.actionId}"`);
      byId.set(rec.action.actionId, rec.action);
    }
    if (rec.budget) {
      byId.set(rec.budget.lineageId, rec.budget);
    }
  } else {
    throw new Error(`foldInto: unknown op "${ev.op}"`);
  }
}

/** Add a new record (duplicate identity refused). */
function add(control, record) {
  return append(control, { kind: 'event', op: 'add', record });
}

/** Update an existing record through `apply(prev) -> next`; kind/id must not change. */
function update(control, id, apply) {
  guard(control);
  const prev = control._byId.get(id);
  if (!prev) throw new Error(`state: cannot update missing record "${id}"`);
  const next = apply(prev);
  if (!next || typeof next !== 'object') throw new Error('state: update must return an object');
  if (recordId(next) !== id) throw new Error(`state: update changed the identity of "${id}"`);
  if (next.kind !== prev.kind) throw new Error(`state: update changed the kind of "${id}"`);
  return append(control, { kind: 'event', op: 'update', record: next });
}

/** Compound atomic admission: consume allowance + reserve liability (§9.5). */
function admit(control, consumptionRecord) {
  return append(control, { kind: 'event', op: 'admit', record: consumptionRecord });
}

/** Look up the consumption record for a given actionId, if any. */
function consumptionFor(control, actionId) {
  guard(control);
  for (const r of control._byId.values()) {
    if (r.kind === 'action_consumption' && r.actionId === actionId) return r;
  }
  return undefined;
}

function get(control, id) { guard(control); return control._byId.get(id); }
function has(control, id) { guard(control); return control._byId.has(id); }
function all(control) { guard(control); return Array.from(control._byId.values()); }
function byKind(control, kind) {
  guard(control);
  return all(control).filter((r) => r.kind === kind);
}
function stateId(control) { guard(control); return stateIdOf(control._byId); }

/** Validate the current folded state as a whole (fail closed on duplicates). */
function validateState(control) {
  guard(control);
  return validateStoreState({ records: all(control) });
}

function meta(control) {
  return {
    version: control.version,
    root: control.root,
    seq: control.journal.seq,
    records: control._byId.size,
    corrupt: control.corrupt,
    journal: control.journal.meta().recovery,
    stateId: control.corrupt ? null : stateIdOf(control._byId),
  };
}

function close(control) {
  JOURNAL.close(control.journal);
}

module.exports = {
  CONTROL_VERSION,
  RECORD_ID_FIELDS,
  recordId,
  eventValidate,
  fold,
  foldInto,
  stateIdOf,
  consumedActionsOf,
  consumptionFor,
  open,
  add,
  update,
  admit,
  get,
  has,
  all,
  byKind,
  stateId,
  validateState,
  meta,
  close,
};