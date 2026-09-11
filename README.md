# tandem

A CLI coding agent that verifies at **development decision points**, not only at the end.

Every mainstream coding agent checks its work when it thinks it has finished. Tandem checks
at five points derived from what the agent is about to do — including **before it edits a
file that other files depend on**, which is where agents fail most on real codebases.

---

## Turning it off

```bash
TANDEM_HOOKS=off
```

Every gate exits immediately. Nothing to uninstall.

Documented first on purpose: you should know how to stop a tool before you trust it to run
automatically.

---

## Install

```bash
npm i -g @earendil-works/pi-agent-core
npm i -g tandem

cd your-project
tandem init
tandem run "add expiry support to the Store class"
```

`tandem doctor` reports which gates are active, which are disabled and why, the five
decision points, and which file in your project has the most importers. It never prints
tokens, keys, or environment values.

---

## The five decision points

| Point | Fires | Gate |
|---|---|---|
| **DP1** | after every write or edit | type-check the edited file |
| **DP2** | before a symbol imported for the first time this session | reject unresolved symbols |
| **DP3** | **before editing a file others import** | type-check the importers first |
| **DP4** | after a gate fails | diagnose under a repair bound |
| **DP5** | before finishing | full gates plus regression check |

Every point is derived from an event. **No model decides when to verify.**

**DP3 is the one nobody else has.** The other four examine the file that changed. DP3
examines what the change is about to break. Published benchmarking finds that every agent
performs measurably worse on existing codebases than on greenfield ones — because they
verify what they touched, not what depends on it.

---

## What else it does

| | |
|---|---|
| **Regression blocking** | A repair that removes a previously passing test is rejected and named |
| **Bounded repair** | Two attempts on one unchanged failure, then it stops instead of burning your budget |
| **Preventive working-set guard** | A write outside your source directories is blocked before it happens |
| **Adaptive density** | Weak models are checked after every edit; strong models only at the points that still matter |
| **Deterministic memory** | An error seen three times is promoted verbatim into the next session's context. No model decides what is worth remembering |
| **Silent degradation** | A gate whose tool is missing disables itself and gets out of the way |
| **Project conventions** | `TANDEM.md` is injected every session; skills load only when their trigger fires |
| **Slash commands** | `tandem run "/plan add caching"` expands to the command's instructions |
| **Provider neutral** | Any model, any endpoint. No provider is named anywhere in `src/` — a test enforces it |

## What it does not do

Model routing, quotas, or cost accounting — gateways already do that, and duplicating them
is a permanent maintenance debt.
Sandboxing — real isolation needs an OS or VM boundary, and a partial one is worse than none.

---

## A missing tool is not an error

If your project has no type checker, that gate **disables itself silently**. The run
continues, the reason is noted once, and nothing breaks.

A Python project with Tandem installed behaves exactly like one without it.

This is the single most important behaviour in the tool: something that breaks your
workflow when it cannot help is worse than nothing at all.

---

## Connecting a model

Tandem names no provider. It reads four variables of its own and passes them to the host:

| Variable | Meaning |
|---|---|
| `TANDEM_API_KEY` | your key, forwarded through the host's own key hook |
| `TANDEM_BASE_URL` | the endpoint, for example an OpenAI-compatible `/v1` URL |
| `TANDEM_API` | wire format, default `openai-completions` |
| `TANDEM_PROVIDER` | a label, default `custom` |

Any compatible endpoint works — a gateway, a direct provider, or a local server.

## Configuration

Everything is optional. With no configuration Tandem reads your `package.json` and infers
the commands.

`tandem.json` in your project root:

| Key | Default | Meaning |
|---|---|---|
| `typecheckCommand` | inferred | Per-project type check |
| `testCommand` | inferred | Full test run |
| `workingSet` | `src/**`, `test/**`, `tests/**`, `lib/**` | Writable paths |
| `maxRepairs` | `2` | Attempts on one unchanged failure |
| `blockOnRegression` | `true` | Reject repairs that break passing tests |
| `dependentThreshold` | `3` | Importers needed to trigger DP3 |
| `memoryThreshold` | `3` | Times an error must recur before it is remembered |
| `verificationDensity` | `auto` | `auto`, `dense`, or `sparse` |
| `lintCommand` | none | Optional lint gate |
| `exclude` | `node_modules/**`, `dist/**`, `build/**`, `coverage/**`, `.tandem/**` | Never writable, even if inside `workingSet` |
| `maxErrorsToModel` | `10` | Errors shown per gate report, after dedupe |
| `gateTimeoutMs` | `120000` | Timeout for a single gate command |

---

## Results

**The full design, measured: 5 of 5 repetitions, all 10 tasks, both arms — 100 runs, 0 invalid.**

```bash
tandem bench --repeat 5 --agent "node bin/tandem.cjs run"
```

Measured 2026-09-11 against `openai/gpt-oss-120b` on Groq — see
`bench-results/bench-2026-09-11T12-13-01-305Z.json`.

| | pass rate | 95% Wilson interval | n |
|---|---|---|---|
| overall — off | 2/50 — 4.0% | [1.1%, 13.5%] | 50 |
| overall — on | 0/50 — 0.0% | [0.0%, 7.1%] | 50 |
| greenfield — off | 2/30 — 6.7% | [1.8%, 21.3%] | 30 |
| greenfield — on | 0/30 — 0.0% | [0.0%, 11.4%] | 30 |
| codebase — off | 0/20 — 0.0% | [0.0%, 16.1%] | 20 |
| codebase — on | 0/20 — 0.0% | [0.0%, 16.1%] | 20 |

