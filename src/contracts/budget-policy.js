'use strict';
/**
 * budget-policy — Concrete resource policy and dimensions for PRD §12 and IB-03.
 *
 * Implements concrete hard limits, protected future allocations, and policy validation
 * for the Tandem execution lifecycle.
 */

const { createLedger } = require('./budget.js');

const DEFAULT_RESOURCE_DIMENSIONS = Object.freeze({
  actions: Object.freeze({
    dimension: 'actions',
    hardLimit: 50,
    protectedFuture: 10,
    softTarget: 30,
    estimated: 15,
  }),
  tokens: Object.freeze({
    dimension: 'tokens',
    hardLimit: 1000000,
    protectedFuture: 200000,
    softTarget: 600000,
    estimated: 250000,
  }),
  wall_clock_ms: Object.freeze({
    dimension: 'wall_clock_ms',
    hardLimit: 600000, // 10 minutes
    protectedFuture: 60000, // 1 minute
    softTarget: 300000,
    estimated: 120000,
  }),
  file_bytes_written: Object.freeze({
    dimension: 'file_bytes_written',
    hardLimit: 10485760, // 10 MB
    protectedFuture: 1048576, // 1 MB
    softTarget: 5242880,
    estimated: 102400,
  }),
  child_processes: Object.freeze({
    dimension: 'child_processes',
    hardLimit: 100,
    protectedFuture: 20,
    softTarget: 50,
    estimated: 10,
  }),
});

function validateBudgetPolicy(policy) {
  const problems = [];
  if (!policy || typeof policy !== 'object') {
    return { valid: false, problems: ['Budget policy must be a non-null object'] };
  }

  if (policy.schemaVersion !== '1.0.0') {
    problems.push(`Unsupported schemaVersion: ${policy.schemaVersion}`);
  }

  if (!policy.dimensions || typeof policy.dimensions !== 'object') {
    problems.push('Budget policy must define dimensions map');
    return { valid: false, problems };
  }

  const requiredDimensions = ['actions', 'tokens', 'wall_clock_ms', 'file_bytes_written', 'child_processes'];
  for (const dim of requiredDimensions) {
    const d = policy.dimensions[dim];
    if (!d) {
      problems.push(`Missing required dimension: ${dim}`);
      continue;
    }
    if (typeof d.hardLimit !== 'number' || d.hardLimit <= 0 || !Number.isFinite(d.hardLimit)) {
      problems.push(`Dimension ${dim} has invalid hardLimit: ${d.hardLimit}`);
    }
    if (typeof d.protectedFuture !== 'number' || d.protectedFuture < 0 || !Number.isFinite(d.protectedFuture)) {
      problems.push(`Dimension ${dim} has invalid protectedFuture: ${d.protectedFuture}`);
    }
    if (d.protectedFuture > d.hardLimit) {
      problems.push(`Dimension ${dim} protectedFuture (${d.protectedFuture}) exceeds hardLimit (${d.hardLimit})`);
    }
  }

  return {
    valid: problems.length === 0,
    problems,
  };
}

function createStandardLedger(policy = { dimensions: DEFAULT_RESOURCE_DIMENSIONS }) {
  const specs = Object.values(policy.dimensions);
  return createLedger(specs);
}

function calculateMandatoryReserve(dimension, operationType) {
  const dim = DEFAULT_RESOURCE_DIMENSIONS[dimension];
  if (!dim) {
    throw new Error(`Unknown dimension: ${dimension}`);
  }
  switch (operationType) {
    case 'VERIFICATION':
      return Math.floor(dim.protectedFuture * 0.5);
    case 'TERMINAL_RECORDING':
      return Math.floor(dim.protectedFuture * 0.2);
    case 'FENCING_DRAIN':
      return Math.floor(dim.protectedFuture * 0.3);
    default:
      return 0;
  }
}

module.exports = {
  DEFAULT_RESOURCE_DIMENSIONS,
  validateBudgetPolicy,
  createStandardLedger,
  calculateMandatoryReserve,
};
