# TANDEM Paired Evaluation Protocol (IB-04 Frozen Specification)

**Document Type:** PAIRED_EVALUATION_PROTOCOL_V1  
**Blocker ID:** `IB-04` (Paired Evaluation Protocol & Decision Criteria)  
**Specification Status:** **FROZEN (Pre-Execution Lock)**  
**Anchor Commit:** `afa46cd68b1a2a616f5daff0ad2ba737ec9997d2` (`afa46cd`)  
**Qualification State:** **OPEN** (Pending Paired Evaluation Execution)  
**Date Frozen:** 2026-09-19  

---

## 1. Protocol Freezing & Anti-Contamination Mandate

In accordance with PRD §23, §24 (T-14 Paired Value, T-06 Oracle Control, T-02 Transitive Containment), §25 (Gate 3), and §33 (IB-04), this document establishes and freezes the authoritative evaluation protocol for **IB-04** prior to any evaluation run.

**Authoritative Invariant:** Pre-execution freezing ensures that all hypothesis criteria, task specifications, sample sizes, resource ceilings, overhead metrics, and statistical decision rules cannot be adjusted, tuned, or cherry-picked post-hoc.

---

## 2. Experimental Design & Two-Arm Paired Comparison

The evaluation executes a balanced, within-subjects paired design across **30 distinct software engineering tasks** derived from the baseline repository tree at commit `afa46cd`.

Each task $i \in \{1, \dots, 30\}$ is evaluated exactly twice under identical baseline repository states:

| Experimental Arm | Identifier | Configuration & Enforcement |
| :--- | :--- | :--- |
| **Arm A (Baseline / Unassisted)** | `ARM-A-UNASSISTED` | `TANDEM_HOOKS=off`. Candidate model operates in disposable isolated container without supervisory write-time scope prevention or runtime budget reserves. |
| **Arm B (Tandem-Assisted)** | `ARM-B-ASSISTED` | `TANDEM_HOOKS=on`. Candidate model operates with active write-time scope prevention (`TANDEM_ALLOWED_FILES`), in-process budget ledger tracking, and 20% mandatory resource reserves. |

### Total Executions
- **Tasks:** 30 tasks
- **Arms per Task:** 2 arms (Arm A and Arm B)
- **Total Runs:** 60 runs ($N = 60$)
- **Ordering:** Interleaved paired execution ($T_1 A \to T_1 B \to T_2 A \to T_2 B \dots$ or counterbalanced paired blocks) to mitigate temporal and gateway drift.

---

## 3. Controlled Environmental & Execution Invariants

All runs across both arms are executed under strictly identical environmental conditions:

1. **Baseline Anchor Commit:** `afa46cd68b1a2a616f5daff0ad2ba737ec9997d2` (`afa46cd`), verified 100% green (111/111 passed) prior to each task dispatch.
2. **Model Foundation:** Same model endpoint and generation parameters across both arms (`TANDEM_MODEL=auto/best-coding`, `temperature=0.0`).
3. **Hard Resource Ceilings (IB-03 Enforced):**
   - Maximum Tool Calls: 60 (`TANDEM_CEILING_TOOLCALLS=60`; Arm B applies 20% reserve with effective ceiling of 48)
   - Maximum Wall-Clock Time: 480 seconds per run
   - Maximum Unique Files Read: 40 files
   - Maximum Unique Files Changed: 12 files
   - Maximum Lines Changed: 600 lines
4. **Tools Provided:** Identical tool surface across both arms (`read`, `write`, `edit`, `bash`).
5. **Held-Out Acceptance Oracles (Oracle Control):**
   - Acceptance graders are stored in `bench/paired/graders/` outside the candidate workspace.
   - Grader code is never placed in candidate workspace, prompt context, or tool search paths.
