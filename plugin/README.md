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
| After every edit | Syntax-checks the file (JS, JSON, Python) and tells Claude immediately if it no longer parses. |
| Before Claude finishes | Runs the project's own tests. If they fail, Claude is sent back to fix the implementation, up to 3 rounds; the same failure twice means hand back to you. Failures that already existed before the session do not block. A test weakened through any route (editor or shell) blocks. Writes a receipt. |

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
  "protect": []
}
```

- `mode`: `enforce` (default), `observe` (log decisions, never block), `off`.
- `allowTestEdits`: `null` decides from the prompt; `true`/`false` forces it.
- `protect`: extra path regexes that are write-protected.
- Environment overrides: `TANDEM_MODE`, `TANDEM_AUTO_APPROVE`, `TANDEM_TEST_COMMAND`.

State and receipts live in `.git/tandem/` (never in your working tree). The latest receipt is `.git/tandem/last-receipt.md`.

## Limits

- Not a sandbox. It decides on the actions Claude Code shows it; a program Claude runs can still do what that program does. For isolation, run Claude Code in a container.
- Shell parsing is pattern-based. It catches the common destructive forms, not every possible one.
- The verification gate is only as good as the project's tests. With no test command, it checks syntax only and says so.
- If the plugin itself errors, it fails open (the action proceeds) and logs to `.git/tandem/events.log`.

## Develop

```bash
node plugin/test/run.cjs          # unit + end-to-end hook tests
claude plugin validate ./plugin
```
