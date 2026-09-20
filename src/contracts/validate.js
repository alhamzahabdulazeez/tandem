'use strict';
/**
 * Schema validation for TANDEM record types.
 *
 * Every authoritative record MUST fail closed on malformed data (§6):
 * "Unknown enums, malformed records, conflicting duplicate identities, or
 * invalid digests MUST fail closed." This module encodes those invariants
 * as pure validation functions that the future durable store will apply
 * before committing any record.
 *
 * These are pure functions — no I/O, fully unit-testable offline.
 */

const {
  SCHEMA_VERSION,
  TaskPhase,
  TerminalResult,
  ActionLifecycle,
  ActionDispatch,
  ActionExecution,
  UseAllowance,
  Liability,
  ResourceDisposition,
  GenerationState,
  PolicyStage,
  ObligationOutcome,
  Assurance,
} = require('./records.js');
const { isContentId, sha256 } = require('./crypto.js');
const { IntentClass } = require('./intent.js');
const {
  QualificationStatus,
  EffectSurface,
  EFFECT_SURFACES,
  EvidenceMethod,
  EVIDENCE_METHODS,
  EvidenceResult,
  EVIDENCE_RESULTS,
} = require('./qualification.js');
const {
  EvidenceOutcome,
  VALID_OUTCOMES,
  InvalidationReason,
} = require('./evidence-pipeline.js');

// ---------------------------------------------------------------------------
// Enum membership sets
// ---------------------------------------------------------------------------

/** The field each record kind uses as its stable identity for store folding. */
const RECORD_ID_FIELDS = {
  store_owner: 'lockIdentity',
  lineage: 'lineageId',
  task_incarnation: 'incarnationId',
  action: 'actionId',
  policy: 'policyId',
  acceptance_contract: 'contractId',
  budget: 'lineageId',
  source_capture: 'captureId',
  generation: 'generationId',
  observer_run: 'runId',
  delivery: 'deliveryId',
  finalization: 'finalizationId',
  repair: 'repairId',
  intent: 'requirementId',
  qualification: 'qualificationId',
  qual_evidence: 'qualEvidenceId',
  evidence: 'evidenceId',
  evidence_invalidation: 'invalidationId',
  epoch_alloc: 'epochId',
  quarantine: 'quarantineId',
  action_consumption: 'consumptionId',
  reservation: 'reservationId',
};

const ENUMS = {
  TaskPhase: new Set(Object.values(TaskPhase)),
  TerminalResult: new Set(Object.values(TerminalResult)),
  ActionLifecycle: new Set(Object.values(ActionLifecycle)),
  ActionDispatch: new Set(Object.values(ActionDispatch)),
  ActionExecution: new Set(Object.values(ActionExecution)),
  UseAllowance: new Set(Object.values(UseAllowance)),
  Liability: new Set(Object.values(Liability)),
  ResourceDisposition: new Set(Object.values(ResourceDisposition)),
  GenerationState: new Set(Object.values(GenerationState)),
  PolicyStage: new Set(Object.values(PolicyStage)),
  ObligationOutcome: new Set(Object.values(ObligationOutcome)),
  Assurance: new Set(Object.values(Assurance)),

  // §13 intent classification (Unit 13)
  IntentClass: new Set(Object.values(IntentClass)),

  // §5 qualification (Unit 14)
  QualificationStatus: new Set(Object.values(QualificationStatus)),
  EffectSurface: new Set(EFFECT_SURFACES),
  EvidenceMethod: new Set(EVIDENCE_METHODS),
  EvidenceResult: new Set(EVIDENCE_RESULTS),

  // Control-layer record kinds (units: ownership/recovery/admission/budget)
  EpochRole: new Set(['INITIAL', 'SUPERVISOR', 'RECOVERY']),
  QuarantineState: new Set(['ACTIVE', 'RELEASED']),
  ReservationKind: new Set(['DISCRETIONARY', 'MANDATORY']),
  ReservationState: new Set(['ACTIVE', 'SETTLED', 'RELEASED_NON_DISPATCH', 'CONSUMED']),
  DispatchAck: new Set(['ACKNOWLEDGED', 'KNOWN_NOT_DISPATCHED', 'UNKNOWN']),
};

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Return a list of problems. Empty list => valid.
 * @param {object} record
 * @param {Array<[string, (v, record) => string|null]>} rules
 *   each rule: [fieldName, validator] where validator returns null or an error string.
 * @returns {string[]}
 */
