'use strict';
/**
 * identity — §6 Store Identity + §10 Ownership Integrity + §9 Mutation
 * Authorization. Pure deterministic reducers over durable records.
 *
 * Three independent gates (all fail closed):
 *
 * 1. {@link storeIdentityGate} — the store identity digest binding the
 *    owner record to a canonical root. Self-bind (pure lock↔path check) plus
 *    optional live binding (reject alternate-attachment aliases).
 *
 * 2. {@link ownershipIntegrityGate} — epoch ledger audit: every epoch is
 *    contiguous, epoch 1 (INITIAL) belongs to the founding owner, and later
 *    epochs follow lawful role transitions (SUPERVISOR continuation under the
 *    founder, RECOVERY takeover under any owner, and a foreign SUPERVISOR only
 *    after that owner's own RECOVERY). Recovery/admission state is honest.
 *
 * 3. {@link authorizeMutation} — per-record authorization: reject stale
 *    epoch, future epoch, unknown/wrong incarnation, wrong generation,
 *    duplicate identity, already-consumed allowance, admission-closed,
 *    recovery-only, and retired-authority mutations.
 *
 * {@link identityIntegrityGate} combines the three into a single gate.
 *
 * PRD references: §6 (Durable Records, Store/owner identity), §8 (Admission
 * Policy), §9 (Action Admission, consumed/unknown), §10 (Ownership Recovery,
 * lock/epoch identity protected, no premature reuse), §21 (valid authority
 * and ownership history), §25 (T-03 Exclusive Ownership).
 *
 * IMPORTANT: identity/ownership is NOT qualification. `authorityGranted` is
 * ALWAYS false. Ownership does not grant execution authority by itself
 * (requirement 8).
 */

const { SCHEMA_VERSION } = require('./records.js');
const { contentId, canonicalJson } = require('./crypto.js');

// ---------------------------------------------------------------------------
// Mutation refusal reasons (§9/§6)
// ---------------------------------------------------------------------------

const MutationReason = Object.freeze({
  NO_OWNER:                    'no-owner',
  MULTIPLE_OWNERS:             'multiple-owners',
  ADMISSION_CLOSED:            'admission-closed',
  RECOVERY_ONLY:               'recovery-only',
  STALE_EPOCH:                 'stale-epoch',
  FUTURE_EPOCH:                'future-epoch',
  UNBOUND_EPOCH:               'unbound-epoch',
  DUPLICATE_IDENTITY:          'duplicate-identity',
  UNKNOWN_INCARNATION:         'unknown-incarnation',
  INACTIVE_INCARNATION:        'inactive-incarnation',
  INCARNATION_EPOCH_MISMATCH:  'incarnation-epoch-mismatch',
  WRONG_GENERATION:            'wrong-generation',
  GENERATION_INCARNATION_MISMATCH: 'generation-incarnation-mismatch',
  ALREADY_CONSUMED:            'already-consumed',
  RETIRED_AUTHORITY:           'retired-authority',
  UNSUPPORTED_KIND:            'unsupported-kind',
});

