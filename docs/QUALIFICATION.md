# TANDEM Qualification Decisions & Status

This document records authoritative owner decisions resolving the initial blocker specifications (IB-01 through IB-04) as required by the TANDEM Gate 0 Audit and PRD specification.

## Summary Status

| Blocker | Description | Owner Decision Status | Qualification Status |
| :--- | :--- | :--- | :--- |
| **IB-01** | Runtime profile & containment (container-based isolation) | **DECIDED** | **OPEN** (Pending isolated container job pass) |
| **IB-02** | First-slice baseline repository | **DECIDED** | **OPEN** (Pending isolated container job pass) |
| **IB-03** | Resource ceilings & reserve | **DECIDED** | **OPEN** (Pending isolated container job pass) |
| **IB-04** | Paired evaluation protocol & criteria | **DECIDED** | **OPEN** (Pending isolated container job pass) |

> **Authoritative Invariant:** While each blocker decision (IB-01 through IB-04) is now formally **DECIDED**, qualification itself remains **OPEN** until the container-isolated job (`isolated` in `.github/workflows/contracts-linux.yml`) passes and verifies runtime execution on the qualified Linux host.

---

## IB-01: Runtime Profile & Containment (Revised)

- **Probe Findings on GitHub-hosted `ubuntu-24.04`:**
  - `unshare -Urm` execution fails with: `write failed /proc/self/uid_map: Operation not permitted` (unprivileged user namespaces restricted by default AppArmor profile on Ubuntu 24.04 runners).
  - `bwrap` (bubblewrap) is absent (`NOT INSTALLED`) on standard runner host images.
  - `cgroup v2` controllers (`cpuset`, `cpu`, `io`, `memory`, `hugetlb`, `pids`, `rdma`, `misc`, `dmem`) and `seccomp` are available.
  - Full recorded probe stdout is captured in [`docs/probe-ubuntu-24.04.txt`](probe-ubuntu-24.04.txt).

- **Revised Isolation Strategy:**
  - Because unprivileged `unshare` is denied on standard GitHub-hosted runners, the IB-01 runtime profile is **revised to container-based isolation** via dedicated job container (`node:22-bookworm`) rather than host-level `unshare`.
  - Target container runtime: `node:22-bookworm` providing Node.js 22, with bubblewrap (`bwrap`) installed inside the container environment.

- **Development Environment Distinction:**
  - Android / Termux remains strictly **development-only** and **never qualified** for authoritative containment or qualification claims.

- **Decision State:** **DECIDED**
- **Qualification State:** **OPEN** (Pending verified pass of the container-isolated job).

---

## IB-02: First-Slice Repository Baseline

- **Repository:** `tandem` (https://github.com/alhamzahabdulazeez/tandem.git)
- **Baseline Commit Anchor:** `afa46cd`
- **Scope:** First-slice mutation, CLI behavior, predicate binding, and end-to-end qualification contract baseline anchored at commit `afa46cd`.
- **Decision State:** **DECIDED**
- **Qualification State:** **OPEN** (Pending isolated container job pass).

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
- **Qualification State:** **OPEN** (Pending isolated container job pass).

---

## IB-04: Paired Evaluation Protocol & Decision Criteria

Evaluation protocol parameters for Gate 3 and superiority verification:
- **Evaluation Dataset:** 30 paired tasks
- **Primary Metric:** Pass rate
- **Meaningful Benefit Threshold:** +15 percentage points over baseline
- **Maximum Permissible Overhead:** 1.8× baseline resource consumption
- **Uncertainty Rule:** Overlapping confidence intervals mean no superiority claim may be asserted.
- **Decision State:** **DECIDED**
- **Qualification State:** **OPEN** (Pending isolated container job pass).

---

## Qualification Verification Path

1. Live environment probe output recorded in `docs/probe-ubuntu-24.04.txt`.
2. Execute `.github/workflows/contracts-linux.yml` with the container-isolated job (`isolated`).
3. Verify test suite passes inside `node:22-bookworm` container with bubblewrap available.
4. Close Gate 0 qualification upon green run of the isolated job.
