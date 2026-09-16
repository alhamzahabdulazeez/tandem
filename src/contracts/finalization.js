'use strict';
/**
 * finalization — Universal Finalization (§19).
 *
 * Every execution-ending path invokes the same ten-step protocol. This module
 * is the pure contract algebra: terminal-treatment disposition per stop
 * reason, the quiescence definition, the ten-step reduction, and the narrow
 * post-terminal exception (authenticated accounting settlement). It never
 * claims physical fencing — quiescence proof requires the qualified runtime
 * boundary (IB-01); absent that attestation every success-path reduction
 * reports quiescence as NOT proven and the outcome as non-successful
 * unresolved execution.
 *
 * PRD references: §19 (Universal Finalization), §7 (FINALIZING → TERMINAL),
 * §21 (truthful reduction).
 */

const { TerminalResult } = require('./records.js');

const FINALIZATION_STATUS = Object.freeze({
  COMPLETE: 'COMPLETE',                 // quiescence proven + truthful reduction + publication ordering (success gate only)
  UNRESOLVED_EXECUTION: 'UNRESOLVED_EXECUTION', // fencing/quiescence NOT established; resources not reusable
});

/** Reason every finalization must record one of (TerminalResult values). */
const VALID_STOP_REASONS = new Set(Object.values(TerminalResult));

/**
 * §19 terminal treatment table. Each ending path gets its required handling.
 * @param {string} stopReason — TerminalResult value (§19 table)
 * @returns {object} disposition facts for this stop reason
 */
function terminalTreatment(stopReason) {
  if (!VALID_STOP_REASONS.has(stopReason)) {
    return { known: false, successors: null, problems: [`unknown stop reason "${stopReason}" (fail closed)`] };
  }
  switch (stopReason) {
    case TerminalResult.COMPLETE:
      return {
        known: true, successGate: true, publishesExactFrozen: true,
        preserves: ['mandatory PASS', 'exact frozen identity'],
        fencesOrReconciles: false, endsIncarnation: false,
        note: 'retire authority, prove quiescence, preserve all mandatory PASS, publish the exact frozen identity',
      };
    case TerminalResult.COMPLETE_WITH_LIMITATION:
      return {
        known: true, successGate: true, publishesExactFrozen: true,
        preserves: ['mandatory PASS', 'exact frozen identity'],
        fencesOrReconciles: false, endsIncarnation: false,
        note: 'same success gate; remaining limitations are optional or explicitly outside contract',
      };
    case TerminalResult.FAILED:
      return {
        known: true, successGate: false, publishesExactFrozen: false,
        preserves: ['baseline', 'evidence', 'accepted payloads'],
        fencesOrReconciles: true, endsIncarnation: false,
        note: 'fence/reconcile; preserve baseline, evidence, and previously accepted payloads',
      };
    case TerminalResult.BLOCKED:
      return {
        known: true, successGate: false, publishesExactFrozen: false,
        preserves: ['evidence'], fencesOrReconciles: true, endsIncarnation: true,
        note: 'end incarnation; no usable parked authority',
      };
    case TerminalResult.NEEDS_USER:
      return {
        known: true, successGate: false, publishesExactFrozen: false,
        preserves: ['evidence'], fencesOrReconciles: false, endsIncarnation: true,
        note: 'end incarnation; later continuation requires new admission',
      };
    case TerminalResult.CANCELLED:
      return {
        known: true, successGate: false, publishesExactFrozen: false,
        preserves: ['user state', 'evidence'], fencesOrReconciles: true,
        endsIncarnation: false,
        note: 'close new work and stop all admitted reachable effect paths',
      };
    case TerminalResult.SAFETY_STOP:
      return {
        known: true, successGate: false, publishesExactFrozen: false,
        preserves: ['evidence'], fencesOrReconciles: true, endsIncarnation: false,
        note: 'fail closed, preserve evidence, fence or quarantine',
      };
    case TerminalResult.BUDGET_EXHAUSTED:
      return {
        known: true, successGate: false, publishesExactFrozen: false,
        preserves: ['obligations', 'caps'], fencesOrReconciles: true,
        endsIncarnation: false,
        note: 'use protected finalization capacity; do not skip obligations or exceed caps',
      };
    case TerminalResult.UNRESOLVED_EXECUTION:
      return {
        known: true, successGate: false, publishesExactFrozen: false,
        preserves: ['evidence', 'resources'], fencesOrReconciles: true,
        endsIncarnation: false,
        note: 'quiescence is not established and resources are not reusable',
      };
    default:
      // Fail closed on any unhandled terminal result.
      return { known: false, successors: null, problems: [`no treatment for stop reason "${stopReason}"`] };
  }
}

