'use strict';
/**
 * coherence — Unit 11: ONE derived reduction flow connecting the §16-§17-§20
 * gates (input closure, derivation, evidence coherence, publication/payload,
 * quiescence, authority ownership) into the §21 final acceptance reduction.
 *
 * Every gate below is a pure reducer over the durable records — the single
 * source of truth. Nothing is free-typed: `coherentReduction` derives
 * `derivationEstablished`, `payloadManifestComplete`, `frozenGenerationId`,
 * `evidenceCoherent`, `quiescenceProven`, `cleanAuthorityOwnership` from the
 * records and hands them to `reduceAcceptance`. The supervisor alone reduces
 * acceptance (§21); `acceptanceGates` only exposes the gate facts.
 *
 * FAIL CLOSED: any missing/inconclusive gate is `false`, never assumed true.
 * Under IB-01 the derivation gate is UNQUALIFIED -> not established, so the
 * current state reduces to not-accepted — correct and honest.
 */

const ACC = require('./acceptance.js');
const { deriveState, DerivationStatus } = require('./derivation.js');
const { finalCoherence } = require('./evidence.js');
const { manifestComplete, successOrderingOk } = require('./generation.js');
const { GenerationState } = require('./records.js');
const { intentIntegrityGate } = require('./intent.js');
const { qualificationIntegrityGate } = require('./qualification.js');
const { activeObserverRuns } = require('./evidence-pipeline.js');

/**
 * Derive every §21 gate from the durable records.
 *
 * @param {object} opts
 * @param {object[]} opts.records — folded store records (single source of truth)
 * @param {object} [opts.observed] — observed (post-execution) facts able to
 *   refine the evidence domains the records alone cannot close: e.g.
 *   { deliveryManifest, publicationFacts, inputClosure, finalCoherenceOverride }.
 *   Absent observed facts => the corresponding gates fail closed.
 * @returns {object} — gate facts + derivation + coherence planes
 */
