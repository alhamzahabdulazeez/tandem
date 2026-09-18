# TANDEM Qualification Decisions & Status

This document records authoritative owner decisions resolving the initial blocker specifications (IB-01 through IB-04) as required by the TANDEM Gate 0 Audit and PRD specification.

## Summary Status

| Blocker | Description | Owner Decision Status | Qualification Status |
| :--- | :--- | :--- | :--- |
| **IB-01** | Runtime profile & containment | **DECIDED** | **OPEN** (Requires self-hosted Linux runner / VPS with unprivileged userns) |
| **IB-02** | First-slice baseline repository | **DECIDED** | **QUALIFIED (LOGIC ONLY)** |
| **IB-03** | Resource ceilings & reserve | **DECIDED** | **QUALIFIED (LOGIC ONLY)** |
| **IB-04** | Paired evaluation protocol & criteria | **DECIDED** | **QUALIFIED (LOGIC ONLY)** |

> **Authoritative Invariant:** While each blocker decision (IB-01 through IB-04) is formally **DECIDED**, GitHub Actions execution is qualified for **LOGIC ONLY**. Physical qualification for IB-01 remains **OPEN** until verified on a runner environment with active user namespace containment.

---

## IB-01: Runtime Profile & Containment (Revised & Probed)

- **Probe Findings on GitHub-hosted `ubuntu-24.04`:**
  - `unshare -Urm` on host fails with: `write failed /proc/self/uid_map: Operation not permitted` (unprivileged user namespaces restricted by default AppArmor profile on Ubuntu 24.04 runners).
  - `bwrap` (bubblewrap) is absent (`NOT INSTALLED`) on standard runner host images.
  - Inside a Docker job container (`node:22-bookworm`), `bwrap` fails with: `bwrap: Creating new namespace failed: Operation not permitted` (Docker default seccomp/AppArmor blocks `clone(CLONE_NEWUSER)` inside unprivileged containers).
  - Consequently, on GitHub-hosted `ubuntu-24.04`, neither `unshare` nor `bwrap` can establish containment.
  - `cgroup v2` controllers (`cpuset`, `cpu`, `io`, `memory`, `hugetlb`, `pids`, `rdma`, `misc`, `dmem`) and `seccomp` are available.
  - Full recorded probe stdout is captured in [`docs/probe-ubuntu-24.04.txt`](probe-ubuntu-24.04.txt).

- **Qualification Scope:**
  - **GitHub Actions is qualified for LOGIC ONLY.**
  - **IB-01 Physical Qualification:** Requires a self-hosted Linux runner or a VPS with unprivileged user namespaces enabled.
  - **IB-01 Status:** **OPEN** (Physical containment pending self-hosted / VPS environment).

- **Development Environment Distinction:**
  - Android / Termux remains strictly **development-only** and **never qualified** for authoritative containment or qualification claims.

- **Decision State:** **DECIDED**
- **Qualification State:** **OPEN** (Requires self-hosted Linux runner / VPS with unprivileged user namespaces).

---

## IB-02: First-Slice Repository Baseline

- **Repository:** `tandem` (https://github.com/alhamzahabdulazeez/tandem.git)
- **Baseline Commit Anchor:** `afa46cd`
- **Scope:** First-slice mutation, CLI behavior, predicate binding, and end-to-end qualification contract baseline anchored at commit `afa46cd`.
- **Decision State:** **DECIDED**
- **Qualification State:** **QUALIFIED (LOGIC ONLY)**

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
- **Qualification State:** **QUALIFIED (LOGIC ONLY)**

---

## IB-04: Paired Evaluation Protocol & Decision Criteria

Evaluation protocol parameters for Gate 3 and superiority verification:
- **Evaluation Dataset:** 30 paired tasks
- **Primary Metric:** Pass rate
- **Meaningful Benefit Threshold:** +15 percentage points over baseline
- **Maximum Permissible Overhead:** 1.8× baseline resource consumption
- **Uncertainty Rule:** Overlapping confidence intervals mean no superiority claim may be asserted.
- **Decision State:** **DECIDED**
- **Qualification State:** **QUALIFIED (LOGIC ONLY)**

---

## Qualification Verification Path

1. Live environment probe output recorded in `docs/probe-ubuntu-24.04.txt`.
2. Execute `.github/workflows/contracts-linux.yml` with host test suite and container test suite jobs.
3. Containment probe recorded in `containment-probe.txt` verifying unprivileged containment constraints on GitHub Actions runners.
4. Close Gate 0 logic qualification upon green run of GitHub Actions test suite jobs.
5. IB-01 physical containment qualification remains OPEN pending verification on a self-hosted runner or VPS with unprivileged user namespaces.
