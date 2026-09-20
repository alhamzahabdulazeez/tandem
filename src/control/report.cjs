'use strict';
/**
 * report — read-only task/lifecycle/delivery/resource/recovery + evidence-gate
 * status reduction (§22: `tandem status`, `tandem evidence`; §6 durable records).
 *
 * These are VIEWS over the authoritative record store — not a second database.
 * They are pure over a record array (deterministically testable) and never
 * fabricate: an empty or absent store reports itself as such; an invalid store
 * state is reported fail-closed, not glossed; qualification is derived ONLY
 * from records that attest a qualified reader/observer, which under IB-01 are
 * absent — so the reported gate is CHECKER_ONLY and supervised execution is
 * reported as UNAVAILABLE.
 *
 * The command spelling, semantics and narrow surface are additive to
 * `tandem check` (§22); nothing here grants authority or claims execution.
 */

const VAL = require('../contracts/validate.js');
const REC = require('../contracts/records.js');
const { acceptanceGates } = require('../contracts/coherence.js');
const F = require('../contracts/finalization.js');
const R = require('../contracts/repair.js');
const I = require('../contracts/intent.js');
const D = require('../contracts/decisions.js');
const Q = require('../contracts/qualification.js');
const ID = require('../contracts/identity.js');
const { reducePipeline, EvidenceOutcome } = require('../contracts/evidence-pipeline.js');

// ---------------------------------------------------------------------------
// Pure section reducers (take a record array; never I/O)
// ---------------------------------------------------------------------------

/** Task/incarnation state (§22 "task"). */
function taskStatus(records) {
  const rows = (records || [])
    .filter((r) => r.kind === 'task_incarnation')
    .map((r) => ({
      incarnationId: r.incarnationId,
      taskId: r.taskId,
      phase: r.phase,
      incarnationStatus: r.incarnationStatus || 'ACTIVE',
      sourceCommit: r.selectedSourceCommit || null,
    }));
  // One per incarnation id (the store guarantees unique identities already).
  const byId = new Map();
  for (const row of rows) byId.set(row.incarnationId, row);
  return { present: byId.size > 0, tasks: Array.from(byId.values()) };
}

/** Action lifecycle / dispatch / execution (§22 "lifecycle"). */
function lifecycleStatus(records) {
  const actions = (records || []).filter((r) => r.kind === 'action');
  const rows = actions.map((r) => ({
    actionId: r.actionId,
    lifecycle: r.lifecycle,
    dispatch: r.dispatch,
    execution: r.execution,
    resourceDisposition: r.resourceDisposition,
    useAllowance: r.useAllowance,
    liability: r.liability,
    targetGeneration: r.targetGeneration || null,
    operation: r.operation || null,
  }));
  return {
    present: rows.length > 0,
    actions: rows,
    counts: {
      proposed: actions.filter((a) => a.lifecycle === REC.ActionLifecycle.PROPOSED).length,
      admitted: actions.filter((a) => a.lifecycle === REC.ActionLifecycle.ADMITTED).length,
      settled: actions.filter((a) => a.lifecycle === REC.ActionLifecycle.SETTLED).length,
      unresolved: actions.filter((a) => a.dispatch === REC.ActionDispatch.UNKNOWN).length,
      quarantined: actions.filter((a) => a.resourceDisposition === REC.ResourceDisposition.QUARANTINED).length,
    },
  };
}

/** Generation freeze state (§7, §20). */
function generationStatus(records) {
  const gens = (records || []).filter((r) => r.kind === 'generation');
  const rows = gens.map((r) => ({
    generationId: r.generationId,
    state: r.state,
    treeDigest: r.treeDigest || null,
    createOnceIdentity: r.createOnceIdentity || null,
    manifestIdentity: r.manifestIdentity || null,
  }));
  return {
    present: rows.length > 0,
    generations: rows,
    counts: {
      mutable: gens.filter((g) => g.state === REC.GenerationState.MUTABLE).length,
      mutationClosed: gens.filter((g) => g.state === REC.GenerationState.MUTATION_CLOSED).length,
      frozen: gens.filter((g) => g.state === REC.GenerationState.FROZEN).length,
    },
  };
}

