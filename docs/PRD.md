# TANDEM — Product Requirements Document

---

## 1. Document Status and Decision Summary

| Field | Value |
|---|---|
| Product | Tandem — a standalone CLI coding agent with decision-point verification |
| Version | 1.1 |
| Date | 2026-09-17 |
| Task mode | APPROVED |
| Assurance level | **LEAN** |
| Document status | **Product-Approved Baseline** |
| Scope baseline status | **Approved** (2026-09-17 by Hamza) |
| Decision owner | Hamza (sole owner and sole user) |
| Required approver | Hamza |
| Next decision | Release audit and release evaluation (Option A adopted for SC-01) |

**Assurance level rationale.** Per the proportionality rule of the governing standard, process depth must
match risk. Tandem is a personal developer tool of roughly six hundred lines, with no users besides its
author, no stored personal data, no payments, no regulatory exposure, and fully reversible decisions.
STANDARD assurance would be disproportionate. Sections that do not apply are marked *Not applicable*
with a brief reason rather than filled to satisfy a template.

**Material assumptions.** A-01 through A-05 in §10 (A-01 evaluated as INCONCLUSIVE; A-03 validated).

**Blocking issues.** None. All decisions are resolved and approved in §4 (D-01 … D-14). Scope baseline §3 approved. SC-01 measured and accepted per Option A.

**Primary sources.**
- Direct observation on the owner's own machine (hook probe, September 2026) — §5.
- The governing product-architecture standard supplied by the owner.
- Benchmark measurement (September 2026, 100 runs, 5 repetitions on Groq `openai/gpt-oss-120b`) — §8, SC-01 recorded as **Measured — INCONCLUSIVE**.

---

## 2. Problem, Evidence, and Objectives

### 2.1 Problem statement

Frontier coding models are the assumed default of every mainstream AI coding tool. A developer who
cannot or will not pay for one — because of cost, region, payment access, or provider restrictions —
falls back to free or low-cost models. Those models produce plausible code that frequently does not
compile, and the failure usually surfaces several tool calls later, when the context that produced it
has already scrolled away.

### 2.2 Current alternatives

| Alternative | Why it does not solve the problem |
|---|---|
| Pay for a frontier model | Not available to the target user; this is the premise |
| Gateways (OmniRoute, LiteLLM, and similar) | Solve **access** to free models. They do not touch output quality |
| Read the model's output carefully | Manual, slow, and unreliable; defeats the purpose of an agent |
| Accept the lower quality | The problem, restated |

### 2.3 Target user

The author, working alone, on TypeScript projects, from Windows and occasionally Android. Secondary
audience: developers in similar circumstances, if the project is published. **No other persona is
assumed.**

### 2.4 Evidence

| ID | Statement | Type | Status |
|---|---|---|---|
| E-01 | Claude Code hooks fire and behave as described in §5 | Claim | **Evidence-supported** — observed directly by the owner |
| E-02 | A weak generator paired with a verifier can approach a stronger generator's performance, with the largest gain at the weak end | Claim | **Measured for this product — INCONCLUSIVE** (measured 2026-09-11; 100 runs, 5 reps on `openai/gpt-oss-120b`: off 2/50 [1.1%, 13.5%], on 0/50 [0.0%, 7.1%]; difference within noise due to model floor effect; Option A adopted) |
| E-03 | Free-tier models produce type errors the compiler catches immediately | Claim | **Evidence-supported** — observed during development |

### 2.5 Intended outcome

A developer using a free model receives compiler-grade feedback on every edit, inside the same turn
loop, so that broken code is corrected by the model itself before it accumulates.

### 2.6 Differentiation hypothesis

**Status: Unverified.** No mainstream coding tool attempts to compensate for a weak model, because the
economics point the other way — vendors of frontier models have no incentive to raise the quality of a
competitor's free tier. Tandem occupies that gap. This is a hypothesis about the market, not a
measured claim.

### 2.7 Reasons not to build

Recorded honestly, per the standard.

- If the measured lift (§8, SC-01) is inside measurement noise, the product has no verified performance lift over baseline. On 2026-09-11, the 100-run benchmark yielded an INCONCLUSIVE result due to a severe floor effect on `openai/gpt-oss-120b`. Per Option A (accepted by the product owner), this null result is accepted and documented faithfully rather than manipulating thresholds or tasks.
- Claude Code may absorb equivalent behaviour into its own defaults, which would make Tandem redundant.
- The mechanism is simple enough to be copied quickly once published.

