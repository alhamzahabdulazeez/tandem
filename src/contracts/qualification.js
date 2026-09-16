'use strict';
/**
 * qualification — §5 Qualification Contract: determine, from evidence alone,
 * whether a concrete execution profile is qualified.
 *
 * A capability is NOT qualified merely because an executable exists, a command
 * succeeds once, a configuration claims isolation, a wrapper exists, or a test
 * says it is isolated. Qualification MUST be evidence-based, cover the actual
 * advertised execution boundary and its relevant transitive effects, bind to the
 * actual runtime/profile identity and configuration, and fail closed on
 * missing/stale/contradictory/incomplete/untrusted evidence. One environment's
 * qualification evidence MUST NOT be silently reused for another incompatible
 * runtime/profile.
 *
 * Qualification does NOT itself grant execution authority — it stays separate
 * from admission, ownership, and authority. The reducer only says what the
 * records prove; admission/release gates are elsewhere.
 *
 * Every function is pure (no I/O), deterministic, and fail-closed:
 * absent evidence => UNAVAILABLE; any failed/stale/contradictory/mis-bound
 * evidence => UNQUALIFIED. Nothing is EVER derived by model reasoning.
 *
 * PRD references: §5 (Qualification Contract), §1 binding rows 6/12,
 * §21 (acceptance — qualification is a gate the coherence plane consumes,
 * not an admission).
 */

const { contentId, canonicalJson } = require('./crypto.js');

// ---------------------------------------------------------------------------
// §5 Qualification status (requirement 7: the explicit states)
// ---------------------------------------------------------------------------

const QualificationStatus = Object.freeze({
  QUALIFIED:   'QUALIFIED',     // every required surface has fresh, passing,
                                // consistent evidence bound to this profile
  UNQUALIFIED: 'UNQUALIFIED',   // at least one required proof failed, is stale,
                                // contradictory, mis-bound, or missing
  UNAVAILABLE: 'UNAVAILABLE',   // no qualification evidence at all for this profile
  INCONCLUSIVE:'INCONCLUSIVE',  // evidence exists but is ambiguous/contradictory
                                // and cannot decide qualification
});

/** The explicit qualification states (order is report/display only). */
const QUALIFICATION_STATES = [
  QualificationStatus.QUALIFIED,
  QualificationStatus.UNQUALIFIED,
  QualificationStatus.UNAVAILABLE,
  QualificationStatus.INCONCLUSIVE,
];

/** The 14 reachable effect surfaces of the advertised boundary (PRD §5 table). */
const EffectSurface = Object.freeze({
  TOOL_INVOCATION:        'TOOL_INVOCATION',        // pre-effect admission incl. hidden tools
  FILESYSTEM:             'FILESYSTEM',             // runtime-enforced readable/writable scope
  DESCENDANTS:            'DESCENDANTS',            // detached children/grandchildren stay contained
  HANDLES:                'HANDLES',                // no inherited approval/credential/control bypass
  HOST_IPC:               'HOST_IPC',               // daemons, service managers, schedulers unavailable
  NETWORK:                'NETWORK',                // local-only denial or admitted transport
  MODEL_TRAFFIC:          'MODEL_TRAFFIC',          // prompts/attachments/retries/fallback covered
  DIAGNOSTICS:            'DIAGNOSTICS',            // unqualified telemetry disabled/unreachable
  CREDENTIALS:            'CREDENTIALS',            // repo execution does not inherit creds
  SUPERVISOR_CONTROL:     'SUPERVISOR_CONTROL',     // untrusted code cannot approve/grant/mutate
  RESOURCES:              'RESOURCES',              // time/output/memory/process/storage bounds enforced
  CANCELLATION:           'CANCELLATION',           // descendants/handles/writes drained or fenced
  FAILURE_RESTART:        'FAILURE_RESTART',        // loss of control closes admission; no revival
  BASELINE_VERIFIER:      'BASELINE_VERIFIER',      // checker/verifier use the same admission
});

const EFFECT_SURFACES = Object.values(EffectSurface);

