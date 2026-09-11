---
name: ship
description: Final check before committing
---

Run in order and report each result:

1. Type check.
2. Tests.
3. Linter, if one is configured.

Then:
4. List every file you changed.
5. Confirm nothing outside the working set was touched.
6. Write a commit message describing what changed and why.

If any check fails, stop. Do not commit and do not offer to.