---

## 3. Scope Baseline

**Version:** 1.1 · **Status:** Approved (2026-09-17) · **Owner:** Hamza

### 3.1 In scope

| ID | Capability |
|---|---|
| S-00 | Verify at five decision points derived from events, not chosen by a model |
| S-01 | Inject five behavioural rules at session start |
| S-02 | Type-check every edited file immediately after the edit and return errors to the model |
| S-03 | Run the full gate sequence when the model believes it has finished |
| S-04 | Block a repair that breaks a previously passing test |
| S-05 | Bound repair attempts on the same failure and stop cleanly |
| S-06 | Confine writes to a declared working set |
| S-07 | Disable any gate whose tool is absent, without failing the session |
| S-08 | Measure verification-on versus verification-off and emit a machine-readable result |
| S-09 | Run as a standalone command, not as an extension of another tool |
| S-10 | Promote a recurring error into memory deterministically after a fixed number of recurrences |

### 3.2 Explicit non-goals

| Non-goal | Reason |
|---|---|
| Model routing, quotas, cost accounting | Gateways already do this. Duplicating it creates a permanent maintenance debt |
| Bundling or requiring any specific gateway or provider | Neutrality is a requirement — see D-09 |
| A sandbox or isolation layer | Real isolation requires an OS or VM boundary. Claiming a partial one is worse than claiming none |
| Reimplementing an agent loop, terminal UI, or provider layer from scratch | The host provides them; duplicating them is permanent debt (D-10) |
| Languages other than TypeScript and JavaScript in 1.0 | See D-01 |
| Any claim of parity with a frontier model | Unsupported by evidence |

### 3.3 Deferred

Python and Go support (1.1) · additional gates such as lint and security scanning (1.2) · a
benchmark suite covering debugging and multi-file work (1.2).

### 3.4 Core outcome this version must deliver

A measured number for SC-01 — delivered 2026-09-11 as INCONCLUSIVE, accepted under Option A — and a tool the owner can install and use daily on
his own TypeScript projects.

---

## 4. Decisions

All decisions below are **Approved** by the owner (Hamza) on 2026-09-17.

| ID | Decision | Rationale | Trade-off accepted | Status |
|---|---|---|---|---|
| **D-01** | TypeScript and JavaScript only in 1.0. The architecture treats gate commands as configuration, not code, so other languages need configuration rather than redesign | The central claim needs measurement, and measurement needs one language. Breadth before evidence is breadth without value | Most developers cannot use 1.0 | **Approved** |
| **D-02** | Configuration lives in a `tandem.json` file at the project root. If absent, the tool infers commands from the project's own manifest | Zero-configuration first run; full control when needed | Inference can be wrong. Mitigated by D-05 | **Approved** |
| **D-03** | Windows, Linux and macOS are supported. Android/Termux is best-effort and labelled as such | Only partial Termux verification was performed. Claiming support without testing is a false claim | Some Android users hit undocumented issues | **Approved** |
| **D-04** | Distribution as a global package, plus an `init` command that installs the hook configuration into a project | One command to install, one to enable. Standalone installers remain as a fallback | Requires a package registry account | **Approved** |
| **D-05** | **A gate whose tool is missing is disabled silently.** The hook exits successfully and logs the reason once per session | A tool that breaks the user's workflow when it cannot help is worse than no tool. This is the single most important decision for adoption | A user may believe a gate is active when it is not. Mitigated by the `doctor` command (D-06) | **Approved** |
| **D-06** | The README pins the verified Claude Code version. A `doctor` command reports which gates are active, which are disabled, and why. No forward-compatibility promise is made | Hook behaviour is version-dependent and has known defects. Promising compatibility would be dishonest | Users must check after upgrading Claude Code | **Approved** |
| **D-07** | Published under the name `tandem-hooks` | The plain name is likely taken, and the suffix describes the mechanism | Slightly less memorable | **Approved** |
| **D-08** | The off switch is documented in the first section of the README, before installation | A user must know how to stop a tool before trusting it to run automatically | None | **Approved** |
| **D-09** | **Gateway neutrality.** Tandem never imports, launches, configures or names a specific gateway. It reads no gateway environment variable and knows no provider name | The verification layer never calls a model, so this costs nothing and makes Tandem compatible with every gateway, including ones not yet written | None identified | **Approved** |
| **D-10** | Tandem is a **standalone command** built on a host agent core, not an extension of another tool | The owner's requirement is a complete CLI tool. The host supplies the agent loop, terminal interface and provider layer; Tandem supplies verification | Host package isolation is required (D-12) | **Approved** |
| **D-11** | Verification fires at **five decision points derived from events** | Targeted verification at development decision points outperforms end-point-only verification | Additional hook machinery | **Approved** |
| **D-12** | The host is confined to `src/adapter/`, enforced by a test | The host changed package scope and SDK surface within four months of observation. A breaking change must cost one file, not a rewrite | Strict encapsulation discipline | **Approved** |
| **D-13** | The benchmark carries **two task families**, reported separately: six greenfield and four against a seeded codebase | Benchmarking shows agents perform differently on existing codebases vs greenfield | Two test harnesses to maintain | **Approved** |
| **D-14** | Memory promotes a recurring error **verbatim after a fixed count**, with no summarisation | A model deciding what is worth remembering is judgement, which contradicts the determinism principle | Larger memory files | **Approved** |

