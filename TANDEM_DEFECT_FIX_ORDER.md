# TANDEM — Defect Fix Work Order

**Audience:** a coding agent (Claude Code) working in the `tandem` repository, branch `main`.
**Baseline:** commit `e6cc5e4`, 1,192 tests passing, `node bin/audit.cjs` reporting 0 defects across 6 detectors.
**Scope:** seven defects, D-01 through D-07, in priority order.

---

## 0. How to use this file

One task per session. One commit per task. Stop after each task's Acceptance output.

Execute in order. D-01 and D-02 unlock adoption; everything after them is refinement that is worth less until someone outside this repository has actually run Tandem.

---

## 1. Operating rules

**R-01 — Verify before claiming.** Every completion claim must cite a command you ran in this session and its real output. A claim without a command is a defect, not a result.

**R-02 — The auditor is the gate.** `node bin/audit.cjs` must exit 0 and `node test/all.cjs` must pass before any commit. If a change makes the auditor fire, fix the change, not the auditor.

**R-03 — Never lower a detector's bar.** Do not edit `bin/audit.cjs` to make a check pass, do not weaken a test, do not add `.skip`, do not edit a held-out grader in `bench/*/graders/` or `bench/first-slice/spec.test.cjs`.

**R-04 — Measured, not assumed.** Any task whose success is a number (D-04, D-05) is complete only when a paired run produced that number. Predicted improvements are not results.

**R-05 — Arm A data is frozen.** Never re-run, edit or regenerate the unassisted-arm records in `bench/paired/state.json` or the external evaluation state. They are the baseline every comparison rests on.

**R-06 — Two-attempt rule.** If a task's Acceptance fails twice, stop, write the failure to `REPORT.md`, and end the session.

**R-07 — No new dependencies** without stating the reason and the exact package in your report, and never for D-01, which must stay dependency-free.

**R-08 — Report the cost.** If a fix improves one metric and worsens another, both numbers go in the commit message and the docs.

---

## 2. What is not in this file

Two known defects are out of scope because no code change resolves them.

- **Physical isolation.** `unshare` and `bwrap` are unavailable on both Termux and GitHub-hosted runners; this is recorded in `docs/QUALIFICATION.md` with probe evidence. It needs a self-hosted Linux host, not a patch. Leave the current Docker runtime profile and its documented limits exactly as they are.
- **Zero external users.** Fixed by releasing, not by building. D-07 prepares the release; adoption follows it.

---

# D-01 — Ship `tandem check` as a standalone tool

**Why this is first.** Every other Tandem feature requires the user to adopt a harness. `tandem check` requires nothing: no model, no API key, no provider, no session. It runs after any coding agent, including agents that are not Tandem. It is the only part of this project a stranger will try within five seconds.

**Goal.** A separate published package that a developer installs and runs on their own repository with one command, and which prints what an uncommitted change put at risk.

**Files**
- create `packages/tandem-check/` containing `package.json`, `bin/check.cjs`, `README.md`, and the source it needs
- move or copy the model-free logic from `src/check/checker.cjs` into it
- keep the existing `tandem check` subcommand working by delegating to the new module

**Spec**

1. Zero runtime dependencies. Node >= 18. CommonJS. No import of anything under `src/adapter/`, `src/contracts/`, `src/control/`, or `src/store/` — if the checker currently reaches into those, extract the minimum it needs rather than pulling the tree in.
2. It never reads an API key, never opens a network socket, never spawns a model. Add a test that asserts the package source contains no reference to `TANDEM_API_KEY`, `TANDEM_BASE_URL`, `fetch(`, or `https://`.
3. Command surface: `npx tandem-check` in a git repository. Flags: `--json`, `--quiet`, `--verify`. Nothing else.
4. Output, plain text, no colour codes, no absolute paths:
   - what changed (files, lines added and removed)
   - blast radius: which files import what changed, via the existing depgraph
   - uncovered change: changed exported symbols no test file references
   - test weakening: removed assertions, added `.skip` / `.only` / `xit`, `passWithNoTests`, deleted test files, snapshot changes alongside source changes
   - a one-line verdict and an exit code