function check(record, rules) {
  const problems = [];
  if (record === null || typeof record !== 'object') {
    return ['record must be an object'];
  }
  for (const [field, validate] of rules) {
    const err = validate(record[field], record);
    if (err) problems.push(err);
  }
  return problems;
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

function isStringOrNull(v) {
  return v === null || typeof v === 'string';
}

function isObjectOrNull(v) {
  return v === null || (typeof v === 'object' && !Array.isArray(v));
}

function isNumberOrNull(v) {
  return v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0);
}

function enumMember(setName) {
  return (v, rec) => {
    if (!ENUMS[setName].has(v)) {
      return `${rec.kind}: invalid ${setName} value "${String(v)}"`;
    }
    return null;
  };
}

const required = (field) => (v, rec) => {
  if (!isNonEmptyString(v)) return `${rec.kind}: field "${field}" must be a non-empty string`;
  return null;
};

// ---------------------------------------------------------------------------
// Per-kind validators
// ---------------------------------------------------------------------------

/** Validate that the record is stamped with the current schema version. */
const schemaVersionOk = (v, rec) => {
  if (v !== SCHEMA_VERSION) {
    return `${rec.kind}: schemaVersion must be ${SCHEMA_VERSION}`;
  }
  return null;
};

const KIND_VALIDATORS = {
  store_owner(rec) {
    return check(rec, [
      ['schemaVersion', schemaVersionOk],
      ['canonicalStorePath', required('canonicalStorePath')],
      ['lockIdentity', required('lockIdentity')],
      ['ownerIdentity', required('ownerIdentity')],
      // Additive optional-field validators (Unit 15, §6/§10):
      // If the field is present it must be valid; if absent the record is still
      // valid (the identity gate enforces the strict invariants, not the record
      // validator). `currentEpoch: 0` is the createStoreOwner default sentinel.
      ['currentEpoch', (v) => {
        if (v === undefined || v === null) return null;
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
          return 'store_owner.currentEpoch must be a non-negative integer if present';
        }
        return null;
      }],
      ['recoveryState', (v) => {
        if (v === undefined || v === null) return null;
        if (!['NORMAL', 'RECOVERY'].includes(v)) {
          return 'store_owner.recoveryState must be NORMAL or RECOVERY if present';
        }
        return null;
      }],
      ['admissionState', (v) => {
        if (v === undefined || v === null) return null;
        if (!['OPEN', 'CLOSED'].includes(v)) {
          return 'store_owner.admissionState must be OPEN or CLOSED if present';
        }
        return null;
      }],
    ]);
  },

  lineage(rec) {
    return check(rec, [
      ['schemaVersion', schemaVersionOk],
      ['lineageId', required('lineageId')],
    ]);
  },

  task_incarnation(rec) {
    return check(rec, [
      ['schemaVersion', schemaVersionOk],
      ['taskId', required('taskId')],
      ['lineageId', required('lineageId')],
      ['incarnationId', required('incarnationId')],
      ['ownerEpoch', required('ownerEpoch')],
      ['phase', enumMember('TaskPhase')],
      ['originalRequest', required('originalRequest')],
      // §5 runtime profile identity: optional (absent = runtime unbound,
      // which the qualification gate treats as UNAVAILABLE).
      ['runtimeProfileId', (v) => (
        v === undefined || v === null || typeof v === 'string' && v.length > 0
          ? null : 'task_incarnation: runtimeProfileId must be undefined, null, or a non-empty string'
      )],
    ]);
  },

  action(rec) {
    const problems = check(rec, [
      ['schemaVersion', schemaVersionOk],
      ['actionId', required('actionId')],
      ['incarnationId', required('incarnationId')],
      ['ownerEpoch', required('ownerEpoch')],
      ['operation', required('operation')],
      ['useAllowance', enumMember('UseAllowance')],
      ['liability', enumMember('Liability')],
      ['lifecycle', enumMember('ActionLifecycle')],
      ['dispatch', enumMember('ActionDispatch')],
      ['execution', enumMember('ActionExecution')],
      ['resourceDisposition', enumMember('ResourceDisposition')],
    ]);
    return problems;
  },

  policy(rec) {
    return check(rec, [
      ['schemaVersion', schemaVersionOk],
      ['policyId', required('policyId')],
      ['stage', enumMember('PolicyStage')],
    ]);
  },

  acceptance_contract(rec) {
    return check(rec, [
      ['schemaVersion', schemaVersionOk],
      ['contractId', required('contractId')],
      ['taskId', required('taskId')],
      ['incarnationId', required('incarnationId')],
      ['frozen', (v) => (typeof v !== 'boolean' ? 'acceptance_contract: frozen must be a boolean' : null)],
    ]);
  },

  budget(rec) {
    return check(rec, [
      ['schemaVersion', schemaVersionOk],
      ['lineageId', required('lineageId')],
    ]);
  },

  source_capture(rec) {
    return check(rec, [
      ['schemaVersion', schemaVersionOk],
      ['captureId', required('captureId')],
      ['incarnationId', required('incarnationId')],
      ['commitIdentity', required('commitIdentity')],
      ['baselineManifestIdentity', (v) => (
        isContentId(v) ? null
          : 'source_capture: baselineManifestIdentity must be a content identity (sha256:<hex>)'
      )],
      ['rules', (v) => {
        if (!v || typeof v !== 'object') return 'source_capture: rules must be an object';
        if (typeof v.excludeDirty !== 'boolean') return 'source_capture: rules.excludeDirty must be a boolean';
        return null;
      }],
      ['integrity', (v) => {
        if (!v || typeof v !== 'object') return 'source_capture: integrity must be an object';
        for (const k of ['objectIdentitiesVerified', 'treeEnumerationComplete', 'independentRetentionEstablished']) {
          if (v[k] !== true) return `source_capture: integrity.${k} must be true`;
        }
        return null;
      }],
    ]);
  },

  generation(rec) {
    return check(rec, [
      ['schemaVersion', schemaVersionOk],
      ['generationId', required('generationId')],
      ['taskId', required('taskId')],
      ['incarnationId', required('incarnationId')],
      ['state', enumMember('GenerationState')],
      ['baselineIdentity', (v) => (v === null || isContentId(v) ? null
        : 'generation: baselineIdentity must be a content id or null')],
      ['treeDigest', (v) => (v === null || isContentId(v) ? null
        : 'generation: treeDigest must be a content id or null')],
      ['createOnceIdentity', (v) => (v === null || (typeof v === 'string' && v.length > 0) ? null
        : 'generation: createOnceIdentity must be a non-empty string or null')],
      ['manifestIdentity', (v) => (v === null || isContentId(v) ? null
        : 'generation: manifestIdentity must be a content id or null')],
      ['retention', (v) => (v === null || (typeof v === 'object' && !Array.isArray(v)) ? null
        : 'generation: retention must be an object or null')],
    ]);
  },

  observer_run(rec) {
    return check(rec, [
      ['schemaVersion', schemaVersionOk],
      ['runId', required('runId')],
      ['incarnationId', required('incarnationId')],
      ['obligationId', required('obligationId')],
      ['candidateIdentity', (v) => {
        if (!v || typeof v !== 'object') return 'observer_run: candidateIdentity must bind the observed frozen generation';
        if (typeof v.generationId !== 'string' || v.generationId.length === 0) return 'observer_run: candidateIdentity.generationId required';
        if (!isContentId(v.treeDigest)) return 'observer_run: candidateIdentity.treeDigest must be a content identity (observing a writable dir is not observing a frozen generation, §16)';
        return null;
      }],
      ['qualification', (v) => (
        v === null || (typeof v === 'object' && typeof v.name === 'string')
          ? null : 'observer_run: qualification must be null or { qualified, name, version }'
      )],
      ['launch', (v) => (
        v === null || typeof v === 'object'
          ? null : 'observer_run: launch must be an object or null'
      )],
      ['captured', (v) => (
        v === null || typeof v === 'object'
          ? null : 'observer_run: captured must be an object or null'
      )],
      ['classification', (v) => (
        v === 'authoritative' || v === 'supporting'
          ? null : 'observer_run: classification must be authoritative or supporting'
      )],
      ['comparedOutsideExecution', (v) => (
        typeof v === 'boolean' ? null : 'observer_run: comparedOutsideExecution must be a boolean'
      )],
      ['observationPath', (v) => (
        v === null || (typeof v === 'string' && v.length > 0)
          ? null : 'observer_run: observationPath must be a non-empty string or null'
      )],
    ]);
  },

  delivery(rec) {
    return check(rec, [
      ['schemaVersion', schemaVersionOk],
      ['deliveryId', required('deliveryId')],
      ['taskId', required('taskId')],
      ['frozenGenerationId', required('frozenGenerationId')],
    ]);
  },

  finalization(rec) {
    return check(rec, [
      ['schemaVersion', schemaVersionOk],
      ['finalizationId', required('finalizationId')],
      ['incarnationId', required('incarnationId')],
      ['stopReason', required('stopReason')],
      // Additive §19/§23 terminal timestamp: when set, terminalTime is the
      // epoch-ms wall clock the supervisor atomically bound at the terminal
      // reduction (createFinalization defaults it to null). A missing field,
      // null, or a non-negative finite epoch-ms number is lawful; anything else
      // is a malformed timestamp and fails closed with the record shape.
      ['terminalTime', (v) => {
        if (v === undefined || v === null) return null;
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
          return 'finalization: terminalTime must be a non-negative epoch-ms number or null';
        }
        return null;
      }],
      ['admissionClosed', (v) => (typeof v !== 'boolean' ? 'finalization: admissionClosed must be a boolean' : null)],
      ['authorityRetired', (v) => (typeof v !== 'boolean' ? 'finalization: authorityRetired must be a boolean' : null)],
      ['fencingEstablished', (v) => (typeof v !== 'boolean' ? 'finalization: fencingEstablished must be a boolean' : null)],
      ['quiescenceProven', (v) => (typeof v !== 'boolean' ? 'finalization: quiescenceProven must be a boolean' : null)],
      ['unresolvedExecution', (v) => (typeof v !== 'boolean' ? 'finalization: unresolvedExecution must be a boolean' : null)],
    ]);
  },

  repair(rec) {
    return check(rec, [
      ['schemaVersion', schemaVersionOk],
      ['repairId', required('repairId')],
      ['incarnationId', required('incarnationId')],
      ['failureIdentity', (v) => {
        if (!v || typeof v !== 'object') return 'repair: failureIdentity must be the recorded §18 failure identity';
        for (const k of ['requirementOrCheck', 'caseIdentity', 'normalizedSignature']) {
          if (typeof v[k] !== 'string' || v[k].length === 0) return `repair: failureIdentity.${k} required`;
        }
        if (typeof v.rawEvidenceReference !== 'string' || v.rawEvidenceReference.length === 0) {
          return 'repair: failureIdentity.rawEvidenceReference required';
        }
        return null;
      }],
      ['disposableGenerationId', (v) => (v === null || (typeof v === 'string' && v.length > 0) ? null
        : 'repair: disposableGenerationId must be a non-empty string or null')],
      ['allowanceConsumed', (v) => (typeof v !== 'boolean' ? 'repair: allowanceConsumed must be a boolean' : null)],
    ]);
  },

  intent(rec) {
    const problems = check(rec, [
      ['schemaVersion', schemaVersionOk],
      ['requirementId', required('requirementId')],
      // §13 five-way classification is required and must be a known class.
      ['intentClass', (v) => (
        IntentClass && ENUMS.IntentClass.has(v)
          ? null : `intent: intentClass must be one of the §13 intent classes (got "${String(v)}")`
      )],
      ['originalMeaning', required('originalMeaning')],
      // Explicit/inferred axis: only 'explicit' or 'inferred' are lawful.
      ['explicitOrInferred', (v) => (
        v === 'explicit' || v === 'inferred'
          ? null : 'intent: explicitOrInferred must be "explicit" or "inferred"'
      )],
      // Mandatory/optional axis: only 'mandatory' or 'optional'.
      ['mandatoryOrOptional', (v) => (
        v === 'mandatory' || v === 'optional'
          ? null : 'intent: mandatoryOrOptional must be "mandatory" or "optional"'
      )],
      // applicability (§14) must be an explicit enum value.
      ['applicability', (v) => (
        v === 'APPLICABLE' || v === 'NOT_APPLICABLE' || v === 'CONDITIONAL' || v === 'UNRESOLVED'
          ? null : `intent: applicability must be APPLICABLE/NOT_APPLICABLE/CONDITIONAL/UNRESOLVED (got "${String(v)}")`
      )],
      ['contentHash', (v) => (
        v === null || isContentId(v) ? null : 'intent: contentHash must be a content identity or null'
      )],
      // §13 provenance flags: if unsupported is claimed, it must be coherent.
      ['verifiedInScope', (v) => (typeof v !== 'boolean' ? 'intent: verifiedInScope must be a boolean' : null)],
      ['unsupported', (v) => (typeof v !== 'boolean' ? 'intent: unsupported must be a boolean' : null)],
      ['excludedByContract', (v) => (typeof v !== 'boolean' ? 'intent: excludedByContract must be a boolean' : null)],
    ]);

    // Cross-field coherence (fail closed): an UNSUPPORTED entry cannot also be
    // marked explicit-user-stated; a USER_STATED entry cannot be 'inferred'.
    if (problems.length === 0) {
      if (rec.intentClass === 'UNSUPPORTED' && rec.excludedByContract === true) {
        problems.push('intent: UNSUPPORTED and excludedByContract are mutually exclusive');
      }
      if (rec.intentClass === 'USER_STATED' && rec.explicitOrInferred !== 'explicit') {
        problems.push('intent: USER_STATED requires explicit provenance');
      }
    }
    return problems;
  },

  qualification(rec) {
    const problems = check(rec, [
      ['schemaVersion', schemaVersionOk],
      ['qualificationId', required('qualificationId')],
      // The profile identity the qualification claims to prove (§5 Identity).
      ['profileId', required('profileId')],
      // status is the ADMISSION label only; the reducer rediscovers the real
      // status from evidence. It must at least be a known §5 state.
      ['status', (v) => (
        QualificationStatus && ENUMS.QualificationStatus.has(v)
          ? null : `qualification: status must be one of the §5 qualification states (got "${String(v)}")`
      )],
      ['profileVersion', (v) => (v === null || isNonEmptyString(v) ? null : 'qualification: profileVersion must be a non-empty string or null')],
      ['profileDigest', (v) => (v === null || isContentId(v) ? null : 'qualification: profileDigest must be a content identity or null')],
      ['claimedAt', (v) => (typeof v !== 'number' || !Number.isFinite(v) || v < 0 ? 'qualification: claimedAt must be a non-negative number' : null)],
      // Evidence bindings must be an array of { surface, evidenceIds }.
      ['evidenceBindings', (v) => {
        if (!Array.isArray(v)) return 'qualification: evidenceBindings must be an array';
        for (const b of v) {
          if (!b || typeof b !== 'object') return 'qualification: evidenceBindings entry must be an object';
          if (b.surface === undefined || !EFFECT_SURFACES.includes(b.surface)) {
            return `qualification: evidence binding surface must be a valid §5 effect surface (got "${String(b.surface)}")`;
          }
          if (!Array.isArray(b.evidenceIds)) return `qualification: surface ${b.surface} evidenceIds must be an array`;
        }
        return null;
      }],
    ]);
    return problems;
  },

  qual_evidence(rec) {
    return check(rec, [
      ['schemaVersion', schemaVersionOk],
      ['qualEvidenceId', required('qualEvidenceId')],
      ['surface', (v) => (
        EFFECT_SURFACES.includes(v) ? null : `qual_evidence: surface must be a valid §5 effect surface (got "${String(v)}")`
      )],
      ['method', (v) => (
        EVIDENCE_METHODS.has(v) ? null : `qual_evidence: method must be a valid §5 evidence method (got "${String(v)}")`
      )],
      ['evidenceProfileBinding', required('evidenceProfileBinding')],
      ['result', (v) => (
        EVIDENCE_RESULTS.has(v) ? null : `qual_evidence: result must be PASS/FAIL/INCONCLUSIVE/STALE (got "${String(v)}")`
      )],
      ['timestamp', (v) => (
        typeof v === 'number' && Number.isFinite(v) && v > 0 ? null : 'qual_evidence: timestamp must be a positive number'
      )],
      ['observerIdentity', (v) => (v === null || isNonEmptyString(v) ? null : 'qual_evidence: observerIdentity must be a non-empty string or null')],
      // Evidence can be recorded without a path (incomplete/raw-output pending),
      // but a claimed rawEvidencePath must be a string.
      ['rawEvidencePath', (v) => (v === null || isNonEmptyString(v) ? null : 'qual_evidence: rawEvidencePath must be a non-empty string or null')],
      ['limitations', (v) => {
        if (!Array.isArray(v)) return 'qual_evidence: limitations must be an array';
        for (const l of v) {
          if (typeof l !== 'string') return 'qual_evidence: limitations entries must be strings';
        }
        return null;
      }],
      ['evidenceDigest', (v) => (v === null || isContentId(v) ? null : 'qual_evidence: evidenceDigest must be a content identity or null')],
    ]);
  },

  epoch_alloc(rec) {
    return check(rec, [
      ['schemaVersion', schemaVersionOk],
      ['epochId', required('epochId')],
      ['epochNumber', (v) => (Number.isInteger(v) && v >= 1 ? null : 'epoch_alloc: epochNumber must be an integer >= 1')],
      ['role', enumMember('EpochRole')],
      ['ownerIdentity', required('ownerIdentity')],
    ]);
  },

  // §23 Evidence Pipeline records
  evidence(rec) {
    const problems = check(rec, [
      ['schemaVersion', schemaVersionOk],
      ['evidenceId', required('evidenceId')],
      ['obligationId', required('obligationId')],
      ['generationId', required('generationId')],
      ['outcome', (v) => (
        VALID_OUTCOMES.has(v) ? null
          : `evidence: outcome must be PASS/FAIL/MISSING/INCONCLUSIVE (got "${String(v)}")`
      )],
      ['envelope', (v) => (v !== null && typeof v === 'object' && !Array.isArray(v)
        ? null : 'evidence: envelope must be an object')],
      ['observationPath', (v) => (
        v === null || (typeof v === 'string' && v.length > 0)
          ? null : 'evidence: observationPath must be a non-empty string or null'
      )],
      ['applicabilityKey', (v) => (
        v === null || (typeof v === 'string' && v.length > 0)
          ? null : 'evidence: applicabilityKey must be a non-empty string or null'
      )],
      ['classification', (v) => (
        v === 'supporting' || v === 'authoritative'
          ? null : `evidence: classification must be "supporting" or "authoritative" (got "${String(v)}")`
      )],
      ['observerQualified', (v) => (
        v === undefined || typeof v === 'boolean'
          ? null : 'evidence: observerQualified must be a boolean'
      )],
      ['invalidated', (v) => (typeof v !== 'boolean' ? 'evidence: invalidated must be a boolean' : null)],
    ]);
    // Finding A (audit fix): a PASS record may not declare an unbounded or
    // unknown truncation state — an incomplete capture must not certify (§16).
    // A FAIL/MISSING/INCONCLUSIVE record is already fail-closed, and an ABSENT
    // declaration is the admission gate's concern, so only PASS records with an
    // explicitly-unsafe declaration are rejected here.
    if (problems.length === 0 && rec.outcome === EvidenceOutcome.PASS) {
      const st = rec.envelope && typeof rec.envelope === 'object'
        ? rec.envelope.completionTimeoutSignalAndTruncationState : undefined;
      if (typeof st === 'string' && st.length
          && st !== 'NONE' && st !== 'TRUNCATED_BOUNDED') {
        problems.push(`evidence: PASS requires a bounded capture; declared truncation state "${st}" cannot certify (§16)`);
      }
    }
    // Cross-field: authoritative evidence must carry a binding applicability key
    // AND the stamp of a qualified external observer (mirrors the observer_run
    // authoritative gate, §16.5/§17/§23 req 7). Candidate-authored copies stay
    // supporting and are never authoritative by inhabiting protected storage.
    if (problems.length === 0 && rec.classification === 'authoritative') {
      if (!rec.applicabilityKey) {
        problems.push('evidence: authoritative evidence requires a non-null applicabilityKey');
      }
      if (rec.observerQualified !== true) {
        problems.push('evidence: authoritative evidence requires an attested qualified observer (observerQualified: true)');
      }
    }
    return problems;
  },

  evidence_invalidation(rec) {
    return check(rec, [
      ['schemaVersion', schemaVersionOk],
      ['invalidationId', required('invalidationId')],
      ['evidenceId', required('evidenceId')],
      ['reason', (v) => {
        const valid = new Set(Object.values(InvalidationReason));
        return valid.has(v) ? null
          : `evidence_invalidation: reason must be a known InvalidationReason (got "${String(v)}")`;
      }],
      ['supersededById', (v) => (
        v === null || (typeof v === 'string' && v.length > 0)
          ? null : 'evidence_invalidation: supersededById must be a non-empty string or null'
      )],
    ]);
  },

  quarantine(rec) {
    return check(rec, [
      ['schemaVersion', schemaVersionOk],
      ['quarantineId', required('quarantineId')],
      ['resource', required('resource')],
      ['reason', required('reason')],
      ['state', enumMember('QuarantineState')],
    ]);
  },

  reservation(rec) {
    return check(rec, [
      ['schemaVersion', schemaVersionOk],
      ['reservationId', required('reservationId')],
      ['lineageId', required('lineageId')],
      ['dimension', required('dimension')],
      ['actionId', required('actionId')],
      ['maxExposure', (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? null
        : 'reservation: maxExposure must be a non-negative number')],
      ['state', enumMember('ReservationState')],
    ]);
  },

  action_consumption(rec) {
    return check(rec, [
      ['schemaVersion', schemaVersionOk],
      ['actionId', required('actionId')],
      ['incarnationId', required('incarnationId')],
      ['ownerEpoch', required('ownerEpoch')],
      ['consumedAt', required('consumedAt')],
      ['reservedLiability', (v) => (
        v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0) ? null
          : 'action_consumption: reservedLiability must be a non-negative number or null')
      ],
      ['ack', (v) => (
        v === null || ENUMS.DispatchAck.has(v) ? null : `action_consumption: invalid ack "${String(v)}"`
      )],
    ]);
  },
};

