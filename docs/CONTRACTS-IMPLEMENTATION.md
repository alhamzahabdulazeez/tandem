# CONTRACTS IMPLEMENTATION UNIT — LOG

**Date:** 2026-09-15
**Status:** Bounded Gate-0 feasibility/contract code only. **Gate 0 has NOT passed.** IB-01…IB-04 remain OPEN (see `docs/GATE0-AUDIT.md` §F).
**Governing contract:** `TANDEM_MASTER_EXECUTION_PRD_V1.md` (v1.0)

This file records the *smallest required implementation deltas and their
acceptance tests* (Gate-0 ordered work item 14, PRD §25). It is **not** a
qualification, acceptance, or production-readiness claim. No capability claimed
here is supervised, contained, qualified, or release-ready.

---

## What was implemented (and why it is lawful now)

Everything below is pure data/logic with **no** dependency on the unqualified
execution environment: no OS containment, no agent invocation, no external
services, no incumbent mutation. Per the Gate-0 audit §I, bounded
feasibility/probe code and the documentation of smallest deltas are the lawful
outputs until Gate 0 exits. `tandem check` is the checker/observer mode that
§25 and the audit §J explicitly record as the valid supported state while the
supervised profile is unavailable.

| New file | Contract | Tests |
|---|---|---|
| `src/contracts/records.js` | §6 record shapes, enums, non-reusable ID generation | `test/contracts/records.test.js` |
| `src/contracts/state-machine.js` | §7 phase/action/generation/policy transitions, terminal results | `test/contracts/state-machine.test.js` |
| `src/contracts/crypto.js` | §6/§20 deterministic hashing, manifests, canonical JSON | `test/contracts/crypto.test.js` |
| `src/contracts/validate.js` | §6/§14/§21 fail-closed record/store/digest validation | `test/contracts/validate.test.js` |
| `src/contracts/adapter-interface.js` | §4 thin authority-free adapter contract | `test/contracts/adapter-interface.test.js` |
| `src/contracts/budget.js` | §12 hard-limit ledger, reservations, protected capacity | `test/contracts/budget.test.js` |
| `src/check/checker.cjs` | §22/F-05 honest non-executing inspection | `test/contracts/checker.test.js`, `checker-cli.test.js` |
| `bin/tandem.cjs` (additive `check` branch) | §22 command-surface wiring, **no** existing command removed | `checker-cli.test.js` |
| `package.json` (additive `test:contracts` script) | discoverability | — |

All source new modules live under `src/contracts/` and `src/check/`.
`src/` existing files were **not** replaced; `bin/tandem.cjs` and
`package.json` were changed only additively.

## Run the acceptance tests

```
node test/all.cjs          # units suite: 290 passed, 0 failed (2026-09-15)
npm test                   # legacy gate: 110 passed, 1 failed — the one
                           # failure is the pre-existing environmental host
                           # package-resolution failure, unchanged from the
                           # Gate-0 audit; not a regression from these units.
```

## Key contract decisions recorded for traceability

1. **IDs** are `type-<ms>-<hex>` (timestamp + 8 random bytes), namespaced, and
   non-reusable within their namespace (§6).
2. **State machine** encodes the §7 phase table, the one-way
   `MUTABLE → MUTATION_CLOSED → FROZEN` generation rule, action axes, and the
   §8 policy stages. No phase can skip to `FINALIZING`-bypass or re-enter
   `RECEIVED`. `TERMINAL` is a sink.
3. **Validation fails closed:** unknown kind, unknown enum, wrong
   `schemaVersion`, duplicate identity, and a `CONSUMED` allowance with
   `NOT_ATTEMPTED` dispatch are all rejected. `NaN`/`Infinity`/circular values
   are rejected in canonical JSON.
4. **Budget ledger** enforces
   `settled + reservations + newReservation + protectedFuture <= hardLimit`,
   mandatory transfer without double-count, and only the three lawful release
   routes (§12). Unknown usage blocks hard admission.
