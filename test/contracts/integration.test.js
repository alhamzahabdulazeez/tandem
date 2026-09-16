'use strict';
/**
 * Unit 11 integration test — the Units 7–10 journey, end to end, through the
 * SINGLE coherent reduction flow (§16-§17-§19-§20-§21).
 *
 * The fixture writes real durable records to a real store (STATE fold), then
 * reduces acceptance ONCE via {coherentReduction}: every gate
 * (derivation=input-closure=publication=quiescence=ownership=evidence) is
 * DERIVED from those records — nothing free-typed — and the whole chain fails
 * closed under IB-01.
 *
 * Asserts two honest poles:
 *   1. all attestations present  => accepted (VERIFIED_REQUIRED_CHECKS);
 *   2. observer qualification
 *      unattested (IB-01)        => derivation UNQUALIFIED, NOT accepted.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REC = require('../../src/contracts/records.js');
const CAP = require('../../src/contracts/capture.js');
const ACC = require('../../src/contracts/acceptance.js');
const GEN = require('../../src/contracts/generation.js');
const C = require('../../src/contracts/coherence.js');
const STATE = require('../../src/control/state.cjs');
const { contentId } = require('../../src/contracts/crypto.js');

const CID = 'sha256:' + 'a'.repeat(64);

function dir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-it-')); }
function tear(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }

/** The full lawful Units 7–10 record journey, written to a real store. */
function journey(store, overQualified = true) {
  // §6 store owner + §13/§17 policy — durable precondition for coherence (policy + authority-ownership domains).
  store.add({
    schemaVersion: 1, kind: 'store_owner',
    canonicalStorePath: '/s', lockIdentity: 'lock-1', ownerIdentity: 'o:1',
    currentEpoch: 1, recoveryState: 'NORMAL',
  });
  store.add({
    schemaVersion: 1, kind: 'policy',
    policyId: 'pol-1', incarnationId: 'inc-1', stage: 'ENFORCED',
  });

  // §11 capture — baseline manifest built and integrity attested by the reader.
  const rules = CAP.normalizeRules({ include: ['src/'], exclude: [], excludeDirty: true });
  const manifest = CAP.buildBaselineManifest({
    paths: ['src/a.js', '.git/HEAD'],
    manifestIdentity: 'sha256:' + '0'.repeat(64),
    rules,
  });
  assert.strictEqual(manifest.included.length, 1, 'only src/a.js is source content — .git/HEAD is excluded as administration (§11)');
  store.add(REC.createSourceCapture({
    captureId: 'cap-1', incarnationId: 'inc-1', commitIdentity: 'a'.repeat(40), rules,
    baselineManifestIdentity: 'sha256:' + '0'.repeat(64),
    integrity: {
      objectIdentitiesVerified: true, treeEnumerationComplete: true,
      independentRetentionEstablished: true,
    },
  }));

  // Acceptance contract (§13/§14) with the exact §14 inventory+obligation pair.
  const contract = REC.createAcceptanceContract({ contractId: 'c-1', taskId: 'task-1', incarnationId: 'inc-1' });
  const entry = ACC.createInventoryEntry({
    requirementId: 'R1', mappedObligationIds: ['obl-1'],
    sourceProvenance: 'original prompt, exact slice',
    originalMeaning: 'CLI exits deterministically',
    admittedInterpretation: 'verify deterministic exit under qualified native recipe',
    explicitOrInferred: 'explicit', mandatoryOrOptional: 'mandatory', applicability: 'APPLICABLE',
  });
  const oblig = ACC.createObligation({
    obligationId: 'obl-1', requirementId: 'R1', mandatoryStatus: 'mandatory',
    applicabilityAndDomain: 'exact slice: verify command exit behavior',
    predicateFamily: ACC.PredicateFamily.EXTERNAL_BEHAVIORAL_CASE,
    predicateAdapterId: 'native-cli-observer', predicateVersion: 3,
    parametersAndExpectedValues: { command: 'node', arg: '--version', expectedExit: 0 },
    requiredObservationTypes: ['candidate_stdout', 'candidate_stderr', 'exit_code', 'exit_signal', 'timeout', 'expected_value'],
    requiredScopeAndCompleteness: 'full generated CLI invocation, bounded capture',
    permittedEvidenceSources: ['protected-observer'],
  });
  contract.obligations = [oblig];
  contract.inventoryDigest = 'sha256:' + '1'.repeat(64);
  store.add(contract);

  // §7/§20 generation: MUTABLE -> MUTATION_CLOSED -> FROZEN (barriers 1 & 2).
  const treeDigest = contentId(manifest.digest);
  const b1 = GEN.canCloseMutation({
    mutationAdmissionClosed: true, writeGrantsRetired: true,
    mutatorsDrainedOrFenced: true, mutatorsReconciled: true,
  });
  assert.ok(b1.ok, (b1.problems || []).join('; '));
  const g = REC.createGeneration({ generationId: 'gen-1', taskId: 'task-1', incarnationId: 'inc-1' });
  g.state = REC.GenerationState.MUTATION_CLOSED;
  g.barrier1ClosedAt = '2026-09-15T09:00:00.000Z';
  g.treeDigest = treeDigest;
  g.baselineIdentity = 'sha256:' + 'c'.repeat(64);
  store.add(g);
  const mat = {
      barrier1Closed: b1.ok, bytesVerified: true, treeDigestVerified: true,
      createOnceIdentity: GEN.createOnceIdentity({ generationId: 'gen-1', treeDigest }),
      retentionDeclared: GEN.retentionDeclared({ ...GEN.defaultRetention('2026-09-15T09:00:00.000Z'), reservedCapacity: 1024 * 1024 }).ok,
      qualifiedMaterializer: true,
    };
  const fr = GEN.freezeReadiness({ generation: g, materialization: mat });
  assert.strictEqual(fr.status, GEN.FreezeStatus.READY, JSON.stringify(fr));

  // advanceGeneration is a one-way gate (§7): allowed, THEN the record advances.
  const go = GEN.advanceGeneration({
    current: g.state, to: REC.GenerationState.FROZEN,
    preconditions: { generation: g, materialization: mat },
  });
  assert.strictEqual(go.allowed, true, go.reason);
  g.state = REC.GenerationState.FROZEN;
  g.createOnceIdentity = mat.createOnceIdentity;
  g.manifestIdentity = 'sha256:' + 'e'.repeat(64);
  store.update('gen-1', () => g); // identity-stable fold: MUTATION_CLOSED advances to FROZEN (§13)

  // §16 observer run — the protected external observer on the frozen bytes.
  store.add(REC.createObserverRun({
    runId: 'run-1', incarnationId: 'inc-1', obligationId: 'obl-1',
    candidateIdentity: { generationId: 'gen-1', treeDigest },
    qualification: overQualified ? { qualified: true, name: 'protected-native-observer', version: '1' } : null,
    launch: {
      entrypoint: 'bin/tandem.cjs', sourceRoot: '/contained/frozen/gen-1',
      runtimeIdentity: 'node@26.0.0-qualified', resolutionScope: 'closed:sha256:' + 'd'.repeat(64),
      envCluster: 'cluster:A',
      installedDependencyBytes: true, cachesDisabled: true, configParentIncluded: true,
    },
    captured: {
      stdoutBytes: 4096, stderrBytes: 1024, exitSignal: 0, timeoutSignal: false,
      completionFacts: { wallMs: 1200 }, truncationState: 'NONE',
    },
    comparedOutsideExecution: true,
    classification: overQualified ? 'authoritative' : 'supporting',
    observationPath: overQualified ? 'protected/evidence/obs-1.json' : null,
    attestedAt: '2026-09-15T09:00:03.000Z',
  }));

  // §20 delivery + §19 finalization (quiescence, fencing).
  store.add(REC.createDelivery({ deliveryId: 'del-1', taskId: 'task-1', frozenGenerationId: 'gen-1' }));
  const fin = REC.createFinalization({ finalizationId: 'fin-1', incarnationId: 'inc-1', stopReason: 'FINISHED' });
  fin.quiescenceProven = true; fin.fencingEstablished = true; fin.admissionClosed = true; fin.authorityRetired = true;
  store.add(fin);
}

