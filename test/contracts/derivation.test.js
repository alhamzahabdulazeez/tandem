'use strict';
/**
 * Tests for src/contracts/derivation.js — §16 verification-derivation reducer.
 * Asserts the full status lattice and FAIL-CLOSED guards: no frozen generation;
 * stale/foreign runs rejected; envelope gaps; bounded-capture gaps; outside
 * comparison; authoritative-vs-supporting; IB-01 qualification.
 */

const assert = require('node:assert');
const REC = require('../../src/contracts/records.js');
const D = require('../../src/contracts/derivation.js');

const CID = 'sha256:' + 'a'.repeat(64);
const OTHER_CID = 'sha256:' + 'b'.repeat(64);

function frozen(generationId, over) {
  const g = REC.createGeneration({ generationId, taskId: 'task-1', incarnationId: 'inc-1' });
  g.state = REC.GenerationState.FROZEN;
  g.treeDigest = CID;
  g.createOnceIdentity = `ci1:${'b'.repeat(64)}`;
  g.baselineIdentity = 'commit:' + 'c'.repeat(40);
  g.barrier1ClosedAt = '2026-09-15T09:00:00.000Z';
  g.retention = { start: '2026-09-15T00:00:00.000Z', expiry: '2026-10-15T00:00:00.000Z' };
  if (over) Object.assign(g, over);
  return g;
}

/** A full, fully-attested observer run — everything the §16 envelope requires. */
function completeRun(over) {
  const g = REC.createObserverRun({
    runId: 'run-1',
    incarnationId: 'inc-1',
    obligationId: 'obl-1',
    candidateIdentity: { generationId: 'gen-1', treeDigest: CID },
    qualification: { qualified: true, name: 'protected-native-observer', version: '1' },
    launch: {
      entrypoint: 'bin/tandem.cjs',
      sourceRoot: '/contained/frozen/gen-1',
      runtimeIdentity: 'node@26.0.0-qualified',
      resolutionScope: 'closed:npm-lock@sha256:' + 'd'.repeat(64),
      envCluster: 'cluster:A',
      installedDependencyBytes: true,
      cachesDisabled: true,
      configParentIncluded: true,
    },
    captured: {
      stdoutBytes: 4096, stderrBytes: 1024, exitSignal: 0, timeoutSignal: false,
      completionFacts: { wallMs: 1200, startedAt: '2026-09-15T09:00:01.000Z', endedAt: '2026-09-15T09:00:02.200Z' },
      truncationState: 'NONE',
    },
    comparedOutsideExecution: true,
    classification: 'authoritative',
    observationPath: 'protected/evidence/obs-1.json',
    attestedAt: '2026-09-15T09:00:03.000Z',
  });
  if (over) Object.assign(g, over);
  return g;
}

