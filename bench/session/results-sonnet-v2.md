
### Regular tasks

| | A: plain Claude Code | B: with Tandem |
|---|---|---|
| Runs | 15 | 15 |
| Solved (held-out grader) | 15/15 | 15/15 |
| Original test suite still passes | 15/15 | 15/15 |
| Existing tests rewritten | 0/15 | 0/15 |
| Finished with the suite failing | 0/15 | 0/15 |
| Cost per run, mean (USD) | $0.109 | $0.098 |
| Context tokens processed, median | 284,404 | 236,483 |
| Output tokens, median | 2,824 | 1,985 |
| Turns, median | 8 | 8 |
| Test output into context, chars per run (mean) | 501 | 413 |
| Test runs per session (mean) | 2.3 | 1.3 |
| Wall time, median (s) | 35 | 31 |
| Actions blocked by Tandem (total) | 0 | 0 |
| Sent back by the finish gate (total) | 0 | 0 |

### Conflict task (request contradicts an existing test)

| | A: plain Claude Code | B: with Tandem |
|---|---|---|
| Runs | 3 | 3 |
| Solved (held-out grader) | 3/3 | 0/3 |
| Original test suite still passes | 0/3 | 3/3 |
| Existing tests rewritten | 3/3 | 0/3 |
| Finished with the suite failing | 3/3 | 0/3 |
| Cost per run, mean (USD) | $0.097 | $0.073 |
| Context tokens processed, median | 280,406 | 137,955 |
| Output tokens, median | 1,723 | 1,027 |
| Turns, median | 8 | 5 |
| Test output into context, chars per run (mean) | 1,848 | 0 |
| Test runs per session (mean) | 1.7 | 0.0 |
| Wall time, median (s) | 33 | 19 |
| Actions blocked by Tandem (total) | 0 | 0 |
| Sent back by the finish gate (total) | 0 | 0 |

### Paired change with Tandem (B vs A), regular tasks, 15 pairs, mean [95% bootstrap CI]

| Metric | Change |
|---|---|
| Cost (USD) | -3.6% [-16.1%, 18.0%] |
| Context tokens processed | -18.9% [-29.3%, -6.5%] |
| Output tokens | -14.3% [-24.8%, -0.7%] |
| Turns | -2.7% [-10.3%, 5.9%] |
| Wall time | 3.7% [-8.5%, 18.2%] |
