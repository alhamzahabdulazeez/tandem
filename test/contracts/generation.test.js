'use strict';
/**
 * Tests for src/contracts/generation.js (+ the durable generation record and
 * its fail-closed validator) — §7 one-way freeze transition, §20 barrier 1 / 2,
 * delivery manifest, publication ordering, crash table, retention, and
 * create-once identity.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const GEN = require('../../src/contracts/generation.js');
const REC = require('../../src/contracts/records.js');
const VAL = require('../../src/contracts/validate.js');
const ACC = require('../../src/contracts/acceptance.js');
const CAP = require('../../src/contracts/capture.js');
const STATE = require('../../src/control/state.cjs');
const { contentId } = require('../../src/contracts/crypto.js');

function dir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-gen-')); }
function tear(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }

const CID = contentId('tree-bytes');
const PAYLOAD = contentId('payload-bytes');

function generation(over) {
  over = over || {};
  const g = REC.createGeneration({
    generationId: over.generationId || 'gen-1',
    taskId: 'task-1',
    incarnationId: 'inc-1',
    parentGenerationId: over.parentGenerationId || null,
  });
  return Object.assign(g, over);
}

function materialized(over) {
  over = over || {};
  return Object.assign({
    barrier1Closed: true,
    bytesVerified: true,
    treeDigestVerified: true,
    createOnceIdentity: GEN.createOnceIdentity({ generationId: 'gen-1', treeDigest: CID }),
    retentionDeclared: true,
    qualifiedMaterializer: true,
  }, over);
}

function closedGeneration(over) {
  over = over || {};
  const g = generation(over);
  // Honor a caller-provided state (e.g. FROZEN for negative tests); default to
  // MUTATION_CLOSED since that is this helper's normal role.
  g.state = over.state && over.state !== REC.GenerationState.MUTABLE
    ? over.state
    : REC.GenerationState.MUTATION_CLOSED;
  g.barrier1ClosedAt = '2026-09-15T09:00:00.000Z';
  if (!Object.prototype.hasOwnProperty.call(over, 'treeDigest')) g.treeDigest = CID; // default only when absent
  return g;
}

function validManifest(over) {
  over = over || {};
  const m = GEN.buildDeliveryManifest({
    selectedBaselineIdentity: 'sha256:' + 'a'.repeat(64),
    acceptedGenerationAndTreeDigest: CID,
    completePayloadDigest: PAYLOAD,
    includedEntries: [
      { path: 'src/a.js', type: 'file', mode: 0o644, contentId: contentId('aaaa'), size: 4 },
      { path: 'src/b.js', type: 'file', mode: 0o644, contentId: contentId('bbbb'), size: 4 },
    ],
    newFilesAndDeletions: { newFiles: ['src/b.js'], deletions: ['old.js'] },
    explicitlyExcludedInputs: [{ path: 'node_modules', reason: 'excluded dependency inputs' }],
    runtimeAndVerificationInputManifest: { node: 'node@26.x', recipe: 'native-full-suite' },
    acceptanceContractAndEvidenceIdentities: { contractDigest: 'c1', evidenceDigests: ['e1'] },
    publicationIdentityAndState: { identity: 'pub-1', persistenceState: 'NOT_PUBLISHED' },
    retention: GEN.defaultRetention('2026-09-15T09:00:00.000Z'),
  });
  if (over.fields) m.fields = Object.assign({}, m.fields, over.fields);
  if (over.manifestIdentity !== undefined) m.manifestIdentity = over.manifestIdentity;
  return m;
}

module.exports = function run(t, group) {
  group('generation: durable record shape');

  t('createGeneration defaults to MUTABLE with no identities bound', () => {
    const g = generation();
    assert.strictEqual(g.kind, 'generation');
    assert.strictEqual(g.state, REC.GenerationState.MUTABLE);
    assert.strictEqual(g.treeDigest, null);
    assert.strictEqual(g.createOnceIdentity, null);
    assert.strictEqual(g.retention, null);
  });

  t('a valid generation record passes the fail-closed validator', () => {
    const v = VAL.validateRecord(generation());
    assert.strictEqual(v.valid, true, JSON.stringify(v.problems));
  });

  t('a FROZEN record without a content-identity treeDigest is refused (fail closed)', () => {
    // Structural layer: a non-content-id string is refused outright.
    const nonCid = closedGeneration({ state: REC.GenerationState.FROZEN, treeDigest: 'HEAD', createOnceIdentity: 'x' });
    assert.strictEqual(VAL.validateRecord(nonCid).valid, false);
    // Cross-field layer: null treeDigest passes structure but a FROZEN claim must bind one.
    const nullTree = closedGeneration({ state: REC.GenerationState.FROZEN, treeDigest: null, createOnceIdentity: 'x' });
    const v = VAL.validateRecord(nullTree);
    assert.strictEqual(v.valid, false);
    assert.ok(v.problems.some((p) => p.includes('FROZEN requires a content-id treeDigest')));
  });

  t('a FROZEN record without createOnceIdentity is refused, and a MUTABLE-that-claims-closure without stamp refused', () => {
    const noIdent = closedGeneration({ state: REC.GenerationState.FROZEN, treeDigest: CID, createOnceIdentity: null });
    assert.strictEqual(VAL.validateRecord(noIdent).valid, false);
    const noStamp = generation({ state: REC.GenerationState.MUTATION_CLOSED, barrier1ClosedAt: null, treeDigest: CID });
    assert.ok(VAL.validateRecord(noStamp).problems.some((p) => p.includes('MUTATION_CLOSED requires barrier1ClosedAt')));
  });

  group('generation: durable store fold (journal)');

  t('a generation folds through MUTABLE -> MUTATION_CLOSED -> FROZEN and stays durable', () => {
    const d = dir();
    const store = STATE.open(d);

    store.add(generation({ generationId: 'gen-1' }));
    assert.strictEqual(store.get('gen-1').state, REC.GenerationState.MUTABLE);
    const s1 = store.stateId();

    store.update('gen-1', (prev) => Object.assign({}, prev, {
      state: REC.GenerationState.MUTATION_CLOSED,
      barrier1ClosedAt: '2026-09-15T09:00:00.000Z',
    }));
    assert.strictEqual(store.get('gen-1').state, REC.GenerationState.MUTATION_CLOSED);
    assert.notStrictEqual(store.stateId(), s1);

    const id = GEN.createOnceIdentity({ generationId: 'gen-1', treeDigest: CID });
    store.update('gen-1', (prev) => Object.assign({}, prev, {
      state: REC.GenerationState.FROZEN,
      treeDigest: CID,
      createOnceIdentity: id,
      frozenAt: '2026-09-15T09:10:00.000Z',
      retention: GEN.defaultRetention('2026-09-15T09:00:00.000Z'),
    }));
    const frozen = store.get('gen-1');
    assert.strictEqual(frozen.state, REC.GenerationState.FROZEN);

    // Replay from disk proves durability.
    const store2 = STATE.open(d);
    assert.strictEqual(store2.get('gen-1').state, REC.GenerationState.FROZEN);
    assert.strictEqual(store2.get('gen-1').createOnceIdentity, id);
    assert.strictEqual(store2.stateId(), store.stateId());
    store.close();
    store2.close();
    tear(d);
  });

  t('the store refuses a FROZEN update that proves no freeze (bytes not bound)', () => {
    const d = dir();
    const store = STATE.open(d);
    store.add(generation({ generationId: 'gen-x' }));
    store.update('gen-x', (prev) => Object.assign({}, prev, {
      state: REC.GenerationState.MUTATION_CLOSED,
      barrier1ClosedAt: '2026-09-15T09:00:00.000Z',
    }));
    assert.throws(() => store.update('gen-x', (prev) => Object.assign({}, prev, {
      state: REC.GenerationState.FROZEN,
    })), /FROZEN requires a content-id treeDigest/);
    assert.strictEqual(store.get('gen-x').state, REC.GenerationState.MUTATION_CLOSED);
    store.close();
    tear(d);
  });

  group('generation: barrier 1 (close mutation, §20.1)');

  t('all four barrier-1 guards must hold', () => {
    assert.strictEqual(GEN.canCloseMutation({
      mutationAdmissionClosed: true, writeGrantsRetired: true,
      mutatorsDrainedOrFenced: true, mutatorsReconciled: true,
    }).ok, true);
  });

  t('an open mutator or unretired grant leaves barrier 1 not ok', () => {
    const r = GEN.canCloseMutation({
      mutationAdmissionClosed: true, writeGrantsRetired: false,
      mutatorsDrainedOrFenced: false, mutatorsReconciled: true,
    });
    assert.strictEqual(r.ok, false);
    assert.ok(r.problems.some((p) => p.includes('write grants not retired')));
    assert.ok(r.problems.some((p) => p.includes('not drained/fenced')));
  });

  group('generation: barrier 2 (freeze readiness, §20.2)');

  t('the full freeze precondition set is READY', () => {
    const g = closedGeneration({ treeDigest: CID });
    const r = GEN.freezeReadiness({ generation: g, materialization: materialized() });
    assert.strictEqual(r.status, GEN.FreezeStatus.READY, JSON.stringify(r));
  });

  t('structural gaps are NOT_READY (never silently READY)', () => {
    assert.strictEqual(GEN.freezeReadiness({}).status, GEN.FreezeStatus.NOT_READY); // no record
    // Wrong state: still MUTABLE.
    assert.strictEqual(GEN.freezeReadiness({
      generation: generation(), materialization: materialized(),
    }).status, GEN.FreezeStatus.NOT_READY);
    // Barrier 1 not established.
    assert.strictEqual(GEN.freezeReadiness({
      generation: closedGeneration({ treeDigest: CID }),
      materialization: materialized({ barrier1Closed: false }),
    }).status, GEN.FreezeStatus.NOT_READY);
    // Bytes not verified.
    assert.strictEqual(GEN.freezeReadiness({
      generation: closedGeneration({ treeDigest: CID }),
      materialization: materialized({ bytesVerified: false }),
    }).status, GEN.FreezeStatus.NOT_READY);
  });

  t('without a qualified materializer freeze is UNQUALIFIED, not READY (IB-01)', () => {
    const g = closedGeneration({ treeDigest: CID });
    const r = GEN.freezeReadiness({
      generation: g,
      materialization: materialized({
        barrier1Closed: true, bytesVerified: true, treeDigestVerified: true,
        createOnceIdentity: GEN.createOnceIdentity({ generationId: 'gen-1', treeDigest: CID }),
        retentionDeclared: true, qualifiedMaterializer: false,
      }),
    });
    assert.strictEqual(r.status, GEN.FreezeStatus.UNQUALIFIED);
    assert.ok(r.reason.includes('IB-01'));
  });

  t('already-frozen generation is READY without re-proving the freeze', () => {
    const g = closedGeneration({ treeDigest: CID });
    g.state = REC.GenerationState.FROZEN;
    g.createOnceIdentity = GEN.createOnceIdentity({ generationId: 'gen-1', treeDigest: CID });
    const r = GEN.freezeReadiness({ generation: g, materialization: {} });
    assert.strictEqual(r.status, GEN.FreezeStatus.READY);
    assert.strictEqual(r.reason, 'already frozen');
  });

  group('generation: one-way transition (§7)');

  t('MUTABLE -> MUTATION_CLOSED valid only with barrier 1; MUTABLE -> FROZEN is refused', () => {
    const ok = GEN.advanceGeneration({
      current: REC.GenerationState.MUTABLE, to: REC.GenerationState.MUTATION_CLOSED,
      preconditions: { barrier1: { mutationAdmissionClosed: true, writeGrantsRetired: true, mutatorsDrainedOrFenced: true, mutatorsReconciled: true } },
    });
    assert.strictEqual(ok.allowed, true);
    const openGate = GEN.advanceGeneration({
      current: REC.GenerationState.MUTABLE, to: REC.GenerationState.MUTATION_CLOSED,
      preconditions: { barrier1: { mutationAdmissionClosed: false, writeGrantsRetired: true, mutatorsDrainedOrFenced: true, mutatorsReconciled: true } },
    });
    assert.strictEqual(openGate.allowed, false);
    const skip = GEN.advanceGeneration({
      current: REC.GenerationState.MUTABLE, to: REC.GenerationState.FROZEN,
      preconditions: { generation: closedGeneration({ treeDigest: CID }), materialization: materialized() },
    });
    assert.strictEqual(skip.allowed, false); // one-way edge MUTABLE->FROZEN does not exist
  });

  t('MUTATION_CLOSED -> FROZEN requires READY freeze; reverse edges are never allowed', () => {
    const ready = GEN.advanceGeneration({
      current: REC.GenerationState.MUTATION_CLOSED, to: REC.GenerationState.FROZEN,
      preconditions: { generation: closedGeneration({ treeDigest: CID }), materialization: materialized() },
    });
    assert.strictEqual(ready.allowed, true);
    const unqualified = GEN.advanceGeneration({
      current: REC.GenerationState.MUTATION_CLOSED, to: REC.GenerationState.FROZEN,
      preconditions: { generation: closedGeneration({ treeDigest: CID }), materialization: materialized({ qualifiedMaterializer: false }) },
    });
    assert.strictEqual(unqualified.allowed, false);
    assert.strictEqual(unqualified.readiness.status, GEN.FreezeStatus.UNQUALIFIED);
    // Reverse edges.
    assert.strictEqual(GEN.advanceGeneration({ current: REC.GenerationState.FROZEN, to: REC.GenerationState.MUTABLE }).allowed, false);
    assert.strictEqual(GEN.advanceGeneration({ current: REC.GenerationState.MUTATION_CLOSED, to: REC.GenerationState.MUTABLE }).allowed, false);
    assert.strictEqual(GEN.advanceGeneration({ current: REC.GenerationState.FROZEN, to: REC.GenerationState.MUTATION_CLOSED }).allowed, false);
  });

  group('generation: create-once identity');

  t('create-once identity is deterministic per generation+tree and unparseable-after-change', () => {
    const a = GEN.createOnceIdentity({ generationId: 'gen-1', treeDigest: CID });
    const b = GEN.createOnceIdentity({ generationId: 'gen-1', treeDigest: CID });
    assert.strictEqual(a, b);
    assert.ok(GEN.isCreateOnceIdentity(a));
    assert.notStrictEqual(a, GEN.createOnceIdentity({ generationId: 'gen-1', treeDigest: contentId('other') }));
    assert.throws(() => GEN.createOnceIdentity({ generationId: 'gen-1', treeDigest: 'HEAD' }), /content identity/);
  });

  t('a frozen generation refuses re-binding a different byte identity', () => {
    const g = closedGeneration({ treeDigest: CID });
    g.state = REC.GenerationState.FROZEN;
    g.createOnceIdentity = GEN.createOnceIdentity({ generationId: 'gen-1', treeDigest: CID });
    assert.strictEqual(GEN.frozenIdentityUnchanged({
      generation: g,
      proposedIdentity: g.createOnceIdentity,
    }).ok, true);
    assert.strictEqual(GEN.frozenIdentityUnchanged({
      generation: g,
      proposedIdentity: GEN.createOnceIdentity({ generationId: 'gen-1', treeDigest: contentId('evil') }),
    }).ok, false);
  });

  group('generation: §20 delivery manifest');

  t('a fully populated manifest is complete and deterministic', () => {
    const m1 = validManifest();
    const m2 = validManifest();
    assert.strictEqual(GEN.manifestComplete(m1).ok, true, JSON.stringify(GEN.manifestComplete(m1).problems));
    assert.strictEqual(m1.manifestIdentity, m2.manifestIdentity);
    assert.strictEqual(m1.fields.complete_included_paths_types_modes_and_content_identities.count, 2);
  });

  t('a manifest missing any mandated field is incomplete (fail closed)', () => {
    for (const f of GEN.MANIFEST_FIELDS) {
      const m = validManifest({ fields: { [f]: undefined } });
      const r = GEN.manifestComplete(m);
      assert.strictEqual(r.ok, false, `field ${f} must be mandatory`);
      assert.ok(r.problems.some((p) => p.includes(f)), `problem must name ${f}`);
    }
  });

  t('a tampered manifest identity is detected', () => {
    const m = validManifest({ manifestIdentity: 'sha256:' + 'f'.repeat(64) });
    const r = GEN.manifestComplete(m);
    assert.strictEqual(r.ok, false);
    assert.ok(r.problems.some((p) => p.includes('does not match')));
  });

  group('generation: publication ordering & crash table (§20)');

  t('success ordering requires verified + durable + published bytes', () => {
    assert.strictEqual(GEN.successOrderingOk({}).ok, false);
    assert.strictEqual(GEN.successOrderingOk({ bytesVerified: true, durablyPersisted: true, published: false }).ok, false);
    const ok = GEN.successOrderingOk({ bytesVerified: true, durablyPersisted: true, published: true });
    assert.strictEqual(ok.ok, true, ok.reason);
  });

  t('the §20 crash table classifies each crash point', () => {
    const b = { prepared: false, published: false, terminalCommitted: false, retainedBytesIntact: false };
    assert.strictEqual(GEN.deliveryCrashDisposition({ ...b }).disposition, 'NON_SUCCESSFUL_UNDELIVERED');
    assert.strictEqual(GEN.deliveryCrashDisposition({ ...b, prepared: true }).disposition, 'NON_SUCCESSFUL_UNDELIVERED');
    assert.strictEqual(GEN.deliveryCrashDisposition({ ...b, prepared: true, published: true }).disposition, 'NON_SUCCESSFUL_NOT_ACCEPTED');
    const afterTerminal = GEN.deliveryCrashDisposition({ prepared: true, published: true, terminalCommitted: true, retainedBytesIntact: true });
    assert.strictEqual(afterTerminal.disposition, 'SUCCESS_REPORTED');
    const corrupt = GEN.deliveryCrashDisposition({ prepared: true, published: true, terminalCommitted: true, retainedBytesIntact: false });
    assert.strictEqual(corrupt.disposition, 'UNAVAILABLE_OR_CORRUPT_NO_REGENERATE');
  });

  group('generation: retention (§20)');

  t('retention must be declared with capacity and a forward expiry', () => {
    const r = GEN.retentionDeclared(Object.assign(GEN.defaultRetention('2026-09-15T09:00:00.000Z'), { reservedCapacity: 1024 }));
    assert.strictEqual(r.ok, true, JSON.stringify(r.problems));
    assert.strictEqual(GEN.retentionDeclared({}).ok, false);
    const backward = GEN.retentionDeclared({ start: '2026-09-20', expiry: '2026-09-10', releasePolicy: 'X', reservedCapacity: 1 });
    assert.strictEqual(backward.ok, false);
    assert.ok(backward.problems.some((p) => p.includes('expiry must be after start')));
    const noCapacity = GEN.retentionDeclared(Object.assign(GEN.defaultRetention('2026-09-15T09:00:00.000Z'), { reservedCapacity: 0 }));
    assert.strictEqual(noCapacity.ok, false);
  });

  t('default retention is seven days (§20)', () => {
    const def = GEN.defaultRetention('2026-09-15T09:00:00.000Z');
    assert.strictEqual(def.expiry, '2026-09-22T09:00:00.000Z');
  });

  group('generation: end-to-end composition (units 7-9)');

  t('a frozen, manifest-published generation satisfies §21 acceptance preconditions', () => {
    const rules = CAP.normalizeRules({ include: ['src/'], exclude: [], excludeDirty: true });
    const manifest = CAP.buildBaselineManifest({
      paths: ['src/a.js', '.git/HEAD', 'src/b.js'],
      manifestIdentity: 'sha256:' + '0'.repeat(64),
      rules,
    });
    assert.strictEqual(manifest.included.length, 2);       // .git excluded as administration
    assert.strictEqual(manifest.excluded[0].reason, 'git administration is not source content');

    // Freeze the generation: barrier 1 then barrier 2, both qualified.
    const b1 = GEN.canCloseMutation({
      mutationAdmissionClosed: true, writeGrantsRetired: true,
      mutatorsDrainedOrFenced: true, mutatorsReconciled: true,
    });
    const treeDigest = contentId(manifest.digest);
    const g = REC.createGeneration({ generationId: 'gen-1', taskId: 'task-1', incarnationId: 'inc-1' });
    g.state = REC.GenerationState.MUTATION_CLOSED;
    g.barrier1ClosedAt = '2026-09-15T09:00:00.000Z';
    g.treeDigest = treeDigest;
    const fr = GEN.freezeReadiness({
      generation: g,
      materialization: {
        barrier1Closed: b1.ok, bytesVerified: true, treeDigestVerified: true,
        createOnceIdentity: GEN.createOnceIdentity({ generationId: 'gen-1', treeDigest }),
        retentionDeclared: GEN.retentionDeclared(Object.assign(GEN.defaultRetention('2026-09-15T09:00:00.000Z'), { reservedCapacity: 1024 })).ok,
        qualifiedMaterializer: true,
      },
    });
    assert.strictEqual(fr.status, GEN.FreezeStatus.READY, JSON.stringify(fr));

    // Delivery manifest: complete and verifiably bound to the frozen generation.
    const dm = GEN.buildDeliveryManifest({
      selectedBaselineIdentity: 'sha256:' + '1'.repeat(64),
      acceptedGenerationAndTreeDigest: treeDigest,
      completePayloadDigest: contentId('payload-bytes'),
      includedEntries: [
        { path: 'src/a.js', type: 'file', mode: 0o644, contentId: contentId('aaaa'), size: 4 },
      ],
      newFilesAndDeletions: { newFiles: ['src/a.js'], deletions: [] },
      explicitlyExcludedInputs: [],
      runtimeAndVerificationInputManifest: { node: 'node@26.x', recipe: 'native-full-suite' },
      acceptanceContractAndEvidenceIdentities: { contractDigest: 'c1', evidenceDigests: ['e1'] },
      publicationIdentityAndState: { identity: 'pub-1', persistenceState: 'PUBLISHED' },
      retention: GEN.defaultRetention('2026-09-15T09:00:00.000Z'),
    });
    assert.strictEqual(GEN.manifestComplete(dm).ok, true, JSON.stringify(GEN.manifestComplete(dm).problems));

    // Success ordering: bytes verified, durably persisted, published.
    const order = GEN.successOrderingOk({ bytesVerified: true, durablyPersisted: true, published: true });
    assert.strictEqual(order.ok, true);

    // §21 final reduction consumes these as the frozen-identity + payload facts.
    const r = ACC.reduceAcceptance({
      inventory: [{ requirementId: 'R1', mandatoryOrOptional: 'mandatory', applicability: 'APPLICABLE', mappedObligationIds: ['obl-1'] }],
      obligations: [{
        obligationId: 'obl-1', mandatoryStatus: 'mandatory',
        applicabilityAndDomain: 'x', predicateFamily: ACC.PredicateFamily.EXTERNAL_BEHAVIORAL_CASE,
        requiredObservationTypes: ['candidate_stdout', 'candidate_stderr', 'exit_code', 'exit_signal', 'timeout', 'expected_value'],
        requiredScopeAndCompleteness: 'y', parametersAndExpectedValues: { expectedExit: 0 },
        predicateAdapterId: 'native-cli-observer', predicateVersion: 3,
        permittedEvidenceSources: ['protected-observer'],
      }],
      observations: [{ obligationId: 'obl-1', valid: true, applicable: true, evaluation: 'predicate_satisfied', completeness: 'complete' }],
      evidenceCoherent: true,
      frozenGenerationId: g.generationId,
      derivationEstablished: true,
      quiescenceProven: true,
      payloadManifestComplete: order.ok && GEN.manifestComplete(dm).ok,
      cleanAuthorityOwnership: true,
    });
    assert.strictEqual(r.accepted, true, JSON.stringify(r.reasons));
    assert.strictEqual(r.assurance, REC.Assurance.VERIFIED_REQUIRED_CHECKS);
  });
};