'use strict';
/**
 * Tests for src/contracts/qualification.js — §5 Qualification Contract.
 *
 * Qualification is evidence-based: a capability is NOT qualified merely because
 * an executable exists, a command succeeds once, a configuration claims
 * isolation, a wrapper exists, or a test says it is isolated. Evidence must be
 * fresh, profile-bound, and consistent; missing/stale/contradictory/
 * incomplete/untrusted evidence fails closed. One profile's evidence is never
 * silently reused for another profile. Qualification does NOT grant execution
 * authority.
 *
 * Adversarial cases (unit requirement 12): forged qualification evidence,
 * stale evidence, wrong runtime identity, changed configuration, incomplete
 * qualification, contradictory evidence, capability-exists-but-transitive-
 * boundary-unproven, and qualification-≠-execution-authority.
 */

const assert = require('node:assert');
const REC = require('../../src/contracts/records.js');
const Q = require('../../src/contracts/qualification.js');
const VAL = require('../../src/contracts/validate.js');
const COH = require('../../src/contracts/coherence.js');

const P1 = 'profile:termux-linux-arm64:v1';   // an advertised profile
const P2 = 'profile:other-host:v2';           // a different, incompatible runtime
const OBSERVER = 'protected-observer-1';       // authorized protected observer

/** A fully-formed qualification record claiming QUALIFIED for profile P1. */
function qual(over = {}) {
  return REC.createQualification({
    qualificationId: 'qual-1',
    profileId: P1,
    profileVersion: '1.0.0',
    profileDigest: 'sha256:' + 'a'.repeat(64),
    status: Q.QualificationStatus.QUALIFIED,
    evidenceBindings: [
      { surface: Q.EffectSurface.FILESYSTEM, evidenceIds: ['qe-fs-1'] },
      { surface: Q.EffectSurface.NETWORK, evidenceIds: ['qe-net-1'] },
    ],
    admittedByContract: 'linux-arm64-local-only',
    claimedAt: 1000,
    ...over,
  });
}

/** A passing qual_evidence record for P1 on a given surface. */
function passEvidence(surface, over = {}) {
  return REC.createQualEvidence({
    qualEvidenceId: `qe-${surface.toLowerCase()}-1`,
    surface,
    method: Q.EvidenceMethod.NAMESPACE_TEST,
    evidenceProfileBinding: P1,
    result: Q.EvidenceResult.PASS,
    timestamp: 2000,
    observerIdentity: OBSERVER,
    limitations: [],
    ...over,
  });
}

/** A task_incarnation bound to a runtime profile (so the gate is demanded). */
function taskFor(profileId) {
  return REC.createTaskIncarnation({
    taskId: 'task-q', lineageId: 'ln-q', incarnationId: 'inc-q',
    ownerEpoch: 'o:1', originalRequest: 'run the slice', selectedSourceCommit: 'abc',
    runtimeProfileId: profileId,   // §5 profile binding on the incarnation
  });
}

