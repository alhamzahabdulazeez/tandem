# Tandem for Claude Code

A Claude Code plugin that removes the things you have to watch for when an AI agent edits your code. It runs as hooks, decides deterministically, and never calls a model, so it works with any model or gateway Claude Code points at (Anthropic, OmniRoute, any `ANTHROPIC_BASE_URL`).

```text
/plugin marketplace add alhamzahabdulazeez/tandem
/plugin install tandem@tandem
```

Requires Node 18+ and git. Turn it off any time with `TANDEM_HOOKS=off`.

## What it fixes

| Claude Code problem | What Tandem does | Evidence |
|---|---|---|
| Says "done" while tests fail | Runs your tests before Claude may finish; sends it back to fix the code (max 3 rounds, then hands back to you) | [paired runs](docs/AUTOPILOT.md) |
| Rewrites a test so it passes | Existing tests are append-only unless you ask for test changes; removing assertions, `.skip`, `.only` is refused | 3/3 plain runs rewrote the test, 0/3 with Tandem ([docs](docs/AUTOPILOT.md)) |
| Test and build output floods the context | Test/build/lint/type-check output is compacted before Claude sees it: every failure line kept, full log saved | 71% fewer tokens on 9 real runs, 111/111 failure lines kept ([bench](bench/compact/results.md)) |
| `npm test \| tail -8` hides failures and reports exit 0 | Those pipes are run through the compactor instead, with the real exit code | live-tested |
| Imports a package or file that does not exist | New imports are checked as they are written; Claude cannot finish while one does not resolve | unit + live tested |
| Installs a hallucinated package name (slopsquatting) | `npm/pnpm/yarn/bun/pip/uv/poetry` installs of names that do not exist, or were first published under 14 days ago, are refused | checked live against npm and PyPI |
| Pastes an API key into source or commits one | Credentials are refused in writes, shell writes and `git commit` (15 formats + high-entropy assignments), never echoed back | 2 hits on 2,831 real files ([bench](bench/secrets/false-positives.cjs)) |
| Destructive shell commands | `git reset --hard`, `git clean -f`, `git push`, `rm -rf` of roots, `sudo`, `curl \| sh`, publishing, reading `.env` are refused | unit tested |
| Rewind does not cover shell changes | A checkpoint of the whole working tree at every request; `/tandem:undo` restores it, including files changed from the shell; `/tandem:redo` reverses it | live-tested |
| Forgets the task after compaction | The request, scope, files changed, refusals, last test result and open problems are re-injected after compaction | unit tested |
| Leaves `console.log`, `debugger`, `breakpoint()` | Pointed out once before finishing (only in files that did not already log) | unit tested |
| Permission prompts stop unattended runs | Checked in-project edits and safe read/test commands are pre-approved | 0/2 vs 2/2 tasks finished without bypassing permissions ([docs](docs/AUTOPILOT.md)) |
| Retries the same failing command forever | The same command a 4th time with no code change is refused | unit tested |

## Commands

| Command | Does |
|---|---|
| `/tandem:undo [n]` | Restore the working tree to before the last request (or n back) |
| `/tandem:redo` | Reverse the last undo |
| `/tandem:checkpoints` | List checkpoints |
| `/tandem:receipt` | The last verification receipt: files, tests, blocked actions |
| `/tandem:stats` | What Tandem blocked, verified and saved in this repository |

Configuration, every rule, and its limits: [plugin/README.md](plugin/README.md).

## Honest limits

- On a strong model and ordinary tasks, Tandem does not make Claude solve more problems; it changes what happens when things go wrong. Measured cost: +8% to +18% per run ([docs/AUTOPILOT.md](docs/AUTOPILOT.md)), measured before output compaction was added.
- Not a sandbox. It decides on the actions Claude Code shows it; shell parsing is pattern-based. For isolation, run Claude Code in a container.
- The test gate is only as good as your tests.

---

## Earlier results: the standalone harness (free models via OmniRoute)

A supervisory harness that keeps AI coding agents focused on their assigned tasks and blocks unauthorized modifications before they reach the disk.

| Finding | Unassisted Agent | Tandem-Monitored Agent | Takeaway |
| :--- | :--- | :--- | :--- |
| **Code Correctness** | 83.3% (25 of 30) | 80.0% (24 of 30) | Both setups write working code at virtually the same rate. |
| **Scope Discipline** | 0.0% (0 of 30) | 100.0% (30 of 30) | Unassisted agents always modified test runners; Tandem blocked every out-of-scope edit. |
| **External Replication** | 0.0% (0 of 16) | 100.0% (17 of 17) | Scope violations reproduced on external repos not authored by the user: unassisted agents modified test runners in 16 of 16 completed runs (9/9 in fresh, 7/7 in encodeurl, 0/0 valid in escape-html); Tandem blocked all 42 attempts. |
| **Refusal Redirection** | 58.8% (10 of 17, passive) | 75.0% (15 of 20, active) | Active refusal steering resolved tool budget exhaustion across external repositories: pass rates rose on fresh from 60.0% (6 of 10) to 70.0% (7 of 10) with 2.0 fewer tool calls (19.8 → 17.8), and on encodeurl from 57.1% (4 of 7) to 80.0% (8 of 10) with 2.8 fewer tool calls (20.4 → 17.6). |
| **Accepted Solutions** | 0.0% (0 of 30) | 80.0% (24 of 30) | Intercepting bad edits allowed correct solutions to pass validation without disqualification. |
| **Code Churn** | 46.1 lines changed | 18.8 lines changed | Tandem reduced total modified lines by 59.3%, keeping diffs clean and minimal. |

## Install

```bash
npm i -g @earendil-works/pi-agent-core
npm i -g tandem-hooks

cd your-project
tandem init
tandem run "add expiry support to the Store class"
```

*(Note: `tandem-hooks` is the package name; both `tandem` and `tandem-hooks` binary commands are installed.)*

---

## Turning it off

```bash
TANDEM_HOOKS=off
```

Every gate exits immediately. Nothing to uninstall.

Documented first on purpose: you should know how to stop a tool before you trust it to run
automatically.

---

## Commands and Diagnostics

`tandem check [--since <git-ref>] [--baseline]` runs active project diagnosis across three sections:
1. **Type errors**: project-wide compiler check, reporting deduplicated diagnostics.
2. **Affected importers**: git-aware blast radius identifying files importing your changed source files.
3. **Regressed tests**: regression detection against `.tandem/check-baseline.json` (written via `--baseline`).

`tandem capture` performs an honest, non-executing source tree inspection and reports a SHA-256 manifest.

`tandem doctor` reports which gates are active, which are disabled and why, the five
decision points, and which file in your project has the most importers. It never prints
tokens, keys, or environment values.

---

## Architecture: The five decision points

Every mainstream coding agent checks its work when it thinks it has finished. Tandem checks
at five points derived from what the agent is about to do — including **before it edits a
file that other files depend on**, which is where agents fail most on real codebases.

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

## Limitations

On `encodeurl` the unassisted arm solved 100% while Tandem-assisted reached 80%, and on `fresh` 88.9% versus 70%. Scope enforcement still costs roughly 10-20 points of solution quality on external repositories.

---

## Status

The verification core is complete and covered by 1,545 passing tests combined (114 in `npm test`, 672 in `npm run test:contracts`, 759 in `npm run test:units`). `tandem run`
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