/** How a surface's proof was actually obtained (binding row incl. §5 evidence). */
const EvidenceMethod = Object.freeze({
  NAMESPACE_TEST:      'NAMESPACE_TEST',      // dedicated execution identity / containment namespace
  CGROUP_TEST:         'CGROUP_TEST',         // cgroup-v2 resource control test
  CONTAINMENT_TEST:    'CONTAINMENT_TEST',    // detached-subprocess containment proof
  NETWORK_PROBE:       'NETWORK_PROBE',       // local-only denial / admitted-transport probe
  ACCESS_TEST:         'ACCESS_TEST',         // filesystem/credential/handle access test
  ISOLATION_TEST:      'ISOLATION_TEST',      // host-IPC / service / control-channel isolation test
  RESOURCE_TEST:       'RESOURCE_TEST',       // hard-bound enforcement (memory/process/time/storage)
  DRAIN_TEST:          'DRAIN_TEST',          // cancellation / drain / fence test
  RESTART_TEST:        'RESTART_TEST',        // failure/restart: admission closes, no revival
  CONFIGURATION_AUDIT: 'CONFIGURATION_AUDIT', // audited runtime/config/mount/transport config
  BEHAVIORAL_OBSERVATION: 'BEHAVIORAL_OBSERVATION', // observed behavior by a protected observer
  COMPOSITE:           'COMPOSITE',           // a combined suite covering several surfaces
});

const EVIDENCE_METHODS = new Set(Object.values(EvidenceMethod));

/** Result of one evidence invocation (raw outcome, distinct from the verdict). */
const EvidenceResult = Object.freeze({
  PASS:        'PASS',        // the probe observed the claimed property
  FAIL:        'FAIL',        // the probe observed a violation (fail closed)
  INCONCLUSIVE:'INCONCLUSIVE', // the probe could not decide
  STALE:       'STALE',       // superseded by newer evidence for the same surface
});

const EVIDENCE_RESULTS = new Set(Object.values(EvidenceResult));

/** Deterministic reason a profile fails to be qualified (requirement 12/13). */
const FailureMode = Object.freeze({
  WRONG_PROFILE:       'wrong_profile',       // evidence bound to another runtime/profile identity
  STALE_EVIDENCE:      'stale_evidence',      // everything for a surface is stale
  CONTRADICTION:       'contradiction',       // PASS and FAIL for the same surface
  MISSING_SURFACE:     'missing_surface',     // a declared surface has no evidence
  INSUFFICIENT_COVERAGE: 'insufficient_coverage', // surfaces declared but proof does not cover them
  UNTRUSTED_SOURCE:    'untrusted_source',    // evidence source is not an authorized qualified observer
  CONFIGURATION_CHANGED: 'configuration_changed', // config/runtime drift after the evidence ran
  INCOMPLETE_EVIDENCE: 'incomplete_evidence', // evidence lacks mandatory fields to count as proof
});

const FAILURE_MODES = new Set(Object.values(FailureMode));

// ---------------------------------------------------------------------------
// §5 Record shapes
// ---------------------------------------------------------------------------

/**
 * Create a durable qualification record: the support record that attests a
 * concrete runtime profile's qualification status and the evidence that must
 * back it (PRD §5: "a descriptive label is not a populated support record").
 */
function createQualification({
  qualificationId,
  profileId,
  profileVersion,
  profileDigest,
  status,
  evidenceBindings = [], // [{ surface, evidenceIds: [] }]
  admittedByContract = '',   // host OS/runtime contract this qualification is scoped to
  invalidationConditions = '', // what must change before evidence is re-run
  qualificationSummary = '',
  claimedAt = 0,
}) {
  if (typeof qualificationId !== 'string' || qualificationId.length === 0) {
    throw new Error('createQualification: qualificationId required');
  }
  if (typeof profileId !== 'string' || profileId.length === 0) {
    throw new Error('createQualification: profileId required');
  }
  return {
    schemaVersion: require('./records.js').SCHEMA_VERSION,
    kind: 'qualification',
    qualificationId,
    profileId,
    profileVersion: profileVersion || null,
    profileDigest: profileDigest || null,
    status: status || QualificationStatus.UNAVAILABLE,
    evidenceBindings: Array.isArray(evidenceBindings) ? evidenceBindings.slice() : [],
    admittedByContract: admittedByContract || null,
    invalidationConditions: invalidationConditions || null,
    qualificationSummary: qualificationSummary || null,
    claimedAt: claimedAt || 0,
  };
}

