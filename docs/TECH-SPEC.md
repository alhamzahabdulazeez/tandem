# TANDEM — Technical Specification

> **SUPERSEDED — historical only, kept for the decision trail.**
> This document specifies the *original* design: Tandem as a set of Claude Code hooks
> (`PreToolUse`/`PostToolUse`/`Stop`, `.claude/settings.json`, package `tandem-hooks`,
> `lib/cli.cjs`). That design was replaced by D-10 in `PRD.md` v1.1 (Appendix A): Tandem
> is a **standalone CLI built on a host agent core**
> (`@earendil-works/pi-agent-core`), not a Claude Code hook set. None of the package
> layout, hook dispatcher, or `.claude/settings.json` described below exists in this
> repository. For the actual architecture, read `AGENTS.md`, `VERIFIED.md`, and
> `PRD.md` (especially Appendix A). Sections 3, 4, 5.4 and 8 describe mechanisms
> (config keys, gate detection, the repair bound, the benchmark shape) that carried
> over conceptually into the current implementation under `src/` and `bench/` — those
> are illustrative of intent, not a description of any file that exists today.

**Companion to `PRD.md` v1.0.** The PRD states intent; this document states implementation.
Where they disagree, the PRD wins on *what*, this document wins on *how*.

**Reader:** an AI coding agent implementing Tandem. Execute §7 in order. Do not ask questions.

---

## 0. Rules for the executing agent

1. Implement exactly what is written. Do not invent requirements.
2. Do not substitute a package or version. If one cannot be resolved, **STOP** and report `BLOCKED`.
3. Do not add files, commands, or configuration keys not listed here.
4. Do not refactor outside the current task.
5. Do not skip, merge, or reorder tasks.
6. Do not modify or delete a test to make it pass.
7. **If a task fails twice, stop and report.** Do not attempt a third approach.
8. Never name a gateway in code. See D-09.
9. Every hook writes diagnostics to **stderr only**. stdout is a structured channel.
10. After each task, report: task id, files touched, acceptance command, final output line.

---

## 1. Verified host protocol

Observed on Claude Code 2.1.267. **Do not assume behaviour beyond this table.**

| Hook | Fires | Exit 0 | Exit 2 | Notes |
|---|---|---|---|---|
| `SessionStart` | Session begins | continue | — | **stdout** is injected as context |
| `PreToolUse` | Before a tool call | allow | **does not reliably block** | Not wired in 1.0 (C-02) |
| `PostToolUse` | After a tool call | continue | **stderr reaches the model next turn**; cannot undo | The core mechanism |
| `Stop` | Model finishes | end turn | **forces continuation** | Bounded to ~9 consecutive blocks by the host |

**Critical:** the `Stop` hook receives `stop_hook_active` in its input. When true, it **must** exit 0
or the turn loops until the host overrides it.

**Input:** each hook receives JSON on stdin. Fields observed: `cwd`, `hook_event_name`, `session_id`,
`tool_name`, `tool_input.file_path`, `stop_hook_active`, `permission_mode`, `model`, `transcript_path`.

---

## 2. Package layout

```
tandem-hooks/
├── package.json          bin: tandem
├── README.md  LICENSE  .gitignore
├── bin/tandem.cjs        CLI: init | doctor | bench
├── lib/
│   ├── cli.cjs           hook dispatcher: session-start | post-tool | stop
│   ├── config.cjs        load tandem.json, infer, detect tools
│   ├── parse.cjs         structured error parsing  (exists, tested)
│   ├── state.cjs         green state, repair counter (exists, tested)
│   ├── rules.cjs         the five rule texts        (exists, tested)
│   └── detect.cjs        NEW — tool availability (D-05)
├── hooks/settings.json   hook wiring template
├── bench/
│   ├── run.cjs           with-hooks vs without-hooks
│   ├── stats.cjs         Wilson intervals
│   └── tasks/            _scaffold + six task directories
└── test/                 unit tests
```

**All runtime files use the `.cjs` extension.** A `.js` file breaks inside a project whose manifest
declares ES modules — verified failure during development.

---

## 3. Configuration

