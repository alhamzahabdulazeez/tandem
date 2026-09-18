# TANDEM Qualification Decisions & Status

This document records authoritative owner decisions resolving the initial blocker specifications (IB-01 through IB-04) as required by the TANDEM Gate 0 Audit and PRD specification.

## Summary Status

| Blocker | Description | Owner Decision Status | Qualification Status |
| :--- | :--- | :--- | :--- |
| **IB-01** | Runtime profile & containment | **DECIDED** | **QUALIFIED** (Docker runtime profile in CI) |
| **IB-02** | First-slice baseline repository | **DECIDED** | **OPEN** (Execution against baseline pending) |
| **IB-03** | Resource ceilings & reserve | **DECIDED** | **OPEN** (Runtime enforcement evidence pending) |
| **IB-04** | Paired evaluation protocol & criteria | **DECIDED** | **OPEN** (Paired evaluation pending) |

> **Authoritative Invariant:** Only **IB-01** is **QUALIFIED** under the verified CI Docker runtime profile on Linux (`ubuntu-24.04`). **IB-02**, **IB-03**, and **IB-04** are **DECIDED** with qualification **OPEN** pending execution and measurement evidence. Android / Termux remains strictly development-only and NOT QUALIFIED.

---

## IB-01: Runtime Profile & Containment (Docker Runtime Profile)

- **Qualification Evidence & Profile:**
  - **Platform:** `ubuntu-24.04` GitHub-hosted runner with Docker engine.
  - **Containment Mechanism:** Docker container isolation (`--network=none`, `--pids-limit=64`, `--memory=512m`, `--read-only`, `--tmpfs /tmp`).
  - **Verification Proof (Run `35397253342`, Commit `a2187aa`):**
    - **Network Isolation:** `net_exit=1` under `--network=none` proving zero external network egress.
    - **PID Isolation:** PID count 4 inside container (asserted `< 10`), proving isolated process namespace.
    - **Resource Ceilings:** `--pids-limit=64` and `--memory=64m`/`512m` hard cgroup limits enforced.
    - **Filesystem Fencing:** `--read-only` root filesystem with bounded `--tmpfs /tmp` storage.
  - **Documented Platform Limitations:**
    - Host-level `unshare -Urm` and `bwrap` (Bubblewrap) remain unavailable on GitHub-hosted runners due to default AppArmor/kernel unprivileged user namespace restrictions. This is a documented platform limitation, not a hidden one.
    - Containment is established and verified via the Docker runtime profile.

- **Development Environment Distinction:**
  - Android / Termux remains strictly **development-only** and **never qualified** for authoritative containment or qualification claims.

- **Decision State:** **DECIDED**
- **Qualification State:** **QUALIFIED** (Under Docker runtime profile in CI; run `35397253342`, commit `a2187aa`).

---

## IB-02: First-Slice Repository Baseline

- **Repository:** `tandem` (https://github.com/alhamzahabdulazeez/tandem.git)
- **Baseline Commit Anchor:** `afa46cd`
- **Scope:** First-slice mutation, CLI behavior, predicate binding, and end-to-end qualification contract baseline anchored at commit `afa46cd`.
- **Decision State:** **DECIDED**
- **Qualification State:** **OPEN**
- **Pending Requirements:** The first slice has not been executed against commit `afa46cd`; no candidate run, no observations, no acceptance result exists.

---

## IB-03: Resource Ceilings & Mandatory Reserves

Numeric resource ceilings per action:
- **Maximum Wall-Clock Time:** 480s per action
- **Maximum Files Read:** 40 files
- **Maximum Files Changed:** 12 files
- **Maximum Changed Lines:** 600 lines
- **Maximum Tool Calls:** 20 tool calls
- **Mandatory Reserve:** 20% mandatory reserve buffer across all bounded dimensions
- **Decision State:** **DECIDED**
- **Qualification State:** **OPEN**
- **Pending Requirements:** The ceilings are written down but no runtime enforcement evidence exists.

---

## IB-04: Paired Evaluation Protocol & Decision Criteria

Evaluation protocol parameters for Gate 3 and superiority verification:
- **Evaluation Dataset:** 30 paired tasks
- **Primary Metric:** Pass rate
- **Meaningful Benefit Threshold:** +15 percentage points over baseline
- **Maximum Permissible Overhead:** 1.8× baseline resource consumption
- **Uncertainty Rule:** Overlapping confidence intervals mean no superiority claim may be asserted.
- **Decision State:** **DECIDED**
- **Qualification State:** **OPEN**
- **Pending Requirements:** No paired evaluation has been run; zero of the 30 tasks are complete.

---

## Qualification Verification Path

1. Live environment probe output recorded in `docs/probe-ubuntu-24.04.txt`.
2. Execute `.github/workflows/contracts-linux.yml` with host test suite, container test suite, and Docker containment proof jobs.
3. Containment proof verified in CI (run `35397253342`, commit `a2187aa`) confirming network isolation, PID isolation, cgroup limits, and read-only root — establishing IB-01 as **QUALIFIED**.
4. IB-02, IB-03, and IB-04 remain **OPEN** until live first-slice execution, runtime enforcement measurement, and paired evaluation protocol runs are performed and recorded.
5. Android / Termux explicitly documented as development-only and NOT QUALIFIED.
