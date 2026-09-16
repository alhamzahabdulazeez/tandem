'use strict';
/**
 * Tests for src/contracts/coherence.js — Unit 11's single coherent §21
 * reduction flow. Asserts that every gate is derived from records (never
 * free-typed) and that the whole chain FAILS CLOSED: under IB-01 the current
 * state is not accepted; with every attestation in place it is.
 */

const assert = require('node:assert');
const REC = require('../../src/contracts/records.js');
const C = require('../../src/contracts/coherence.js');
const ACC = require('../../src/contracts/acceptance.js');

const CID = 'sha256:' + 'a'.repeat(64);

function genFrozen() {
  const g = REC.createGeneration({ generationId: 'gen-1', taskId: 'task-1', incarnationId: 'inc-1' });
  g.state = REC.GenerationState.FROZEN;
  g.treeDigest = CID;
  g.createOnceIdentity = `ci1:${'b'.repeat(64)}`;
  g.baselineIdentity = 'commit:' + 'c'.repeat(40);
  g.manifestIdentity = 'sha256:' + 'e'.repeat(64);
  g.barrier1ClosedAt = '2026-09-15T09:00:00.000Z';
  return g;
}

function observer() {
  return REC.createObserverRun({
    runId: 'run-1',
    incarnationId: 'inc-1',
    obligationId: 'obl-1',
    candidateIdentity: { generationId: 'gen-1', treeDigest: CID },
    qualification: { qualified: true, name: 'protected-native-observer', version: '1' },
    launch: {
      entrypoint: 'bin/tandem.cjs',
      sourceRoot: '/contained/frozen/gen-1',
      runtimeIdentity: 'node@26.0.0-qualified',
      resolutionScope: 'closed:sha256:' + 'd'.repeat(64),
      envCluster: 'cluster:A',
      installedDependencyBytes: true, cachesDisabled: true, configParentIncluded: true,
    },
    captured: {
      stdoutBytes: 4096, stderrBytes: 1024, exitSignal: 0, timeoutSignal: false,
      completionFacts: { wallMs: 1200 },
      truncationState: 'NONE',
    },
    comparedOutsideExecution: true,
    classification: 'authoritative',
    observationPath: 'protected/evidence/obs-1.json',
    attestedAt: '2026-09-15T09:00:03.000Z',
  });
}

/** Every durable gate in place — the ONLY fully-coherent fixture. */
function fullRecords() {
  return [
    { schemaVersion: 1, kind: 'store_owner', canonicalStorePath: '/s', lockIdentity: 'lock-1', ownerIdentity: 'o:1', currentEpoch: 1, recoveryState: 'NORMAL' },
    { schemaVersion: 1, kind: 'lineage', lineageId: 'ln-1', createdAt: '2026-09-15T00:00:00.000Z' },
    REC.createAcceptanceContract({ contractId: 'c-1', taskId: 'task-1', incarnationId: 'inc-1' }),
    { schemaVersion: 1, kind: 'policy', policyId: 'pol-1', incarnationId: 'inc-1', stage: 'ENFORCED' },
    (() => {
      const cap = REC.createSourceCapture({ captureId: 'cap-1', incarnationId: 'inc-1', commitIdentity: 'a'.repeat(40), integrity: { objectIdentitiesVerified: true, treeEnumerationComplete: true, independentRetentionEstablished: true } });
      cap.baselineManifestIdentity = 'sha256:' + 'e'.repeat(64);
      return cap;
    })(),
    genFrozen(),
    observer(),
    { schemaVersion: 1, kind: 'delivery', deliveryId: 'del-1', taskId: 'task-1', frozenGenerationId: 'gen-1', persistenceState: 'PUBLISHED', manifestDigest: 'sha256:' + 'f'.repeat(64), payloadDigest: 'sha256:' + 'g'.repeat(64) },
    // Quiescence is proven ONLY by a durable finalization attesting it (§19).
    (() => {
      const fin = REC.createFinalization({ finalizationId: 'fin-1', incarnationId: 'inc-1', stopReason: 'FINISHED' });
      fin.quiescenceProven = true;
      fin.fencingEstablished = true;
      fin.admissionClosed = true;
      fin.authorityRetired = true;
      return fin;
    })(),
  ];
}

