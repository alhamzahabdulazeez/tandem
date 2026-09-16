'use strict';
/**
 * State machine definitions for TANDEM's task lifecycle.
 *
 * Implements the phase transitions (§7), action lifecycle transitions (§7),
 * generation mutation transitions (§7), and policy stage transitions (§8).
 *
 * PRD reference: §7 (State Machine), §8 (Admission Policy)
 */

const {
  TaskPhase,
  ActionLifecycle,
  ActionDispatch,
  ActionExecution,
  UseAllowance,
  GenerationState,
  PolicyStage,
  TerminalResult,
  LIVE_PHASES,
  TERMINAL_PHASES,
  NON_SUCCESS_RESULTS,
} = require('./records.js');

// ---------------------------------------------------------------------------
// Phase transitions (§7, Table: Normal phase transitions)
// ---------------------------------------------------------------------------

/**
 * Allowed phase transitions with their required conditions.
 * Key: current phase, Value: { next: phase, requires: description }[]
 */
const PHASE_TRANSITIONS = Object.freeze({
  [TaskPhase.RECEIVED]: [
    { next: TaskPhase.AUDITING,
      requires: 'Exclusive owner, durable incarnation, restrictive policy, source selection, allocation established' },
    { next: TaskPhase.FINALIZING,
      requires: 'Cancellation or unresolvable condition before auditing begins' },
  ],
  [TaskPhase.AUDITING]: [
    { next: TaskPhase.PLANNING,
      requires: 'Source/profile suitability established; required facts available' },
    { next: TaskPhase.FINALIZING,
      requires: 'Source unsuitable, safety event, or cancellation' },
  ],
  [TaskPhase.PLANNING]: [
    { next: TaskPhase.READY,
      requires: 'Intent and complete inventory admitted; supported obligations fixed; acceptance meaning frozen; boundaries sufficient' },
    { next: TaskPhase.FINALIZING,
      requires: 'Consequential ambiguity, cancellation, or insufficient capacity' },
  ],
  [TaskPhase.READY]: [
    { next: TaskPhase.EXECUTING,
      requires: 'Initial implementation action admitted under current authority' },
    { next: TaskPhase.FINALIZING,
      requires: 'Cancellation, safety event, or admission closure' },
  ],
  [TaskPhase.EXECUTING]: [
    { next: TaskPhase.VERIFYING,
      requires: 'Implementation proposes completion; mutation closes; mutators drained/fenced; generation frozen' },
    { next: TaskPhase.FINALIZING,
      requires: 'Cancellation, safety event, budget exhaustion, or disconnect' },
  ],
  [TaskPhase.VERIFYING]: [
    { next: TaskPhase.REPAIRING,
      requires: 'Concrete applicable repairable failure; unused repair allowance; resources sufficient' },
    { next: TaskPhase.FINALIZING,
      requires: 'All obligations pass, no repairable failure, stop condition, or cancellation' },
  ],
  [TaskPhase.REPAIRING]: [
    { next: TaskPhase.VERIFYING,
      requires: 'New disposable generation completed, closed, reconciled, and frozen' },
    { next: TaskPhase.FINALIZING,
      requires: 'Repair failed, resources exhausted, or cancellation' },
  ],
  [TaskPhase.FINALIZING]: [
    { next: TaskPhase.TERMINAL,
      requires: 'Universal finalization and truthful reduction completed' },
  ],
  [TaskPhase.TERMINAL]: [],
});

// ---------------------------------------------------------------------------
// Action lifecycle transitions (§7, Action model)
// ---------------------------------------------------------------------------