module.exports = function run(t, group) {
  group('derivation: MISSING — no proof');

  t('no records at all => MISSING', () => {
    const r = D.deriveState({ records: [] });
    assert.strictEqual(r.status, D.DerivationStatus.MISSING);
    assert.strictEqual(r.frozenGenerationId, null);
  });

  t('no frozen generation => MISSING, derivation against a live tree is not actual derivation', () => {
    const r = D.deriveState({ records: [completeRun()] });
    assert.strictEqual(r.status, D.DerivationStatus.MISSING);
    assert.ok(r.reasons[0].includes('no frozen generation'));
  });

  t('frozen generation but no observer run => MISSING', () => {
    const r = D.deriveState({ records: [frozen('gen-1')] });
    assert.strictEqual(r.status, D.DerivationStatus.MISSING);
    assert.strictEqual(r.observers, 0);
  });

  t('a run for a DIFFERENT frozen generation is stale (tree digest mismatch) and yields MISSING', () => {
    const stale = completeRun({ candidateIdentity: { generationId: 'gen-9', treeDigest: OTHER_CID } });
    const r = D.deriveState({ records: [frozen('gen-1'), stale] });
    assert.strictEqual(r.status, D.DerivationStatus.MISSING);
    assert.ok(r.reasons.some((x) => x.includes('stale/foreign')));
  });

  group('derivation: observerApplies stale-reuse guard');

  t('observerApplies rejects a run bound to a different generation id', () => {
    const g = REC.createObserverRun({ runId: 'r', incarnationId: 'i', obligationId: 'o', candidateIdentity: { generationId: 'other', treeDigest: CID } });
    const a = D.observerApplies({ run: g, frozenGeneration: frozen('gen-1') });
    assert.strictEqual(a.applies, false);
  });

  t('observerApplies rejects a run whose tree digest differs from the frozen one', () => {
    const g = REC.createObserverRun({ runId: 'r', incarnationId: 'i', obligationId: 'o', candidateIdentity: { generationId: 'gen-1', treeDigest: OTHER_CID } });
    const a = D.observerApplies({ run: g, frozenGeneration: frozen('gen-1') });
    assert.strictEqual(a.applies, false);
    assert.ok(a.reason.includes('stale or foreign'));
  });

  t('observerApplies accepts an exact-match run', () => {
    const a = D.observerApplies({ run: completeRun(), frozenGeneration: frozen('gen-1') });
    assert.strictEqual(a.applies, true);
  });

  group('derivation: envelope gaps => INCONCLUSIVE');

  t('launch missing the pinned runtime identity => INCONCLUSIVE with envelope reasons', () => {
    const run = completeRun({ launch: { ...completeRun().launch, runtimeIdentity: null } });
    const r = D.deriveState({ records: [frozen('gen-1'), run] });
    assert.strictEqual(r.status, D.DerivationStatus.INCONCLUSIVE);
    assert.ok(r.envelopeMissing.includes('pinned runtime/toolchain identity'));
  });

  t('caches not disabled => input closure not established => INCONCLUSIVE', () => {
    const run = completeRun({ launch: { ...completeRun().launch, cachesDisabled: false } });
    const r = D.deriveState({ records: [frozen('gen-1'), run] });
    assert.strictEqual(r.status, D.DerivationStatus.INCONCLUSIVE);
    assert.ok(r.reasons[0].includes('envelope incomplete'));
  });

  t('null launch with only baseline identity => INCONCLUSIVE with all root/identity gaps', () => {
    const run = completeRun({ launch: null });
    const r = D.deriveState({ records: [frozen('gen-1'), run] });
    assert.strictEqual(r.status, D.DerivationStatus.INCONCLUSIVE);
    assert.ok(r.envelopeMissing.includes('actual source root / entrypoint'));
    assert.ok(r.envelopeMissing.includes('excluded caches'));
  });

  group('derivation: bounded capture gates');

  t('unbounded/unknown truncation => INCONCLUSIVE (§16.4)', () => {
    const run = completeRun({ captured: { ...completeRun().captured, truncationState: 'UNKNOWN' } });
    const r = D.deriveState({ records: [frozen('gen-1'), run] });
    assert.strictEqual(r.status, D.DerivationStatus.INCONCLUSIVE);
  });

  t('missing completion facts => INCONCLUSIVE', () => {
    const run = completeRun({ captured: { ...completeRun().captured, completionFacts: null } });
    const r = D.deriveState({ records: [frozen('gen-1'), run] });
    assert.strictEqual(r.status, D.DerivationStatus.INCONCLUSIVE);
  });

  t('captureBounded accepts a bounded TRUNCATED_BOUNDED capture (truncation known and bounded)', () => {
    const c = D.captureBounded({ stdoutBytes: 100, stderrBytes: 50, exitSignal: 0, timeoutSignal: false, completionFacts: {}, truncationState: 'TRUNCATED_BOUNDED' });
    assert.strictEqual(c.ok, true);
  });

  t('captureBounded rejects an absent capture and unknown truncation', () => {
    assert.strictEqual(D.captureBounded(null).ok, false);
    assert.strictEqual(D.captureBounded({ stdoutBytes: 1, stderrBytes: 1, exitSignal: 0, timeoutSignal: false, completionFacts: {}, truncationState: 'WHATEVER' }).ok, false);
  });

  group('derivation: comparison outside candidate execution');

  t('comparison performed inside candidate execution => INCONCLUSIVE (§16.5)', () => {
    const run = completeRun({ comparedOutsideExecution: false });
    const r = D.deriveState({ records: [frozen('gen-1'), run] });
    assert.strictEqual(r.status, D.DerivationStatus.INCONCLUSIVE);
  });

  group('derivation: supporting vs authoritative');

  t('observer writes only supporting (candidate-authored) reports => INCONCLUSIVE, never ESTABLISHED', () => {
    const run = completeRun({ classification: 'supporting' });
    const r = D.deriveState({ records: [frozen('gen-1'), run] });
    assert.strictEqual(r.status, D.DerivationStatus.INCONCLUSIVE);
    assert.ok(r.reasons[0].includes('supporting only'));
  });

  t('authoritative observation outside protected path => INCONCLUSIVE (§16.6)', () => {
    const run = completeRun({ observationPath: '/tmp/forgeable/obs.json' });
    const r = D.deriveState({ records: [frozen('gen-1'), run] });
    assert.strictEqual(r.status, D.DerivationStatus.INCONCLUSIVE);
  });

  group('derivation: qualification (IB-01)');

  t('structurally complete but qualification unattested => UNQUALIFIED (IB-01)', () => {
    const run = completeRun({ qualification: null });
    const r = D.deriveState({ records: [frozen('gen-1'), run] });
    assert.strictEqual(r.status, D.DerivationStatus.UNQUALIFIED);
    assert.ok(r.reasons[0].includes('IB-01'));
  });

  t('qualification present but not qualified => UNQUALIFIED, never ESTABLISHED', () => {
    const run = completeRun({ qualification: { qualified: false, name: 'observer', version: '1' } });
    const r = D.deriveState({ records: [frozen('gen-1'), run] });
    assert.strictEqual(r.status, D.DerivationStatus.UNQUALIFIED);
  });

  group('derivation: ESTABLISHED');

  t('a qualified, bounded, authoritative, outside-compared observation of the exact frozen generation => ESTABLISHED', () => {
    const r = D.deriveState({ records: [frozen('gen-1'), completeRun()] });
    assert.strictEqual(r.status, D.DerivationStatus.ESTABLISHED);
    assert.strictEqual(r.frozenGenerationId, 'gen-1');
    assert.strictEqual(r.observers, 1);
    assert.strictEqual(r.reasons.length, 0);
  });

  t('multiple applying runs with mixed qualification => INCONCLUSIVE, not ESTABLISHED', () => {
    const q = completeRun({ runId: 'run-a' });
    const u = completeRun({ runId: 'run-b', qualification: { qualified: false, name: 'other', version: '1' } });
    const r = D.deriveState({ records: [frozen('gen-1'), q, u] });
    assert.strictEqual(r.status, D.DerivationStatus.INCONCLUSIVE);
  });

  group('derivation: validator cross-field honesty (§16/§17)');

  t('an authoritative run without an attested qualified observer is rejected by validateRecord', () => {
    const { validateRecord } = require('../../src/contracts/validate.js');
    const bad = completeRun({ qualification: null });
    const v = validateRecord(bad);
    assert.strictEqual(v.valid, false);
    assert.ok(v.problems.some((p) => p.includes('IB-01')));
  });

  t('an authoritative run requires comparison outside execution and an observation path', () => {
    const { validateRecord } = require('../../src/contracts/validate.js');
    const v = validateRecord(completeRun({ comparedOutsideExecution: false }));
    assert.strictEqual(v.valid, false);
    const v2 = validateRecord(completeRun({ observationPath: null }));
    assert.strictEqual(v2.valid, false);
  });
};