5. **Checker** (`tandem check`) executes nothing. It reports scope, structural
   unsupported shapes, `.git` exclusion (§11), a content manifest, and an
   explicit honesty block (`executed: false`, `preventedAnything: false`,
   `supervisedExecution: false`). The CLI reports supervised execution as
   UNAVAILABLE on the current state (IB-01 open).

## Units 7–10 (2026-09-15, approved change request)

Candidates capture, acceptance/obligation + evidence coherence, immutable
generation/freeze/manifest/publication, and status/evidence reporting. All of it
is pure record algebra or additive read-only inspection — **no** qualified
runtime, containment, execution, or Gate-0 qualification is claimed.

| New file | Contract | Tests |
|---|---|---|
| `src/contracts/capture.js` | §11 source-capture readiness lattice, 10 reject rules, inclusion/exclusion normalization, baseline manifest digest | `test/contracts/capture.test.js` |
| `src/contracts/acceptance.js` | §13 inventory, §14 8-point coverage + 3 predicate families, PASS/FAIL/MISSING/INCONCLUSIVE total outcome, monotonic FAIL, §21 final reduction, §17/§21 applicability keys | `test/contracts/acceptance.test.js` |
| `src/contracts/evidence.js` | §17 17-field envelope, authoritative-vs-supporting, stale-reuse rejection, final 10-domain coherence, input closure | `test/contracts/evidence.test.js` |
| `src/contracts/generation.js` + `generation` record | §7 one-way `MUTABLE→MUTATION_CLOSED→FROZEN`, §20 two closure barriers, freeze readiness (READY/NOT_READY/UNQUALIFIED), create-once identity, 10-field delivery manifest, publication ordering, §20 crash table, retention | `test/contracts/generation.test.js` |
| `src/control/report.cjs` + additive `tandem status` / `tandem evidence` | §22 read-only task/lifecycle/delivery/resource/recovery + evidence-gate reductions | `test/control/report.test.js` |

Also modified additively: `src/contracts/records.js` (`createGeneration`),
`src/contracts/validate.js` (`generation` kind + fail-closed cross-field freeze
rules), `src/contracts/acceptance.js` (INCONCLUSIVE-vs-MISSING semantics),
`bin/tandem.cjs` (additive `status`/`evidence`, nothing removed).

Honest boundaries preserved in these units, verbatim in the code:

- **Freeze is UNQUALIFIED under IB-01.** `freezeReadiness` returns READY only
  when a qualified materializer attested create-once/write-once byte semantics
  ("a hash of a writable directory is not freezing").
- **No stale evidence ever upgrades.** Evidence binds an applicability key
  (contract/policy/profile/generation/predicate); a different generation is
  rejected; MISSING/INCONCLUSIVE never become PASS; a valid still-applicable
  FAIL is monotonic and cannot be overwritten by a later green observation.
- **Only three predicate families**, each with its mandatory observation types,
  enforced by the 8-point validator; `llm_judgment`-style families are refused.
- **`.git` is administration, not source content** — excluded intrinsically.
- **`status`/`evidence` never fabricate**: no store → reported absent; corrupt
  or duplicate-identity store → fail closed with exit 1; qualification is
  derived only from records that attest a qualified reader (absent here → gate
  CHECKER_ONLY, supervised execution UNAVAILABLE).

## What remains blocked by Gate 0 (NOT implemented)

- OS-level containment, fencing, drain, cancellation, descendant control
  (requires a qualified runtime profile — IB-01).
- `admitAndRelease` serialized gate against a live boundary (with a qualified
  executor); durable loops already fold but supervised dispatch is UNAVAILABLE.
- Agent adapter integration and model transport.
- Physical immutable byte capture / freeze / durable publication (the algebra
  is implemented and fails closed; the qualified materializer/reader is not
  attested — IB-01).
- Protected external observer, qualified native full-suite execution.
- IB-02 (first-slice fixture), IB-03 (resource ceilings), IB-04 (frozen eval
  protocol) are owned by their named authorities.
- Legacy `run`/`init`/`doctor`/`bench` remain in place, untouched (removal is
  Gate-1 ordered work).

## Traceability (partial Gate-0 code-map rows)