Type errors surviving to the final answer: 125 (off) vs 115 (on).

**Verdict: INCONCLUSIVE — the difference is inside measurement noise.** This is what
`bench/run.cjs` itself reports (`differs: false` on every row, both families), not an
editorial summary. Every interval above overlaps its counterpart. SC-01 (PRD §8) is now
genuinely *measured*, not merely attempted, and the measured result is a null one: at n=50
per arm, against this weak model on this task set, hooks-on and hooks-off are statistically
indistinguishable. Hooks-on scored numerically lower everywhere the two arms differed at all
(2 passes off vs 0 on) — that is not evidence hooks hurt (the difference sits inside the
interval), but it is no support for "hooks help" either. **Repetition count achieved: 5 of 5,
the full design. Nothing here is preliminary.**

**Getting a complete run took key rotation.** A single Groq key carries an undocumented
200,000-token/day cap on top of the known 8,000-token/minute one; earlier attempts this same
day (2026-09-11) with one key got 0–6 valid runs before exhausting it — see `VERIFIED.md` for
that history in full. `bench/run.cjs` now accepts `TANDEM_API_KEYS` (comma-separated) and
rotates to the next key the instant one comes back "provider refused," logging
`KEY_ROTATED n/total` (never the key itself) — see `test/run.cjs`, group "benchmark key
rotation." Across this run, 68 rotations carried the benchmark through all 8 keys repeatedly,
and it finished without ever needing the older wait-and-retry fallback or stopping early.

**Read this as a floor effect, not a verdict on hooks.** 2/50 and 0/50 leave essentially no
room for a hooks-on/off difference to show up either way — a model failing 96–100% of tasks
on its own has nowhere left to fall, and nowhere for a verification layer to visibly catch it
either, before the hidden spec's tests decide the run regardless. That is a statement about
`openai/gpt-oss-120b` on this task set, not about DP1–DP5. Hand-scored by hand against a real
`tsc`/`vitest` run outside the harness (same session): failures were genuine — incomplete
implementations, real type errors, a hallucinated tool call — not a scoring artifact. The
mechanism this project is actually testing does work, independent of this population-level
result: `SMOKE.md` shows the same model, live, mid-task, receiving an unprompted DP1 typecheck
error and fixing exactly that error on its next turn, unprompted. So the null result above is
not "hooks don't do anything" — it is "this model is too weak for the benchmark to have
headroom to measure whether they help." Testing the thesis properly needs a stronger coding
model on Groq. An attempt to run one is not yet in this file: `qwen/qwen3.6-27b` and
`qwen/qwen3.8-27b` — the only larger/newer models on this account's catalog — are both capped
at 1000 output tokens/minute per request by Groq on this tier, which rejects tandem's normal
requests outright (`Request too large`) rather than throttling them; `groq/compound` turned
out to proxy through `openai/gpt-oss-120b` itself. No number for a stronger model appears here
because none was measured.

---

## Requirements and limits

- Node 22 or later.
- A host agent — see `VERIFIED.md` for the version this was built against.
- TypeScript and JavaScript projects. Other languages disable the gates cleanly.
- Windows, Linux and macOS. Android via Termux is best-effort.

No compatibility promise is made across host upgrades. Run `tandem doctor` after upgrading.
The host is imported in exactly one directory, `src/adapter/`, so a breaking change there
is a one-file fix. A test enforces that boundary.

---

## Status

The verification core is complete and covered by 99 passing tests (`npm test`). `tandem run`
has been driven against a real model (`openai/gpt-oss-120b` on Groq, from Termux) — the host
loads, the model streams a real completion, and it calls Tandem's own tools. That closes the
gap `FINISH.md` originally described ("a live session has never been run").

**Confirmed end to end:** a deliberate type error, DP1 catching it and reporting it to the
model **unprompted** on its next turn, and the model fixing it in response — see `SMOKE.md`
for the transcript. (Worth reading in full: the model fixed the reported error but dropped
the rest of that turn's actual task — a real weak-model limitation this run happened to
surface, not a flaw in the gate.)

**SC-01, the product's central claim, is now measured** (`## Results`): the full design, 5
repetitions across all 10 tasks, 100 runs, 0 invalid. The measured result is INCONCLUSIVE —
hooks-on and hooks-off are statistically indistinguishable against this weak model on this
task set, not "hooks help." That is a real, recorded finding, not an open question.

`VERIFIED.md` separates what was measured from what was not, in detail, dated by session.

## Documentation

| File | Contents |
|---|---|
| `docs/PRD.md` | What it does and why, with every claim labelled |
| `docs/TECH-SPEC.md` | **Superseded** — the original Claude Code hooks design, kept for the decision trail only |
| `VERIFIED.md` | Behaviour observed on real hardware |
| `SMOKE.md` | DP1 caught live, unprompted, against a real model — full transcript |
| `AGENTS.md` | Entry point for an agent working on this repository |
| `FINISH.md` | The three tasks that remain, and their acceptance conditions |

## Licence

MIT. Not affiliated with any model provider or agent vendor.

## Credits

Built on [pi-agent-core](https://github.com/badlogic/pi-mono) (MIT). Tandem adds the verification layer; the agent loop, terminal interface and provider layer are Pi's.
