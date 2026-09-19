# TANDEM First-Slice Specification: IB-02 Baseline & Held-Out Grader Contract

**Document Type:** FIRST_SLICE_SPEC_V1  
**Schema Version:** 1.0.0  
**PRD Reference:** §2, §16, §24 (T-02 Transitive Containment, T-05 Total Predicates, T-06 Oracle Control), §25 (Gate 0 / Gate 1), §33 (IB-02)  
**Status:** FROZEN  
**Qualification Blocker:** IB-02 (Baseline Repository & Mutation Specification)  
**Qualification State:** OPEN (Execution pending)  

---

## 1. Executive Summary & Authoritative Invariants

This document defines the exact first-slice execution contract for **IB-02** in accordance with PRD §24 (T-02 Containment, T-05 Total Predicates, T-06 Oracle Control) and Gate 0 audit requirements. 

> **Authoritative Invariants:**  
> 1. **Baseline Anchor:** The baseline anchor is fixed at commit `afa46cd` (`afa46cd68b1a2a616f5daff0ad2ba737ec9997d2`).
> 2. **Held-Out Grader (Oracle Control):** The acceptance test is held out from the candidate in `bench/first-slice/spec.test.cjs`. The candidate never sees the held-out spec before or during execution.
> 3. **Strict Single-File Scope:** The candidate is permitted to mutate **`src/gates/detect.cjs` ONLY**. `test/run.cjs` is strictly immutable. Any attempt to modify `test/run.cjs` or any other file outside `src/gates/detect.cjs` is a disallowed mutation that immediately fails the slice.
> 4. **Two-Stage Native Verification Recipe:**
>    - **Stage 1 (Non-Regression):** `node test/run.cjs` must pass with 111 passed, 0 failed, exit code 0.
>    - **Stage 2 (Held-Out Grader Acceptance):** `bench/first-slice/spec.test.cjs` is executed against the candidate tree and must pass with 5 passed, 0 failed, exit code 0.
> 5. **Fail-Closed Baseline Invariant:** If the baseline commit is non-green prior to candidate execution, the pipeline fails closed immediately (`BASELINE_NON_GREEN`) and blocker **IB-02 remains OPEN**. No model self-certification is permitted.

---

## 2. Baseline Repository Identity & Environment

| Property | Value |
| :--- | :--- |
| **Repository** | `https://github.com/alhamzahabdulazeez/tandem.git` |
| **Anchor Commit** | `afa46cd68b1a2a616f5daff0ad2ba737ec9997d2` (`afa46cd`) |
| **Commit Message** | `docs: credit the host agent` |
| **Runtime Requirements** | Node.js `>=22.0.0`, CommonJS module format |
| **Network Egress** | Strictly forbidden (`allow_network: false`) |
| **Isolation Envelope** | Fresh clone into an isolated temporary directory with read-only root / sandboxed worktree |
| **Stage 1 Baseline Test** | `node test/run.cjs` (111 passed, 0 failed, exit code 0) |
| **Stage 2 Held-Out Spec** | `bench/first-slice/spec.test.cjs` (5 passed, 0 failed, exit code 0) |

### Baseline Cryptographic Digests (Anchor `afa46cd`)

| File Path | SHA-256 Digest | Size (Bytes) | Role |
| :--- | :--- | :--- | :--- |
| `src/gates/detect.cjs` | `6e1f60865e8b4e4641b2bc8e43ef97722b161af18fcb16d576ad8f2d3ca6140a` | 2,815 | **MUTABLE_SOURCE** (The only allowed mutation) |
| `test/run.cjs` | `d675a1d938a6a49fce8b8875e2de281ee5aa5f5262a88b6735712ee0bfc33378` | 29,703 | **IMMUTABLE_TEST** (Disallowed mutation) |
| `package.json` | `1fd9fd813aa8c192b82c14c5f470ebc3a7f0a1963d4bf39a0a363ef8fc7fd282` | 798 | **IMMUTABLE_DESCRIPTOR** (Disallowed mutation) |

---

## 3. Mutation Task Specification

### Task ID: `TASK-IB02-ESLINT-DETECT`
**Title:** ESLint Detection in Gate Detection  
**Objective:** Extend `detectLint` in `src/gates/detect.cjs` to support detecting `eslint` in package dependencies when `@biomejs/biome` is not configured and `cfg.lintCommand` is unset.

### Functional Requirements
1. **Gate Detection Extension (`src/gates/detect.cjs`):**
   - In `detectLint(cwd, cfg, m)`:
     - When `cfg.lintCommand` is unset and `@biomejs/biome` is not present in `m`:
       - Check if `hasDep(m, 'eslint')` returns true (present in `dependencies` or `devDependencies`).
       - If true, return `{ available: true, command: 'npx eslint --format json .', reason: null }`.
     - When neither `@biomejs/biome` nor `eslint` is configured, continue returning `{ available: false, command: null, reason: 'no linter configured' }`.
     - Respect `cfg.lintCommand` override if explicitly provided.
     - Preserve `@biomejs/biome` precedence when both `@biomejs/biome` and `eslint` are present.