/**
 * §19 quiescence — no admitted actor can still mutate the candidate, accepted
 * payload, protected user state, authoritative evidence, or reusable task
 * resources, and no late execution result can be committed.
 *
 * FAIL CLOSED: proof MUST rely on the qualified runtime boundary and its
 * complete effect closure. A cancel acknowledgement, quiet log, parent exit,
 * PID list, or permission change ALONE is insufficient.
 *
 * @param {object} opts
 * @param {boolean} opts.noAdmittedMutatorRemaining
 * @param {boolean} opts.noLateResultCommittable
 * @param {boolean} opts.reproducedByQualifiedRuntimeBoundary — the effect
 *   closure was established by the qualified runtime boundary (IB-01)
 * @returns {{ ok: boolean, problems: string[] }}
 */
function quiescenceConditions({
  noAdmittedMutatorRemaining,
  noLateResultCommittable,
  reproducedByQualifiedRuntimeBoundary,
}) {
  const problems = [];
  if (noAdmittedMutatorRemaining !== true) problems.push('an admitted actor can still mutate candidate/accepted payload/protected state/evidence/reusable resources');
  if (noLateResultCommittable !== true) problems.push('a late execution result can still be committed');
  if (reproducedByQualifiedRuntimeBoundary !== true) {
    problems.push('quiescence proof does not rely on the qualified runtime boundary and its complete effect closure (IB-01)');
  }
  return { ok: problems.length === 0, problems };
}

/**
 * §19 ten-step protocol reduced over durable facts. Every ending path invokes
 * the SAME protocol. The reduction is truthful: for a success gate, quiescence
 * must be proven AND the §20 immutable publication ordering completed BEFORE
 * success is committed. If fencing cannot be established, the result is a
 * non-successful `UNRESOLVED_EXECUTION`.
 *
 * @param {object} opts
 * @returns {{ status: string, terminalResult: string, publishes: boolean,
 *            quiescenceProven: boolean, unresolved: boolean, problems: string[] }}
 */