function acceptanceGates({
  records, observed = {}, inventory = [], obligations = [],
}) {
  const list = Array.isArray(records) ? records : [];
  const obs = observed || {};
  // The §14 inventory/obligation arrays are the supervisor's responsibility;
  // the evidence domains reduce over THE SAME arrays the reduction uses — one
  // source of truth, never a separate hand-built digest.
  const inv = Array.isArray(inventory) ? inventory : [];
  const obls = Array.isArray(obligations) ? obligations : [];

  const derivation = deriveState({ records: list });

  const frozen = list.find((r) => r.kind === 'generation' && r.state === GenerationState.FROZEN);
  const frozenGenerationId = frozen ? frozen.generationId : null;

  // §17 input closure — recorded from the observer launch facts; the observer
  // owns declared inputs (§16.4). Fail closed when no launch facts are present.
  const inputClosure = (typeof obs.inputClosure === 'object' && obs.inputClosure !== null)
    ? { ...obs.inputClosure, derived: true }
    : { derived: false, closed: false, missing: ['no input-closure facts in records (IB-01: observer launch unattested)'] };

  // §17 final coherence across the 10 evidence domains. The profile domain is
  // only closable by a qualified profile attestation; absent it, not coherent.
  const coherenceAssembly = {
    inventory: inv.length > 0 ? inv : null,
    contract: (list.find((r) => r.kind === 'acceptance_contract') || {}).contractId || null,
    policy: (list.find((r) => r.kind === 'policy') || {}).policyId || null,
    profile: (list.some((r) => r.kind === 'policy' && r.stage === 'ENFORCED')
      && (obs.profileDigest || null)),
    predicates: (obs.predicates || null),
    evidence: activeObserverRuns(list),
    sourceAndDependencyInputs: (list.find((r) => r.kind === 'source_capture') || {}).baselineManifestIdentity || null,
    actualDerivation: derivation.status === DerivationStatus.ESTABLISHED,
    frozenGeneration: frozenGenerationId,
    delivery: (list.find((r) => r.kind === 'delivery') || {}).deliveryId || null,
  };
  const coherence = finalCoherence(coherenceAssembly);
  const evidenceCoherent = coherence.coherent;

  // §20 publication/payload completeness — the QUIESCED delivery manifest must
  // be complete (§20's ten mandated fields) and the success-ordering facts must
  // prove bytes verified, durably persisted, and durably published. A FROZEN
  // generation record is NOT a delivery manifest — no fallback, fail closed.
  const dm = obs.deliveryManifest || null;
  const publicationFacts = obs.publicationFacts || null;
  const manifestOk = dm ? manifestComplete(dm).ok : false;
  const payloadManifestComplete = manifestOk && successOrderingOk(publicationFacts).ok;

  // §19 quiescence — proven only when a finalization attests it.
  const finalizations = list.filter((r) => r.kind === 'finalization');
  const quiescenceProven = finalizations.length > 0 && finalizations.every((f) => f.quiescenceProven === true);

  // §6/§21 authority ownership — a NORMAL owner record and no active
  // quarantine that would dispute control.
  const owner = list.find((r) => r.kind === 'store_owner');
  const quarantines = list.filter((r) => r.kind === 'quarantine' && r.state === 'ACTIVE');
  const cleanAuthorityOwnership = !!owner && owner.recoveryState === 'NORMAL' && quarantines.length === 0;

  // §13 intent integrity — when intent records exist, the intent plane must be
  // intact (provenance not corrupted, mandatory intent not deleted, every entry
  // classifiable) or acceptance is blocked. Untrusted content must never delete
  // mandatory intent or reclassify inference as user-stated (requirements 5, 6).
  // When an ACTIVE task is present but intent records have been deleted down to
  // zero, the gate fires too ("no intent records for an active task") so a
  // wholesale deletion is not silently absorbed (§13 requirement 6).
  const intentRecords = list.filter((r) => r.kind === 'intent');
  const taskRecord = list.find((r) => r.kind === 'task_incarnation');
  let intentIntact = true;
  const intentProblems = [];
  if (intentRecords.length > 0 || taskRecord) {
    const gate = intentIntegrityGate({ taskRecord, intentRecords });
    intentIntact = gate.intentIntact;
    intentProblems.push(...gate.problems);
  }

  // §5 qualification — when a task is present, its runtime profile must be
  // qualified by evidence (holistically: every reachable effect surface proven,
  // bound to the same profile, not stale/contradictory/missing). Qualification
  // NEVER grants execution authority (requirement 9); it is only a gate the
  // acceptance plane consumes. Absent a task, no qualification demand surfaces
  // (the gate is additive and never fabricates a blocker). Under IB-01 the
  // current environment has no qualification evidence, so this truthfully
  // fails closed to UNAVAILABLE.
  const qualificationRecords = list.filter((r) => r.kind === 'qualification');
  const qualEvidenceRecords = list.filter((r) => r.kind === 'qual_evidence');
  let qualified = true;
  const qualProblems = [];
  let qualificationStatus = null;
  let qualificationRule = null;
  if (taskRecord) {
    const gate = qualificationIntegrityGate({ taskRecord, qualificationRecords, qualEvidenceRecords });
    qualified = gate.qualified;
    qualificationStatus = gate.status;
    qualificationRule = gate.rule;
    qualProblems.push(...(gate.problems || []));
  }

  const blockers = [];
  if (derivation.status !== DerivationStatus.ESTABLISHED) {
    blockers.push(`actual derivation is ${derivation.status}: ${(derivation.reasons || []).join('; ')}`);
  }
  if (!inputClosure.closed) blockers.push('input closure is not established (§17)');
  if (!evidenceCoherent) blockers.push(`evidence coherence gaps: ${(coherence.gaps || []).join(', ')}`);
  if (!payloadManifestComplete) blockers.push('payload/manifest completeness is not proven (§20)');
  if (!quiescenceProven) blockers.push('quiescence is not proven (§19)');
  if (!cleanAuthorityOwnership) blockers.push('authority/ownership is not clean (§6/§21)');
  if (!intentIntact) blockers.push(`intent integrity failures: ${intentProblems.join('; ')}`);
  if (!qualified) blockers.push(`profile qualification is ${qualificationStatus || 'not established'}: ${qualProblems.join('; ')}`);

  return {
    derivation,
    frozenGenerationId,
    inputClosure,
    evidenceCoherent,
    coherence,
    payloadManifestComplete,
    quiescenceProven,
    cleanAuthorityOwnership,
    intentIntact,
    intentProblems,
    qualified,
    qualificationStatus,
    qualificationRule,
    qualProblems,
    blockers,
  };
}

/**
 * The single coherent §21 reduction flow: derive all gates from records, then
 * reduce acceptance ONCE with those derived flags. Only the supervisor invokes
 * this (§21); status surfaces the gates separately and never a fabricated
 * decision.
 *
 * @param {object} opts
 * @param {object[]} opts.records
 * @param {object} [opts.observed]
 * @param {object[]} [opts.inventory] — §14 inventory entries (supervisor-supplied;
 *   default [] fails closed)
 * @param {object[]} [opts.obligations] — §14 obligations (supervisor-supplied;
 *   default [] fails closed)
 * @param {object[]} [opts.observations] — evaluated observations (default: [] —
 *   accepted only when every domain truly closes)
 * @returns {object} — { gates, acceptance }
 */
function coherentReduction({ records, observed = {}, inventory = [], obligations = [], observations = [] }) {
  const gates = acceptanceGates({ records, observed, inventory, obligations });
  // The §14 inventory/obligation arrays are the supervisor's responsibility;
  // this reducer never invents them from a recursion-unsafe field. Empty
  // arrays fail closed ("empty conjunction is never accepted").

  const acceptance = ACC.reduceAcceptance({
    inventory,
    obligations,
    observations: observations || [],
    evidenceCoherent: gates.evidenceCoherent,
    frozenGenerationId: gates.frozenGenerationId,
    derivationEstablished: gates.derivation.status === DerivationStatus.ESTABLISHED,
    quiescenceProven: gates.quiescenceProven,
    payloadManifestComplete: gates.payloadManifestComplete,
    cleanAuthorityOwnership: gates.cleanAuthorityOwnership,
    blockers: gates.blockers,
  });

  return { gates, acceptance };
}

module.exports = { acceptanceGates, coherentReduction };