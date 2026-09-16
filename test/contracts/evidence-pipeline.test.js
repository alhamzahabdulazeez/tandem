'use strict';
/**
 * Tests for the §23 Evidence Pipeline foundation (Unit 16).
 *
 * Covers:
 *   - src/contracts/evidence-pipeline.js — total outcomes, applicability key,
 *     evidence admission (fail closed), valid-failure preservation, obligation
 *     + pipeline reduction, coherence-domain integration helper.
 *   - durable record support: records.js createEvidenceRecord /
 *     createEvidenceInvalidation / createFinalization(terminalTime), validate.js
 *     validators, and RECORD_ID_FIELDS identity folding.
 *   - §19/§23 additive finalization.terminalTime.
 *   - durability / round-trip: evidence + evidence_invalidation + terminalTime
 *     records survive the real append-only journal store across reopen,
 *     snapshot deletion, duplicate refusal, and tamper fail-closed.
 *
 * FAIL-CLOSED invariants under test: no partial outcomes; no silent overwrite
 * of an applicable FAIL; malformed / stale / wrong-generation / late /
 * non-applicable evidence is never admitted; recording evidence grants no
 * authority; invalidated evidence never qualifies as authoritative.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const R = require('../../src/contracts/records.js');
const V = require('../../src/contracts/validate.js');
const EV = require('../../src/contracts/evidence.js');
const P = require('../../src/contracts/evidence-pipeline.js');
const STATE = require('../../src/control/state.cjs');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A complete §17 envelope — every field non-null except the explicit none. */
function completeEnvelope() {
  const env = {};
  for (const f of EV.ENVELOPE_FIELDS) env[f] = `binding:${f}`;
  // artifactDerivationIfApplicable is truthfully null for a no-derivation slice
  // (absence is still a gap, §17); envelopeComplete accepts an explicit null.
  env.artifactDerivationIfApplicable = null;
  // A truthful, bounded capture: the §23 reduction must not see a placeholder.
  env.completionTimeoutSignalAndTruncationState = 'NONE';
  return env;
}

function sliceBinding(over) {
  return Object.assign({
    generationId: 'gen-1',
    obligationId: 'obl-1',
    acceptanceContractDigest: 'sha256:' + 'a'.repeat(64),
    effectivePolicyRevision: 'pol-1@rev-0',
    qualifiedProfileDigest: 'sha256:' + 'b'.repeat(64),
    selectedSourceBaseline: 'sha256:' + 'c'.repeat(64),
    exactCandidateGenerationAndTreeDigest: 'tree:' + 'd'.repeat(64),
    requirementObligationAndPredicateIdentity: 'rq:obl-1:pred-3',
    predicateVersionParametersAndExpectedValues: 'pred-3@v1:{expectedExit:0}',
  }, over || {});
}

/** A valid, fully-applicable PASS evidence record for the gen-1/obl-1 slice. */
function makeEvidence(over) {
  const rec = R.createEvidenceRecord({
    evidenceId: 'ev-1',
    obligationId: 'obl-1',
    generationId: 'gen-1',
    outcome: 'PASS',
    envelope: completeEnvelope(),
    observationPath: 'protected/evidence/ev-1.json',
    applicabilityKey: P.computeApplicabilityKey(sliceBinding()),
    capturedAt: 1700000000000,
    classification: 'supporting',
  });
  return Object.assign({}, rec, over || {});
}

/** The admission context for the gen-1/obl-1 slice. */
function admitCtx(over) {
  return Object.assign({
    activeGenerationId: 'gen-1',
    expectedApplicabilityKey: P.computeApplicabilityKey(sliceBinding()),
    taskFinalized: false,
  }, over || {});
}