/** The observed-facts the supervisor possesses after a lawful run (§20/§17). */
function fullObserved() {
  const GEN = require('../../src/contracts/generation.js');
  const manifest = GEN.buildDeliveryManifest({
    selectedBaselineIdentity: 'sha256:' + 'a'.repeat(64),
    acceptedGenerationAndTreeDigest: CID,
    completePayloadDigest: 'sha256:' + 'g'.repeat(64),
    includedEntries: [{ path: 'src/a.js', type: 'file', mode: 0o644, contentId: CID, size: 4 }],
    newFilesAndDeletions: { newFiles: [], deletions: [] },
    explicitlyExcludedInputs: [{ path: 'node_modules', reason: 'excluded dependency inputs' }],
    runtimeAndVerificationInputManifest: { node: 'node@26.x', recipe: 'native-full-suite' },
    acceptanceContractAndEvidenceIdentities: { contractDigest: 'c-1', evidenceDigests: ['e1'] },
    publicationIdentityAndState: { identity: 'pub-1', persistenceState: 'NOT_PUBLISHED' },
    retention: GEN.defaultRetention('2026-09-15T09:00:00.000Z'),
  });
  return {
    inputClosure: { closed: true, missing: [] },
    profileDigest: 'sha256:' + 'h'.repeat(64),
    predicates: 'defs:sha256:' + 'i'.repeat(64),
    deliveryManifest: manifest,
    publicationFacts: { bytesVerified: true, durablyPersisted: true, published: true, publishedAt: '2026-09-15T09:00:04.000Z' },
  };
}

/** §14 fixture: matching inventory entry + obligation + satisfied observation.
 * Mirrors the canonical accepted-path shape from acceptance.test.js exactly —
 * the only shape `reduceAcceptance` accepts. */
function acceptanceFixture() {
  const entry = {
    ...ACC.createInventoryEntry({ requirementId: 'R1', mappedObligationIds: ['obl-1'] }),
    sourceProvenance: 'original prompt, exact slice',
    originalMeaning: 'CLI exits deterministically',
    admittedInterpretation: 'verify deterministic exit under qualified native recipe',
    explicitOrInferred: 'explicit',
    mandatoryOrOptional: 'mandatory',
    applicability: 'APPLICABLE',
  };
  const oblig = {
    ...ACC.createObligation({
      obligationId: 'obl-1',
      requirementId: 'R1',
      mandatoryStatus: 'mandatory',
      applicabilityAndDomain: 'exact slice: verify command exit behavior',
      predicateFamily: ACC.PredicateFamily.EXTERNAL_BEHAVIORAL_CASE,
      predicateAdapterId: 'native-cli-observer',
      predicateVersion: 3,
      parametersAndExpectedValues: { command: 'node', arg: '--version', expectedExit: 0 },
      requiredScopeAndCompleteness: 'full generated CLI invocation, bounded capture',
      permittedEvidenceSources: ['protected-observer'],
    }),
    // The family's full required set (§14 table) — the 8-point validator enforces it.
    requiredObservationTypes: ['expected_value', 'candidate_stdout', 'candidate_stderr', 'exit_signal', 'exit_code', 'timeout'],
  };
  const obs = { obligationId: 'obl-1', valid: true, applicable: true, evaluation: 'predicate_satisfied', completeness: 'complete' };
  return { inventory: [entry], obligations: [oblig], observations: [obs] };
}