| PRD obligation | Binding (this unit) | Test |
|---|---|---|
| §6 durable record shapes & fail-closed decode | `src/contracts/{records,validate}.js` | `records.test.js`, `validate.test.js` |
| §7 lifecycle & axis state machines | `src/contracts/state-machine.js` | `state-machine.test.js` |
| §12 additive hard arithmetic & protected capacity | `src/contracts/budget.js` | `budget.test.js` |
| §22 `tandem check` honesty (F-05) | `src/check/checker.cjs`, `bin/tandem.cjs` | `checker.test.js`, `checker-cli.test.js` |
| §6 content identities & §20 manifests | `src/contracts/crypto.js` | `crypto.test.js` |
| §4 thin adapter contract | `src/contracts/adapter-interface.js` | `adapter-interface.test.js` |
| §11 source isolation algebra | `src/contracts/capture.js` | `capture.test.js` |
| §13/§14/§21 acceptance & obligations | `src/contracts/acceptance.js` | `acceptance.test.js` |
| §17 evidence envelope & coherence | `src/contracts/evidence.js` | `evidence.test.js` |
| §7/§20 generation, freeze, manifest, publication | `src/contracts/generation.js` (+ `generation` record) | `generation.test.js` |
| §22 `tandem status` / `tandem evidence` additive surface | `src/control/report.cjs`, `bin/tandem.cjs` | `report.test.js` |

## Unit 12 (2026-09-15): §18 Bounded Repair + §19 Universal Finalization

Two pure contract algebras only — no execution environment, no precedent
authority, no qualification claim. Everything is record algebra / fail-closed
validation, exactly as lawful under Gate 0 (audit §I).

| New file | Contract | Tests |
|---|---|---|
| `src/contracts/repair.js` | §18 Bounded Repair: one-shot allowance (`REPAIR_CEILING=1`), §18 failure identity (7 mandatory/optional fields), full eligibility lattice (every condition must be explicitly true), hard MUST-NOT prohibitions (no thaw / no overwrite / no inherited pass / no budget reset), stop conditions incl. repeated-signature-without-new-evidence | `test/contracts/repair.test.js` |
| `src/contracts/finalization.js` | §19 Universal Finalization: terminal-treatment table over every `TerminalResult`, quiescence that *requires* the qualified runtime boundary (IB-01) — a quiet log is explicitly insufficient, ten-step reduction (success gate needs quiescence + §20 publication ordering; fencing failure ⇒ `UNRESOLVED_EXECUTION`), narrow post-terminal exception = authenticated accounting settlement ONLY (reopen/import/mutate/upgrade all refused) | `test/contracts/finalization.test.js` |

Also modified additively: `src/contracts/records.js` (`createRepair` + `repair`
record factory), `src/contracts/validate.js` (`repair` kind validator; duplicate
identity detection already covers it via `RECORD_ID_FIELDS`),
`src/control/report.cjs` (`recoveryStatus` now reports per-finalization
`stop=/successGate=/quiescenceProven=/fence=` plus §18 `repairs`/`repairCount`/
`repairCeiling`/`repairExceeded`), `bin/tandem.cjs` (`tandem status` recovery
print block).

Honest boundaries preserved verbatim in the code:

- **Quiescence is UNQUALIFIED under IB-01.** `quiescenceConditions` requires
  `reproducedByQualifiedRuntimeBoundary`; without it, a nominally-successful
  reduction resolves to `UNRESOLVED_EXECUTION` and *does not publish* (§19).
- **Repair allowance is a one-shot durable latch.** A second repair is
  `EXHAUSTED` — monotonic, even against a nominally-clean eligibility call.
- **Non-success terminal paths NEVER publish** an exact frozen identity as
  success: FAILED/BLOCKED/NEEDS_USER/CANCELLED/SAFETY_STOP/BUDGET_EXHAUSTED/
  UNRESOLVED_EXECUTION all resolve `publishes:false`; an unknown stop reason
  fails closed.
- Nothing here claims containment, physical supervision, or qualified runtime
  enforcement.

Run the acceptance tests:

