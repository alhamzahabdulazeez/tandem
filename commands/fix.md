---
name: fix
description: Fix the reported failure and nothing else
---

1. Run the checker and read the actual error. Do not guess from the symptom.
2. Fix the root cause, not the symptom.
3. Re-run the checker.
4. Confirm you broke nothing that previously passed.

Change only what the failure requires. If you believe something else needs
fixing, say so and leave it alone.

If the same failure survives two attempts, stop and report what remains.