/**
 * Delivery state (§22 "delivery"; §20): for each delivery report identity,
 * frozen generation, persistence state, and CURRENT byte availability — using
 * the record's own persistence/retention facts. A published delivery beyond
 * retention expiry is historically attributable but not currently available
 * (§20: "Current reporting MUST distinguish historical acceptance from current
 * payload availability").
 */
function deliveryStatus(records) {
  const dels = (records || []).filter((r) => r.kind === 'delivery');
  const now = Date.now();
  const rows = dels.map((r) => {
    const published = r.persistenceState === 'PUBLISHED';
    const expiry = r.retentionExpiry ? Date.parse(r.retentionExpiry) : NaN;
    const withinRetention = published && !Number.isNaN(expiry) && expiry > now;
    return {
      deliveryId: r.deliveryId,
      taskId: r.taskId,
      frozenGenerationId: r.frozenGenerationId,
      persistenceState: r.persistenceState,
      manifestDigest: r.manifestDigest || null,
      payloadDigest: r.payloadDigest || null,
      historicallyAttributable: published,
      currentlyAvailable: withinRetention,
      retentionExpiry: r.retentionExpiry || null,
    };
  });
  return {
    present: rows.length > 0,
    deliveries: rows,
    counts: {
      published: dels.filter((d) => d.persistenceState === 'PUBLISHED').length,
      notPublished: dels.filter((d) => d.persistenceState !== 'PUBLISHED').length,
      currentlyAvailable: rows.filter((r) => r.currentlyAvailable).length,
    },
  };
}

/** Resource state (§22 "resource"): quarantines + reservations. */
function resourceStatus(records) {
  const quarantines = (records || []).filter((r) => r.kind === 'quarantine');
  const reservations = (records || []).filter((r) => r.kind === 'reservation');
  return {
    present: quarantines.length > 0 || reservations.length > 0,
    quarantines: quarantines.map((r) => ({
      quarantineId: r.quarantineId,
      resource: r.resource,
      state: r.state,
    })),
    reservations: reservations.map((r) => ({
      reservationId: r.reservationId,
      actionId: r.actionId,
      dimension: r.dimension,
      maxExposure: r.maxExposure,
      state: r.state,
    })),
    counts: {
      quarantinesActive: quarantines.filter((q) => q.state === 'ACTIVE').length,
      quarantinesReleased: quarantines.filter((q) => q.state === 'RELEASED').length,
      reservationsActive: reservations.filter((r) => r.state === 'ACTIVE').length,
    },
  };
}

/** Recovery state (§22 "recovery"; §10): finalization records. */
function recoveryStatus(records) {
  const fins = (records || []).filter((r) => r.kind === 'finalization');
  const rows = fins.map((r) => {
    // §19 terminal-treatment disposition — derived facts, never a claim of
    // physical enforcement. `terminalResult`/`successGate` are contract facts;
    // quiescence itself still requires the qualified boundary (IB-01).
    const tr = F.terminalTreatment(r.stopReason);
    return {
      finalizationId: r.finalizationId,
      stopReason: r.stopReason,
      admissionClosed: r.admissionClosed === true,
      authorityRetired: r.authorityRetired === true,
      fencingEstablished: r.fencingEstablished === true,
      quiescenceProven: r.quiescenceProven === true,
      quarantinedResources: (r.quarantinedResources || []).length,
      unresolvedExecution: r.unresolvedExecution === true,
      result: r.supervisorResult || r.result || 'NON_SUCCESSFUL',
      successGate: tr.known === true && tr.successGate === true,
    };
  });
  const repairs = (records || []).filter((r) => r.kind === 'repair');
  return {
    present: rows.length > 0 || repairs.length > 0,
    finalizations: rows,
    quiescenceProvenAny: fins.length > 0 && fins.every((r) => r.quiescenceProven === true),
    // §18 bounded repair — the MVP ceiling is exactly one; every repair record
    // durably consumes that allowance.
    repairs: repairs.map((r) => ({
      repairId: r.repairId,
      disposableGenerationId: r.disposableGenerationId || null,
      allowanceConsumed: r.allowanceConsumed === true,
    })),
    repairCount: repairs.length,
    repairCeiling: R.REPAIR_CEILING,
    repairExceeded: repairs.length > R.REPAIR_CEILING,
  };
}

