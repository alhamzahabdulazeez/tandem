---
name: verify-each-step
description: Check after each edit instead of batching edits
---

Make one edit, then let the checker run before making the next.

Do not write four files and then check. A hook type-checks every edit and
returns errors on your next turn; batching hides which edit broke what.

When errors come back, fix them before any new work.
