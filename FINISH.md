# FINISH.md — completing Tandem

Give this file to a coding agent in this directory. Everything else is done and tested;
this file lists only what could not be verified without a live model.

**Read `VERIFIED.md` first.** It separates what was measured from what was not. Do not
re-derive the measured parts, and do not assume beyond them.

> **Update, 2026-09-11.** All three tasks below are done. Task 1 (connect a real provider) —
> see VERIFIED.md's "A live session against a real model" section. Task 2 (prove the loop end
> to end) — see `SMOKE.md`: DP1 caught a deliberate error, fed it back unprompted, and the
> model fixed it. Task 3 (measure) — see `README.md#results`: the full design, 5 repetitions,
> 100 runs, 0 invalid, verdict INCONCLUSIVE. This file's task descriptions below are left as
> originally written, for the record; treat this note as current.

## State on arrival (2026-09 draft; superseded — see the note above)

```
81 tests passing
core, gates, dependency graph, memory, repair, benchmark  — working
host bridge                                                — written against the real API, never run live
```

## Before anything — run the live self-test

```
npm run test:live -- --model <your-model-id>
```

Thirteen checks. Everything except the last three runs without a model and should already
pass. The last three are the gap. Paste the whole report back rather than summarising it.

## Task 1 — connect a real provider

`src/adapter/run.mjs` already constructs `Agent` correctly. Verified: it builds with the
real `AgentOptions` shape and `prompt()` runs to completion, exit 0.

What is missing is a **working `streamFn` and model**, which need a provider and a key.

`StreamFn` is typed `(model, context, options?) => AssistantMessageEventStream`. That stream
type belongs to the provider package, so a hand-rolled generator will not satisfy it — two
attempts confirmed this. Use the provider package's own stream builder rather than writing
one.

Do this:

1. Install the provider package the host expects and read how it exposes a stream function
   and a model object.
2. In `run.mjs`, replace the `streamFn` and `resolveModel` lookups with the real calls.
   Those two functions are the only places that need to change.
3. Configure a key through the host's own mechanism. **Tandem must not read a
   provider-specific environment variable** — decision D-09, enforced by a test.

**Acceptance:** `tandem run "write a function that adds two numbers to src/add.ts"` creates
the file and exits 0, and the run prints Tandem's verification banner.

**If the provider API does not match what you expect:** stop and report what it actually
exposes. Do not invent a call — that is how an earlier version of this project broke.

## Task 2 — prove the loop end to end

Break a file deliberately, then run a task that touches it.

**Acceptance:** the compiler error text appears in the model's next turn, and the model
fixes it without being told. Record the transcript in `SMOKE.md`.

## Task 3 — measure

```
tandem bench --repeat 5
```

Ten tasks, two arms, roughly one hundred runs. Resumable.

**Acceptance:** `bench-results/` contains a report, and `README.md` §Results carries the
real numbers with their intervals and one of three verdicts: helps, hurts, inconclusive.

**Never write a number into the README that was not produced by a run.**

## Rules while you work

- The host is imported only inside `src/adapter/`. A test enforces this.
- No provider, vendor or gateway may be named anywhere in `src/`. A test enforces this.
- Decision points are derived from events, never chosen by a model.
- Never modify a test to make it pass.
- If a task fails twice, stop and report. Do not try a third approach.
- `npm test` must pass before you finish.

## Not in scope

A graphical interface. Tandem is a terminal tool; the host owns the terminal surface. If a
visual layer is wanted later it belongs in a separate package that consumes `src/index.cjs`,
which is already host-independent.