/**
 * Intent inventory state (§22 "intent"; §13). Read-only reduction of admitted
 * intent records: the 5-way classification distribution, the explicit/inferred
 * axis, mandatory-count, and the two §13 integrity verdicts (provenance not
 * corrupted; mandatory intent not deleted). These verdicts never manufacture a
 * requirement — they only refuse to let untrusted content silently rewrite or
 * delete admitted intent.
 */
function intentStatus(records) {
  const intents = (records || []).filter((r) => r.kind === 'intent');
  const task = (records || []).find((r) => r.kind === 'task_incarnation');
  const rows = intents.map((r) => ({
    requirementId: r.requirementId,
    intentClass: r.intentClass || null,
    explicitOrInferred: r.explicitOrInferred || null,
    mandatoryOrOptional: r.mandatoryOrOptional || null,
    applicability: r.applicability || null,
    sourceAndProvenance: r.sourceAndProvenance || null,
    originalMeaning: r.originalMeaning || null,
  }));
  const counts = {};
  for (const rc of I.INTENT_CLASSES) counts[rc] = intents.filter((x) => x.intentClass === rc).length;

  const provenance = I.validateProvenanceIntegrity(intents);
  const mandatory = I.validateMandatoryIntentIntegrity({
    originalRequest: task ? (task.originalRequest || '') : '',
    intentRecords: intents,
  });

  return {
    present: intents.length > 0,
    intents: rows,
    counts,
    mandatoryCount: intents.filter((r) => r.mandatoryOrOptional === 'mandatory').length,
    provenanceOk: provenance.ok,
    provenanceProblems: provenance.problems,
    mandatoryIntentOk: mandatory.ok,
    mandatoryIntentProblems: mandatory.problems,
  };
}

/**
 * §15 decision-priority facts (§22 "decision"). Read-only reduction: the static
 * 8-gate priority order plus the record-attested gates that would deterministically
 * fire if the supervisor reduced today. `impliedGate` is a DERIVED FACT from
 * durable records (identical to how recoveryStatus derives successGate) — it is
 * never an admission, never a claim that an action was or will be started. When
 * no relevant record fact exists, the section reports absent rather than a gate.
 */