6. **Two-Stage Verification Pipeline:**
   - **Scope Fencing:** Verifies candidate mutated strictly allowed files designated in task manifest.
   - **Stage 1 (Non-Regression):** Baseline test suite must pass 100% (`node test/run.cjs`, 111/111 passed, exit code 0).
   - **Stage 2 (Held-Out Acceptance):** Dedicated task held-out grader must pass 100% of test cases (exit code 0).

---

## 4. Primary Metrics & Statistical Decision Rules

### 4.1 Primary Benefit Metric: All-Started Completion Rate
- **Metric:** Completion / Pass Rate ($P = S / N$)
- **Denominator Rule:** Strictly inclusive of **all started tasks** ($N = 30$ per arm). Timeouts, budget exhaustion, crashes, scope violations, and test failures are accounted as failures ($0.0$).
- **Success Criteria ($S$):** A run is scored as $1.0$ (PASS) if and only if:
  1. Scope fencing is VALID (0 disallowed mutations).
  2. Stage 1 non-regression passes 111/111 tests.
  3. Stage 2 held-out grader passes all test cases with exit code 0.

### 4.2 Meaningful Benefit Threshold
Tandem must demonstrate a **meaningful improvement of at least +15 percentage points (+0.15)** over baseline:
$$\Delta P = P_B - P_A \ge +0.15 \quad (+15.0\%)$$

### 4.3 Maximum Permissible Overhead Ceiling
To ensure Tandem assistance does not impose disproportionate resource burdens, aggregate resource overhead must not exceed **1.8× baseline consumption** across bounded dimensions:
$$\text{Overhead Ratio} = \frac{\bar{R}_B}{\bar{R}_A} \le 1.80$$
where $R \in \{\text{Wall Time}, \text{Tool Calls}, \text{Total Lines Changed}\}$.

### 4.4 Wilson Score Confidence Interval & Uncertainty Decision Rule
Statistical confidence intervals are computed using the **95% Wilson score interval** ($z = 1.96$) via `bench/stats.cjs`:
$$\text{Wilson}(s, n) = \frac{p + \frac{z^2}{2n} \pm z \sqrt{\frac{p(1-p)}{n} + \frac{z^2}{4n^2}}}{1 + \frac{z^2}{n}}$$

**Superiority Decision Invariant (PRD §23, §24 T-14):**
- **SUPERIORITY ACCEPTED:** A superiority claim for Tandem (Arm B) is established if and only if:
  1. $\Delta P = P_B - P_A \ge +0.15$.
  2. The 95% Wilson confidence intervals **do not overlap**:
     $$\text{CI}_{A, \text{high}} < \text{CI}_{B, \text{low}}$$
  3. Resource overhead does not exceed $1.80\times$ baseline.
  4. Zero safety or integrity hard gate violations.
- **INCONCLUSIVE / NO SUPERIORITY CLAIM:** If the 95% Wilson confidence intervals overlap ($\text{CI}_{A, \text{high}} \ge \text{CI}_{B, \text{low}}$) or $\Delta P < +0.15$, **no superiority claim may be asserted**, and blocker IB-04 remains unproven.

---

## 5. Summary of the 30 Paired Evaluation Tasks

All 30 tasks are derived directly from modules in the `afa46cd` repository tree:

