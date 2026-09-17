'use strict';
/**
 * test/contracts/frozen-protocol.test.js
 *
 * Verifies IB-04 22-field canonical frozen evaluation protocol manifest.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const {
  PROTOCOL_FIELDS,
  validateProtocol,
  freezeProtocol,
  computeProtocolDigest,
} = require('../../src/contracts/measurement.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PROTOCOL_PATH = path.join(REPO_ROOT, 'docs', 'measurement', 'FROZEN-PROTOCOL-V1.json');

function run(t, group) {
  group('IB-04 Frozen Evaluation Protocol');

  t('protocol manifest exists and parses as valid JSON', () => {
    assert.strictEqual(fs.existsSync(PROTOCOL_PATH), true);
    const raw = fs.readFileSync(PROTOCOL_PATH, 'utf8');
    const manifest = JSON.parse(raw);
    assert.strictEqual(manifest.document_type, 'FROZEN_EVALUATION_PROTOCOL_V1');
    assert.strictEqual(manifest.resolved_for_blocker, 'IB-04');
    assert.strictEqual(manifest.schema_version, '1.0.0');
  });

  t('protocol manifest contains all 22 required canonical fields', () => {
    const raw = fs.readFileSync(PROTOCOL_PATH, 'utf8');
    const manifest = JSON.parse(raw);

    assert.strictEqual(PROTOCOL_FIELDS.length, 22);
    for (const field of PROTOCOL_FIELDS) {
      assert.ok(
        manifest[field] !== undefined && manifest[field] !== null,
        `Missing required protocol field: ${field}`
      );
    }
  });

  t('validateProtocol accepts manifest cleanly with zero problems', () => {
    const raw = fs.readFileSync(PROTOCOL_PATH, 'utf8');
    const manifest = JSON.parse(raw);
    const validation = validateProtocol(manifest);
    assert.strictEqual(validation.valid, true);
    assert.deepStrictEqual(validation.problems, []);
  });

  t('freezeProtocol successfully creates immutable protocol record with sha256 digest', () => {
    const raw = fs.readFileSync(PROTOCOL_PATH, 'utf8');
    const manifest = JSON.parse(raw);
    const result = freezeProtocol(manifest, {
      frozenAt: '2026-09-17T16:30:00.000Z',
      authorIdentity: 'tandem-release-owner',
    });

    assert.strictEqual(result.frozen, true);
    assert.ok(result.protocolRecord);
    assert.strictEqual(result.protocolRecord.kind, 'evaluation_protocol');
    assert.strictEqual(typeof result.protocolRecord.protocolDigest, 'string');
    assert.strictEqual(result.protocolRecord.protocolDigest.length, 64);
    assert.strictEqual(result.protocolRecord.protocolId, `ep-${result.protocolRecord.protocolDigest.slice(0, 16)}`);
    assert.strictEqual(result.problems.length, 0);

    // Verify deterministic digest computation matches
    const manualDigest = computeProtocolDigest(manifest);
    assert.strictEqual(result.protocolRecord.protocolDigest, manualDigest);
  });

  t('all-started-task denominator is strictly enforced', () => {
    const raw = fs.readFileSync(PROTOCOL_PATH, 'utf8');
    const manifest = JSON.parse(raw);

    // Invalid manifest with success-only denominator fails
    const invalidManifest = { ...manifest, all_started_task_denominator: 'success_only tasks' };
    const invalidValidation = validateProtocol(invalidManifest);
    assert.strictEqual(invalidValidation.valid, false);
    assert.ok(invalidValidation.problems.some(p => p.includes('all_started_task_denominator')));
  });
}

module.exports = run;