`tandem.json` at the project root. All keys optional; every one has a default.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `typecheckCommand` | string | inferred | Per-project type check |
| `testCommand` | string | inferred | Full test run |
| `lintCommand` | string | none | Optional |
| `workingSet` | string[] | `["src/**", "test/**", "tests/**"]` | Writable paths |
| `exclude` | string[] | build and dependency directories | Never writable |
| `maxErrorsToModel` | number | 10 | Cap after dedupe |
| `maxRepairs` | number | 2 | Repair bound; range 1–3 |
| `blockOnRegression` | boolean | true | Reject regressing repairs |

**Inference (D-02).** With no config file, read the project manifest. If a script named `typecheck`
exists, use it; else if TypeScript is a dependency, use the type checker directly; else the type gate
is **disabled** per §4.

---

## 4. Tool detection and silent degradation — D-05

**The single most important behaviour in the product.**

`detect.cjs` exposes:

```
detectGates(cwd, config) -> {
  typecheck: { available: boolean, command: string|null, reason: string|null },
  test:      { available: boolean, command: string|null, reason: string|null },
  lint:      { available: boolean, command: string|null, reason: string|null }
}
```

Availability is decided by resolving the executable, not by running it. Detection results are cached
in session state; detection runs at most once per session.

**When a gate is unavailable:**

1. Skip it.
2. **Exit 0.** Never 2. Never a non-zero code of any kind.
3. Write once per session to stderr: `TANDEM_DISABLED <gate> (<reason>)`
4. Record it in state so `doctor` can report it.

**Forbidden:** failing the hook, blocking the turn, printing on every invocation, or attempting to
install anything.

A Python project with Tandem installed must behave exactly as a project without Tandem installed.

---

## 5. Hook behaviour

### 5.1 session-start

Reset per-task state. Run gate detection. Print the five rule texts to **stdout**. Exit 0.

Total rule text under two kilobytes (NFR-03).

### 5.2 post-tool

Input carries `tool_input.file_path`.

1. Off switch set → exit 0.
2. No file path → exit 0.
3. Path outside the working set → **delete the file**, stderr `TANDEM BLOCKED_WRITE <path> — reverted`, exit 2. *(Corrective, not preventive — C-02, C-06.)*
4. Not a TypeScript or JavaScript file → exit 0.
5. Type gate unavailable → exit 0 (§4).
6. Run the type check. Success → exit 0, silent.
7. Failure → parse; dedupe by file and code; order shallowest path first; cap at the configured limit; print to stderr; exit 2.
8. Parse produced nothing → print a head-and-tail excerpt, record a parse fallback, exit 2.

### 5.3 stop

1. `stop_hook_active` true → **exit 0 immediately.** Non-negotiable.
2. Off switch set → exit 0.
3. Type gate available → run it. Failure → §5.4.
4. Test gate available → run it. Success → record the passing set as the new green state, reset the repair counter, exit 0.
5. Test failure → §5.4.
6. No gates available → exit 0.

### 5.4 Failure reporting and the repair bound

Compute a failure key from the sorted set of file-and-code pairs.

- Key matches the stored key → increment the repair counter.
- Key differs → store it, reset the counter to one.
- **Counter exceeds `maxRepairs`** → stderr `TANDEM BOUNDED_REPAIR` plus the remaining errors, **exit 0**. Stopping is deliberate: further blind attempts degrade the result.
- Otherwise → compare the current passing set against the green state. Any test present in green and absent now is a **regression**; name regressions **first**, then the parsed errors. Exit 2.

---

## 6. Commands

| Command | Behaviour |
|---|---|
| `tandem init` | Create `.claude/settings.json` from the template with absolute paths. Detect language and gates. Write `tandem.json` only if commands could not be inferred. Print a summary of what was enabled |
| `tandem doctor` | Print detected host version, each gate with active/disabled and reason, working-set patterns, repair bound, off-switch state. **Never print secrets, tokens, or environment values** |
| `tandem bench` | Run §8 |

---

## 7. Task list

Execute in order. After each: `npm test` must pass.

### Phase A — Package

| ID | Task | Acceptance |
|---|---|---|
| T01 | Create the package skeleton of §2 with `bin` and `files` fields declared | `npm pack --dry-run` lists exactly the intended files |
| T02 | Copy the existing `parse.cjs`, `state.cjs`, `rules.cjs` and their tests unchanged | `npm test` passes with the existing suite |
| T03 | Add the test runner configuration and a root `test` script | `npm test` exits 0 |

### Phase B — Detection (D-05)

