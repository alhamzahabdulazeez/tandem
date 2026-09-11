# SMOKE.md — DP1 end-to-end, live model

FINISH.md's Task 2: break a file deliberately, run a task that touches it, and confirm the
compiler error reaches the model's next turn and gets fixed **without being told to fix it**.

Run 2026-09-11, `openai/gpt-oss-120b` on Groq, from a scratch project outside this repo.

## Setup

`smoke-dp1/src/util.ts`, written before the agent ever ran:

```ts
export const BROKEN: number = "boom";
```

`smoke-dp1/tsconfig.json`: `strict: true`, `include: ["src/**/*.ts"]`. `typescript` installed
as the only dependency. No test runner configured (the test gate disables itself; DP1's
per-edit typecheck is what this smoke test exercises).

Confirmed broken before the agent touched it:

```
$ npx tsc --noEmit --pretty false
src/util.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.
```

## Task given to the model

```
tandem run --model openai/gpt-oss-120b -p "Add a function triple(n: number): number to src/util.ts that returns n times 3."
```

The prompt never mentions `BROKEN` or a type error. Anything that happens to that line is the
model's own reaction to what the gate tells it, not the instruction.

## What happened

1. Model reads `src/util.ts`, sees the broken line.
2. Model edits the file (to add `triple`). **DP1 fires on that edit**, type-checks the file,
   finds the pre-existing error, and the tool result the model receives back is:

   ```
   TANDEM typecheck errors — fix these before continuing:
   src/util.ts:1:14 TS2322 Type 'string' is not assignable to type 'number'.
   ```

   This is the unprompted signal — nothing in the task asked for this, and nothing in the
   model's own turn up to this point mentioned it either.
3. Next turn, the model edits the file again. This time the tool result is a plain
   `edited src/util.ts` — no typecheck error attached, meaning DP1 ran again and passed.
4. The turn after that hit the same 429 documented in `VERIFIED.md` and `README.md`
   (`Used 199893/200000`, "try again in 6m30s") before the model could send a closing
   message. `tandem run` still exited 0 — the tool calls that matter had already completed.

## Result, checked directly against the file on disk afterward

```
$ cat src/util.ts
export const BROKEN: number = 0;

$ npx tsc --noEmit --pretty false
$ echo $?
0
```

**DP1 received the real compiler error and fed it back unprompted — confirmed.** The model
changed `"boom"` to `0` in direct response to that feedback, and the project now type-checks
clean. This is FINISH.md Task 2's acceptance condition, met.

**One honest caveat.** The final file contains only the fixed `BROKEN` line — no `triple`
function. The model fixed the error DP1 reported but did not also deliver the task it was
actually asked to do. That is a real, weak-model failure mode this run happened to surface,
not a flaw in DP1: the gate did exactly its job (surface the compiler error, unprompted, and
the model acted on it); what the model did with two competing goals under a repair prompt is
a separate question — exactly the kind of thing `## Results` in `README.md` is meant to
measure at scale once quota allows a real run.

## Full transcript

Identical consecutive `[diag] event : message_update stop=pending` streaming lines are
collapsed to a count — nothing else is altered or removed. Raw, uncollapsed log:
`bench-results/` is not where this lives (this ran outside the benchmark harness) — the raw
file was scratch and is reproduced here in full instead.

```
  [diag] streamFn      : direct api stream
  [diag] model         : {"id":"openai/gpt-oss-120b","name":"openai/gpt-oss-120b","api":"openai-completions","provider":"custom","baseUrl":"https://api.groq.com/openai/v1","reasoning":false,"input":["text"],"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0},"contextWindow":128000,"maxTokens":8192}
  [diag] tools         : 4 — read, write, edit, bash (tandem)
tandem: verification active — 5 decision points, working set enforced.
        disable with TANDEM_HOOKS=off

  [diag] baseUrl       : https://api.groq.com/openai/v1
  [diag] api key       : present
  [diag] event         : agent_start
  [diag] event         : turn_start
  [diag] event         : message_start
  [diag] event         : message_end role=user blocks=[text]
         TEXT: Add a function triple(n: number): number to src/util.ts that returns n times 3.
  [diag] event         : message_start stop=pending
  [diag] event         : message_update stop=pending
  ...   (previous line repeated 31 more times)
  [diag] event         : message_update stop=toolUse
  ...   (previous line repeated 2 more times)
  [diag] event         : message_end stop=toolUse role=assistant blocks=[thinking,toolCall]
  [diag] event         : tool_execution_start
  [diag] event         : tool_execution_end
  [diag] event         : message_start
  [diag] event         : message_end role=toolResult blocks=[text]
         TEXT: export const BROKEN: number = "boom";

  [diag] event         : turn_end stop=toolUse
  [diag] event         : turn_start
  [diag] event         : message_start stop=pending
  [diag] event         : message_update stop=pending
  ...   (previous line repeated 79 more times)
  [diag] event         : message_update stop=toolUse
  ...   (previous line repeated 2 more times)
  [diag] event         : message_end stop=toolUse role=assistant blocks=[thinking,toolCall]
  [diag] event         : tool_execution_start
  [diag] event         : tool_execution_end
  [diag] event         : message_start
  [diag] event         : message_end role=toolResult blocks=[text]
         TEXT: TANDEM typecheck errors — fix these before continuing:
src/util.ts:1:14 TS2322 Type 'string' is not assignable to type 'number'.
  [diag] event         : turn_end stop=toolUse
  [diag] event         : turn_start
  [diag] event         : message_start stop=pending
  [diag] event         : message_update stop=pending
  ...   (previous line repeated 172 more times)
  [diag] event         : message_update stop=toolUse
  ...   (previous line repeated 2 more times)
  [diag] event         : message_end stop=toolUse role=assistant blocks=[thinking,toolCall]
  [diag] event         : tool_execution_start
  [diag] event         : tool_execution_end
  [diag] event         : message_start
  [diag] event         : message_end role=toolResult blocks=[text]
         TEXT: edited src/util.ts
  [diag] event         : turn_end stop=toolUse
  [diag] event         : turn_start
  [diag] event         : message_start
         ERROR: 429: {"message":"Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01m1wxvf55eaz8efnp1ztvd88j` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 199893, Requested 1010. Please try again in 6m30.096s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing","type":"tokens","code":"rate_limit_exceeded"}
  [diag] event         : message_end
         ERROR: 429: {"message":"Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01m1wxvf55eaz8efnp1ztvd88j` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 199893, Requested 1010. Please try again in 6m30.096s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing","type":"tokens","code":"rate_limit_exceeded"} role=assistant blocks=[]
  [diag] event         : turn_end
         ERROR: 429: {"message":"Rate limit reached for model `openai/gpt-oss-120b` in organization `org_01m1wxvf55eaz8efnp1ztvd88j` service tier `on_demand` on tokens per day (TPD): Limit 200000, Used 199893, Requested 1010. Please try again in 6m30.096s. Need more tokens? Upgrade to Dev Tier today at https://console.groq.com/settings/billing","type":"tokens","code":"rate_limit_exceeded"}
  [diag] event         : agent_end
```

A first attempt at this same task, minutes earlier, was itself refused outright by the same
daily cap before the model got past reading the file (`Used 199528/200000, try again in
11m33s`) — waited out once, not retried a second time, per this project's own rule.