```
node test/all.cjs          # units suite: 356 passed, 0 failed (2026-09-15)
npm test                   # legacy gate: 110 passed, 1 failed — identical
                           # pre-existing environmental host package-resolution
                           # failure; not a regression from Unit 12.
```

## Traceability (Unit 12)

| PRD obligation | Binding (this unit) | Test |
|---|---|---|
| §18 Bounded Repair (one-shot allowance, failure identity, eligibility, MUST-NOTs, stop) | `src/contracts/repair.js` | `repair.test.js` |
| §19 Universal Finalization (terminal table, quiescence, ten-step reduction, late-payload rule) | `src/contracts/finalization.js` | `finalization.test.js` |
| §18/§19 durable records & fail-closed validation | `records.js` (`createRepair`), `validate.js` (`repair` kind) | `repair.test.js` (store-path adversarial) |
| §22 status recovery + repair surface | `report.cjs`, `bin/tandem.cjs` (additive) | existing `report.test.js` + units suite |

This log does not advance any gate. The next lawful step is unchanged:
resolve IB-01…IB-04 with their authorities and establish the isolated qualified
feasibility environment before any Gate-1 production unit (PRD §25, audit §H).

## Unit 13 (2026-09-15): §13 Intent Requirements + §15 Engineering Decisions

Two pure contract/record algebras, additive to the existing single-source-of-truth
coherence/reporting plane. No new LLM, no multi-agent planner, no generalized
planner, no predicate language, no broad memory, no model routing, no external
integrations, no runtime capability claim. The supervisor decides *whether/why*
(a deterministic priority reduction); the coding agent remains responsible for
*how* (code-level implementation).

| New file | Contract | Tests |
|---|---|---|
| `src/contracts/intent.js` | §13 Intent Requirements: the explicit 5-way distinction (USER_STATED / SAFELY_INFERRED / CONSEQUENTIAL_AMBIGUITY / EXPLICIT_NON_GOAL / UNSUPPORTED) with a fail-closed 6-rule deterministic classifier; provenance integrity (`validateProvenanceIntegrity` — an inference must never silently become user-stated); mandatory-intent protection (`validateMandatoryIntentIntegrity` — untrusted content must never delete mandatory intent, widen authority, rewrite a trusted meaning, or manufacture requirements/PASS evidence); durable `createIntent` record + contentHash binding the frozen meaning; order-independent `intentDigest` for §14 contract binding; `intentIntegrityGate` consumed by the §21 coherence plane | `test/contracts/intent.test.js` |
| `src/contracts/decisions.js` | §15 Engineering Decisions: the 8-priority deterministic decision loop (`decideNextAction` — safety/authority/ownership/HARD_STOP > consequential ambiguity > reconcile admitted actions > complete evidence > one-shot eligible repair (REPAIR_CEILING) > acceptance established > discretionary work; empty/contradictory facts fail closed to HARD_STOP); minimum-sufficient context selection (`selectContext` — starts from the settled context, expands ONLY for a genuinely missing fact type, flags unprovidable facts as unresolved, refuses out-of-scope sources); small static capability registry (`selectCapability` — native deterministic rank 1 > admitted analyzer rank 2 > model reasoning rank 3 ONLY with justified context expansion; capabilities declare I/O contract, effect scope, trust, permissions, network/disclosure, runtime enforcement, evidence they actually produce); `impactAnalysis` kept distinguishable from verification (inputs, assumptions, discovery limits, uncertainty); `reviewClassifications` — deterministic facts/authorized rules may gate, heuristic quality opinions stay advisory and cannot by themselves invalidate acceptance | `test/contracts/decisions.test.js` |

Also modified additively: `src/contracts/records.js` (`createIntent` factory +
`intent` record kind), `src/contracts/validate.js` (`intent` kind validator with
cross-field provenance-corruption and class/axis coherence checks — inferred
records claiming user-request origin are REFUSED at the durable store),
`src/contracts/coherence.js` (`acceptanceGates` now consumes `intentIntegrityGate`
and adds an intent-integrity blocker when a task is active and the intent plane
is absent-or-corrupt — deletion-to-zero is caught, forged replacement is caught),
`src/control/report.cjs` (`intentStatus` + `decisionStatus` + coherence `intentIntact`),
`bin/tandem.cjs` (`tandem status` intent/decision print blocks + intent-integrity
line in the coherence plane).

