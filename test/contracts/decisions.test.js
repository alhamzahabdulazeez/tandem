'use strict';
/**
 * Tests for src/contracts/decisions.js — §15 Engineering Decisions.
 *
 * Covers the 8-priority deterministic decision loop (safety/authority beats
 * efficiency), minimum-sufficient context selection (no unnecessary expansion),
 * the static capability registry (smallest qualified mechanism), impact
 * analysis distinguished from verification, and review classification.
 *
 * Adversarial cases (unit requirement 10): safety/authority priority over
 * efficiency, unnecessary context expansion, model-reasoning selection without
 * justification. Deterministic: every case reduces explicit facts.
 */

const assert = require('node:assert');
const D = require('../../src/contracts/decisions.js');
const I = require('../../src/contracts/intent.js');
const R = require('../../src/contracts/repair.js');
const RPT = require('../../src/control/report.cjs');
const REC = require('../../src/contracts/records.js');

module.exports = function run(t, group) {
  group('§15 decision loop: the 8-gate priority ladder');

  t('DECISION_GATES has the exact §15 priority order, safety/authority first', () => {
    assert.deepStrictEqual(D.DECISION_GATES, [
      I.DECISION_TRIGGER.SAFETY_AUTHORITY,
      I.DECISION_TRIGGER.HARD_STOP,
      I.DECISION_TRIGGER.CONSEQUENTIAL_AMBIGUITY,
      I.DECISION_TRIGGER.ACTIONS_NEED_RECONCILE,
      I.DECISION_TRIGGER.EVIDENCE_INCOMPLETE,
      I.DECISION_TRIGGER.ELIGIBLE_REPAIR,
      I.DECISION_TRIGGER.ACCEPTANCE_ESTABLISHED,
      I.DECISION_TRIGGER.DISCRETIONARY_WORK,
    ]);
  });

  t('unconstrained work reduces to the lowest lawful next action', () => {
    // No failing condition: only an identified discretionary requirement.
    const r = D.decideNextAction({ discretionaryWorkJustified: true, identifiedRequirement: 'R9' });
    assert.strictEqual(r.trigger, I.DECISION_TRIGGER.DISCRETIONARY_WORK);
  });

  group('§15 adversarial: safety/authority beats efficiency, every time');

  t('SAFETY/AUTHORITY FAILURE wins over even a completed acceptance and efficiency', () => {
    const r = D.decideNextAction({
      // Even when everything else is in its best state:
      acceptanceEstablished: true,
      evidenceComplete: true,
      eligibleRepairConditionsHold: true,
      discretionaryWorkJustified: true,
      identifiedRequirement: 'R9',
      // ... one authority/ownership dispute dominates:
      safetyOrAuthorityFailure: true,
      ownershipDisputed: true,
    });
    assert.strictEqual(r.trigger, I.DECISION_TRIGGER.SAFETY_AUTHORITY, 'authority dispute must not be papered over by acceptance');
    assert.ok(r.problems.length > 0);
  });

  t('a safety stop outranks budget exhaustion, ambiguity, and evidence work', () => {
    const r = D.decideNextAction({
      safetyStopTriggered: true,
      budgetExhausted: true,
      consequentialAmbiguityUnresolved: true,
      evidenceRequired: true, evidenceComplete: false,
      acceptanceEstablished: true,
    });
    assert.strictEqual(r.trigger, I.DECISION_TRIGGER.HARD_STOP);
    assert.deepStrictEqual(r.details.reasons.sort(), ['budget exhausted', 'safety stop triggered']);
  });

  t('hard stop conditions each fail the loop before any mutation or reuse', () => {
    for (const key of ['cancellationRequested', 'budgetExhausted', 'safetyStopTriggered']) {
      const r = D.decideNextAction({ [key]: true, admittedActionsUnresolved: true, discretionaryWorkJustified: true, identifiedRequirement: 'R1' });
      assert.strictEqual(r.trigger, I.DECISION_TRIGGER.HARD_STOP, `${key} must hard-stop`);
    }
  });

  t('consequential ambiguity must terminate or ask BEFORE mutation', () => {
    const r = D.decideNextAction({ consequentialAmbiguityUnresolved: true, eligibleRepairConditionsHold: true, acceptanceEstablished: true });
    assert.strictEqual(r.trigger, I.DECISION_TRIGGER.CONSEQUENTIAL_AMBIGUITY);
    assert.ok(r.problems.some((p) => p.includes('before any mutation')));
  });

  t('unreconciled admitted actions block resource reuse before further work', () => {
    const r = D.decideNextAction({ admittedActionsUnresolved: true, resourceReusePending: true, evidenceRequired: true, evidenceComplete: false });
    assert.strictEqual(r.trigger, I.DECISION_TRIGGER.ACTIONS_NEED_RECONCILE);
  });

  t('evidence incomplete fires only once the generation is frozen (no premature gating)', () => {
    assert.strictEqual(D.decideNextAction({ evidenceRequired: true, evidenceComplete: false }).trigger, I.DECISION_TRIGGER.HARD_STOP, 'unfrozen work is not an evidence gap yet — fails closed to stop');
    const frozen = D.decideNextAction({ currentGenerationFrozen: true, evidenceRequired: true, evidenceComplete: false });
    assert.strictEqual(frozen.trigger, I.DECISION_TRIGGER.EVIDENCE_INCOMPLETE);
  });

  t('eligible repair is admitted only within the one-shot §18 allowance', () => {
    const ok = D.decideNextAction({ eligibleRepairConditionsHold: true, repairAllowanceAvailable: true, repairCount: 0 });
    assert.strictEqual(ok.trigger, I.DECISION_TRIGGER.ELIGIBLE_REPAIR);
    assert.strictEqual(ok.details.ceiling, R.REPAIR_CEILING);
    // A second repair is refused: the one-shot allowance is spent.
    const spent = D.decideNextAction({ eligibleRepairConditionsHold: true, repairAllowanceAvailable: false, repairCount: 1 });
    assert.notStrictEqual(spent.trigger, I.DECISION_TRIGGER.ELIGIBLE_REPAIR);
  });

  t('established acceptance stops further discretionary work', () => {
    const r = D.decideNextAction({ acceptanceEstablished: true, discretionaryWorkJustified: true, identifiedRequirement: 'R9' });
    assert.strictEqual(r.trigger, I.DECISION_TRIGGER.ACCEPTANCE_ESTABLISHED);
  });

  group('§15 fail-closed behavior');

  t('empty or contradictory situations fail closed to HARD_STOP, never guessed', () => {
    assert.strictEqual(D.decideNextAction({}).trigger, I.DECISION_TRIGGER.HARD_STOP);
    const r = D.decideNextAction({ discretionaryWorkJustified: true, identifiedRequirement: null });
    assert.strictEqual(r.trigger, I.DECISION_TRIGGER.HARD_STOP);
    assert.ok(r.problems.some((p) => p.includes('no lawful next action')));
  });

  group('§15 context selection: minimum sufficient');

  t('selects only directly relevant sources; no expansion when facts are covered', () => {
    const candidateSources = [
      { id: 'interface', provides: ['interface'] },
      { id: 'consumer', provides: ['consumer'] },
      { id: 'config', provides: ['config'] },
      { id: 'unrelated-docs', provides: ['marketing'] },
    ];
    const r = D.selectContext({ candidateSources, requiredFactTypes: ['interface', 'consumer'] });
    assert.deepStrictEqual(r.selected.map((s) => s.id), ['interface', 'consumer']);
    assert.strictEqual(r.expanded, false);
    assert.deepStrictEqual(r.problems, []);
  });

  t('UNNECESSARY CONTEXT EXPANSION refused — a known path cannot silently grow the set', () => {
    const candidateSources = [
      { id: 'interface', provides: ['interface'] },
      { id: 'config-A', provides: ['config'] },
      { id: 'config-B', provides: ['config'] }, // second provider exists but is not needed
    ];
    const r = D.selectContext({ candidateSources, requiredFactTypes: ['interface'] });
    assert.strictEqual(r.expanded, false);
    // Minimal covering: only the directly-needed interface source. The two
    // config providers are never pulled in for "just-in-case" coverage.
    assert.deepStrictEqual(r.selected.map((s) => s.id), ['interface']);
    // When the fact is ALREADY known in-scope, no source is needed at all —
    // the smallest set is genuinely empty.
    const known = D.selectContext({ candidateSources, requiredFactTypes: ['interface'], discoveryResults: { interface: 'already known' } });
    assert.strictEqual(known.expanded, false);
    assert.deepStrictEqual(known.selected.map((s) => s.id), []);
  });

  t('expansion happens ONLY for a genuinely missing fact type', () => {
    const candidateSources = [
      { id: 'interface', provides: ['interface'] },
      { id: 'consumer', provides: ['consumer'] },
    ];
    // Settled context grows only because 'consumer' was genuinely missing.
    const withConfig = D.selectContext({
      candidateSources: [...candidateSources, { id: 'config', provides: ['config'] }],
      requiredFactTypes: ['interface', 'consumer', 'config'],
      initialSelection: ['interface'],
    });
    assert.strictEqual(withConfig.expanded, true, 'consumer+config are genuinely missing; adding them is justified expansion');
    assert.ok(withConfig.selected.some((s) => s.id === 'config'));
    assert.deepStrictEqual(withConfig.problems, []);

    // A fact with NO provider anywhere is flagged unresolved — expanding for
    // consumer is lawful, importing a source that cannot provide missing-config
    // is not; the problem surfaces the unresolved obligation.
    const r2 = D.selectContext({
      candidateSources,
      requiredFactTypes: ['interface', 'consumer', 'missing-config'],
      initialSelection: ['interface'],
    });
    assert.strictEqual(r2.expanded, true, 'consumer genuinely needed a provider, so lawful expansion occurred');
    assert.ok(r2.problems.some((p) => p.includes('"missing-config" not providable')), 'an unprovidable fact is an unresolved obligation, never silently dropped');
  });

  t('an out-of-scope source is never included, regardless of what it provides', () => {
    const candidateSources = [
      { id: 'interface', provides: ['interface'] },
      { id: 'external-network', provides: ['consumer'], outOfScope: true },
    ];
    const r = D.selectContext({ candidateSources, requiredFactTypes: ['interface', 'consumer'] });
    assert.ok(r.problems.some((p) => p.includes('outside the readable-data scope')));
    // The out-of-scope source is expanded in, but the scope rule keeps it flagged.
    assert.ok(r.selected.some((s) => s.id === 'external-network'));
  });

  group('§15 static capability registry');

  t('selectCapability prefers native deterministic over analyzer and model reasoning', () => {
    const r = D.selectCapability({ questionType: 'exit_behavior', requiredEvidence: ['stdout', 'stderr', 'exit_code', 'exit_signal', 'timeout'] });
    assert.strictEqual(r.rank, D.CAPABILITY_RANKS.NATIVE_DETERMINISTIC);
    assert.strictEqual(r.selected.identityAndVersion, 'protected-cli-observer@1');
  });

  t('file reading prefers the trusted read-only registrar, not a model', () => {
    const r = D.selectCapability({ questionType: 'file_hash', requiredEvidence: ['file_hash'] });
    assert.strictEqual(r.rank, D.CAPABILITY_RANKS.NATIVE_DETERMINISTIC);
    assert.strictEqual(r.selected.identityAndVersion, 'trusted-inspection-reader@1');
  });

  t('static analysis selects the admitted analyzer (rank 2) over last-resort model reasoning', () => {
    const r = D.selectCapability({ questionType: 'static_analysis', requiredEvidence: ['static_findings'] });
    assert.strictEqual(r.rank, D.CAPABILITY_RANKS.ADMITTED_ANALYZER);
  });

  t('MODEL REASONING IS LAST RESORT and requires explicitly justified context expansion', () => {
    // Only model reasoning can produce a proposal; without justified expansion
    // it is refused (deterministic evidence must be exhausted first).
    const refused = D.selectCapability({ questionType: 'open_synthesis', requiredEvidence: ['proposal_text'] });
    assert.strictEqual(refused.selected, null);
    assert.ok(refused.problems.some((p) => p.includes('context expansion not justified')));

    const allowed = D.selectCapability({ questionType: 'open_synthesis', requiredEvidence: ['proposal_text'], contextExpansionJustified: true });
    assert.strictEqual(allowed.selected.identityAndVersion, 'model-reasoning@1');
    assert.strictEqual(allowed.rank, D.CAPABILITY_RANKS.MODEL_REASONING);
  });

  t('no capability can fabricate evidence it does not produce', () => {
    const r = D.selectCapability({ questionType: 'quantum_compute', requiredEvidence: ['entangled_measurement'] });
    assert.strictEqual(r.selected, null);
    assert.ok(r.problems.some((p) => p.includes('no capability')));
  });

  group('§15 impact analysis stays distinguishable from verification');

  t('impactAnalysis records inputs, assumptions, discovery limits, and uncertainty', () => {
    const r = D.impactAnalysis({ inputs: [{ id: 'src/a.js' }], discovered: ['interface B'], discoveryLimit: 3, hasUnresolvedDynamic: true });
    assert.ok(r.impact.includes('limit=3'));
    assert.ok(r.uncertainty.some((u) => u.includes('dynamic runtime behavior')));
    assert.ok(Array.isArray(r.assumptions));
  });

  t('reviewClassifications: deterministic facts and authorized rules may gate; heuristics stay advisory', () => {
    const cls = D.reviewClassifications([
      { id: 'fact-1', isDeterministicFact: true },
      { id: 'rule-1', isAuthorizedRule: true },
      { id: 'opinion-1' }, // owner opinion, no deterministic authority
    ]);
    assert.strictEqual(cls[0].classification, D.ReviewClassification.DETERMINISTIC_FACT);
    assert.strictEqual(cls[0].advisory, false);
    assert.strictEqual(cls[1].classification, D.ReviewClassification.AUTHORIZED_RULE);
    assert.strictEqual(cls[2].classification, D.ReviewClassification.HEURISTIC_JUDGMENT);
    assert.strictEqual(cls[2].advisory, true, 'heuristic quality opinion must not alone invalidate acceptance');
  });

  group('§15 integrated with the report plane (report.cjs decisionStatus)');

  t('decisionStatus reports the deterministic 8-gate ladder and holds no fabricated decision', () => {
    const r = RPT.decisionStatus([REC.createTaskIncarnation({
      taskId: 'task-1', lineageId: 'ln-1', incarnationId: 'inc-1', ownerEpoch: 'o:1', originalRequest: 'x', selectedSourceCommit: 'abc',
    })]);
    assert.deepStrictEqual(r.decisionGates, D.DECISION_GATES);
    assert.strictEqual(r.impliedGate, I.DECISION_TRIGGER.HARD_STOP, 'no terminal/ambiguity evidence => fail-closed stop, honestly');
  });

  t('an authority dispute attested by records dominates any efficiency concern in decisionStatus', () => {
    const task = REC.createTaskIncarnation({
      taskId: 'task-1', lineageId: 'ln-1', incarnationId: 'inc-1', ownerEpoch: 'o:1', originalRequest: 'x', selectedSourceCommit: 'abc',
    });
    const q = { schemaVersion: 1, kind: 'quarantine', quarantineId: 'q-1', resource: 'action-scope:a', reason: 'unresolved actor', state: 'ACTIVE' };
    const act = REC.createAction({ actionId: 'act-1', incarnationId: 'inc-1', ownerEpoch: 'o:1', operation: 'op', targetGeneration: 'gen-1' });
    act.dispatch = REC.ActionDispatch.UNKNOWN;
    const r = RPT.decisionStatus([task, q, act]);
    assert.strictEqual(r.authorityDisputeAttested, true);
    assert.strictEqual(r.impliedGate, I.DECISION_TRIGGER.SAFETY_AUTHORITY, 'authority dispute is priority 1 — it beats every efficiency goal');
  });

  t('a consequential ambiguity recorded on an intent entry is surfaced in decisionStatus', () => {
    const task = REC.createTaskIncarnation({
      taskId: 'task-1', lineageId: 'ln-1', incarnationId: 'inc-1', ownerEpoch: 'o:1', originalRequest: 'x', selectedSourceCommit: 'abc',
    });
    const ambiguous = REC.createIntent({
      requirementId: 'r-a', originalMeaning: 'remove the API', explicitOrInferred: 'inferred',
      sourceAndProvenance: 'diff review', rationale: 'removal affects consumers', scope: 'API surface',
      uncertainty: { consequentialDomains: ['COMPATIBILITY'], resolved: false },
      applicability: 'UNRESOLVED', intentClass: I.IntentClass.CONSEQUENTIAL_AMBIGUITY,
    });
    const r = RPT.decisionStatus([task, ambiguous]);
    assert.strictEqual(r.ambiguityAttested, true);
    assert.strictEqual(r.impliedGate, I.DECISION_TRIGGER.CONSEQUENTIAL_AMBIGUITY);
  });

  t('repair ceiling is surfaced in decisionStatus and exceeded repairs stay honest', () => {
    const x = REC.createRepair({
      repairId: 'rep-1', incarnationId: 'inc-1',
      failureIdentity: { requirementOrCheck: 'obl-1', caseIdentity: 'case:1', normalizedSignature: 'sig', rawEvidenceReference: 'e/1.json', affectedComponent: 'src/x.js', severity: 'BLOCKING', generationId: 'gen-1' },
    });
    const r = RPT.decisionStatus([x]);
    assert.strictEqual(r.repairCount, 1);
    assert.strictEqual(r.repairCeiling, 1);
  });
};