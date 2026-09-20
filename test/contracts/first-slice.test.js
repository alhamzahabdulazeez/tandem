'use strict';
/**
 * test/contracts/first-slice.test.js
 *
 * Verifies IB-02 First-Slice Fixture integrity, cryptographic digests, and manifest.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FIXTURE_DIR = path.join(REPO_ROOT, 'test', 'fixtures', 'first-slice');
const MANIFEST_PATH = path.join(REPO_ROOT, 'docs', 'fixtures', 'FIXTURE-MANIFEST-V1.json');
const TASK_SPEC_PATH = path.join(REPO_ROOT, 'docs', 'fixtures', 'FIRST-SLICE-TASK.md');

function run(t, group) {
  group('IB-02 First-Slice Fixture & Manifest');

  t('manifest file exists and parses as valid JSON', () => {
    assert.strictEqual(fs.existsSync(MANIFEST_PATH), true);
    const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
    const manifest = JSON.parse(raw);
    assert.strictEqual(manifest.document_type, 'FIXTURE_MANIFEST_V1');
    assert.strictEqual(manifest.resolved_for_blocker, 'IB-02');
    assert.strictEqual(manifest.fixture_id, 'tandem-first-slice-fixture-v1');
  });

  t('task specification document exists and is non-empty', () => {
    assert.strictEqual(fs.existsSync(TASK_SPEC_PATH), true);
    const spec = fs.readFileSync(TASK_SPEC_PATH, 'utf8');
    assert.ok(spec.includes('FIRST_SLICE_TASK_SPEC_V1'));
    assert.ok(spec.includes('IB-02'));
  });

  t('all files declared in manifest match their exact SHA-256 digests and byte lengths', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    assert.ok(Array.isArray(manifest.baseline.files));
    assert.strictEqual(manifest.baseline.files.length, 4);

    for (const fileEntry of manifest.baseline.files) {
      const fullPath = path.join(FIXTURE_DIR, fileEntry.path);
      assert.strictEqual(fs.existsSync(fullPath), true, `File missing: ${fileEntry.path}`);
      const buf = fs.readFileSync(fullPath);
      const computedSha = crypto.createHash('sha256').update(buf).digest('hex');
      assert.strictEqual(
        computedSha,
        fileEntry.sha256,
        `SHA-256 mismatch on ${fileEntry.path}`
      );
      assert.strictEqual(
        buf.length,
        fileEntry.bytes,
        `Byte length mismatch on ${fileEntry.path}`
      );
    }
  });

  t('fixture package.json declares zero external dependencies', () => {
    const pkgPath = path.join(FIXTURE_DIR, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    assert.strictEqual(pkg.dependencies, undefined);
    assert.strictEqual(pkg.devDependencies, undefined);
    assert.strictEqual(pkg.type, 'commonjs');
  });
}

module.exports = run;