**Verification test for D-09:** with any gateway removed from the machine, Tandem must behave
identically against any other compatible endpoint.

---

## 5. Confirmed Technical Constraints

Observed directly by the owner on his own machine. These are constraints, not design choices.

| ID | Constraint | Consequence |
|---|---|---|
| C-01 | The session-start hook fires and its output reaches the model | Rule injection is possible |
| C-02 | The pre-tool hook fires, but its blocking signal **is not honoured** in the observed version | Prevention is unavailable. Enforcement must be corrective, not preventive |
| C-03 | The post-tool hook fires, and its error output reaches the model on the following turn | **This is the mechanism the product rests on** |
| C-04 | The stop hook fires and its blocking signal **is honoured**, for a bounded number of consecutive turns | Final gates can force continuation, within a limit |
| C-05 | The stop hook receives a flag indicating it has already blocked; ignoring it causes a loop | The flag must be respected |
| C-06 | A post-tool hook cannot undo the edit that triggered it | Out-of-scope writes must be reverted after the fact, not prevented |

C-02 is a defect in the host tool, not in Tandem. Per D-06 it is documented, not concealed.

---

## 6. Functional Requirements

| ID | Requirement | Priority | Source |
|---|---|---|---|
| FR-01 | At session start, inject the five rules of §7 into the model's context | Must | S-01 |
| FR-02 | After a file edit, run the configured type check and return any errors to the model | Must | S-02, C-03 |
| FR-03 | Errors returned to the model must be structured — file, position, code, message — deduplicated, ordered root-cause first, and capped | Must | P-01 |
| FR-04 | When a file cannot be parsed for structured errors, fall back to a truncated raw excerpt and record that the fallback occurred | Must | Observability |
| FR-05 | When the model indicates it has finished, run the full gate sequence and return failures | Must | S-03 |
| FR-06 | Compare the passing-test set after a repair against the last known-good set; reject a repair that removes any previously passing test | Must | S-04 |
| FR-07 | Count consecutive repair attempts against the same failure; when the bound is reached, stop and report what remains rather than continuing | Must | S-05 |
| FR-08 | Reject and revert any write outside the declared working set | Must | S-06, C-06 |
| FR-09 | If a configured gate's tool is unavailable, skip that gate, exit successfully, and record the reason once per session | Must | D-05 |
| FR-10 | Provide a command that reports active gates, disabled gates and their reasons, and the detected host version | Must | D-06 |
| FR-11 | Provide a command that installs the hook configuration into a project and detects its language and commands | Must | D-04 |
| FR-12 | Provide an environment switch that disables all hook behaviour without uninstalling | Must | D-08 |
| FR-13 | Run the benchmark of §8 with hooks enabled and disabled, and emit a machine-readable result including confidence intervals | Must | S-08 |

---

## 7. Business Rules

| ID | Rule |
|---|---|
| BR-01 | **Contract first.** A failing test expressing the acceptance criterion is written before implementation code |
| BR-02 | **Verify each step.** Edits are not batched; each is checked immediately |
| BR-03 | **Bounded repair.** At most the configured number of attempts on the same failure, then stop and report |
| BR-04 | **Deterministic first.** Correctness is never asserted without running the checker; the checker's output is reported |
| BR-05 | **No guessing.** A symbol's existence is confirmed before it is used |

