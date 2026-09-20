# GATE-0 AUDIT + QUALIFICATION — TANDEM

**Against:** `TANDEM_MASTER_EXECUTION_PRD_V1.md` (v1.0) — the authoritative implementation contract.
**Date:** 2026-09-14 · **Mode:** Audit + Qualification only (no implementation).
**Authority hierarchy (`§1`):** V4 is the stated product authority but **was not supplied**; only the
Master PRD is present. V1_PROMPT and COMPLETE_EXECUTION_PLAN are likewise absent. See §B.
**PRD section cited as [S-x] / [P-x] / [T-x] / [INV-x] / [IB-x] throughout.**

> This replaces the earlier `GATE0-AUDIT.md` draft written before the Master PRD was present. The
> prior draft concluded "document absent" and is void as a qualification.

---

## A. Repo facts used as E0 evidence (verified from the actual checkout)

| Fact | Observed value |
|---|---|
| Revision / commit | `afa46cd` (`docs: credit the host agent`); tag `tandem 0.1.0`; branch `main` |
| Language / modules | CommonJS core (`.cjs`) + ESM adapter (`.mjs`); `"type":"commonjs"`; Node >= 22 (host has node v26.4.0) |
| Package manager | npm; single `package-lock.json`; **no `dependencies`/`devDependencies`**, only `peerDependencies: @earendil-works/pi-agent-core ^0.85.1` |
| Installed deps | **`node_modules/` absent** — the peer host is not installed; `@earendil-works/pi-ai` is imported optionally |
| CLI (`bin/tandem.cjs`) | `init`, `doctor`, `run`, `bench`, `--version`. **`check`, `status`, `evidence` do not exist** |
| Stored state | `.tandem/state.json` (flat JSON): greenTests, lastFailureKey, repairCount, seenImports, disabled, gates, errorCounts, memory, graphStamp |
| Agent interface | `@earendil-works/pi-agent-core` `Agent` with `beforeToolCall/afterToolCall/shouldStopAfterTurn` (pinned 0.85.1 in comments) |
| Live-run route | `src/adapter/run.mjs` constructs `Agent`, forwards `TANDEM_API_KEY`, `TANDEM_BASE_URL`, `TANDEM_API`, `TANDEM_PROVIDER` to the host |
| Containment (OS) | **None.** No namespaces, cgroup, mount restrictions, IPC denial, credential isolation, or fencing in `src/`. Live probe `command -v unshare bwrap cgcreate nsenter` → **all four missing** (`CONTAINMENT_MISSING`), so no standard containment primitive is available on this host; no containment profile is established |
| Test suite (on-host) | `npm test` → **110 passed, 1 failed** (the failure: `doctor` expects host package installed; `node_modules` absent here — environmental, not a logic defect) |
| Benchmark harness | `bench/run.cjs`, `bench/stats.cjs`, `bench/preflight.cjs`, `bench/tasks/` (10 tasks; 6 greenfield, 4 codebase; TypeScript + vitest fixtures); `bench-results/` empty/gitignored |
| Documentation claims | `README.md`, `VERIFIED.md`, `SMOKE.md`, `FINISH.md` record prior live runs (Groq gpt-oss-120b) and old-suite counts. These are repository documentation, **not** qualification evidence under this contract |

**G0 caveat recorded:** the suite result above was obtained by executing the repository's own tests
on this host. Under `[S-§25]` the Gate-0 procedure requires an isolated qualified feasibility
environment *before* executing baseline scripts, and `[§25]` forbids treating on-host repository-test
execution as qualification. The numbers are therefore recorded as *facts about the current checkout*,
not as gate evidence, and must be re-established in an isolated environment.

---

## B. Authority status (Gate-0 prerequisite 1)

