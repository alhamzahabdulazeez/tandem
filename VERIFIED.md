# Verified behaviour

Observed directly, September 2026, by inspecting the installed package and running the code.
Evidence, not assumption. Do not assume beyond it.

## Host: `@earendil-works/pi-agent-core` 0.85.1

**The package is ESM-only.** `"type": "module"`, and its exports map exposes `import` only.
`require()` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`. This is why `src/adapter/*.mjs`
exists and why the Tandem core is loaded there through `createRequire`.

**There is no `runSession`, `run`, or `default` export.** The API is a class, `Agent`,
taking `AgentOptions`. An earlier draft of this project targeted invented function names and
could not have worked.

### The three hooks that carry all five decision points

Read from the package's own type definitions:

| Option | Signature | Serves |
|---|---|---|
| `beforeToolCall` | `(ctx) => { block?, reason?, terminate? }` | DP1 · DP2 · DP3 · working-set guard |
| `afterToolCall` | `(ctx) => { content?, isError?, terminate? }` | DP1 feedback |
| `shouldStopAfterTurn` | `(ctx) => boolean` | DP5 |

The package documents `beforeToolCall` precisely: returning `{ block: true }` prevents the
tool from executing, and `reason` becomes the error text the model receives.

**This is why the working-set guard is preventive here.** Claude Code 2.1.267 was tested and
its equivalent block was *not* honoured — the call proceeded anyway.

Also available and useful later: `transformContext` for memory injection, and
`prepareNextTurn` for retry control.

## Facts that cost real debugging time

**1. `.cjs` is required for the core.** A `.js` file breaks inside any project declaring
`"type": "module"`. Observed.

**2. A BOM breaks `JSON.parse`.** PowerShell writes one by default. Every JSON read here
strips a leading `\uFEFF`.

**3. Glob replacement order matters.** Rewriting `**` to `.*` before `*` to `[^/]*` lets the
`*` inside `.*` be rewritten again, producing `^src\/.[^/]*$` — which matches `src/a.ts` but
rejects `src/core/a.ts`. Found by testing the bridge, not by review. Four regression tests
now cover it.

## Host volatility

Pi moved package scope from `@mariozechner` to `@earendil-works` and changed its SDK surface
within four months. This is why `src/adapter/` is the only place permitted to import it, and
why a test enforces that boundary.

## Measured in this codebase

| Check | Result |
|---|---|
| Host loads via dynamic import | yes — 149 exports, `Agent` present |
| `beforeToolCall` block shape confirmed against type definitions | yes |
| Bridge blocks a write outside the working set | yes |
| Bridge allows a write inside it | yes, after the glob fix |
| Bridge allows reads | yes |
| Dependency graph resolves `./x.js` to `x.ts` | yes — 3 importers in a 4-file fixture |
| DP1 returns real compiler errors | yes — `src/util.ts:1:54 TS2322` |
| DP3 fires before editing a widely imported file | yes |
| Repair bound stops on the third identical failure | yes |
| A project without TypeScript disables the gate and continues | yes |
| Seeded fixture type-checks clean before any task | yes |
| All four codebase specs fail before implementation | yes |
| Reference solution for t07 passes 6/6 | yes |
| Test suite | 62 passed, 0 failed |

## NOT verified — the remaining risk

**A live session has never been run.** No model was called from this environment; there is
no API key and no network route to a provider here.

Specifically unverified:

1. Constructing `Agent` end to end — it needs a configured stream function, model and tool
   set. `src/adapter/run.mjs` builds the hooks and stops at that point by design rather than
   guessing the construction call.
2. Whether `shouldStopAfterTurn` returning `false` reliably continues the turn in practice.
3. Actual pass rates. That is what `tandem bench` exists to find out.

Everything in the first table is measured. Everything in this list is not. The distinction
is the point.

---

## Simulation, September 2026

The host package was installed and the bridge was driven through a full agent loop using the
exact context shapes the host passes — `beforeToolCall`, `afterToolCall`,
`shouldStopAfterTurn` — on a real four-file TypeScript project. No model was called; the
simulation exercises the wiring, the gates and the ordering, which is everything except the
provider round trip.

| Step | Expected | Observed |
|---|---|---|
| Write outside the working set | prevented, file never created | blocked, `fs.existsSync` false |
| Write valid code inside `src/` | silent | silent |
| Write a real type error | compiler text returned to the model | `src/bad.ts:1:14 TS2322` |
| Edit a file three others import | DP3 evaluated | evaluated; silent because the importers were healthy |
| Read a file | nothing fires | nothing fired |
| Turn ends having used tools | does not finish | `false` |
| Turn ends with no tool calls | DP5 fires | attempt 1/2 |
| Same failure again | attempt 2/2 | attempt 2/2 |
| Same failure a third time | bounded repair stops | `BOUNDED_REPAIR`, turn ends |

### Two defects the simulation found

**1. Glob replacement order.** `src/**` compiled to `^src\/.[^/]*$` and rejected
`src/core/config.cjs`. Rewriting `**` to `.*` before `*` to `[^/]*` let the `*` inside `.*`
be rewritten again. Four regression tests now cover nested and sibling paths.

**2. Scoped type checking was silently empty.** Passing explicit files to `tsc` makes it
ignore `tsconfig.json` and emit **TS5112**, so DP3 reported "these importers already fail"
with no errors listed. The gate now runs the project check and **filters the parsed errors**
to the named files, which is correct for every toolchain including `npm run typecheck`. A
healthy scope passes even when the wider project is broken. Three regression tests cover it.

Both were found by running the code, not by reading it.

**Test suite after the fixes: 65 passed, 0 failed.**

---

## Agent construction, September 2026

`src/adapter/run.mjs` was rewritten against the real `AgentOptions` interface, read from the
package's own type definitions:

```
new Agent({ streamFn, initialState: { systemPrompt, model, tools },
            beforeToolCall, afterToolCall, shouldStopAfterTurn })
await agent.prompt(text)
```

| Check | Result |
|---|---|
| `Agent` constructs with this exact option shape | **yes** |
| `prompt()` runs to completion and returns | **yes — exit 0** |
| The three hooks are passed as the interface declares them | **yes** |
| The real loop was observed invoking the hooks | **no — see below** |

### What stopped the last check, stated plainly

`StreamFn` is typed as:

```
(model, context, options?) => AssistantMessageEventStream | Promise<AssistantMessageEventStream>
```

`AssistantMessageEventStream` is a specific type owned by the provider package, not a plain
async generator. Two attempts to fake it with a hand-rolled generator produced a stream the
loop could not parse, so no tool call was ever emitted and the hooks were never reached.

Under this project's own rule — a task that fails twice stops and reports — the attempt was
abandoned rather than guessed at a third time.

**What this means.** The hooks are passed exactly as `AgentOptions` declares them, and the
simulation in the previous section proves they behave correctly when invoked with the real
context shapes. What has not been observed is the host calling them during a live turn.
That requires either a real provider or a correctly constructed `AssistantMessageEventStream`
from the provider package.

**This is one task, and it is written up in `FINISH.md`.** It is the last gap.

---

## Project context, September 2026

An audit found three features inert: `init` wrote `TANDEM.md`, `.tandem/skills/` and
`.tandem/commands/` to disk, and **nothing read them**. They had worked under the previous
host because that host loaded such files natively. This host does not.

`src/context/project.cjs` now loads all three. Verified on a real project:

| Check | Result |
|---|---|
| Conventions reach the preamble | yes — 827 bytes injected |
| Template comment blocks are stripped before injection | yes |
| Skill **index** reaches the preamble | yes |
| Skill **bodies** stay out of the preamble | yes — lazy |
| First mutation injects `contract-first` and `verify-each-step` | yes |
| A gate failure injects `bounded-repair` and `deterministic-first` | yes |
| A first-time import injects `no-guessing` | yes |
| `/plan add caching` expands to the command body plus the task | yes |
| An unknown `/command` is reported, not expanded | yes |
| `doctor` reports conventions, skills and commands | yes |

**Why lazy.** Published measurement is unambiguous: adding context past a threshold makes
results worse, and a targeted 5k retrieval beat a 100k summary on the same task. Loading
five skill bodies into every session would spend context to lose accuracy. Only the index is
always present; a body arrives when its trigger fires, once per session.

Triggers are derived from events — first mutation, gate failure, first-time import — never
chosen by a model. Two tests assert that every shipped skill has a trigger and every trigger
names a shipped skill.

**Test suite: 78 passed, 0 failed.**

---

## Full audit, September 2026

The shipped archive was extracted to a clean directory and audited end to end.

| # | Check | Result |
|---|---|---|
| 1 | File inventory | 71 files, no strays |
| 2 | Syntax of all 18 executable files | all parse |
| 3 | Validity of all 16 JSON files | all parse |
| 4 | Orphan modules | none — every module is an entry point or referenced |
| 5 | Module loading and exports | all 13 CJS modules load with exports |
| 6 | ESM modules | both load; `run.mjs` imports without side effects |
| 7 | Test suite | 79 passed, 0 failed |
| 8 | CLI surface | `--version` and help render |
| 9 | Benchmark tasks | 10 valid, 6 greenfield and 4 seeded, 84 assertions total |
| 10 | Benchmark reporting path | all three rows populate |
| 11 | Full lifecycle on a real project | 11 steps, all as specified |
| 12 | Negative and edge cases | 15 checks, all pass |
| 13 | Documentation against code | package manifest, docs and claims agree |

### The defect this audit found

`bench/run.cjs` split results by `family === 'greenfield'`, but the task files label their
families `novel`, `multifile` and `codebase`. **The greenfield row would have printed 0/0 on
every run** while the overall row looked healthy — a silent reporting failure, not a crash.

Greenfield is now derived by exclusion: anything not seeded against the fixture. A test
asserts the literal match cannot return.

### Lifecycle observed

Session start injects rules, conventions and the skill index — 1830 bytes, bodies excluded.
`/review` expands. A write outside the working set is blocked. The first mutation injects
`contract-first`, `verify-each-step` and `no-guessing`. Editing a file with three importers
raises DP3 then DP1. A real type error returns `src/bad.ts:1:14 TS2322`. Three finishes
produce attempt 1/2, attempt 2/2, then `BOUNDED_REPAIR`. The error is counted and promoted
to memory. With the file fixed and a working test script, `finish` returns clean.

One apparent failure was traced and was not a defect: `npm init -y` writes a test script that
exits 1 by design, so the gate correctly reported failing tests.

**Test suite after the audit: 79 passed, 0 failed.**

---

## Live self-test on Android arm64, September 2026

Run by the project owner on a Samsung S24 Ultra under Termux, Node 24.18.0.
**15 of 16 checks passed.** The one failure was the live model turn, skipped for want of a
model id.

| Check | Result |
|---|---|
| Host package resolves, `Agent` is a constructor | pass |
| Tool factories present | `createBashTool`, `createEditTool`, `createReadTool`, `createWriteTool` |
| **A stream function is discoverable** | **`setDefaultStreamFn`, `streamProxy`** |
| All ten gate checks on a real toolchain | pass |
| Write outside the working set blocked, file never created | pass |
| DP3 fires for a file with three importers | pass |
| DP1 returns `src/bad.ts:1:14 TS2322` | pass |
| Repair bound: continue, continue, `BOUNDED_REPAIR` | pass |
| A healthy project finishes clean | pass |

**This is the first confirmation on Android arm64**, a platform that could not be tested
where the code was written. Every gate behaved identically to Linux x64.

### What it resolved

The adapter had been looking for a stream function named `streamFn`, `simpleStream` or
`createStreamFn`. The host exports **none of those**. It exports `streamProxy`, typed
`(model, context, options) => ProxyMessageEventStream`, which matches the `StreamFn` shape.

The host also exports **no `getModel` helper**. Model objects come from the provider layer
(`createModels` in `@earendil-works/pi-ai`).

Both were corrected in `src/adapter/run.mjs`, and two tests now assert the adapter looks for
what the host actually exports rather than for invented names. This closes the largest
remaining unknown — found by running the code on real hardware, not by reading it.

### A packaging note worth keeping

`npm i -g` does **not** make a package importable from an unrelated directory. Installing it
into the project (`npm i @earendil-works/pi-agent-core`) is what makes the host resolvable.

**Test suite: 81 passed, 0 failed.**

---

## A live session against a real model, September 2026

**The gap this closes: "a live session has never been run" (above) is no longer true.**
`tandem run` was driven against a real model — `openai/gpt-oss-120b` on Groq — from this
Termux environment, repeatedly, across dozens of runs. Confirmed directly:

| Check | Result |
|---|---|
| `tandem run "<task>"` reaches the provider and streams a real completion | **yes** |
| The model calls Tandem's own tools (`read`, `write`, `edit`, `bash`) | yes |
| `beforeToolCall`, `afterToolCall`, `shouldStopAfterTurn` fire during a real turn, not just the simulation | yes |
| A file is actually created by the model's `write` tool call | yes |
| The full `bench/run.cjs` harness completes real off/on runs against the live model | yes — see `bench-results/` and `README.md#results` |

**What made this possible: `node_modules` did not exist in this project at session start.**
Zero packages — not even the peer dependency. Every earlier "verified" entry above assumed a
working host import, but nothing in this checkout actually had one installed. `import(HOST_PACKAGE)`
in `session.mjs` was silently failing on every single invocation, which is why the benchmark
"was not producing valid results": most runs never reached the model at all.

Fixed with `npm i @earendil-works/pi-agent-core@0.85.1`, which also pulled in `@earendil-works/pi-ai`
(the package `resolveModel`/`resolveStreamFn` in `run.mjs` need). After that, `loadHost()`
resolves, `Agent` constructs, and `agent.prompt()` drives a real turn.

### Constraints hit while measuring, and what they mean

**1. Groq enforces a 200,000-tokens-per-day cap, separate from the known 8,000/minute one.**
Not documented anywhere before this session. Confirmed directly from the provider's own 429
body:

```
Rate limit reached ... on tokens per day (TPD): Limit 200000, Used 198974, Requested 1427.
Please try again in 2m53.232s.
```

It behaves as a continuous token-bucket refill, not a fixed-clock daily reset: two refusals
8 seconds apart showed `Used` drop by 18 (≈ 2.3 tokens/sec, matching `200000 / 86400`).
Practical effect: a single `tandem run` costs roughly 1,500–7,000 tokens depending on how
many turns it takes, so a ten-task, five-repetition benchmark (~100 runs) needs on the order
of several hundred thousand tokens — more than this tier grants in a day. No pacing between
runs fixes this; it is a budget ceiling, not a burst-rate limit. `bench/run.cjs` now retries
a refusal using the wait the provider's own error text specifies, and stops the whole
benchmark (recording what is valid so far) the moment a run is still refused after
retrying — see `## Persisted fixes` in `README.md` and the tests under "benchmark
provider-refusal retry" in `test/run.cjs`.

**2. The agent command must never be spawned with `shell:true`.** Confirmed by using it:
task prompts contain parentheses and backticks (for example t01's prompt includes
`` parseGlyphDate(input: string): ... ``), which a shell would reinterpret. `bench/run.cjs`
already spawned the agent via `spawnSync(parts[0], argv, {...})` with no `shell` key — this
was already correct; verified it stays correct under real prompts rather than assumed.

**3. Termux cannot write to `/tmp`, but `os.tmpdir()` already avoids it.** `os.tmpdir()`
resolves to `/data/data/com.termux/files/usr/tmp` here, honouring Termux's own `TMPDIR`, not
a hardcoded `/tmp`. `bench/run.cjs`'s work and score directories (`fs.mkdtempSync(path.join(os.tmpdir(), ...))`)
already used this correctly — no code change was needed, only confirmation that the existing
code does not hardcode `/tmp` anywhere. (Grepped to be sure: it doesn't.)

### A second defect this session found: `doctor` lied about the host

`tandem doctor` reported **"host NOT INSTALLED"** even after the fix above, while `tandem run`
worked. Cause: `doctor` (in `bin/tandem.cjs`) checked host status through `src/adapter/pi.cjs`'s
`loadHost()`, which uses plain CJS `require()`. The host is ESM-only, so that `require()`
always throws, and always will, regardless of whether the package is installed — `doctor`'s
host check could never have reported "installed" for this host. `tandem run` was unaffected
because `run.mjs` already used the correct async, dynamic-`import()`-based `loadHost()` in
`session.mjs`.

Fixed by routing `doctor`'s host check through `session.mjs`'s loader instead — the same one
`run` uses. `src/adapter/pi.cjs`'s `require()`-based `loadHost` is kept (it is still exercised
directly by a unit test proving a missing host is reported, not crashed on) but is no longer
used to answer "is the host installed" for a real user. A regression test spawns
`tandem doctor` for real and asserts the host name appears and "NOT INSTALLED" does not.

### A third defect: gate and scoring commands were silently broken on Termux

Found by running `test/live.mjs`'s toolchain checks, which exist precisely to catch this
kind of thing. `npx tsc --version` in the benchmark's own prepared scaffold failed:

```
sh: 1: tsc: not found
```

despite `typescript` being installed (`node_modules/.bin/tsc` existed). Traced to the actual
cause with `node_modules/.bin/tsc` run directly:

```
/usr/bin/env: bad interpreter: No such file or directory
```

**Termux's `/usr/bin/env` is not at the path npm's shebang wrappers hardcode**
(`#!/usr/bin/env node`). This breaks *any* locally-installed Node binary invoked through its
shebang — `npx tsc`, `npx vitest`, `npx biome`, and, transitively, `npm test`/`npm run
typecheck` when those scripts themselves call such a binary. Termux ships its own fix —
`termux-exec`, an `LD_PRELOAD` shim installed at `$PREFIX/lib/libtermux-exec-ld-preload.so`
— but it was not present in `LD_PRELOAD` for commands spawned via `child_process` in this
session's shell, so it was not inherited by any subprocess Tandem spawned either. Confirmed
directly:

| Command | `LD_PRELOAD` unset | `LD_PRELOAD` = the termux-exec library |
|---|---|---|
| `npx tsc --version` | `sh: 1: tsc: not found` (exit 127) | `Version 5.9.3` (exit 0) |
| `npx vitest run` | `sh: 1: vitest: not found` (exit 127) | runs for real |

**Why this matters more than a benchmark-only bug.** `src/gates/run.cjs`'s `exec()` is the
single place `tandem run` itself executes the typecheck, test, and lint gates — DP1, DP3 and
DP5 all go through it. On Termux, every one of those gate calls was failing the same way,
which `typecheck()`/`tests()` correctly treat as a real failure (`parseFailed: true, raw:
"sh: 1: tsc: not found"`) and would have reported to the model as if the type checker itself
were broken. Separately, `bench/run.cjs`'s own scoring step (`countTypeErrors` and the
`npx vitest run` that decides `passed`) used the same broken calls — meaning **`passed` could
not have been `true` for any run recorded in this session's benchmark data**, regardless of
what the agent wrote. See the caveat this forced onto `README.md#results`.

**Fixed** in both `src/gates/run.cjs` and `bench/run.cjs` with a small `termuxExecEnv()`
helper: when `process.env.PREFIX` indicates Termux and the termux-exec library file exists,
its path is added to `LD_PRELOAD` for every spawned subprocess. A no-op — empty object,
nothing added — on any other platform, so this cannot regress Windows/Linux/macOS behaviour.
Verified directly (see table above) and covered by three tests: the helper is a no-op off
Termux, it produces a well-formed `LD_PRELOAD` under Termux, and — on a machine that actually
is Termux with the scaffold prepared — `exec('npx tsc --version', ...)` now returns exit 0.

**Test suite: 99 passed, 0 failed.**

---

## An alternate provider tried and found incompatible, September 2026

Groq's daily quota (above) forced a look at an alternate endpoint:
`generativelanguage.googleapis.com/v1beta/openai` (an OpenAI-compatible surface),
`gemini-3.1-flash-lite`. Two real defects found by running it, not by reading docs.

**1. Fixed.** Every request 400'd: `Invalid JSON payload received. Unknown name "store":
Cannot find field.` The host's `openai-completions` module unconditionally sends OpenAI's
`store: false` field unless the endpoint matches its own hardcoded non-standard-provider
list, which cannot cover every OpenAI-compatible endpoint Tandem might be pointed at (D-09:
it names none of them). The host exposes a documented override for exactly this. Fixed in
`src/adapter/run.mjs`'s `resolveModel()` fallback: `compat: { supportsStore: false }`. The
value sent was always `false` regardless of whether the field was present, so this is safe
for every endpoint, not particular to one provider — confirmed by continuing to use it
against Groq afterward with no change in behaviour.

**2. Found, not fixed — a real gap in the pinned host version.** With the fix above, the
first tool call succeeds, but every turn after it 400s:

```
Function call is missing a thought_signature in functionCall parts. This is required
for tools to work correctly...
```

That endpoint requires an opaque `thought_signature` token (returned in a non-OpenAI-standard
`extra_content.google.thought_signature` field) to be echoed back on every subsequent turn
that replays a tool call. Checked the host's message-serialization code directly: it has
related plumbing (`toolCall.thoughtSignature` → `parseLegacyEncryptedReasoningDetail`), but
it is wired to a different, OpenRouter-style reasoning-detail format, not this field. A
session on that endpoint can make exactly one tool call before every further turn fails —
not a fixable configuration gap, a capability the host does not have for this endpoint yet.
Not attempted: patching the host package directly (not a legitimate fix inside Tandem's own
architecture, and would not survive a fresh install).

---

## Key rotation, September 2026

Even with the Termux fix above, Groq's 200,000-token/day cap (§ above) meant one key could
not carry a full five-repetition, ten-task run (~100 runs, several hundred thousand tokens
needed). Given eight independent keys, `bench/run.cjs` now accepts `TANDEM_API_KEYS`
(comma-separated; `TANDEM_API_KEY` alone still works as a one-key fallback) and rotates to
the next key the instant a run comes back "provider refused," retrying that same run
immediately — no wait, since a refused request is never billed (observed: quota ticks down
between refusals, never up). Only once every key has been tried once in a pass does it fall
back to the pre-existing wait-and-retry policy, unchanged, as the final fallback before the
run stops itself.

**Measured result: a complete run.** `--repeat 5` across all 10 tasks finished in full — 100
runs, 0 invalid, 68 key rotations along the way, no stop-early. See `README.md#results` for
the numbers. Two earlier same-day attempts with a single key had gotten 6 and then 0 valid
runs before exhausting it; rotation is what closed that gap, not a bigger backoff.

The rotation log line is `KEY_ROTATED <position>/<total>` — numbers only, generated by a
function (`formatKeyRotated`) that never receives the key values at all, only their count and
position. Verified by a test that feeds real-looking key strings through the whole rotation
path and asserts none of them appear in the logged line.

**Test suite: 108 passed, 0 failed.**
