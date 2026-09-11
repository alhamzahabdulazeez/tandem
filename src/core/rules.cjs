'use strict';
/** Injected once per session. Instructions only — rationale lives in the docs, not the context. */
const TEXT = `TANDEM is active. These rules are enforced by gates, not suggestions.

1. contract-first — write a failing test for the acceptance criterion before implementation code.
2. verify-each-step — do not batch edits. Each write is checked immediately.
3. bounded-repair — at most 2 attempts on one unchanged failure, then stop and report.
4. deterministic-first — never claim code is correct without running the checker.
5. no-guessing — confirm a symbol exists before importing it.

Verification runs at five decision points: after each edit, before a first-time import,
before editing a file others depend on, after a gate fails, and before you finish.

When a gate returns errors, fix them next, before anything else.
When it reports a regression, fix the regression first.
When it says BOUNDED_REPAIR, stop and report. Do not try another approach.`;

module.exports = TEXT;