/**
 * Create a durable qualification-evidence record: one concrete proof of one
 * effect surface for one runtime/profile identity.
 */
function createQualEvidence({
  qualEvidenceId,
  surface,
  method,
  evidenceProfileBinding,   // the profileId this evidence actually proves
  result,
  timestamp,
  observerIdentity = null, // the authorized protected observer that ran the probe
  limitations = [],
  rawEvidencePath = null,
}) {
  if (typeof qualEvidenceId !== 'string' || qualEvidenceId.length === 0) {
    throw new Error('createQualEvidence: qualEvidenceId required');
  }
  if (!EFFECT_SURFACES.includes(surface)) {
    throw new Error(`createQualEvidence: unknown surface "${surface}"`);
  }
  return {
    schemaVersion: require('./records.js').SCHEMA_VERSION,
    kind: 'qual_evidence',
    qualEvidenceId,
    surface,
    method: method || null,
    evidenceProfileBinding: evidenceProfileBinding || null,
    result: result || EvidenceResult.INCONCLUSIVE,
    timestamp: typeof timestamp === 'number' ? timestamp : 0,
    observerIdentity: observerIdentity || null,
    limitations: Array.isArray(limitations) ? limitations.slice() : [],
    rawEvidencePath: rawEvidencePath || null,
    // Integrity: the evidence item is a recorded fact; its digest binds surface,
    // profile, and result so it cannot be silently rewritten after fact.
    evidenceDigest: contentId(canonicalJson({
      qualEvidenceId,
      surface,
      method,
      evidenceProfileBinding,
      result,
      timestamp,
      limitations,
      rawEvidencePath,
    })),
  };
}

// ---------------------------------------------------------------------------
// §5 Qualification reducer (evidence required; fail closed)
// ---------------------------------------------------------------------------

/**
 * Reduce the actual qualification status of one profile from its qualification
 * record + evidence records. This is the single authority: the claimed `status`
 * field on the qualification record is ONLY an admission label and is NEVER
 * trusted — the reducer re-derives the real status from the evidence bindings
 * and the raw evidence outcomes (requirement 2: evidence-based, a test saying
 * "isolated" is not proof).
 *
 * @param {object} opts
 * @param {object} opts.qualification — a qualification record
 * @param {object[]} opts.evidence — qual_evidence records (may be empty)
 * @returns {{
 *   status: string,             // one of QualificationStatus
 *   failureModes: string[],     // FailureMode values when NOT QUALIFIED
 *   problems: string[],         // human-readable reasons
 *   staleEvidence: string[],    // evidence ids superseded by newer proof
 *   coveredSurfaces: string[],  // surfaces with at least one PASS
 *   claimedStatus: string       // the record's own label (truthfully reported,
 *                               // never used as authority)
 * }} fail-closed
 */