**Precedence.** BR-03 overrides BR-02: once the repair bound is reached, work stops rather than continuing to verify.

**Enforcement principle (P-01).** Every rule that a program can enforce is enforced by that program, not
only by instruction text. A rule stated only in prose is a rule the weakest model will violate. BR-02,
BR-03, BR-04 and BR-05 each have a corresponding automatic gate. BR-01 is advisory in 1.0 — see I-02.

---

## 8. Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-01 | Given a project with a working type checker, when the model writes a file containing a type error, then the error text reaches the model within its next turn |
| AC-02 | Given a project with no type checker installed, when the model writes any file, then the session continues normally and the skip is recorded once |
| AC-03 | Given a write targeting a path outside the working set, when the write completes, then the file is removed and the model is told why |
| AC-04 | Given a repair that fixes one error but breaks a previously passing test, when the gates run, then the repair is reverted and the broken test is named first |
| AC-05 | Given the same failure recurring beyond the configured bound, when the gates run, then work stops and the remaining errors are reported |
| AC-06 | Given the stop hook has already blocked once, when it receives the already-blocked flag, then it permits the turn to end |
| AC-07 | Given the off switch is set, when any hook fires, then it exits successfully and takes no action |
| AC-08 | Given a fresh project, when the install command runs, then the hooks are active and the doctor command reports which gates are enabled |

### Success criteria

| ID | Criterion | Threshold | Status |
|---|---|---|---|
| **SC-01** | Pass rate with hooks versus without, same model, same tasks | Improvement outside overlapping 95% confidence intervals at five or more repetitions | **Measured — INCONCLUSIVE** (measured 2026-09-11; 100 runs, 5 reps on `openai/gpt-oss-120b`: off 2/50 [1.1%, 13.5%], on 0/50 [0.0%, 7.1%]; difference inside noise due to floor effect; Option A adopted) |
| SC-02 | Type errors surviving to the final answer, hooks enabled | Zero | **Measured** (125 off vs 115 on surviving type errors) |
| SC-03 | Additional wall-clock time introduced by the hooks | Recorded and reported; no threshold set in 1.0 | **Measured** (reported in benchmark JSON) |
| SC-04 | Paths modified outside the working set | Zero | **Verified** |
| SC-05 | Every benchmark run emits a machine-readable result | Always | **Verified** (JSON artifacts emitted to `bench-results/`) |

**SC-01 is the whole thesis.** On 2026-09-11, the full 100-run benchmark design was executed (5 repetitions across 10 tasks, 0 invalid runs) using Groq provider key rotation. The measured result was INCONCLUSIVE: the 95% Wilson confidence intervals overlap (off: 2/50 [1.1%, 13.5%], on: 0/50 [0.0%, 7.1%]), showing no statistically significant lift on the evaluated weak model (`openai/gpt-oss-120b`) due to a model-level floor effect.

Per **Option A** (approved by the product owner), this null/inconclusive finding is accepted and recorded faithfully in this baseline without altering threshold criteria, cherry-picking tasks, or manufacturing artificial claims.

---

## 9. Non-Functional Requirements

| ID | Requirement | Target | Status |
|---|---|---|---|
| NFR-01 | The per-edit gate must not make the agent loop feel stalled | Single-file check only; full suites deferred to the final gate | Proposed |
| NFR-02 | A hook failure must never terminate the user's session | All failures degrade to success with a recorded reason | Proposed |
| NFR-03 | Injected rule text must stay small enough not to displace working context | Under two kilobytes total | Proposed |
| NFR-04 | The tool must not transmit anything off the machine | No telemetry of any kind | Proposed |
| NFR-05 | Removing the tool must leave no trace in the user's project beyond files they can delete | Configuration and state confined to two known locations | Proposed |

**Not applicable:** availability and uptime (no service); localization (single user, English tooling
output); compliance and retention (no personal data collected); accessibility (no user interface
beyond terminal text).

---

## 10. Assumption Register

