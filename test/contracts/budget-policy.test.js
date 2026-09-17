'use strict';
/**
 * test/contracts/budget-policy.test.js
 *
 * Verifies IB-03 Budget Policy and resource ledger contracts.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_RESOURCE_DIMENSIONS,
  validateBudgetPolicy,
  createStandardLedger,
  calculateMandatoryReserve,
} = require('../../src/contracts/budget-policy.js');
const { admitDiscretionary, settle } = require('../../src/contracts/budget.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const POLICY_PATH = path.join(REPO_ROOT, 'docs', 'budget', 'BUDGET-POLICY-V1.json');

function run(t, group) {
  group('IB-03 Budget Policy & Resource Ledger');

  t('policy manifest exists and validates cleanly', () => {
    assert.strictEqual(fs.existsSync(POLICY_PATH), true);
    const raw = fs.readFileSync(POLICY_PATH, 'utf8');
    const manifest = JSON.parse(raw);
    assert.strictEqual(manifest.document_type, 'BUDGET_POLICY_V1');
    assert.strictEqual(manifest.resolved_for_blocker, 'IB-03');

    const validation = validateBudgetPolicy({
      schemaVersion: manifest.schema_version,
      dimensions: manifest.dimensions,
    });
    assert.strictEqual(validation.valid, true);
    assert.strictEqual(validation.problems.length, 0);
  });

  t('default dimensions define all 5 required resources with valid ceilings', () => {
    const dims = ['actions', 'tokens', 'wall_clock_ms', 'file_bytes_written', 'child_processes'];
    for (const d of dims) {
      const spec = DEFAULT_RESOURCE_DIMENSIONS[d];
      assert.ok(spec, `Missing dimension: ${d}`);
      assert.ok(spec.hardLimit > 0);
      assert.ok(spec.protectedFuture >= 0);
      assert.ok(spec.protectedFuture <= spec.hardLimit);
    }
  });

  t('createStandardLedger creates functional ledger enforcing additive conservation', () => {
    let ledger = createStandardLedger();
    assert.ok(ledger.dimensions.actions);
    assert.ok(ledger.dimensions.tokens);
    assert.ok(ledger.dimensions.wall_clock_ms);

    // Test admission against action budget
    const admitted = admitDiscretionary(ledger, 'actions', 'act-01', 5);
    assert.strictEqual(admitted.admitted, true);
    ledger = admitted.ledger;

    // Settling releases reservation and updates settled usage
    const settled = settle(ledger, 'actions', 'act-01', 2);
    assert.strictEqual(settled.settled, true);
    assert.strictEqual(settled.ledger.dimensions.actions.settled, 2);
  });

  t('calculateMandatoryReserve computes expected portions', () => {
    const verifyActions = calculateMandatoryReserve('actions', 'VERIFICATION');
    assert.strictEqual(verifyActions, 5); // 50% of 10

    const fencingMs = calculateMandatoryReserve('wall_clock_ms', 'FENCING_DRAIN');
    assert.strictEqual(fencingMs, 18000); // 30% of 60000
  });
}

module.exports = run;
