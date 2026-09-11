---
name: review
description: Review the current changes for defects before committing
---

Review only what has changed, not the whole codebase.

For each changed file, check:
1. Logic errors and unhandled edge cases.
2. Error handling — what happens when the input is missing or malformed.
3. Anything that would fail the type checker or the tests.
4. Anything added that was not asked for.

Report findings ordered by severity. If you find nothing, say so plainly rather
than inventing a concern.