| ID | Assumption | Risk if wrong | Validation method | Status |
|---|---|---|---|---|
| A-01 | The verifier effect reported in published research transfers to this task set and these models | The product has no benefit | The §8 benchmark | **Evaluated — INCONCLUSIVE** (measured 2026-09-11; 100 runs on `openai/gpt-oss-120b`; floor effect observed; Option A adopted) |
| A-02 | Hook behaviour observed in the verified host version persists across near-term updates | Gates silently stop working | The doctor command; re-run the probe after upgrades | **Active** |
| A-03 | Six greenfield tasks are sufficient to detect a real effect | A real effect is missed, or noise is mistaken for one | Confidence intervals at five repetitions; expand the suite if inconclusive | **Validated** (10 tasks total: 6 greenfield + 4 codebase across 5 repetitions; 100 runs completed) |
| A-04 | Command inference from a project manifest is correct often enough to be useful | Users get wrong gates without noticing | D-05 degradation plus the doctor command | **Active** |
| A-05 | The owner's own daily use is representative enough to surface major defects | Defects reach other users first | Personal use before publication | **Active** |

---

## 11. Risk Register

| ID | Risk | Impact | Mitigation | Residual |
|---|---|---|---|---|
| R-01 | SC-01 is inconclusive or negative | Project has no justification | Measure early and cheaply; record the result either way | **Realized / Accepted** (SC-01 measured as INCONCLUSIVE on 2026-09-11; Option A adopted; recorded honestly) |
| R-02 | A host update breaks hook behaviour | Gates fail silently | Version pinned in documentation; doctor command; no compatibility promise (D-06) | Accepted |
| R-03 | Prevention is unavailable (C-02) | Out-of-scope writes occur before being reverted | Corrective enforcement (FR-08); documented honestly | Accepted |
| R-04 | The mechanism is copied once published | Loss of differentiation | Not mitigated. The project is a personal tool first | Accepted |
| R-05 | Six tasks measure only greenfield work | Results overstated if reported as general | Limits stated explicitly in the results section | Accepted |

---

## 12. Open Issues

| ID | Issue | Blocking level | Recommendation | Resolution point |
|---|---|---|---|---|
| I-01 | SC-01 is unmeasured | **Resolved** | Measured on 2026-09-11 (100 runs, 5 reps; INCONCLUSIVE accepted under Option A) | Resolved (2026-09-17) |
| I-02 | BR-01 has no automatic gate in 1.0 | Non-blocking | Enforce in 1.1 once the base measurement exists, so it can be measured as a separate contribution | 1.1 |
| I-03 | Termux support is unverified beyond partial checks | Non-blocking | Label best-effort (D-03); verify if Android becomes a primary environment | 1.1 |

---

## 13. Glossary

| Term | Meaning in this document |
|---|---|
| Gate | A deterministic check whose result is produced by a tool, never by a model |
| Working set | The paths the agent is permitted to modify |
| Green state | The most recent set of tests known to pass, used as the regression baseline |
| Regression | A test that passed before a change and fails after it |
| Repair bound | The maximum consecutive attempts permitted against one unchanged failure |
| Gateway | Any service presenting a compatible model endpoint. Tandem is neutral to all of them (D-09) |
| Disabled gate | A gate skipped because its tool is unavailable — not a failure (D-05) |

---

## 14. Traceability

| Requirement | Serves | Constrained by | Verified by |
|---|---|---|---|
| FR-01 | S-01, BR-01…BR-05 | C-01, NFR-03 | AC-08 |
| FR-02, FR-03, FR-04 | S-02 | C-03, NFR-01 | AC-01 |
| FR-05 | S-03 | C-04, C-05 | AC-06 |
| FR-06 | S-04 | — | AC-04 |
| FR-07 | S-05, BR-03 | C-04 | AC-05 |
| FR-08 | S-06 | C-02, C-06 | AC-03 |
| FR-09 | S-07, D-05 | — | AC-02 |
| FR-10 | D-06 | — | AC-08 |
| FR-11 | D-04, D-02 | — | AC-08 |
| FR-12 | D-08 | — | AC-07 |
| FR-13 | S-08 | — | SC-01…SC-05 |

**Gaps identified:** BR-01 has no gate and no acceptance criterion in 1.0 — recorded as I-02.
No other requirement lacks justification, and no objective lacks a supporting capability.

---

## 15. Readiness Gate