function decisionStatus(records) {
  const list = Array.isArray(records) ? records : [];
  const intents = list.filter((r) => r.kind === 'intent');
  const finalizations = list.filter((r) => r.kind === 'finalization');
  const quarantines = list.filter((r) => r.kind === 'quarantine' && r.state === 'ACTIVE');
  const actionsUnresolved = list.filter((r) => r.kind === 'action'
    && r.dispatch === REC.ActionDispatch.UNKNOWN);
  const task = list.find((r) => r.kind === 'task_incarnation');
  const repairs = list.filter((r) => r.kind === 'repair');
  const delivery = list.filter((r) => r.kind === 'delivery');

  // Assemble the deterministic situation facts the records actually attest.
  const facts = {
    safetyOrAuthorityFailure: quarantines.length > 0 && actionsUnresolved.length > 0,
    cancellationRequested: finalizations.some((f) => f.stopReason === 'CANCELLED'),
    budgetExhausted: finalizations.some((f) => f.stopReason === 'BUDGET_EXHAUSTED'),
    safetyStopTriggered: finalizations.some((f) => f.stopReason === 'SAFETY_STOP'),
    consequentialAmbiguityUnresolved: intents.some((r) => r.intentClass === I.IntentClass.CONSEQUENTIAL_AMBIGUITY),
    currentGenerationFrozen: list.some((r) => r.kind === 'generation' && r.state === REC.GenerationState.FROZEN),
    evidenceComplete: false, // only a §16/§17 closure could establish this; none attested here
    eligibleRepairConditionsHold: repairs.length > 0 && repairs.every((r) => r.allowanceConsumed === true),
    repairAllowanceAvailable: true,
    repairCount: repairs.length,
    acceptanceEstablished: false, // acceptance is reduced by the supervisor (§21), never by status
    identifiedRequirement: null,
  };

  const decision = D.decideNextAction(facts);

  return {
    present: true,
    decisionGates: D.DECISION_GATES.slice(),
    phase: task ? (task.phase || null) : null,
    authorityDisputeAttested: quarantines.length > 0 && actionsUnresolved.length > 0,
    hardStopConditionsAttested: facts.cancellationRequested || facts.budgetExhausted || facts.safetyStopTriggered,
    ambiguityAttested: facts.consequentialAmbiguityUnresolved,
    repairCount: repairs.length,
    repairCeiling: R.REPAIR_CEILING,
    repairExceeded: repairs.length > R.REPAIR_CEILING,
    deliveryPublished: delivery.some((d) => d.persistenceState === 'PUBLISHED'),
    relevantFacts: facts,
    impliedGate: decision.trigger,
    problems: decision.problems,
  };
}

/**
 * §5 qualification facts (§22 "status"). Read-only reduction of the support
 * records: the concrete proof a runtime/profile is qualified. Qualification is
 * evidence-based — a record claimed QUALIFIED is re-derived from its bound
 * qual_evidence records by `resolveQualification`, never trusted as a label.
 * This section reports honest derived facts; it never grants execution
 * authority (qualification stays separate from admission/ownership/authority).
 */
function qualificationStatus(records) {
  const list = Array.isArray(records) ? records : [];
  const quals = list.filter((r) => r.kind === 'qualification');
  const evidences = list.filter((r) => r.kind === 'qual_evidence');
  const task = list.find((r) => r.kind === 'task_incarnation');

  const rows = quals.map((q) => {
    const verdict = Q.resolveQualification({ qualification: q, evidence: evidences });
    return {
      qualificationId: q.qualificationId,
      profileId: q.profileId,
      profileVersion: q.profileVersion || null,
      profileDigest: q.profileDigest || null,
      claimedStatus: q.status || null,
      actualStatus: verdict.status,
      failureModes: verdict.failureModes,
      problems: verdict.problems,
      coveredSurfaces: verdict.coveredSurfaces,
      staleEvidence: verdict.staleEvidence,
      evidenceBindings: (q.evidenceBindings || []).map((b) => ({
        surface: b.surface,
        evidenceCount: (b.evidenceIds || []).length,
      })),
    };
  });

  // The gate the coherence plane would reduce (same single source of truth).
  const gate = Q.qualificationIntegrityGate({
    taskRecord: task || null,
    qualificationRecords: quals,
    qualEvidenceRecords: evidences,
  });

  return {
    present: quals.length > 0,
    qualifications: rows,
    evidenceCount: evidences.length,
    surfacesCovered: [...new Set(evidences.filter((e) => e.result === Q.EvidenceResult.PASS).map((e) => e.surface))],
    qualified: gate.qualified,
    qualificationStatus: gate.status,
    qualificationRule: gate.rule,
    problems: gate.problems || [],
  };
}