/** The observed post-execution facts (supervisor's lawful take, §20/§17). */
function observedFacts() {
  const dm = GEN.buildDeliveryManifest({
    selectedBaselineIdentity: 'sha256:' + '1'.repeat(64),
    acceptedGenerationAndTreeDigest: CID,
    completePayloadDigest: contentId('payload-bytes'),
    includedEntries: [{ path: 'src/a.js', type: 'file', mode: 0o644, contentId: contentId('aaaa'), size: 4 }],
    newFilesAndDeletions: { newFiles: [], deletions: [] },
    explicitlyExcludedInputs: [],
    runtimeAndVerificationInputManifest: { node: 'node@26.x', recipe: 'native-full-suite' },
    acceptanceContractAndEvidenceIdentities: { contractDigest: 'c-1', evidenceDigests: ['e1'] },
    publicationIdentityAndState: { identity: 'pub-1', persistenceState: 'PUBLISHED' },
    retention: GEN.defaultRetention('2026-09-15T09:00:00.000Z'),
  });
  return {
    inputClosure: { closed: true, missing: [] },
    profileDigest: 'sha256:' + 'h'.repeat(64),
    predicates: 'defs:sha256:' + 'i'.repeat(64),
    deliveryManifest: dm,
    publicationFacts: { bytesVerified: true, durablyPersisted: true, published: true, publishedAt: '2026-09-15T09:00:04.000Z' },
  };
}

