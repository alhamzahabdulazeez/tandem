# tandem-check

Check what an uncommitted change put at risk — model-free, zero-config.

## Usage

```bash
npx tandem-check
```

Or install globally:

```bash
npm install -g tandem-check
tandem-check
```

Flags:
- `--verify`: run test suite to verify changes
- `--json`: output results as JSON
- `--quiet`: suppress stdout, communicate via exit code only

## Example output

```
tandem-check

What changed:
  src/format.js (+12, -4)
  test/format.test.js (+2, -1)
  Total: 2 file(s) changed (+14, -5 lines)

Blast radius:
  src/format.js (2 dependents):
    src/index.js
    src/cli.js
  test/format.test.js (0 dependents)

Uncovered changes:
  src/format.js: exported symbol 'formatDuration' is not referenced by any test file

Test weakening:
  none

Verdict: Finding: 1 issue(s) detected (1 uncovered export).
```

## Exit codes

- `0` — Clean (verified or clean tree)
- `1` — Finding detected (uncovered export, test weakening, or test failure)
- `2` — Cannot determine (not a git repository)
- `3` — Clean but unverified (uncommitted changes found with 0 static findings)
