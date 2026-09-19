# TANDEM First-Slice Specification: IB-02 Baseline & Execution Contract

**Document Type:** FIRST_SLICE_SPEC_V1  
**Schema Version:** 1.0.0  
**PRD Reference:** §2, §16, §24 (T-02 Transitive Containment), §25 (Gate 0 / Gate 1), §33 (IB-02)  
**Status:** FROZEN  
**Qualification Blocker:** IB-02 (Baseline Repository & Mutation Specification)  
**Qualification State:** OPEN (Execution pending)  

---

## 1. Executive Summary & Authoritative Invariant

This document defines the exact first-slice execution contract for **IB-02** in accordance with PRD §24 (T-02) and Gate 0 audit requirements. 

> **Authoritative Invariant:**  
> The baseline anchor is fixed at commit `afa46cd` (`afa46cd68b1a2a616f5daff0ad2ba737ec9997d2`). No model self-certification is permitted. Execution is deterministic, zero-egress, and strictly evaluated by the native verification recipe (`node test/run.cjs`). If the baseline is non-green prior to candidate execution, the pipeline fails closed immediately and blocker **IB-02 remains OPEN**.

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
| **Baseline Test Command** | `node test/run.cjs` |
| **Expected Baseline State** | 111 passed, 0 failed (exit code 0) |

### Baseline Cryptographic Digests (Anchor `afa46cd`)

| File Path | SHA-256 Digest | Size (Bytes) | Role |
| :--- | :--- | :--- | :--- |
| `src/gates/detect.cjs` | `6e1f60865e8b4e4641b2bc8e43ef97722b161af18fcb16d576ad8f2d3ca6140a` | 2,815 | Mutable source target |
| `test/run.cjs` | `d675a1d938a6a49fce8b8875e2de281ee5aa5f5262a88b6735712ee0bfc33378` | 29,703 | Mutable test suite |
| `package.json` | `1fd9fd813aa8c192b82c14c5f470ebc3a7f0a1963d4bf39a0a363ef8fc7fd282` | 798 | Immutable package descriptor |

---

## 3. Mutation Task Specification

### Task ID: `TASK-IB02-ESLINT-DETECT`
**Title:** ESLint Detection in Gate Detection  
**Objective:** Extend `detectLint` in `src/gates/detect.cjs` to support detecting `eslint` in package dependencies when `@biomejs/biome` is not configured and `cfg.lintCommand` is unset.

### Functional Requirements
1. **Gate Detection Extension (`src/gates/detect.cjs`):**
   - In `detectLint(cwd, cfg, m)`:
     - Check if `hasDep(m, 'eslint')` returns true when `cfg.lintCommand` is unset and `@biomejs/biome` is not present in `m`.
     - When present, return `{ available: true, command: 'npx eslint --format json .', reason: null }`.
     - When neither is configured, continue returning `{ available: false, command: null, reason: 'no linter configured' }`.
2. **Deterministic Test Case (`test/run.cjs`):**
   - Under group `'silent degradation — D-05'` (or a dedicated test):
     ```javascript
     t('detects eslint when present in manifest', () => {
       const d = detect.detectGates('.', {}, { devDependencies: { eslint: '^9.0.0' } });
       assert.strictEqual(d.lint.available, true);
       assert.strictEqual(d.lint.command, 'npx eslint --format json .');
     });
     ```
3. **Change Scope Boundary:**
   - **Allowed file mutations:**
     - `src/gates/detect.cjs`
     - `test/run.cjs`
   - **Disallowed file mutations:**
     - `package.json`
     - `package-lock.json`
     - `bin/**`
     - `src/core/**`
     - `src/context/**`
     - `src/adapter/**`
     - `src/index.cjs`
     - Any file outside the cloned baseline repository

---

## 4. Fixture and Expectation Manifest

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "document_type": "FIRST_SLICE_MANIFEST_V1",
  "schema_version": "1.0.0",
  "task_id": "TASK-IB02-ESLINT-DETECT",
  "blocker_id": "IB-02",
  "baseline": {
    "repository": "https://github.com/alhamzahabdulazeez/tandem.git",
    "commit": "afa46cd68b1a2a616f5daff0ad2ba737ec9997d2",
    "short_commit": "afa46cd",
    "expected_tests_passed": 111,
    "expected_tests_failed": 0
  },
  "scope": {
    "allowed_files": [
      "src/gates/detect.cjs",
      "test/run.cjs"
    ],
    "disallowed_files": [
      "package.json",
      "package-lock.json",
      "bin/**",
      "src/core/**",
      "src/context/**",
      "src/adapter/**",
      "src/index.cjs"
    ]
  },
  "verification": {
    "recipe_command": "node test/run.cjs",
    "timeout_ms": 10000,
    "allow_network": false,
    "expected_exit_code": 0,
    "expected_tests_passed": 112,
    "expected_tests_failed": 0
  },
  "acceptance_predicates": [
    "P1: Baseline commit afa46cd is clean and passes 111/0 tests prior to candidate run",
    "P2: Syntax across all repository files is valid CommonJS under Node.js >=22",
    "P3: No changes occur outside the allowed mutation scope (src/gates/detect.cjs and test/run.cjs)",
    "P4: No new dependencies or network access introduced",
    "P5: Post-mutation test suite passes exactly 112/0 tests with exit code 0 within 10,000ms"
  ]
}
```

---

## 5. Full Native Verification Recipe

The complete verification recipe is executed entirely within the isolated candidate sandbox:

```bash
# 1. Ensure working directory is clean
git status --porcelain

# 2. Execute full native test suite
node test/run.cjs

# Expected output signature:
# 112 passed, 0 failed
# Exit code: 0
```

---

## 6. Baseline-Failure Treatment (Fail-Closed Invariant)

To satisfy the non-negotiable correctness invariants of PRD §24 (T-02, T-05, T-06) and Gate 0:

1. **Pre-Flight Verification:** Before any candidate code is admitted or executed, the baseline commit `afa46cd` must be verified via `node test/run.cjs`.
2. **Failure Disposition:** If the baseline execution produces any test failure (`failed > 0`), non-zero exit code (`exitCode !== 0`), timeout, or crash:
   - The preparation and evaluation sequence terminates immediately.
   - Candidate mutation is **refused and blocked**.
   - No candidate observations or self-certifications are recorded.
   - Diagnostic `BASELINE_NON_GREEN` is emitted.
   - Blocker **IB-02 remains OPEN** (NOT QUALIFIED).
3. **Anti-Contamination Rule:** A candidate run may never repair or modify baseline failures outside the declared task scope.
