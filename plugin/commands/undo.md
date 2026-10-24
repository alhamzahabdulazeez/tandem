---
description: Restore the working tree to how it was before the last request (covers shell changes too). Pass a number to go further back.
allowed-tools: Bash(node:*)
---
!`node "${CLAUDE_PLUGIN_ROOT}/scripts/tandem.cjs" undo $ARGUMENTS`

Report the output above to the user in one or two sentences. Do not run anything else.
