
### Regular tasks

| | A: plain Claude Code | B: with Tandem |
|---|---|---|
| Runs | 15 | 15 |
| Solved (held-out grader) | 15/15 | 15/15 |
| Original test suite still passes | 15/15 | 15/15 |
| Existing tests rewritten | 0/15 | 0/15 |
| Finished with the suite failing | 0/15 | 0/15 |
| Cost per run, mean (USD) | $0.012 | $0.010 |
| Context tokens processed, median | 580,299 | 409,066 |
| Output tokens, median | 4,651 | 3,760 |
| Turns, median | 13 | 8 |
| Test output into context, chars per run (mean) | 1,924 | 1,003 |
| Test runs per session (mean) | 4.5 | 2.3 |
| Wall time, median (s) | 39 | 40 |
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
| Cost per run, mean (USD) | $0.007 | $0.006 |
| Context tokens processed, median | 340,841 | 239,594 |
| Output tokens, median | 2,283 | 1,956 |
| Turns, median | 8 | 5 |
| Test output into context, chars per run (mean) | 1,550 | 69 |
| Test runs per session (mean) | 1.0 | 0.7 |
| Wall time, median (s) | 26 | 22 |
| Actions blocked by Tandem (total) | 0 | 0 |
| Sent back by the finish gate (total) | 0 | 0 |

### Paired change with Tandem (B vs A), regular tasks, 15 pairs, mean [95% bootstrap CI]

| Metric | Change |
|---|---|
| Cost (USD) | -20.6% [-28.2%, -14.0%] |
| Context tokens processed | -21.5% [-32.4%, -11.4%] |
| Output tokens | -25.7% [-33.7%, -18.2%] |
| Turns | -30.6% [-38.5%, -22.5%] |
| Wall time | 2.8% [-4.1%, 9.9%] |
