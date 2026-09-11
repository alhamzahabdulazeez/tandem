# AGENTS.md

You are working on **tandem** — a CLI coding agent that verifies at development decision
points rather than only at the end.

## Read first, in this order

1. `README.md` — what it does and how it is used.
2. `VERIFIED.md` — behaviour observed on real hardware. **Do not assume beyond it.**
3. `docs/PRD.md` — intent, scope, and every decision with its rationale.
4. `docs/TECH-SPEC.md` — **historical.** Specifies the original Claude Code hooks design,
   superseded by PRD.md v1.1 Appendix A (D-10: standalone CLI on a host agent core). Read
   it for the decision trail, not as a description of what exists.

## Non-negotiable

- **The host is imported only inside `src/adapter/`.** A test enforces this. Pi changed its
  package scope and SDK surface within four months; confining that risk is why the boundary
  exists.
- **No provider, vendor, or gateway may be named anywhere in `src/`.** A test enforces this.
- **A gate whose tool is missing exits cleanly and silently.** A tool that breaks a workflow
  when it cannot help is worse than no tool.
- **Decision points are derived from events, never chosen by a model.** If you find yourself
  adding a model call to decide when to verify, stop — that contradicts the design.
- **Runtime files use `.cjs`.** A `.js` file breaks inside ES-module projects.
- **Never modify a test to make it pass.**
- **Never put a number in the README that was not measured.**

## If a task fails twice

Stop and report. The same rule the product enforces on its users applies to you.

## Before you finish

```bash
npm test
```

All 81 tests must pass. If you add behaviour, add a test for it.