function resolveQualification({ qualification, evidence }) {
  const problems = [];
  const failureModes = [];
  const staleEvidence = [];
  const list = Array.isArray(evidence) ? evidence : [];

  if (!qualification || typeof qualification !== 'object') {
    return {
      status: QualificationStatus.UNAVAILABLE,
      failureModes: [FailureMode.INCOMPLETE_EVIDENCE],
      problems: ['no qualification record; nothing to reduce'],
      staleEvidence: [],
      coveredSurfaces: [],
      claimedStatus: null,
    };
  }

  const profileId = qualification.profileId;
  const claimedStatus = qualification.status;
  const bindings = Array.isArray(qualification.evidenceBindings) ? qualification.evidenceBindings : [];

  if (!profileId || typeof profileId !== 'string' || profileId.length === 0) {
    return {
      status: QualificationStatus.UNQUALIFIED,
      failureModes: [FailureMode.INCOMPLETE_EVIDENCE],
      problems: ['qualification record has no profileId to bind evidence to'],
      staleEvidence: [],
      coveredSurfaces: [],
      claimedStatus,
    };
  }

  if (list.length === 0) {
    return {
      status: QualificationStatus.UNAVAILABLE,
      failureModes: [FailureMode.MISSING_SURFACE],
      problems: [`no qualification evidence for profile ${profileId} — a descriptive label is not qualification (§5)`],
      staleEvidence: [],
      coveredSurfaces: [],
      claimedStatus,
    };
  }

  // --- Validate the evidence set itself (fail closed). -------------------
  const evidenceForProfile = [];
  for (const ev of list) {
    if (!ev || typeof ev !== 'object') {
      problems.push('malformed qual_evidence record');
      failureModes.push(FailureMode.INCOMPLETE_EVIDENCE);
      continue;
    }
    // Wrong runtime/profile identity: evidence for another profile must never
    // be silently reused (requirement 6).
    if (ev.evidenceProfileBinding !== profileId) {
      problems.push(
        `qual_evidence ${ev.qualEvidenceId || '?'} is bound to profile "${ev.evidenceProfileBinding}" ` +
        `not "${profileId}"; cross-profile reuse is prohibited (§5)`
      );
      failureModes.push(FailureMode.WRONG_PROFILE);
      continue;
    }
    // Untrusted source: evidence must come from an authorized observer.
    if (!ev.observerIdentity || typeof ev.observerIdentity !== 'string' || ev.observerIdentity.length === 0) {
      problems.push(`qual_evidence ${ev.qualEvidenceId || '?'} has no authorized observer identity (untrusted source)`);
      failureModes.push(FailureMode.UNTRUSTED_SOURCE);
      continue;
    }
    // Incomplete evidence cannot count as proof.
    if (!ev.surface || !EFFECT_SURFACES.includes(ev.surface)) {
      problems.push(`qual_evidence ${ev.qualEvidenceId || '?'} missing a valid surface`);
      failureModes.push(FailureMode.INCOMPLETE_EVIDENCE);
      continue;
    }
    if (!ev.method || !EVIDENCE_METHODS.has(ev.method)) {
      problems.push(`qual_evidence ${ev.qualEvidenceId || '?'} missing a valid evidence method`);
      failureModes.push(FailureMode.INCOMPLETE_EVIDENCE);
      continue;
    }
    if (typeof ev.timestamp !== 'number' || !(ev.timestamp > 0)) {
      problems.push(`qual_evidence ${ev.qualEvidenceId || '?'} has no valid timestamp (stale/undatable evidence cannot qualify)`);
      failureModes.push(FailureMode.INCOMPLETE_EVIDENCE);
      continue;
    }
    evidenceForProfile.push(ev);
  }

  // --- Determine staleness: for each surface, older evidence for the same
  //     surface is STALE once a newer entry exists. Config drift is detected
  //     when the evidence's profile/digest binding disagrees with the current
  //     qualification (requirement 5).
  const bySurface = new Map();
  for (const ev of evidenceForProfile) {
    if (!bySurface.has(ev.surface)) bySurface.set(ev.surface, []);
    bySurface.get(ev.surface).push(ev);
  }

  const newestPerSurface = new Map();
  for (const [surface, evs] of bySurface) {
    evs.sort((a, b) => a.timestamp - b.timestamp);
    newestPerSurface.set(surface, evs[evs.length - 1]);
  }

  // Mark any non-newest record as stale (reported, and it no longer counts as
  // standing proof of the surface).
  for (const ev of evidenceForProfile) {
    const newest = newestPerSurface.get(ev.surface);
    if (newest && newest.qualEvidenceId !== ev.qualEvidenceId && ev.timestamp !== newest.timestamp) {
      staleEvidence.push(ev.qualEvidenceId);
      // (we do not mutate the record; we just exclude it from standing proof)
    }
  }

  // --- Cover the declared surface set; anything declared must be provable. --
  const declaredSurfaces = new Set();
  for (const b of bindings) {
    if (b && b.surface) declaredSurfaces.add(b.surface);
  }
  // Add to declared surfaces the surfaces that actually have evidence (so a
  // qualification record declaring too narrow a surface set, but with broad
  // evidence, is still measured against what it claims to prove).
  // Standing (non-stale, PASS-or-not) evidence per surface:
  const coveredSurfaces = [];
  for (const [surface, evs] of bySurface) {
    const newest = newestPerSurface.get(surface);
    if (newest && newest.result === EvidenceResult.PASS) coveredSurfaces.push(surface);
  }

  // 1) A surface with a FAIL result (newest or not) is a hard unqualifier —
  //    never downgraded, never ignored.
  let anyFail = false;
  for (const ev of evidenceForProfile) {
    if (ev.result === EvidenceResult.FAIL) {
      anyFail = true;
      problems.push(`qual_evidence ${ev.qualEvidenceId}: surface ${ev.surface} FAILED its probe — the boundary is not proven`);
      failureModes.push(FailureMode.CONTRADICTION);
    }
  }
  if (anyFail) {
    // Even a single FAIL disqualifies; never let an older PASS mask it. But a
    // PASS+FAIL for the same surface is contradiction; FAIL alone is also
    // unqualified either way. Report INCONCLUSIVE when mixed on the same surface.
    let mixed = false;
    for (const [surface, evs] of bySurface) {
      const results = new Set(evs.map((e) => e.result));
      if (results.has(EvidenceResult.PASS) && results.has(EvidenceResult.FAIL)) mixed = true;
    }
    return {
      status: mixed ? QualificationStatus.INCONCLUSIVE : QualificationStatus.UNQUALIFIED,
      failureModes: [...new Set(failureModes)],
      problems,
      staleEvidence,
      coveredSurfaces,
      claimedStatus,
    };
  }

  // 2) INCONCLUSIVE outcomes that cannot decide — fail closed before
  //    checking missing surfaces, because an INCONCLUSIVE surface is
  //    neither proven nor missing; it is ambiguous, which is distinct.
  const inconclusive = evidenceForProfile.filter((e) => e.result === EvidenceResult.INCONCLUSIVE);
  if (inconclusive.length > 0) {
    return {
      status: QualificationStatus.INCONCLUSIVE,
      failureModes: [FailureMode.INCOMPLETE_EVIDENCE],
      problems: inconclusive.map((e) => `qual_evidence ${e.qualEvidenceId}: surface ${e.surface} is INCONCLUSIVE`),
      staleEvidence,
      coveredSurfaces,
      claimedStatus,
    };
  }

  // 3) Missing evidence for a declared surface.
  const declaredButUnproven = [];
  for (const surface of declaredSurfaces) {
    const newest = newestPerSurface.get(surface);
    if (!newest || newest.result !== EvidenceResult.PASS) {
      declaredButUnproven.push(surface);
      const reason = newest && newest.result === EvidenceResult.STALE
        ? `surface ${surface}: only stale evidence (superseded)`
        : newest
          ? `surface ${surface}: newest evidence is ${newest.result}`
          : `surface ${surface}: no evidence at all`;
      problems.push(reason);
      failureModes.push(FailureMode.MISSING_SURFACE);
    }
  }

  // 4) All evidence for a surface is STALE (superseded) => surface unproven.
  for (const [surface, evs] of bySurface) {
    const newest = newestPerSurface.get(surface);
    if (newest && newest.result === EvidenceResult.STALE) {
      problems.push(`surface ${surface}: all evidence is STALE — must be re-run`);
      failureModes.push(FailureMode.STALE_EVIDENCE);
    }
  }

  if (failureModes.length > 0) {
    return {
      status: QualificationStatus.UNQUALIFIED,
      failureModes: [...new Set(failureModes)],
      problems,
      staleEvidence,
      coveredSurfaces,
      claimedStatus,
    };
  }

  // 5) All declared surfaces have fresh, PASSING, profile-bound evidence.
  return {
    status: QualificationStatus.QUALIFIED,
    failureModes: [],
    problems: [],
    staleEvidence,
    coveredSurfaces,
    claimedStatus,
  };
}