/**
 * Validate a record against its kind.
 * Fails closed: returns false for unknown kinds or any structural violation.
 * @param {object} record
 * @returns {{ valid: boolean, problems: string[] }}
 */
function validateRecord(record) {
  if (record === null || typeof record !== 'object') {
    return { valid: false, problems: ['record must be an object'] };
  }
  const kind = record.kind;
  if (typeof kind !== 'string' || kind.length === 0) {
    return { valid: false, problems: ['record is missing required "kind"'] };
  }
  const validator = KIND_VALIDATORS[kind];
  if (!validator) {
    return { valid: false, problems: [`unknown record kind: "${kind}"`] };
  }
  const problems = validator(record);
  if (problems.length > 0) return { valid: false, problems };

  // Cross-field integrity: consumed allowance cannot coexist with
  // unconstrained liability that would permit re-dispatch.
  if (record.kind === 'action') {
    if (record.useAllowance === 'CONSUMED' && record.dispatch === 'NOT_ATTEMPTED') {
      return { valid: false, problems: ['action: CONSUMED allowance with NOT_ATTEMPTED dispatch is invalid'] };
    }
  }
  // Cross-field integrity (§7, §20): a FROZEN generation must truthfully bind a
  // content-identity tree digest and a create-once publication identity; a
  // MUTATION_CLOSED generation must carry barrier-1's durable stamp. A record
  // claiming FROZEN without those identities is malformed, never frozen.
  if (record.kind === 'generation') {
    if (record.state === GenerationState.FROZEN) {
      if (!isContentId(record.treeDigest)) {
        return { valid: false, problems: ['generation: FROZEN requires a content-id treeDigest'] };
      }
      if (typeof record.createOnceIdentity !== 'string' || record.createOnceIdentity.length === 0) {
        return { valid: false, problems: ['generation: FROZEN requires createOnceIdentity'] };
      }
    }
    if (record.state === GenerationState.MUTATION_CLOSED && typeof record.barrier1ClosedAt !== 'string') {
      return { valid: false, problems: ['generation: MUTATION_CLOSED requires barrier1ClosedAt'] };
    }
  }
  // Cross-field integrity (§16.4/5/6): only a qualified protected external
  // observer, launching the frozen candidate and comparing outside candidate
  // execution, may write an authoritative observation record. An
  // 'authoritative' classification without those facts is malformed.
  // Cross-field integrity (§13): an inference must never silently become
  // user-stated. An inferred entry whose provenance claims user-request
  // origin is provenance corruption and FAILS CLOSED at the durable store.
  if (record.kind === 'intent') {
    const src = record.sourceAndProvenance;
    if (record.explicitOrInferred === 'inferred' && typeof src === 'string' && src.includes('user-request')) {
      return { valid: false, problems: ['intent: inferred requirement must not claim user-request origin (provenance corruption, §13)'] };
    }
    // §13: SAFELY_INFERRED is downgraded-by-proof, never silently upgraded.
    if (record.intentClass === 'USER_STATED' && record.explicitOrInferred === 'inferred') {
      return { valid: false, problems: ['intent: USER_STATED with inferred provenance is invalid (provenance corruption, §13)'] };
    }
    // Reverse direction: USER_STATED requires genuinely user-request origin.
    // A record claiming USER_STATED without user-request provenance is also
    // provenance corruption (forged authority) and FAILS CLOSED.
    if (record.intentClass === 'USER_STATED' && !(typeof src === 'string' && src.includes('user-request'))) {
      return { valid: false, problems: ['intent: USER_STATED requires user-request origin in sourceAndProvenance (forged authority, §13)'] };
    }
  }
  if (record.kind === 'observer_run' && record.classification === 'authoritative') {
    if (!record.qualification || record.qualification.qualified !== true) {
      return { valid: false, problems: ['observer_run: authoritative requires an attested qualified observer (IB-01)'] };
    }
    if (record.comparedOutsideExecution !== true) {
      return { valid: false, problems: ['observer_run: authoritative requires comparison outside candidate execution (§16.5)'] };
    }
    if (typeof record.observationPath !== 'string' || record.observationPath.length === 0) {
      return { valid: false, problems: ['observer_run: authoritative requires a protected observationPath (§17)'] };
    }
    if (!record.captured || !record.captured.completionFacts) {
      return { valid: false, problems: ['observer_run: authoritative requires bounded completion facts'] };
    }
  }
  return { valid: true, problems: [] };
}