const ACTION_LIFECYCLE_TRANSITIONS = Object.freeze({
  [ActionLifecycle.PROPOSED]: [
    { next: ActionLifecycle.ADMITTED, requires: 'Policy check passes; admission gate serializes release' },
    { next: ActionLifecycle.REFUSED, requires: 'Policy check fails; action denied' },
  ],
  [ActionLifecycle.ADMITTED]: [
    { next: ActionLifecycle.OBSERVING, requires: 'Action dispatched; execution begins' },
    { next: ActionLifecycle.SETTLED, requires: 'Post-dispatch reconciliation' },
  ],
  [ActionLifecycle.OBSERVING]: [
    { next: ActionLifecycle.RECONCILING, requires: 'Execution result received; reconciliation begins' },
  ],
  [ActionLifecycle.RECONCILING]: [
    { next: ActionLifecycle.SETTLED, requires: 'Reconciliation complete; liability resolved' },
  ],
  [ActionLifecycle.REFUSED]: [],
  [ActionLifecycle.SETTLED]: [],
});

// ---------------------------------------------------------------------------
// Generation mutation transitions (§7)
// ---------------------------------------------------------------------------

const GENERATION_TRANSITIONS = Object.freeze({
  [GenerationState.MUTABLE]: [
    { next: GenerationState.MUTATION_CLOSED, requires: 'Implementation proposes completion; all mutators drained' },
  ],
  [GenerationState.MUTATION_CLOSED]: [
    { next: GenerationState.FROZEN, requires: 'Frozen bytes materialized under create-once identity' },
  ],
  [GenerationState.FROZEN]: [],
});

// ---------------------------------------------------------------------------
// Policy stage transitions (§8)
// ---------------------------------------------------------------------------

const POLICY_STAGE_TRANSITIONS = Object.freeze({
  [PolicyStage.PROPOSED]: [
    { next: PolicyStage.AUTHORIZED, requires: 'Authenticated user or pre-authorized policy approves' },
  ],
  [PolicyStage.AUTHORIZED]: [
    { next: PolicyStage.EFFECTIVE, requires: 'Serialized durable admission gate processes' },
  ],
  [PolicyStage.EFFECTIVE]: [
    { next: PolicyStage.ENFORCED, requires: 'Enforcement mechanisms activated' },
    { next: PolicyStage.FENCED, requires: 'Narrowing or revocation; affected actors reconciled' },
  ],
  [PolicyStage.ENFORCED]: [
    { next: PolicyStage.FENCED, requires: 'Revocation or narrowing' },
  ],
  [PolicyStage.FENCED]: [],
});

// ---------------------------------------------------------------------------
// Transition validation functions
// ---------------------------------------------------------------------------

/**
 * Check whether a phase transition is allowed.
 * @param {string} current — current TaskPhase
 * @param {string} next — desired next TaskPhase
 * @returns {{ allowed: boolean, requires?: string, reason?: string }}
 */
function canTransitionPhase(current, next) {
  const transitions = PHASE_TRANSITIONS[current];
  if (!transitions) {
    return { allowed: false, reason: `Unknown current phase: ${current}` };
  }
  const found = transitions.find((t) => t.next === next);
  if (!found) {
    return { allowed: false, reason: `No transition from ${current} to ${next}` };
  }
  return { allowed: true, requires: found.requires };
}

/**
 * Check whether an action lifecycle transition is allowed.
 * @param {string} current
 * @param {string} next
 * @returns {{ allowed: boolean, requires?: string, reason?: string }}
 */
function canTransitionAction(current, next) {
  const transitions = ACTION_LIFECYCLE_TRANSITIONS[current];
  if (!transitions) {
    return { allowed: false, reason: `Unknown action lifecycle: ${current}` };
  }
  const found = transitions.find((t) => t.next === next);
  if (!found) {
    return { allowed: false, reason: `No transition from ${current} to ${next}` };
  }
  return { allowed: true, requires: found.requires };
}

/**
 * Check whether a generation mutation transition is allowed.
 * @param {string} current
 * @param {string} next
 * @returns {{ allowed: boolean, requires?: string, reason?: string }}
 */