- `TANDEM_MASTER_EXECUTION_PRD_V1.md` — **present**, complete (§1–33).
- `TANDEM_FINAL_PRODUCT_SPECIFICATION_V4.md` — **absent.** It "controls product meaning, architecture
  constraints, safety, scope, acceptance, and release requirements" `[§1]`. Its exact section text is
  referenced throughout `§28` (R-01…R-49). The audit proceeds on the Master PRD's own self-contained
  contract; **R-row bindings to V4 section text are recorded as `UNRESOLVED` pending V4**.
- `TANDEM_MASTER_EXECUTION_PRD_V1_PROMPT.md`, `TANDEM_COMPLETE_EXECUTION_PLAN.md` — **absent.**
  Recorded as provenance/completeness inputs; absence does not block the audit itself but must be
  noted in the support record.

---

## C. Capability classification (Gate-0 ordered work 1–2)

Classification per `§26`: `IMPLEMENTED`, `PARTIALLY_IMPLEMENTED`, `CONCEPTUAL_ONLY`, `BROKEN`,
`UNVERIFIED`, `OUT_OF_SCOPE`, each with evidence.

| PRD logical owner `[§4]` | Actual binding in this repo | Classification |
|---|---|---|
| `CTRL` — supervisor, next-decision owner | `src/index.cjs` `Tandem` (host-independent event handler; does rule injection, DP1–DP5 gating, repair-bound stop). No policy document, no ownership/admission, no serialized gate, no reducer | **CONCEPTUAL_ONLY / PARTIALLY** — the synonym is misleading; do not confuse with the contract's supervisor |
| `STATE` — one durable transactional authority, ledger | `src/core/state.cjs` → flat `.tandem/state.json`; no transaction, lock, epoch, reservation, schema validation, or fail-closed decoding (`load()` returns `empty()` on parse failure — conflicts with `[§6]` fail-closed) | **BROKEN for the contract** (see D-4) |
| `EXEC` — effect boundary | `src/gates/run.cjs` (`spawnSync`, `shell:true`, Termux LD_PRELOAD), `src/adapter/tools.mjs` (`resolveIn`, working-set guard). No OS containment, limits, fencing, drain, cancellation, or descendant control | **CONCEPTUAL_ONLY** (cwd checks only; not an effect boundary) |
| `ADAPTER` — thin one-agent bridge without authority | `src/adapter/*.mjs`; grants the agent `read/write/edit/bash` and forwards credentials to the host. Ambiguity: repo drives the agent loop itself rather than supervising an external agent, and Pi is treated as its foundation | **PARTIALLY / CONFLICT** (see D-1, D-10) |
| `CONTENT` — immutable source capture, freeze, publish | absent. No git/object capture, manifest, freeze, retention, or physical independence | **UNVERIFIED / absent** |
| `VERIFY` — obligation coverage, predicates, protected observer, native recipe | `src/gates/{detect,run,parse,repair}.cjs` + decision-point engine: typecheck/test/lint gates on the **live** project; no inventory, obligation compiler, predicate set, protected observer, direct-source derivation, or evidence applicability | **CONCEPTUAL_ONLY** for the required semantics; the parsing/cap/dedupe helpers are reusable (see E) |
| `UX` — run/check/status/evidence | `bin/tandem.cjs`: `run/doctor/init/bench/version`. The four required roles `[§22]` are not met; `init` is a disallowed install-type command; `doctor`/`bench` are broad | **PARTIAL** with **conflicts** (D-5) |

Repo-internal capabilities against `§2` MVP exclusions:

| Repo capability | Contract status |
|---|---|
| Per-edit type-check at five "decision points" + injected rule text | Superseded mechanism. `§2` requires obligation-led verification against a frozen generation via protected witnesses and a qualified full native recipe. Not the MVP verification. **DEFER/REMOVE from active path** |
| Working-set "preventive guard" (block before writing outside `workingSet`) | Claim without qualified transitive closure `[INV-18]` → preventive claim is **UNVERIFIED** under this contract |
| Deterministic memory promotion (`errorCounts`/`memory`) | Conflicts with `§2` exclusion "Learned cross-session policy, external memory infrastructure" and is listed POST-MVP `[§29]`. **REMOVE/DEFER** |
| Skills + slash-commands discovery/loading (`.tandem/skills`, `.tandem/commands`) | Conflicts with `§2` exclusion "Arbitrary plugin, extension, skill, or MCP discovery and execution." **REMOVE/DEFER** |
| Silent degradation (missing tool → exit 0, note once) | Conflicts with `§2`/`T-*`: excluded capabilities require **refusal or physical-unreachability evidence**, not silent skip. **Converts to containment/refusal requirement** |
| `maxRepairs = 2` | Conflicts with `§18`: MVP ceiling is **zero or one** authorized repair. **Hard conflict** |
| `tandem init` writing `.tandem/`, `TANDEM.md`, possibly `tandem.json` into the project | **Incumbent modification** (prohibited `§2`) |
| Groq key rotation benchmark (`TANDEM_API_KEYS`) + evaluation results in README | Evaluation harness — POST/Gate-3 material; must not be reused as value evidence without the frozen protocol `[§23]` |

---

## D. Principle-by-principle reconciliation and conflicts (requested item 4)

| # | Master PRD requirement `[S-]` | Current repo behaviour | Disposition |
|---|---|---|---|
| D-1 | TANDEM is a **supervisory layer above a coding agent**; not an independent agent, no replacement runtime `[§2]` | Repo: "standalone CLI coding agent built on Pi"; composes Pi's `Agent`, drives `prompt()` itself; Pi pinned as peer dependency | **CONFLICT** — product definition differs |
| D-2 | Pi is "neither mandatory nor automatically qualified" `[§1]` | Repo is architecturally Pi-bound (`src/adapter/` enforces it) | **CONFLICT** — must treat Pi as unqualified until a support profile quals it |
| D-3 | **No automatic incumbent modification**; candidate-only execution; delivery without touching user's tree `[§2],[§11],[§20]` | `tandem run`'s tools write into the live project; `init` inserts files; no candidate/freeze | **CONFLICT** — direct incumbent mutation |
| D-4 | Durable **transactional** store; fail closed on malformed/unknown `[§6]` | Flat JSON; parse failure → empty-state fallback | **CONFLICT** (fail-open decode) |
| D-5 | Command surface = `run`/`check`/`status`/`evidence`; `tandem check` spelling mandatory; no install/ship commands `[§22]` | `run/doctor/init/bench`; no `check`/`status`/`evidence` | **CONFLICT** — required surface missing; `init` disallowed |
| D-6 | Repair ceiling zero **or one** `[§18]` | `maxRepairs` default `2`, configurable | **CONFLICT** |
| D-7 | Excluded capabilities need refusal/unreachability evidence `[T-*],[§2]` | Missing tools silently skipped | **CONFLICT** with D-05-style silent skip |
| D-8 | Verification against **frozen generation** via protected observer + full native recipe + direct-source derivation `[§16]` | Per-edit live typecheck at "decision points" | **CONFLICT** — different verification model (supersedes old design) |
| D-9 | No learned cross-session policy / external memory; skills/plugins not auto-discovered `[§2]` | Cross-session memory promotion + lazy skill/command injection | **CONFLICT** |
| D-10 | Thin adapter "without granting authority" `[§4]`; no whole-session unrestricted execution `[§25]` | Agent gets `read/write/edit/bash` with only path-scope checks, plus credentials forwarded | **CONFLICT** — grant semantics too broad |
| D-11 | `tandem check` must be honest non-executing; must not claim it prevented historical actions `[§22]` | No `check` exists; `doctor` executes tool-detection probes and prints "hooks active" | **GAP** |
| D-12 | Evaluation: frozen protocol, predeclared numeric thresholds, uncertainty rules predate results; no post-result tuning `[§23]` | README records a measured INCONCLUSIVE result, but no registered protocol/thresholds; old benchmark post-hoc defines verdict | **CONFLICT / GAP** — no frozen protocol |