5. Exit codes: `0` clean, `1` a finding, `2` cannot determine (not a git repository), `3` clean but unverified.
6. The `README.md` of the package is at most one screen: one sentence, one example of real output you produced, the four exit codes, the install command. No architecture, no PRD references.

**Acceptance**
```bash
node packages/tandem-check/bin/check.cjs ; echo "exit=$?"
cd /tmp && rm -rf checkdemo && git clone --depth 1 https://github.com/jshttp/fresh checkdemo && cd checkdemo \
  && echo "// scratch" >> index.js \
  && node <path-to>/packages/tandem-check/bin/check.cjs ; echo "exit=$?"
node test/all.cjs 2>&1 | tail -2
node bin/audit.cjs | tail -2
```
Paste all four outputs. The second one proves it runs on a repository that is not this one.

**Commit** `D-01 ship tandem-check as a standalone model-free tool`

---

# D-02 — Work with Claude Code and other real agents

**Why.** Tandem currently drives `@earendil-works/pi-agent-core`. Almost nobody uses that. The agents developers actually run are Claude Code, Cursor, Codex and similar. Until Tandem attaches to one of them, its measured result cannot be reproduced by anyone else.

**Goal.** Scope enforcement works inside Claude Code, or, if the host will not honour a block, the failure is proven and documented rather than assumed.

**Files**
- create `integrations/claude-code/` with a hook script, a `settings.json` fragment, and a `README.md`
- create `docs/INTEGRATIONS.md`

**Spec**

1. **Probe first, build second.** Claude Code's `PreToolUse` hook is documented to block a tool call when the hook exits 2. Whether it does so on the installed version is an empirical question, and there is prior evidence in this project that it did not. Write a minimal hook that always exits 2 for a write to one named file, run Claude Code against a scratch repository, and record whether the write actually happened. Paste the real transcript. Do not proceed to step 2 on the assumption that it works.
2. **If the block is honoured:** implement the real hook. It reads the tool call from stdin, resolves the target path, calls the same scope logic used in `src/index.cjs` `beforeTool`, and exits 2 with the redirecting message on a violation — the message must name the writable files and instruct the agent to implement the change there, exactly as the in-process version does, because that redirection is what recovered 10 to 23 points of solution quality in the external evaluation.
3. **If the block is not honoured:** do not fake it. Ship a `PostToolUse` variant that detects the out-of-scope write immediately after it lands, reverts that single file with `git checkout --` scoped to it, and returns the same redirecting message to the model. Document plainly that this is detection-and-revert, not prevention, and that it depends on the file being tracked by git.
4. `docs/INTEGRATIONS.md` states, per host: what is supported, what mechanism is used, what was probed, and what is not supported. No aspirational entries.
5. Add a test that the hook script's scope decision matches `src/index.cjs` `beforeTool` for the same inputs, so the two implementations cannot drift.

**Acceptance**
```bash
node integrations/claude-code/hook.cjs < integrations/claude-code/fixtures/blocked-write.json ; echo "exit=$?"
node integrations/claude-code/hook.cjs < integrations/claude-code/fixtures/allowed-write.json ; echo "exit=$?"
node test/all.cjs 2>&1 | tail -2
node bin/audit.cjs | tail -2
```
Plus the real Claude Code transcript from step 1.

**Commit** `D-02 add Claude Code integration with probed enforcement mechanism`

---

# D-03 — Derive the allowed-file list instead of hand-writing it

**Why.** Today the user must list writable files by hand. Getting it wrong blocks legitimate work; forgetting it disables enforcement entirely. This is the largest friction in daily use.

**Goal.** Tandem proposes a scope from the repository itself, the user confirms or edits it, and the confirmed scope persists.

