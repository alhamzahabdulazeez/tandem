---
name: deterministic-first
description: Run the checker instead of judging correctness yourself
---

Never state that code is correct, compiles, or passes without running the tool
that decides it.

- "Does this type-check?" -> run the type checker, report its output.
- "Do the tests pass?" -> run them, report the result.
- "Is this valid?" -> run the linter.

A tool costs nothing and does not hallucinate. Your judgement does both.
