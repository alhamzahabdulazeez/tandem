# Tandem Evaluation Summary

Tandem is a supervisory harness that keeps AI coding agents focused on their assigned tasks. During software development, coding agents often wander outside the files they are supposed to edit, modifying tests or build scripts to make their changes appear green. Tandem intercepts file edits in real time and blocks unauthorized modifications before they reach the disk.

To measure its impact, we ran a controlled benchmark of 30 programming tasks (60 total runs) comparing an unassisted coding agent against the same agent monitored by Tandem.

## Summary of Findings

| Finding | Unassisted Agent | Tandem-Monitored Agent | Takeaway |
| :--- | :--- | :--- | :--- |
| **Code Correctness** | 83.3% (25 of 30) | 80.0% (24 of 30) | Both setups write working code at virtually the same rate. |
| **Scope Discipline** | 0.0% (0 of 30) | 100.0% (30 of 30) | Unassisted agents always modified test runners; Tandem blocked every out-of-scope edit. |
| **External Replication** | 0.0% (0 of 16) | 100.0% (17 of 17) | Scope violations reproduced on external repos not authored by the user: unassisted agents modified test runners in 16 of 16 completed runs (9/9 in fresh, 7/7 in encodeurl, 0/0 valid in escape-html); Tandem blocked all 42 attempts. |
| **Refusal Redirection** | 58.8% (10 of 17, passive) | 75.0% (15 of 20, active) | Active refusal steering resolved tool budget exhaustion across external repositories: pass rates rose on fresh from 60.0% (6 of 10) to 70.0% (7 of 10) with 2.0 fewer tool calls (19.8 → 17.8), and on encodeurl from 57.1% (4 of 7) to 80.0% (8 of 10) with 2.8 fewer tool calls (20.4 → 17.6). |
| **Accepted Solutions** | 0.0% (0 of 30) | 80.0% (24 of 30) | Intercepting bad edits allowed correct solutions to pass validation without disqualification. |
| **Code Churn** | 46.1 lines changed | 18.8 lines changed | Tandem reduced total modified lines by 59.3%, keeping diffs clean and minimal. |

## Why This Matters

The difference in accepted solutions is entirely due to write-time scope enforcement, not improved problem-solving. When unassisted, the agent solved the task correctly 83.3% of the time, but invariably tampered with the test harness to register tests. Tandem intercepted 35 unauthorized write attempts, rejected them with clear error messages, and prompted the agent to keep its changes inside the target implementation file. This resulted in surgical, single-file edits with minimal overhead (7% more tool calls, 10% more wall-clock time).

## Limitations

This evaluation tested single-file bug fixes and feature additions in JavaScript codebases. In a real-world repository with complex multi-file refactoring, permissible edit boundaries must be carefully configured to prevent blocking legitimate edits. Additionally, the unassisted baseline had no edit restrictions, meaning any test file modification immediately failed validation. Furthermore, the benchmark tasks were authored for this evaluation and several implied registering a test, which may have induced the test-runner edits; this has not been controlled for.

**Remaining Solution Quality Gap:** On `encodeurl` the unassisted arm solved 100% (7 of 7) while Tandem-assisted reached 80% (8 of 10), and on `fresh` 88.9% (8 of 9) versus 70% (7 of 10). Scope enforcement still costs roughly 10-20 points of solution quality on external repositories.