/** The §14 inventory entry — the exact shape reduceAcceptance requires (mandatory + APPLICABLE). */
function inventoryEntry() {
  return {
    ...ACC.createInventoryEntry({ requirementId: 'R1', mappedObligationIds: ['obl-1'] }),
    mandatoryOrOptional: 'mandatory',
    applicability: 'APPLICABLE',
  };
}

/** The §14 observation the supervisor evaluated from the observer's capture. */
function observation() {
  return { obligationId: 'obl-1', valid: true, applicable: true, evaluation: 'predicate_satisfied', completeness: 'complete' };
}

module.exports = function run(t, group) {
  group('integration: Units 7–10 through the single coherent reduction flow (§21)');

  t('full journey with all attestations => ONE derived reduction ACCEPTS', () => {
    const d = dir();
    const store = STATE.open(d);
    journey(store, true);
    const records = store.all();
    const contract = records.find((r) => r.kind === 'acceptance_contract');
    const { gates, acceptance } = C.coherentReduction({
      records,
      observed: observedFacts(),
      inventory: [inventoryEntry()],
      obligations: contract.obligations,
      observations: [observation()],
    });

    // Every gate derived from the durable records — none free-typed.
    assert.strictEqual(gates.derivation.status, 'ESTABLISHED', JSON.stringify(gates.derivation.reasons));
    assert.strictEqual(gates.evidenceCoherent, true, 'evidence 10-domain coherence must close');
    assert.strictEqual(gates.inputClosure.closed, true);
    assert.strictEqual(gates.payloadManifestComplete, true);
    assert.strictEqual(gates.quiescenceProven, true, 'must come from the durable finalization');
    assert.strictEqual(gates.cleanAuthorityOwnership, true);
    assert.strictEqual(gates.blockers.length, 0, JSON.stringify(gates.blockers));
    assert.strictEqual(acceptance.accepted, true, JSON.stringify(acceptance.reasons));
    assert.strictEqual(acceptance.assurance, REC.Assurance.VERIFIED_REQUIRED_CHECKS);
    store.close();
    tear(d);
  });

  t('same journey, qualification unattested (IB-01) => derivation UNQUALIFIED and NOT accepted', () => {
    const d = dir();
    const store = STATE.open(d);
    journey(store, false);
    const records = store.all();
    const contract = records.find((r) => r.kind === 'acceptance_contract');
    const { gates, acceptance } = C.coherentReduction({
      records,
      observed: observedFacts(),
      inventory: [inventoryEntry()],
      obligations: contract.obligations,
      observations: [observation()],
    });
    assert.strictEqual(gates.derivation.status, 'INCONCLUSIVE', 'a structurally complete but qualification-unattested observer is honestly classified supporting (§17), so derivation is INCONCLUSIVE — the store flat-out refuses an authoritative-unqualified record (IB-01)');
    assert.strictEqual(acceptance.accepted, false, 'IB-01 MUST NOT be papered over by an otherwise-good fixture');
    assert.ok(acceptance.reasons.some((x) => x.includes('IB-01')), 'the blocker must be attributed to IB-01');
    store.close();
    tear(d);
  });
};