// ---------------------------------------------------------------------------
// §5 Coherence gate (integrated into the §21 coherence plane)
// ---------------------------------------------------------------------------

/**
 * Reduce qualification-integrity facts for the §21 acceptance plane. Called
 * from acceptanceGates when a task record is present. Qualification is a
 * precondition for supervised execution, but NEVER itself grants execution
 * authority (requirement 9).
 *
 * @param {object} opts
 * @param {object|null} opts.taskRecord — active task_incarnation
 * @param {object[]} opts.qualificationRecords — qualification records in store
 * @param {object[]} opts.qualEvidenceRecords — qual_evidence records in store
 * @returns {{ qualified: boolean, status: string|null, rule: string, problems: string[] }}
 */
function qualificationIntegrityGate({ taskRecord, qualificationRecords, qualEvidenceRecords }) {
  const quals = Array.isArray(qualificationRecords) ? qualificationRecords : [];
  const evid = Array.isArray(qualEvidenceRecords) ? qualEvidenceRecords : [];

  const profileId = taskRecord ? (taskRecord.runtimeProfileId || null) : null;

  // No active task => no qualification demand surfaces (additive; never a
  // fabricated blocker). Absent profileId on the task => its runtime is
  // unbound, so it cannot be a qualified execution.
  if (profileId === null || typeof profileId !== 'string' || profileId.length === 0) {
    if (!taskRecord) return { qualified: true, status: null, rule: 'no-task', problems: [] };
    return {
      qualified: false,
      status: QualificationStatus.UNAVAILABLE,
      rule: 'unbound-task-profile',
      problems: ['active task has no runtimeProfileId — it cannot be a qualified execution (§5)'],
    };
  }

  if (quals.length === 0) {
    return {
      qualified: false,
      status: QualificationStatus.UNAVAILABLE,
      rule: 'no-qualification-record',
      problems: [`no qualification record for profile "${profileId}" — a missing support record is not qualification (§5)`],
    };
  }

  // A qualification record for THIS profile only.
  const mine = quals.filter((q) => q && q.profileId === profileId);
  if (mine.length === 0) {
    return {
      qualified: false,
      status: QualificationStatus.UNAVAILABLE,
      rule: 'profile-mismatch',
      problems: [`no qualification record matches profile "${profileId}" (found: ${quals.map((q) => q.profileId || '?').join(', ') || 'none'})`],
    };
  }

  // Multiple qualification records for the same profile fail closed (they
  // cannot both be authoritative).
  if (mine.length > 1) {
    return {
      qualified: false,
      status: QualificationStatus.UNQUALIFIED,
      rule: 'contradictory-qualifications',
      problems: [`profile "${profileId}" has ${mine.length} qualification records; duplicate support records fail closed (§6)`],
    };
  }

  const verdict = resolveQualification({ qualification: mine[0], evidence: evid });
  return {
    qualified: verdict.status === QualificationStatus.QUALIFIED,
    status: verdict.status,
    rule: 'evidence-reduced',
    problems: verdict.problems,
    failureModes: verdict.failureModes,
    staleEvidence: verdict.staleEvidence,
    coveredSurfaces: verdict.coveredSurfaces,
  };
}

module.exports = {
  QualificationStatus,
  QUALIFICATION_STATES,
  EffectSurface,
  EFFECT_SURFACES,
  EvidenceMethod,
  EVIDENCE_METHODS,
  EvidenceResult,
  EVIDENCE_RESULTS,
  FailureMode,
  FAILURE_MODES,
  createQualification,
  createQualEvidence,
  resolveQualification,
  qualificationIntegrityGate,
};