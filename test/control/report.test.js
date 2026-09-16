'use strict';
/**
 * Tests for src/control/report.cjs — §22 `status`/`evidence` read-only
 * reductions over durable records.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const RPT = require('../../src/control/report.cjs');
const REC = require('../../src/contracts/records.js');
const STATE = require('../../src/control/state.cjs');

function dir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-rpt-')); }
function tear(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }

function task(incarnationId, phase, over) {
  const t = REC.createTaskIncarnation({
    taskId: 'task-1', lineageId: 'ln-1', incarnationId,
    ownerEpoch: 'o:1', originalRequest: 'slice request', selectedSourceCommit: 'abc',
  });
  t.phase = phase;
  if (over) Object.assign(t, over);
  return t;
}

function action(actionId, dispatch, over) {
  const a = REC.createAction({
    actionId, incarnationId: 'inc-1', ownerEpoch: 'o:1',
    operation: `op:${actionId}`, targetGeneration: 'gen-1',
  });
  a.useAllowance = 'CONSUMED';
  a.dispatch = dispatch;
  a.execution = dispatch === 'KNOWN_NOT_DISPATCHED' || dispatch === 'UNKNOWN' ? 'UNKNOWN' : 'SUCCEEDED';
  a.lifecycle = 'SETTLED';
  a.liability = 'RESERVED';
  a.resourceDisposition = 'ACTIVE';
  if (over) Object.assign(a, over);
  return a;
}

function generation(generationId, state, over) {
  const g = REC.createGeneration({ generationId, taskId: 'task-1', incarnationId: 'inc-1' });
  if (state === REC.GenerationState.MUTATION_CLOSED) g.barrier1ClosedAt = '2026-09-15T09:00:00.000Z';
  if (state === REC.GenerationState.FROZEN) {
    g.treeDigest = 'sha256:' + 'a'.repeat(64);
    g.createOnceIdentity = `ci1:${'b'.repeat(64)}`;
    g.barrier1ClosedAt = '2026-09-15T09:00:00.000Z';
  }
  g.state = state;
  if (over) Object.assign(g, over);
  return g;
}

function delivery(deliveryId, persistenceState, over) {
  const d = REC.createDelivery({ deliveryId, taskId: 'task-1', frozenGenerationId: 'gen-1' });
  d.persistenceState = persistenceState;
  d.manifestDigest = 'sha256:' + 'c'.repeat(64);
  d.payloadDigest = 'sha256:' + 'd'.repeat(64);
  if (over) Object.assign(d, over);
  return d;
}

function sourceCapture(over) {
  const s = REC.createSourceCapture({
    captureId: 'cap-1', incarnationId: 'inc-1', commitIdentity: 'a'.repeat(40),
  });
  s.baselineManifestIdentity = 'sha256:' + 'e'.repeat(64);
  s.integrity = {
    objectIdentitiesVerified: true, treeEnumerationComplete: true,
    independentRetentionEstablished: true,
  };
  if (over) Object.assign(s, over);
  return s;
}

function fin(stopReason, over) {
  const f = REC.createFinalization({ finalizationId: 'fin-1', incarnationId: 'inc-1', stopReason });
  f.admissionClosed = true;
  f.authorityRetired = true;
  f.fencingEstablished = true;
  f.quiescenceProven = true;
  f.quarantinedResources = [];
  if (over) Object.assign(f, over);
  return f;
}

function repair(over) {
  const x = REC.createRepair({
    repairId: 'rep-1', incarnationId: 'inc-1',
    failureIdentity: {
      requirementOrCheck: 'obl-1', caseIdentity: 'case:exit-1', affectedComponent: 'src/cli.js',
      severity: 'BLOCKING', normalizedSignature: 'sig:exit1', generationId: 'gen-1',
      rawEvidenceReference: 'evidence/obs-1.json',
    },
    disposableGenerationId: 'gen-2',
  });
  if (over) Object.assign(x, over);
  return x;
}

module.exports = function run(t, group) {
  group('report: status — empty / absent store');

  t('an empty record set reports present=false with no fabrication', () => {
    const r = RPT.statusReport([]);
    assert.strictEqual(r.present, false);
    assert.strictEqual(r.storeValid, true);
    for (const s of ['task', 'lifecycle', 'generation', 'delivery', 'resources', 'recovery']) {
      assert.strictEqual(r[s].present, false, `${s} must not fabricate`);
    }
  });

  t('status over a real store round-trips records (folded) into the report', () => {
    const d = dir();
    const store = STATE.open(d);
    store.add(task('inc-1', REC.TaskPhase.EXECUTING));
    store.add(action('act-1', 'UNKNOWN'));
    store.add(generation('gen-1', REC.GenerationState.MUTABLE));

    const r = RPT.statusReport(store.all());
    assert.strictEqual(r.present, true);
    assert.strictEqual(r.task.tasks[0].phase, REC.TaskPhase.EXECUTING);
    assert.strictEqual(r.lifecycle.actions[0].dispatch, 'UNKNOWN');
    assert.strictEqual(r.lifecycle.counts.unresolved, 1);
    assert.strictEqual(r.generation.generations[0].state, REC.GenerationState.MUTABLE);
    store.close();
    tear(d);
  });

  t('store reuse after re-open: status reflects the durable fold', () => {
    const d = dir();
    const s1 = STATE.open(d);
    s1.add(generation('gen-2', REC.GenerationState.MUTATION_CLOSED));
    s1.close();
    const s2 = STATE.open(d);
    const r = RPT.statusReport(s2.all());
    assert.strictEqual(r.generation.generations[0].state, REC.GenerationState.MUTATION_CLOSED);
    s2.close();
    tear(d);
  });

  group('report: delivery availability (historical vs current, §20)');

  t('published-within-retention is available; expired is historically attributable only', () => {
    const now = new Date().toISOString();
    const past = new Date(Date.now() - 100000).toISOString();
    const inRetention = delivery('del-ok', 'PUBLISHED', { retentionExpiry: new Date(Date.now() + 86400000).toISOString(), retentionStart: now });
    const expired = delivery('del-exp', 'PUBLISHED', { retentionExpiry: past, retentionStart: new Date(Date.now() - 1000000).toISOString() });
    const unpub = delivery('del-un', 'NOT_PUBLISHED', {});
    const r = RPT.deliveryStatus([inRetention, expired, unpub]);

    assert.strictEqual(r.counts.published, 2);
    const ok = r.deliveries.find((x) => x.deliveryId === 'del-ok');
    const ex = r.deliveries.find((x) => x.deliveryId === 'del-exp');
    assert.strictEqual(ok.currentlyAvailable, true);
    assert.strictEqual(ok.historicallyAttributable, true);
    assert.strictEqual(ex.currentlyAvailable, false);
    assert.strictEqual(ex.historicallyAttributable, true, 'expired delivery is still attributable in history');
    assert.strictEqual(r.counts.currentlyAvailable, 1);
  });

  group('report: generation / recovery');

  t('generation status exposes the one-way states and frozen identity binding', () => {
    const fz = generation('gen-f', REC.GenerationState.FROZEN);
    const r = RPT.generationStatus([fz, generation('gen-m', REC.GenerationState.MUTABLE)]);
    assert.strictEqual(r.counts.frozen, 1);
    assert.strictEqual(r.counts.mutable, 1);
    const gen = r.generations.find((g) => g.generationId === 'gen-f');
    assert.ok(gen.createOnceIdentity && gen.treeDigest, 'frozen generation must bind identities');
  });

  t('recovery status surfaces quiescence/fencing facts per finalization', () => {
    const r = RPT.recoveryStatus([fin('CRASH_RECOVERED_UNRESOLVED'), fin('X', { quiescenceProven: false })]);
    assert.strictEqual(r.present, true);
    assert.strictEqual(r.quiescenceProvenAny, false, 'quiescence must be proven across the set');
    assert.strictEqual(r.finalizations.length, 2);
    assert.strictEqual(r.finalizations[0].fencingEstablished, true);
  });

  t('recovery status derives the §19 success gate only for COMPLETE-family terminal results', () => {
    const r = RPT.recoveryStatus([
      fin('COMPLETE'),
      fin('COMPLETE_WITH_LIMITATION'),
      fin('FAILED'),
      fin('UNRESOLVED_EXECUTION'),
    ]);
    const by = Object.fromEntries(r.finalizations.map((f) => [f.stopReason, f.successGate]));
    assert.strictEqual(by.COMPLETE, true);
    assert.strictEqual(by.COMPLETE_WITH_LIMITATION, true, 'limitation still requires the full success gate');
    assert.strictEqual(by.FAILED, false, 'a FAILED terminal is not a success gate');
    assert.strictEqual(by.UNRESOLVED_EXECUTION, false);
  });

  t('recovery status reports the §18 one-shot repair allowance durably', () => {
    const r = RPT.recoveryStatus([repair()]);
    assert.strictEqual(r.present, true);
    assert.strictEqual(r.repairCount, 1);
    assert.strictEqual(r.repairCeiling, 1);
    assert.strictEqual(r.repairExceeded, false);
    assert.strictEqual(r.repairs[0].allowanceConsumed, true);
    assert.strictEqual(r.repairs[0].disposableGenerationId, 'gen-2');
    // A second repair record pushes past the ceiling (adversarial).
    const over = RPT.recoveryStatus([repair(), repair({ repairId: 'rep-2' })]);
    assert.strictEqual(over.repairCount, 2);
    assert.strictEqual(over.repairExceeded, true, 'two repairs exceed the one-repair MVP ceiling');
  });

  group('report: evidence — gate facts');

  t('gate is CHECKER_ONLY and qualification false when no qualified reader is attested', () => {
    const r = RPT.evidenceReport([task('inc-1', REC.TaskPhase.RECEIVED), action('act-1', 'KNOWN_NOT_DISPATCHED')]);
    assert.strictEqual(r.gate, REC.ReleaseDisposition.CHECKER_ONLY);
    assert.strictEqual(r.qualifiedRuntime, false);
    assert.strictEqual(r.supervisedExecution, false);
  });

  t('a source_capture attesting a qualified reader lifts the gate', () => {
    const r = RPT.evidenceReport([sourceCapture({ reader: { qualified: true, name: 'native-reader', version: '1' } })]);
    assert.strictEqual(r.qualifiedRuntime, true);
    assert.strictEqual(r.gate, 'RELEASE_READY_FOR_DECLARED_PROFILE');
    assert.strictEqual(r.observations.find((o) => o.kind === 'source_capture').commitIdentity, 'a'.repeat(40));
  });

  t('evidence reduces contracts, actions, consumptions and per-kind counts', () => {
    const records = [
      REC.createAcceptanceContract({ contractId: 'c1', taskId: 'task-1', incarnationId: 'inc-1' }),
      action('act-1', 'ACKNOWLEDGED'),
    ];
    const r = RPT.evidenceReport(records);
    assert.strictEqual(r.contracts[0].contractId, 'c1');
    assert.strictEqual(r.actions[0].actionId, 'act-1');
    assert.strictEqual(r.countByKind.action, 1);
    assert.strictEqual(r.countByKind.acceptance_contract, 1);
    assert.strictEqual(r.storeValid, true);
  });

  group('report: §23 pipeline evidence (Unit 16)');

  /** A §23 pipeline evidence record that satisfies the store validator. */
  function evRec(id, obligationId, outcome) {
    return REC.createEvidenceRecord({
      evidenceId: id, obligationId, generationId: 'gen-1', outcome,
      envelope: { provenance: 'protected/evidence/' + id + '.json' },
      observationPath: 'protected/evidence/' + id + '.json',
    });
  }

  t('evidenceReport reduces the §23 pipeline verdict, counts, and per-obligation outcomes', () => {
    const r = RPT.evidenceReport([
      evRec('ev-1', 'obl-1', 'FAIL'),
      evRec('ev-2', 'obl-2', 'PASS'),
    ]);
    assert.strictEqual(r.storeValid, true);
    assert.strictEqual(r.pipeline.verdict, 'FAIL', 'a failing obligation forces pipeline FAIL');
    assert.strictEqual(r.pipeline.evidenceCount, 2);
    assert.strictEqual(r.pipeline.invalidationCount, 0);
    assert.strictEqual(r.pipeline.authoritative, false, 'supporting-only evidence is never authoritative');
    assert.strictEqual(r.pipeline.byObligation['obl-1'].outcome, 'FAIL');
    assert.strictEqual(r.pipeline.byObligation['obl-2'].outcome, 'PASS');
  });

  t('evidenceReport surfaces evidence_invalidation records and their retraction effect', () => {
    const inv = REC.createEvidenceInvalidation({
      invalidationId: 'inv-1', evidenceId: 'ev-1', reason: 'SUPERSEDED', supersededById: 'ev-3',
    });
    const r = RPT.evidenceReport([
      evRec('ev-1', 'obl-1', 'FAIL'),
      evRec('ev-2', 'obl-1', 'PASS'),
      inv,
    ]);
    assert.strictEqual(r.storeValid, true);
    assert.strictEqual(r.pipeline.invalidationCount, 1);
    // The superseded FAIL no longer blocks; the remaining PASS closes this
    // obligation, so the pipeline is not FAIL — matching the §23 reduction.
    assert.strictEqual(r.pipeline.byObligation['obl-1'].outcome, 'PASS');
    assert.notStrictEqual(r.pipeline.verdict, 'FAIL');
  });

  group('report: fail-closed store validity');

  t('an invalid store state (duplicate identity) is reported as not trustworthy', () => {
    // Two records sharing a single identity — validateStoreState must flag it.
    const dup = [
      { schemaVersion: 1, kind: 'task_incarnation', taskId: 't', lineageId: 'l', incarnationId: 'inc-x', ownerEpoch: 'o', originalRequest: 'a', phase: 'RECEIVED' },
      { schemaVersion: 1, kind: 'task_incarnation', taskId: 't', lineageId: 'l', incarnationId: 'inc-x', ownerEpoch: 'o', originalRequest: 'b', phase: 'RECEIVED' },
    ];
    const r = RPT.statusReport(dup);
    assert.strictEqual(r.storeValid, false);
    assert.ok(r.storeProblems.some((p) => p.includes('duplicate identity')));
    const e = RPT.evidenceReport(dup);
    assert.strictEqual(e.storeValid, false);
  });

  group('report: coherence plane (Unit 11 — same source of truth as §21)');

  t('statusReport surfaces the derived coherence gates, fail closed', () => {
    // No frozen generation, no observer run, no finalization: every gate false.
    const r = RPT.statusReport([REC.createAcceptanceContract({ contractId: 'c1', taskId: 'task-1', incarnationId: 'inc-1' })]);
    assert.strictEqual(r.coherence.derivation.status, 'MISSING');
    assert.strictEqual(r.coherence.derivation.frozenGenerationId, null);
    assert.strictEqual(r.coherence.inputClosure.closed, false);
    assert.strictEqual(r.coherence.evidenceCoherent, false);
    assert.strictEqual(r.coherence.payloadManifestComplete, false);
    assert.strictEqual(r.coherence.quiescenceProven, false);
    assert.strictEqual(r.coherence.cleanAuthorityOwnership, false);
    assert.ok(r.coherence.blockers.length >= 6, 'every gate must surface a blocker');
  });

  t('statusReport coherence plane matches acceptanceGates over the same records', () => {
    const records = [task('inc-1', REC.TaskPhase.RECEIVED), generation('gen-f', REC.GenerationState.FROZEN)];
    const r = RPT.statusReport(records);
    const gates = require('../../src/contracts/coherence.js').acceptanceGates({ records });
    assert.strictEqual(r.coherence.derivation.status, gates.derivation.status);
    assert.strictEqual(r.coherence.evidenceCoherent, gates.evidenceCoherent);
    assert.deepStrictEqual(r.coherence.blockers, gates.blockers);
  });

  group('report: resolution / resource state');

  t('quarantine and reservation states are exposed', () => {
    const q = { schemaVersion: 1, kind: 'quarantine', quarantineId: 'q-1', resource: 'action-scope:a', reason: 'unresolved actor', state: 'ACTIVE' };
    const res = { schemaVersion: 1, kind: 'reservation', reservationId: 'r-1', lineageId: 'ln-1', dimension: 'cpu', actionId: 'a', maxExposure: 5, state: 'ACTIVE' };
    const r = RPT.resourceStatus([q, res]);
    assert.strictEqual(r.counts.quarantinesActive, 1);
    assert.strictEqual(r.counts.reservationsActive, 1);
    assert.strictEqual(r.quarantines[0].resource, 'action-scope:a');
  });

  group('report (Unit 13): intent inventory and decision-priority facts');

  t('an empty record set reports intent/decision absent-without-fabrication', () => {
    const r = RPT.statusReport([]);
    assert.strictEqual(r.intent.present, false);
    assert.strictEqual(r.intent.provenanceOk, true, 'empty inventory is trivially provenance-intact');
    assert.strictEqual(r.decision.present, true, 'decision section always reports the static ladder (it is a documented priority model, not a claim)');
    assert.strictEqual(r.decision.impliedGate, 'HARD_STOP', 'no situation facts => fail-closed stop, honestly');
  });

  t('intent status surfaces the 5-way distribution and mandatory count', () => {
    const INTENT = require('../../src/contracts/intent.js');
    const u = REC.createIntent({ requirementId: 'r1', sourceAndProvenance: 'user-request line 1', originalMeaning: 'CLI exits deterministically', explicitOrInferred: 'explicit', mandatoryOrOptional: 'mandatory', applicability: 'APPLICABLE', intentClass: INTENT.IntentClass.USER_STATED });
    const i = REC.createIntent({ requirementId: 'r2', sourceAndProvenance: 'dependency analysis', originalMeaning: 'closure verified', explicitOrInferred: 'inferred', mandatoryOrOptional: 'optional', applicability: 'APPLICABLE', rationale: 'ranges must be closed', scope: 'deps', uncertainty: { consequentialDomains: [], resolved: true }, intentClass: INTENT.IntentClass.SAFELY_INFERRED });
    const r = RPT.intentStatus([u, i]);
    assert.strictEqual(r.present, true);
    assert.strictEqual(r.counts.USER_STATED, 1);
    assert.strictEqual(r.counts.SAFELY_INFERRED, 1);
    assert.strictEqual(r.mandatoryCount, 1);
    assert.strictEqual(r.provenanceOk, true);
  });

  t('decision status derives authority-dispute priority-1 from records, dynamics of efficiency aside', () => {
    const task = REC.createTaskIncarnation({ taskId: 't', lineageId: 'l', incarnationId: 'inc-1', ownerEpoch: 'o:1', originalRequest: 'x', selectedSourceCommit: 'a' });
    const q = { schemaVersion: 1, kind: 'quarantine', quarantineId: 'q-1', resource: 'action-scope:a', reason: 'unresolved actor', state: 'ACTIVE' };
    const a = REC.createAction({ actionId: 'act-1', incarnationId: 'inc-1', ownerEpoch: 'o:1', operation: 'op', targetGeneration: 'gen-1' });
    a.dispatch = REC.ActionDispatch.UNKNOWN;
    const r = RPT.decisionStatus([task, q, a]);
    assert.strictEqual(r.authorityDisputeAttested, true);
    assert.strictEqual(r.impliedGate, 'SAFETY_AUTHORITY', 'authority disputes always dominate the priority ladder');
  });

  t('coherence intent plane is surfaced by statusReport over the same records (single source of truth)', () => {
    const INTENT = require('../../src/contracts/intent.js');
    const task = REC.createTaskIncarnation({ taskId: 't', lineageId: 'l', incarnationId: 'inc-1', ownerEpoch: 'o:1', originalRequest: 'CLI exits deterministically', selectedSourceCommit: 'a' });
    const u = REC.createIntent({ requirementId: 'r1', sourceAndProvenance: 'user-request line 1', originalMeaning: 'CLI exits deterministically', explicitOrInferred: 'explicit', mandatoryOrOptional: 'mandatory', applicability: 'APPLICABLE', intentClass: INTENT.IntentClass.USER_STATED });
    const r = RPT.statusReport([task, u]);
    assert.strictEqual(r.coherence.intentIntact, true, r.coherence.intentProblems.join('; '));
    assert.ok(!r.coherence.blockers.some((x) => x.includes('intent integrity')));
    // A deleted-to-zero inventory is caught on the coherence plane.
    const deleted = RPT.statusReport([task]);
    assert.strictEqual(deleted.coherence.intentIntact, false);
    assert.ok(deleted.coherence.blockers.some((x) => x.includes('intent integrity')));
  });

  group('report (Unit 15): §6/§10 ownership status');

  t('without a store owner the ownership section is absent-without-fabrication', () => {
    const r = RPT.statusReport([]);
    assert.strictEqual(r.ownership.present, false);
    assert.strictEqual(r.ownership.authorityGranted, false);
    assert.ok(r.ownership.identityProblems.some((p) => p.includes('no store owner')));
  });

  t('a bound store owner surfaces identity + epoch facts and never grants authority', () => {
    const crypto = require('../../src/contracts/crypto.js');
    const lock = crypto.contentId('lock:/s');
    const owner = {
      schemaVersion: REC.SCHEMA_VERSION, kind: 'store_owner',
      canonicalStorePath: '/s', lockIdentity: lock, ownerIdentity: 'me',
      currentEpoch: 2, ownerEpoch: 'o:2', recoveryState: 'NORMAL', admissionState: 'OPEN',
    };
    const ea = (n, role, oid) => ({ kind: 'epoch_alloc', epochId: `ea-${n}`, epochNumber: n, role, ownerIdentity: oid });
    const records = [owner, ea(1, 'INITIAL', 'me'), ea(2, 'SUPERVISOR', 'me')];
    const r = RPT.statusReport(records);
    assert.strictEqual(r.ownership.present, true);
    assert.strictEqual(r.ownership.storeIdentityOk, true);
    assert.strictEqual(r.ownership.currentEpoch, 2);
    assert.strictEqual(r.ownership.epochAllocations.length, 2);
    assert.strictEqual(r.ownership.ownershipIntegrityOk, true);
    assert.strictEqual(r.ownership.authorityGranted, false, 'ownership never grants execution authority');
  });
};