**Summary:** the repo implements a different, older product (an integrated verification agent).
It is not a partial implementation of this contract; it is a **renamable predecessor** whose
capabilities mostly **conflict with or fall outside** the required supervisory MVP.

---

## E. Reuse / replace / retire map (requested item 8)

Classification vocabulary from `§26`. "REPLACE/REMOVE" here is the *audit verdict*; per `§25` no
production change happens until Gate 0 passes and the code is re-inspected in an isolated env.

| Existing | Class | Justification |
|---|---|---|
| `.cjs` core / `.mjs` adapter split; language/module system | **KEEP** | "Preserve the existing language/module system when it demonstrably works" `[§26]` |
| `src/gates/parse.cjs` (tsc/vitest parse, dedupe, cap, order) | **MODIFY (DEFER to first-slice)** | Reusable helpers inside a future qualified native-recipe runner; out of the JS-first slice |
| `src/core/config.cjs` — globs, `inWorkingSet`, defaults | **MODIFY** | Path/scope logic reusable as envelope tooling; schema must change to policy/budget/envelope |
| `src/core/state.cjs` + `.tandem/state.json` | **REPLACE** | Cannot serve as transactional authority store; fail-open decode. The `errorCounts`/`memory` subset: **REMOVE** (learned policy) |
| `src/core/decision-points.cjs`, `rules.cjs` | **DEFER->REMOVE from active path** | Superseded verification model; rule-text injection is a prompt, not control |
| `src/context/project.cjs` (skills/commands) | **REMOVE/DEFER** | Plugin/skill discovery excluded `[§2]`; listed POST-MVP `[§29]` |
| `src/context/depgraph.cjs` | **DEFER/REMOVE** | "Selective impact" mechanisms cannot establish acceptance `[§15]`; the PRD requires full native recipe or unresolved obligations |
| `src/gates/repair.cjs` | **REPLACE semantics** | Bounded-repair idea retained, but must become generation-based, one-repair, evidence-linked `[§18]` |
| `src/gates/detect.cjs`, `src/gates/run.cjs` (tool detect/exec) | **DEFER** | Old gate model; exec plumbing (Termux LD_PRELOAD) is env-specific and not part of the MVP profile |
| `src/adapter/` (pi-agent-core) | **CONDITIONAL / REPLACE semantics** | Candidate integration only if a support profile quals it; must be thin and admission-guarded, not whole-session grant `[§4],[§25]` |
| `src/adapter/tools.mjs` `resolveIn` + tool error conventions | **WRAP/MODIFY** | Path-scope/resolve logic reusable behind the future `EXEC` boundary |
| `bin/tandem.cjs` dispatcher | **MODIFY** | Keep entrypoint; replace command set (`run/check/status/evidence`), drop `init`, re-scope `doctor` to dev-only, gate `bench` as dev harness |
| `bench/run.cjs` + `stats.cjs` | **DEFER / REWRITE** | Wilson-interval methodology is reusable; protocol must be the frozen `§23` one; old tasks are not the first-slice fixture |
| `bench/tasks/*` | **DEFER** | Not the Master PRD first slice (which is one JS CLI behavior change; JSON-record example "not a fully specified fixture" `[§2]`) |
| `test/run.cjs` (dependency-free runner) | **KEEP** runner style; **MODIFY** suite | Tests are old-contract logic tests; new T-*/F-* suites required |
| `README.md`, `VERIFIED.md`, `SMOKE.md`, `FINISH.md` | **DOCUMENTATION ONLY** | Records/claims; not qualification evidence; must be re-labelled under new contract |

---

## F. IB-01…IB-04 status (requested item 5)

Per `§33`, these are genuine unresolved bindings the executor MUST NOT resolve by guessing. Status:
**all four remain OPEN.** Their resolution authorities are external to the executor.