function reduceFinalization({
  stopReason,
  admissionClosed,           // step 2 — atomically close task admission at the execution gate
  authorityRetired,          // step 3 — retire authority + unredeemed grants
  fencingEstablished,        // step 5 — qualified termination/fencing fallback applied
  reconciliationComplete,    // step 6 — partial effects, handles, descendants, outstanding actions, ownership, liabilities
  quarantineAppliedForUnresolved, // step 8 — every affected unresolved mutable resource
  truthfulResultReduced,     // step 9
  publicationOrderingComplete,    // step 10 — §20 success ordering before committing success
  quiescenceProven,          // step 7 — or unresolvedExecution = true
}) {
  const treatment = terminalTreatment(stopReason);
  const problems = [];
  if (!treatment.known) return { status: FINALIZATION_STATUS.UNRESOLVED_EXECUTION, terminalResult: TerminalResult.UNRESOLVED_EXECUTION, publishes: false, quiescenceProven: false, unresolved: true, problems: treatment.problems };

  // Steps 2–6 are mandatory on EVERY path.
  if (admissionClosed !== true) problems.push('task admission was not atomically closed at the execution gate');
  if (authorityRetired !== true) problems.push('incarnation task-execution authority was not durably retired (unredeemed grants unredeemed)');
  if (fencingEstablished !== true) problems.push('qualified termination/fencing fallback was not applied');
  if (reconciliationComplete !== true) problems.push('partial effects, open handles, descendant scope, outstanding actions, resource ownership, or liabilities were not reconciled');

  const isSuccessGate = treatment.successGate === true;
  const requiresQuiescence = isSuccessGate;
  const quiescenceOk = requiresQuiescence === false || quiescenceProven === true;

  if (requiresQuiescence && quiescenceProven !== true) {
    problems.push('quiescence is not proven for a success-gate stop reason (resources MUST NOT be claimed reusable)');
  }
  if (requiresQuiescence && publicationOrderingComplete !== true) {
    problems.push('§20 immutable publication ordering was not completed before committing success');
  }
  if (quarantineAppliedForUnresolved !== true) {
    problems.push('every affected unresolved mutable resource was not quarantined');
  }

  // Step 7 alternative: fencing impossible ⇒ non-successful unresolved execution.
  if (requiresQuiescence && !quiescenceOk) {
    return {
      status: FINALIZATION_STATUS.UNRESOLVED_EXECUTION,
      terminalResult: TerminalResult.UNRESOLVED_EXECUTION,
      publishes: false,
      quiescenceProven: false,
      unresolved: true,
      problems,
    };
  }

  // Non-success paths without quiescence are still UNRESOLVED_EXECUTION.
  if (!requiresQuiescence && quiescenceProven !== true && fencingEstablished !== true) {
    problems.unshift('fencing cannot be established: result is non-successful unresolved execution');
    return {
      status: FINALIZATION_STATUS.UNRESOLVED_EXECUTION,
      terminalResult: TerminalResult.UNRESOLVED_EXECUTION,
      publishes: false,
      quiescenceProven: false,
      unresolved: true,
      problems,
    };
  }

  if (problems.length > 0) {
    return {
      status: FINALIZATION_STATUS.UNRESOLVED_EXECUTION,
      terminalResult: stopReason,
      publishes: false,
      quiescenceProven: quiescenceProven === true,
      unresolved: true,
      problems,
    };
  }

  return {
    status: FINALIZATION_STATUS.COMPLETE,
    terminalResult: stopReason,
    publishes: treatment.publishesExactFrozen === true && publicationOrderingComplete === true && quiescenceProven === true,
    quiescenceProven: quiescenceProven === true,
    unresolved: false,
    problems,
  };
}

/**
 * §19/post-terminal — the NARROW exception. Only authenticated accounting
 * settlement may follow the terminal reduction, and it cannot reopen execution,
 * import evidence, mutate a candidate, or upgrade assurance. Anything else
 * arriving after the terminal is a late payload and MUST be rejected.
 *
 * @param {object} opts
 * @param {boolean} opts.afterTerminal
 * @param {boolean} opts.authenticatedAccountingSettlement — narrow post-terminal exception
 * @param {boolean} opts.reopensExecution
 * @param {boolean} opts.importsEvidence
 * @param {boolean} opts.mutatesCandidate
 * @param {boolean} opts.upgradesAssurance
 * @returns {{ allowed: boolean, problems: string[] }}
 */
function latePayloadAllowed({
  afterTerminal,
  authenticatedAccountingSettlement,
  reopensExecution,
  importsEvidence,
  mutatesCandidate,
  upgradesAssurance,
}) {
  const problems = [];
  if (afterTerminal !== true) return { allowed: true, problems }; // pre-terminal payload is a normal execution result
  if (authenticatedAccountingSettlement !== true) {
    problems.push('a payload arriving after the terminal reduction is late unless it is an authenticated accounting settlement');
  }
  if (reopensExecution === true) problems.push('post-terminal payload reopens execution');
  if (importsEvidence === true) problems.push('post-terminal payload imports evidence');
  if (mutatesCandidate === true) problems.push('post-terminal payload mutates a candidate');
  if (upgradesAssurance === true) problems.push('post-terminal payload upgrades assurance');
  return { allowed: problems.length === 0, problems };
}

module.exports = {
  FINALIZATION_STATUS,
  VALID_STOP_REASONS,
  terminalTreatment,
  quiescenceConditions,
  reduceFinalization,
  latePayloadAllowed,
};