**Files**
- create `src/control/scope-derive.cjs`
- modify `bin/tandem.cjs` (add `tandem scope`)
- modify `test/all.cjs`

**Spec**

1. `derive(cwd, cfg, task)` returns `{ allowed, reasons, confidence }`. Sources, in order: files named in the task text; the modules those files import and are imported by, from `src/context/depgraph.cjs`; nothing else. Test files are never in `allowed` unless the task text names one explicitly.
2. `reasons` explains every entry in one short sentence — "named in task", "imported by <file>". A scope the user cannot understand is a scope they will disable.
3. `confidence` is `high` when the task named a file, `low` when everything was inferred. On `low`, `tandem scope` prints the proposal and asks for confirmation rather than applying it.
4. `tandem scope "<task text>"` prints the proposal; `tandem scope --save` writes it to `.tandem/scope.json`; `src/index.cjs` reads that file when no explicit allow-list is given.
5. Pure function: no model, no network, no clock.

**Acceptance**
```bash
node bin/tandem.cjs scope "fix the eslint detection in src/gates/detect.cjs"
node bin/tandem.cjs scope "make the linter work"
node test/all.cjs 2>&1 | tail -2
node bin/audit.cjs | tail -2
```
The first must return `high` confidence naming `src/gates/detect.cjs`; the second must return `low` and ask rather than guess.

**Commit** `D-03 derive allowed-file scope from the repository`

---

# D-04 — Close the remaining solution-quality gap

**Why.** On external repositories the unassisted arm solved 88.9% and 100%; the Tandem arm reached 70% and 80%. Scope enforcement still costs roughly 10 to 20 points. This is the defect most likely to be raised by a sceptical reader, and the one this project currently discloses rather than fixes.

**Goal.** Reduce that gap with measured interventions, and report what remains.

**Spec**

Run these as separate arm-B-only experiments on `jshttp/fresh` and `pillarjs/encodeurl`. Arm A data stays frozen (R-05). After each, record `stage2_passed` for both repositories and compare against the current 70% and 80%.

1. **Scope in the opening instruction.** Today the agent discovers the boundary by hitting it. Put the writable-file list in the first user message instead. Hypothesis: fewer wasted calls, higher completion.
2. **Raised tool-call ceiling.** Every failed arm B run changed zero lines in the target file after burning its budget on blocked paths. Re-run at 40 and at 60 with the redirecting message active, and report the ceiling at which the gap stops shrinking.
3. **One retry after the first refusal.** On the first scope block, give the agent one extra tool call that does not count against its budget, so a single wrong guess does not cost the task.

Keep whichever interventions measurably help, discard the rest, and record every arm of the experiment including the ones that did not help — a discarded intervention is a result.

**Acceptance**

`docs/EXTERNAL_EVALUATION.md` gains a section reporting, per repository and per intervention: `stage2_passed` before and after, mean tool calls, and the residual gap against arm A. Then:
```bash
node bin/audit.cjs | tail -2
node test/all.cjs 2>&1 | tail -2
```

If the gap does not close, say so in the limitations paragraph of `README.md` and `docs/RESULTS_SUMMARY.md` and keep the existing honest wording. A failed experiment that is reported is a success of method.

**Commit** `D-04 measure interventions against the solution-quality gap`

---

# D-05 — Multi-file scope

**Why.** The entire evaluation covers single-file tasks. Real work is multi-file, and a scope mechanism that only handles one file is a demo.

**Goal.** Scope enforcement over a set of files and directory patterns, evaluated on tasks that genuinely need more than one file.

**Spec**

1. The allow-list accepts glob patterns and directory prefixes, reusing `globToRegExp` from `src/core/config.cjs` rather than a second implementation.
2. Add at least 6 multi-file tasks to `bench/paired/tasks.json`, each with a held-out grader and an allow-list of 2 to 4 files, each objectively checkable.
3. Run both arms on those tasks only. Report scope compliance, `stage2_passed`, lines changed and overhead separately from the single-file results — never pooled with them.