/**
 * §6/§10 ownership status (§22 "recovery state"). Read-only reduction of the
 * store owner record, epoch allocation ledger, and identity/ownership integrity
 * gates. This section surfaces the identity facts that §21's "valid authority
 * and ownership history" demands; it never grants execution authority.
 * `authorityGranted` is always false (requirement 8: ownership ≠ qualification).
 */
function ownershipStatus(records) {
  const list = Array.isArray(records) ? records : [];
  const owners = list.filter((r) => r.kind === 'store_owner');
  const epochs = list.filter((r) => r.kind === 'epoch_alloc')
    .slice()
    .sort((a, b) => (a.epochNumber || 0) - (b.epochNumber || 0));

  const owner = owners.length === 1 ? owners[0] : null;
  if (!owner) {
    return {
      present: false,
      storeIdentity: null,
      storeIdentityOk: false,
      identityProblems: owners.length === 0 ? ['no store owner record'] : ['multiple store_owner records'],
      ownerIdentity: null,
      lockIdentity: null,
      canonicalStorePath: null,
      currentEpoch: null,
      admissionState: null,
      recoveryState: null,
      epochAllocations: [],
      ownershipIntegrityOk: false,
      ownershipProblems: [],
      authorityGranted: false,
    };
  }

  const idGate = ID.storeIdentityGate({ records: list });
  const intGate = ID.ownershipIntegrityGate({ records: list });

  return {
    present: true,
    storeIdentity: idGate.storeIdentity,
    storeIdentityOk: idGate.ok,
    identityProblems: idGate.problems,
    ownerIdentity: owner.ownerIdentity,
    lockIdentity: owner.lockIdentity,
    canonicalStorePath: owner.canonicalStorePath,
    currentEpoch: owner.currentEpoch,
    admissionState: owner.admissionState || null,
    recoveryState: owner.recoveryState || 'NORMAL',
    epochAllocations: epochs.map((e) => ({
      epochNumber: e.epochNumber,
      role: e.role,
      ownerIdentity: e.ownerIdentity,
    })),
    ownershipIntegrityOk: intGate.ok,
    ownershipProblems: intGate.problems,
    authorityGranted: false,
  };
}

/** Gate evidence (inspect attributable contracts, actions, observations, evidence). */
function evidenceReport(records) {
  const list = Array.isArray(records) ? records : [];
  const byKind = {};
  for (const r of list) byKind[r.kind] = (byKind[r.kind] || 0) + 1;

  const contracts = list.filter((r) => r.kind === 'acceptance_contract').map((r) => ({
    contractId: r.contractId,
    taskId: r.taskId,
    frozen: r.frozen === true,
    obligationCount: (r.obligations || []).length,
  }));
  const actions = list.filter((r) => r.kind === 'action').map((r) => ({
    actionId: r.actionId,
    operation: r.operation,
    lifecycle: r.lifecycle,
    dispatch: r.dispatch,
    execution: r.execution,
  }));
  const observations = [
    ...list.filter((r) => r.kind === 'action_consumption').map((r) => ({
      kind: 'action_consumption',
      id: r.consumptionId,
      actionId: r.actionId,
      ack: r.ack,
    })),
    ...list.filter((r) => r.kind === 'source_capture').map((r) => ({
      kind: 'source_capture',
      id: r.captureId,
      commitIdentity: r.commitIdentity,
      baselineManifestIdentity: r.baselineManifestIdentity || null,
    })),
    ...list.filter((r) => r.kind === 'delivery').map((r) => ({
      kind: 'delivery',
      id: r.deliveryId,
      persisted: r.persistenceState,
    })),
  ];

  const storeState = VAL.validateStoreState({ records: list });
  const qualifiedReaderAttested = list.some((r) => r.kind === 'source_capture'
    && r.reader && r.reader.qualified === true);
  const gate = qualifiedReaderAttested ? 'RELEASE_READY_FOR_DECLARED_PROFILE' : REC.ReleaseDisposition.CHECKER_ONLY;

  // §23 pipeline evidence section
  const pipelineEvidenceRecords = list.filter((r) => r.kind === 'evidence');
  const pipelineInvalidations = list.filter((r) => r.kind === 'evidence_invalidation');
  const obligationIds = [...new Set(pipelineEvidenceRecords.map((r) => r.obligationId).filter(Boolean))];
  const pipeSummary = reducePipeline({
    obligations: obligationIds,
    evidenceRecords: pipelineEvidenceRecords,
    invalidations: pipelineInvalidations,
  });

  return {
    storeValid: storeState.valid,
    storeProblems: storeState.problems,
    qualifiedRuntime: qualifiedReaderAttested,
    supervisedExecution: false,
    gate,
    countByKind: byKind,
    contracts,
    actions,
    observations,
    integrity: {
      quarantineCount: byKind.quarantine || 0,
      generationCount: byKind.generation || 0,
      finalizationCount: byKind.finalization || 0,
      resolutionCount: byKind.reservation || 0,
    },
    pipeline: {
      verdict: pipeSummary.verdict,
      authoritative: pipeSummary.authoritative,
      obligationCount: obligationIds.length,
      evidenceCount: pipelineEvidenceRecords.length,
      invalidationCount: pipelineInvalidations.length,
      byObligation: pipeSummary.byObligation,
    },
  };
}

