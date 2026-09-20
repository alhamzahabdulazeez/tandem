# First-Slice Task Specification: Expiry & Namespace Support in Store

**Document Type:** FIRST_SLICE_TASK_SPEC_V1  
**Schema Version:** 1.0.0  
**PRD Reference:** §2, §16, §33 (IB-02)  
**Status:** FROZEN  

---

## 1. Repository & Baseline Identity

- **Fixture Path:** `test/fixtures/first-slice/`
- **Module Format:** CommonJS (`"type": "commonjs"`)
- **Runtime:** Node.js >= 22 (built-in test runner `node --test`)
- **External Dependencies:** Zero (`dependencies: {}`, `devDependencies: {}`)
- **Baseline Files:**
  - `package.json` (`87d1ce8d7c0d7aab09f3a9838180a257949c0a5234094db57090b71421ac3ab4`)
  - `bin/cli.js` (`df20609f5ad1e6f3e4acd8028cd4889d74dcca57676fee215fb861e71bec3cf5`)
  - `lib/store.js` (`671f86841f7be36586680b5fff0cdafc8c29a5b5d3b0512a371008c50b1e919a`)
  - `test/suite.test.js` (`db8114fb974a9e08d7a8ff206feb23dbbd29fc9257e30fde21579ed9d98ee9ec`)

---

## 2. Task Description & Mutation Scope

### Objective
Enhance the `Store` class and `fixture-cli` command to support key namespacing with hierarchical isolation and bulk namespace purging.

### Functional Requirements
1. **Namespace Separation:**
   - Keys containing `:` are namespaced (e.g. `user:101:name`).
   - `store.listNamespace(ns)` returns a dictionary of all keys within that namespace prefix without the prefix.
2. **CLI Extension:**
   - `fixture-cli ns-list <ns>`: outputs JSON object of matching keys and exits `0`.
   - `fixture-cli ns-purge <ns>`: purges all keys in that namespace, outputs `OK: purged <N> keys in <ns>\n` and exits `0`.
3. **Change Scope Boundary:**
   - Allowed edits: `lib/store.js`, `bin/cli.js`, `test/suite.test.js`.
   - Disallowed edits: `package.json`, any external network/dependency installation.

---

## 3. Verification Recipe & Acceptance Criteria

### Native Verification Recipe
```bash
node --test test/suite.test.js
```

### Deterministic Acceptance Predicates
1. **P1 (Syntax & Parsing):** All files parse cleanly as valid CommonJS syntax under Node.js 22.
2. **P2 (Baseline Regression):** All existing baseline unit and CLI tests continue to pass.
3. **P3 (Task Implementation):** New namespace capabilities satisfy the obligation test cases.
4. **P4 (Resource Ceiling):** Execution of native recipe finishes within 5,000ms wall-clock and zero external network requests.