**Acceptance**
```bash
node bench/paired/runner.cjs --summary
node bin/audit.cjs | tail -2
```
Plus a new unpooled section in `docs/PAIRED_EVALUATION_RESULTS.md`. If multi-file tasks show a worse result than single-file ones, report that; it is the honest boundary of the current design.

**Commit** `D-05 support and evaluate multi-file scope`

---

# D-06 — Make the repository readable

**Why.** 49,700 lines and a 2,348-line PRD for a product whose thesis is one paragraph. No contributor and no evaluator will get past that.

**Goal.** A first-time reader understands the project in two minutes.

**Spec**

1. `README.md`: one sentence, the findings table, the install command, a ten-line quickstart, then a short "how it works". Everything else moves below a `## Details` heading or out to `docs/`.
2. Move `TANDEM_MASTER_EXECUTION_PRD_V1.md` and the five `FIRST_SLICE_RUN_00*.md` files into `docs/archive/` with a one-line index explaining they are the development record, not documentation.
3. Add `docs/ARCHITECTURE.md`: at most two pages covering the five decision points, the scope mechanism, and where the code for each lives.
4. Delete nothing. Everything moves; the audit trail is part of what makes this project credible.

**Acceptance**
```bash
wc -l README.md          # must be under 150
ls docs/archive/
node bin/audit.cjs | tail -2
node test/all.cjs 2>&1 | tail -2
```

**Commit** `D-06 restructure documentation for first-time readers`

---

# D-07 — Release

**Why.** Every remaining question about this project — is it useful, which defect actually hurts, does the 16-of-16 pattern hold elsewhere — is answered by users, not by more building.

**Spec**

1. Complete the third external repository. `component/escape-html` returned 20 of 20 invalid runs on provider quota. Re-run it when quota allows and add its unpooled results, or record it as permanently unassessed with the reason.
2. Publish `packages/tandem-check` to npm. Verify with `npm pack` and a clean install in a temporary directory before publishing.
3. Write `docs/FINDINGS.md`: a short public write-up of the scope-violation result. Lead with the number — unassisted agents modified test files in 16 of 16 completed runs across three repositories the author does not own — name the repositories and commits, show one real diff of an agent adding tests to a test file it was told not to touch, and state the limitations already recorded. No product pitch in it. The finding stands on its own.
4. Add `CONTRIBUTING.md`: how to run the suite, the auditor, and the paired evaluation.

**Acceptance**
```bash
npm pack --dry-run --workspace packages/tandem-check
node bin/audit.cjs | tail -2
```
Plus the published package URL, or the reason publication did not proceed.

**Commit** `D-07 prepare and publish the first release`

---

# 3. Reporting

After every session, overwrite `REPORT.md`:

```
# Session report — <ISO date>

## Task
D-0x  DONE | BLOCKED | PARTIAL

## Acceptance output
<real pasted output>

## Numbers that changed
<metric, before, after, command that produced it>

## Costs
<anything this fix made worse>

## Deviations
<anything not specified in this file, and why>

## Unbacked claims
<every statement above not backed by a command you ran, corrected>
```

---

# 4. Priority

| Task | Fixes | Worth doing before users exist? |
|---|---|---|
| D-01 | Compatibility, adoption | Yes — it is the adoption path |
| D-02 | Works with real agents | Yes — without it nobody can reproduce the result |
| D-03 | Setup friction | Yes — cheap |
| D-06 | Readability | Yes — one hour |
| D-07 | Zero users | Yes — this is what makes the rest worth doing |
| D-04 | Quality gap | After release — disclosed honestly meanwhile |
| D-05 | Multi-file | After release — largest effort, least certain payoff |

D-01, D-02, D-03, D-06 and D-07 are roughly three days of work. D-04 and D-05 are larger and should wait for evidence from real users about which one actually matters.