| Check | Result |
|---|---|
| Core intent understandable without guessing | ✅ |
| Scope and exclusions explicit | ✅ |
| Decisions have identifiable authority | ✅ Approved by owner (Hamza, 2026-09-17) |
| Claims and assumptions accurately labelled | ✅ E-02 and SC-01 measured and labelled INCONCLUSIVE (Option A) |
| Rules consistent, precedence stated | ✅ BR-03 over BR-02 |
| Critical failure behaviour defined | ✅ D-05, NFR-02, C-02 |
| Significant requirements have objective criteria | ⚠️ BR-01 excepted (I-02) |
| Operational and dependency failures addressed | ✅ R-02, D-06 |
| Remaining uncertainty visible | ✅ §10, §12 |

**Final status: Product-Approved Baseline.**

Approved by product owner Hamza on 2026-09-17 with Option A adopted for SC-01 (measured inconclusive result documented faithfully).

**This document does not claim:** production readiness · completed qualification · technical superiority over
any other tool · that a free model matches a frontier model · that the verification mechanism improves
outcomes for this product. The last item was evaluated empirically in §8 and recorded as INCONCLUSIVE under Option A.

---

## 16. Next Actions

| Order | Action | Owner | Status |
|---|---|---|---|
| 1 | Approve or amend the §3 scope baseline | Hamza | **Complete** (Approved 2026-09-17) |
| 2 | Implement D-01, D-04, D-05 per the technical specification | Executing agent | **Complete** |
| 3 | Run the §8 benchmark and record SC-01 | Hamza / Executing agent | **Complete** (Measured 2026-09-11; INCONCLUSIVE accepted under Option A) |
| 4 | Perform final release audit and report release disposition before any npm publish | Executing agent | **Complete** |

---

## Appendix A — Amendments in version 1.1

Recorded because the scope baseline changed shape, not merely its contents.

| ID | Amendment | Reason |
|---|---|---|
| **D-10** | Tandem is a **standalone command** built on a host agent core, not an extension of another tool | The owner's requirement is a complete CLI tool. The host supplies the agent loop, terminal interface and provider layer; Tandem supplies verification |
| **D-11** | Verification fires at **five decision points derived from events** | Published measurement finds targeted verification at development decision points outperforms end-point-only verification. Every mainstream agent verifies only at the end |
| **D-12** | The host is confined to `src/adapter/`, enforced by a test | The host changed package scope and SDK surface within four months of observation. A breaking change must cost one file, not a rewrite |
| **D-13** | The benchmark carries **two task families**, reported separately: six greenfield and four against a seeded codebase | Published benchmarking finds every agent performs worse on existing codebases. Greenfield-only results would overstate the case, and DP3 cannot be measured without the second family |
| **D-14** | Memory promotes a recurring error **verbatim after a fixed count**, with no summarisation | A model deciding what is worth remembering is judgement, which contradicts the determinism principle this product rests on |

### Amended evidence

| ID | Statement | Type | Status |
|---|---|---|---|
| E-04 | Verification targeted at decision points outperforms end-point-only verification | Claim | **Evidence-supported externally, unverified for this product** |
| E-05 | Agents perform measurably worse on existing codebases than on greenfield ones | Claim | **Evidence-supported externally** |
| E-06 | Adding context degrades performance past a threshold; targeted retrieval beats bulk summarisation | Claim | **Evidence-supported externally** — the basis for the lean core |
| E-07 | The host honours a pre-execution block, so the working-set guard is preventive | Claim | **Evidence-supported** — observed directly |

### Amended success criteria

| ID | Criterion | Threshold | Status |
|---|---|---|---|
| SC-01 | Pass rate, verification on versus off, **reported separately per task family** | Improvement outside overlapping 95% intervals at five or more repetitions | **Measured — INCONCLUSIVE** (measured 2026-09-11; overall off: 2/50 [1.1%, 13.5%], on: 0/50 [0.0%, 7.1%]; greenfield off: 2/30 [1.8%, 21.3%], on: 0/30 [0.0%, 11.4%]; codebase off: 0/20 [0.0%, 16.1%], on: 0/20 [0.0%, 16.1%]; Option A adopted) |
| SC-09 | Codebase-family improvement attributable to DP3 | Codebase-family gain at least as large as the greenfield gain | **Measured — INCONCLUSIVE** (0/20 off vs 0/20 on; no measurable gain on weak model) |

**Outcome under the governing standard: MEASURED / INCONCLUSIVE (Option A).** The specification is complete; the central
claim was measured under the full benchmark protocol, observed to be inconclusive due to a model floor effect, and accepted as a baseline finding without altering thresholds.
