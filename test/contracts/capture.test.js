'use strict';
/**
 * Tests for src/contracts/capture.js — source-capture algebra (§11):
 * readiness lattice, §11 rejection rules, inclusion/exclusion normalization.
 */

const assert = require('node:assert');
const CAP = require('../../src/contracts/capture.js');
const REC = require('../../src/contracts/records.js');
const { validateRecord } = require('../../src/contracts/validate.js');

function qualifiedCapture(overrides) {
  const rules = { include: [], exclude: [], excludeDirty: true };
  const integrity = {
    objectIdentitiesVerified: true,
    treeEnumerationComplete: true,
    independentRetentionEstablished: true,
  };
  const base = REC.createSourceCapture({
    captureId: 'cap-1',
    incarnationId: 'inc-1',
    commitIdentity: 'a'.repeat(40),
  });
  base.baselineManifestIdentity = 'sha256:' + 'b'.repeat(64);
  base.rules = rules;
  base.integrity = integrity;
  base.reader = { qualified: true, name: 'test-reader', version: 1 };
  return Object.assign(base, overrides || {});
}

module.exports = function run(t, group) {
  group('capture: readiness lattice (READY requires a qualified reader)');

  t('a fully verified capture with a qualified reader is READY', () => {
    const r = CAP.captureReadiness(qualifiedCapture());
    assert.strictEqual(r.status, 'READY');
    assert.strictEqual(r.reason, null);
  });

  t('a structurally perfect record WITHOUT a qualified reader is UNQUALIFIED, not READY', () => {
    const rec = qualifiedCapture({ reader: null });
    const r = CAP.captureReadiness(rec);
    assert.strictEqual(r.status, 'UNQUALIFIED');
    assert.ok(r.reason.includes('IB-01'));
  });

  t('an unqualified reader that claims verification is UNQUALIFIED (claim not honored)', () => {
    const rec = qualifiedCapture({ reader: { qualified: false, name: 'plain git' } });
    const r = CAP.captureReadiness(rec);
    assert.strictEqual(r.status, 'UNQUALIFIED');
  });

  t('a missing record or wrong kind fails closed to NOT_READY', () => {
    assert.strictEqual(CAP.captureReadiness(undefined).status, 'NOT_READY');
    assert.strictEqual(CAP.captureReadiness({ kind: 'action' }).status, 'NOT_READY');
    assert.strictEqual(CAP.captureReadiness(null).status, 'NOT_READY');
  });

  t('a branch name or short hash is NOT an accepted source identity', () => {
    const rec = qualifiedCapture({ commitIdentity: 'main' });
    const r = CAP.captureReadiness(rec);
    assert.strictEqual(r.status, 'NOT_READY');
    assert.ok(r.problems.some((p) => p.includes('branch')));
  });

  t('missing baseline manifest identity or integrity checks block readiness', () => {
    const noManifest = qualifiedCapture({ baselineManifestIdentity: null });
    assert.strictEqual(CAP.captureReadiness(noManifest).status, 'NOT_READY');

    const noTree = qualifiedCapture({ integrity: { objectIdentitiesVerified: true, treeEnumerationComplete: false, independentRetentionEstablished: true } });
    const r = CAP.captureReadiness(noTree);
    assert.strictEqual(r.status, 'NOT_READY');
    assert.ok(r.problems.some((p) => p.includes('treeEnumerationComplete')));
  });

  t('missing excludeDirty declaration blocks readiness (§11 step 2)', () => {
    const rec = qualifiedCapture({ rules: { include: [], exclude: [], excludeDirty: false } });
    assert.ok(CAP.captureReadiness(rec).problems.some((p) => p.includes('excludeDirty')));
  });

  group('capture: §11 rejection rules');

  t('each §11 rejection produces UNSUPPORTED, never READY', () => {
    for (const key of Object.keys(CAP.REJECT_RULES)) {
      const rec = qualifiedCapture({ rejections: { [key]: true } });
      const r = CAP.captureReadiness(rec);
      assert.strictEqual(r.status, 'UNSUPPORTED', `${key} must be UNSUPPORTED`);
      assert.ok(r.reason.includes(key), r.reason);
    }
  });

  t('a single gitlink (submodule) is unsupported even when everything else is clean', () => {
    const rec = qualifiedCapture({ rejections: { gitlink: true } });
    assert.strictEqual(CAP.captureReadiness(rec).status, 'UNSUPPORTED');
  });

  group('capture: inclusion/exclusion normalization');

  t('normalizeRules canonicalizes paths and strips unsafe forms', () => {
    const r = CAP.normalizeRules({
      include: ['src/', 'README.md', '../escape', '/abs', 'C:\\\\win'],
      exclude: ['dist/', 'data.csv'],
      excludeDirty: true,
    });
    assert.ok(r.include.prefixes['src/']);
    assert.ok(r.include.exact['README.md']);
    assert.ok(!r.include.exact['../escape'] && !r.include.exact['/abs'] && !r.include.exact['C:/win']);
    assert.ok(r.exclude.prefixes['dist/']);
    assert.ok(r.exclude.exact['data.csv']);
    assert.strictEqual(r.conflict, false);
  });

  t('a path selected by include AND excluded is a conflict (fail closed)', () => {
    const r = CAP.normalizeRules({ include: ['vendor/'], exclude: ['vendor/'], excludeDirty: true });
    assert.strictEqual(r.conflict, true);
    assert.deepStrictEqual(r.conflicts, ['vendor/']);
  });

  t('includeDecision: exclusion wins over inclusion; no-include means commit-defined scope', () => {
    const rules = CAP.normalizeRules({ include: ['src/'], exclude: ['src/secret.txt'], excludeDirty: true });
    assert.ok(CAP.includeDecision('src/a.js', rules).included);
    assert.ok(!CAP.includeDecision('src/secret.txt', rules).included);
    assert.ok(!CAP.includeDecision('README.md', rules).included);

    const whole = CAP.normalizeRules({ include: [], exclude: ['dist/'], excludeDirty: true });
    assert.ok(CAP.includeDecision('README.md', whole).included);
    assert.ok(!CAP.includeDecision('dist/bundle.js', whole).included);
  });

  t('unsafe paths are never included', () => {
    const rules = CAP.normalizeRules({ include: [], exclude: [], excludeDirty: true });
    for (const bad of ['/etc/passwd', '../sneak', '..\\win', '\u0000']) {
      assert.strictEqual(CAP.includeDecision(bad, rules).included, false, bad);
    }
  });

  t('buildBaselineManifest records excluded entries explicitly, never as captured', () => {
    const rules = CAP.normalizeRules({ include: [], exclude: ['dist/'], excludeDirty: true });
    const m = CAP.buildBaselineManifest({
      paths: ['src/a.js', 'dist/bundle.js', '.git/HEAD'],
      manifestIdentity: 'x'.repeat(64),
      rules,
    });
    assert.deepStrictEqual(m.included.map((e) => e.path), ['src/a.js']);
    assert.strictEqual(m.excluded.length, 2);
    assert.ok(m.excluded.some((e) => e.path === 'dist/bundle.js' && e.reason.includes('excluded')));
  });

  t('manifest digest is deterministic over sorted included paths', () => {
    const rules = CAP.normalizeRules({ include: [], exclude: [], excludeDirty: true });
    const a = CAP.manifestDigest(['b', 'a', 'c'], 'base-id', rules);
    const b = CAP.manifestDigest(['a', 'b', 'c'], 'base-id', rules);
    assert.strictEqual(a, b);
    const c = CAP.manifestDigest(['a', 'b', 'c'], 'other-id', rules);
    assert.notStrictEqual(a, c);
  });

  group('capture: record schema conformance');

  t('source_capture record validates through the schema validator', () => {
    const rec = qualifiedCapture();
    const v = validateRecord(rec);
    assert.strictEqual(v.valid, true, JSON.stringify(v.problems));
  });

  t('validateRecord fails closed on a malformed capture record', () => {
    const v = validateRecord({ kind: 'source_capture', captureId: 'cap-x' });
    assert.strictEqual(v.valid, false);
    assert.ok(v.problems.some((p) => p.includes('commitIdentity')));
  });
};