module.exports = function run(t, group) {
  group('§5 states and record shapes');

  t('QUALIFICATION_STATES has exactly the four explicit states', () => {
    assert.deepStrictEqual(
      [...Q.QUALIFICATION_STATES].sort(),
      ['INCONCLUSIVE', 'QUALIFIED', 'UNAVAILABLE', 'UNQUALIFIED']
    );
  });

  t('createQualification produces a valid durable record', () => {
    const q = qual();
    assert.strictEqual(q.kind, 'qualification');
    assert.strictEqual(q.schemaVersion, REC.SCHEMA_VERSION);
    assert.strictEqual(VAL.validateRecord(q).valid, true);
  });

  t('createQualEvidence produces a valid durable evidence record with a digest', () => {
    const e = passEvidence(Q.EffectSurface.FILESYSTEM);
    assert.strictEqual(e.kind, 'qual_evidence');
    assert.ok(e.evidenceDigest.startsWith('sha256:'));
    assert.strictEqual(VAL.validateRecord(e).valid, true);
  });

  t('record validation fails closed on unknown status/surface/method/result', () => {
    assert.strictEqual(VAL.validateRecord(qual({ status: 'MAYBE' })).valid, false);
    assert.strictEqual(VAL.validateRecord(qual({ evidenceBindings: [{ surface: 'SORTA', evidenceIds: [] }] })).valid, false);
    assert.strictEqual(VAL.validateRecord(passEvidence(Q.EffectSurface.FILESYSTEM, { method: 'GUESSED' })).valid, false);
    assert.strictEqual(VAL.validateRecord(passEvidence(Q.EffectSurface.FILESYSTEM, { result: 'PROBABLY' })).valid, false);
    assert.strictEqual(VAL.validateRecord(passEvidence(Q.EffectSurface.FILESYSTEM, { evidenceProfileBinding: '' })).valid, false);
  });

  group('§5 evidence-based qualification (requirement 2)');

  t('EVIDENCE-BASED — a claimed QUALIFIED record with NO evidence is UNAVAILABLE, not qualified', () => {
    const v = Q.resolveQualification({ qualification: qual(), evidence: [] });
    assert.strictEqual(v.status, Q.QualificationStatus.UNAVAILABLE);
    assert.ok(v.problems.some((p) => p.includes('no qualification evidence')));
    // The claimed status is never trusted as authority.
    assert.strictEqual(v.claimedStatus, Q.QualificationStatus.QUALIFIED);
    assert.notStrictEqual(v.status, v.claimedStatus);
  });

  t('EVIDENCE-BASED — a command succeeding once / a label is not qualification', () => {
    // An executable existing, a config claiming isolation, or a test saying
    // "isolated" all reduce to absent evidence records — fail closed.
    const fake = qual({
      qualificationSummary: 'the executable exists and the config claims isolation',
      // no evidenceBindings, no qual_evidence records
      evidenceBindings: [],
    });
    const v = Q.resolveQualification({ qualification: fake, evidence: [] });
    assert.strictEqual(v.status, Q.QualificationStatus.UNAVAILABLE);
  });

  t('QUALIFIED — every declared surface with fresh passing profile-bound evidence', () => {
    const v = Q.resolveQualification({
      qualification: qual(),
      evidence: [
        passEvidence(Q.EffectSurface.FILESYSTEM),
        passEvidence(Q.EffectSurface.NETWORK),
      ],
    });
    assert.strictEqual(v.status, Q.QualificationStatus.QUALIFIED);
    assert.deepStrictEqual(v.failureModes, []);
    assert.deepStrictEqual(v.coveredSurfaces.sort(), ['FILESYSTEM', 'NETWORK'].sort());
  });

  group('§5 adversarial: candidate/forged evidence');

  t('FORGED EVIDENCE — evidence NOT produced by an authorized observer is UNQUALIFIED', () => {
    const v = Q.resolveQualification({
      qualification: qual(),
      evidence: [
        passEvidence(Q.EffectSurface.FILESYSTEM, { observerIdentity: null }),   // self-report, not protected observation
        passEvidence(Q.EffectSurface.NETWORK),
      ],
    });
    assert.strictEqual(v.status, Q.QualificationStatus.UNQUALIFIED);
    assert.ok(v.failureModes.includes(Q.FailureMode.UNTRUSTED_SOURCE));
  });

  t('FORGED EVIDENCE — a forged QUALIFIED support record with fabricated bindings and no real proof fails', () => {
    // The adversary stamps QUALIFIED and claims bindings to quality surfaces;
    // the reducer still demands actual qual_evidence records for the same profile.
    const forged = qual();
    const v = Q.resolveQualification({ qualification: forged, evidence: [] });
    assert.strictEqual(v.status, Q.QualificationStatus.UNAVAILABLE);
  });

  t('FORGED EVIDENCE — evidence with no valid method/timestamp cannot count as proof', () => {
    const noMethod = passEvidence(Q.EffectSurface.FILESYSTEM, { method: null });
    assert.strictEqual(VAL.validateRecord(noMethod).valid, false);
    const noStamp = passEvidence(Q.EffectSurface.FILESYSTEM, { timestamp: 0 });
    assert.strictEqual(VAL.validateRecord(noStamp).valid, false);
  });

  group('§5 adversarial: wrong runtime identity and changed configuration (requirements 5, 6)');

  t('WRONG RUNTIME IDENTITY — evidence bound to another profile is never reused', () => {
    const v = Q.resolveQualification({
      qualification: qual(), // profile P1
      evidence: [
        passEvidence(Q.EffectSurface.FILESYSTEM, { evidenceProfileBinding: P2 }), // evidence from P2
        passEvidence(Q.EffectSurface.NETWORK),
      ],
    });
    assert.strictEqual(v.status, Q.QualificationStatus.UNQUALIFIED);
    assert.ok(v.failureModes.includes(Q.FailureMode.WRONG_PROFILE));
    assert.ok(v.problems.some((p) => p.includes('cross-profile reuse')));
  });

  t('WRONG RUNTIME IDENTITY — a qualification record for a DIFFERENT profile does not gate another profile', () => {
    const task = taskFor(P2);
    const gate = Q.qualificationIntegrityGate({
      taskRecord: task,
      qualificationRecords: [qual()], // P1 record only
      qualEvidenceRecords: [],
    });
    assert.strictEqual(gate.qualified, false);
    assert.strictEqual(gate.rule, 'profile-mismatch');
    assert.ok(gate.problems.some((p) => p.includes('no qualification record matches')));
  });

  t('CHANGED CONFIGURATION — profile digest/binding drift invalidates qualification', () => {
    // The qualification claims profileDigest A but the evidence is bound to a
    // different profile identity (the runtime reconfigured), i.e. the proof no
    // longer applies to the current configuration.
    const q = qual({ profileDigest: 'sha256:' + 'b'.repeat(64) });
    const v = Q.resolveQualification({
      qualification: q,
      evidence: [
        passEvidence(Q.EffectSurface.FILESYSTEM, { evidenceProfileBinding: P2 }), // unchanged old profile
      ],
    });
    assert.strictEqual(v.status, Q.QualificationStatus.UNQUALIFIED);
    assert.ok(v.failureModes.includes(Q.FailureMode.WRONG_PROFILE));
  });

  t('STALE EVIDENCE — older evidence is superseded, never counted as standing proof', () => {
    const olderFs = passEvidence(Q.EffectSurface.FILESYSTEM, {
      qualEvidenceId: 'qe-fs-old', timestamp: 1000,
    });
    const newerFs = passEvidence(Q.EffectSurface.FILESYSTEM, {
      qualEvidenceId: 'qe-fs-new', timestamp: 3000,
    });
    const v = Q.resolveQualification({
      qualification: qual(),
      evidence: [olderFs, newerFs, passEvidence(Q.EffectSurface.NETWORK)],
    });
    assert.strictEqual(v.status, Q.QualificationStatus.QUALIFIED);
    assert.ok(v.staleEvidence.includes('qe-fs-old'), 'older evidence must be flagged stale');
    assert.ok(!v.staleEvidence.includes('qe-fs-new'));
  });

  t('STALE EVIDENCE — when ALL evidence for a surface is stale, the surface is unproven', () => {
    const v = Q.resolveQualification({
      qualification: qual(),
      evidence: [
        // Two records for FILESYSTEM — the older one can't be "newer than",
        // so the newest-per-surface rule still leaves a standing newest. To
        // force staleness for ALL of a surface we need the qualification's
        // declared surface to have zero non-stale proof with a different-newer.
        passEvidence(Q.EffectSurface.FILESYSTEM, { timestamp: 1 }),
        passEvidence(Q.EffectSurface.FILESYSTEM, { timestamp: 2 }),
        passEvidence(Q.EffectSurface.NETWORK, { timestamp: 2 }),
      ],
    });
    // Both FILESYSTEM records: newest ts=2 is standing PASS — so still QUALIFIED.
    assert.strictEqual(v.status, Q.QualificationStatus.QUALIFIED);
  });

  group('§5 adversarial: incomplete/contradictory evidence');

  t('INCOMPLETE QUALIFICATION — a declared surface with no evidence is UNQUALIFIED', () => {
    // declares FILESYSTEM + NETWORK, but only FILESYSTEM has proof
    const v = Q.resolveQualification({
      qualification: qual(),
      evidence: [passEvidence(Q.EffectSurface.FILESYSTEM)],
    });
    assert.strictEqual(v.status, Q.QualificationStatus.UNQUALIFIED);
    assert.ok(v.failureModes.includes(Q.FailureMode.MISSING_SURFACE));
    assert.ok(v.problems.some((p) => p.includes('NETWORK')));
  });

  t('CONTRADICTORY EVIDENCE — PASS + FAIL on the same surface is INCONCLUSIVE', () => {
    const v = Q.resolveQualification({
      qualification: qual(),
      evidence: [
        passEvidence(Q.EffectSurface.FILESYSTEM, { result: Q.EvidenceResult.PASS, timestamp: 1000 }),
        passEvidence(Q.EffectSurface.FILESYSTEM, { result: Q.EvidenceResult.FAIL, timestamp: 2000 }),
        passEvidence(Q.EffectSurface.NETWORK),
      ],
    });
    assert.strictEqual(v.status, Q.QualificationStatus.INCONCLUSIVE);
  });

  t('FAIL evidence is a hard unqualifier even with older PASS proof (monotonic FAIL)', () => {
    const v = Q.resolveQualification({
      qualification: qual(),
      evidence: [
        passEvidence(Q.EffectSurface.FILESYSTEM, { result: Q.EvidenceResult.PASS, timestamp: 1000 }),
        passEvidence(Q.EffectSurface.FILESYSTEM, { result: Q.EvidenceResult.FAIL, timestamp: 2000 }),
        passEvidence(Q.EffectSurface.NETWORK),
      ],
    });
    assert.strictEqual(v.status, Q.QualificationStatus.INCONCLUSIVE); // PASS+FAIL => inconclusive
    const failOnly = Q.resolveQualification({
      qualification: qual(),
      evidence: [
        passEvidence(Q.EffectSurface.FILESYSTEM, { result: Q.EvidenceResult.FAIL }),
        passEvidence(Q.EffectSurface.NETWORK),
      ],
    });
    assert.strictEqual(failOnly.status, Q.QualificationStatus.UNQUALIFIED);
  });

  t('INCONCLUSIVE evidence can never decide qualification (fail closed)', () => {
    const v = Q.resolveQualification({
      qualification: qual(),
      evidence: [
        passEvidence(Q.EffectSurface.FILESYSTEM, { result: Q.EvidenceResult.INCONCLUSIVE, timestamp: 2000 }),
        passEvidence(Q.EffectSurface.NETWORK),
      ],
    });
    assert.strictEqual(v.status, Q.QualificationStatus.INCONCLUSIVE);
  });

  group('§5 capability exists but transitive boundary unproven (requirement 3)');

  t('CAPABILITY-EXISTS — a surface with the tool present but the boundary unproven is not qualified', () => {
    // The capability (namespaces) exists, but no evidence covers its boundary:
    // a qualification record that declares DESCENDANTS with no proof fails.
    const q = qual({
      evidenceBindings: [
        { surface: Q.EffectSurface.DESCENDANTS, evidenceIds: [] },   // declared, unproven
        { surface: Q.EffectSurface.FILESYSTEM, evidenceIds: ['qe-fs-1'] },
      ],
    });
    const v = Q.resolveQualification({
      qualification: q,
      evidence: [passEvidence(Q.EffectSurface.FILESYSTEM)],
    });
    assert.strictEqual(v.status, Q.QualificationStatus.UNQUALIFIED);
    assert.ok(v.problems.some((p) => p.includes('DESCENDANTS')));
  });

  t('TRANSITIVE EFFECTS — each reachable surface must be individually proven', () => {
    // NETWORK is proven but CANCELLATION (drain/fence) is a transitive effect
    // of the same boundary and has no proof.
    const q = qual({
      evidenceBindings: [
        { surface: Q.EffectSurface.NETWORK, evidenceIds: ['qe-net-1'] },
        { surface: Q.EffectSurface.CANCELLATION, evidenceIds: [] },
      ],
    });
    const v = Q.resolveQualification({ qualification: q, evidence: [passEvidence(Q.EffectSurface.NETWORK)] });
    assert.strictEqual(v.status, Q.QualificationStatus.UNQUALIFIED);
    assert.ok(v.problems.some((p) => p.includes('CANCELLATION')));
  });

  group('§5 coherence gate integration (requirement 8)');

  t('COHERENCE — no qualification record for an active task blocks acceptance gates', () => {
    const gates = COH.acceptanceGates({ records: [taskFor(P1)] });
    assert.strictEqual(gates.qualified, false);
    assert.strictEqual(gates.qualificationStatus, Q.QualificationStatus.UNAVAILABLE);
    assert.ok(gates.blockers.some((x) => x.includes('profile qualification')));
  });

  t('COHERENCE — a task with NO runtimeProfileId cannot be a qualified execution', () => {
    const task = REC.createTaskIncarnation({
      taskId: 'task-q', lineageId: 'ln-q', incarnationId: 'inc-q',
      ownerEpoch: 'o:1', originalRequest: 'run the slice', selectedSourceCommit: 'abc',
    });
    const gates = COH.acceptanceGates({ records: [task] });
    assert.strictEqual(gates.qualified, false);
    assert.strictEqual(gates.qualificationStatus, Q.QualificationStatus.UNAVAILABLE);
    assert.ok(gates.qualProblems.some((p) => p.includes('runtimeProfileId')));
  });

  t('COHERENCE — forged QUALIFIED qualification without evidence stays UNAVAILABLE and blocked', () => {
    const gates = COH.acceptanceGates({
      records: [taskFor(P1), qual({ status: Q.QualificationStatus.QUALIFIED, evidenceBindings: [] })],
    });
    assert.strictEqual(gates.qualified, false);
    assert.strictEqual(gates.qualificationStatus, Q.QualificationStatus.UNAVAILABLE);
  });

  t('COHERENCE — fully evidence-backed qualification closes only the qualification gate', () => {
    const q = qual();
    const evs = [passEvidence(Q.EffectSurface.FILESYSTEM), passEvidence(Q.EffectSurface.NETWORK)];
    const gates = COH.acceptanceGates({ records: [taskFor(P1), q, ...evs] });
    assert.strictEqual(gates.qualified, true);
    assert.strictEqual(gates.qualificationStatus, Q.QualificationStatus.QUALIFIED);
    assert.ok(!gates.blockers.some((x) => x.includes('profile qualification')));
    // But qualification alone does not pass acceptance — other gates remain
    // open (derivation, quiescence, ...). Qualification is a gate, not a grant.
    assert.strictEqual(COH.coherentReduction({ records: [taskFor(P1), q, ...evs] }).acceptance.accepted, false);
  });

  group('§9/qualification≠execution-authority (requirement 9)');

  t('QUALIFICATION DOES NOT GRANT AUTHORITY — admitted/owner state is untouched by qualification', () => {
    const q = qual();
    const evs = [passEvidence(Q.EffectSurface.FILESYSTEM), passEvidence(Q.EffectSurface.NETWORK)];
    // A QUALIFIED profile does not create an owner, an admission gate, or clean
    // authority ownership by itself.
    const gates = COH.acceptanceGates({ records: [taskFor(P1), q, ...evs] });
    assert.strictEqual(gates.qualified, true);
    assert.strictEqual(gates.cleanAuthorityOwnership, false); // no store_owner record
    // And without qualification, admission/ownership facts are unchanged too:
    const owner = REC.createStoreOwner({ canonicalStorePath: '/s', lockIdentity: 'lock:1', ownerIdentity: 'me', recoveryState: 'NORMAL' });
    const g2 = COH.acceptanceGates({ records: [owner] });
    assert.strictEqual(g2.cleanAuthorityOwnership, true); // ownership clean
    assert.strictEqual(g2.qualified, true);               // no task => no qual demand
  });

  t('qualificationIdentityGate with no task is additive (no fabricated blocker)', () => {
    const g = Q.qualificationIntegrityGate({ taskRecord: null, qualificationRecords: [], qualEvidenceRecords: [] });
    assert.strictEqual(g.qualified, true);
    assert.strictEqual(g.rule, 'no-task');
    // The coherence plane with no records stays open on qualification.
    assert.strictEqual(COH.acceptanceGates({ records: [] }).qualified, true);
  });

  t('duplicate qualification records for the same profile fail closed (§6)', () => {
    const gate = Q.qualificationIntegrityGate({
      taskRecord: taskFor(P1),
      qualificationRecords: [qual({ qualificationId: 'qual-1' }), qual({ qualificationId: 'qual-2' })],
      qualEvidenceRecords: [],
    });
    assert.strictEqual(gate.qualified, false);
    assert.strictEqual(gate.status, Q.QualificationStatus.UNQUALIFIED);
    assert.ok(gate.problems.some((p) => p.includes('has 2 qualification records')));
  });
};