module.exports = function run(t, group) {
  group('coherence: gates derive from records (single source of truth)');

  t('empty records => every gate false, derivation MISSING, coherentReduction refuses acceptance', () => {
    const gates = C.acceptanceGates({ records: [] });
    assert.strictEqual(gates.derivation.status, 'MISSING');
    assert.strictEqual(gates.frozenGenerationId, null);
    assert.strictEqual(gates.inputClosure.closed || false, false);
    assert.strictEqual(gates.evidenceCoherent, false);
    assert.strictEqual(gates.payloadManifestComplete, false);
    assert.strictEqual(gates.quiescenceProven, false);
    assert.strictEqual(gates.cleanAuthorityOwnership, false);
    assert.ok(gates.blockers.length >= 5);

    const { acceptance } = C.coherentReduction({ records: [] });
    assert.strictEqual(acceptance.accepted, false);
    assert.ok(acceptance.reasons.some((x) => x.includes('empty conjunction')));
  });

  t('under IB-01 (no qualified observer) the current state is NOT accepted', () => {
    const records = fullRecords().filter((r) => r.kind !== 'observer_run')
      .concat(REC.createObserverRun({
        runId: 'run-1', incarnationId: 'inc-1', obligationId: 'obl-1',
        candidateIdentity: { generationId: 'gen-1', treeDigest: CID },
        classification: 'supporting',
      }));
    const { acceptance, gates } = C.coherentReduction({ records, observed: fullObserved(), ...acceptanceFixture() });
    // The supporting run is PRESENT but not authoritative: a present-but-
    // untrustworthy observation is INCONCLUSIVE (§17), never a pass.
    assert.strictEqual(gates.derivation.status, 'INCONCLUSIVE');
    assert.strictEqual(acceptance.accepted, false, 'mandatory obligation MUST NOT upgrade to PASS');
  });

  group('coherence: ESTABLISHED path accepts');

  t('all durable gates + observed facts + complete §14 fixture => accepted', () => {
    const { gates, acceptance } = C.coherentReduction({
      records: fullRecords(),
      observed: fullObserved(),
      ...acceptanceFixture(),
    });
    assert.strictEqual(gates.derivation.status, 'ESTABLISHED');
    assert.strictEqual(gates.evidenceCoherent, true);
    assert.strictEqual(gates.payloadManifestComplete, true);
    assert.strictEqual(gates.quiescenceProven, true, 'quiescence must come from a durable finalization record');
    assert.strictEqual(gates.cleanAuthorityOwnership, true);
    assert.strictEqual(gates.blockers.length, 0);
    assert.strictEqual(acceptance.accepted, true, 'full attestation must accept');
    assert.strictEqual(acceptance.assurance, REC.Assurance.VERIFIED_REQUIRED_CHECKS);
  });

  t('no observed input-closure facts => not accepted even though everything else closes', () => {
    const g = C.acceptanceGates({
      records: fullRecords(),
      observed: { ...fullObserved(), inputClosure: undefined },
      ...acceptanceFixture(),
    });
    assert.strictEqual(g.evidenceCoherent, true, 'derivation + profile + predicates close independently of input-closure facts');
    assert.strictEqual(g.inputClosure.closed, false);
    assert.ok(g.blockers.some((x) => x.includes('input closure')));
  });

  group('coherence: each gate independently blocks');

  t('stale observer run (different generation) blocks via derivation MISSING', () => {
    const records = fullRecords().map((r) => r.kind === 'observer_run'
      ? REC.createObserverRun({ ...r, runId: 'run-1', candidateIdentity: { generationId: 'gen-other', treeDigest: 'sha256:' + 'z'.repeat(64) } })
      : r);
    const g = C.acceptanceGates({ records, observed: fullObserved() });
    assert.notStrictEqual(g.derivation.status, 'ESTABLISHED');
    assert.ok(g.blockers.some((x) => x.includes('actual derivation')));
  });

  t('an ACTIVE quarantine blocks cleanAuthorityOwnership', () => {
    const q = { schemaVersion: 1, kind: 'quarantine', quarantineId: 'q-1', resource: 'r', reason: 'unresolved actor', state: 'ACTIVE' };
    const g = C.acceptanceGates({ records: fullRecords().concat([q]), observed: fullObserved() });
    assert.strictEqual(g.cleanAuthorityOwnership, false);
    assert.ok(g.blockers.some((x) => x.includes('authority/ownership')));
  });

  t('missing retention/payload manifest completeness blocks (§20)', () => {
    // A delivery manifest recorded but not durably published is NOT complete:
    // success-ordering requires publisher-verified durable persistence.
    const noPub = C.acceptanceGates({ records: fullRecords(), observed: { ...fullObserved(), publicationFacts: { bytesVerified: true, durablyPersisted: false, published: false } } });
    assert.strictEqual(noPub.payloadManifestComplete, false);

    // An absent delivery manifest (no observed §20 facts) fails closed too.
    const noManifest = C.acceptanceGates({ records: fullRecords(), observed: { ...fullObserved(), deliveryManifest: null } });
    assert.strictEqual(noManifest.payloadManifestComplete, false);
  });

  group('coherence: status consumption of the same source of truth');

  t('acceptanceGates is reducible over report status inputs (no reliance on report internals)', () => {
    // A thawed fixture with a finalization attesting quiescence must surface it.
    const fin = REC.createFinalization({ finalizationId: 'fin-1', incarnationId: 'inc-1', stopReason: 'FINISHED' });
    fin.quiescenceProven = true;
    fin.fencingEstablished = true;
    fin.admissionClosed = true;
    fin.authorityRetired = true;
    const gates = C.acceptanceGates({ records: fullRecords().concat([fin]), observed: fullObserved() });
    assert.strictEqual(gates.quiescenceProven, true);
  });

  group('coherence: §23 evidence_invalidation integration (Unit 16)');

  t('an evidence_invalidation retracts the observer run from the §17 evidence domain', () => {
    // Evidence record links ev-run1 → run-1 via sourceRunId; invalidation targets ev-run1.
    const evRec = REC.createEvidenceRecord({
      evidenceId: 'ev-run1', obligationId: 'obl-1', generationId: 'gen-1',
      outcome: 'PASS', observationPath: 'protected/evidence/ev-run1.json',
      sourceRunId: 'run-1',
    });
    const inval = REC.createEvidenceInvalidation({
      invalidationId: 'inv-1', evidenceId: 'ev-run1',
      reason: 'SUPERSEDED', supersededById: 'run-2',
    });
    const g = C.acceptanceGates({
      records: fullRecords().concat([evRec, inval]),
      observed: fullObserved(),
      ...acceptanceFixture(),
    });
    // activeObserverRuns resolves ev-run1 → sourceRunId run-1, drops run-1 from
    // the coherence domain. The §14 fixture pins every OTHER domain closed, so
    // the failing domain is provably 'evidence'.
    assert.strictEqual(g.evidenceCoherent, false);
    assert.ok(g.coherence.gaps.includes('evidence'), 'the evidence domain must report the gap');
    assert.ok(g.blockers.some((x) => x.includes('evidence coherence')));
  });

  t('partial retraction keeps the domain live while a valid run remains', () => {
    const second = REC.createObserverRun({
      runId: 'run-extra', incarnationId: 'inc-1', obligationId: 'obl-1',
      candidateIdentity: { generationId: 'gen-1', treeDigest: CID },
      qualification: { qualified: true, name: 'protected-native-observer', version: '1' },
      classification: 'authoritative', comparedOutsideExecution: true,
      observationPath: 'protected/evidence/obs-2.json',
      captured: { stdoutBytes: 1, stderrBytes: 1, exitSignal: 0, timeoutSignal: false, completionFacts: { wallMs: 1 }, truncationState: 'NONE' },
      launch: { entrypoint: 'bin/tandem.cjs', runtimeIdentity: 'node@26', resolutionScope: 'closed:x', envCluster: 'A', installedDependencyBytes: true, cachesDisabled: true, configParentIncluded: true },
    });
    // Evidence record links ev-extra → run-extra via sourceRunId; invalidation targets ev-extra.
    const evExtra = REC.createEvidenceRecord({
      evidenceId: 'ev-extra', obligationId: 'obl-1', generationId: 'gen-1',
      outcome: 'PASS', observationPath: 'protected/evidence/ev-extra.json',
      sourceRunId: 'run-extra',
    });
    const inval = REC.createEvidenceInvalidation({
      invalidationId: 'inv-x', evidenceId: 'ev-extra', reason: 'GENERATION_RETIRED',
    });
    const g = C.acceptanceGates({
      records: fullRecords().concat([second, evExtra, inval]),
      observed: fullObserved(),
      ...acceptanceFixture(),
    });
    // run-1 is still valid, so the evidence domain still closes.
    assert.strictEqual(g.evidenceCoherent, true);
  });

  t('an invalidation of a plain §23 evidence record does not hollow the observer domain', () => {
    // Retracting a kind-'evidence' pipeline item has its own §23 reduction; the
    // §21 evidence domain here is observer_run-driven, so it stays intact.
    const evidenceRec = REC.createEvidenceRecord({
      evidenceId: 'ev-pipe', obligationId: 'obl-1', generationId: 'gen-1',
      outcome: 'PASS', envelope: { observer_run_ref: 'run-1' }, observationPath: 'protected/evidence/ev-pipe.json',
    });
    const inval = REC.createEvidenceInvalidation({
      invalidationId: 'inv-y', evidenceId: 'ev-pipe', reason: 'KEY_MISMATCH',
    });
    const g = C.acceptanceGates({
      records: fullRecords().concat([evidenceRec, inval]),
      observed: fullObserved(),
      ...acceptanceFixture(),
    });
    assert.strictEqual(g.evidenceCoherent, true);
    assert.strictEqual(g.derivation.status, 'ESTABLISHED');
  });
};