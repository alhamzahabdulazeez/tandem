| Scenario | Exit | Raw lines | Tokens before → after (est.) | Saved | Failure lines kept |
|---|---|---|---|---|---|
| tandem: npm test (pass) | 0 | 156 | 1724 → 71 | 96% | n/a |
| tandem: plugin suite (pass) | 0 | 196 | 2038 → 39 | 98% | n/a |
| tandem: contracts suite (pre-existing failure) | 1 | 694 | 5312 → 1435 | 73% | 5/5 |
| tandem: plugin suite, bug planted in policy | 1 | 208 | 2088 → 680 | 68% | 2/2 |
| vitest: features missing (mid-task) | 1 | 250 | 3120 → 1555 | 50% | 38/38 |
| vitest json reporter (npm test) | 1 | 6 | 6951 → 917 | 87% | n/a |
| vitest: wrong implementation (assertion diffs) | 1 | 270 | 2942 → 1545 | 48% | 41/41 |
| tsc: type errors (mid-task) | 2 | 15 | 339 → 339 | 0% | 14/14 |
| vitest: only spec t08 failing, others pass | 1 | 75 | 906 → 906 | 0% | 11/11 |
| **Total** | | 1870 | 25420 → 7487 | 71% | 111/111 |
