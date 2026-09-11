---
name: bounded-repair
description: Stop after the configured number of attempts on the same failure
---

Count your attempts against one unchanged failure.

- Attempt 1: fix it.
- Attempt 2: fix it.
- After that: stop. Report what remains and why you could not fix it.

Do not "try a different approach" after the bound is reached. Repeated blind
attempts make output worse, not better. Stopping is the correct outcome.