function dir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-u16-')); }
function tear(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

module.exports = function run(t, group) {
  group('§23 evidence outcomes — total enumeration');

  t('EvidenceOutcome is exactly the four total outcomes, never partial', () => {
    assert.deepStrictEqual(
      Object.values(P.EvidenceOutcome).sort(),
      ['PASS', 'FAIL', 'MISSING', 'INCONCLUSIVE'].sort());
    assert.strictEqual(P.EvidenceOutcome.PASS, 'PASS');
  });

  t('NON_PASS_OUTCOMES is exactly the three outcomes that cannot certify', () => {
    assert.deepStrictEqual(
      [...P.NON_PASS_OUTCOMES].sort(),
      ['FAIL', 'MISSING', 'INCONCLUSIVE'].sort());
  });

  t('InvalidationReason is deterministic and structural — never preference', () => {
    for (const r of [
      'KEY_MISMATCH', 'GENERATION_RETIRED', 'SUPERSEDED',
      'ENVELOPE_INCOMPLETE', 'POST_FINALIZATION',
    ]) {
      assert.strictEqual(P.InvalidationReason[r], r, r);
    }
  });

  group('computeApplicabilityKey — deterministic slice identity');

  t('same binding always yields the same key', () => {
    assert.strictEqual(
      P.computeApplicabilityKey(sliceBinding()),
      P.computeApplicabilityKey(sliceBinding()));
  });

  t('each of the nine slice-identity fields changes the key', () => {
    const base = sliceBinding();
    const fields = Object.keys(base);
    assert.ok(fields.length >= 9, 'applicability key must bind the full §14/§17 slice identity');
    for (const f of fields) {
      const tweaked = Object.assign({}, base);
      tweaked[f] = `${base[f]}-other`;
      assert.notStrictEqual(
        P.computeApplicabilityKey(tweaked),
        P.computeApplicabilityKey(base),
        `flipping ${f} must change the applicability key`);
    }
  });

  t('evidence from an older generation gets a different key (stale-reuse guard)', () => {
    assert.notStrictEqual(
      P.computeApplicabilityKey(sliceBinding({ generationId: 'gen-0' })),
      P.computeApplicabilityKey(sliceBinding()));
  });

  t('a missing binding field is normalized to null and stays deterministic', () => {
    const partial = { generationId: 'gen-1' };
    assert.strictEqual(P.computeApplicabilityKey(partial), P.computeApplicabilityKey(partial));
    assert.notStrictEqual(
      P.computeApplicabilityKey(partial),
      P.computeApplicabilityKey(sliceBinding()));
  });

  t('computeApplicabilityKey fails closed on a non-object binding', () => {
    assert.throws(() => P.computeApplicabilityKey(null), /binding must be an object/);
    assert.throws(() => P.computeApplicabilityKey('key'), /binding must be an object/);
  });

  group('admitEvidence — fail-closed admission');

  t('a PASS with matching generation, key, and complete envelope is admitted', () => {
    const r = P.admitEvidence(makeEvidence(), admitCtx());
    assert.strictEqual(r.admitted, true);
    assert.strictEqual(r.reason, null);
    assert.strictEqual(r.invalidationReason, null);
  });

  t('admission grants NO authority, budget, or execution permission (§23 req 9)', () => {
    const r = P.admitEvidence(makeEvidence(), admitCtx());
    // The admission result is a statement about evidence only — it must not
    // carry any grant surface. (The pure reducer has no such fields at all.)
    assert.deepStrictEqual(
      Object.keys(r).sort(),
      ['admitted', 'invalidationReason', 'reason']);
  });

  t('a partial or unknown outcome is never admitted', () => {
    for (const bad of ['GREEN', 'PARTIAL', 'PASSED', '', null, undefined]) {
      const r = P.admitEvidence(makeEvidence({ outcome: bad }), admitCtx());
      assert.strictEqual(r.admitted, false, bad);
      assert.match(r.reason, /invalid outcome/);
    }
  });

  t('evidence captured for a different generation is refused (GENERATION_RETIRED)', () => {
    const r = P.admitEvidence(makeEvidence({ generationId: 'gen-0' }), admitCtx());
    assert.strictEqual(r.admitted, false);
    assert.strictEqual(r.invalidationReason, P.InvalidationReason.GENERATION_RETIRED);
    assert.match(r.reason, /does not match active generation/);
  });

  t('evidence arriving after task finalization is refused (POST_FINALIZATION)', () => {
    const r = P.admitEvidence(makeEvidence(), admitCtx({ taskFinalized: true }));
    assert.strictEqual(r.admitted, false);
    assert.strictEqual(r.invalidationReason, P.InvalidationReason.POST_FINALIZATION);
  });

  t('no active generation => admission refused (nothing to certify)', () => {
    const r = P.admitEvidence(makeEvidence(), {});
    assert.strictEqual(r.admitted, false);
    assert.match(r.reason, /no active generation/);
  });

  t('an applicability-key mismatch is refused (KEY_MISMATCH)', () => {
    const r = P.admitEvidence(makeEvidence({ applicabilityKey: 'sha256:' + '0'.repeat(64) }), admitCtx());
    assert.strictEqual(r.admitted, false);
    assert.strictEqual(r.invalidationReason, P.InvalidationReason.KEY_MISMATCH);
  });

  t('an incomplete §17 envelope is refused (ENVELOPE_INCOMPLETE)', () => {
    const env = completeEnvelope();
    delete env.provenance; // drop one mandatory field
    const r = P.admitEvidence(makeEvidence({ envelope: env }), admitCtx());
    assert.strictEqual(r.admitted, false);
    assert.strictEqual(r.invalidationReason, P.InvalidationReason.ENVELOPE_INCOMPLETE);
    assert.match(r.reason, /envelope missing "provenance"/);
  });

  t('missing evidence / malformed context fails closed without throwing', () => {
    const none = P.admitEvidence(null, admitCtx());
    assert.strictEqual(none.admitted, false);
    assert.match(none.reason, /no evidence record/);
  });

  group('supersessionBlocked — valid-failure preservation (§23 req 5)');

  t('a later PASS may NOT silently overwrite an applicable FAIL (same key)', () => {
    const existing = makeEvidence({ outcome: 'FAIL' });
    const incoming = makeEvidence({ evidenceId: 'ev-2', outcome: 'PASS' });
    assert.strictEqual(P.supersessionBlocked(existing, incoming), 'valid-failure preservation: a later PASS may not erase an applicable FAIL');
  });

  t('supersession IS permitted when no applicable FAIL exists yet', () => {
    const existing = makeEvidence({ outcome: 'PASS' });
    const incoming = makeEvidence({ evidenceId: 'ev-2', outcome: 'PASS' });
    assert.strictEqual(P.supersessionBlocked(existing, incoming), null);
    assert.strictEqual(P.supersessionBlocked(null, incoming), null);
  });

  t('an ALREADY-invalidated FAIL no longer blocks structural supersession', () => {
    // The failure was deterministically retired (e.g. generation replaced); the
    // preservation veto applies only to still-applicable failures.
    const existing = makeEvidence({ outcome: 'FAIL', invalidated: true });
    const incoming = makeEvidence({ evidenceId: 'ev-2', outcome: 'PASS' });
    assert.strictEqual(P.supersessionBlocked(existing, incoming), null);
  });

  t('a FAIL against a DIFFERENT applicability key does not block (handled at admission)', () => {
    const existing = makeEvidence({ outcome: 'FAIL', applicabilityKey: 'sha256:' + '1'.repeat(64) });
    const incoming = makeEvidence({ evidenceId: 'ev-2' });
    assert.strictEqual(P.supersessionBlocked(existing, incoming), null);
  });

  group('reduceObligationOutcome — total reduction, fail closed');

  t('no evidence for an obligation reduces to MISSING', () => {
    const r = P.reduceObligationOutcome([]);
    assert.strictEqual(r.outcome, P.EvidenceOutcome.MISSING);
  });

  t('a single PASS reduces to PASS; all-PASS stays PASS', () => {
    assert.strictEqual(P.reduceObligationOutcome([makeEvidence()]).outcome, 'PASS');
    assert.strictEqual(
      P.reduceObligationOutcome([makeEvidence({ evidenceId: 'a' }), makeEvidence({ evidenceId: 'b' })]).outcome,
      'PASS');
  });

  t('any FAIL forces FAIL, even alongside PASS (conflict fails closed)', () => {
    const r = P.reduceObligationOutcome([
      makeEvidence({ evidenceId: 'a', outcome: 'PASS' }),
      makeEvidence({ evidenceId: 'b', outcome: 'FAIL' }),
    ]);
    assert.strictEqual(r.outcome, 'FAIL');
    assert.ok(r.reasons.some((x) => x.includes('conflicting PASS and FAIL')));
  });

  t('INCONCLUSIVE or MISSING evidence (without FAIL) reduces to INCONCLUSIVE', () => {
    assert.strictEqual(
      P.reduceObligationOutcome([makeEvidence({ outcome: 'INCONCLUSIVE' })]).outcome, 'INCONCLUSIVE');
    assert.strictEqual(
      P.reduceObligationOutcome([makeEvidence({ outcome: 'MISSING' })]).outcome, 'INCONCLUSIVE');
    assert.strictEqual(
      P.reduceObligationOutcome([makeEvidence(), makeEvidence({ evidenceId: 'b', outcome: 'INCONCLUSIVE' })]).outcome,
      'INCONCLUSIVE');
  });

  t('an unknown outcome in the store reduces to INCONCLUSIVE (defensive)', () => {
    const r = P.reduceObligationOutcome([makeEvidence({ outcome: 'PASSED' })]);
    assert.strictEqual(r.outcome, 'INCONCLUSIVE');
  });

  t('invalidated evidence is excluded from the reduction', () => {
    // The only remaining active record is a PASS; the FAIL was invalidated.
    const r = P.reduceObligationOutcome([
      makeEvidence({ evidenceId: 'a', outcome: 'FAIL', invalidated: true }),
      makeEvidence({ evidenceId: 'b', outcome: 'PASS' }),
    ]);
    assert.strictEqual(r.outcome, 'PASS');
  });

  t('all evidence invalidated => MISSING (fail closed)', () => {
    const r = P.reduceObligationOutcome([
      makeEvidence({ evidenceId: 'a', invalidated: true }),
    ]);
    assert.strictEqual(r.outcome, 'MISSING');
  });

  group('reducePipeline — pipeline verdict across obligations');

  t('no obligations reduces to MISSING', () => {
    const r = P.reducePipeline({ obligations: [], evidenceRecords: [] });
    assert.strictEqual(r.verdict, 'MISSING');
  });

  t('all obligations PASS => verdict PASS, but supporting-only is not authoritative', () => {
    const r = P.reducePipeline({
      obligations: ['obl-1', 'obl-2'],
      evidenceRecords: [
        makeEvidence({ evidenceId: 'e1', obligationId: 'obl-1' }),
        makeEvidence({ evidenceId: 'e2', obligationId: 'obl-2' }),
      ],
    });
    assert.strictEqual(r.verdict, 'PASS');
    assert.strictEqual(r.authoritative, false, 'candidate-authored evidence alone is never authoritative (§23 req 7)');
    assert.strictEqual(r.byObligation['obl-1'].outcome, 'PASS');
    assert.strictEqual(r.byObligation['obl-2'].outcome, 'PASS');
  });

  t('one failing obligation forces pipeline FAIL', () => {
    const r = P.reducePipeline({
      obligations: ['obl-1', 'obl-2'],
      evidenceRecords: [
        makeEvidence({ evidenceId: 'e1', obligationId: 'obl-1' }),
        makeEvidence({ evidenceId: 'e2', obligationId: 'obl-2', outcome: 'FAIL' }),
      ],
    });
    assert.strictEqual(r.verdict, 'FAIL');
  });

  t('an obligation with NO evidence is MISSING => pipeline INCONCLUSIVE', () => {
    const r = P.reducePipeline({
      obligations: ['obl-1', 'obl-2'],
      evidenceRecords: [makeEvidence({ evidenceId: 'e1', obligationId: 'obl-1' })],
    });
    assert.strictEqual(r.byObligation['obl-2'].outcome, 'MISSING');
    assert.strictEqual(r.verdict, 'INCONCLUSIVE');
  });

  t('INCONCLUSIVE evidence anywhere (no FAIL) => pipeline INCONCLUSIVE', () => {
    const r = P.reducePipeline({
      obligations: ['obl-1'],
      evidenceRecords: [makeEvidence({ outcome: 'INCONCLUSIVE' })],
    });
    assert.strictEqual(r.verdict, 'INCONCLUSIVE');
  });

  t('evidence_invalidation records are honored in the pipeline reduction', () => {
    const inv = R.createEvidenceInvalidation({
      invalidationId: 'inv-1', evidenceId: 'e-fail',
      reason: P.InvalidationReason.SUPERSEDED, supersededById: 'e-new',
    });
    const r = P.reducePipeline({
      obligations: ['obl-1'],
      evidenceRecords: [
        makeEvidence({ evidenceId: 'e-fail', outcome: 'FAIL' }),
        makeEvidence({ evidenceId: 'e-new', outcome: 'PASS' }),
      ],
      invalidations: [inv],
    });
    // The failed item was deterministically superseded by a later record bound
    // to the same key, so the FAIL no longer blocks; only PASS remains.
    assert.strictEqual(r.byObligation['obl-1'].outcome, 'PASS');
    assert.strictEqual(r.verdict, 'PASS');
  });

  t('authoritative is true ONLY for a non-invalidated, observer-qualified authoritative record', () => {
    const auth = makeEvidence({ evidenceId: 'e-auth', classification: 'authoritative', observerQualified: true });
    const ok = P.reducePipeline({ obligations: ['obl-1'], evidenceRecords: [auth] });
    assert.strictEqual(ok.authoritative, true);

    // A forged authoritative label without a qualified-observer stamp is NOT
    // authoritative (Finding B fix — candidate-authored stays supporting).
    const forged = makeEvidence({ evidenceId: 'e-forge', classification: 'authoritative', observerQualified: false });
    assert.strictEqual(P.reducePipeline({ obligations: ['obl-1'], evidenceRecords: [forged] }).authoritative, false);
    assert.strictEqual(V.validateRecord(forged).valid, false);
    assert.ok(V.validateRecord(forged).problems.some((p) => p.includes('requires an attested qualified observer')));

    const inval = R.createEvidenceInvalidation({
      invalidationId: 'inv-1', evidenceId: 'e-auth', reason: P.InvalidationReason.GENERATION_RETIRED,
    });
    const retracted = P.reducePipeline({ obligations: ['obl-1'], evidenceRecords: [auth], invalidations: [inval] });
    assert.strictEqual(retracted.authoritative, false, 'an invalidated record must not remain authoritative');
  });

  group('activeObserverRuns — §21 coherence-domain integration');

  t('returns ONLY observer_run records that are not invalidated', () => {
    const run = (id) => R.createObserverRun({
      runId: id, incarnationId: 'inc-1', obligationId: 'obl-1',
      candidateIdentity: { generationId: 'gen-1', treeDigest: 'sha256:' + 'a'.repeat(64) },
    });
    // evidence record links ev-run1 → run-1 via sourceRunId
    const ev = makeEvidence({ evidenceId: 'ev-run1', sourceRunId: 'run-1' });
    const inval = R.createEvidenceInvalidation({
      invalidationId: 'inv-1', evidenceId: 'ev-run1', reason: P.InvalidationReason.SUPERSEDED,
    });
    const out = P.activeObserverRuns([
      run('run-1'), run('run-2'), inval, ev,
      makeEvidence({ evidenceId: 'ev-1' }),
      { schemaVersion: 1, kind: 'lineage', lineageId: 'ln-1' },
    ]);
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].runId, 'run-2');
  });

  t('returns all runs when no invalidation is present', () => {
    const run = R.createObserverRun({
      runId: 'run-1', incarnationId: 'inc-1', obligationId: 'obl-1',
      candidateIdentity: { generationId: 'gen-1', treeDigest: 'sha256:' + 'a'.repeat(64) },
    });
    const out = P.activeObserverRuns([run]);
    assert.strictEqual(out.length, 1);
  });

  t('an invalidation targeting a non-observer evidence id does not drop observer runs', () => {
    const run = R.createObserverRun({
      runId: 'run-1', incarnationId: 'inc-1', obligationId: 'obl-1',
      candidateIdentity: { generationId: 'gen-1', treeDigest: 'sha256:' + 'a'.repeat(64) },
    });
    // evidenceId 'ev-not-a-run' exists as evidence but links to a different run
    const ev = makeEvidence({ evidenceId: 'ev-not-a-run', sourceRunId: 'run-99' });
    const inval = R.createEvidenceInvalidation({
      invalidationId: 'inv-1', evidenceId: 'ev-not-a-run', reason: P.InvalidationReason.KEY_MISMATCH,
    });
    assert.strictEqual(P.activeObserverRuns([run, inval, ev]).length, 1);
  });

  // Adversarial regression: two-level lookup — invalidation → evidence → observer_run
  t('[REGRESSION] invalidating evidence removes its associated observer_run from coherence domain', () => {
    const run = R.createObserverRun({
      runId: 'run-A', incarnationId: 'inc-1', obligationId: 'obl-1',
      candidateIdentity: { generationId: 'gen-1', treeDigest: 'sha256:' + 'b'.repeat(64) },
    });
    const ev = makeEvidence({ evidenceId: 'ev-A', sourceRunId: 'run-A' });
    const inval = R.createEvidenceInvalidation({
      invalidationId: 'inv-A', evidenceId: 'ev-A', reason: P.InvalidationReason.GENERATION_RETIRED,
    });
    const result = P.activeObserverRuns([run, ev, inval]);
    assert.strictEqual(result.length, 0, 'invalidated run must be absent from coherence domain');
  });

  t('[REGRESSION] unrelated observer_run is NOT removed when a different evidence is invalidated', () => {
    const runA = R.createObserverRun({
      runId: 'run-A', incarnationId: 'inc-1', obligationId: 'obl-1',
      candidateIdentity: { generationId: 'gen-1', treeDigest: 'sha256:' + 'b'.repeat(64) },
    });
    const runB = R.createObserverRun({
      runId: 'run-B', incarnationId: 'inc-1', obligationId: 'obl-2',
      candidateIdentity: { generationId: 'gen-1', treeDigest: 'sha256:' + 'c'.repeat(64) },
    });
    const evA = makeEvidence({ evidenceId: 'ev-A', sourceRunId: 'run-A' });
    const evB = makeEvidence({ evidenceId: 'ev-B', sourceRunId: 'run-B' });
    const inval = R.createEvidenceInvalidation({
      invalidationId: 'inv-A', evidenceId: 'ev-A', reason: P.InvalidationReason.KEY_MISMATCH,
    });
    const result = P.activeObserverRuns([runA, runB, evA, evB, inval]);
    assert.strictEqual(result.length, 1, 'only the invalidated run should be removed');
    assert.strictEqual(result[0].runId, 'run-B', 'unrelated run-B must remain in coherence domain');
  });

  t('[REGRESSION] invalidation with unknown evidenceId does not remove any observer_run (fail-closed)', () => {
    const run = R.createObserverRun({
      runId: 'run-A', incarnationId: 'inc-1', obligationId: 'obl-1',
      candidateIdentity: { generationId: 'gen-1', treeDigest: 'sha256:' + 'b'.repeat(64) },
    });
    const ev = makeEvidence({ evidenceId: 'ev-A', sourceRunId: 'run-A' });
    // invalidation targets an evidenceId that does not exist in the store
    const inval = R.createEvidenceInvalidation({
      invalidationId: 'inv-ghost', evidenceId: 'ev-DOES-NOT-EXIST', reason: P.InvalidationReason.SUPERSEDED,
    });
    const result = P.activeObserverRuns([run, ev, inval]);
    assert.strictEqual(result.length, 1, 'unknown evidenceId must not accidentally remove any run');
    assert.strictEqual(result[0].runId, 'run-A');
  });

  group('durable records: factories, validation, identity folding');

  t('createEvidenceRecord stamps the §23 evidence shape', () => {
    const rec = makeEvidence();
    assert.strictEqual(rec.kind, 'evidence');
    assert.strictEqual(rec.schemaVersion, R.SCHEMA_VERSION);
    assert.strictEqual(rec.invalidated, false);
    assert.strictEqual(rec.invalidationId, null);
  });

  t('createEvidenceInvalidation stamps the §23 evidence_invalidation shape', () => {
    const rec = R.createEvidenceInvalidation({
      invalidationId: 'inv-1', evidenceId: 'ev-1',
      reason: P.InvalidationReason.GENERATION_RETIRED, supersededById: null, invalidatedAt: 1700000000050,
    });
    assert.strictEqual(rec.kind, 'evidence_invalidation');
    assert.strictEqual(rec.schemaVersion, R.SCHEMA_VERSION);
    assert.deepStrictEqual(rec.supersededById, null);
  });

  t('evidence and evidence_invalidation records validate as durable records', () => {
    const ev = makeEvidence();
    const inv = R.createEvidenceInvalidation({
      invalidationId: 'inv-1', evidenceId: 'ev-1', reason: P.InvalidationReason.SUPERSEDED,
    });
    assert.strictEqual(V.validateRecord(ev).valid, true, JSON.stringify(V.validateRecord(ev).problems));
    assert.strictEqual(V.validateRecord(inv).valid, true, JSON.stringify(V.validateRecord(inv).problems));
    assert.strictEqual(V.validateStoreState({ records: [ev, inv] }).valid, true);
  });

  t('authoritative evidence requires a binding applicability key at the store (fail closed)', () => {
    const rec = makeEvidence({ classification: 'authoritative', applicabilityKey: null });
    const v = V.validateRecord(rec);
    assert.strictEqual(v.valid, false);
    assert.ok(v.problems.some((p) => p.includes('requires a non-null applicabilityKey')));
  });

  t('a malformed evidence outcome never validates at the store', () => {
    const rec = makeEvidence({ outcome: 'PASSED' });
    const v = V.validateRecord(rec);
    assert.strictEqual(v.valid, false);
    assert.ok(v.problems.some((p) => p.includes('must be PASS/FAIL/MISSING/INCONCLUSIVE')));
  });

  t('an unknown InvalidationReason never validates at the store', () => {
    const rec = R.createEvidenceInvalidation({
      invalidationId: 'inv-1', evidenceId: 'ev-1', reason: 'MODEL_PREFERRED_IT',
    });
    const v = V.validateRecord(rec);
    assert.strictEqual(v.valid, false);
    assert.ok(v.problems.some((p) => p.includes('must be a known InvalidationReason')));
  });

  t('identity folding: both record kinds have stable store identities', () => {
    assert.strictEqual(V.RECORD_ID_FIELDS.evidence, 'evidenceId');
    assert.strictEqual(V.RECORD_ID_FIELDS.evidence_invalidation, 'invalidationId');
    assert.strictEqual(STATE.recordId(makeEvidence()), 'ev-1');
    assert.strictEqual(
      STATE.recordId(R.createEvidenceInvalidation({ invalidationId: 'inv-1', evidenceId: 'ev-1', reason: P.InvalidationReason.SUPERSEDED })),
      'inv-1');
  });

  t('duplicate evidence identities fail closed in store-state validation', () => {
    const dup = [
      makeEvidence({ evidenceId: 'ev-x' }),
      makeEvidence({ evidenceId: 'ev-x' }),
    ];
    const v = V.validateStoreState({ records: dup });
    assert.strictEqual(v.valid, false);
    assert.ok(v.problems.some((p) => p.includes('duplicate identity "ev-x"')));
  });

  t('duplicate invalidation identities fail closed in store-state validation', () => {
    const dup = [
      R.createEvidenceInvalidation({ invalidationId: 'inv-x', evidenceId: 'a', reason: P.InvalidationReason.SUPERSEDED }),
      R.createEvidenceInvalidation({ invalidationId: 'inv-x', evidenceId: 'b', reason: P.InvalidationReason.SUPERSEDED }),
    ];
    const v = V.validateStoreState({ records: dup });
    assert.strictEqual(v.valid, false);
    assert.ok(v.problems.some((p) => p.includes('duplicate identity "inv-x"')));
  });

  t('evidence and evidence_invalidation fold under separate identity namespaces', () => {
    // The two §23 kinds must never claim the same store identity as each other,
    // so a retraction can never be confused with the evidence it retracts.
    assert.notStrictEqual(V.RECORD_ID_FIELDS.evidence, V.RECORD_ID_FIELDS.evidence_invalidation);
    assert.ok(V.RECORD_ID_FIELDS.evidence === 'evidenceId');
    assert.ok(V.RECORD_ID_FIELDS.evidence_invalidation === 'invalidationId');
  });

  group('§16 truncation fail-closed at reduction (Finding A fix)');

  t('PASS with TRUNCATED_UNBOUNDED is rejected by the store validator', () => {
    const bad = makeEvidence({
      envelope: { ...completeEnvelope(), completionTimeoutSignalAndTruncationState: 'TRUNCATED_UNBOUNDED' },
    });
    assert.strictEqual(V.validateRecord(bad).valid, false);
    assert.ok(V.validateRecord(bad).problems.some((p) => p.includes('PASS requires a bounded capture')));
  });

  t('PASS with TRUNCATED_UNBOUNDED reduces to INCONCLUSIVE, not PASS', () => {
    const truncated = makeEvidence({
      envelope: { ...completeEnvelope(), completionTimeoutSignalAndTruncationState: 'TRUNCATED_UNBOUNDED' },
    });
    const r = P.reduceObligationOutcome([truncated]);
    assert.strictEqual(r.outcome, 'INCONCLUSIVE');
    assert.ok(r.reasons.some((x) => x.includes('truncation') || x.includes('unbounded')));
  });

  t('FAIL with TRUNCATED_UNBOUNDED still reduces to FAIL (fail closed — FAIL dominates)', () => {
    const truncatedFail = makeEvidence({
      outcome: 'FAIL', classification: 'authoritative', observerQualified: true,
      envelope: { ...completeEnvelope(), completionTimeoutSignalAndTruncationState: 'TRUNCATED_UNBOUNDED' },
    });
    assert.strictEqual(P.reduceObligationOutcome([truncatedFail]).outcome, 'FAIL');
  });

  t('TRUNCATED_BOUNDED stays PASS (bounded captures can certify)', () => {
    const bounded = makeEvidence({
      envelope: { ...completeEnvelope(), completionTimeoutSignalAndTruncationState: 'TRUNCATED_BOUNDED' },
    });
    assert.strictEqual(P.reduceObligationOutcome([bounded]).outcome, 'PASS');
  });

  t('evidenceTruncationState helper extracts from envelope and captured.fallback', () => {
    const envOnly = { envelope: { completionTimeoutSignalAndTruncationState: 'NONE' } };
    assert.strictEqual(P.evidenceTruncationState(envOnly), 'NONE');
    const capturedOnly = { captured: { truncationState: 'TRUNCATED_BOUNDED' } };
    assert.strictEqual(P.evidenceTruncationState(capturedOnly), 'TRUNCATED_BOUNDED');
    const absent = { envelope: { provenance: 'x' } };
    assert.strictEqual(P.evidenceTruncationState(absent), null);
  });

  group('§23 authoritative stamps fail-closed at validator (Finding B fix)');

  t('supporting evidence validates without observerQualified', () => {
    const ok = makeEvidence();
    assert.strictEqual(V.validateRecord(ok).valid, true);
  });

  t('authoritative evidence without observerQualified is invalid at the store', () => {
    const noStamp = makeEvidence({ classification: 'authoritative', applicabilityKey: P.computeApplicabilityKey(sliceBinding()) });
    const v = V.validateRecord(noStamp);
    assert.strictEqual(v.valid, false);
    assert.ok(v.problems.some((p) => p.includes('requires an attested qualified observer')));
  });

  t('authoritative evidence with observerQualified:true and a binding key validates', () => {
    const stamp = makeEvidence({ classification: 'authoritative', observerQualified: true });
    assert.strictEqual(V.validateRecord(stamp).valid, true);
  });

  t('authoritative evidence requiring key AND stamp is caught when both are missing', () => {
    const bare = makeEvidence({ classification: 'authoritative', applicabilityKey: null });
    const v = V.validateRecord(bare);
    assert.strictEqual(v.valid, false);
    assert.ok(v.problems.some((p) => p.includes('non-null applicabilityKey')));
    assert.ok(v.problems.some((p) => p.includes('requires an attested qualified observer')));
  });

  group('additive finalization.terminalTime (§19/§23)');

  t('createFinalization defaults terminalTime to null (additive field)', () => {
    const rec = R.createFinalization({ finalizationId: 'f-1', incarnationId: 'inc-1', stopReason: 'CANCELLED' });
    assert.strictEqual(rec.terminalTime, null);
  });

  t('a bound terminalTime is carried on the record and validates', () => {
    const rec = R.createFinalization({ finalizationId: 'f-1', incarnationId: 'inc-1', stopReason: 'CANCELLED', terminalTime: 1700000000123 });
    assert.strictEqual(rec.terminalTime, 1700000000123);
    assert.strictEqual(V.validateRecord(rec).valid, true);
  });

  t('a malformed terminalTime fails closed at the store', () => {
    const bad = R.createFinalization({ finalizationId: 'f-1', incarnationId: 'inc-1', stopReason: 'CANCELLED', terminalTime: -5 });
    const v = V.validateRecord(bad);
    assert.strictEqual(v.valid, false);
    assert.ok(v.problems.some((p) => p.includes('terminalTime must be a non-negative epoch-ms number or null')));

    const str = R.createFinalization({ finalizationId: 'f-2', incarnationId: 'inc-1', stopReason: 'CANCELLED', terminalTime: '2026-09-15T00:00:00Z' });
    assert.strictEqual(V.validateRecord(str).valid, false);
  });

  t('canonical round-trip preserves a bound terminalTime (JSON serialize → parse → validate)', () => {
    const rec = R.createFinalization({ finalizationId: 'f-1', incarnationId: 'inc-1', stopReason: 'CANCELLED', terminalTime: 1700000000123 });
    const revived = JSON.parse(JSON.stringify(rec));
    assert.deepStrictEqual(revived, rec);
    assert.strictEqual(revived.terminalTime, 1700000000123);
    assert.strictEqual(V.validateRecord(revived).valid, true);
  });

  group('durability / round-trip: pipeline records through the real journal store');

  t('evidence, invalidation, and terminalTime finalization survive reopen intact', () => {
    const d = dir();
    const store = STATE.open(d);
    store.add(makeEvidence({ evidenceId: 'ev-1' }));
    store.add(R.createEvidenceInvalidation({
      invalidationId: 'inv-1', evidenceId: 'ev-1',
      reason: P.InvalidationReason.SUPERSEDED, supersededById: 'ev-2', invalidatedAt: 1700000000050,
    }));
    store.add(R.createFinalization({
      finalizationId: 'fin-1', incarnationId: 'inc-1',
      stopReason: 'CANCELLED', terminalTime: 1700000000123,
    }));
    const stateId1 = store.stateId();
    assert.strictEqual(store.validateState().valid, true);
    store.close();

    const reopened = STATE.open(d);
    assert.strictEqual(reopened.corrupt, null);
    assert.strictEqual(reopened.stateId(), stateId1, 'folded state must be deterministic across restart');
    assert.strictEqual(reopened.get('ev-1').obligationId, 'obl-1');
    assert.strictEqual(reopened.get('inv-1').reason, P.InvalidationReason.SUPERSEDED);
    assert.strictEqual(reopened.get('fin-1').terminalTime, 1700000000123, 'terminalTime must survive a durable round-trip');
    assert.strictEqual(reopened.validateState().valid, true);
    reopened.close();
    tear(d);
  });

  t('deleting the snapshot is healed from the journal (journal is the authority)', () => {
    const d = dir();
    const store = STATE.open(d);
    store.add(makeEvidence({ evidenceId: 'ev-1' }));
    store.add(R.createEvidenceInvalidation({
      invalidationId: 'inv-1', evidenceId: 'ev-1', reason: P.InvalidationReason.GENERATION_RETIRED,
    }));
    const stateId1 = store.stateId();
    // Do NOT close first: JOURNAL.close() compacts journal entries away, so the
    // snapshot-loss scenario must replay against journal files that are intact.
    fs.rmSync(path.join(d, 'snapshot.json'), { force: true });

    const rebuilt = STATE.open(d);
    assert.strictEqual(rebuilt.corrupt, null);
    assert.strictEqual(rebuilt.stateId(), stateId1, 'snapshot loss must not lose durable evidence');
    assert.strictEqual(rebuilt.journal.recovery.snapshotRebuilt, true, 'a fresh snapshot should be rebuilt from the journal');
    assert.ok(fs.existsSync(path.join(d, 'snapshot.json')));
    assert.strictEqual(rebuilt.get('ev-1').outcome, 'PASS');
    assert.strictEqual(rebuilt.get('inv-1').evidenceId, 'ev-1');
    rebuilt.close();
    store.close();
    tear(d);
  });

  t('a duplicate evidence add is refused by the store (fail closed)', () => {
    const d = dir();
    const store = STATE.open(d);
    store.add(makeEvidence({ evidenceId: 'ev-dup' }));
    assert.throws(() => store.add(makeEvidence({ evidenceId: 'ev-dup' })), /duplicate identity/);
    assert.strictEqual(store.validateState().valid, true, 'the refusal must not corrupt the store');
    store.close();
    tear(d);
  });

  t('a tampered journal entry carrying pipeline records trips corruption (fail closed)', () => {
    const d = dir();
    const store = STATE.open(d);
    store.add(makeEvidence({ evidenceId: 'ev-1' }));
    // Do NOT close first: JOURNAL.close() compacts journal files away. Tamper
    // the live seq-1 entry so the fail-closed replay can observe it.
    const entry = path.join(d, 'journal', '00000001.json');
    const raw = JSON.parse(fs.readFileSync(entry, 'utf8'));
    raw.payload.outcome = 'PASSED'; // mutate WITHOUT updating the digest
    fs.writeFileSync(entry, JSON.stringify(raw));

    const reopened = STATE.open(d);
    assert.notStrictEqual(reopened.corrupt, null, 'a digest/tamper mismatch must fail closed');
    assert.throws(() => reopened.all(), /corrupt/);
    reopened.close();
    store.close();
    tear(d);
  });
};