const SUPPORTED_CANDIDATE_KINDS = new Set([
  'task_incarnation', 'generation', 'action', 'action_consumption',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract the trailing integer from an owner-epoch label.
 * 'o:1' → 1, 'epoch-3' → 3, 'abc' → null.
 * A missing integer means the epoch cannot be bound to the ledger → fail closed.
 */
function epochNumberFromLabel(label) {
  if (typeof label !== 'string') return null;
  const m = /\d+$/.exec(label);
  return m ? Number(m[0]) : null;
}

/**
 * One owner record from a store state; fails closed on zero or multiple.
 */
function ownerRecord(records) {
  const owners = records.filter((r) => r.kind === 'store_owner');
  if (owners.length === 0) return { owner: null, problems: ['no store owner record'] };
  if (owners.length > 1) return { owner: null, problems: [`multiple store_owner records (${owners.length})`] };
  return { owner: owners[0], problems: [] };
}

/** Fail-closed: refuse when store owner state or epoch label is unbound. */
function storePrecheck(records) {
  const { owner, problems } = ownerRecord(records);
  if (!owner) return { ok: false, problems, owner: null };
  const parsedEpoch = epochNumberFromLabel(owner.ownerEpoch || '');
  if (owner.currentEpoch == null || owner.currentEpoch < 1) {
    problems.push('owner.currentEpoch is unallocated (must be >= 1)');
  }
  return { ok: problems.length === 0, problems, owner, parsedEpoch };
}

/** Require an incarnation to exist and be ACTIVE. */
function requireIncarnation(records, incarnationId, reasons) {
  const task = records.find((r) => r.kind === 'task_incarnation' && r.incarnationId === incarnationId);
  if (!task) { reasons.push(MutationReason.UNKNOWN_INCARNATION); return null; }
  if (task.incarnationStatus !== 'ACTIVE') { reasons.push(MutationReason.INACTIVE_INCARNATION); return null; }
  return task;
}

// ---------------------------------------------------------------------------
// §6 Store Identity Gate
// ---------------------------------------------------------------------------

/**
 * Pure self-bind: lockIdentity must be contentId('lock:' + canonicalStorePath).
 * This is the canonical-attachment invariant — alternate pathnames, symlinks,
 * or second stores attaching the same candidate MUST NOT pass.
 */
function selfBindOk(owner) {
  const expected = contentId('lock:' + owner.canonicalStorePath);
  return owner.lockIdentity === expected;
}

/**
 * Store identity gate. Validates the owner record is present, unique, and
 * self-consistent (schema version, self-bind). When live `canonicalStorePath`
 * or `lockIdentity` is supplied, validates against those too (alias/stale
 * rejection, T-03).
 *
 * @param {object} opts
 * @param {object[]} opts.records
 * @param {string} [opts.canonicalStorePath] — live root from open
 * @param {string} [opts.lockIdentity] — live lock identity from open
 * @returns {{ ok: boolean, problems: string[], storeIdentity: string|null }}
 */
function storeIdentityGate({ records, canonicalStorePath, lockIdentity }) {
  const list = Array.isArray(records) ? records : [];
  const { owner, problems } = ownerRecord(list);

  if (!owner) return { ok: false, problems, storeIdentity: null };

  if (owner.schemaVersion !== SCHEMA_VERSION) {
    problems.push(`store_owner schemaVersion ${owner.schemaVersion} != current ${SCHEMA_VERSION}`);
  }
  if (typeof owner.canonicalStorePath !== 'string' || owner.canonicalStorePath.length === 0) {
    problems.push('store_owner.canonicalStorePath is empty');
  }
  if (typeof owner.lockIdentity !== 'string' || owner.lockIdentity.length === 0) {
    problems.push('store_owner.lockIdentity is empty');
  }
  if (typeof owner.ownerIdentity !== 'string' || owner.ownerIdentity.length === 0) {
    problems.push('store_owner.ownerIdentity is empty');
  }

  // §6/§25 T-03: self-bind — lock identity must derive from the canonical path.
  if (!selfBindOk(owner)) {
    problems.push('store_owner.lockIdentity does not match contentId(lock:canonicalStorePath) — alias or corruption');
  }

  // Live binding (optional): reject alternate-attachment.
  if (canonicalStorePath != null && owner.canonicalStorePath !== canonicalStorePath) {
    problems.push(`store already bound to "${owner.canonicalStorePath}"; live root "${canonicalStorePath}" is an alias`);
  }
  if (lockIdentity != null && owner.lockIdentity !== lockIdentity) {
    problems.push(`store_owner.lockIdentity does not match the live lock — stale owner or re-attachment`);
  }

  const storeIdentity = problems.length === 0
    ? contentId(canonicalJson({
      schemaVersion: owner.schemaVersion,
      canonicalStorePath: owner.canonicalStorePath,
      lockIdentity: owner.lockIdentity,
    }))
    : null;

  return { ok: problems.length === 0, problems, storeIdentity };
}

// ---------------------------------------------------------------------------
// §10 Ownership Integrity Gate (epoch ledger audit)
// ---------------------------------------------------------------------------

/**
 * Validate the epoch allocation ledger: contiguous [1..currentEpoch], no
 * duplicate/future epochs, epoch 1 must be INITIAL and allocated by the
 * founding owner (store_owner.ownerIdentity), and later epochs must be lawful
 * role transitions. Legitimate cross-boot recovery is clean: INITIAL under the
 * founder, RECOVERY under the new supervisor. A foreign SUPERVISOR epoch with
 * no preceding RECOVERY by that owner is stale-owner residue and fails.
 *
 * @param {object} opts
 * @param {object[]} opts.records
 * @returns {{ ok, problems, owner, currentEpoch, recoveryState, admissionState, epochAllocations }}
 */
function ownershipIntegrityGate({ records }) {
  const list = Array.isArray(records) ? records : [];
  const { owner, problems } = ownerRecord(list);

  if (!owner) {
    return { ok: false, problems, owner: null, currentEpoch: null, recoveryState: null, admissionState: null, epochAllocations: [] };
  }

  // Current epoch must be allocated (>= 1).
  const currentEpoch = owner.currentEpoch;
  if (typeof currentEpoch !== 'number' || !Number.isInteger(currentEpoch) || currentEpoch < 1) {
    problems.push(`owner.currentEpoch must be an integer >= 1 (got ${currentEpoch})`);
  }

  const recoveryState = owner.recoveryState || 'NORMAL';
  const admissionState = owner.admissionState || null;

  // Epoch allocation ledger.
  const epochs = list.filter((r) => r.kind === 'epoch_alloc')
    .slice()
    .sort((a, b) => (a.epochNumber || 0) - (b.epochNumber || 0));

  if (epochs.length === 0) {
    problems.push('no epoch_alloc records — epoch ledger unaudited');
    return { ok: problems.length === 0, problems, owner, currentEpoch, recoveryState, admissionState, epochAllocations: [] };
  }

  // Contiguity [1..currentEpoch]: numbers must be exactly 1,2,...,N.
  if (typeof currentEpoch === 'number' && currentEpoch >= 1) {
    if (epochs.length !== currentEpoch) {
      problems.push(`epoch ledger has ${epochs.length} entries but currentEpoch is ${currentEpoch} — expected exactly ${currentEpoch}`);
    }
  }

  // First role must be INITIAL.
  if (epochs[0] && epochs[0].role !== 'INITIAL') {
    problems.push(`first epoch allocation role is "${epochs[0].role}" — expected INITIAL`);
  }

  // Ownership-history walk (fail closed on foreign residue). The founder's
  // binding anchor is epoch 1: INITIAL must be allocated by the store owner
  // itself. Later epochs are lawful as:
  //   - SUPERVISOR under the founder        — same-owner continuation;
  //   - RECOVERY under any owner            — crash takeover (legitimate);
  //   - SUPERVISOR under a non-founder ONLY when the previous epoch is that
  //     same owner's RECOVERY               — recovery then supervised work.
  // A SUPERVISOR/SECOND-INITIAL epoch under a foreign owner with no preceding
  // RECOVERY is stale-owner residue and fails closed.
  const seen = new Set();
  let prev = null;
  for (let i = 0; i < epochs.length; i++) {
    const e = epochs[i];
    if (seen.has(e.epochNumber)) {
      problems.push(`duplicate epoch_alloc epochNumber ${e.epochNumber}`);
    }
    seen.add(e.epochNumber);
    if (typeof currentEpoch === 'number' && e.epochNumber > currentEpoch) {
      problems.push(`epoch_alloc epochNumber ${e.epochNumber} exceeds currentEpoch ${currentEpoch}`);
    }

    if (i === 0) {
      // Binding anchor: the founder allocated the store's first epoch.
      if (e.ownerIdentity !== owner.ownerIdentity) {
        problems.push(`epoch 1 (INITIAL) owner "${e.ownerIdentity}" differs from store owner "${owner.ownerIdentity}" — founder residue`);
      }
    } else if (e.role === 'INITIAL') {
      problems.push(`epoch ${e.epochNumber} re-uses role INITIAL — only epoch 1 may be INITIAL`);
    } else if (e.role === 'RECOVERY') {
      // Crash takeover: any owner may allocate the recovery epoch.
    } else if (e.role === 'SUPERVISOR') {
      const foreign = e.ownerIdentity !== owner.ownerIdentity;
      const prevRecovered = prev && prev.role === 'RECOVERY' && prev.ownerIdentity === e.ownerIdentity;
      if (foreign && !prevRecovered) {
        problems.push(`epoch ${e.epochNumber} (SUPERVISOR) owner "${e.ownerIdentity}" is foreign without a preceding RECOVERY by that owner — stale owner residue`);
      }
    }
    prev = e;
  }

  return { ok: problems.length === 0, problems, owner, currentEpoch, recoveryState, admissionState, epochAllocations: epochs };
}

// ---------------------------------------------------------------------------
// §9 Mutation Authorization (per-record gate)
// ---------------------------------------------------------------------------

/**
 * Pure per-record mutation authorization. Validates a candidate record against
 * the current store facts: duplicate identity, stale/future epoch, wrong
 * incarnation, wrong generation, already-consumed allowance, admission-closed,
 * recovery-only, retired authority.
 *
 * NOTE: the supervisor's own recovery writes (via recoverSupervisor) do NOT
 * pass through this gate — recovery operates under lock acquisition and §10's
 * own steps. This gate governs supervised mutations, not the recovery path.
 *
 * @param {object} opts
 * @param {object[]} opts.records — the current store state
 * @param {object} opts.candidate — the proposed mutation
 * @returns {{ authorized: boolean, problems: string[], reasons: string[] }}
 */
function authorizeMutation({ records, candidate }) {
  const list = Array.isArray(records) ? records : [];
  const problems = [];
  const reasons = [];

  if (!candidate || typeof candidate !== 'object') {
    return { authorized: false, problems: ['candidate must be an object'], reasons: [MutationReason.UNSUPPORTED_KIND] };
  }

  if (!SUPPORTED_CANDIDATE_KINDS.has(candidate.kind)) {
    return { authorized: false, problems: [`unsupported candidate kind "${candidate.kind}"`], reasons: [MutationReason.UNSUPPORTED_KIND] };
  }

  // --- Store owner precondition ---
  const { owner, problems: ownerProblems } = ownerRecord(list);
  if (!owner) { return { authorized: false, problems: ownerProblems, reasons: [MutationReason.NO_OWNER] }; }
  problems.push(...ownerProblems);

  const currentEpoch = owner.currentEpoch;
  if (typeof currentEpoch !== 'number' || !Number.isInteger(currentEpoch) || currentEpoch < 1) {
    problems.push('owner.currentEpoch unallocated (must be >= 1)');
    return { authorized: false, problems, reasons: [MutationReason.UNBOUND_EPOCH] };
  }

  // §10.1: recovery-only (admission is always closed in recovery).
  if (owner.recoveryState === 'RECOVERY') {
    return { authorized: false, problems, reasons: [MutationReason.RECOVERY_ONLY] };
  }

  // §9.5: admission must be open.
  if (owner.admissionState === 'CLOSED') {
    return { authorized: false, problems, reasons: [MutationReason.ADMISSION_CLOSED] };
  }

  // Retired authority: no new work after finalization.
  const retired = list.some((r) => r.kind === 'finalization' && r.admissionClosed === true && r.authorityRetired === true);
  if (retired) {
    return { authorized: false, problems, reasons: [MutationReason.RETIRED_AUTHORITY] };
  }

  // --- Identity duplication guard (consistent with RECORD_ID_FIELDS in validate.js) ---
  const idField = {
    task_incarnation: 'incarnationId',
    generation: 'generationId',
    action: 'actionId',
    action_consumption: 'consumptionId',
  }[candidate.kind];
  if (idField && list.some((r) => r.kind === candidate.kind && r[idField] === candidate[idField])) {
    return { authorized: false, problems, reasons: [MutationReason.DUPLICATE_IDENTITY] };
  }

  // --- Consumed-allowance guard (never replay) ---
  const consumedSet = new Set(list.filter((r) => r.kind === 'action_consumption').map((r) => r.actionId));

  // --- Candidate-kind-specific checks ---
  if (candidate.kind === 'task_incarnation') {
    const n = epochNumberFromLabel(candidate.ownerEpoch);
    if (n === null) return { authorized: false, problems, reasons: [MutationReason.UNBOUND_EPOCH] };
    if (n < currentEpoch) return { authorized: false, problems, reasons: [MutationReason.STALE_EPOCH] };
    if (n > currentEpoch) return { authorized: false, problems, reasons: [MutationReason.FUTURE_EPOCH] };
  }

  if (candidate.kind === 'generation') {
    const task = requireIncarnation(list, candidate.incarnationId, reasons);
    if (!task) return { authorized: false, problems, reasons: reasons.slice() };
    if (typeof candidate.taskId === 'string' && candidate.taskId !== task.taskId) {
      reasons.push(MutationReason.INCARNATION_EPOCH_MISMATCH); // incarnation-task binding mismatch
      return { authorized: false, problems, reasons: reasons.slice() };
    }
  }

  if (candidate.kind === 'action') {
    // Incarnation must exist and be active.
    const task = requireIncarnation(list, candidate.incarnationId, reasons);
    if (!task) return { authorized: false, problems, reasons: reasons.slice() };

    // Epoch must bind to current: candidate.ownerEpoch must equal the incarnation's
    // ownerEpoch (proposition was issued under the incarnation's authority) and
    // parse to the current epoch.
    if (String(task.ownerEpoch) !== String(candidate.ownerEpoch)) {
      reasons.push(MutationReason.INCARNATION_EPOCH_MISMATCH);
      return { authorized: false, problems, reasons: reasons.slice() };
    }
    const n = epochNumberFromLabel(candidate.ownerEpoch);
    if (n === null) return { authorized: false, problems, reasons: [MutationReason.UNBOUND_EPOCH] };
    if (n < currentEpoch) return { authorized: false, problems, reasons: [MutationReason.STALE_EPOCH] };
    if (n > currentEpoch) return { authorized: false, problems, reasons: [MutationReason.FUTURE_EPOCH] };

    // targetGeneration must reference an existing generation.
    if (candidate.targetGeneration != null) {
      const gen = list.find((r) => r.kind === 'generation' && r.generationId === candidate.targetGeneration);
      if (!gen) {
        reasons.push(MutationReason.WRONG_GENERATION);
        return { authorized: false, problems, reasons: reasons.slice() };
      }
      // That generation must belong to the same incarnation.
      if (gen.incarnationId !== candidate.incarnationId) {
        reasons.push(MutationReason.GENERATION_INCARNATION_MISMATCH);
        return { authorized: false, problems, reasons: reasons.slice() };
      }
    }

    // Already consumed: an allowanced action cannot be re-admitted.
    if (consumedSet.has(candidate.actionId)) {
      return { authorized: false, problems, reasons: [MutationReason.ALREADY_CONSUMED] };
    }
  }

  if (candidate.kind === 'action_consumption') {
    // Never replay a consumed allowance.
    if (consumedSet.has(candidate.actionId)) {
      return { authorized: false, problems, reasons: [MutationReason.ALREADY_CONSUMED] };
    }
    const n = epochNumberFromLabel(candidate.ownerEpoch);
    if (n === null) return { authorized: false, problems, reasons: [MutationReason.UNBOUND_EPOCH] };
    if (n < currentEpoch) return { authorized: false, problems, reasons: [MutationReason.STALE_EPOCH] };
    if (n > currentEpoch) return { authorized: false, problems, reasons: [MutationReason.FUTURE_EPOCH] };
  }

  return { authorized: true, problems, reasons };
}

// ---------------------------------------------------------------------------
// Combined identity integrity gate
// ---------------------------------------------------------------------------

/**
 * Combined gate: store identity ∧ ownership integrity ∧ (candidate authorized).
 * Always returns `authorityGranted: false` — ownership is not qualification
 * and does not grant execution authority.
 *
 * @param {object} opts
 * @param {object[]} opts.records
 * @param {string} [opts.canonicalStorePath]
 * @param {string} [opts.lockIdentity]
 * @param {object} [opts.candidate]
 * @returns {{ ok, problems, reasons, storeIdentity, currentEpoch, authorityGranted }}
 */
function identityIntegrityGate({ records, canonicalStorePath, lockIdentity, candidate }) {
  const sg = storeIdentityGate({ records, canonicalStorePath, lockIdentity });
  const og = ownershipIntegrityGate({ records });
  const mg = candidate
    ? authorizeMutation({ records, candidate })
    : { authorized: true, problems: [], reasons: [] };

  const problems = [...sg.problems, ...og.problems, ...mg.problems];
  const reasons = [...mg.reasons];

  return {
    ok: sg.ok && og.ok && mg.authorized,
    problems,
    reasons,
    storeIdentity: sg.storeIdentity,
    currentEpoch: og.currentEpoch,
    authorityGranted: false, // REQUIREMENT 8: never grant execution authority
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  MutationReason,
  SUPPORTED_CANDIDATE_KINDS,
  epochNumberFromLabel,
  storeIdentity,
  storeIdentityGate,
  ownershipIntegrityGate,
  authorizeMutation,
  identityIntegrityGate,
};

/** Store identity digest (re-exported for report layer). */
function storeIdentity(records) {
  return storeIdentityGate({ records }).storeIdentity;
}
