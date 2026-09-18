# TANDEM Qualification Decisions & Status

This document records authoritative owner decisions resolving the initial blocker specifications (IB-01 through IB-04) as required by the TANDEM Gate 0 Audit and PRD specification.

## Summary Status

| Blocker | Description | Owner Decision Status | Qualification Status |
| :--- | :--- | :--- | :--- |
| **IB-01** | Runtime profile & containment | **DECIDED** | **OPEN** (Pending probe recording) |
| **IB-02** | First-slice baseline repository | **DECIDED** | **OPEN** (Pending probe recording) |
| **IB-03** | Resource ceilings & reserve | **DECIDED** | **OPEN** (Pending probe recording) |
| **IB-04** | Paired evaluation protocol & criteria | **DECIDED** | **OPEN** (Pending probe recording) |

> **Authoritative Invariant:** While each blocker decision (IB-01 through IB-04) is now formally **DECIDED**, qualification itself remains **OPEN** until live environment probe output from the target execution environment (`ubuntu-24.04`) is recorded, verified, and admitted.

---

## IB-01: Runtime Profile & Containment

- **Target Host Environment:** `ubuntu-24.04` (Ubuntu 24.04 LTS x86_64)
- **Runtime:** Node.js 22 (`node 22`)
- **Containment Mechanism:** `unshare -Urm` (unprivileged user, root mapping, and mount namespaces) combined with `cgroup v2` controllers (`memory`, `pids`, `cpu`).
- **Development Environment Distinction:** Android / Termux is strictly **development-only** and **never qualified** for authoritative containment or qualification claims.
- **Decision State:** **DECIDED**
- **Qualification State:** **OPEN** (Pending recording of live Linux runner probe output).

---

## IB-02: First-Slice Repository Baseline

- **Repository:** `tandem` (https://github.com/alhamzahabdulazeez/tandem.git)
- **Baseline Commit Anchor:** `afa46cd`
- **Scope:** First-slice mutation, CLI behavior, predicate binding, and end-to-end qualification contract baseline anchored at commit `afa46cd`.
- **Decision State:** **DECIDED**
- **Qualification State:** **OPEN** (Pending probe recording).

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
- **Qualification State:** **OPEN** (Pending probe recording).

---

## IB-04: Paired Evaluation Protocol & Decision Criteria

Evaluation protocol parameters for Gate 3 and superiority verification:
- **Evaluation Dataset:** 30 paired tasks
- **Primary Metric:** Pass rate
- **Meaningful Benefit Threshold:** +15 percentage points over baseline
- **Maximum Permissible Overhead:** 1.8× baseline resource consumption
- **Uncertainty Rule:** Overlapping confidence intervals mean no superiority claim may be asserted.
- **Decision State:** **DECIDED**
- **Qualification State:** **OPEN** (Pending probe recording).

---

## Qualification Next Steps

1. Execute the `.github/workflows/contracts-linux.yml` probe job on `ubuntu-24.04`.
2. Capture and record the resulting `probe-output.txt` artifact into the qualification documentation.
3. Validate runtime containment primitives (`bwrap`, `unshare -Urm`, `cgroup v2` controllers, PID namespaces, `seccomp`).
4. Transition Gate 0 qualification status upon verification of live probe evidence.
