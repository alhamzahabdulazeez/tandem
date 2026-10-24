# Tandem Autopilot for Claude Code

An autonomous supervision layer that runs inside Claude Code as hooks. It makes the routine decisions a reviewer would make — in real time, with no extra model calls — so Claude Code can work unattended without quietly damaging the project.

## Install

```text
/plugin marketplace add alhamzahabdulazeez/tandem
/plugin install tandem@tandem
```

Or for one session, from a clone: `claude --plugin-dir ./plugin`.

Requires Node 18+ and git. Works with any model or gateway Claude Code is pointed at (Anthropic, OmniRoute, any `ANTHROPIC_BASE_URL`); Tandem itself never calls a model.

## What it decides, automatically

| When | Decision |
|---|---|
| Session start | Injects a short brief: the project's test command, the rules below, the most-imported files. Starts a background baseline run of the test suite. |
| Each request | Derives the task scope from the prompt: which files it names, and whether it asks for test changes. Tells Claude up front. |
| Before every write | Blocks edits to existing tests unless the request asks for tests; blocks removing assertions or adding `.skip`/`.only` even when it does; protects `.env`, keys, lockfiles, CI config and the supervisor's own settings. Every refusal says where to make the change instead. Safe in-project edits are pre-approved, so no permission prompt. |
| Before every shell command | Blocks `git reset --hard`, `git clean -f`, `git push`, mass `rm -rf`, `sudo`, `curl … \| sh`, reading secrets, package publishing, and shell writes to test files. Breaks loops: the same command a 4th time with no code change in between is refused. Pre-approves read-only and test/lint/build commands. |
| Before every write (2) | Refuses content that adds a credential (AWS, GitHub, Anthropic, OpenAI, Slack, Stripe, Google, GitLab, npm, Hugging Face, Telegram, private keys, URL passwords, high-entropy `key = "..."`). The secret is never echoed back. |
| Before a test/build command | Rewrites it (via `updatedInput`) to run through `scripts/run.cjs`: a passing run comes back as its summary, a failing run as every failure line plus context and the summary; the full output goes to `.git/tandem/logs/`. Also replaces `\| tail -N` / `\| head -N` pipes, which hide failures and report exit 0. |
| Before an install | `npm/pnpm/yarn/bun add\|install`, `pip/uv/poetry` installs: refused if the name does not exist on the registry, or was first published under 14 days ago (`allowPackages` exempts). No network = no opinion. |
| Before `git commit` | Refuses if what will be committed (staged, or everything for `git add -A && git commit` / `commit -a`) contains a credential. |
| Each request | Takes a checkpoint of the whole working tree (untracked and shell changes included) as a commit under `refs/tandem/`; your index, branch and stash are untouched. |
| After every edit | Syntax-checks the file (JS, JSON, Python) and tells Claude immediately if it no longer parses. Checks every import the edit added resolves (relative file, declared/installed package, importable Python module) and says so at once. |
| After compaction | Re-injects the task: current and earlier requests, scope, files changed, refusals not to retry, last test result, repair rounds, unresolved imports. |
| Before Claude finishes | Refuses while an added import still does not resolve. Points out added `debugger`/`breakpoint()` and `console.log`/`print` in files that never logged, once per request. Runs the project's own tests. If they fail, Claude is sent back to fix the implementation, up to 3 rounds; the same failure twice means hand back to you. Failures that already existed before the session do not block. A test weakened through any route (editor or shell) blocks. Writes a receipt. |

## Measured on real Claude Code

Paired runs, same prompt, same commit, arm A plain Claude Code and arm B with this plugin. Held-out graders, never visible to the agent. Both arms ran with permission checks bypassed, so the plugin's blocks are the only guard. Full data: `bench/claude-code/`.

See `docs/AUTOPILOT.md` for the numbers and their limits.

## Configure (optional)

`.claude/tandem.json` in the project:

```json
{
  "mode": "enforce",
  "autoApprove": true,
  "testCommand": null,
  "testTimeoutSec": 300,
  "maxRepairs": 3,
  "repeatLimit": 3,
  "allowTestEdits": null,
  "allowPush": false,
  "protect": [],
  "compactOutput": true,
  "checkImports": true,
  "checkPackages": true,
  "allowPackages": [],
  "checkSecrets": true,
  "checkpoints": true,
  "checkHygiene": true
}
```

- `mode`: `enforce` (default), `observe` (log decisions, never block), `off`.
- `allowTestEdits`: `null` decides from the prompt; `true`/`false` forces it.
- `protect`: extra path regexes that are write-protected.
- Each `check*`, `compactOutput` and `checkpoints` switch turns one feature off.
- Environment overrides: `TANDEM_MODE`, `TANDEM_AUTO_APPROVE`, `TANDEM_TEST_COMMAND`, `TANDEM_TEST_POLICY`, `TANDEM_COMPACT`.

## Commands

`/tandem:undo [n]`, `/tandem:redo`, `/tandem:checkpoints`, `/tandem:receipt`, `/tandem:stats`. Outside Claude Code: `node plugin/scripts/tandem.cjs <command>` in the project.

State and receipts live in `.git/tandem/` (never in your working tree). The latest receipt is `.git/tandem/last-receipt.md`.

## Limits

- Not a sandbox. It decides on the actions Claude Code shows it; a program Claude runs can still do what that program does. For isolation, run Claude Code in a container.
- Shell parsing is pattern-based. It catches the common destructive forms, not every possible one.
- The verification gate is only as good as the project's tests. With no test command, it checks syntax only and says so.
- Secret and import checks are pattern-based: they catch the common forms, not every one. The package check needs the registry to answer within 4 s.
- Checkpoints are skipped when a repository has more than 5,000 untracked, un-ignored files (it would slow every prompt).
- If the plugin itself errors, it fails open (the action proceeds) and logs to `.git/tandem/events.log`.

## Develop

```bash
node plugin/test/run.cjs          # unit + end-to-end hook tests
claude plugin validate ./plugin
```
