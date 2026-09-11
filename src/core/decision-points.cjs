'use strict';
/**
 * Decision points — the core mechanism.
 *
 * Published measurement motivates this: verification targeted at development decision
 * points outperforms end-point-only verification. Every mainstream agent verifies at the
 * end; this module verifies at five points derived from events.
 *
 * Every point is DERIVED FROM AN EVENT. No model decides when to verify.
 */

/** @typedef {'DP1_EDIT'|'DP2_IMPORT'|'DP3_DEPENDENTS'|'DP4_FAILURE'|'DP5_FINISH'} DecisionPoint */

const ALL = Object.freeze(['DP1_EDIT', 'DP2_IMPORT', 'DP3_DEPENDENTS', 'DP4_FAILURE', 'DP5_FINISH']);

/** A strong model rarely makes the type slips DP1 catches; skipping it saves latency. */
const SPARSE = Object.freeze(['DP2_IMPORT', 'DP3_DEPENDENTS', 'DP5_FINISH']);

const DESCRIPTIONS = Object.freeze({
  DP1_EDIT: 'after every write or edit — type-check the edited file',
  DP2_IMPORT: 'before a symbol imported for the first time this session — reject unresolved',
  DP3_DEPENDENTS: 'before editing a file that others import — type-check the importers',
  DP4_FAILURE: 'after a gate fails — diagnose under a repair bound',
  DP5_FINISH: 'before finishing — full gates plus regression check',
});

function activePoints(density) {
  return density === 'sparse' ? SPARSE.slice() : ALL.slice();
}

/**
 * Which decision points an event triggers. Pure: same input, same output, no I/O.
 *
 * @param {object} event
 * @param {'write'|'edit'|'read'|'bash'|'search'|'turn_end'|'gate_failed'} event.kind
 * @param {string} [event.file]              path relative to the project root
 * @param {string[]} [event.newImports]      imports not seen earlier this session
 * @param {number} [event.dependentCount]    files importing event.file
 * @param {number} [event.toolCallsInTurn]
 * @param {object} opts
 * @param {'dense'|'sparse'} opts.density
 * @param {number} opts.dependentThreshold
 * @returns {DecisionPoint[]}
 */
function pointsFor(event, opts) {
  const active = new Set(activePoints(opts.density));
  const out = [];
  const mutating = event.kind === 'write' || event.kind === 'edit';

  if (event.kind === 'gate_failed' && active.has('DP4_FAILURE')) out.push('DP4_FAILURE');

  if (mutating) {
    // DP3 runs before the edit; DP2 before the imports resolve; DP1 after.
    if (active.has('DP3_DEPENDENTS') && (event.dependentCount || 0) >= opts.dependentThreshold) {
      out.push('DP3_DEPENDENTS');
    }
    if (active.has('DP2_IMPORT') && (event.newImports || []).length > 0) {
      out.push('DP2_IMPORT');
    }
    if (active.has('DP1_EDIT')) out.push('DP1_EDIT');
  }

  // Task completion is derived, never inferred from prose.
  if (event.kind === 'turn_end' && event.toolCallsInTurn === 0 && active.has('DP5_FINISH')) {
    out.push('DP5_FINISH');
  }
  return out;
}

module.exports = { ALL, SPARSE, DESCRIPTIONS, activePoints, pointsFor };