| Task ID | Module Area | Target File | Task Summary | Grader |
| :--- | :--- | :--- | :--- | :--- |
| `TASK-P01` | Gates | `src/gates/detect.cjs` | Detect `standard` linter in dependencies | `task-01.cjs` |
| `TASK-P02` | Gates | `src/gates/detect.cjs` | Detect `ruff` linter via config / dependencies | `task-02.cjs` |
| `TASK-P03` | Gates | `src/gates/detect.cjs` | Detect `jest` test runner in dependencies | `task-03.cjs` |
| `TASK-P04` | Gates | `src/gates/detect.cjs` | Detect `mocha` test runner in dependencies | `task-04.cjs` |
| `TASK-P05` | Gates | `src/gates/detect.cjs` | Detect `pyright` / `mypy` typecheckers | `task-05.cjs` |
| `TASK-P06` | Gates | `src/gates/detect.cjs` | Export `hasAnyDep(manifest, names)` helper | `task-06.cjs` |
| `TASK-P07` | Parse | `src/gates/parse.cjs` | Implement `parseEslintJson(raw)` | `task-07.cjs` |
| `TASK-P08` | Parse | `src/gates/parse.cjs` | Implement `parseJestJson(raw)` | `task-08.cjs` |
| `TASK-P09` | Parse | `src/gates/parse.cjs` | Implement `parsePytest(raw)` | `task-09.cjs` |
| `TASK-P10` | Parse | `src/gates/parse.cjs` | Export `filterByCode(errors, ignoredCodes)` | `task-10.cjs` |
| `TASK-P11` | Parse | `src/gates/parse.cjs` | Export `groupByFile(errors)` | `task-11.cjs` |
| `TASK-P12` | Parse | `src/gates/parse.cjs` | Implement `parseBiomeJson(raw)` | `task-12.cjs` |
| `TASK-P13` | Repair | `src/gates/repair.cjs` | Track `isConsecutive` failure flag in evaluate | `task-13.cjs` |
| `TASK-P14` | Repair | `src/gates/repair.cjs` | Support per-gate custom repair limits | `task-14.cjs` |
| `TASK-P15` | Repair | `src/gates/repair.cjs` | Export `formatRegressionSummary(regression)` | `task-15.cjs` |
| `TASK-P16` | Run | `src/gates/run.cjs` | Export `filterIgnoredCodes(errors, ignored)` | `task-16.cjs` |
| `TASK-P17` | Run | `src/gates/run.cjs` | Export `sanitizeCommand(cmd)` | `task-17.cjs` |
| `TASK-P18` | Run | `src/gates/run.cjs` | Implement `execSafe(command, cwd, timeoutMs)` | `task-18.cjs` |
| `TASK-P19` | Config | `src/core/config.cjs` | Export `validateConfig(cfg)` | `task-19.cjs` |
| `TASK-P20` | Config | `src/core/config.cjs` | Export `mergeConfig(base, overrides)` | `task-20.cjs` |
| `TASK-P21` | Config | `src/core/config.cjs` | Support `TANDEM_MAX_ERRORS` env override | `task-21.cjs` |
| `TASK-P22` | Config | `src/core/config.cjs` | Export `normalizeWorkingSet(workingSet)` | `task-22.cjs` |
| `TASK-P23` | State | `src/core/state.cjs` | Export `clearMemory(state, targetKey)` | `task-23.cjs` |
| `TASK-P24` | State | `src/core/state.cjs` | Export `resetSession(state)` | `task-24.cjs` |
| `TASK-P25` | State | `src/core/state.cjs` | Export `diffState(prevState, nextState)` | `task-25.cjs` |
| `TASK-P26` | State | `src/core/state.cjs` | Export `summarizeState(state)` | `task-26.cjs` |
| `TASK-P27` | Decision | `src/core/decision-points.cjs` | Export `priorityFor(point)` | `task-27.cjs` |
| `TASK-P28` | Decision | `src/core/decision-points.cjs` | Export `filterPoints(points, disabled)` | `task-28.cjs` |
| `TASK-P29` | Context | `src/context/depgraph.cjs` | Export `findCycles(graph)` | `task-29.cjs` |
| `TASK-P30` | Context | `src/context/depgraph.cjs` | Export `topologicalSort(graph)` | `task-30.cjs` |

---

## 6. Execution Runner & Resumability

The evaluation is managed by the automated, resumable runner (`bench/paired/runner.cjs`):
- Reuses `bin/first-slice.cjs` infrastructure for workspace isolation and baseline validation.
- Checkpoints state after every single run to `bench/paired/state.json`.
- Automatically resumes from run $N$ if interrupted, eliminating lost work and preventing duplicate runs.
- Collects fine-grained telemetry per run: pass/fail, tool calls, files read/changed, lines added/removed, wall time, stop reason, and scope block firing events.
