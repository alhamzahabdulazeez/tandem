---
name: no-guessing
description: Confirm a symbol exists before importing or calling it
---

Before using any function, type, or export from a package or another file:

1. Locate it — grep the type definitions or the source.
2. If you cannot find it, say so and stop. Do not guess a signature.

Inventing a plausible API is the most common failure of low-cost models and the
most expensive to unwind. The type checker will catch it on your next turn, so
guessing only costs you a round trip.