| ID | Unresolved binding | In this repo | Status |
|---|---|---|---|
| **IB-01** | No actual qualified Linux/runtime/storage/agent/inference support profile | No support record exists; host is Termux on Android 14 (kernel 6.1.145-android14) and a live probe shows **no** `unshare`/`bwrap`/`cgcreate`/`nsenter` — no containment/fencing profile is establishable on this host with standard primitives; node_modules empty; `doctor` test fails without host dep | **OPEN — profile-dependent commitments, executable qualification claims, and supervised admission are blocked.** If external inference is chosen, recipient/purpose/data/credential authorization is additionally unestablished `[§33]` |
| **IB-02** | Exact first-slice repository/commit, CLI behavior, cases, expected observations, change scope, native full-suite scope, baseline-failure treatment undefined | Repo has a *different*, TS-based old benchmark; no first-slice fixture (the PRD explicitly says the JSON-record CLI example is not fully specified `[§2]`) | **OPEN — first-slice mutation, predicate binding, acceptance, and end-to-end verification are blocked pending owner-defined fixture** |
| **IB-03** | Numeric resource ceilings, per-action maximums, deadlines, mandatory reserves unpopulated | No budget ledger; no ceilings anywhere | **OPEN — any action whose exposure or completion capacity cannot be bounded is blocked** |
| **IB-04** | Versioned paired distribution, sample/reps, primary metric, numeric benefit/overhead thresholds, rubric, uncertainty rule not instantiated | Old benchmark has neither a frozen protocol nor predeclared numeric gates `[§23]` | **OPEN — Gate 3 and superiority claims blocked; protocol must be frozen before any paired value results** |

The separate "current-code input dependency" `[§33]` (attachments never provided the checkout) is
**resolved by inspection** — this audit operates on the actual repository. That is the only one of the
listed bindings that the audit itself closes.

---

## G. Invariants and adversarial tests (requested item 9)

**V4 invariants `[§27]`: INV-01 … INV-25 — all currently UNSUPPORTED.** None has an actual binding,
adversarial test, or evidence in this repo. Several have deceptive near-matches that do NOT satisfy
the contract:

| Invariant | Apparent match | Actual status |
|---|---|---|
| `INV-18` preventive claims need transitive closure | README "preventive working-set guard" | **Claim exceeds proof** — no closure/fail-closed |
| `INV-12` actual source/derivation | gates run against the project | Not immutable, not direct-source, no closed resolution |
| `INV-15` conservative reservation before dispatch | none | Absent |
| `INV-17` authorized disclosure | "no provider env var" test (D-09) | Different concern; no visibility/payload boundary |
| `INV-22` efficiency never overrides safety | repair bound + regression block | Different decision semantics; not the reducer |
| All others (INV-01…11, 13…16, 19…21, 23…25) | — | Absent |

**Adversarial contract tests `[§24]`: T-01 … T-14 — all UNSUPPORTED** (specifically, of the user's
named set, T-01 Current Admission, T-02 Transitive Containment, T-03 Exclusive Ownership,
T-04 Candidate Safety, T-05 Total Predicates, T-06 Oracle Control, T-07 Derivation Coverage,
T-08 Hard Resources, T-09 Disclosure — **and** T-10…T-14 — none exist). The repo's `test/run.cjs`
assertions are "mocks and synthetic state tests" which `§24` explicitly says "do not qualify real
containment, durability, egress, or fencing." Functional families F-01…F-08 are likewise absent.

---

## H. Smallest implementation sequence required next (requested item 7)

**No production implementation may begin: Gate 0 has not passed and IB-01…IB-04 block it.** Under
`§25`, allowed until Gate-0 exit is limited to *bounded feasibility/probe code* and read-only audit.
The ordered sequence to lawfully reach a first implementation:

1. **Close authority gap** — obtain V4, V1_PROMPT, COMPLETE_EXECUTION_PLAN (or record their absence
   and proceed on the Master PRD's self-contained contract as this audit does).
2. **Establish an isolated qualified feasibility environment** (Linux host with real containment —
   namespaces/cgroups/IPC denial) — the probe confirms the current host is Termux/Android with
   **none** of the standard containment primitives (`unshare`/`bwrap`/`cgcreate`/`nsenter` all
   missing), so it is **not** a Gate-0-qualified profile; quarantine the repo on a capable host and
   re-run the suite to get non-self-qualifying baseline facts, or explicitly record `CHECKER_ONLY[§30]`.
3. **Run the applicable feasibility probes** `[§25]`: T-02, T-03, T-04, T-07, T-08, T-09 and F-05
   portions against the pinned runtime; record pass/fail/unknown raw evidence.
4. **IB-01 closure (each)** — populate and approve a concrete support record (identity/host/runtime/
   storage/agent/inference/source/task/verification/derivation/resources/disclosure/credentials/
   recovery/qualification) `[§5]`.
5. **IB-02 closure** — task/page owner selects repo+commit, defines the first-slice JS CLI task
   fixture, case set, expected bytes/exit codes/diagnostics, change scope, qualified full native
   recipe, and baseline-failure treatment — all fixed before any candidate execution `[§2][§33]`.
6. **IB-03 closure** — authenticated user/qualification owner populates ceilings, per-action maximums,
   deadlines, and mandatory reserve calculations `[§12]`.
7. **IB-04 closure** — register the frozen versioned paired-evaluation protocol (distribution, sample
   size, repetitions, primary metric, numeric meaningful-benefit and maximum-overhead thresholds,
   rubric, uncertainty decision rule) before any paired result `[§23]`.
8. **Emit Gate-0 deliverables** — support record, code map (this audit is the draft), source shape,
   task fixture, budget policy, qualification assumptions, evaluation protocol — and reach the
   Gate-0 exit criteria `[§25]`.
9. **Only then, Gate 1 ordered work** begins with its first units: durable store + canonical owner
   lock + epoch allocation; closed-by-default/recovery-only startup; task/incarnation/policy/action/
   resource records; restrictive policy composition; shared serialized `admitAndRelease`; one-use
   consumption + conservative reservation + expiry recheck + replay refusal; qualified runtime
   bindings with min close/drain/fence; containment enforcement; immutable source capture and
   physically independent candidates; thin authority-less adapter; eligible-result commit checks —
   then the Gate-1 adversarial batch (T-01..T-04 + selected T-08/T-09/T-12/F-07/F-08) `[§25]`.

---

## I. What must NOT be implemented yet (requested item 10)

Per `§25`,`§29`,`§31`,`§33` and basis rules:

1. **Not** start Gate 1/2/3 production work while Gate 0 is unclosed and IB-01…IB-04 are open.
2. **Not** resolve IB-01…IB-04 by guessing — closure evidence must come from their named authorities.
3. **Not** redesign Tandem as an independent agent, expand the MVP, or weaken any guarantee `[§1]`.
4. **Not** assume Pi (or any runtime/agent/provider) is qualified; no "assumed Pi qualification" `[§25]`.
5. **Not** treat the old decision-point/skill/memory/gate machinery as acceptable for the MVP —
   those capabilities collide with `§2` exclusions and must be disabled with refusal/unreachability
   evidence, **not** "silently skipped".
6. **Not** modify the incumbent: no writing into the user's project (`init`-style), no staging/commit/
   stash/push/amend/rollback, no automatic install or live apply `[§2]`.
7. **Not** enable external inference transport — TANDEM_API_KEY/BASE_URL usage is an unqualified model
   transport until IB-01+IB-03 with external authorization `[§2],[§5],[§33]`.
8. **Not** invent the first-slice CLI fixture, expected bytes, exit codes, or diagnostics (IB-02).
9. **Not** implement any POST-MVP capability: second adapter/provider, routing, parallel/multi-agent,
   MCP/plugins/skills, mutation simplification, live install/rollback, broad builds/caches, browser/
   UI verification, analyzer stacks, observability platform, precision impact graphs, generalized
   predicate language, second-LLM oracle, deterministic memory retrieval, distributed/offline `[§29]`.
10. **Not** adjust any benchmark thresholds after results or claim Gate 3/§23 superiority `[§23]`.
11. **Not** perform a rewrite-first migration; inspect before replacing; document reuse evidence `[§26]`.
12. **Not** enable any capability merely because its code exists in this repo `[§29]`.

---

## J. Gate-0 exit criteria adjudication (requested item 6)

| Exit criterion `[§25]` | Result |
|---|---|
| Baseline + highest-risk gaps reproducible/characterised | **PARTIAL** — on-host run 110/1 recorded; not isolated; host dep absent |
| One concrete support profile w/ feasibility evidence for every reachable boundary | **NO** — none exists |
| Source/verification/input assumptions + hard resource dimensions populated | **NO** — IB-02, IB-03 open |
| No unresolved issue prevents authority/candidate-safety implementation | **NO** — IB-01 open |
| Actual code/test locations mapped or absence established | **PARTIAL** — this audit is a first map; not yet bound in a qualified env |
| First-slice contract independent of candidate output | **NO** — IB-02 open |
| No supervision/release claim exceeds probe evidence | **NO** — repo claims (preventive guard, measured benchmark) exceed probe evidence |

### Verdict

**Gate 0 has NOT passed. The repository may NOT enter Gate 1.** Consistent with `§25`: *"A failed
probe leaves supervised execution unavailable. Checker-only is the valid supported outcome until the
blocker is resolved."* The lawful supported state for this repo, as audited, is **no supervised
execution** (checker/observer mode or none) until IB-01…IB-04 are closed by their authorities and a
concrete Linux support profile is qualified with feasibility evidence.

---

## K. Answers to the requested report items

1. **Already reusable:** `.cjs`/`.mjs` module conventions; low-level parse/dedupe/cap/sort helpers;
   glob/working-set path-scope logic; `resolveIn` + tool error conventions; dependency-free test
   runner style; Wilson-interval statistics methodology; bounded-repair/regression concepts
   (semantics to be reshaped). Each must be re-validated inside the new contracts (see §E).
2. **Missing (non-exhaustive):** the supervisory architecture itself — durable transactional store,
   lock + epochs, admission/grants/reservations ledger, OS-level containment, immutable source
   capture + freeze + immutable delivery + manifest + retention, acceptance inventory/contract/
   obligation compiler + the three predicate families, protected external observer, qualified full
   native recipe with direct-source derivation, evidence applicability, universal finalization +
   quarantine/fencing, `run/check/status/evidence` CLI, support record, budget policy, frozen
   paired-evaluation protocol, and the entire T-01…T-14 / F-01…F-08 / INV-01…INV-25 test matrix.
3. **Gate-0 blockers:** IB-01…IB-04 (all open; authorities external); absent V4/V1_PROMPT/
   COMPLETE_EXECUTION_PLAN authorities; no qualified Linux feasibility environment on this host
   (Termux/Android, no containment established); host peer dependency not installed
   (`node_modules/` absent → not reproducible on-host); incumbent-mutation paths (`run`/`init`/tools)
   that must be removed with refusal evidence; old verification/memory/skill machinery that collides
   with `§2` exclusions.
4. **May implementation proceed to Gate 1?** **NO.** Not until Gate 0 passes with a qualified profile
   and IB-01…IB-04 are resolved. Only bounded feasibility/probe work and read-only audit are lawful
   now. This report performed the audit portion; it implemented nothing and modified no source.

---

## L. Working-tree state

Untracked additions only: `TANDEM_MASTER_EXECUTION_PRD_V1.md` (the supplied contract) and this report
`docs/GATE0-AUDIT.md`. `src/` untouched; no product code created or rewritten.