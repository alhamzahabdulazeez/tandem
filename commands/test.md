---
name: test
description: Write tests for code that lacks them
---

1. Identify which changed code has no test covering it.
2. Read the existing tests first and match their style, framework and structure.
3. Write tests for the real behaviour, including boundaries and failures.
4. Run them.

Do not write a test that cannot fail. Do not modify existing tests to make a new
one pass.
