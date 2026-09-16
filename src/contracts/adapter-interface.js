'use strict';
/**
 * Adapter interface contract.
 *
 * TANDEM is a supervisory layer above a coding agent (§2). The ADAPTER is a
 * *thin* integration with the one pinned coding agent and inference path that
 * "Translate[s] proposals, observations, model/tool requests, errors,
 * cancellation, and accounting without granting authority" (§4).
 *
 * This module defines the CONTRACT an adapter must satisfy. It contains no
 * host-specific code — the actual qualified adapter can only be written and
 * tested once IB-01 (a Gate-0-qualified agent/inference profile) is resolved.
 *
 * The interface is intentionally narrow and authority-free:
 * - It exposes translated events, not execution grants.
 * - It never mutates task state, policy, evidence, or acceptance.
 * - Every method returns plain values; no side effects on trusted store.
 */

/** Adapter contract version — bump on breaking interface changes. */
const ADAPTER_CONTRACT_VERSION = 1;

/**
 * Shape each adapter implementation must expose. Not a strict runtime class
 * (adapters may be functions or objects); this is the validation contract.
 *
 * @typedef {object} AdapterInterface
 * @property {string} identity — pinned agent identity, e.g. "pi-agent-core@0.85.1"
 * @property {number} contractVersion — must equal ADAPTER_CONTRACT_VERSION
 * @property {(event: object) => object} translate — translate a raw agent/tool
 *   event into a neutral TANDEM event (read/write/edit/bash kind).
 * @property {(event: object) => boolean} isMutating — whether a neutral event
 *   represents a mutation (write/edit).
 * @property {(reason: string) => object} cancel — produce a cancellation note
 *   for an admitted action. MUST NOT claim effects it cannot prove.
 * @property {(obs: object) => object} toObservation — wrap an execution
 *   observation (stdout/stderr/exit/timeout) for the evidence record.
 */

/**
 * Validate that a candidate adapter object satisfies the interface.
 * Pure function — no host loading, no side effects.
 *
 * @param {object} candidate
 * @returns {{ valid: boolean, problems: string[] }}
 */
function validateAdapterInterface(candidate) {
  const problems = [];
  if (candidate === null || typeof candidate !== 'object') {
    return { valid: false, problems: ['adapter must be an object'] };
  }
  if (typeof candidate.identity !== 'string' || candidate.identity.length === 0) {
    problems.push('adapter.identity must be a non-empty string');
  }
  if (candidate.contractVersion !== ADAPTER_CONTRACT_VERSION) {
    problems.push(`adapter.contractVersion must be ${ADAPTER_CONTRACT_VERSION}`);
  }
  for (const method of ['translate', 'isMutating', 'cancel', 'toObservation']) {
    if (typeof candidate[method] !== 'function') {
      problems.push(`adapter.${method} must be a function`);
    }
  }
  return { valid: problems.length === 0, problems };
}

/**
 * Neutral event kinds TANDEM recognises.
 */
const EVENT_KINDS = Object.freeze({
  READ: 'read',
  WRITE: 'write',
  EDIT: 'edit',
  BASH: 'bash',
  TURN_END: 'turn_end',
  GATE_FAILED: 'gate_failed',
});

/**
 * Rank-order of tool kinds by increasing effect scope.
 * Used for static admission checks (an edit is more powerful than a read).
 */
const EFFECT_SCOPE_ORDER = Object.freeze(['read', 'bash', 'write', 'edit']);

/**
 * Return the relative effect scope of two kinds.
 * @param {string} a
 * @param {string} b
 * @returns {-1|0|1} negative if a < b in scope, 0 equal, positive if a > b
 */
function compareEffectScope(a, b) {
  const ia = EFFECT_SCOPE_ORDER.indexOf(a);
  const ib = EFFECT_SCOPE_ORDER.indexOf(b);
  const va = ia < 0 ? EFFECT_SCOPE_ORDER.length : ia;
  const vb = ib < 0 ? EFFECT_SCOPE_ORDER.length : ib;
  return Math.sign(va - vb);
}

/**
 * Whether a neutral event kind is a mutation.
 * @param {string} kind
 * @returns {boolean}
 */
function isMutatingKind(kind) {
  return kind === EVENT_KINDS.WRITE || kind === EVENT_KINDS.EDIT;
}

module.exports = {
  ADAPTER_CONTRACT_VERSION,
  EVENT_KINDS,
  EFFECT_SCOPE_ORDER,
  validateAdapterInterface,
  compareEffectScope,
  isMutatingKind,
};