function canTransitionGeneration(current, next) {
  const transitions = GENERATION_TRANSITIONS[current];
  if (!transitions) {
    return { allowed: false, reason: `Unknown generation state: ${current}` };
  }
  const found = transitions.find((t) => t.next === next);
  if (!found) {
    return { allowed: false, reason: `No transition from ${current} to ${next}` };
  }
  return { allowed: true, requires: found.requires };
}

/**
 * Check whether a policy stage transition is allowed.
 * @param {string} current
 * @param {string} next
 * @returns {{ allowed: boolean, requires?: string, reason?: string }}
 */
function canTransitionPolicy(current, next) {
  const transitions = POLICY_STAGE_TRANSITIONS[current];
  if (!transitions) {
    return { allowed: false, reason: `Unknown policy stage: ${current}` };
  }
  const found = transitions.find((t) => t.next === next);
  if (!found) {
    return { allowed: false, reason: `No transition from ${current} to ${next}` };
  }
  return { allowed: true, requires: found.requires };
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/**
 * Determine if a phase is live (not terminal).
 * @param {string} phase
 * @returns {boolean}
 */
function isLivePhase(phase) {
  return LIVE_PHASES.has(phase);
}

/**
 * Determine if a phase is terminal.
 * @param {string} phase
 * @returns {boolean}
 */
function isTerminalPhase(phase) {
  return phase === TaskPhase.TERMINAL;
}

/**
 * Get all possible next phases from a given phase.
 * @param {string} phase
 * @returns {string[]}
 */
function possibleNextPhases(phase) {
  const transitions = PHASE_TRANSITIONS[phase];
  if (!transitions) return [];
  return transitions.map((t) => t.next);
}

/**
 * Get the normal expected next phase for a successful flow.
 * Returns null if no single "happy path" exists.
 * @param {string} phase
 * @returns {string|null}
 */
function happyPathNext(phase) {
  const happyOrder = [
    TaskPhase.RECEIVED,
    TaskPhase.AUDITING,
    TaskPhase.PLANNING,
    TaskPhase.READY,
    TaskPhase.EXECUTING,
    TaskPhase.VERIFYING,
    TaskPhase.FINALIZING,
    TaskPhase.TERMINAL,
  ];
  const idx = happyOrder.indexOf(phase);
  if (idx < 0 || idx >= happyOrder.length - 1) return null;
  const next = happyOrder[idx + 1];
  const result = canTransitionPhase(phase, next);
  return result.allowed ? next : null;
}

/**
 * Check whether a terminal result is a non-successful outcome.
 * @param {string} result
 * @returns {boolean}
 */
function isNonSuccess(result) {
  return NON_SUCCESS_RESULTS.has(result);
}

/**
 * Validate that the one-way generation transition cannot reverse.
 * MUTABLE -> MUTATION_CLOSED -> FROZEN
 * A frozen or mutation-closed generation MUST NOT return to MUTABLE.
 * @param {string} current
 * @param {string} next
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateGenerationOneWay(current, next) {
  const order = [GenerationState.MUTABLE, GenerationState.MUTATION_CLOSED, GenerationState.FROZEN];
  const ci = order.indexOf(current);
  const ni = order.indexOf(next);
  if (ci < 0) return { valid: false, reason: `Unknown generation state: ${current}` };
  if (ni < 0) return { valid: false, reason: `Unknown generation state: ${next}` };
  if (ni <= ci) {
    return { valid: false, reason: `Generation transition ${current} -> ${next} violates one-way constraint` };
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Transition tables
  PHASE_TRANSITIONS,
  ACTION_LIFECYCLE_TRANSITIONS,
  GENERATION_TRANSITIONS,
  POLICY_STAGE_TRANSITIONS,

  // Validation
  canTransitionPhase,
  canTransitionAction,
  canTransitionGeneration,
  canTransitionPolicy,
  validateGenerationOneWay,

  // Queries
  isLivePhase,
  isTerminalPhase,
  possibleNextPhases,
  happyPathNext,
  isNonSuccess,
};