/**
 * `tandem status` — the §22 five-section status reduction over a record list,
 * PLUS (Unit 11) the coherence plane: every §21 gate reduced from THE SAME
 * records via {acceptanceGates} — the single source of truth `tandem status`
 * consumes. `tandem status` surfaces gate facts (derivation/inputclosure/
 * evidence/coherent/publication/quiescence/ownership); it does NOT reduce
 * acceptance itself — only the supervisor does (§21).
 *
 * Fails closed: when the underlying records fail {validateStoreState}, status
 * is reported with `storeValid:false` and the validation problems, rather than
 * pretending the derived statuses are trustworthy.
 */
function statusReport(records) {
  const list = Array.isArray(records) ? records : [];
  const storeState = VAL.validateStoreState({ records: list });
  const gates = acceptanceGates({ records: list });
  return {
    present: list.length > 0,
    storeValid: storeState.valid,
    storeProblems: storeState.problems,
    task: taskStatus(list),
    lifecycle: lifecycleStatus(list),
    generation: generationStatus(list),
    delivery: deliveryStatus(list),
    resources: resourceStatus(list),
    recovery: recoveryStatus(list),
    intent: intentStatus(list),
    decision: decisionStatus(list),
    qualification: qualificationStatus(list),
    ownership: ownershipStatus(list),
    coherence: {
      derivation: {
        status: gates.derivation.status,
        reasons: gates.derivation.reasons,
        observers: gates.derivation.observers,
        frozenGenerationId: gates.derivation.frozenGenerationId,
        envelopeMissing: gates.derivation.envelopeMissing,
      },
      inputClosure: { closed: gates.inputClosure.closed === true, missing: gates.inputClosure.missing || [] },
      evidenceCoherent: gates.evidenceCoherent,
      coherenceGaps: gates.coherence.gaps || [],
      payloadManifestComplete: gates.payloadManifestComplete,
      quiescenceProven: gates.quiescenceProven,
      cleanAuthorityOwnership: gates.cleanAuthorityOwnership,
      intentIntact: gates.intentIntact,
      intentProblems: gates.intentProblems || [],
      qualified: gates.qualified,
      qualificationStatus: gates.qualificationStatus,
      qualificationRule: gates.qualificationRule,
      qualProblems: gates.qualProblems || [],
      blockers: gates.blockers,
    },
  };
}

module.exports = {
  taskStatus,
  lifecycleStatus,
  generationStatus,
  deliveryStatus,
  resourceStatus,
  recoveryStatus,
  intentStatus,
  decisionStatus,
  qualificationStatus,
  ownershipStatus,
  evidenceReport,
  statusReport,
};