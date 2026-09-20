# Tandem Evaluation Summary

Tandem is a supervisory harness that keeps AI coding agents focused on their assigned tasks. During software development, coding agents often wander outside the files they are supposed to edit, modifying tests or build scripts to make their changes appear green. Tandem intercepts file edits in real time and blocks unauthorized modifications before they reach the disk.

To measure its impact, we ran a controlled benchmark of 30 programming tasks (60 total runs) comparing an unassisted coding agent against the same agent monitored by Tandem.

## Summary of Findings

| Finding | Unassisted Agent | Tandem-Monitored Agent | Takeaway |
| :--- | :--- | :--- | :--- |
| **Code Correctness** | 83.3% (25 of 30) | 80.0% (24 of 30) | Both setups write working code at virtually the same rate. |
| **Scope Discipline** | 0.0% (0 of 30) | 100.0% (30 of 30) | Unassisted agents always modified test runners; Tandem blocked every out-of-scope edit. |
| **Accepted Solutions** | 0.0% (0 of 30) | 80.0% (24 of 30) | Intercepting bad edits allowed correct solutions to pass validation without disqualification. |
| **Code Churn** | 46.1 lines changed | 18.8 lines changed | Tandem reduced total modified lines by 59.3%, keeping diffs clean and minimal. |

## Why This Matters

The difference in accepted solutions is entirely due to write-time scope enforcement, not improved problem-solving. When unassisted, the agent solved the task correctly 83.3% of the time, but invariably tampered with the test harness to register tests. Tandem intercepted 35 unauthorized write attempts, rejected them with clear error messages, and prompted the agent to keep its changes inside the target implementation file. This resulted in surgical, single-file edits with minimal overhead (7% more tool calls, 10% more wall-clock time).

## Limitations

This evaluation tested single-file bug fixes and feature additions in a JavaScript codebase. In a real-world repository with complex multi-file refactoring, permissible edit boundaries must be carefully configured to prevent blocking legitimate edits. Additionally, the unassisted baseline had no edit restrictions, meaning any test file modification immediately failed validation. Furthermore, the benchmark tasks were authored for this evaluation and several implied registering a test, which may have induced the test-runner edits; this has not been controlled for.