Adversarial coverage required by the unit request is in `test/contracts/intent.test.js`
and `test/contracts/decisions.test.js`: requirement deletion (active task with
zero intent records; forged replacement meaning not traceable to the retained
original request; empty §14 inventory is never accepted), provenance corruption
(inference labeled user-request refused at classification AND at the store),
unsafe inference (missing rationale/scope/uncertainty ⇒ unclassifiable),
consequential ambiguity (unresolved consequential domains ⇒ CONSEQUENTIAL_AMBIGUITY
and the decision loop must terminate-or-ask before mutation; resolved+authorized
safe default ⇒ not ambiguous), untrusted content altering trusted intent
(contentHash binds the frozen meaning; a mandatory USER_STATED meaning that is
not traceable to the unchanged original request cannot gate acceptance),
unnecessary context expansion (known facts need no source; a second provider is
never pulled in for just-in-case), and safety/authority priority over efficiency
(an ownership dispute dominates even a completed acceptance; a quarantine +
UNKNOWN dispatch reduces the decisionStatus implied gate to SAFETY_AUTHORITY).

Honest boundaries preserved verbatim in the code:

- **Intent classification is 100% deterministic fact reduction.** No model
  reasoning classifies anything; an unclassifiable record fails closed to `null`
  and is refused by the store — a requirement can never be manufactured.
- **Inference is monotonically downgraded, never upgraded.** Explicit-origin
  claims from memory/repository/agent-proposal sources classify as
  SAFELY_INFERRED; an inferred entry claiming `user-request` origin is
  provenance corruption and is refused at the durable store.
- **`status` reports derived decision facts, never an admission.** `impliedGate`
  is labelled "derived fact from these records; not an admission"; with no
  terminal/ambiguity/authority evidence it honestly reports fail-closed HARD_STOP.
- Nothing here claims containment, physical supervision, qualified runtime, or
  a frozen delivery — all of those remain UNQUALIFIED under IB-01.

Run the acceptance tests:

```
node test/all.cjs          # units suite: 415 passed, 0 failed (2026-09-15;
                           # Unit 13 adds 57 tests: 27 intent + 26 decisions
                           # + 4 report integration)
npm test                   # legacy gate: 110 passed, 1 failed — identical
                           # pre-existing environmental host package-resolution
                           # failure; not a regression from Unit 13.
```

## Traceability (Unit 13)

| PRD obligation | Binding (this unit) | Test |
|---|---|---|
| §13 Intent Requirements (5-way distinction, retained original request, inventory) | `src/contracts/intent.js` (`IntentClass`, `classifyIntent`, `createIntent`) | `intent.test.js` |
| §13 provenance integrity (inference never silently becomes user-stated) | `validateProvenanceIntegrity` + `validate.js` intent cross-field refusal | `intent.test.js` (adversarial) |
| §13 mandatory intent protection (untrusted content cannot delete/rewrite mandatory intent) | `validateMandatoryIntentIntegrity`, `contentHash`, `intentIntegrityGate` | `intent.test.js` (adversarial) |
| §15 Engineering Decisions (8-priority deterministic loop, safety/authority first) | `src/contracts/decisions.js` `decideNextAction` / `DECISION_GATES` | `decisions.test.js` |
| §15 minimum-sufficient context + static capability registry | `selectContext` / `selectCapability` / `CAPABILITY_REGISTRY` | `decisions.test.js` (adversarial) |
| §15 impact analysis ≠ verification; heuristics cannot invalidate acceptance | `impactAnalysis` / `reviewClassifications` | `decisions.test.js` |
| Same-source-of-truth reporting/coherence integration | `coherence.js` intent gate, `report.cjs` intent/decision sections, `bin/tandem.cjs` | `report.test.js` (Unit 13 group) + `tandem status` CLI smoke |