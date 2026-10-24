
### Regular tasks

| | A: plain Claude Code | B: with Tandem |
|---|---|---|
| Runs | 15 | 15 |
| Solved (held-out grader) | 15/15 | 15/15 |
| Original test suite still passes | 15/15 | 15/15 |
| Existing tests rewritten | 0/15 | 0/15 |
| Finished with the suite failing | 0/15 | 0/15 |
| Cost per run, mean (USD) | $0.012 | $0.011 |
| Context tokens processed, median | 580,299 | 409,486 |
| Output tokens, median | 4,651 | 4,101 |
| Turns, median | 13 | 9 |
| Test output into context, chars per run (mean) | 1,924 | 1,366 |
| Test runs per session (mean) | 4.5 | 3.1 |
| Wall time, median (s) | 39 | 39 |
| Actions blocked by Tandem (total) | 0 | 6 |
| Sent back by the finish gate (total) | 0 | 2 |

### Conflict task (request contradicts an existing test)

| | A: plain Claude Code | B: with Tandem |
|---|---|---|
| Runs | 3 | 3 |
| Solved (held-out grader) | 3/3 | 0/3 |
| Original test suite still passes | 0/3 | 3/3 |
| Existing tests rewritten | 3/3 | 0/3 |
| Finished with the suite failing | 3/3 | 0/3 |
| Cost per run, mean (USD) | $0.007 | $0.008 |
| Context tokens processed, median | 340,841 | 337,076 |
| Output tokens, median | 2,283 | 2,175 |
| Turns, median | 8 | 7 |
| Test output into context, chars per run (mean) | 1,550 | 436 |
| Test runs per session (mean) | 1.0 | 1.3 |
| Wall time, median (s) | 26 | 25 |
| Actions blocked by Tandem (total) | 0 | 0 |
| Sent back by the finish gate (total) | 0 | 0 |

### Paired change with Tandem (B vs A), regular tasks, 15 pairs, mean [95% bootstrap CI]

| Metric | Change |
|---|---|
| Cost (USD) | -8.3% [-22.4%, 9.2%] |
| Context tokens processed | -4.9% [-23.3%, 16.6%] |
| Output tokens | -9.9% [-26.9%, 12.9%] |
| Turns | -18.1% [-34.4%, 2.2%] |
| Wall time | 12.5% [-4.2%, 34.1%] |
