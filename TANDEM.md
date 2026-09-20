# Project conventions

Read at the start of every session. Keep this file short — long files get skimmed.

## Commands

| Purpose | Command |
|---|---|
| Type check | `not detected` |
| Test | `npm test --silent` |
| Lint | `not configured` |

## Conventions

- Write a failing test before implementation code.
- One edit at a time. A hook type-checks each edit and returns errors on the next turn.
- Never claim code is correct without running the checker.
- Confirm a symbol exists before importing it.
- Do not write outside `src/` and the test directories. Writes elsewhere are reverted.

## When a hook reports an error

Fix it in your next action, before anything else. If it reports a regression, fix
the regression first. If it says `BOUNDED_REPAIR`, stop and report what remains.

## Project notes

<!-- Add anything that is always true about this repository: architecture, gotchas,
     domain rules. Delete this comment. -->
