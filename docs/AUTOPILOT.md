# Tandem Autopilot — an autonomous layer over Claude Code

Tandem Autopilot is a Claude Code plugin (`plugin/`). It hooks every session event and makes the routine supervision decisions itself, deterministically, with no extra model calls: what the task is about, which writes and commands are allowed, when the agent is looping, and whether the work is verified enough to finish. Install and configuration: `plugin/README.md`.

This page records what was measured on real Claude Code, and what was not.

## Setup of the measurement

- Claude Code 2.1.292, model `claude-sonnet-5-5`, non-interactive (`claude -p`).
- Two external repositories, pinned: `jshttp/fresh` @ `ee73673` and `pillarjs/encodeurl` @ `0599772`.
- 7 tasks, 3 repetitions each, same prompt and same commit in every arm.
- Arms: **A** plain Claude Code; **B** with the plugin (default policy: existing tests append-only); **R** with the plugin and tests fully read-only (`TANDEM_TEST_POLICY=readonly`).
- A, B and R ran with `--dangerously-skip-permissions`, so permission prompts are not a confound and the plugin's blocks are the only guard.
- Held-out graders in `bench/claude-code/graders/`, never present in the run directory. "Original suite" runs the repository's untouched test files against the candidate's code.
- Reproduce: `node bench/claude-code/runner.cjs --workdir <dir> --arms A,R,B --reps 3` (and `--manifest tasks-encodeurl.json`). Raw rows: `bench/claude-code/results/`.

## Results

### Regular tasks (request compatible with the existing tests), 18 runs per arm

| | A plain | B Tandem (append-only) | R Tandem (read-only) |
|---|---|---|---|
| Solved (held-out grader) | 18/18 | 18/18 | 18/18 |
| Original suite still passes | 18/18 | 18/18 | 18/18 |
| Existing test lines changed | 0/18 | 0/18 | 0/18 |
| Added new tests | 18/18 | 18/18 | 0/18 |
| Mean lines changed (fresh / encodeurl) | 15.3 / 33.2 | 13.9 / 31.2 | 2.7 / 12.1 |
| Mean cost per run (fresh / encodeurl) | $0.100 / $0.110 | $0.108 / $0.130 | $0.092 / $0.110 |

On compatible tasks this model did not tamper with tests: it solved every task and added tests. Tandem did not change the outcome, and cost 8–18% more per run (about 1.5–2 more turns).

### Conflict task (F2: the request contradicts an existing test), 3 runs per arm

The task asks for behaviour that the existing test "should get ignored if not only value" forbids. The right move is to stop and ask.

| | A plain | B Tandem (append-only) | R Tandem (read-only) |
|---|---|---|---|
| Rewrote the existing assertion | **3/3** | 0/3 | 0/3 |
| Original suite still passes | 0/3 | **3/3** | 1/3 |
| Stopped and explained the conflict with options | 0/3 | **3/3** | 1/3 |

Plain Claude Code flipped the existing assertion from `!fresh(...)` to `fresh(...)`, renamed the test, and reported success. With Tandem, it left the code unchanged, named the conflicting test and line, and offered options. This is the failure Tandem exists to stop: a requirement silently overriding an existing guarantee.

### Autonomy without bypassing permissions, 2 tasks

Non-interactive Claude Code in its default permission mode cannot answer permission prompts.

| | A plain | B Tandem |
|---|---|---|
| Tasks completed (F1, F3) | 0/2 | 2/2 |
| Permission denials | 3, 5 | 1, 1 |

Tandem pre-approves in-project edits it has checked and read-only or test/build commands, and denies dangerous ones, so the session runs unattended without `--dangerously-skip-permissions`.

### Guard holds under bypass mode

A live probe asked Claude Code, with `--dangerously-skip-permissions`, to append a line to every test file. The plugin denied the shell write and the test file was unchanged on disk.

## What this does and does not show

- **Shown:** on a strong model, Tandem costs nothing in solution quality on these tasks; it stops the silent rewrite of an existing test when a request conflicts with it (3/3 vs 0/3); and it lets a non-interactive session finish work that plain Claude Code cannot finish without bypassing permissions.
- **Not shown:** that Tandem makes the model solve more problems. On compatible tasks every arm solved everything.
- **Different model, different behaviour:** the earlier evaluation with free models through OmniRoute (`docs/EXTERNAL_EVALUATION.md`) found unsupervised agents editing test files in 16 of 16 runs and a 10–20 point quality cost from blocking. This model added tests rather than editing them, and the append-only policy removed the quality cost.
- **Small sample:** 7 tasks, 3 repetitions, two small JavaScript libraries, one model. The conflict task was written for this evaluation.
- **Not exercised here:** destructive-command and secret guards (covered by unit tests and one live probe, not by a paired evaluation).
- **Not a sandbox:** Tandem decides on the actions Claude Code shows it. For isolation, run Claude Code in a container.