2. **Held-Out Test Grader (`bench/first-slice/spec.test.cjs`):**
   - Held out outside the candidate's workspace during execution.
   - Evaluates:
     - ESLint detection in `devDependencies`
     - ESLint detection in `dependencies`
     - Explicit `cfg.lintCommand` override behavior
     - Biome precedence over ESLint
     - Disabled gate behavior when no linter is configured

3. **Strict Scope Boundary Fencing:**
   - **Allowed file mutations:**
     - `src/gates/detect.cjs` (ONLY)
   - **Disallowed file mutations:**
     - `test/run.cjs` (Must NOT be modified; modification fails the slice)
     - `package.json`
     - `package-lock.json`
     - `bin/**`
     - `bench/**`
     - `src/core/**`
     - `src/context/**`
     - `src/adapter/**`
     - `src/index.cjs`
     - Any file outside `src/gates/detect.cjs`

---

## 4. Fixture and Expectation Manifest

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "document_type": "FIRST_SLICE_MANIFEST_V1",
  "schema_version": "1.0.0",
  "task_id": "TASK-IB02-ESLINT-DETECT",
  "blocker_id": "IB-02",
  "title": "ESLint Detection in Gate Detection",
  "specification_path": "docs/FIRST_SLICE.md",
  "grader_type": "HELD_OUT",
  "baseline": {
    "repository": "https://github.com/alhamzahabdulazeez/tandem.git",
    "commit": "afa46cd68b1a2a616f5daff0ad2ba737ec9997d2",
    "short_commit": "afa46cd",
    "expected_tests_passed": 111,
    "expected_tests_failed": 0
  },
  "scope": {
    "allowed_files": [
      "src/gates/detect.cjs"
    ],
    "disallowed_files": [
      "test/run.cjs",
      "package.json",
      "package-lock.json",
      "bin/**",
      "bench/**",
      "src/core/**",
      "src/context/**",
      "src/adapter/**",
      "src/index.cjs"
    ]
  },
  "verification": {
    "stages": [
      {
        "stage": 1,
        "name": "non_regression",
        "recipe_command": "node test/run.cjs",
        "expected_exit_code": 0,
        "expected_tests_passed": 111,
        "expected_tests_failed": 0
      },
      {
        "stage": 2,
        "name": "held_out_acceptance",
        "recipe_command": "node bench/first-slice/spec.test.cjs",
        "expected_exit_code": 0,
        "expected_tests_passed": 5,
        "expected_tests_failed": 0
      }
    ],
    "timeout_ms": 10000,
    "allow_network": false
  },
  "acceptance_predicates": [
    "P1: Baseline commit afa46cd is clean and passes 111/0 tests prior to candidate run",
    "P2: Syntax across all repository files is valid CommonJS under Node.js >=22",
    "P3: Candidate mutations are strictly confined to src/gates/detect.cjs; test/run.cjs is untouched",
    "P4: Stage 1 baseline regression test passes exactly 111/0 tests with exit code 0",
    "P5: Stage 2 held-out grader passes exactly 5/0 tests with exit code 0 within timeout"
  ],
  "baseline_failure_policy": {
    "action": "FAIL_CLOSED",
    "admit_candidate": false,
    "diagnostic": "BASELINE_NON_GREEN"
  }
}
```

---

## 5. Full Native Verification Recipe

The complete verification sequence is executed in two deterministic stages:

### Stage 1: Non-Regression Baseline Verification
Ensures that no existing functionality was broken and that `test/run.cjs` was not modified:
```bash
# 1. Verify mutation scope boundary
git diff --name-only afa46cd | grep -v "^src/gates/detect.cjs$" && exit 1

# 2. Run baseline test suite (must remain 111 passed, 0 failed)
node test/run.cjs
```

### Stage 2: Held-Out Grader Acceptance Verification
The held-out test specification (`bench/first-slice/spec.test.cjs`) is introduced post-generation and executed against the candidate's modified code:
```bash
# 3. Execute held-out grader against the candidate directory
node bench/first-slice/spec.test.cjs

# Expected output:
# Held-out spec: 5 passed, 0 failed
# Exit code: 0
```

---

## 6. Baseline-Failure Treatment & Anti-Tampering Rules

To satisfy PRD §24 (T-02, T-05, T-06) and Gate 0 invariants:

1. **Pre-Flight Verification:** Before any candidate is admitted or evaluated, baseline commit `afa46cd` must be verified via `node test/run.cjs`.
2. **Fail-Closed on Baseline Failure:** If the baseline produces any test failure (`failed > 0`), non-zero exit code (`exitCode !== 0`), timeout, or crash:
   - Candidate evaluation is aborted immediately.
   - Diagnostic `BASELINE_NON_GREEN` is recorded.
   - Blocker **IB-02 remains OPEN** (NOT QUALIFIED).
3. **Disallowed Grader Mutation:** If a candidate modifies `test/run.cjs`, the diff check rejects the candidate as a scope violation (`DISALLOWED_MUTATION_TEST_TAMPERING`), and the evaluation fails closed.
4. **Anti-Contamination Rule:** The candidate is provided zero access to `bench/first-slice/spec.test.cjs` during its execution session.