/**
 * Validate that a content identity string is well-formed.
 * @param {string} id
 * @returns {boolean}
 */
function validateContentId(id) {
  return isContentId(id);
}

/**
 * Validate a digest reference — either a content id or null (unset).
 * @param {string|null} id
 * @returns {boolean}
 */
function validateDigestRef(id) {
  return id === null || isContentId(id);
}

// ---------------------------------------------------------------------------
// Full state validation
// ---------------------------------------------------------------------------

/**
 * Validate a complete durable store state object.
 * Ensures every record is valid and duplicate identities are absent.
 * @param {object} state — { records: Array<object> }
 * @returns {{ valid: boolean, problems: string[] }}
 */
function validateStoreState(state) {
  if (state === null || typeof state !== 'object') {
    return { valid: false, problems: ['state must be an object'] };
  }
  const problems = [];
  const records = state.records;
  if (!Array.isArray(records)) {
    return { valid: false, problems: ['state.records must be an array'] };
  }
  const ids = new Map();
  for (const rec of records) {
    const r = validateRecord(rec);
    if (!r.valid) {
      problems.push(...r.problems);
      continue;
    }
    const idField = RECORD_ID_FIELDS[rec.kind];
    const id = idField ? rec[idField] : null;
    if (id == null) continue;
    if (ids.has(id)) {
      problems.push(`duplicate identity "${id}" (${rec.kind})`);
    }
    ids.set(id, rec.kind);
  }
  return { valid: problems.length === 0, problems };
}

// ---------------------------------------------------------------------------
// Digest coherence
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic digest of a record's canonical shape.
 * Used for change detection; does not claim cryptographic authority for
 * acceptance, only for identical-record comparison.
 * @param {object} record
 * @returns {string}
 */
function recordDigest(record) {
  const { canonicalJson } = require('./crypto.js');
  return sha256(canonicalJson(record));
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  ENUMS,
  validateRecord,
  validateContentId,
  validateDigestRef,
  validateStoreState,
  recordDigest,
  RECORD_ID_FIELDS,
  schemaVersion: SCHEMA_VERSION,
};