| ID | Task | Acceptance |
|---|---|---|
| T04 | Failing tests for `detectGates`: TypeScript project → type gate available; Python project → unavailable with a reason; missing test runner → test gate unavailable | test fails |
| T05 | Implement `detect.cjs` | test passes |
| T06 | Failing tests for config loading: file present, file absent with inference, inference impossible | test fails |
| T07 | Implement `config.cjs` | test passes |

### Phase C — Hooks

| ID | Task | Acceptance |
|---|---|---|
| T08 | Failing tests for the dispatcher: three modes, stdin parsing, stderr-only diagnostics, off switch | test fails |
| T09 | Implement dispatch and the off switch | test passes |
| T10 | Implement `session-start` per §5.1 | fixture input prints rules on stdout, exits 0 |
| T11 | Failing tests for `post-tool` per §5.2, including out-of-scope revert and the disabled-gate path | test fails |
| T12 | Implement `post-tool` | test passes |
| T13 | Failing tests for `stop` per §5.3–5.4: `stop_hook_active` returns 0, repair bound stops at the limit, regression named first | test fails |
| T14 | Implement `stop` | test passes |
| T15 | **Silent-degradation test:** run every hook in a directory with no type checker; assert exit 0 everywhere and exactly one disabled line | test passes |

### Phase D — CLI

| ID | Task | Acceptance |
|---|---|---|
| T16 | Implement `tandem init` per §6 | run in a fresh project; `.claude/settings.json` created with absolute paths |
| T17 | Implement `tandem doctor` per §6 | prints gate status; a test asserts no environment value appears in the output |
| T18 | Write the README: **off switch in the first section (D-08)**, then install, configure, verified host version, and the C-02 limitation stated plainly | a test asserts the README contains no placeholder text |

### Phase E — Benchmark

| ID | Task | Acceptance |
|---|---|---|
| T19 | Implement `stats.cjs` (Wilson interval, overlap test) | unit test against known values passes |
| T20 | Copy the six existing task directories and the scaffold | all six specs run standalone and fail against an empty source directory |
| T21 | Implement `bench/run.cjs`: per task, run twice — off then on — same model, same prompt, scored in a **separate directory** so the hidden spec never enters the agent's context | one task runs both arms and produces metrics |
| T22 | Add resumability: append each completed run immediately; skip completed runs on restart | interrupting and rerunning does not repeat work |
| T23 | Implement reporting: both arms, confidence intervals, and a verdict of *helps*, *hurts*, or *inconclusive* | a results file is written |

### Phase F — Measure and record

| ID | Task | Acceptance |
|---|---|---|
| T24 | Run the full benchmark: six tasks, two arms, five repetitions | all runs recorded |
| T25 | Write the README results section: both arms with intervals, the verdict, and an explicit statement that the suite covers only greenfield TypeScript work | real numbers, no placeholders |
| T26 | If SC-01 is not met, record the measured values and the observed cause in a findings file. **Do not adjust the threshold** | the file exists, or is correctly absent |
| T27 | Final check: `npm test` passes from a clean clone; no gateway named anywhere in `lib/` or `bin/` | both checks pass |

---

## 8. Benchmark specification

**Arms.** Identical model, prompt, and scaffold. One run with the off switch set, one with hooks active.

**Model under test.** A weak, cheap model. **Do not substitute a stronger model to obtain a better
number** — the thesis concerns lifting a weak model, and a strong one would measure nothing.

**Isolation.** The agent's directory contains configuration files and an empty source directory —
**never the dependency directory**, which a model will list and thereby exhaust its context, and
**never the hidden specification**. Scoring happens in a second directory.

**Recorded per run.** task, repetition, arm, pass, type errors remaining, wall clock, hook
invocations, repairs used, regressions blocked, writes reverted.

**Verdict.** Non-overlapping 95% intervals and a higher hooks-on rate → *helps*. Non-overlapping and
lower → *hurts*. Overlapping → *inconclusive*. **No other conclusion may be reported.**

---

## 9. Gateway neutrality — D-09

- No file under `lib/` or `bin/` may contain a gateway name.
- No file may read a gateway-specific environment variable.
- The benchmark takes the model identifier from its own argument or the environment; it never constructs one.
- T27 enforces this by search.

---

## 10. Out of scope

Languages beyond TypeScript and JavaScript · pre-emptive blocking (C-02) · sandboxing · model routing,
quotas, or cost accounting · telemetry of any kind · any user interface beyond terminal output.
