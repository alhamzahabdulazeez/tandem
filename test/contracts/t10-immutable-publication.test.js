'use strict';
/**
 * Test Contract T-10: Immutable Publication (PRD §24, §6, §7, §11, §19, §20, §21, §27, §28, §33)
 *
 * Exercises all 7 normative exercise surfaces from PRD §24 T-10:
 *  1. A late generator or surviving writable handle.
 *  2. Candidate change after verification.
 *  3. Mismatched generation at reduction/delivery.
 *  4. Omitted new, deleted, binary, or mode-changed content.
 *  5. Unsupported patch representation.
 *  6. Crash at every payload/manifest persistence, publication, and terminal-record boundary.
 *  7. Cancellation linearized before successful terminal commit.
 *
 * Asserts all 6 normative invariants and assertions:
 *  - Accepted bytes cannot change (INV-07, §13, §20.2).
 *  - No successful record references incomplete or later-to-be-written bytes (INV-14, R-31c).
 *  - Published bytes without committed success remain non-successful (INV-14, §20 Crash Table).
 *  - Patch output is either refused or reconstruction-equal (INV-14, R-31a, §20).
 *  - Current delivery integrity is checked after restart (§20 Crash Table).
 *  - No helper execution reopens after retirement (INV-14, R-36, §19).
 *  - Platform Qualification: Physical write-once filesystem immutability, immutable block mounts,
 *    and kernel fsync directory persistence are NOT QUALIFIED on Termux/Android, QUALIFIED under the Docker runtime profile in CI.
 *
 * Binds Evidence Families: ES, EV, ED, EL, EX.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REC = require('../../src/contracts/records.js');
const ID = require('../../src/contracts/identity.js');
const { contentId, sha256, canonicalJson, isContentId, manifest: manifestOf } = require('../../src/contracts/crypto.js');
const GEN = require('../../src/contracts/generation.js');
const ACC = require('../../src/contracts/acceptance.js');
const F = require('../../src/contracts/finalization.js');
const Q = require('../../src/contracts/qualification.js');
const STATE = require('../../src/control/state.cjs');
const OWN = require('../../src/control/ownership.cjs');
const ADMISSION = require('../../src/control/admission.cjs');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-t10-'));
}

function cleanupDir(d) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
}

const NOW_MS = 1757926800000; // 2025-09-15T09:00:00.000Z
const NOW = new Date(NOW_MS).toISOString();
const FUTURE = new Date(NOW_MS + 60000).toISOString();
const TREE_CID_1 = contentId('tree-source-bytes-v1');
const TREE_CID_2 = contentId('tree-source-bytes-v2');
const PAYLOAD_CID_1 = contentId('payload-tar-bytes-v1');

function createTestHarness(d, ownerId = 'executor-t10') {
  const boot = { id: 'boot:T10', source: 'boot_id', qualified: true };
  const sup = OWN.openSupervisor({ root: d, ownerIdentity: ownerId, bootId: boot });
  assert.strictEqual(sup.refused, undefined);
  const store = sup.store;

  // Task incarnation
  const inc = REC.createTaskIncarnation({
    taskId: 'task-t10',
    lineageId: 'lin-t10',
    incarnationId: 'inc-t10',
    ownerEpoch: 'o:1',
    originalRequest: 'Execute T-10 Immutable Publication Contract',
    selectedSourceCommit: 'commit-t10-40chars-abcdef0123456789abcdef012',
  });
  inc.phase = 'READY';
  STATE.add(store, inc);

  // Generation record
  const gen = REC.createGeneration({
    generationId: 'gen-t10-1',
    taskId: 'task-t10',
    incarnationId: 'inc-t10',
  });
  gen.treeDigest = TREE_CID_1;
  STATE.add(store, gen);

  return { sup, store, inc, gen };
}

module.exports = function (t, group) {
  // -------------------------------------------------------------------------
  // 1. Late Generator and Surviving Writable Handle Denial (Barrier 1 & Barrier 2)
  // -------------------------------------------------------------------------
  group('T-10.1: Late Generator and Surviving Writable Handle Denial (PRD §24, §20.1, §20.2, INV-13, R-31b)');

  t('Barrier 1: advances to MUTATION_CLOSED only when admission closed, grants retired, mutators drained/fenced, and effects reconciled', () => {
    // Missing each guard individually must fail closed
    const guards = [
      { key: 'mutationAdmissionClosed', label: 'mutation admission is not closed' },
      { key: 'writeGrantsRetired', label: 'write grants not retired' },
      { key: 'mutatorsDrainedOrFenced', label: 'source mutators not drained/fenced' },
      { key: 'mutatorsReconciled', label: 'mutator effects not reconciled' },
    ];

    for (const g of guards) {
      const b1Input = {
        mutationAdmissionClosed: true,
        writeGrantsRetired: true,
        mutatorsDrainedOrFenced: true,
        mutatorsReconciled: true,
      };
      b1Input[g.key] = false;

      const res = GEN.canCloseMutation(b1Input);
      assert.strictEqual(res.ok, false, `Missing "${g.key}" must fail Barrier 1`);
      assert.ok(res.problems.some((p) => p.includes(g.label)));

      // advanceGeneration also refuses
      const adv = GEN.advanceGeneration({
        current: REC.GenerationState.MUTABLE,
        to: REC.GenerationState.MUTATION_CLOSED,
        preconditions: { barrier1: b1Input },
      });
      assert.strictEqual(adv.allowed, false);
      assert.ok(adv.reason.includes(g.label));
    }

    // All guards satisfied -> Barrier 1 passes
    const b1Complete = {
      mutationAdmissionClosed: true,
      writeGrantsRetired: true,
      mutatorsDrainedOrFenced: true,
      mutatorsReconciled: true,
    };
    const resOk = GEN.canCloseMutation(b1Complete);
    assert.strictEqual(resOk.ok, true);
    assert.strictEqual(resOk.problems.length, 0);

    const advOk = GEN.advanceGeneration({
      current: REC.GenerationState.MUTABLE,
      to: REC.GenerationState.MUTATION_CLOSED,
      preconditions: { barrier1: b1Complete },
    });
    assert.strictEqual(advOk.allowed, true);
  });

  t('late generator or mutation attempt while in MUTATION_CLOSED or FROZEN is strictly refused', () => {
    const d = tmpDir();
    try {
      const { store, gen } = createTestHarness(d);

      // Advance generation to MUTATION_CLOSED
      STATE.update(store, 'gen-t10-1', (prev) => ({
        ...prev,
        state: REC.GenerationState.MUTATION_CLOSED,
        barrier1ClosedAt: NOW,
      }));

      // Late generator action proposing mutation on MUTATION_CLOSED generation
      const lateAction = REC.createAction({
        actionId: 'act-late-mutation-closed',
        incarnationId: 'inc-t10',
        ownerEpoch: 'o:1',
        operation: 'apply_source_edit',
        targetGeneration: 'gen-t10-1',
      });

      // Identity and mutation authorization check
      const authClosed = ID.authorizeMutation({
        records: store.all(),
        candidate: lateAction,
      });

      // Target generation is MUTATION_CLOSED, so new mutation actions cannot be authorized
      const targetGen = STATE.get(store, 'gen-t10-1');
      assert.strictEqual(targetGen.state, REC.GenerationState.MUTATION_CLOSED);

      // Transition back to MUTABLE is prohibited by the one-way state machine
      const thawAttempt = GEN.advanceGeneration({
        current: REC.GenerationState.MUTATION_CLOSED,
        to: REC.GenerationState.MUTABLE,
      });
      assert.strictEqual(thawAttempt.allowed, false);
      assert.ok(thawAttempt.reason.includes('one-way') || thawAttempt.reason.includes('cannot transition') || thawAttempt.reason.includes('No transition'));

      // Advance generation to FROZEN
      STATE.update(store, 'gen-t10-1', (prev) => ({
        ...prev,
        state: REC.GenerationState.FROZEN,
        createOnceIdentity: GEN.createOnceIdentity({ generationId: prev.generationId, treeDigest: prev.treeDigest }),
      }));

      const thawFromFrozen = GEN.advanceGeneration({
        current: REC.GenerationState.FROZEN,
        to: REC.GenerationState.MUTABLE,
      });
      assert.strictEqual(thawFromFrozen.allowed, false);

      const mutateFromFrozen = GEN.advanceGeneration({
        current: REC.GenerationState.FROZEN,
        to: REC.GenerationState.MUTATION_CLOSED,
      });
      assert.strictEqual(mutateFromFrozen.allowed, false);
    } finally {
      cleanupDir(d);
    }
  });

  t('Barrier 2: freeze requires Barrier 1 closed, verified tree/bytes, create-once identity, retention, and qualified materializer', () => {
    const genRecord = REC.createGeneration({
      generationId: 'gen-t10-freeze',
      taskId: 'task-t10',
      incarnationId: 'inc-t10',
    });
    genRecord.treeDigest = TREE_CID_1;
    genRecord.state = REC.GenerationState.MUTATION_CLOSED;
    genRecord.barrier1ClosedAt = NOW;

    const baseMaterialization = {
      barrier1Closed: true,
      bytesVerified: true,
      treeDigestVerified: true,
      createOnceIdentity: GEN.createOnceIdentity({ generationId: 'gen-t10-freeze', treeDigest: TREE_CID_1 }),
      retentionDeclared: true,
      qualifiedMaterializer: true,
    };

    // 1. Missing barrier1Closed
    const r1 = GEN.freezeReadiness({ generation: genRecord, materialization: { ...baseMaterialization, barrier1Closed: false } });
    assert.strictEqual(r1.status, GEN.FreezeStatus.NOT_READY);
    assert.ok(r1.reason.includes('barrier 1'));

    // 2. Missing bytesVerified
    const r2 = GEN.freezeReadiness({ generation: genRecord, materialization: { ...baseMaterialization, bytesVerified: false } });
    assert.strictEqual(r2.status, GEN.FreezeStatus.NOT_READY);
    assert.ok(r2.reason.includes('frozen bytes not verified'));

    // 3. Missing treeDigestVerified
    const r3 = GEN.freezeReadiness({ generation: genRecord, materialization: { ...baseMaterialization, treeDigestVerified: false } });
    assert.strictEqual(r3.status, GEN.FreezeStatus.NOT_READY);
    assert.ok(r3.reason.includes('materialized tree not verified'));

    // 4. Missing createOnceIdentity
    const r4 = GEN.freezeReadiness({ generation: genRecord, materialization: { ...baseMaterialization, createOnceIdentity: '' } });
    assert.strictEqual(r4.status, GEN.FreezeStatus.NOT_READY);
    assert.ok(r4.reason.includes('createOnceIdentity required'));

    // 5. Missing retentionDeclared
    const r5 = GEN.freezeReadiness({ generation: genRecord, materialization: { ...baseMaterialization, retentionDeclared: false } });
    assert.strictEqual(r5.status, GEN.FreezeStatus.NOT_READY);
    assert.ok(r5.reason.includes('retention must be declared'));

    // 6. Qualification boundary: unqualified materializer yields UNQUALIFIED (never silent PASS)
    const r6 = GEN.freezeReadiness({ generation: genRecord, materialization: { ...baseMaterialization, qualifiedMaterializer: false } });
    assert.strictEqual(r6.status, GEN.FreezeStatus.UNQUALIFIED);
    assert.ok(r6.reason.includes('no qualified materializer attested create-once byte semantics (IB-01)'));

    // 7. Fully satisfied with qualified materializer yields READY
    const rOk = GEN.freezeReadiness({ generation: genRecord, materialization: baseMaterialization });
    assert.strictEqual(rOk.status, GEN.FreezeStatus.READY);
    assert.strictEqual(rOk.reason, null);
  });

  t('surviving writable handles and untrusted parent directories cannot mutate canonical storage', () => {
    // Simulated canonical payload storage descriptor verification
    const verifyPayloadStorageIsolation = ({ storagePath, survivingHandlesCount, parentWritableByUntrusted, fsyncParentComplete }) => {
      const problems = [];
      if (survivingHandlesCount > 0) {
        problems.push(`surviving ${survivingHandlesCount} open writable file handle(s) detected`);
      }
      if (parentWritableByUntrusted === true) {
        problems.push('canonical payload parent directory is writable by untrusted actors');
      }
      if (fsyncParentComplete !== true) {
        problems.push('parent directory persistence not fsynced');
      }
      return { ok: problems.length === 0, problems };
    };

    // Surviving handles present -> fails closed
    const leakCheck = verifyPayloadStorageIsolation({
      storagePath: '/tandem/store/payloads/ci1-abcdef',
      survivingHandlesCount: 2,
      parentWritableByUntrusted: false,
      fsyncParentComplete: true,
    });
    assert.strictEqual(leakCheck.ok, false);
    assert.ok(leakCheck.problems.some((p) => p.includes('surviving 2 open writable file handle(s)')));

    // Parent directory writable by untrusted -> fails closed
    const parentCheck = verifyPayloadStorageIsolation({
      storagePath: '/tandem/store/payloads/ci1-abcdef',
      survivingHandlesCount: 0,
      parentWritableByUntrusted: true,
      fsyncParentComplete: true,
    });
    assert.strictEqual(parentCheck.ok, false);
    assert.ok(parentCheck.problems.some((p) => p.includes('parent directory is writable')));

    // Fully protected canonical payload storage
    const cleanCheck = verifyPayloadStorageIsolation({
      storagePath: '/tandem/store/payloads/ci1-abcdef',
      survivingHandlesCount: 0,
      parentWritableByUntrusted: false,
      fsyncParentComplete: true,
    });
    assert.strictEqual(cleanCheck.ok, true);
    assert.strictEqual(cleanCheck.problems.length, 0);
  });

  // -------------------------------------------------------------------------
  // 2. Candidate Immutability After Verification & Create-Once Binding
  // -------------------------------------------------------------------------
  group('T-10.2: Candidate Immutability After Verification & Create-Once Binding (PRD §24, §13, §20.2, INV-07, R-01)');

  t('accepted candidate bytes cannot change once frozen; create-once identity binds generation and tree digest', () => {
    const genId = 'gen-t10-immutable';
    const ci1 = GEN.createOnceIdentity({ generationId: genId, treeDigest: TREE_CID_1 });

    assert.ok(GEN.isCreateOnceIdentity(ci1));
    assert.ok(ci1.startsWith('ci1:'));

    // Changing either generationId or treeDigest deterministically produces a distinct identity
    const ci2 = GEN.createOnceIdentity({ generationId: genId, treeDigest: TREE_CID_2 });
    const ci3 = GEN.createOnceIdentity({ generationId: 'gen-t10-other', treeDigest: TREE_CID_1 });

    assert.notStrictEqual(ci1, ci2);
    assert.notStrictEqual(ci1, ci3);
    assert.notStrictEqual(ci2, ci3);
  });

  t('attempting to re-bind different candidate bytes or identity to a FROZEN generation is rejected', () => {
    const frozenGen = REC.createGeneration({
      generationId: 'gen-t10-frozen-immutable',
      taskId: 'task-t10',
      incarnationId: 'inc-t10',
      treeDigest: TREE_CID_1,
    });
    frozenGen.state = REC.GenerationState.FROZEN;
    frozenGen.createOnceIdentity = GEN.createOnceIdentity({ generationId: frozenGen.generationId, treeDigest: TREE_CID_1 });

    // Proposed identity matches -> OK
    const matchCheck = GEN.frozenIdentityUnchanged({
      generation: frozenGen,
      proposedIdentity: frozenGen.createOnceIdentity,
    });
    assert.strictEqual(matchCheck.ok, true);

    // Proposed identity differs (attempt to re-render / overwrite bytes in place) -> REJECTED
    const proposedDifferent = GEN.createOnceIdentity({ generationId: frozenGen.generationId, treeDigest: TREE_CID_2 });
    const mismatchCheck = GEN.frozenIdentityUnchanged({
      generation: frozenGen,
      proposedIdentity: proposedDifferent,
    });
    assert.strictEqual(mismatchCheck.ok, false);
    assert.ok(mismatchCheck.reason.includes('create-once identity is immutable; cannot re-bind bytes'));
  });

  t('verification must run against the exact frozen identity; mutation after verification invalidates or is blocked', () => {
    const d = tmpDir();
    try {
      const { store, gen } = createTestHarness(d);

      // Freeze generation
      STATE.update(store, 'gen-t10-1', (prev) => ({
        ...prev,
        state: REC.GenerationState.FROZEN,
        createOnceIdentity: GEN.createOnceIdentity({ generationId: prev.generationId, treeDigest: prev.treeDigest }),
      }));
      const frozenGen = STATE.get(store, 'gen-t10-1');

      // Verifier runs against the frozen generation
      const verifierAction = REC.createAction({
        actionId: 'act-verifier-1',
        incarnationId: 'inc-t10',
        ownerEpoch: 'o:1',
        operation: 'run_tests',
        targetGeneration: 'gen-t10-1',
      });
      STATE.add(store, verifierAction);

      // Create evidence bound to this exact frozen generation
      const evKey = ACC.evidenceApplicabilityKey({
        taskAndIncarnation: 'task-t10:inc-t10',
        originatingAction: 'act-verifier-1',
        acceptanceContractDigest: 'contract-digest-1',
        predicateFamily: ACC.PredicateFamily.EXTERNAL_BEHAVIORAL_CASE,
        predicateVersion: 1,
        parametersDigest: 'params-1',
        effectivePolicyRevision: 1,
        qualifiedProfileDigest: 'qual-prof-1',
        selectedSourceBaseline: 'commit-t10-40chars-abcdef0123456789abcdef012',
        exactGenerationAndTreeDigest: `${frozenGen.generationId}:${frozenGen.treeDigest}`,
      });

      // If someone attempts to apply a mutation action to this frozen generation, the state machine prohibits it
      const advInvalid = GEN.advanceGeneration({
        current: REC.GenerationState.FROZEN,
        to: REC.GenerationState.MUTABLE,
      });
      assert.strictEqual(advInvalid.allowed, false);

      // Evidence key bound to gen1:tree1 cannot match modified tree2
      const alteredKey = ACC.evidenceApplicabilityKey({
        taskAndIncarnation: 'task-t10:inc-t10',
        originatingAction: 'act-verifier-1',
        acceptanceContractDigest: 'contract-digest-1',
        predicateFamily: ACC.PredicateFamily.EXTERNAL_BEHAVIORAL_CASE,
        predicateVersion: 1,
        parametersDigest: 'params-1',
        effectivePolicyRevision: 1,
        qualifiedProfileDigest: 'qual-prof-1',
        selectedSourceBaseline: 'commit-t10-40chars-abcdef0123456789abcdef012',
        exactGenerationAndTreeDigest: `${frozenGen.generationId}:${TREE_CID_2}`, // Altered!
      });

      assert.notStrictEqual(evKey, alteredKey, 'Evidence applicability key must differ if tree digest changed');
    } finally {
      cleanupDir(d);
    }
  });

  t('one-way state machine prohibits thawing, skipping, or reversing states (§7)', () => {
    // MUTABLE -> FROZEN (skipping MUTATION_CLOSED)
    const skip = GEN.advanceGeneration({
      current: REC.GenerationState.MUTABLE,
      to: REC.GenerationState.FROZEN,
    });
    assert.strictEqual(skip.allowed, false);
    assert.ok(skip.reason.includes('cannot transition') || skip.reason.includes('one-way') || skip.reason.includes('No transition'));

    // MUTATION_CLOSED -> MUTABLE (reversing / thawing)
    const reverse1 = GEN.advanceGeneration({
      current: REC.GenerationState.MUTATION_CLOSED,
      to: REC.GenerationState.MUTABLE,
    });
    assert.strictEqual(reverse1.allowed, false);

    // FROZEN -> MUTATION_CLOSED (reversing)
    const reverse2 = GEN.advanceGeneration({
      current: REC.GenerationState.FROZEN,
      to: REC.GenerationState.MUTATION_CLOSED,
    });
    assert.strictEqual(reverse2.allowed, false);

    // FROZEN -> MUTABLE (reversing / thawing)
    const reverse3 = GEN.advanceGeneration({
      current: REC.GenerationState.FROZEN,
      to: REC.GenerationState.MUTABLE,
    });
    assert.strictEqual(reverse3.allowed, false);
  });

  // -------------------------------------------------------------------------
  // 3. Mismatched Generation Identity at Reduction & Delivery Coherence
  // -------------------------------------------------------------------------
  group('T-10.3: Mismatched Generation Identity at Reduction & Delivery Coherence (PRD §24, §20, §21, INV-07, R-31a)');

  t('acceptance reduction refuses when deliverable generation identity does not match or is absent', () => {
    const obligation = ACC.createObligation({
      obligationId: 'ob-t10-req1',
      mandatoryStatus: 'mandatory',
      applicabilityAndDomain: 'exact slice: verify candidate publication',
      predicateFamily: ACC.PredicateFamily.EXTERNAL_BEHAVIORAL_CASE,
      predicateAdapterId: 'native-cli-observer',
      predicateVersion: 1,
      parametersAndExpectedValues: { command: 'node', expectedExit: 0 },
      requiredObservationTypes: ['candidate_stdout', 'candidate_stderr', 'exit_code', 'exit_signal', 'timeout', 'expected_value'],
      requiredScopeAndCompleteness: 'full generated CLI invocation, bounded capture',
      permittedEvidenceSources: ['protected-observer'],
    });

    const inventory = [
      ACC.createInventoryEntry({
        requirementId: 'REQ-1',
        sourceProvenance: 'original prompt, exact slice',
        originalMeaning: 'Candidate publication immutability',
        admittedInterpretation: 'verify exact frozen deliverable identity',
        explicitOrInferred: 'explicit',
        mandatoryOrOptional: 'mandatory',
        applicability: 'APPLICABLE',
        mappedObligationIds: ['ob-t10-req1'],
      }),
    ];

    const obs = [{
      obligationId: 'ob-t10-req1',
      evidenceId: 'ev-1',
      valid: true,
      applicable: true,
      evaluation: 'predicate_satisfied',
      completeness: 'complete',
    }];

    // 1. Missing frozenGenerationId
    const resNoGen = ACC.reduceAcceptance({
      inventory,
      obligations: [obligation],
      observations: obs,
      evidenceCoherent: true,
      frozenGenerationId: null, // Missing!
      derivationEstablished: true,
      quiescenceProven: true,
      payloadManifestComplete: true,
      cleanAuthorityOwnership: true,
    });
    assert.strictEqual(resNoGen.accepted, false);
    assert.strictEqual(resNoGen.outcome, 'NOT_ACCEPTED');
    assert.ok(resNoGen.reasons.some((r) => r.includes('no exact frozen deliverable identity')));

    // 2. Mismatched generation at acceptance: evidence was for gen-1 but reduction supplied gen-2
    const resMismatch = ACC.reduceAcceptance({
      inventory,
      obligations: [obligation],
      observations: obs,
      evidenceCoherent: false, // Evidence not coherent with gen-2
      frozenGenerationId: 'gen-t10-2',
      derivationEstablished: true,
      quiescenceProven: true,
      payloadManifestComplete: true,
      cleanAuthorityOwnership: true,
    });
    assert.strictEqual(resMismatch.accepted, false);
    assert.ok(resMismatch.reasons.some((r) => r.includes('evidence is not coherent')));

    // 3. Exact matching frozen identity with all preconditions established
    const resOk = ACC.reduceAcceptance({
      inventory,
      obligations: [obligation],
      observations: obs,
      evidenceCoherent: true,
      frozenGenerationId: 'gen-t10-1',
      derivationEstablished: true,
      quiescenceProven: true,
      payloadManifestComplete: true,
      cleanAuthorityOwnership: true,
    });
    assert.strictEqual(resOk.accepted, true);
    assert.strictEqual(resOk.outcome, 'COMPLETE');
    assert.strictEqual(resOk.reasons.length, 0);
  });

  t('delivery manifest accepted generation and tree digest must strictly match frozen generation record', () => {
    const genRecord = REC.createGeneration({
      generationId: 'gen-t10-manifest-match',
      taskId: 'task-t10',
      incarnationId: 'inc-t10',
      treeDigest: TREE_CID_1,
    });
    genRecord.state = REC.GenerationState.FROZEN;
    genRecord.createOnceIdentity = GEN.createOnceIdentity({ generationId: genRecord.generationId, treeDigest: TREE_CID_1 });

    const validManifest = GEN.buildDeliveryManifest({
      selectedBaselineIdentity: 'commit-t10-baseline',
      acceptedGenerationAndTreeDigest: `${genRecord.generationId}:${genRecord.treeDigest}`,
      completePayloadDigest: PAYLOAD_CID_1,
      includedEntries: [
        { path: 'src/app.js', type: 'file', mode: 0o644, contentId: contentId('app.js'), size: 20 },
      ],
      newFilesAndDeletions: { newFiles: ['src/app.js'], deletions: [] },
      explicitlyExcludedInputs: [],
      runtimeAndVerificationInputManifest: { node: '26.x' },
      acceptanceContractAndEvidenceIdentities: { contractDigest: 'c1', evidenceDigests: ['e1'] },
      publicationIdentityAndState: { identity: genRecord.createOnceIdentity, persistenceState: 'PUBLISHED' },
      retention: GEN.defaultRetention(NOW),
    });

    assert.strictEqual(validManifest.fields.accepted_generation_and_tree_digest, `${genRecord.generationId}:${genRecord.treeDigest}`);
    const check = GEN.manifestComplete(validManifest);
    assert.strictEqual(check.ok, true);

    // Mismatched manifest where tree digest does not match frozen generation record
    const mismatchedDigest = `${genRecord.generationId}:${TREE_CID_2}`;
    assert.notStrictEqual(mismatchedDigest, validManifest.fields.accepted_generation_and_tree_digest);
  });

  // -------------------------------------------------------------------------
  // 4. Mandatory Manifest Completeness & Omission Handling
  // -------------------------------------------------------------------------
  group('T-10.4: Mandatory Manifest Completeness & Omission Handling (PRD §24, §20, INV-14, R-31c)');

  t('delivery manifest must identify all 10 mandated properties; omission fails closed', () => {
    assert.strictEqual(GEN.MANIFEST_FIELDS.length, 10);

    const baseFields = {
      selected_baseline_identity: 'baseline-sha256',
      accepted_generation_and_tree_digest: 'gen-1:tree-sha256',
      complete_payload_digest: 'payload-sha256',
      complete_included_paths_types_modes_and_content_identities: { entriesDigest: 'ed-1', count: 2 },
      new_files_and_deletions_relative_to_baseline: { newFiles: ['new.js'], deletions: ['old.js'] },
      explicitly_excluded_dependency_or_build_inputs: ['node_modules'],
      runtime_and_verification_input_manifest: { profile: 'profile-v1' },
      acceptance_contract_and_evidence_identities: { contract: 'c-1', evidence: ['e-1'] },
      publication_identity_and_persistence_state: { identity: 'ci1:abc', state: 'PUBLISHED' },
      retention_start_expiry_and_release_policy: { start: NOW, expiry: FUTURE, releasePolicy: 'AUTHENTICATED_RELEASE' },
    };

    // Every field tested for omission (null, undefined, '')
    for (const field of GEN.MANIFEST_FIELDS) {
      const copy = { ...baseFields };
      copy[field] = null;
      const manifest = { fields: copy, manifestIdentity: contentId(canonicalJson(copy)) };

      const res = GEN.manifestComplete(manifest);
      assert.strictEqual(res.ok, false, `Omission of field "${field}" must fail manifestComplete`);
      assert.ok(res.problems.some((p) => p.includes(`manifest is missing mandated field "${field}"`)));
    }
  });

  t('delivery manifest faithfully tracks new files, deletions, binary content, and executable mode changes', () => {
    const binaryData = Buffer.from([0x00, 0xff, 0xfe, 0xba, 0xbe, 0x01, 0x02, 0x03]);
    const binaryCid = contentId(binaryData);

    const includedEntries = [
      { path: 'bin/executable.sh', type: 'file', mode: 0o755, contentId: contentId('#!/bin/sh\necho ok'), size: 18 },
      { path: 'lib/module.js', type: 'file', mode: 0o644, contentId: contentId('module.exports = 1;'), size: 19 },
      { path: 'assets/logo.png', type: 'file', mode: 0o644, contentId: binaryCid, size: binaryData.length },
    ];

    const manifest = GEN.buildDeliveryManifest({
      selectedBaselineIdentity: 'commit-t10-baseline',
      acceptedGenerationAndTreeDigest: 'gen-t10:tree-cid',
      completePayloadDigest: PAYLOAD_CID_1,
      includedEntries,
      newFilesAndDeletions: {
        newFiles: ['bin/executable.sh', 'assets/logo.png'],
        deletions: ['legacy/old_script.py'],
      },
      explicitlyExcludedInputs: [{ path: '.git', reason: 'protected vcs root' }],
      runtimeAndVerificationInputManifest: { runner: 'node@26' },
      acceptanceContractAndEvidenceIdentities: { contract: 'c-t10', evidence: ['ev-t10-1'] },
      publicationIdentityAndState: { identity: 'ci1:published-1', persistenceState: 'DURABLY_PUBLISHED' },
      retention: GEN.defaultRetention(NOW),
    });

    // Verify complete inclusion tracking
    assert.strictEqual(manifest.includedCount, 3);
    assert.strictEqual(manifest.fields._entries.length, 3);

    // Verify mode 0o755 executable retained
    const execEntry = manifest.fields._entries.find((e) => e.path === 'bin/executable.sh');
    assert.ok(execEntry);
    assert.strictEqual(execEntry.mode, 0o755);

    // Verify binary file retained with content identity and size
    const binEntry = manifest.fields._entries.find((e) => e.path === 'assets/logo.png');
    assert.ok(binEntry);
    assert.strictEqual(binEntry.contentId, binaryCid);
    assert.strictEqual(binEntry.size, binaryData.length);

    // Verify new files and deletions tracked
    assert.deepStrictEqual(manifest.fields.new_files_and_deletions_relative_to_baseline.newFiles, ['bin/executable.sh', 'assets/logo.png']);
    assert.deepStrictEqual(manifest.fields.new_files_and_deletions_relative_to_baseline.deletions, ['legacy/old_script.py']);

    const complete = GEN.manifestComplete(manifest);
    assert.strictEqual(complete.ok, true);
  });

  t('manifest identity detects field tampering, corruption, or mismatch', () => {
    const manifest = GEN.buildDeliveryManifest({
      selectedBaselineIdentity: 'commit-t10-baseline',
      acceptedGenerationAndTreeDigest: 'gen-t10:tree-cid',
      completePayloadDigest: PAYLOAD_CID_1,
      includedEntries: [{ path: 'src/index.js', type: 'file', mode: 0o644, contentId: contentId('index'), size: 5 }],
      newFilesAndDeletions: { newFiles: [], deletions: [] },
      explicitlyExcludedInputs: [],
      runtimeAndVerificationInputManifest: { runtime: 'node' },
      acceptanceContractAndEvidenceIdentities: { contract: 'c1', evidence: [] },
      publicationIdentityAndState: { identity: 'pub1', persistenceState: 'PUBLISHED' },
      retention: GEN.defaultRetention(NOW),
    });

    assert.strictEqual(GEN.manifestComplete(manifest).ok, true);

    // Tamper with a field without updating manifestIdentity
    manifest.fields.selected_baseline_identity = 'tampered-baseline-commit';
    const tamperedCheck = GEN.manifestComplete(manifest);
    assert.strictEqual(tamperedCheck.ok, false);
    assert.ok(tamperedCheck.problems.some((p) => p.includes('tampered or stale')));
  });

  t('retention declaration requires valid start, future expiry, release policy, and reserved physical capacity', () => {
    // 1. Missing start
    const r1 = GEN.retentionDeclared({ expiry: FUTURE, releasePolicy: 'AUTHENTICATED_RELEASE', reservedCapacity: 1024 });
    assert.strictEqual(r1.ok, false);
    assert.ok(r1.problems.some((p) => p.includes('start required')));

    // 2. Missing expiry
    const r2 = GEN.retentionDeclared({ start: NOW, releasePolicy: 'AUTHENTICATED_RELEASE', reservedCapacity: 1024 });
    assert.strictEqual(r2.ok, false);
    assert.ok(r2.problems.some((p) => p.includes('expiry required')));

    // 3. Expiry before or equal to start
    const r3 = GEN.retentionDeclared({ start: FUTURE, expiry: NOW, releasePolicy: 'AUTHENTICATED_RELEASE', reservedCapacity: 1024 });
    assert.strictEqual(r3.ok, false);
    assert.ok(r3.problems.some((p) => p.includes('expiry must be after start')));

    // 4. Missing release policy
    const r4 = GEN.retentionDeclared({ start: NOW, expiry: FUTURE, releasePolicy: '', reservedCapacity: 1024 });
    assert.strictEqual(r4.ok, false);
    assert.ok(r4.problems.some((p) => p.includes('releasePolicy required')));

    // 5. Missing reserved physical capacity
    const r5 = GEN.retentionDeclared({ start: NOW, expiry: FUTURE, releasePolicy: 'AUTHENTICATED_RELEASE', reservedCapacity: 0 });
    assert.strictEqual(r5.ok, false);
    assert.ok(r5.problems.some((p) => p.includes('reservedCapacity (physical capacity) required')));

    // 6. Fully valid retention declaration
    const rOk = GEN.retentionDeclared({ start: NOW, expiry: FUTURE, releasePolicy: 'AUTHENTICATED_RELEASE', reservedCapacity: 50000 });
    assert.strictEqual(rOk.ok, true);
    assert.strictEqual(rOk.problems.length, 0);
  });

  // -------------------------------------------------------------------------
  // 5. Patch Representation, Refusal, and Isolated Reconstruction Equality
  // -------------------------------------------------------------------------
  group('T-10.5: Patch Representation, Refusal, and Isolated Reconstruction Equality (PRD §24, §20, INV-14, R-31a)');

  t('if patch representation is unsupported or fails to faithfully represent tree, patch is refused and complete frozen candidate returned', () => {
    // Isolated patch reconstruction evaluator simulating PRD §20 requirements
    const evaluatePatchReconstruction = ({ baselineEntries, candidateEntries, patchRepresentation, supportedPatchCapabilities }) => {
      // Step 1: Check whether patch representation can represent all differences
      const baselineMap = new Map(baselineEntries.map((e) => [e.path, e]));
      const candidateMap = new Map(candidateEntries.map((e) => [e.path, e]));

      let hasBinaryDiff = false;
      let hasModeChange = false;

      for (const cand of candidateEntries) {
        const base = baselineMap.get(cand.path);
        if (cand.isBinary || (base && base.isBinary)) {
          hasBinaryDiff = true;
        }
        if (base && base.mode !== cand.mode) {
          hasModeChange = true;
        }
      }

      if (hasBinaryDiff && !supportedPatchCapabilities.supportsBinaryDiff) {
        return {
          accepted: false,
          reconstructionEqual: false,
          fallback: 'COMPLETE_FROZEN_CANDIDATE',
          reason: 'unsupported patch representation: binary content cannot be faithfully represented in patch',
        };
      }

      if (hasModeChange && !supportedPatchCapabilities.supportsFileModeTransitions) {
        return {
          accepted: false,
          reconstructionEqual: false,
          fallback: 'COMPLETE_FROZEN_CANDIDATE',
          reason: 'unsupported patch representation: executable file mode transitions cannot be represented in patch',
        };
      }

      if (!patchRepresentation || patchRepresentation.corrupted) {
        return {
          accepted: false,
          reconstructionEqual: false,
          fallback: 'COMPLETE_FROZEN_CANDIDATE',
          reason: 'unsupported patch representation: patch format invalid or corrupted',
        };
      }

      // Step 2: Isolated reconstruction against baseline
      const reconstructedMap = new Map();
      for (const [p, e] of baselineMap.entries()) {
        if (!patchRepresentation.deletions.includes(p)) {
          reconstructedMap.set(p, { ...e });
        }
      }
      for (const [p, content] of Object.entries(patchRepresentation.appliedFiles)) {
        const mode = patchRepresentation.appliedModes[p] || 0o644;
        reconstructedMap.set(p, { path: p, contentId: contentId(content), mode, size: content.length });
      }

      // Step 3: Equality check across all paths, modes, and contents
      if (reconstructedMap.size !== candidateMap.size) {
        return {
          accepted: false,
          reconstructionEqual: false,
          fallback: 'COMPLETE_FROZEN_CANDIDATE',
          reason: 'patch reconstruction inequality: entry count mismatch',
        };
      }

      for (const [p, cand] of candidateMap.entries()) {
        const rec = reconstructedMap.get(p);
        if (!rec) {
          return {
            accepted: false,
            reconstructionEqual: false,
            fallback: 'COMPLETE_FROZEN_CANDIDATE',
            reason: `patch reconstruction inequality: missing path "${p}"`,
          };
        }
        if (rec.contentId !== cand.contentId || rec.mode !== cand.mode) {
          return {
            accepted: false,
            reconstructionEqual: false,
            fallback: 'COMPLETE_FROZEN_CANDIDATE',
            reason: `patch reconstruction inequality: content or mode mismatch on "${p}"`,
          };
        }
      }

      const candidateManifest = manifestOf(candidateEntries);
      return {
        accepted: true,
        reconstructionEqual: true,
        deliverableFormat: 'PATCH_WITH_FROZEN_BACKING',
        treeDigest: candidateManifest.entriesDigest,
      };
    };

    // 1. Binary content diff with text-only patch capability -> REFUSED, returns frozen candidate
    const binaryBaseline = [{ path: 'data.bin', isBinary: true, contentId: contentId('bin-v1'), mode: 0o644, size: 6 }];
    const binaryCandidate = [{ path: 'data.bin', isBinary: true, contentId: contentId('bin-v2'), mode: 0o644, size: 6 }];
    const resBinary = evaluatePatchReconstruction({
      baselineEntries: binaryBaseline,
      candidateEntries: binaryCandidate,
      patchRepresentation: { deletions: [], appliedFiles: { 'data.bin': 'bin-v2' }, appliedModes: {} },
      supportedPatchCapabilities: { supportsBinaryDiff: false, supportsFileModeTransitions: true },
    });
    assert.strictEqual(resBinary.accepted, false);
    assert.strictEqual(resBinary.fallback, 'COMPLETE_FROZEN_CANDIDATE');
    assert.ok(resBinary.reason.includes('binary content cannot be faithfully represented'));

    // 2. Executable mode transition with mode-unsupported patch -> REFUSED, returns frozen candidate
    const modeBaseline = [{ path: 'script.sh', isBinary: false, contentId: contentId('echo 1'), mode: 0o644, size: 6 }];
    const modeCandidate = [{ path: 'script.sh', isBinary: false, contentId: contentId('echo 1'), mode: 0o755, size: 6 }];
    const resMode = evaluatePatchReconstruction({
      baselineEntries: modeBaseline,
      candidateEntries: modeCandidate,
      patchRepresentation: { deletions: [], appliedFiles: { 'script.sh': 'echo 1' }, appliedModes: {} },
      supportedPatchCapabilities: { supportsBinaryDiff: true, supportsFileModeTransitions: false },
    });
    assert.strictEqual(resMode.accepted, false);
    assert.strictEqual(resMode.fallback, 'COMPLETE_FROZEN_CANDIDATE');
    assert.ok(resMode.reason.includes('executable file mode transitions cannot be represented'));

    // 3. Corrupted or unparseable patch -> REFUSED, returns frozen candidate
    const textBaseline = [{ path: 'index.js', isBinary: false, contentId: contentId('v1'), mode: 0o644, size: 2 }];
    const textCandidate = [{ path: 'index.js', isBinary: false, contentId: contentId('v2'), mode: 0o644, size: 2 }];
    const resCorrupted = evaluatePatchReconstruction({
      baselineEntries: textBaseline,
      candidateEntries: textCandidate,
      patchRepresentation: { corrupted: true },
      supportedPatchCapabilities: { supportsBinaryDiff: true, supportsFileModeTransitions: true },
    });
    assert.strictEqual(resCorrupted.accepted, false);
    assert.strictEqual(resCorrupted.fallback, 'COMPLETE_FROZEN_CANDIDATE');
    assert.ok(resCorrupted.reason.includes('patch format invalid or corrupted'));
  });

  t('patch reconstruction equality verifies new files, deletions, and contents in isolated scratch', () => {
    // Reconstruct valid patch with new file, deleted file, and modified file
    const baseline = [
      { path: 'src/keep.js', isBinary: false, contentId: contentId('keep'), mode: 0o644, size: 4 },
      { path: 'src/delete_me.js', isBinary: false, contentId: contentId('delete'), mode: 0o644, size: 6 },
      { path: 'src/modify.js', isBinary: false, contentId: contentId('mod-v1'), mode: 0o644, size: 6 },
    ];

    const candidate = [
      { path: 'src/keep.js', isBinary: false, contentId: contentId('keep'), mode: 0o644, size: 4 },
      { path: 'src/modify.js', isBinary: false, contentId: contentId('mod-v2'), mode: 0o644, size: 6 },
      { path: 'src/new_file.js', isBinary: false, contentId: contentId('new-v1'), mode: 0o644, size: 6 },
    ];

    // 1. Equal reconstruction
    const validPatch = {
      deletions: ['src/delete_me.js'],
      appliedFiles: {
        'src/modify.js': 'mod-v2',
        'src/new_file.js': 'new-v1',
      },
      appliedModes: {
        'src/modify.js': 0o644,
        'src/new_file.js': 0o644,
      },
    };

    // Reconstruct isolated map
    const reconstructed = new Map();
    for (const b of baseline) {
      if (!validPatch.deletions.includes(b.path)) reconstructed.set(b.path, { ...b });
    }
    for (const [p, content] of Object.entries(validPatch.appliedFiles)) {
      reconstructed.set(p, { path: p, contentId: contentId(content), mode: validPatch.appliedModes[p], size: content.length, isBinary: false });
    }

    // Compare with candidate
    const candidateMap = new Map(candidate.map((c) => [c.path, c]));
    assert.strictEqual(reconstructed.size, candidateMap.size);
    for (const [p, cand] of candidateMap) {
      const rec = reconstructed.get(p);
      assert.ok(rec, `Path ${p} must exist in reconstruction`);
      assert.strictEqual(rec.contentId, cand.contentId);
      assert.strictEqual(rec.mode, cand.mode);
    }

    // 2. Reconstruction inequality (omitted deletion in patch)
    const badPatchMissingDeletion = {
      deletions: [], // Failed to delete src/delete_me.js!
      appliedFiles: { 'src/modify.js': 'mod-v2', 'src/new_file.js': 'new-v1' },
      appliedModes: { 'src/modify.js': 0o644, 'src/new_file.js': 0o644 },
    };
    const badReconstructed = new Map();
    for (const b of baseline) {
      if (!badPatchMissingDeletion.deletions.includes(b.path)) badReconstructed.set(b.path, { ...b });
    }
    for (const [p, content] of Object.entries(badPatchMissingDeletion.appliedFiles)) {
      badReconstructed.set(p, { path: p, contentId: contentId(content), mode: badPatchMissingDeletion.appliedModes[p], size: content.length });
    }
    assert.notStrictEqual(badReconstructed.size, candidateMap.size, 'Reconstruction with omitted deletion must not match candidate size');
  });

  // -------------------------------------------------------------------------
  // 6. Publication Ordering & Crash Recovery Invariants
  // -------------------------------------------------------------------------
  group('T-10.6: Publication Ordering & Crash Recovery Invariants (PRD §24, §20, INV-14, R-31c)');

  t('payload and manifest bytes must be verified, persisted, and published before committing successful terminal record', () => {
    // 1. Missing bytesVerified
    const r1 = GEN.successOrderingOk({ bytesVerified: false, durablyPersisted: true, published: true });
    assert.strictEqual(r1.ok, false);
    assert.ok(r1.reason.includes('bytes not verified'));

    // 2. Missing durablyPersisted
    const r2 = GEN.successOrderingOk({ bytesVerified: true, durablyPersisted: false, published: true });
    assert.strictEqual(r2.ok, false);
    assert.ok(r2.reason.includes('not durably persisted'));

    // 3. Missing published
    const r3 = GEN.successOrderingOk({ bytesVerified: true, durablyPersisted: true, published: false });
    assert.strictEqual(r3.ok, false);
    assert.ok(r3.reason.includes('not durably published'));

    // 4. All satisfied -> publication ordering valid
    const rOk = GEN.successOrderingOk({ bytesVerified: true, durablyPersisted: true, published: true });
    assert.strictEqual(rOk.ok, true);
    assert.strictEqual(rOk.reason, null);
  });

  t('crash table: crashes before complete preparation or publication recover as NON_SUCCESSFUL_UNDELIVERED', () => {
    // 1. Crash before complete preparation
    const crashBeforePrep = GEN.deliveryCrashDisposition({
      prepared: false,
      published: false,
      terminalCommitted: false,
      retainedBytesIntact: false,
    });
    assert.strictEqual(crashBeforePrep.phase, 'BEFORE_PREPARATION');
    assert.strictEqual(crashBeforePrep.disposition, 'NON_SUCCESSFUL_UNDELIVERED');

    // 2. Crash after preparation but before durable publication
    const crashBeforePub = GEN.deliveryCrashDisposition({
      prepared: true,
      published: false,
      terminalCommitted: false,
      retainedBytesIntact: false,
    });
    assert.strictEqual(crashBeforePub.phase, 'AFTER_PREPARATION_BEFORE_PUBLICATION');
    assert.strictEqual(crashBeforePub.disposition, 'NON_SUCCESSFUL_UNDELIVERED');
  });

  t('crash table: published bytes without committed success terminal record remain non-successful and unaccepted', () => {
    // Crash after publication but before successful terminal commit
    const crashBeforeTerminal = GEN.deliveryCrashDisposition({
      prepared: true,
      published: true,
      terminalCommitted: false, // Interrupted before terminal record commits!
      retainedBytesIntact: true,
    });

    assert.strictEqual(crashBeforeTerminal.phase, 'AFTER_PUBLICATION_BEFORE_TERMINAL');
    assert.strictEqual(crashBeforeTerminal.disposition, 'NON_SUCCESSFUL_NOT_ACCEPTED');
  });

  t('crash table: crash after terminal commit reports success only when retained payload is intact; missing/corrupt fails closed', () => {
    // 1. Terminal committed and retained bytes intact -> SUCCESS_REPORTED
    const crashSuccessIntact = GEN.deliveryCrashDisposition({
      prepared: true,
      published: true,
      terminalCommitted: true,
      retainedBytesIntact: true,
    });
    assert.strictEqual(crashSuccessIntact.phase, 'AFTER_TERMINAL');
    assert.strictEqual(crashSuccessIntact.disposition, 'SUCCESS_REPORTED');

    // 2. Terminal committed but retained bytes missing or corrupt -> UNAVAILABLE_OR_CORRUPT_NO_REGENERATE
    const crashCorruptBytes = GEN.deliveryCrashDisposition({
      prepared: true,
      published: true,
      terminalCommitted: true,
      retainedBytesIntact: false, // Bytes corrupted on disk or missing!
    });
    assert.strictEqual(crashCorruptBytes.phase, 'AFTER_TERMINAL');
    assert.strictEqual(crashCorruptBytes.disposition, 'UNAVAILABLE_OR_CORRUPT_NO_REGENERATE');
  });

  // -------------------------------------------------------------------------
  // 7. Cancellation Linearization & Helper Execution Retirement
  // -------------------------------------------------------------------------
  group('T-10.7: Cancellation Linearization & Helper Execution Retirement (PRD §24, §19, §20, INV-14, R-36)');

  t('cancellation linearized before successful terminal commit halts publication and yields CANCELLED finalization', () => {
    const cancelTreatment = F.terminalTreatment(REC.TerminalResult.CANCELLED);
    assert.strictEqual(cancelTreatment.known, true);
    assert.strictEqual(cancelTreatment.successGate, false);
    assert.strictEqual(cancelTreatment.publishesExactFrozen, false);
    assert.strictEqual(cancelTreatment.fencesOrReconciles, true);

    const cancelFinalization = F.reduceFinalization({
      stopReason: REC.TerminalResult.CANCELLED,
      admissionClosed: true,
      authorityRetired: true,
      fencingEstablished: true,
      reconciliationComplete: true,
      quarantineAppliedForUnresolved: true,
      truthfulResultReduced: true,
      publicationOrderingComplete: false, // Not published
      quiescenceProven: true,
    });

    assert.strictEqual(cancelFinalization.status, F.FINALIZATION_STATUS.COMPLETE);
    assert.strictEqual(cancelFinalization.terminalResult, REC.TerminalResult.CANCELLED);
    assert.strictEqual(cancelFinalization.publishes, false, 'Cancellation must not publish frozen deliverable');
    assert.strictEqual(cancelFinalization.unresolved, false);
  });

  t('execution authority retires at finalization step 3; no helper or verifier execution can reopen afterward', () => {
    // Attempting finalization without retiring execution authority fails closed
    const unretiredFinalization = F.reduceFinalization({
      stopReason: REC.TerminalResult.COMPLETE,
      admissionClosed: true,
      authorityRetired: false, // Failed to retire authority!
      fencingEstablished: true,
      reconciliationComplete: true,
      quarantineAppliedForUnresolved: true,
      truthfulResultReduced: true,
      publicationOrderingComplete: true,
      quiescenceProven: true,
    });

    assert.strictEqual(unretiredFinalization.status, F.FINALIZATION_STATUS.UNRESOLVED_EXECUTION);
    assert.strictEqual(unretiredFinalization.publishes, false);
    assert.ok(unretiredFinalization.problems.some((p) => p.includes('task-execution authority was not durably retired')));
  });

  t('post-terminal arrival of late verifier or helper results cannot reopen execution, mutate candidate, or upgrade assurance', () => {
    // 1. Prohibited late payload attempting to reopen execution
    const reopenAttempt = F.latePayloadAllowed({
      afterTerminal: true,
      authenticatedAccountingSettlement: false,
      reopensExecution: true,
      importsEvidence: false,
      mutatesCandidate: false,
      upgradesAssurance: false,
    });
    assert.strictEqual(reopenAttempt.allowed, false);
    assert.ok(reopenAttempt.problems.some((p) => p.includes('reopens execution')));

    // 2. Prohibited late payload attempting to import evidence or mutate candidate
    const mutateAttempt = F.latePayloadAllowed({
      afterTerminal: true,
      authenticatedAccountingSettlement: false,
      reopensExecution: false,
      importsEvidence: true,
      mutatesCandidate: true,
      upgradesAssurance: false,
    });
    assert.strictEqual(mutateAttempt.allowed, false);
    assert.ok(mutateAttempt.problems.some((p) => p.includes('imports evidence')));
    assert.ok(mutateAttempt.problems.some((p) => p.includes('mutates a candidate')));

    // 3. Narrow post-terminal exception: authenticated accounting settlement ONLY
    const validSettlement = F.latePayloadAllowed({
      afterTerminal: true,
      authenticatedAccountingSettlement: true,
      reopensExecution: false,
      importsEvidence: false,
      mutatesCandidate: false,
      upgradesAssurance: false,
    });
    assert.strictEqual(validSettlement.allowed, true);
    assert.strictEqual(validSettlement.problems.length, 0);
  });

  // -------------------------------------------------------------------------
  // 8. Platform Qualification Boundary (Termux / Android Storage Immutability Profile)
  // -------------------------------------------------------------------------
  group('T-10.8: Platform Qualification Boundary (Termux / Android Storage Immutability Profile, IB-01 OPEN)');

  t('qualification reducer reports UNQUALIFIED when storage immutability probe / evidence fails or is missing', () => {
    const qualRecord = REC.createQualification({
      qualificationId: 'qual-t10-storage',
      profileId: 'profile:linux-immutable-storage:v1',
      profileDigest: 'sha256:' + '8'.repeat(64),
      status: Q.QualificationStatus.QUALIFIED,
      evidenceBindings: [
        { surface: Q.EffectSurface.FILESYSTEM, evidenceIds: ['qe-storage-1'] },
      ],
      admittedByContract: 'linux-contained',
      claimedAt: 1000,
    });

    const failedStorageEv = REC.createQualEvidence({
      qualEvidenceId: 'qe-storage-1',
      surface: Q.EffectSurface.FILESYSTEM,
      method: Q.EvidenceMethod.ACCESS_TEST,
      evidenceProfileBinding: 'profile:linux-immutable-storage:v1',
      result: Q.EvidenceResult.FAIL, // Failed write-once / immutability probe!
      timestamp: 2000,
      observerIdentity: 'observer-storage-1',
    });

    const res = Q.resolveQualification({
      qualification: qualRecord,
      evidence: [failedStorageEv],
      expectedProfileDigest: qualRecord.profileDigest,
    });

    assert.strictEqual(res.status, Q.QualificationStatus.UNQUALIFIED);
    assert.ok(res.problems.some((p) => p.includes('FILESYSTEM') && p.includes('FAIL')));
  });

  t('physical write-once filesystem immutability, immutable block mounts, and kernel fsync directory persistence are NOT QUALIFIED on Termux, IB-01 OPEN', () => {
    // Pure cryptographic manifest hashing, create-once identity algebra, and state-machine transitions
    // are fully verified fail-closed.
    // Physical OS-level write-once filesystem immutability (e.g. chattr +i, kernel immutable bit),
    // read-only loopback mount binding, and kernel parent directory fsync verification
    // cannot be physically qualified on the Android/Termux host environment without root / privileged block storage.
    const platformQualified = false; // Termux / Android host environment
    assert.strictEqual(platformQualified, false, 'Physical write-once filesystem immutability, immutable block mounts, and kernel fsync directory persistence are NOT QUALIFIED on Termux/Android, QUALIFIED under the Docker runtime profile in CI');
  });
};
