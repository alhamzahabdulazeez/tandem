**TANDEM Master PRD**

Document: `TANDEM_MASTER_EXECUTION_PRD_V1.md`  
Version: `1.0`  
Status: Normative implementation and execution contract  
Product authority: `TANDEM_FINAL_PRODUCT_SPECIFICATION_V4.md`  
Implementation status: Not established by the supplied documents  
Qualification status: No runtime, adapter, support profile, test result, or release gate is represented here as already qualified or passed

**1. Contract Authority**

This document defines the implementation contract for TANDEM. The downstream coding model MUST implement this contract without independently redesigning the product, expanding the MVP, weakening its guarantees, or choosing unresolved consequential behavior.

The governing product definition is:

> TANDEM is an agent-agnostic supervisory engineering intelligence and control layer above coding agents.

The governing thesis is:

> Any Coding Agent + TANDEM > Agent Alone.

This is an empirical thesis to demonstrate for an advertised support profile and task distribution. It is not an assumed result or a universal guarantee.

The source hierarchy is:

1. `TANDEM_FINAL_PRODUCT_SPECIFICATION_V4.md` controls product meaning, architecture constraints, safety, scope, acceptance, and release requirements.
2. `TANDEM_MASTER_EXECUTION_PRD_V1_PROMPT.md` controls the purpose and completeness of this execution document.
3. `TANDEM_COMPLETE_EXECUTION_PLAN.md` supplies compatible implementation discipline, audit procedures, engineering practices, and measurement practices.
4. Earlier specifications, reviews, tool rankings, examples, schedules, and terminology do not override V4.

V4 replaces its earlier product specifications in full. References in V4 to earlier reviews are provenance, not additional unresolved instruction layers.

`MUST` and `MUST NOT` are mandatory. `SHOULD` and `SHOULD NOT` are defaults whose departure requires a recorded reason preserving every applicable mandatory requirement. `MAY` does not authorize bypassing admission, qualification, budgets, or acceptance. `POST-MVP` means excluded unless separately admitted.

Unknown safety properties MUST remain unknown. Unsupported execution MUST be refused or remain in genuinely non-executing checker/observer mode.

The following reconciliations are binding:

| Earlier provision | Binding V1 implementation rule |
|---|---|
| TANDEM is an independent coding agent built on Pi | TANDEM supervises an existing coding agent. Pi is neither mandatory nor automatically qualified. |
| A second provider is needed to demonstrate neutrality | One qualified agent and inference configuration is sufficient. No second adapter, gateway, or router is required. |
| Broad JavaScript/TypeScript maintenance scope | The first slice is one small single-package direct-source JavaScript project and one deterministic CLI behavior change. |
| Two experimental repair attempts | At most one authorized repair after the initial implementation attempt; policy may allow none. |
| Conditional application to the incumbent workspace | No automatic incumbent modification or application is permitted in the MVP. |
| Candidate checkpoints can restore incumbent work | Recovery operates on TANDEM-owned disposable resources only. |
| Optional mutation-producing simplification | MVP hygiene is bounded and read-only. Cleanup and simplification mutation are excluded. |
| Affected-only verification as an initial optimization | The exact slice uses its qualified genuinely full native recipe and independently controlled behavioral witnesses. |
| Fingerprints and green native reports establish acceptance | Acceptance requires total requirement coverage, independent predicates, coherent evidence, actual derivation, quiescence, and durable frozen delivery. |
| Safety-margin cost estimates enforce budgets | Estimates are soft. Hard admission uses conservative maximum exposure and durable atomic reservations. |
| Calendar phases determine progress | Gates 0 through 4 determine progress. Calendar dates do not pass gates. |
| Broad tool catalogs identify required integrations | Only the small qualified capability set needed for the exact slice is enabled. |
| Best-effort cancellation is sufficient | Every ending path requires proven quiescence or explicit unresolved execution with durable quarantine and no success. |

**2. Product Contract**

TANDEM owns the task’s intended outcome, admitted boundaries, next authorized action, resource exposure, evidence requirements, acceptance reduction, and stopping decision.

The integrated coding agent owns code-level implementation planning inside the admitted envelope.

TANDEM MUST NOT become a second implementation planner competing with the coding agent, a replacement model runtime, an IDE competitor, a mandatory cloud service, or a general-purpose autonomous coding product.

The initial user is a developer already using a coding agent. The first implementation MUST improve that workflow without requiring the user to understand TANDEM’s internal state machine.

The product MUST preserve these principles:

| Principle | Required behavior |
|---|---|
| Implement intent | Retain the original request, establish the intended engineering outcome, and resolve consequential ambiguity without inventing scope. |
| Minimum Sufficient Work | Minimize unnecessary work only after correctness, safety, authority, and acceptance constraints are satisfied. |
| Bounded autonomy | Act autonomously only within an explicit, current, enforceable envelope. |
| Project-native-first | Prefer relevant qualified native mechanisms over unnecessary integrations. |
| Deterministic-first | Use trusted inspection, explicit rules, and deterministic predicates before unnecessary model reasoning. |
| Evidence before claims | An agent message or command exit status cannot establish task acceptance. |
| Protect user work | Prevent incumbent mutation through isolation and safe helpers rather than promising repair afterward. |
| Bounded repair | Repair only concrete applicable failures, within the one-repair ceiling and aggregate budget. |
| Stop intelligence | Stop when acceptance is established, further work is unjustified, or a required boundary prevents continuation. |
| No overengineering | Do not instantiate conceptual responsibilities as speculative services, agents, databases, or frameworks. |
| Neutrality | Keep task, authority, evidence, and acceptance semantics independent of the selected agent and provider. |
| Truthful uncertainty | Missing, stale, conflicting, unsupported, or incomplete proof remains unresolved. |

The exact MVP contains:

| Area | Required scope |
|---|---|
| Host | One Gate-0-qualified Linux host and local execution profile |
| Agent | One pinned existing coding-agent version and interaction configuration |
| Inference | One pinned configuration: genuinely local-only, or one qualified external inference transport |
| Concurrency | One authoritative supervisor and one active supervised task |
| State | One local durable transactional state store |
| Source | One explicitly selected immutable Git commit |
| Repository | One small single-package direct-source JavaScript project |
| Task | One ordinary deterministic command-line behavior change |
| Inputs | Complete declared inputs, without mutable outside dependencies |
| Source types | Qualified regular files and directories with declared supported modes |
| Verification | Protected external behavioral witnesses and the qualified genuinely full native recipe |
| Repair | Initial attempt plus at most one authorized repair |
| Delivery | Complete immutable frozen candidate, retained with a durable manifest |
| Inspection | Honest `tandem check` and local status/evidence inspection |
| Measurement | Local structured records and a versioned Agent Alone versus Agent + TANDEM protocol |

The JSON-record CLI described in V4 is a suitable first-slice example, not a fully specified fixture. The supplied documents do not establish its exact input format, expected bytes, exit codes, diagnostics, or complete case set. These MUST be fixed independently before execution as specified in Section 33.

The MVP MUST NOT enable:

- Dependency changes or task-time dependency/tool installation.
- TypeScript compilation or other generated-build requirements in the exact first slice.
- Symlinks, submodules, special-file source workflows, unsupported hard-link arrangements, or unsupported Git shapes.
- External services required by the task.
- Arbitrary plugin, extension, skill, or MCP discovery and execution.
- Unqualified model transports, hosted provider tools, fallback routes, telemetry, diagnostics uploads, or general web actions.
- Automatic installation, conditional live apply, or rollback of incumbent work.
- Automatic staging, committing, stashing, resetting, cleaning, checkout over, amendment, push, or configuration changes in the incumbent.
- Deployment, package/site publishing, external messaging, or database/cloud mutation.
- Persistent-service handoff, host-daemon delegation, or uncontrolled background work.
- Multi-agent orchestration, nested delegation, distributed ownership, or generalized scheduling.
- Broad agent/provider support, routing systems, or a general model gateway.
- Offline grants, timeout-based ownership takeover, or revival of retired task authority.
- Shared mutable build caches, arbitrary build systems, or unvalidated incremental/remote caches.
- Learned cross-session policy, external memory infrastructure, or repeated independent planning loops.
- Precision impact graphs, universal test-weakening detection, generalized predicate languages, or a second LLM as a trust boundary.
- Whole-repository cleanup, mutation-producing hygiene, or speculative simplification.
- Mandatory analyzer stacks, composite optimization scores, or an observability platform.

Exclusion MUST be enforced at reachable execution boundaries. Hiding a command or documenting a prohibition is insufficient.

**3. Executor Rules**

The downstream coding model implementing TANDEM is an implementation executor. It is not the product architect, task owner, qualification authority, or acceptance authority.

A Groq-backed model operating inside Claude Code is an example of an implementation executor. It does not select Claude Code, Groq, Pi, or any other component as TANDEM’s product integration.

The implementation executor MUST:

- Follow the ordered gates and work units in Section 25.
- Inspect actual code before replacing it.
- Preserve proven architecture and shipped compatibility where evidence establishes a concrete need.
- Implement the contracts and state transitions defined here.
- Keep the MVP narrow.
- Add tests for the implemented behavior and its refusal paths.
- Preserve all applicable V4 invariants.
- Record actual commands, versions, results, limitations, and evidence.
- Stop dependent work when a consequential unresolved decision prevents safe implementation.

The implementation executor MUST NOT:

- Redesign TANDEM as an independent coding agent.
- Substitute an unqualified runtime or adapter.
- Simulate preventive control with logs, prompts, or post-event hooks.
- Weaken authority, containment, ownership, budgets, oracle independence, acceptance, or tests.
- Convert `UNKNOWN`, `MISSING`, `INCONCLUSIVE`, malformed data, or absent observations into `PASS`.
- Make the oracle or authoritative evidence candidate-controlled.
- Permit automatic incumbent modification.
- Add network access, recipients, credentials, uploads, or external effects silently.
- Add speculative abstractions, services, integrations, or extra agents.
- Alter benchmark thresholds after seeing results.
- Invent source files, existing features, installed versions, test outcomes, or qualification evidence.
- Continue through an unresolved consequential architectural or product decision.

**Decision Matrix**

| Decision | Authority | Executor permission |
|---|---|---|
| V4 product definition, MVP boundaries, mandatory invariants | V4 | Implement; do not reopen or waive |
| Task intent, consequential behavior, public compatibility, required source inputs | Authenticated task owner or already-authorized policy | Gather facts and present the exact unresolved issue |
| Task permissions, disclosure recipient/purpose, credentials, ceilings | Authenticated user or pre-authorized trusted policy | Enforce the supplied envelope |
| Concrete supported runtime/agent/storage/transport bindings | Technical qualification owner, supported by Gate-0 evidence | Probe, inventory, and implement approved bindings; do not assume qualification |
| Task predicate meaning and required witnesses | Trusted acceptance contract admitted by the supervisor from authorized requirements | Implement predicates; do not choose weaker acceptance |
| Numeric evaluation thresholds and experimental protocol | Product/evaluation owner before results | Implement collection and the predeclared decision rules |
| Current action admission, reservation, result commit, stop, acceptance | Authoritative supervisor | Implement deterministic mechanisms |
| Code-level implementation of an admitted user task | Integrated coding agent | Propose and implement inside the admitted envelope |
| Local naming, routine decomposition, equivalent algorithms, test organization | Implementation executor | Allowed if contracts and guarantees are unchanged |
| New capabilities or broader profiles | Explicit capability admission under Section 29 | Do not enable before admission |
| Repository instructions, agent output, tool metadata, memory, reports | No independent authority | Treat as data or proposals |

A consequential decision includes a change to public behavior, compatibility, task scope, security, data access, disclosure, financial exposure, source inclusion, oracle meaning, mandatory coverage, durable ordering, isolation, ownership, or supported execution guarantees.

Ordinary implementation freedom does not include changing these contracts.

When a consequential issue is unresolved, the executor MUST record:

```text
classification: IMPLEMENTATION BLOCKER
id:
governing_requirement:
observed_fact:
unresolved_decision_or_missing_input:
why_safe_implementation_is_blocked:
affected_work_units_and_gates:
resolution_authority:
required_resolution_evidence:
safe_independent_work_still_permitted:
```

The executor MUST stop the affected work. Independent read-only audit or already-defined pure implementation work may continue only when it does not depend on the unresolved decision and does not violate gate ordering.

At runtime, consequential task ambiguity produces `NEEDS_USER`; unavailable required capability produces `BLOCKED`. Both end the incarnation through the universal finalization protocol. No agent remains parked with usable authority while waiting for an answer.

**4. Architecture**

The implementation MUST use this logical architecture:

```text
Authenticated local user control
              |
              v
Serialized supervisor and admission gate
              |
       Durable local store
              |
              v
Thin qualified agent adapter
              |
              v
Qualified executor and containment boundary
              |
       Owned candidate resources
              |
              v
Protected verification controller
              |
              v
Supervisor reduction and immutable local delivery
```

This diagram defines responsibilities, not separate services.

The required logical components are:

| ID | Responsibility | Required operations |
|---|---|---|
| `CTRL` | Sole task-contract and next-decision owner | Create incarnation; compose policy; choose next action; admit/release; commit eligible observations; authorize repair; finalize; reduce acceptance |
| `STATE` | One durable transactional authority and resource ledger | Allocate epochs; persist contracts/actions/reservations; enforce uniqueness; retain outcomes, quarantine, and delivery references |
| `EXEC` | Actual effect boundary | Prepare contained resources; enforce filesystem/process/network/data scope; release exact action; enforce limits; drain/fence; report attributable runtime facts |
| `ADAPTER` | Thin integration with the one pinned coding agent and inference path | Translate proposals, observations, model/tool requests, errors, cancellation, and accounting without granting authority |
| `CONTENT` | Source, candidate, frozen-generation, and payload handling | Capture immutable source; validate paths/types; construct independent attempts; enumerate/diff; freeze; prepare and durably publish content |
| `VERIFY` | Independent acceptance observation and evidence evaluation | Validate coverage; invoke protected cases/native recipe; establish derivation; evaluate predicates; validate evidence applicability |
| `UX` | Local commands, inspectable records, and measurement presentation | Run/check/status/evidence; concise reports; structured telemetry; development evaluation invocation |

Intent analysis, gap detection, context selection, tool selection, hygiene, failure identity, repair decisions, and stop intelligence belong inside these existing responsibilities. They MUST NOT become independent planners or services.

The supervisor and executor-side admission gate MUST share one trusted serialized control boundary. They may be implemented in the same process or through the qualified local mechanism, but current-authority validation through final controlled release MUST have one serialization order.

`STATE` is the only authoritative decision store. Immutable payloads and evidence files may accompany it. Decision, assumption, evidence, risk, and issue registers are views over these records, not separate databases.

The implementation MUST delegate mature mechanisms where qualified:

- Coding implementation and code-level planning to the existing agent.
- Isolation, limits, locking, and persistence primitives to existing operating-system/runtime/storage mechanisms.
- Git object access and bounded filesystem operations to qualified trusted helpers.
- Native checks and narrow external observation to qualified verification mechanisms.
- Search to existing trusted search tools.

Delegation does not delegate authority, liability, evidence validity, or acceptance.

The trusted boundary includes the authenticated user-control channel, deterministic supervisor logic, qualified execution/storage primitives, and protected verifier/observer path.

The coding agent, repository code, tests, configuration, extensions, tool metadata, and generated reports MUST NOT obtain trusted identities or access to authority storage.

**5. Qualification Contract**

Gate 0 MUST produce one concrete support record. A descriptive label such as “Linux,” “sandboxed,” “local,” “Git-backed,” or “trusted tests” is not a populated support record.

The support record MUST contain:

| Field group | Required binding |
|---|---|
| Identity | Profile identifier, version, digest, qualification status, evidence references |
| Host | Actual OS/kernel versions, host assumptions, supported failure model |
| Runtime | Actual containment mechanism/version/configuration; identities; mounts; process/resource controls; fencing behavior |
| Storage | Actual transactional-store binding and durability configuration; local filesystem; crash/persistence assumptions; lock and publication semantics |
| Agent | Actual agent package/version, interaction mode, configuration digest, executable identity, tool surface |
| Inference | Actual model/runtime or external recipient configuration, version identifiers, retry behavior, context/compaction behavior |
| Source | Supported Git shape, object-access recipe, path encoding/types/modes, source-size bounds |
| Task | Exact supported repository and behavior class |
| Verification | Protected controller, predicate versions, case manifest, native full-suite recipe, expected discovery/execution scope |
| Derivation | Runtime/entrypoint identities, dependency bytes, resolution and environment rules, excluded paths/caches |
| Resources | Hard and soft dimensions, enforcement mechanisms, action maximums, deadlines, protected reserves |
| Disclosure | Local-only prohibition or the one authorized external payload/visibility boundary |
| Credentials | Storage and use boundaries; proof repository commands cannot inherit credentials |
| Recovery | Non-reusable runtime identities, old-actor discovery, drain/fence procedure, quarantine rules |
| Qualification | Positive and negative test invocations, outcomes, raw evidence, limitations, invalidation conditions |

Qualification MUST cover the complete reachable effect surface:

| Surface | Required proof |
|---|---|
| Actual tool invocation | Pre-effect admission includes internal and hidden tools |
| Direct filesystem access | Runtime-enforced readable/writable scope; no incumbent or control-state mutation |
| Descendants | Detached children and grandchildren remain in the admitted containment/resource unit |
| Handles/descriptors | No inherited approval, credential, writable protected-resource, or control-channel bypass |
| Host IPC | Daemon sockets, service managers, schedulers, credential agents, and handoff routes are unavailable |
| Network/DNS | All routes satisfy local-only denial or the exact admitted inference transport |
| Model traffic | Prompts, attachments, follow-ups, compaction, retries, fallback, and hosted paths are covered |
| Diagnostics/telemetry | Unqualified routes are disabled and unreachable |
| Credentials/environment | Repository execution does not inherit host/user/provider/control credentials |
| Supervisor control | Untrusted execution cannot approve, issue grants, alter policy, or mutate the store |
| Resources | Time, output, memory, processes, storage, and other advertised hard bounds are enforced |
| Cancellation | Descendants, retained handles, existing writes, and late writers are drained or fenced |
| Failure/restart | Loss of control closes new admission; old actors are identifiable and cannot revive |
| Baseline/checker/verifier execution | These use the same admission and containment requirements as implementation commands |

The initial runtime MUST use enforceable local containment. A qualified combination of namespaces, distinct execution identity, cgroup-v2 controls, restricted mounts, and denied host IPC is an appropriate basis. A directory or process group alone is insufficient.

Qualification MUST include adversarial repository code. Cooperative agent behavior and adapter self-report are insufficient.

The supported threat model MUST include prompt/tool injection, adversarial repository code, accidental or malicious agent actions, forged outputs, detached descendants, stale actors, and supervisor failure.

A compromised kernel, malicious host administrator, broken storage hardware, or provider violation of a declared external contract is not an MVP guarantee. Detected failure of an assumption MUST invalidate the affected guarantee.

Changes to an agent, runtime, toolchain, filesystem behavior, transport, configuration, oracle, or recipe MUST invalidate affected qualification until the relevant tests pass again.

No configuration that fails the required probe may be used for supervised execution. Checker-only is a valid outcome. Loss of conformance during a running task MUST close admission and invoke universal finalization; it MUST NOT silently convert a live uncontrolled actor into observer mode.

**6. Durable Records**

All authoritative task state MUST be durable and transactionally updated under exclusive ownership.

The implementation MUST preserve these distinct identities:

```text
store
  -> task lineage
      -> task
          -> incarnation / owner epoch
              -> action
              -> implementation or repair attempt
                  -> frozen generation
                      -> accepted payload, if successfully published
```

A baseline is not an attempt. An attempt is not a frozen generation. A frozen generation is not an accepted payload. The user incumbent is none of these objects.

Identifiers MUST be non-reusable within their required lifetime and namespace. Runtime actor identity MUST include containment identity and host boot identity or an equivalent qualified non-reusable identity; PID alone is prohibited.

Content identities MUST use a versioned deterministic manifest and cryptographic content digests. The recorded Git commit identifier remains separate from TANDEM’s complete content identity. Canonicalization MUST be deterministic and MUST NOT silently change path or content meaning.

The authoritative records MUST include:

| Record | Mandatory content |
|---|---|
| Store/owner | Canonical store identity; protected lock identity; owner identity; durable epoch allocation; current recovery/admission state |
| Lineage | Stable identity; aggregate allocation; settled consumption; outstanding liabilities; retained-resource commitments |
| Task/incarnation | Original request reference; admitted intent; source selection; owner epoch; profile digest; phase; incarnation status; deadlines |
| Requirement inventory | Independently retained requirement and subcondition identities; original source/provenance; meaning; mandatory/optional status; applicability; authorized revisions |
| Acceptance contract | Inventory digest; obligations; predicate identities/versions/parameters; evidence policy; retry/conflict rules; contract revision/digest; freeze status |
| Policy | Authorized envelope; effective revision; phase restrictions; amendment provenance; admission state; retirement and enforcement state |
| Source/baseline | Full selected immutable commit/tree identity; inclusion/exclusion rules; independent retained content; baseline observations |
| Attempt/generation | Parent source; attempt number; mutation state; permitted change surface; frozen tree identity; scratch/resource ownership |
| Action/grant | Immutable identity and parameters; actor/executor; task/incarnation/epoch; policy/profile; target generation; scope; payload/input identity; one-use consumption; expiry; reservation; dispatch disposition |
| Runtime resource | Containment identity; host boot identity; mounts/roots; runtime limits; associated actions; drain/fence status; quarantine status |
| Evidence | Originating action/controller; full applicability key; raw observation references; completeness; predicate evaluation; conflicts/supersession |
| Budget | Dimension definitions; hard/soft limits; settled usage; reservations; unknown usage; protected future capacity; authoritative settlements |
| Repair | Concrete failure identity; hypothesis; scope; authorized allowance; new attempt/generation; verification results; stop decision |
| Finalization | Requested reasons; admission closure; authority retirement; fencing/reconciliation facts; quiescence or unresolved state |
| Delivery | Frozen identity; complete payload/manifest identities; persistence/publication state; successful terminal reference; retention/release/integrity state |
| Measurement | Attributable phase/action counters; coverage of collection; unavailable metrics; user interventions; evaluation protocol references |

Required storage properties include:

- Atomic current-authority, use-consumption, and reservation updates.
- Unique ownership, incarnation, action, and generation identities.
- Durable consumed/unknown action dispositions.
- No reuse of a consumed allowance.
- No overwrite of frozen contracts, evidence payloads, frozen generations, or accepted payloads in place.
- Bounded record and output growth.
- Durable linkage from acceptance to already-persisted content.
- Preservation of consumption, liabilities, and quarantine across restart.
- Explicit schema versions and validated record decoding.

Unknown values MUST be represented explicitly. Missing counters MUST NOT default to zero. Unknown enums, malformed records, conflicting duplicate identities, or invalid digests MUST fail closed.

Secrets MUST NOT be placed in action logs or ordinary telemetry. Credential references may identify the authorized capability without storing credential values.

Concise operational reasons are required. Hidden chain-of-thought is not a record requirement.

**7. State Machine**

The task phase and execution authority are separate. Entering a phase does not grant permission.

The normal phase transitions are:

| Current phase | Required condition/event | Next phase |
|---|---|---|
| `RECEIVED` | Exclusive owner, durable incarnation, restrictive policy, source selection, allocation established | `AUDITING` |
| `AUDITING` | Source/profile suitability established; required facts available | `PLANNING` |
| `PLANNING` | Intent and complete inventory admitted; supported obligations fixed; acceptance meaning frozen; boundaries and mandatory capacity sufficient | `READY` |
| `READY` | Initial implementation action admitted under current authority | `EXECUTING` |
| `EXECUTING` | Implementation proposes completion; mutation closes; mutators drained/fenced; generation frozen | `VERIFYING` |
| `VERIFYING` | Concrete applicable repairable failure; unused authorized repair allowance; resources and scope sufficient | `REPAIRING` |
| `REPAIRING` | New disposable generation completed, closed, reconciled, and frozen | `VERIFYING` |
| `VERIFYING` | Mandatory evaluation completed or a stop condition prevents further work | `FINALIZING` |
| Any live phase | Cancellation, consequential ambiguity, unavailable requirement, safety event, budget condition, disconnect, or other ending reason | `FINALIZING` |
| `FINALIZING` | Universal finalization and truthful reduction completed | `TERMINAL` |

Read/analysis actions may precede a completed acceptance contract only under the initial restrictive authority and budget. Candidate source mutation MUST NOT precede `READY`.

Before mutation, a supported evaluator and complete planned witness set must exist for every mandatory requirement. Outcomes may still be `MISSING` with reason `NOT_YET_EVALUATED`; that is different from an unsupported evaluator or missing planned witness.

Generation mutation follows a one-way transition:

```text
MUTABLE -> MUTATION_CLOSED -> FROZEN
```

A mutation-closed or frozen generation MUST NOT return to `MUTABLE`. Repair creates another generation.

The action model MUST distinguish:

| Axis | Required states or meanings |
|---|---|
| Lifecycle | Proposed/queued, refused or admitted, observing, reconciling, settled |
| Dispatch | Not attempted, authoritatively known not dispatched, acknowledged, unknown |
| Execution observation | Pending, succeeded within declared scope, failed, cancelled, timed out, unknown |
| Use allowance | Unconsumed or consumed; never reset |
| Liability | Reserved, partially settled, settled, or conservatively consumed |
| Resource disposition | Active, fenced/reconciled, or quarantined |

Parent-process exit does not settle the action.

The task result MUST keep these axes separate:

- Execution result.
- Per-obligation outcomes.
- Assurance.
- Stop reason and contributing causes.
- Quiescence/fencing state.
- Resource and liability state.
- Delivery state.
- Final accepted/not-accepted result.

Terminal execution results include `COMPLETE`, `COMPLETE_WITH_LIMITATION`, `FAILED`, `BLOCKED`, `NEEDS_USER`, `CANCELLED`, `SAFETY_STOP`, `BUDGET_EXHAUSTED`, and `UNRESOLVED_EXECUTION`.

No terminal result may be upgraded by a late execution result.

**8. Admission Policy**

Effective authority is the intersection of:

```text
qualified runtime capability
AND host safety policy
AND authenticated user authorization
AND admitted project restrictions
AND task constraints
AND current phase restrictions
AND exact action scope
```

The policy MUST cover:

- Readable and writable roots.
- Protected files and parent directories.
- File creation, deletion, replacement, types, and modes.
- Commands, arguments, launch roots, environment, and executable identities.
- Descendants and process/resource units.
- Network, DNS, disclosure, destinations, and purposes.
- Credentials and inherited handles.
- Change surface.
- Verification obligations.
- Hard limits, deadlines, and stop conditions.

Repository instructions may propose stricter restrictions or supply command metadata. They MUST NOT expand authority, approve a recipient, authorize credentials, remove a mandatory requirement, or change acceptance.

Risk classification is not execution trust.

Initial phase restrictions may be narrower than later pre-authorized phases. The original authorized envelope MUST already contain any implementation, verification, and repair capabilities that may later become active. An analysis-only authorization MUST NOT be silently widened into implementation authority.

The MVP MUST prohibit runtime permission widening. A needed widening ends the incarnation through `NEEDS_USER` or `BLOCKED`. Later authorization creates a new incarnation and requires revalidation.

Policy changes MUST distinguish:

```text
PROPOSED -> AUTHORIZED -> EFFECTIVE -> ENFORCED/FENCED
```

The effective revision changes only at the serialized durable admission gate. Unredeemed grants for superseded revisions become unusable there.

Narrowing or revocation MUST close admission while affected actors are reconciled or fenced. Replacement work MUST NOT start before that boundary is established.

The implementation may conservatively end the incarnation on narrowing rather than support continued execution. It MUST NOT report enforcement merely because configuration was written.

A denied action is not an executed safety incident. Its refusal MUST be attributable. A necessary denied capability blocks the task; a demonstrably safe alternative may be selected within unchanged authority. An actual boundary violation or loss of conformance requires fail-closed finalization.

**9. Action Admission**

An executable action is one supervisor-dispatched capability invocation, including a read-only tool, model request, implementation command, baseline command, verifier invocation, or outbound operation.

A bounded invocation may contain declared transitive reads, writes, subprocesses, and computation. Those effects inherit the same action identity, containment scope, limits, and nonextendable deadline.

A new tool call, model request, remote request, independent job, or expanded target is not automatically covered by an agent-session grant. It requires its own admission.

For the MVP, each grant SHOULD permit one use. No offline grants are permitted.

Each grant MUST bind:

```text
task_id
lineage_id
incarnation_id
owner_epoch
effective_policy_revision
qualified_profile_digest
qualified_executor_identity
action_id
immutable_operation_and_parameters
target_attempt_generation_or_read_scope
input_payload_identity
filesystem_process_network_disclosure_scope
command_arguments_environment_working_root
destination_and_credential_scope_if_applicable
use_allowance
creation_time
nonextendable_expiry
resource_maximums
issuing_identity_and_provenance
```

Mutable post-approval command fields are prohibited.

`admitAndRelease` MUST execute in this order:

1. Acquire the trusted serialization boundary shared with policy transition and admission closure.
2. Authenticate the executor and verify current exclusive ownership and incarnation.
3. Resolve the immutable proposal to the exact operation, inputs, target, scope, and qualified reachable effects.
4. Check current policy, phase, admission state, grant retirement, use allowance, profile qualification, deadlines, and resource availability.
5. Durably consume the use allowance and reserve conservative maximum liability in one transaction linked to the action.
6. Ensure the action’s containment/resource identity is durably attributable before untrusted execution can occur.
7. While still serialized, recheck expiry and current release conditions.
8. Release the exact action through the last trusted execution barrier.
9. Record dispatch acknowledgement, known non-dispatch, or consumed/unknown dispatch.
10. Release the serialization boundary without waiting for the action’s completion.

No unvalidated queue may exist after the final barrier.

If closure or a policy transition linearizes before release, the old action cannot start. If release linearizes first, the actor is admitted and requires running-actor fencing when authority narrows or closes. “Validated earlier” is not a third outcome.

The store and operating-system/provider effects do not form one general atomic transaction. The guarantee is conservative at-most-once admission, not exactly-once effects.

A crash after durable consumption and before confirmed dispatch MUST leave the action consumed/unknown unless authoritative evidence proves otherwise. The executor MUST NOT replay it automatically, including under a different action identifier or as an equivalent replacement operation.

A known-not-dispatched action remains consumed. Its reservation may be released only from authoritative non-dispatch proof. Any later attempt needs new current admission.

An existing grant’s lifetime MUST NOT be extended. Restart MUST NOT restart the lifetime. Uncertain clock or boot/lifetime state fails closed.

The supervisor may commit an execution observation only after checking:

```text
current owner
current incarnation
expected action identity
expected generation
applicable policy and acceptance contract
qualified observation source
allowed live phase
non-retired execution authority
```

A duplicate delivery of the same authenticated event may be ignored idempotently. It MUST NOT count twice. Conflicting duplicate payloads require explicit invalidity/conflict handling.

Fixed trusted journaling, fencing, pure reduction, and immutable local publication remain authorized control-plane operations under exclusive ownership. They MUST NOT become arbitrary command execution. Every helper subprocess is an executable action and MUST finish before task-execution authority retires.

**10. Ownership Recovery**

The MVP MUST use exclusive local ownership of a canonical trusted state root, normally enforced with one operating-system exclusive lock.

The lock identity and its parent directory MUST be protected against aliasing, deletion, replacement, and inheritance by untrusted execution.

A second supervisor MUST refuse admission while ownership is held. Heartbeats, timeouts, inactivity, or a paused owner MUST NOT transfer ownership.

Epoch allocation MUST be durable and serialized under the lock. A second store or alternate pathname MUST NOT attach an existing mutable candidate as newly owned work.

After a crash, lock acquisition grants recovery ownership only. Recovery MUST:

1. Start with admission closed.
2. Allocate a new durable recovery epoch.
3. Identify old containment units and actions using non-reusable runtime identities.
4. Identify every mutable resource reachable by unresolved actors.
5. Reconcile known effects and liabilities.
6. Drain or fence surviving actors using the qualified runtime.
7. Preserve immutable baselines and previously accepted payloads.
8. Quarantine all unresolved mutable resources.
9. Record the former incarnation’s truthful non-successful disposition unless a complete durable successful record already exists and its payload integrity is intact.
10. Admit later work only after applicable ownership, fencing, source, contract, profile, and budget revalidation.

Recovery MUST NOT automatically replay an ambiguous action or resume retired authority.

Quarantine MUST include candidate directories, scratch, caches, temporary payloads, staging areas, reports, and any other mutable resources touched by unresolved actors.

Quarantine is a durable ownership restriction, not a directory rename. A new task identifier or pathname does not make the resources reusable.

The smallest implementation SHOULD block new supervised work for the local instance while unresolved old actors can threaten its resources. It MUST NOT add distributed leases, ownership stealing, or automatic takeover.

Private mutable resources and independently retained immutable inputs are the default. Shared mutable build caches are prohibited.

If control or authoritative storage integrity is lost, execution MUST fail closed. Where a declared host/storage assumption itself has failed, the implementation MUST report the limitation rather than fabricate durable reconciliation or quiescence.

**11. Source Isolation**

The task MUST explicitly identify an immutable Git commit. A moving branch name or implicit `HEAD` is not the accepted source identity.

Before execution, the user-facing contract MUST state that staged, unstaged, untracked, and ignored content is excluded. An explicit commit selection may coexist with a dirty incumbent, but excluded work remains untouched and is not represented as captured or backed up.

The capture procedure MUST:

1. Validate the source root and supported Git shape with trusted non-executing inspection.
2. Confirm the full requested commit identity without substituting another source.
3. Reject unsupported source shapes and required outside inputs.
4. Read immutable objects without executing repository configuration, hooks, filters, helpers, fsmonitor, credential helpers, or build scripts.
5. Independently retain all required content.
6. Verify object/content identities and complete tree enumeration.
7. Reject inconsistent or incomplete capture before executable task work.
8. Construct private candidate bytes under protected owned parents.
9. Record the baseline manifest and inclusion/exclusion rules.
10. Keep the incumbent unavailable for candidate writes.

The MVP MUST reject:

- Required dirty, untracked, ignored, or mutable outside inputs.
- Unmerged or sparse source shapes.
- Submodules/gitlinks.
- Gitfiles/linked worktrees.
- Git alternates.
- Symlinks and special files.
- Escaping or absolute paths.
- Unsupported file modes, type transitions, path collisions, or hard-link arrangements.
- Missing required objects or content whose independent retention cannot be established.

Changing refs during capture cannot change the selected immutable identity. Concurrent object disappearance or inconsistency causes retry/block before execution, not a false coherent-snapshot claim.

The protected incumbent includes source files, index, refs, configuration, Git administration, and pre-existing staged, unstaged, untracked, and ignored state.

Candidate writable content and Git administration MUST be physically independent. The MVP MUST NOT use a normal `git worktree`, hard-link clone, shared refs/configuration, or mutable borrowed object store as its isolation mechanism.

The preferred first-slice construction is a private export of supported immutable content. If the chosen agent requires Git metadata, that metadata MUST be independent, without remotes or shared administration, and supervisor-controlled.

All capture, construction, patch, freeze, export, reconstruction, and cleanup helpers MUST use root-anchored, type-aware operations. Validation followed by an unsafe pathname operation is insufficient.

Protected parent directories and open-handle behavior are part of the boundary. A read-only file under an attacker-replaceable writable parent is not adequately protected.

Helpers MUST NOT follow agent-substituted paths or links into incumbent or supervisor state. Archive and patch paths are untrusted data.

No helper may stage, stash, reset, clean, checkout over, invoke filters, or execute baseline scripts in the incumbent to manufacture a candidate.

Concurrent user edits MUST remain untouched. Delivery is relative to the selected immutable baseline and MUST NOT be described as safe to overwrite a newer working tree.

**12. Resource Budgets**

Each task lineage MUST have one aggregate durable allocation. New incarnations, attempts, candidate directories, retries, and repairs do not reset it.

The ledger MUST distinguish:

```text
hard limit
soft target
settled consumption
conservative outstanding reservation
estimated usage
unknown usage
protected future mandatory capacity
```

For every additive hard dimension, admission MUST preserve:

```text
settled consumption
+ conservative outstanding reservations
+ new action reservation
+ remaining protected mandatory capacity
<= hard limit
```

Checks and reservations occur atomically with action consumption before executable or chargeable dispatch.

Reservations MUST be justified maximum exposure, not average expected cost.

A mandatory action may transfer its allocation from protected future capacity into an action reservation. The update MUST NOT double-count that allocation or release capacity reserved for other obligations.

Known partial usage and remaining maximum exposure MUST be updated together.

Capacity may be released only by:

- Authoritative settlement establishing the remaining maximum.
- Authoritative proof of non-dispatch.
- Conservative consumption of the full reserved bound.

A timeout, missing receipt, cancelled client wait, or new action identifier does not release liability. Conservatively consuming the full bound does not restore spending headroom.

The resource contract MUST specify:

| Dimension | Required implementation |
|---|---|
| Action/tool/model counts | Durable admission counts, bounded internal fan-out, explicit retries, no hidden uncounted invocations |
| Tokens | Declared observed categories and enforceable upper bounds for every category claimed hard |
| Money | Finite conservative bound for applicable input/output/reasoning/hosted work, internal behavior, prices, and rounding |
| CPU | Qualified rate/capacity and any claimed cumulative bound; a rate limit alone is not a cumulative budget |
| Memory/processes | Runtime-enforced concurrent ceilings across descendants; appropriate atomic resource allocation |
| Output | Bounded protocol messages, stdout/stderr, diagnostics, parser inputs, and retained raw data |
| Storage/inodes | Actual growth across candidates, scratch, logs, store/journal overhead, staging, frozen generations, and simultaneous copies |
| Time | Work/admission deadline, action lifetimes, bounded drain/fence attempt, and separately reserved finalization capacity |
| Retention | Declared duration and reserved physical capacity for retained baseline, accepted payload, manifest, and required evidence |
| Unavailable measurements | Explicit `UNKNOWN`, `ESTIMATED`, or `UNAVAILABLE`; never a substitute for a hard guarantee |

Runtime limits MUST survive the qualified supervisor-failure scenarios.

If a demanded hard dimension cannot be conservatively bounded, the affected capability MUST NOT be admitted. A soft estimate may be reported as a soft estimate only.

For external inference, financial bounds may rely on explicitly recorded provider pricing/limit assurances. These are external assumptions, not locally enforced control over arbitrary invoices. If a finite conservative exposure bound is unavailable, external supervised inference is blocked.

For genuinely local-only inference, external inference liability is zero because external dispatch is prohibited. Local compute remains budgeted.

Before discretionary work, protect enforceable capacity for:

- Mandatory verification.
- Required read-only task review.
- Fencing and reconciliation.
- Journal and terminal-result recording.
- Frozen delivery when success remains possible.
- Declared retention.

Untrusted execution MUST NOT consume this protected capacity. Checking current free disk space is insufficient. The qualified profile MUST establish actual reservation/isolation and persistence behavior, including simultaneous copies and journal overhead.

If the next mandatory obligation cannot fit within remaining capacity, stop without acceptance. Do not weaken the predicate, skip required verification, or exceed a hard cap.

An admission deadline is not a promise of zero additional shutdown time. Reconciliation may outlive the work deadline without reopening work or claiming successful shutdown.

After termination, only authenticated accounting receipts matching the recorded provider/action identity may settle the liability ledger. They MUST NOT import code, instructions, verification evidence, or acceptance results.

**13. Intent Requirements**

The supervisor MUST retain the original user request unchanged and represent admitted intent separately.

Before mutation, it MUST establish an independently retained inventory containing:

```text
requirement_id
parent_requirement_or_subcondition_id
source_and_provenance
original_meaning
admitted_interpretation
explicit_or_inferred
mandatory_or_optional
applicability
scope
rationale
uncertainty
authorized_revision
mapped_obligation_ids
```

Constraints and required absences are requirements.

Explicit mandatory requirements MUST NOT be silently removed because they are difficult to evaluate. Admitted inferred requirements require provenance, rationale, scope, and uncertainty.

The initial gap review MUST consider task-relevant:

- Compatibility and known consumers.
- Error behavior and diagnostics.
- Tests and regression behavior.
- Interfaces and configuration.
- Dependencies and actual resolution.
- Security and data handling.
- Project conventions.
- Required input/output limits and exceptional cases.
- Change-scope restrictions and prohibited artifacts.

Each gap MUST resolve to an admitted requirement, an explicit non-goal, an attributable ordinary inference, or a consequential unresolved question.

Ordinary uncertainty may be resolved from evidence within authorized scope. Ambiguity affecting public behavior, security, data, money, compatibility, or scope requires `NEEDS_USER` unless an already-authorized safe deterministic default applies.

Repository instructions, context selection, memory, and agent proposals MUST NOT delete mandatory intent or widen authority.

The supervisor does not need a second planning agent. If model-derived interpretation is useful, it must come through the one admitted agent/inference path as an untrusted proposal during bounded nonmutating planning.

Before mutation, the supervisor MUST freeze acceptance meaning. A later semantic change ends the incarnation and requires an authorized revised contract. Old `PASS` decisions cannot be relabeled under the revision.

Requirement extraction is not infallible. Mechanical coverage proves mapping completeness relative to the retained inventory, not perfect natural-language understanding.

**14. Acceptance Obligations**

The obligation compiler MUST consume the retained inventory without owning or rewriting it.

Before mutation and before final acceptance, a deterministic coverage validator MUST establish:

1. The mandatory inventory is nonempty for a claimed task outcome.
2. Every mandatory requirement and required subcondition has explicit obligation mappings.
3. Each mapping states the meaning and acceptance scope it covers.
4. The predicate supports that domain.
5. Required witnesses, expected values, and observation types are defined.
6. Applicability is resolved or remains explicitly unresolved.
7. No mandatory item was omitted or silently made optional.
8. No empty selection or empty conjunction can establish acceptance.

A no-change task still requires a concrete outcome witness and applicable no-change/scope constraints.

Each obligation MUST contain:

```text
obligation_id
source_requirement_and_subcondition_links
mandatory_status
applicability_and_domain
predicate_adapter_id_and_version
parameters_and_expected_values
required_observation_types
required_scope_and_completeness
permitted_evidence_sources
candidate_and_input_applicability
retry_rule
conflict_rule
supersession_rule
outcome_and_reasons
```

The acceptance-contract digest MUST cover the inventory, mandatory status, applicability, predicate semantics and versions, expected values, and evidence policy.

Stable obligation identifiers do not establish stable meaning.

The MVP predicate set MUST remain limited to:

| Predicate family | Positive evidence required |
|---|---|
| External behavioral case | Trusted case/input identity; protected expected behavior; bounded candidate response; independent comparison of declared output/exit behavior |
| Frozen-tree constraint | Trusted complete enumeration/read of the frozen scope establishing required content, absence, supported types/modes, allowed change surface, or exact tree equality |
| Qualified deterministic check | A pinned qualified checker with protected assertion semantics and authoritative output path establishing its declared property |

The implementation MUST NOT create a generalized predicate language or dynamically load repository-provided predicate code.

Case comparison rules, expected values, permitted normalization, and completeness requirements MUST be fixed in the admitted contract. The executor MUST NOT invent CLI behavior or silently normalize away differences.

A finite witness set establishes only its admitted acceptance scope. It is not universal software correctness. Requirements outside the supported domain remain unresolved rather than disappearing.

Obligation outcomes are total:

| Outcome | Rule |
|---|---|
| `PASS` | All required applicable observations are valid and complete, the independent predicate is satisfied, and no applicable failure or unresolved conflict defeats it |
| `FAIL` | Valid applicable evidence contradicts the predicate |
| `MISSING` | Required evaluator, witness, observation, or proof is absent or unavailable |
| `INCONCLUSIVE` | Present evidence cannot establish a reliable result because applicability, completeness, provenance, conflict, environment, or interpretation is unresolved |

Evaluation MUST preserve all reasons. A valid still-applicable failure cannot be overwritten by a later green observation.

Malformed, missing, duplicate, unrecognized, or truncated observations MUST NOT default to `PASS`. An absence predicate requires positive evidence of the examined scope and its completeness.

Retry behavior MUST be predeclared and bounded. The minimal default is no automatic retry unless a qualified rule explicitly authorizes one. Ambiguous dispatch is never handled as an ordinary retry.

Supersession requires evidence that an earlier observation was invalid or no longer applicable. A model preference, lower error count, or later timestamp is insufficient.

A new repaired generation receives new evidence applicability. Old failures remain in history, but old `PASS` labels do not certify new bytes.

**15. Engineering Decisions**

The supervisor MUST apply hard authority, safety, ownership, budget, and acceptance constraints before selecting the minimum sufficient next action.

The decision loop MUST prioritize:

1. Closing admission on safety, ownership, authority, or control-integrity failure.
2. Honoring cancellation and hard stop conditions.
3. Resolving or terminating consequential ambiguity before mutation.
4. Reconciling admitted actions before resource reuse.
5. Completing required evidence for the current frozen generation.
6. Admitting the one eligible repair only when its conditions hold.
7. Preparing immutable delivery and stopping when acceptance is established.
8. Selecting further implementation/context work only when an identified task requirement justifies it.

The coding agent remains the code-level planner. The supervisor MUST NOT introduce a competing detailed implementation plan or repeated multi-model planning loop.

Context selection MUST:

- Start with the smallest relevant source set.
- Prefer search/filter before detailed retrieval.
- Expand when missing facts, interfaces, consumers, configuration, or verification justify it.
- Enforce readable-data and disclosure scope before information reaches an agent/provider.
- Retain provenance and validity conditions for task-local facts.
- Preserve access to original evidence when summaries depend on it.
- Mark truncation and incomplete output explicitly.

Task-local memory is stored factual state, not independent authority. A cache timestamp is not a validity key. Facts cannot override current policy, current source, or the current contract.

The tool registry MUST be static and small. Each capability MUST declare:

```text
identity_and_version
input_output_contract
supported_task_and_project_shape
direct_and_transitive_effect_scope
trust_classification
permissions
network_and_disclosure_needs
runtime_enforcement
maximum_resource_exposure
failure_and_replay_behavior
evidence_it_can_actually_produce
```

Selection MUST prefer the smallest qualified mechanism that answers the necessary question. For equivalent needs, prefer native deterministic mechanisms, trusted search/inspection, then any specifically admitted analyzer, then model reasoning where deterministic evidence is insufficient.

The first slice does not require an analyzer installation.

Impact analysis MUST remain distinguishable from verification. It must record input identities, assumptions, discovery limits, unsupported dynamic behavior, and uncertainty.

The exact slice MUST run its qualified genuinely full native recipe rather than introduce selective-impact optimization. If “full” execution still depends on an unsound affected-only selector, it is not a valid fallback.

Unreliable impact assumptions require genuine broader coverage or unresolved obligations. An empty inferred impact set does not prove no impact.

The MVP MUST perform bounded read-only review of the task diff for unnecessary artifacts and obvious task-local waste.

Review classifications are:

| Classification | Consequence |
|---|---|
| Deterministic fact within qualified scope | May gate acceptance when applicable to an admitted requirement |
| Explicit authorized project rule | Enforced according to its admitted obligation |
| Heuristic judgment | Advisory unless explicitly admitted as an acceptance rule |

Review SHOULD examine missed consumers, changed error semantics, avoidable duplication, dead code, unexplained dependencies, speculative abstractions, wrappers, files, comments, and generated clutter.

Heuristic quality opinions MUST NOT invalidate otherwise sound acceptance by themselves. They MUST NOT trigger unrelated cleanup or mutate an already accepted result.

**16. Verification Derivation**

Verification MUST be planned from the obligations and pinned recipe, not selected afterward from green commands.

All executable baseline and verification work MUST use current admission, containment, and resource limits.

Repository metadata may be inspected with trusted non-executing readers. Importing modules, loading executable configuration, invoking package scripts, or running tests is execution.

The baseline procedure MUST:

1. Use independently retained selected source.
2. Use isolated owned scratch/resources.
3. Run only useful qualified native checks and behavioral witnesses.
4. Record exact source, runtime, input, and command identities.
5. Record known prior failure identities and scope.
6. Distinguish expected pre-change failure from a requirement already satisfied.
7. Preserve baseline evidence independently from candidate acceptance.

A pre-existing failure is not automatically acceptable. Its relevance and permitted treatment MUST be explicitly established in the contract before it ceases to block a mandatory obligation.

The exact slice MUST use direct-source launch. The trusted controller MUST launch the recorded entrypoint from the frozen source root using the pinned runtime and controlled resolution.

The derivation envelope MUST cover:

- Actual frozen source root and entrypoint.
- Runtime/toolchain binary and configuration.
- Installed dependency bytes, not merely the lockfile.
- Module and package resolution.
- Environment and lookup paths.
- Configuration search and parent directories.
- Permitted external inputs.
- Generated artifacts, if present as declared retained inputs rather than an undeclared build dependency.
- Scratch/report roots.
- Disabled or excluded caches and foreign installations.

Host fallback paths, mutable parent configuration, outside workspace packages, incumbent installations, and unrecorded ignored inputs MUST be inaccessible or explicitly included and pinned.

The first slice MUST NOT require a generated build. Stale generated output cannot satisfy changed-source acceptance.

Incremental, shared, and remote build caches MUST be disabled unless separately qualified with validated derivation; such cache support is not needed for this MVP.

Unknown actual resolution or derivation produces `MISSING` or `INCONCLUSIVE`. Plausible filenames, a successful “clean build,” or additional model reasoning do not establish provenance.

The protected external observer MUST:

1. Own the case identities and declared inputs.
2. Own the expected values and comparison rules.
3. Launch the contained frozen candidate.
4. Capture bounded stdout, stderr, exit/signal, timeout, and runtime-completion facts.
5. Compare observations outside candidate execution.
6. Write authoritative observation/evaluation records through the protected evidence path.

Candidate stdout, files, and exit behavior are observations, not self-signed assertions.

The candidate MUST be unable to modify the controller, expectations, assertion computation, evidence channel, or their parent authority.

Native full-suite execution is required by the exact slice. This requirement is separate from whether its reports are authoritative proof.

The native recipe MUST establish genuine discovery, selection, and executed scope. A command name, expected list of case IDs, or forgeable green summary is insufficient.

A native report remains supporting evidence unless the complete assertion path is qualified. Unchanged test hashes, a fresh invocation ID, and a trusted parser do not establish oracle independence when candidate code can alter registration, assertions, runner behavior, or reporting.

Supporting reports cannot independently discharge behavioral obligations. Applicable failures or contradictions in them MUST still be investigated conservatively; they cannot be discarded because the report is supporting.

Zero discovered tests, incomplete discovery, truncated required output, blocked execution, or unknown resolution cannot establish required verification.

The exact slice MUST prohibit candidate modification of its admitted verification configuration, authoritative fixtures, expectations, and observer path. Tests or diagnostic artifacts produced by the agent are not independent proof of their own adequacy.

If a required native assertion or scope guarantee cannot be established, the profile or affected obligation remains blocked/unresolved. An optional-tool limitation cannot erase the exact slice’s required native execution.

**17. Evidence Integrity**

Each evidence item MUST identify its observation path and bind the complete applicable validity envelope:

```text
task_and_incarnation
originating_owner_and_action
acceptance_contract_digest
requirement_obligation_and_predicate_identity
predicate_version_parameters_and_expected_values
effective_policy_revision
qualified_profile_digest
selected_source_baseline
exact_candidate_generation_and_tree_digest
actual_source_dependency_configuration_environment_inputs
runtime_toolchain_and_launch_identity
discovery_selection_and_execution_scope
artifact_derivation_if_applicable
observation_interval
completion_timeout_signal_and_truncation_state
provenance
conflicts_invalidations_and_supersession
```

The profile MUST qualify the completeness of this envelope. Hashing an arbitrarily selected subset does not prove input closure.

Evidence MUST be stored outside candidate-writable authority. Candidate-generated reports retain their untrusted/supporting classification even when copied into protected storage.

Relevant mutation during observation invalidates affected evidence. The exact slice SHOULD eliminate this source of ambiguity by verifying frozen source with separate private scratch.

Mandatory evidence SHOULD be re-evaluated for each repaired generation and revised contract in the first slice. Reusing old `PASS` labels is prohibited.

Any future observation reuse requires the complete applicability key and trusted origin to remain valid. A matching timestamp, lockfile, obligation ID, or filename is insufficient.

Late execution results rejected by incarnation fencing MUST NOT become cache entries for a later task.

The final coherence check MUST establish one consistent acceptance state across:

```text
inventory
contract
policy
profile
predicate definitions
evidence
source and dependency inputs
actual derivation
frozen generation
delivery representation
```

Closing admission without changing policy semantics does not itself invalidate valid evidence. A relevant effective-policy change requires re-evaluation. If re-evaluation would require executable work after terminal retirement, the task cannot succeed in that incarnation.

**18. Bounded Repair**

The implementation MUST support a policy value of zero or one repair after the initial implementation attempt. It MUST NOT support a higher ceiling in the MVP.

A repair is eligible only when all conditions hold:

- A concrete applicable failure is established.
- Its identity and affected requirement are recorded.
- A minimal causal hypothesis is attributable to the failure.
- The proposed correction stays inside the original admitted intent and change surface.
- The acceptance contract and oracle remain unchanged.
- The authorized repair allowance is unused.
- The aggregate budget can cover mutation, full required re-verification, finalization, and retention.
- Prior actors are reconciled or fenced.
- No control, oracle, ownership, or security compromise prevents trustworthy continuation.

A failure identity MUST include the applicable requirement/predicate or check, case/diagnostic identity, affected component/location where available, severity, normalized signature, generation, and raw-evidence reference.

Error-count reduction alone is not progress.

Repair MUST:

1. Consume the one authorized repair allowance durably.
2. Create a new disposable attempt from retained known content.
3. Preserve the original selected baseline.
4. Allocate fresh generation-specific authority.
5. Apply only the bounded correction.
6. Close and fence the new mutators.
7. Freeze the new generation.
8. Re-run its mandatory obligations.
9. Compare concrete failure identities and stop truthfully.

Repair MUST NOT thaw a frozen generation, overwrite accepted payloads, inherit old `PASS` labels, or reset the lineage budget.

Stop repair on repeated signatures without new evidence, exhausted capacity, increased scope, consequential uncertainty, inconclusive verification, unavailable required knowledge, oracle/control compromise, security-boundary issues, cancellation, or the repair ceiling.

Infrastructure retries are permitted only under a predeclared qualified retry rule and current budget. They cannot disguise ambiguous dispatch replay or another repair attempt.

There may be no accepted candidate after the initial failure. The implementation MUST NOT call the incumbent or baseline “accepted” to manufacture a recovery target.

**19. Universal Finalization**

Every execution-ending path MUST invoke the same protocol:

1. Record the requested stop reason and enter `FINALIZING`.
2. Atomically close task admission at the execution gate.
3. Retire unredeemed grants and durably retire the incarnation’s task-execution authority.
4. Request bounded drain/cancellation of admitted actors.
5. Apply the qualified termination/fencing fallback.
6. Reconcile partial effects, open handles, descendant scope, outstanding actions, resource ownership, and liabilities.
7. Establish quiescence or durably record `UNRESOLVED_EXECUTION`.
8. Quarantine every affected unresolved mutable resource.
9. Perform truthful result reduction.
10. For eligible success, complete the immutable publication ordering in Section 20 before committing success.

Retirement is a logical authority event. It is not proof of physical enforcement.

Quiescence means no admitted actor can still mutate the candidate, accepted payload, protected user state, authoritative evidence, or reusable task resources, and no late execution result can be committed.

A cancel acknowledgement, quiet log, parent exit, PID list, or permission change alone is insufficient. The proof MUST rely on the qualified runtime boundary and its complete effect closure.

Required terminal treatment is:

| Path | Required handling |
|---|---|
| `COMPLETE` | Retire authority, prove quiescence, preserve all mandatory `PASS`, publish the exact frozen identity |
| `COMPLETE_WITH_LIMITATION` | Same success gate; remaining limitations are optional or explicitly outside contract |
| `FAILED` | Fence/reconcile; preserve baseline, evidence, and previously accepted payloads |
| `BLOCKED` | End incarnation; no usable parked authority |
| `NEEDS_USER` | End incarnation; later continuation requires new admission |
| `CANCELLED` | Close new work and stop all admitted reachable effect paths |
| `SAFETY_STOP` | Fail closed, preserve evidence, fence or quarantine |
| `BUDGET_EXHAUSTED` | Use protected finalization capacity; do not skip obligations or exceed caps |
| Agent/provider disconnect or abort | Close admission, reject late execution payloads, retain bounded liability |
| Supervisor crash/restart | Recovery-only ownership, admission closed, old actors/resources reconciled or quarantined |

If fencing cannot be established, the result is non-successful unresolved execution. It MUST say quiescence is not established and resources are not reusable.

Control-plane fencing and reconciliation facts may still be recorded during finalization. This does not permit late implementation or verification payloads to alter acceptance.

Authenticated accounting settlement is the narrow post-terminal exception. It cannot reopen execution, import evidence, mutate a candidate, or upgrade assurance.

For an external inference request, local quiescence and bounded unsettled provider billing are distinct. Cancelling the client wait does not prove provider computation stopped.

**20. Immutable Delivery**

The MVP delivery representation is a complete frozen candidate with a manifest. An unapplied patch is optional and is not required to complete V1.

The success sequence MUST preserve two separate closure barriers:

1. Close mutation admission for the current generation, retire its write grants, drain/fence all source mutators, and reconcile their effects.
2. Materialize and integrity-protect complete frozen source/deliverable bytes under a create-once identity.
3. While the task remains live, run required verification against that frozen identity with fresh admitted actions and separate private scratch.
4. Prepare the complete delivery representation, manifest, and any reconstruction evidence. Finish every executable helper while authorized.
5. If eligible repair is needed, create another disposable generation before terminal finalization. Never thaw the frozen generation.
6. Close all remaining task admission, retire task-execution authority, drain/fence verifiers and other actors, reconcile, and establish quiescence.
7. Perform the final total-coverage, authority, policy, predicate, evidence, derivation, budget, and delivery-coherence reduction.
8. Durably publish the complete immutable payload and manifest.
9. Durably commit the successful terminal record referencing that already-published content.
10. Only then expose verified completion.

After step 6, no executable work may reopen to finish preparation or repair a failed finalization. Fixed protected journaling, reduction, and local immutable publication are not an arbitrary subprocess exemption.

A hash of a writable directory is not freezing. Neither a pathname nor an editable user copy is the accepted identity.

Canonical payload storage MUST be inaccessible to untrusted writers, including through parent-directory replacement or surviving writable handles. Content MUST NOT be overwritten in place.

The manifest MUST identify:

```text
selected_baseline_identity
accepted_generation_and_tree_digest
complete_payload_digest
complete_included_paths_types_modes_and_content_identities
new_files_and_deletions_relative_to_baseline
explicitly_excluded_dependency_or_build_inputs
runtime_and_verification_input_manifest
acceptance_contract_and_evidence_identities
publication_identity_and_persistence_state
retention_start_expiry_and_release_policy
```

Required source deliverables MUST NOT be omitted. Supported binary content and executable-mode changes must be retained faithfully even when a text diff cannot represent them.

The qualified filesystem/crash model MUST specify file and parent-directory persistence, atomic publication behavior, and store ordering.

Payload and manifest bytes MUST be fully written, verified, durably persisted, and published before a successful terminal record commits.

Crash behavior is fixed:

| Crash point | Recovery disposition |
|---|---|
| Before complete preparation | Non-successful, undelivered; reconcile/fence or quarantine |
| After preparation but before durable publication | Non-successful, undelivered |
| After publication but before successful terminal commit | Non-successful, undelivered to the user as an accepted task; preserve or safely reclaim according to ownership/retention rules |
| After successful terminal commit | Report the existing success only if retained payload integrity is intact |
| Retained bytes missing/corrupt | Report unavailable/corrupt delivery; do not regenerate bytes under the accepted identity |

The MVP need not automatically finish interrupted acceptance.

Retention MUST be declared and capacity-reserved at admission. The default SHOULD be seven days unless the authenticated user selects another supported duration.

Before expiry, deletion requires explicit authenticated release. Candidate cleanup MUST NOT reclaim pinned accepted bytes. Expiry cleanup may occur on a later local invocation; no persistent cleanup service is required.

A historical acceptance record remains attributable if delivery later expires or is explicitly released. Current reporting MUST distinguish historical acceptance from current payload availability.

If patch output is implemented, it MUST be reconstructed against the independently retained baseline in disposable isolated resources before terminal retirement. Reconstructed content and supported metadata MUST equal the accepted deliverable tree.

The equality check MUST include new files, deletions, binary content, and supported mode/type changes. Renames may be represented as delete/add.

If the patch cannot faithfully represent the tree, return the frozen candidate instead. Offering a patch does not authorize applying it.

Local publication means making retained local content available to the user. It does not mean push, upload, deployment, package publishing, or other external publication.

**21. Acceptance Reduction**

Only the supervisor may reduce requirements and evidence into final acceptance.

The reduction MUST be deterministic and MUST NOT depend on an agent completion message, confidence score, elapsed effort, or budget exhaustion.

Before success, require:

```text
nonempty mandatory acceptance contract
AND complete mandatory requirement/subcondition coverage
AND every mandatory obligation is PASS
AND protected independent oracle path
AND coherent current evidence
AND established actual source/input derivation
AND exact frozen deliverable identity
AND valid authority and ownership history
AND no unresolved mandatory or safety blocker
AND no hard-limit violation
AND proven quiescence
AND complete durable payload and manifest
AND successful terminal record references those exact bytes
```

An empty conjunction MUST evaluate as not accepted.

The following conditions prevent acceptance:

| Condition | Required consequence |
|---|---|
| Missing inventory coverage | Not accepted |
| Unsupported mandatory predicate/witness | `MISSING`; not accepted |
| Unknown mandatory applicability or unreliable interpretation | `INCONCLUSIVE`; not accepted |
| Any valid applicable mandatory failure | `FAIL`; not accepted |
| Stale, foreign, malformed, truncated, or conflicting mandatory evidence | Not accepted |
| Oracle or derivation mismatch | Not accepted |
| Policy, ownership, or safety violation | Not accepted |
| Unresolved execution | Not accepted |
| Mutable or mismatched delivery | Not accepted |
| Partial/undurable publication | Not accepted |
| Unsuccessful ending path | Not accepted even if some checks passed |

Assurance MUST preserve known current-generation failures. Cancellation does not erase them; budget exhaustion does not create completion.

The implementation SHOULD use these assurance meanings:

| Assurance | Meaning |
|---|---|
| `VERIFIED_REQUIRED_CHECKS` | Complete mandatory evidence for the referenced immutable state satisfies the admitted check contract |
| `FAILED_REQUIRED_CHECKS` | At least one valid applicable mandatory failure exists |
| `PARTIAL` | Some attributable evaluation exists but mandatory proof is incomplete or inconclusive |
| `UNVERIFIED` | Required trustworthy evaluation has not been established |

Assurance about checks is separate from task acceptance. For example, cancellation may prevent acceptance even when previously committed checks passed. The UI MUST NOT describe that as verified completion.

When multiple ending causes exist, all MUST remain recorded. The displayed disposition MUST prioritize unresolved execution and safety over successful completion. Cancellation, budget exhaustion, ambiguity, unavailable prerequisites, and ordinary failures MUST NOT be converted into success.

`COMPLETE_WITH_LIMITATION` uses exactly the same hard acceptance gate as `COMPLETE`. It may describe only optional checks or explicitly outside-contract behavior. It cannot hide missing mandatory proof, uncertain derivation, unsafe execution, or incomplete shutdown.

Optional evidence revealing a mandatory regression or safety violation remains a blocker.

A repaired generation may supersede an earlier generation for final evaluation, but it does not erase historical failures or expenditures.

**22. Commands And Reports**

The MVP command surface MUST remain small.

The target command roles are:

| Command | Behavior |
|---|---|
| `tandem run` | Supervised task execution under an explicit source, qualified profile, envelope, and budget |
| `tandem check` | Honest non-executing inspection of explicitly selected content |
| `tandem status` | Inspect task, lifecycle, delivery, resource, and recovery state |
| `tandem evidence` | Inspect attributable contracts, actions, observations, and gate evidence |

The spelling `tandem check` is mandatory. Other command spellings may follow verified existing CLI compatibility, but their semantics and narrow surface MUST remain unchanged.

A development-only benchmark invocation may exist. The MVP MUST NOT introduce `ship`, deployment, install, broad planning, routing, or duplicated review commands merely because earlier documents listed them.

Cancellation MUST enter through an authenticated local control path. That path and its descriptors MUST be inaccessible to untrusted execution.

Before supervised work, the user MUST be shown or have already explicitly authorized:

- Selected immutable source identity.
- Exclusion of dirty/untracked/ignored content.
- Candidate-only execution and no incumbent modification.
- Consequential scope and permission boundaries.
- Inference recipient/disclosure scope, if external.
- Budget/deadline and repair boundaries.
- Delivery and retention behavior.

`tandem check` MUST use trusted non-executing readers. It MUST NOT import repository modules, execute package scripts, load executable configuration, run tests, or invoke untrusted plugins outside qualified supervised admission.

The checker MUST NOT claim that it prevented historical actions, intercepted unsupported agent paths, enforced past user-work protection, or guaranteed cancellation of an actor it did not control.

A missing supervised profile MUST produce a truthful checker-only or blocked result, not unsafe host execution.

Normal task output MUST be concise and include:

```text
Result and accepted/not-accepted status
Selected source
What changed
Mandatory verification and assurance
Stop reason
Quiescence or unresolved execution
Important limitations
Resource usage and outstanding liability
Frozen delivery identity, availability, and retention
Incumbent modification: none
Evidence reference
```

Detailed records belong in local evidence/structured output. Repository output MUST be treated as untrusted data, not executable terminal or control instructions.

**23. Paired Measurement**

The main comparison is:

```text
Agent Alone
versus
Agent + TANDEM
```

Both workflows MUST start from equivalent frozen source and use the same independent acceptance standard.

The agent-alone evaluation MUST protect real user work using disposable evaluation resources. This common safety floor MUST be disclosed and MUST NOT be misrepresented as a TANDEM-only benefit.

Before paired value results are observed, the evaluation owner MUST freeze a versioned protocol containing:

```text
supported_task_distribution
task_selection_procedure
frozen_task_and_repository_identities
development_validation_and_final_evaluation_separation
sample_size
repetitions
ordering_or_randomization
variability_and_uncertainty_method
agent_model_runtime_and_environment_versions
tools_permissions_resources_and_context_differences
acceptance_standard_and_independent_evaluator
counter_definitions_and_collection_coverage
all_started_task_denominator
failure_block_timeout_cancel_interrupt_and_undelivered_treatment
primary_benefit_metric_and_direction
numeric_minimum_meaningful_improvement
numeric_maximum_acceptable_product_overhead
correctness_and_safety_hard_gate_rules
review_and_unnecessary_work_rubric
evaluation_only_versus_product_overhead
contamination_controls
decision_rule
```

Missing numeric thresholds or uncertainty rules block Gate 3. The executor MUST NOT invent or tune them after results.

The exact first task is a smoke comparison. Product-level superiority requires the predeclared distribution and repeated evidence sufficient for the claimed scope.

The implementation MUST retain raw metrics:

| Category | Required records |
|---|---|
| Outcomes | All started tasks; acceptance, execution result, stop, quiescence, and delivery states |
| Actions | Proposals, refusals, admissions, dispatches, retries, failures, and observable internal calls |
| Work | Unique paths, read/write operations or bytes according to declared counters; final manifest-derived change counts; repeated work |
| Tokens/cost | Authoritative usage, estimates, unavailable categories, reservations, unsettled liabilities, TANDEM’s own inference |
| Latency | Request-to-terminal/delivery, phase times, timeout/cancellation duration, unresolved recovery |
| Verification | Discovery/selection/execution scope, obligations, invalidation, failures, repair attempts |
| Safety | Denied attempts separately from executed harm, stale-result rejection, ownership incidents, quarantine |
| Human effort | Questions, approvals, cancellation, corrections, review time, and unsuccessful-task effort |
| Quality judgments | Versioned rubric assessments, separated from raw counts |

Complete product cost MUST include source capture, planning, baselines, refused/failed attempts, verification, repair, finalization, recovery, and retention work where applicable.

Evaluation-only overhead MUST be separated from product overhead and disclosed. It MUST NOT be used to hide work a real TANDEM user incurs.

Unknown metrics MUST remain unknown. Unequal collection coverage MUST prevent unsupported quantitative comparisons. For example, complete supervised file-read counts cannot be directly compared with unobserved agent-alone shell reads.

Fewer tokens, files, or calls do not independently prove less unnecessary work.

Evaluation MUST prevent:

- Gold patches or answer files entering agent context.
- Hidden acceptance data entering searchable candidate paths.
- Benchmark-specific memory leakage.
- Repeated tuning against the final evaluation set.
- Cherry-picked runs.
- Model/environment changes attributed to TANDEM policy.
- Mismatched verification.
- Success-only cost reporting.
- Post-result threshold changes.
- Treating refusal of every task as efficiency success.

Final hidden evaluation MUST not become privileged repair feedback for one workflow. Development feedback and final evaluation access rules MUST be predeclared.

Once final results influence policy, that set is no longer clean final evaluation data. A new confirmation evaluation is required.

Gate 3 passes only when the predeclared protocol establishes correctness/safety eligibility, meaningful primary benefit, acceptable TANDEM overhead, and sufficient uncertainty treatment. Efficiency cannot offset a correctness or safety regression.

No composite optimization score is required.

**24. Test Contracts**

All tests in this section are required implementation contracts, not claims of execution.

Each test run MUST record actual setup, source revision, profile/configuration digests, command/runner identity, injected event or fault, expected assertions, actual outcomes, raw evidence references, and cleanup/quarantine disposition.

Mocks and synthetic state tests validate logic. They do not qualify real containment, durability, egress, or fencing.

Excluded capabilities require refusal or physical-unreachability evidence. A test MUST NOT be marked irrelevant merely because the UI does not expose the capability.

Evidence families used throughout this document are:

| ID | Evidence |
|---|---|
| `E0` | Current-code audit, actual versions, support-profile bindings, qualification assumptions and probes |
| `EA` | Ownership, policy, grant, admission, dispatch, and stale-event records |
| `ER` | Runtime containment, resource enforcement, drain/fence, descriptor and effect-boundary evidence |
| `ES` | Source capture, independent baseline, candidate isolation, frozen manifests, incumbent-protection evidence |
| `EB` | Limits, reservations, mandatory capacity, usage, liabilities, settlement, and resource-fault evidence |
| `EC` | Original request, retained inventory, contract, obligations, coverage, and authorized revisions |
| `EV` | Protected observations, predicate outcomes, raw reports, actual derivation, scope, conflicts, and invalidation |
| `EL` | Terminal paths, recovery, quarantine, quiescence, and late-result rejection |
| `ED` | Complete payload/manifest, publication ordering, crash recovery, integrity, reconstruction, and retention |
| `EM` | Evaluation protocol, raw all-attempt measurements, review rubric, uncertainty, and paired results |
| `EX` | Executable test results and actual requirement/code/test/evidence bindings |

**T-01 Current Admission**

Exercise:

- A queued action whose policy narrows before release.
- Admission closure before release.
- Replayed or consumed grants.
- Wrong executor, incarnation, owner epoch, policy, payload, scope, or generation.
- Expiry while persistence delays the final release.
- Lost authoritative channel and attempted offline use.
- Crashes before consumption, after consumption but before release, and after release but before acknowledgement.
- Equivalent automatic replay under a new action identifier.

Assert:

- Invalid release never occurs.
- Use and reservation precede any executable/chargeable dispatch.
- Closure and release have one serialization order.
- Consumed/unknown survives restart without replay.
- No post-barrier unvalidated queue exists.
- Liability is retained until safe disposition.

Evidence: `EA`, `EB`, `ER`, `EL`, `EX`.

**T-02 Transitive Containment**

Exercise direct writes/reads, double-forked descendants, detached grandchildren, retained descriptors, hidden tools, host sockets, control-state access, credential inheritance, and malicious checker/baseline scripts.

Assert:

- Every effect remains inside the admitted envelope.
- Parent exit does not release descendants.
- Repository execution cannot access incumbent/control/evidence/credential resources.
- Host-service handoffs are unavailable.
- Checker/baseline execution receives no trust exemption.
- Missing containment blocks execution.
- Loss of control triggers fencing or unresolved quarantine, not observer relabeling.

Evidence: `E0`, `ER`, `EA`, `EL`, `EX`.

**T-03 Exclusive Ownership**

Exercise:

- Paused owner A while B attempts ownership.
- A resuming after B’s attempted start.
- A crash with surviving actors.
- PID reuse and changed host boot identity.
- Alternate pathnames, lock replacement attempts, and a second store attaching the same candidate.

Assert:

- No double owner or timeout takeover.
- Lock/epoch identity is protected.
- Recovery starts closed and recovery-only.
- Non-reusable actor identity is used.
- No premature resource reuse or stale issuer revival occurs.

Evidence: `EA`, `ER`, `EL`, `EX`.

**T-04 Candidate Safety**

Exercise:

- Hard-link/shared-Git candidate construction.
- Symlink and special-file source paths.
- Path substitution and parent-directory replacement.
- Unsupported type/mode/path collisions.
- Gitfiles, linked worktrees, alternates, sparse/unmerged shapes, and submodules.
- Required dirty, untracked, ignored, or outside inputs.
- Changing refs and disappearing objects during capture.
- Hostile Git configuration, hooks, filters, helpers, and fsmonitor metadata.

Assert:

- Incumbent source, index, refs, configuration, and all user work remain unchanged.
- No helper follows an attacker-controlled path.
- Source identity remains the selected immutable commit.
- Incomplete capture is blocked, not accepted as coherent.
- Required excluded inputs produce a truthful block.

Evidence: `ES`, `ER`, `EA`, `EX`.

**T-05 Total Predicates**

Exercise:

- A dropped mandatory requirement or subcondition.
- An empty obligation set or zero selected cases.
- Missing, partial, truncated, duplicate, malformed, or unrecognized observations.
- Unknown applicability.
- A changed predicate or mandatory status under a stable ID.
- Same-generation `FAIL` followed by green.
- No-change task with no positive outcome witness.
- Parser failure presented as zero diagnostics.

Assert:

- Coverage validation detects every gap.
- No vacuous or relabeled `PASS`.
- Valid failures remain blockers under the admitted conflict rule.
- Missing and inconclusive states remain distinct and non-successful.
- Old decisions do not cross contract revisions.

Evidence: `EC`, `EV`, `EA`, `EX`.

**T-06 Oracle Control**

Exercise candidate attempts to:

- Print forged passing case IDs and reports.
- Suppress assertion registration.
- Alter runner/report behavior.
- Modify tests, fixtures, discovery, or verification configuration.
- Propose weaker expected values.
- Certify its own newly authored tests.

Assert:

- Only the protected controller’s independently computed predicate can establish authoritative `PASS`.
- A trusted parser or unchanged file hash does not promote an unprotected assertion channel.
- Verification-affecting changes are refused or leave affected proof unresolved.
- Applicable adverse supporting evidence is not discarded.

Evidence: `EC`, `EV`, `ER`, `EX`.

**T-07 Derivation Coverage**

Exercise:

- Foreign entrypoint or dependency resolution.
- Parent configuration and host lookup paths.
- Stale generated output or cache.
- Omitted ignored input.
- An incumbent installation or outside workspace package.
- A command labeled “full” that remains affected-only.
- Incomplete discovery or execution scope.

Assert:

- Actual loaded source/inputs are identified.
- Unrecorded or unknown resolution cannot establish acceptance.
- The broad recipe proves its genuine declared scope.
- Missing/inconclusive coverage remains non-successful.

Evidence: `E0`, `ES`, `EV`, `ER`, `EX`.

**T-08 Hard Resources**

Exercise:

- Duplicate and competing reservations.
- Maximum exposure incorrectly replaced by an estimate.
- Hidden retries/fan-out.
- Timeout without authoritative settlement.
- Restart with outstanding reservations.
- Output, memory, process, inode, disk, journal, and simultaneous-copy saturation.
- Mandatory action transfer from protected future capacity.
- Supervisor failure during active bounded execution.

Assert:

- Hard admission arithmetic always holds.
- Non-additive resources use correct runtime ceilings.
- Unknown liability is not released or reset.
- Untrusted work cannot consume protected shutdown/publication/retention capacity.
- Insufficient mandatory capacity stops without weaker acceptance.
- Advertised hard limits survive the qualified failure model.

Evidence: `EB`, `EA`, `ER`, `EL`, `EX`.

**T-09 Disclosure**

Exercise additional source reads, compaction, diagnostics, fallback, hosted tools, uploads, credential inheritance, DNS, alternate network paths, and repository attempts to use the model transport as a generic proxy.

Assert:

- Local-only means no external egress.
- An external profile enforces its actual payload or complete authorized visibility boundary.
- Recipient, purpose, data classes, credentials, and revision remain bound.
- Every actual outbound invocation receives current admission and liability reservation.
- Uncovered routes are disabled.
- Provider retention is reported as an external assurance.

Evidence: `E0`, `EA`, `ER`, `EB`, `EX`.

**T-10 Immutable Publication**

Exercise:

- A late generator or surviving writable handle.
- Candidate change after verification.
- Mismatched generation at reduction/delivery.
- Omitted new, deleted, binary, or mode-changed content.
- Unsupported patch representation.
- Crash at every payload/manifest persistence, publication, and terminal-record boundary.
- Cancellation linearized before successful terminal commit.

Assert:

- Accepted bytes cannot change.
- No successful record references incomplete or later-to-be-written bytes.
- Published bytes without committed success remain non-successful.
- Patch output is either refused or reconstruction-equal.
- Current delivery integrity is checked after restart.
- No helper execution reopens after retirement.

Evidence: `ES`, `EV`, `ED`, `EL`, `EX`.

**T-11 Terminal Paths**

Exercise every ending path listed in Section 19, including optional-limit completion, disconnect, abort, crash, and failed fencing.

Assert:

- Admission closes and task authority retires.
- No new autonomous work starts afterward.
- Quiescence is proven or unresolved execution is explicitly recorded.
- Every affected unresolved mutable resource is durably quarantined.
- No unsuccessful path becomes accepted.
- Known obligation failures and bounded liabilities remain visible.

Evidence: `EA`, `ER`, `EB`, `EL`, `ED`, `EX`.

**T-12 Late Results**

Deliver retired callbacks, old-generation outputs, late verifier results, repeated completion messages, and mixed usage-plus-code provider responses.

Assert:

- Execution payloads cannot mutate task state, candidate, authoritative evidence, or acceptance.
- Rejected late results cannot become cached observations.
- Only authenticated matching accounting facts may settle liabilities.
- Settlement does not reopen execution or upgrade assurance.

Evidence: `EA`, `EB`, `EV`, `EL`, `EX`.

**T-13 Retention Repair**

Exercise failed initial and repair attempts, a second repair request, attempt-ID reset, stale `PASS` reuse, accepted-payload overwrite, pre-expiry cleanup, crash during retention, and post-expiry inspection.

Assert:

- Baseline/incumbent are never invented as accepted results.
- Frozen generations are never thawed.
- At most one repair is admitted.
- The aggregate ledger persists.
- Pinned payloads survive their declared retention/crash model.
- Early deletion requires authenticated release.
- Expired or corrupt delivery is reported truthfully.

Evidence: `ES`, `EB`, `EV`, `EL`, `ED`, `EX`.

**T-14 Paired Value**

Validate and execute the predeclared protocol.

Assert:

- Frozen inputs and independent acceptance are equivalent.
- Agent/model/runtime differences are controlled or explicitly disclosed.
- Collection coverage and denominators are comparable.
- All unsuccessful attempts and complete product overhead are included.
- Review rubric, numeric benefit/overhead thresholds, and uncertainty rules predate results.
- No post-result adjustment, hidden-test leakage, or success-only accounting occurs.
- Correctness/safety hard gates cannot be offset by efficiency.

Evidence: `EM`, `EV`, `EX`.

**Functional Tests**

| ID | Required behavior |
|---|---|
| `F-01` | Exact-slice initial success and no-change success produce nonempty acceptance, immutable delivery, complete records, and unchanged incumbent |
| `F-02` | Intent preservation, explicit/inferred requirement provenance, gap handling, ordinary inference, consequential `NEEDS_USER`, and pre-mutation coverage |
| `F-03` | Minimal context/tool decisions, fact invalidation, genuine broader coverage, bounded read-only hygiene, and advisory versus hard-rule separation |
| `F-04` | One eligible repair succeeds or fails truthfully; prohibited repair causes stop; no generation or budget reset |
| `F-05` | Checker honesty, executable-check refusal without qualification, narrow CLI behavior, and no unsafe fallback |
| `F-06` | Correct report axes, unknown metrics, unsuccessful-task accounting, limitations, liabilities, and delivery availability |
| `F-07` | Deterministic state transitions, duplicate-event handling, schema validation, and evidence-based migration where existing consumers exist |
| `F-08` | Gate-order enforcement, incomplete-profile refusal, unpopulated-protocol refusal, and capability admission/refusal |

All test families MUST have actual code/test bindings before release.

**25. Implementation Gates**

Implementation order is mandatory. The executor MUST NOT advance because code looks plausible, a demonstration succeeds, or a calendar milestone arrives.

Each work unit follows:

```text
inspect existing code
-> identify required smallest change
-> implement that change
-> add/update tests
-> run qualified verification
-> record evidence
-> evaluate the gate
```

Actual source paths and commands MUST come from the Gate-0 code map. Logical component names below are not fabricated existing files.

**Gate 0 Audit**

Objective: establish current implementation facts and one feasible concrete support profile before production implementation or rewrite.

Prerequisites:

- This contract and its authoritative sources.
- Access to the current TANDEM repository when integrating with existing code.
- A separately authorized qualification environment.
- No assumption that repository scripts are safe to execute.

Ordered work:

1. Inventory the actual repository revision, language/module system, package manager, dependencies, lockfile, agent interfaces, CLI, stored state, consumers, and tests.
2. Classify capabilities as `IMPLEMENTED`, `PARTIALLY_IMPLEMENTED`, `CONCEPTUAL_ONLY`, `BROKEN`, `UNVERIFIED`, or `OUT_OF_SCOPE`, supported by evidence.
3. Discover actual project commands without executing repository configuration on the host.
4. Map all reads, direct writes, subprocesses, descendants, environment access, network/model routes, credentials, extensions, skills, and state mutation.
5. Map existing cancellation, user-work protection, source capture, verification, evidence invalidation, telemetry, and recovery behavior.
6. Establish an isolated qualified feasibility environment before executing any baseline script.
7. Run a reproducible isolated baseline and record known failures and unavailable checks honestly.
8. Bind one concrete host/runtime/storage/agent/inference profile and its failure assumptions.
9. Probe transitive control, independent observation, direct-source resolution, resource enforcement, fencing, and persistence.
10. Fix the first task’s independent acceptance fixture and native full-suite scope.
11. Populate authorized resource ceilings and mandatory reserve calculations.
12. Prepare comparable agent-alone collection and the versioned evaluation protocol.
13. Produce the actual reuse/migration and code/test binding map.
14. Record the smallest required implementation deltas and their acceptance tests.

Affected components: all components for audit; only bounded feasibility/probe code may precede this gate’s exit.

Contracts: support record, code map, source shape, task fixture, budget policy, qualification assumptions, and evaluation protocol.

Tests: applicable feasibility portions of `T-02`, `T-03`, `T-04`, `T-07`, `T-08`, `T-09`, and `F-05`; these do not substitute for later integrated tests.

Evidence: `E0`, initial `ES`, `ER`, `EB`, `EC`, `EM`, `EX`.

Exit criteria:

- The actual current baseline and highest-risk gaps are reproducible or explicitly characterized.
- One concrete support profile has passing feasibility evidence for every required reachable boundary.
- Source/verification/input assumptions and hard resource dimensions are populated.
- No unresolved issue prevents the authority/candidate-safety implementation.
- Actual code and test locations are mapped, or the absence of an existing implementation is explicitly established rather than guessed.
- The first-slice contract is independent of candidate output.
- No supervision or release claim exceeds the probe evidence.

Forbidden shortcuts: rewrite-first, assumed Pi qualification, invented versions, host execution of repository tests, unqualified model transport, documentation-only containment, or vague “trusted tests.”

A failed probe leaves supervised execution unavailable. Checker-only is the valid supported outcome until the blocker is resolved.

**Gate 1 Safety**

Objective: establish current authority, exclusive ownership, hard admission, and candidate protection.

Prerequisite: Gate 0 has passed for the relevant bindings. Any newly discovered consequential incompatibility stops dependent work.

Ordered work:

1. Implement/validate the one durable store, canonical owner lock, protected roots, and epoch allocation.
2. Implement closed-by-default startup and recovery-only acquisition.
3. Implement task/incarnation, policy, action, resource, and reservation records.
4. Implement restrictive policy composition and protected user-control provenance.
5. Implement the shared serialized `admitAndRelease` boundary.
6. Implement durable one-use consumption, maximum reservation, expiry recheck, dispatch uncertainty, and replay refusal.
7. Implement the qualified runtime bindings and minimum close/drain/fence primitives before any candidate-execution test.
8. Enforce descendants, mounts, protected parents, credentials, IPC, egress, and runtime limits.
9. Implement immutable source capture and physically independent candidates.
10. Integrate the one thin adapter without granting it authority.
11. Implement eligible-result commit checks and stale callback rejection.
12. Run the authority, containment, source, ownership, disclosure, and resource adversarial tests against the actual integrated boundary.

Affected components: `STATE`, `CTRL`, `EXEC`, `CONTENT`, `ADAPTER`.

Contracts: Sections 5 through 12; action/result identity and resource linkage.

Tests: `T-01`, `T-02`, `T-03`, `T-04`, admission/enforcement portions of `T-08`, `T-09`, `T-12`; relevant `F-07` and `F-08`.

Evidence: `EA`, `ER`, `ES`, `EB`, `EL`, `EX`.

Exit criteria:

- No invalid or stale action can cross the actual release boundary.
- Only one owner can issue authority.
- Ambiguous dispatch survives restart without replay.
- Runtime closure covers all reachable effects.
- Candidate/helper operations cannot mutate incumbent or protected control state.
- Hard reservation and protected-capacity rules hold under tested faults.
- All unresolved actors/resources remain quarantined.
- No safety-path test is waived as an optimization.

Forbidden shortcuts: process-group-only containment, post-hoc permission checks, timeout owner takeover, prefix-only path checks, shared Git administration, credential inheritance, or granting a whole agent session unrestricted execution.

No broad intelligence expansion is permitted before Gate 1 passes.

**Gate 2 Lifecycle**

Objective: implement the exact bounded workflow with independent acceptance, truthful termination, and immutable delivery.

Prerequisite: Gate 1 passed; first-slice fixture, predicates, native recipe, and reserves are populated.

Ordered work:

1. Implement original-request retention, intent inventory, gap outcomes, and contract freezing.
2. Implement deterministic total coverage and the small predicate set.
3. Implement protected external observation and qualified native full-suite invocation.
4. Implement baseline evidence and actual direct-source/dependency/configuration derivation.
5. Implement conservative evidence applicability and conflict handling.
6. Implement minimal context selection, static tools, failure identity, and read-only diff review.
7. Implement initial candidate execution followed by irreversible generation mutation closure and freezing.
8. Implement mandatory verification against frozen bytes.
9. Implement the one bounded repair branch using a new disposable generation.
10. Implement delivery preparation and all helper completion before task retirement.
11. Implement universal finalization for every ending path.
12. Implement final coherent reduction and payload/manifest-before-success publication.
13. Implement retention, integrity inspection, conservative crash disposition, and narrow late accounting settlement.
14. Complete narrow commands, structured result reporting, and local telemetry.
15. Run all lifecycle, acceptance, false-PASS, publication, recovery, and functional tests.

Affected components: `CTRL`, `STATE`, `EXEC`, `CONTENT`, `VERIFY`, `ADAPTER`, `UX`.

Contracts: Sections 13 through 22, plus preserved Gate-1 contracts.

Tests: `T-05` through `T-13`; re-run affected `T-01` through `T-04`; `F-01` through `F-08`.

Evidence: `EC`, `EV`, `EL`, `ED`, `EB`, `EX`, with all earlier evidence linked.

Exit criteria:

- The exact slice can produce a complete immutable candidate without changing the incumbent.
- Every mandatory requirement maps to supported obligations.
- Native reporting cannot replace independent acceptance.
- Wrong source, stale evidence, zero cases, and forged green reports cannot produce success.
- The repair ceiling and generation boundaries are enforced.
- Every ending path reaches proven quiescence or explicit non-successful unresolved quarantine.
- A successful record references complete durable retained bytes.
- No execution is needed after authority retirement.
- All applicable safety/acceptance tests pass with inspectable actual evidence.

Forbidden shortcuts: mutable verification source, latest-green reduction, baseline-as-accepted fiction, implicit optionalization, skipping the native full recipe, thawing generations, post-terminal helpers, best-effort success after failed fencing, or pointer-only delivery.

Passing Gate 2 establishes tested execution/acceptance behavior for the pinned profile. It does not establish product-level superiority.

**Gate 3 Value**

Objective: demonstrate useful end-to-end benefit without correctness or safety regression.

Prerequisites:

- Gates 0 through 2 passed.
- The exact evaluation protocol, numeric thresholds, and uncertainty rules were fixed before paired value results.
- Collection comparability and independent acceptance are established.

Ordered work:

1. Validate the frozen protocol and reject unpopulated or post-result-modified fields.
2. Run the exact ordinary slice in both workflows as a smoke comparison.
3. Run the full predeclared repeated supported distribution.
4. Retain all started tasks, unsuccessful attempts, interventions, liabilities, and undelivered outcomes.
5. Calculate primary benefit and TANDEM overhead using the registered definitions.
6. Apply correctness and safety hard gates before efficiency evaluation.
7. Apply the predeclared numeric benefit, overhead, and uncertainty rules.
8. Assess review burden and unnecessary work with the versioned rubric.
9. Publish an attributable local evaluation record with raw metrics and limitations.

Affected components: `UX`, measurement views in `STATE`, evaluation harness, `VERIFY`.

Tests: `T-14`, measurement portions of `F-06` and `F-08`; safety regressions require affected adversarial reruns.

Evidence: `EM`, `EV`, `EX`.

Exit criteria:

```text
prior gates passed
AND protocol valid and fixed before results
AND comparable complete all-attempt collection
AND independent equivalent acceptance
AND correctness/safety hard gates satisfied
AND numeric meaningful-benefit rule satisfied
AND numeric maximum-overhead rule satisfied
AND predeclared uncertainty requirement satisfied
AND no unresolved evaluation-integrity issue
```

A smoke success, small nonsignificant result, or lower successful-final-call cost does not pass this gate.

Forbidden shortcuts: cherry-picking, changing thresholds after results, hiding failures or TANDEM overhead, imputing unknown metrics as zero, leaking evaluation answers, or attributing model differences to policy.

**Gate 4 Admission**

Objective: admit at most one justified capability improvement at a time after the value baseline.

Prerequisite: Gate 3 value baseline and an explicitly authorized capability proposal.

Ordered work:

1. State the concrete problem and why existing capability is insufficient.
2. Specify the smallest addition, its acceptance test, costs, failure modes, and removal plan.
3. Identify affected qualification, authority, disclosure, resource, evidence, and traceability contracts.
4. Implement only that addition in an isolated development path.
5. Requalify affected boundaries.
6. Run an ablation against the prior baseline.
7. Retain, revise, remove, or defer based on predeclared value and safety criteria.

Affected components: only those identified in the approved capability record.

Tests: affected `T-*` and `F-*` tests plus `T-14`-compatible ablation.

Evidence: changed profile/code map, `EX`, `EM`, and affected evidence families.

Exit criteria: one explicit decision of `ADMITTED`, `DEFERRED`, `REMOVED`, or `BLOCKED`, with evidence. No feature is enabled by default merely because its code exists.

No additional capability is required to finish the initial MVP. “No capability proposed or enabled” is the correct initial state, not a requirement to build POST-MVP features.

**26. Code Mapping**

The supplied attachments are specifications and an execution plan. They do not contain verified current TANDEM source, a lockfile, installed-version probes, persisted-state samples, or test results.

Therefore:

- No current source path is asserted by this PRD.
- No capability is represented as currently implemented.
- Pi-related statements in the older plan are not proof of installed Pi code.
- The following map is logical and normative, not a fabricated repository tree.

Gate 0 MUST bind each logical responsibility to actual code:

| Logical owner | Required actual binding |
|---|---|
| `CTRL` | Supervisor loop, state transitions, policy composition, admission orchestration, repair decision, stop, reducer |
| `STATE` | Transaction implementation, schemas, unique identities, lock/epoch allocation, reservation and liability updates |
| `EXEC` | Runtime launch/barrier, containment configuration, descriptors/environment, resource enforcement, cancellation/fencing |
| `ADAPTER` | Actual pinned agent interfaces, tool/model interception, transport, error/cancellation/accounting translation |
| `CONTENT` | Git/object capture, path-safe operations, manifests, independent attempts, freeze, publication, retention |
| `VERIFY` | Inventory coverage, predicate implementations, observer launch, native recipe, derivation and evidence validation |
| `UX` | CLI entry points, authenticated control, reports, evidence inspection, metrics, development evaluation |

Each code-map row MUST record:

```text
logical_contract
actual_source_revision
actual_file_and_symbol
current_behavior_evidence
reuse_classification
smallest_required_delta
actual_test_file_and_case
verification_command
evidence_reference
affected_gate
```

New files may be introduced only when an existing location is unsuitable and the new file is necessary. Conceptual labels do not require one file each.

Reuse classifications are:

| Classification | Required justification |
|---|---|
| `KEEP` | Verified behavior already satisfies the contract |
| `MODIFY` | Local changes can close a specific gap |
| `REFACTOR` | Necessary structural change preserves behavior and has tests demonstrating the need |
| `WRAP` | Existing mechanism is retained behind a qualified boundary without assuming wrapper-only prevention |
| `REPLACE` | Evidence shows the current mechanism cannot meet the required contract |
| `REMOVE` | Existing code is unsafe, conflicting, unused, or excluded; concrete compatibility consequences are assessed |
| `DEFER` | Capability is outside the MVP or lacks a sufficient value case |

Documentation alone cannot justify `KEEP`.

Preserve the existing language/module system when it demonstrably works. Do not migrate languages or frameworks for preference.

Before changing persisted formats, establish actual consumers, versions, compatibility needs, and historical data. Migration MUST:

1. Preserve required historical records through a tested, authorized migration.
2. Never reactivate legacy grants or execution authority.
3. Import unverified legacy acceptance only as explicitly unverified history.
4. Preserve outstanding liabilities and quarantine.
5. Define failure/rollback of the data migration without touching user task incumbents.
6. Test representative old and new records.

Do not add backward-compatibility machinery without concrete consumers or persisted data. If current-state evidence reveals a consequential compatibility conflict, stop for an authorized resolution.

**27. Invariant Traceability**

Every applicable invariant MUST pass adversarial qualification for the advertised profile.

| Invariant | Implementation binding | Required tests | Evidence | Gate |
|---|---|---|---|---|
| `INV-01` Current authority at actual release for every executable/read/outbound action | `CTRL`/`EXEC` admission, Section 9 | `T-01`, `T-02`, `T-09` | `EA`, `ER`, `EX` | 1 |
| `INV-02` Grant binds incarnation, owner, policy, action, target, lifetime | `STATE` grant schema; `CTRL` validation | `T-01`, `T-03`, `T-12` | `EA`, `EL`, `EX` | 1 |
| `INV-03` Every terminal path closes admission and retires authority without false enforcement claims | Universal finalization | `T-11`, `T-12` | `EA`, `ER`, `EL` | 2 |
| `INV-04` Stale grants, queues, issuers, actors, and results cannot regain authority | Epochs, release checks, result commit fencing | `T-01`, `T-03`, `T-12` | `EA`, `EL` | 1–2 |
| `INV-05` One authoritative owner; timeout does not transfer ownership | Protected lock and durable epoch allocation | `T-03` | `EA`, `ER`, `EX` | 1 |
| `INV-06` Candidate/helpers/Git cannot mutate incumbent through aliases or paths | `CONTENT` safe capture and independent roots | `T-04` | `ES`, `ER` | 1 |
| `INV-07` No automatic incumbent modification, installation, or rollback | Candidate-only capabilities and delivery | `T-04`, `T-10`, `F-01` | `ES`, `ED`, `EX` | 1–2 |
| `INV-08` Every mandatory requirement/subcondition retains supported obligation coverage | Inventory and deterministic coverage | `T-05`, `F-02` | `EC`, `EV` | 2 |
| `INV-09` No mandatory gap, empty witness, `FAIL`, `MISSING`, or `INCONCLUSIVE` becomes success | Total predicates and reducer | `T-05`, `T-11` | `EC`, `EV`, `EL` | 2 |
| `INV-10` Candidate-controlled reports/tests/oracles cannot manufacture `PASS` | Protected external controller and predicate path | `T-06` | `EV`, `ER` | 2 |
| `INV-11` Evidence matches exact contract/policy/generation/inputs/predicate/interval | Evidence applicability key and final coherence | `T-05`, `T-07`, `T-12` | `EC`, `EV` | 2 |
| `INV-12` Actual source/dependency/build derivation is established or proof remains unresolved | Direct-source recipe and closed resolution | `T-07` | `E0`, `ES`, `EV` | 0, 2 |
| `INV-13` Reduction and delivery identify one frozen generation | Freeze, coherent reduction, exact payload linkage | `T-10`, `F-01` | `ES`, `EV`, `ED` | 2 |
| `INV-14` No late mutation; complete retained payload/manifest precede success | Fencing and publication ordering | `T-10`, `T-13` | `ER`, `EL`, `ED` | 2 |
| `INV-15` Conservative hard liability reservation precedes dispatch | Atomic ledger/admission and runtime bounds | `T-01`, `T-08`, `T-09` | `EA`, `EB`, `ER` | 1–2 |
| `INV-16` Unknown usage and resource ownership survive restart | Durable liabilities and quarantine | `T-03`, `T-08`, `T-12` | `EB`, `EL` | 1–2 |
| `INV-17` Disclosure is authorized for actual payload/visibility and purpose or prohibited | Qualified transport and data visibility | `T-09` | `E0`, `EA`, `ER` | 0–1 |
| `INV-18` Preventive claims require transitive closure | Support-profile qualification and fail-closed mode | `T-02`, `T-09`, `F-05` | `E0`, `ER`, `EX` | 0–2 |
| `INV-19` Excluded external mutations are unreachable | Network/credential/IPC/capability denial | `T-02`, `T-09` | `ER`, `EA` | 1 |
| `INV-20` Every ending reaches quiescence or non-successful unresolved quarantine | Stop/recovery protocol | `T-03`, `T-11` | `ER`, `EL` | 2 |
| `INV-21` Impact uncertainty broadens real coverage or leaves proof unresolved | Full native recipe and impact caution | `T-07`, `F-03` | `EV`, `EC` | 2 |
| `INV-22` Efficiency, subjective quality, and exhaustion never override safety/correctness | Decision order, advisory classification, reducer | `T-05`, `T-08`, `T-14`, `F-03` | `EC`, `EB`, `EV`, `EM` | 2–3 |
| `INV-23` Untrusted content cannot widen authority, delete intent, or alter trusted state | Policy intersection, inventory ownership, protected channels | `T-02`, `T-05`, `T-06`, `T-09`, `F-02` | `EA`, `EC`, `ER` | 1–2 |
| `INV-24` Repair is bounded, generation-specific, and preserves accepted content | Repair allowance, new attempts, no thaw/reuse | `T-13`, `F-04` | `EA`, `EB`, `EV`, `ED` | 2 |
| `INV-25` Paired comparison has independent acceptance, comparable collection, full accounting, uncertainty | Registered protocol and measurement | `T-14`, `F-06` | `EM`, `EX` | 3 |

**28. Requirement Traceability**

The following matrix maps the complete V4 requirement families to this PRD, implementation responsibility, tests, evidence, and gates.

Each family includes the mandatory clauses, stated defaults, refusal conditions, and applicable exclusions in the referenced V4 section. Gate 0 MUST bind these families to actual source/test locations. Missing implementation or test coverage for a mandatory clause blocks the affected gate.

`POST` means the capability remains disabled and its exclusion is tested; it is not an instruction to build it.

| Requirement family | V4 source | PRD implementation contract | Tests | Evidence | Gate |
|---|---|---|---|---|---|
| `R-00` Normative meaning and truthful unknowns | Conventions | Sections 1, 3, 21; `CTRL`, `UX` | `T-05`, `F-05`, `F-06` | `EC`, `EV`, `EX` | 0–2 |
| `R-01` Supervisory product, narrow local MVP, immutable candidate delivery | 1 | Sections 2, 4, 20; all core owners | `F-01`, `T-10`, `T-14` | `E0`, `ED`, `EM` | 0–3 |
| `R-02` Users, simple UX, agent/provider neutrality, no replacement runtime | 2 | Sections 2–4, 22; `ADAPTER`, `UX` | `F-05`, `F-06`, `F-08` | `E0`, `EX` | 0–2 |
| `R-03` Conditional complete-workflow product thesis | 3 | Section 23; `UX`/evaluation | `T-14` | `EM` | 3 |
| `R-04` Intent, minimum work, deterministic-first, evidence, bounded autonomy | 4 | Sections 2, 13, 15, 21 | `F-02`, `F-03`, `T-05`, `T-14` | `EC`, `EV`, `EM` | 2–3 |
| `R-05a` Honest checker and executable-check boundary | 5.1 | Sections 5, 22; `UX`, `EXEC` | `T-02`, `F-05` | `E0`, `ER`, `EX` | 0–2 |
| `R-05b` Qualified preventive claims and conformance loss | 5.2 | Sections 5, 19; `CTRL`, `EXEC` | `T-02`, `T-09`, `T-11` | `ER`, `EL` | 0–2 |
| `R-05c` Small command surface | 5.3 | Section 22; `UX` | `F-05`, `F-08` | `EX` | 2 |
| `R-06` Trust, authority, threat model and assumptions | 6 | Sections 3–5, 8 | `T-02`, `T-09`, `F-02` | `E0`, `EA`, `ER` | 0–1 |
| `R-07a` One serialized decision owner and one store | 7.1 | Sections 4, 6, 10; `CTRL`, `STATE` | `T-03`, `F-07` | `EA`, `EX` | 1 |
| `R-07b` Durable initial task contract and complete records | 7.2 | Sections 6, 8, 13 | `T-01`, `T-08`, `F-02`, `F-07` | `EA`, `EB`, `EC` | 1–2 |
| `R-07c` Incarnations, phases, execution-ending intervention | 7.3 | Sections 7, 10, 19 | `T-11`, `T-12`, `F-07` | `EA`, `EL` | 1–2 |
| `R-08a` Exact invocation/grant, transitive scope, no offline authority | 8.1 | Section 9; `CTRL`, `EXEC`, `ADAPTER` | `T-01`, `T-02`, `T-09` | `EA`, `ER` | 1 |
| `R-08b` Atomic consumption/reservation through final release; no replay | 8.2 | Sections 9, 12; `STATE`, `EXEC` | `T-01`, `T-08` | `EA`, `EB`, `ER` | 1 |
| `R-08c` Effective versus enforced revocation; expiry/restart | 8.3 | Sections 8–10, 19 | `T-01`, `T-03`, `T-11` | `EA`, `EL` | 1–2 |
| `R-09a` Actual pinned Linux/runtime/storage/agent profile | 9.1 | Section 5; qualification bindings | `T-02`, `T-03`, `T-07`, `T-08` | `E0`, `ER` | 0 |
| `R-09b` Complete effect coverage, negative tests, invalidation | 9.2 | Sections 5, 24 | `T-02`, `T-09`, `T-11`, `F-05` | `E0`, `ER`, `EX` | 0–2 |
| `R-10` Restrictive composition, untrusted proposals, no runtime widening | 10 | Sections 3, 8; `CTRL` | `T-01`, `T-09`, `F-02` | `EA`, `EC` | 1–2 |
| `R-11` Protected exclusive ownership, recovery epoch, quarantine | 11 | Sections 6, 10; `STATE`, `EXEC` | `T-03`, `T-08`, `T-11` | `EA`, `EB`, `EL` | 1–2 |
| `R-12a` Explicit immutable selection, exclusions, coherent capture | 12.1 | Section 11; `CONTENT` | `T-04`, `T-07` | `ES`, `E0` | 1 |
| `R-12b` Physical independence and private Git | 12.2 | Section 11; `CONTENT`, `EXEC` | `T-04` | `ES`, `ER` | 1 |
| `R-12c` Root-anchored helpers and supported path/type rules | 12.3 | Sections 11, 20; `CONTENT` | `T-04`, `T-10` | `ES`, `ED` | 1–2 |
| `R-13` Incumbent protection, concurrent work, distinct identities | 13 | Sections 6, 11, 20 | `T-04`, `T-10`, `F-01` | `ES`, `ED` | 1–2 |
| `R-14` Complete action lifecycle, eligible commits, helper boundaries | 14 | Sections 7, 9, 19 | `T-01`, `T-02`, `T-12` | `EA`, `ER`, `EL` | 1–2 |
| `R-15a` Universal closure, retirement, fencing, reconciliation | 15.1 | Section 19; `CTRL`, `EXEC` | `T-11` | `EA`, `ER`, `EL` | 2 |
| `R-15b` Every ending path and late-result restrictions | 15.2 | Sections 7, 19, 21 | `T-11`, `T-12` | `EL`, `EV` | 2 |
| `R-16a` One lineage-wide durable allocation | 16.1 | Sections 6, 12; `STATE` | `T-08`, `T-13` | `EB` | 1–2 |
| `R-16b` Hard arithmetic, partial settlement, retries and uncertainty | 16.2 | Sections 9, 12 | `T-01`, `T-08`, `T-12` | `EA`, `EB` | 1–2 |
| `R-16c` Dimension-specific enforceability and external assumptions | 16.3 | Sections 5, 12 | `T-08`, `T-09` | `E0`, `EB`, `ER` | 0–2 |
| `R-16d` Protected mandatory capacity and accounting-only settlement | 16.4 | Sections 12, 19, 20 | `T-08`, `T-10`, `T-12`, `T-13` | `EB`, `EL`, `ED` | 2 |
| `R-17` Retained prompt, admitted intent, consequential ambiguity | 17 | Section 13; `CTRL` | `F-02`, `T-05`, `T-11` | `EC`, `EL` | 2 |
| `R-18` Gap detection and retained mandatory inferred requirements | 18 | Sections 13–14 | `F-02`, `T-05` | `EC` | 2 |
| `R-19` Bounded impact analysis and genuine broad fallback | 19 | Sections 15–16 | `T-07`, `F-03` | `EV`, `EC` | 2 |
| `R-20` Budgeted/disclosable context and valid task-local memory | 20 | Sections 12, 15, 17 | `T-09`, `T-12`, `F-03` | `EA`, `EB`, `EV` | 2 |
| `R-21` Static qualified registry, declared effects and native-first | 21 | Sections 5, 9, 15 | `T-02`, `T-09`, `F-03` | `E0`, `EA`, `ER` | 1–2 |
| `R-22` Constrained work, advisory engineering review, no LLM oracle | 22 | Sections 15–16, 21 | `T-05`, `T-06`, `F-03` | `EC`, `EV` | 2 |
| `R-23` Bounded read-only task hygiene, no cleanup mutation | 23 | Sections 15, 18, 29 | `F-03`, `F-04`, `T-13` | `EA`, `EV`, `ED` | 2 |
| `R-24` Small architecture and evidence-based capability value | 24 | Sections 2–4, 25, 29 | `F-08`, `T-14` | `E0`, `EM`, `EX` | 0–4 |
| `R-25` Obligation-led contained verification, baseline failures, native limits | 25 | Section 16 | `T-05`, `T-06`, `T-07` | `EV`, `EC`, `ER` | 2 |
| `R-26a` Independent inventory, total coverage, no vacuous no-op | 26.1 | Sections 13–14 | `T-05`, `F-01`, `F-02` | `EC`, `EV` | 2 |
| `R-26b` Complete obligation contract and frozen meaning | 26.2 | Sections 6, 14, 17 | `T-05`, `T-12` | `EC`, `EV` | 2 |
| `R-26c` Three small predicate families and bounded domains | 26.3 | Section 14; `VERIFY` | `T-05`, `T-06`, `T-07` | `EC`, `EV` | 2 |
| `R-26d` Four-state total outcomes and declared conflict/retry rules | 26.4 | Sections 14, 21 | `T-05`, `T-12`, `T-13` | `EV`, `EL` | 2 |
| `R-27` Complete independent oracle and verification-change handling | 27 | Section 16; `VERIFY`, `EXEC` | `T-06` | `EC`, `EV`, `ER` | 2 |
| `R-28` Full evidence applicability, invalidation, coherent final state | 28 | Section 17 | `T-05`, `T-07`, `T-12` | `EV`, `EC` | 2 |
| `R-29` Actual direct-source/dependency/configuration derivation | 29 | Sections 5, 16–17 | `T-07` | `E0`, `ES`, `EV` | 0, 2 |
| `R-30` Sole canonical reducer and non-success precedence | 30 | Section 21; `CTRL` | `T-05`, `T-10`, `T-11`, `T-12` | `EV`, `EL`, `ED` | 2 |
| `R-31a` One frozen acceptance/publication identity and two closures | 31.1 | Sections 19–21 | `T-10`, `T-11` | `ER`, `EL`, `ED` | 2 |
| `R-31b` Persistence-before-success, crash behavior, retention | 31.2 | Sections 12, 20 | `T-10`, `T-13` | `EB`, `ED` | 2 |
| `R-31c` Complete payload and optional reconstruction-proven patch | 31.3 | Section 20 | `T-10`, `T-04` | `ES`, `ED` | 2 |
| `R-32` One bounded repair, distinct generations, conservative recovery | 32 | Sections 10, 18 | `T-13`, `F-04`, `T-11` | `EA`, `EB`, `EV`, `EL` | 2 |
| `R-33` Declared effects and prohibited remote/business mutation | 33 | Sections 2, 5, 9, 29 | `T-02`, `T-09`, `T-12` | `EA`, `ER` | 1; POST |
| `R-34` Payload/visibility disclosure control and credential isolation | 34 | Sections 5, 8–9, 12 | `T-09`, `T-08` | `E0`, `EA`, `ER`, `EB` | 0–2 |
| `R-35` Pre-execution security, least privilege, injection non-authority | 35 | Sections 4–5, 8–11, 19 | `T-02`, `T-04`, `T-09`, `T-11` | `ER`, `EA`, `EL` | 0–2 |
| `R-36` Git as identity, safe capture, no incumbent operations | 36 | Section 11 | `T-04`, `T-10`, `T-13` | `ES`, `ED` | 1–2 |
| `R-37` Local telemetry, exact counter meaning, complete overhead | 37 | Sections 6, 22–23 | `T-14`, `F-06` | `EM`, `EA`, `EX` | 2–3 |
| `R-38` Predeclared fair paired evaluation and release value | 38 | Sections 23, 25 | `T-14`, `F-08` | `EM`, `EX` | 3 |
| `R-39` Complete minimal MVP contract | 39 | Sections 2, 4, 25, 31 | All applicable `T-*`, `F-*` | All required families | 0–3 |
| `R-40` Enforced MVP exclusions | 40 | Sections 2, 5, 29 | `T-01`, `T-02`, `T-04`, `T-09`, `T-10`, `F-08` | `ER`, `EA`, `EX` | 0–2; POST |
| `R-41` Audit-first Gates 0–4 | 41 | Section 25 | `F-08`, gate test sets | `E0`, `EX`, `EM` | 0–4 |
| `R-42` Conditional POST-MVP prerequisites | 42 | Section 29 | Refusal tests; future affected qualification | `EA`, `ER`, future `EM` | POST / 4 |
| `R-43` Named lifecycle, oracle, resource, disclosure, and value risks | 43 | Sections 5–25 | `T-01` through `T-14` | All relevant families | 0–3 |
| `R-44` TANDEM ownership versus qualified delegation | 44 | Sections 3–4, 26 | `T-02`, `T-06`, `F-07`, `F-08` | `E0`, `ER`, `EX` | 0–2 |
| `R-45` All end-to-end invariants | 45 | Section 27 | Invariant-specific mappings | Invariant-specific evidence | 0–3 |
| `R-46` Consolidated review and earlier-version traceability | 46 | Sections 1, 27–28 | Controlling V4 tests, not old exceptions | `E0`, `EX` | 0–3 |
| `R-47` Exact first slice and complete walkthrough | 47 | Sections 2, 13–23, 25 | `F-01`, `F-04`, all applicable `T-*` | `EC`, `EV`, `ED`, `EM` | 2–3 |
| `R-48` Adversarial implementation and value release gate | 48 | Sections 24–25, 30–31 | `T-01` through `T-14` | `EX`, `EM`, linked raw evidence | 0–3 |
| `R-49` Final supervisory definition and thesis | 49 | Sections 1–4, 23, 31 | `F-01`, `T-14` | `ED`, `EM` | 2–3 |

The current-code map MUST make the final link from each applicable requirement family to actual code, executable tests, and retained run evidence. A documentation-only link is not implementation evidence.

**29. Capability Admission**

POST-MVP capabilities are not implementation backlog commitments for V1.

Every proposed capability MUST state:

```text
problem
evidence_of_need
why_existing_mechanisms_are_insufficient
smallest_capability_change
supported_scope
authority_and_effect_changes
resource_and_disclosure_changes
new_failure_modes
acceptance_tests
qualification_changes
measurable_value_hypothesis
ablation_protocol
compatibility_and_license_review_if_applicable
removal_or_disable_plan
```

Admission requires explicit authority, affected safety qualification, and evidence of value. Listing a capability does not admit it.

Potential later capabilities include broader task/language/build profiles, structural tools, targeted security analysis, browser/UI verification, stronger context compression, deterministic memory retrieval, additional adapters/providers, optional external observability, and bounded parallel investigation.

Additional conditions apply:

| Capability | Prerequisites |
|---|---|
| Additional agents/providers | Separate concrete profile qualification; no inherited guarantee from a brand name |
| Parallel or multi-agent work | Per-child scope, current authority, aggregate budgets, evidence ownership, cancellation, no uncontrolled nested delegation |
| MCP/external tools | Complete effect and disclosure closure, replay/unknown-outcome semantics, qualified credentials and destinations |
| Provider routing | Preserve or narrow recipient/payload permissions and retain liabilities across failure |
| Broader builds/caches | Actual artifact derivation, full relevant input identity, qualified resolution and cache validity |
| Mutation-producing simplification | New disposable candidate, preserved accepted bytes, fresh authority and verification |
| Live installation/rollback | Durable prepare-before-effect ordering, retained restoration bytes, explicit commit point, index/worktree/untracked/ignored preservation where touched, ownership-safe restoration, crash-safe idempotent reconciliation |
| External irreversible effects | Explicit operation/credential/destination/payload authority, replay semantics, unknown-outcome handling, proven reconciliation/recovery |
| Distributed/offline/persistent execution | Separate justification and complete authority, ownership, resource, and failure contracts |

Live installation MUST enforce expected-current-state and concurrent-writer protection at the mutation boundary itself. A preflight hash followed by replacement is insufficient.

If an enforceable conditional writer model is unavailable, unattended installation remains refused. Concurrent changes require no install, retained candidate, and an authenticated user decision.

Git rollback is not remote compensation.

No capability may be enabled by quietly widening an existing live task envelope.

**30. Final Integration**

The final integration procedure MUST run in this order:

1. Identify the exact TANDEM source revision and retain the implementation diff.
2. Confirm the approved code map and all resolved concrete profile bindings.
3. Confirm no unresolved blocker affects the intended gate.
4. Validate the current profile digest, configuration, toolchain, storage assumptions, and qualification validity.
5. Run schema, policy, coverage, predicate, reducer, budget, and state-transition unit tests.
6. Run integrated admission, ownership, source, containment, egress, and resource tests on the actual qualified profile.
7. Run the exact-slice success path and the authorized one-repair path.
8. Exercise all terminal paths, late callbacks, and dispatch crash windows.
9. Exercise publication and retention crash boundaries.
10. Inspect incumbent source/Git/user-work protection evidence.
11. Verify every successful terminal record references complete immutable retained content.
12. Verify unsupported capabilities are actually refused or unreachable.
13. Run the full applicable invariant/test matrix and bind results to actual code.
14. Run the predeclared paired value evaluation and apply its unchanged decision rule.
15. Inspect all failures, unknowns, collection gaps, liabilities, quarantined resources, and limitations.
16. Confirm the public support description does not exceed the tested profile or evidence.
17. Produce the implementation report in Section 32.
18. Record the explicit release disposition.

A release disposition MUST be one of:

```text
RELEASE_READY_FOR_DECLARED_PROFILE
CHECKER_ONLY
BLOCKED
VALUE_NOT_ESTABLISHED
```

`RELEASE_READY_FOR_DECLARED_PROFILE` requires the complete implementation gate, including value evidence. Safety qualification without value evidence MUST NOT be advertised as proven product superiority.

Integration MUST NOT require a production deployment, external publication, automatic commit/push, or modification of a user task’s incumbent workspace.

**31. Completion Criteria**

The initial MVP is complete only when all applicable conditions hold:

- V4 remains the product authority.
- The implementation is a supervisory layer, not an independent coding agent.
- Gate 0 contains actual current-code and concrete profile evidence.
- Exactly one supported profile and one thin agent integration are enabled.
- One exclusive supervisor and one durable transactional store own decisions.
- Every executable invocation uses current serialized admission through final release.
- Grants, use consumption, reservations, deadlines, and dispatch uncertainty are durable.
- Incumbent content and Git administration are protected from agents and trusted helpers.
- Source selection is explicit, immutable, complete for the recipe, and independently retained.
- No unsupported dirty source, dependency change, source type, external service, plugin, transport, or external mutation is enabled.
- Every mandatory requirement/subcondition is independently retained and mapped.
- The small predicate set is independent, total, and non-vacuous.
- Native verification is genuinely full within the declared recipe and is not falsely promoted into an independent oracle.
- Actual source/dependency/configuration derivation is established.
- Evidence is coherent with the exact frozen generation and contract.
- Hard resource and liability bounds are conservatively enforced.
- Mandatory finalization, verification, delivery, and retention capacity is protected.
- Repair is limited to at most one authorized new generation.
- Every ending path proves quiescence or records non-successful unresolved quarantine.
- Late execution results cannot mutate or upgrade terminated work.
- Successful delivery contains complete durable immutable bytes and a manifest persisted before the successful terminal record.
- Retention, release, expiry, and corruption are handled truthfully.
- `tandem check` remains genuinely honest and useful without unsupported execution.
- All `INV-01` through `INV-25` are covered by actual applicable tests.
- All `T-01` through `T-14` pass for applicable behavior; excluded sub-capabilities have refusal/unreachability evidence.
- Gates 0 through 3 pass with inspectable evidence.
- Gate 4’s admission policy is implemented; no additional capability is required or silently enabled.
- Evaluation includes all attempts, complete product overhead, independent acceptance, comparable collection, numeric gates, and uncertainty.
- Current-code, qualification, success, and superiority claims match actual evidence.
- No consequential unresolved decision remains in the released supported path.

Passing unit tests, completing the document, producing one candidate, or running one green demonstration does not meet this definition.

A checker-only release may be useful, but it is not completion of the supervised MVP.

**32. Required Reports**

The product task report and the implementation report are different artifacts.

The runtime task report MUST derive from durable state and contain:

```text
task_id
lineage_id
incarnation_id
selected_source_identity
qualified_profile_digest
acceptance_contract_digest

execution_result
accepted_or_not_accepted
assurance
stop_reason
contributing_failure_and_limitation_reasons

changed_scope
mandatory_obligation_results
optional_obligation_results
verification_scope_and_derivation
evidence_references

authority_retired
quiescence_state
fencing_or_unresolved_boundary
quarantined_resources

settled_usage
outstanding_reserved_liability
estimated_or_unavailable_metrics
hard_limit_status

delivery_identity
payload_and_manifest_digests
delivery_availability
retention_expiry
incumbent_modified: false
```

A successful report MUST reference one exact immutable generation. An incomplete report MUST not imply partial acceptance of the full mandatory contract.

The implementation executor’s final report MUST contain:

| Field | Required content |
|---|---|
| Contract | PRD/V4 identities and implemented scope |
| Source | Actual TANDEM source revision and changed files |
| Current-code findings | Verified baseline and reuse/migration decisions |
| Profile | Actual versions/configuration digests and qualification scope |
| Work completed | Specific implemented contracts, not feature slogans |
| Gate status | Actual status of Gates 0–4, including not-run or blocked items |
| Tests | Exact commands, results, profile/source identities, evidence references |
| Traceability | Requirement/invariant to code/test/evidence bindings |
| Safety | Ownership, admission, containment, disclosure, protection, and terminal-path results |
| Resources | Hard/soft dimensions, reserve enforcement, unresolved liabilities |
| Delivery | Immutable publication/retention test results |
| Value | Protocol identity, raw outcomes, thresholds, uncertainty, and gate decision |
| Limitations | Unsupported capabilities, collection gaps, residual assumptions |
| Blockers | Exact unresolved consequential issues and affected work |
| Release disposition | One disposition from Section 30 |

The report MUST distinguish `PASS`, `FAIL`, `NOT_RUN`, `BLOCKED`, and tested exclusion. It MUST NOT summarize unexecuted tests as successful.

**33. Implementation Blockers**

The supplied documents settle the logical architecture and mandatory behavior. They intentionally require concrete qualification, task, resource, and evaluation bindings that have not been supplied as established facts.

The following are the genuine unresolved bindings. They MUST NOT be replaced by executor guesses.

| ID | Classification and unresolved binding | Blocking scope | Resolution authority | Required closure evidence |
|---|---|---|---|---|
| `IB-01` | **IMPLEMENTATION BLOCKER:** No actual qualified Linux/runtime/storage/agent/inference support profile is established by the attachments | Profile-dependent implementation commitments, executable qualification claims, and supervised admission | Technical/security qualification owner | Populated actual versions/configuration digests; storage/crash model; complete effect-control and fencing probe; source/derivation and observer qualification; approved support record |
| `IB-02` | **IMPLEMENTATION BLOCKER:** Exact first-slice repository/commit, bounded CLI behavior, cases, expected observations, change scope, native full-suite scope, and relevant baseline-failure treatment are not defined | First-slice mutation, predicate binding, acceptance, and end-to-end verification | Authenticated task/product owner and trusted acceptance owner | Independently retained source selection, requirement inventory, exact fixture/expectation manifest, admitted comparison rules, and qualified full native recipe fixed before candidate execution |
| `IB-03` | **IMPLEMENTATION BLOCKER:** Authorized numeric resource ceilings, conservative per-action maximums, deadline values, and enforceable mandatory reserve calculations are not populated | Any action whose exposure or completion capacity cannot be bounded | Authenticated user/pre-authorized policy for ceilings; qualification owner for enforceability and maximums | Populated budget policy, dimension semantics, reservation calculations, provider assumptions if applicable, and runtime/storage enforcement evidence |
| `IB-04` | **IMPLEMENTATION BLOCKER:** Versioned paired distribution, sample/repetitions, primary metric, numeric meaningful-benefit threshold, numeric maximum overhead, rubric, and uncertainty decision rule are not instantiated | Gate 3, superiority claims, and final implementation release gate | Product/evaluation owner before paired value results | Frozen evaluation protocol, comparable collection validation, independent acceptance fixtures, and predeclared numeric decision rules |

Current-code integration also has an explicit input dependency: the attachments do not provide the current TANDEM checkout or verified source audit. Before modifying an existing implementation, Gate 0 MUST obtain and inspect that source. Until then, exact source paths, compatibility consumers, reusable features, migration needs, and existing test results remain unverified. This is not permission to fabricate a repository tree or assume a rewrite is required.

If external inference is selected, `IB-01` and `IB-03` additionally require actual recipient/purpose/data authorization, credential scope, provider handling assurances, complete payload/visibility enforcement, and finite liability bounds. Missing external authorization blocks that transport; it does not authorize silent disclosure.

The following are already settled and MUST NOT be reopened as blockers:

- TANDEM is a supervisory layer above coding agents.
- One local Linux profile and one integration are sufficient.
- One serialized supervisor and one durable local transactional store own authority.
- The first task class is narrow direct-source JavaScript CLI behavior.
- Incumbent modification is prohibited.
- Oracle independence, total coverage, immutable delivery, hard reservations, and quiescence/quarantine are mandatory.
- Repair is limited to at most one authorized attempt after initial implementation.
- The default retention recommendation is seven days.
- Exact non-checker CLI spelling is ordinary implementation freedom subject to real compatibility evidence.
- Implementing schemas, transitions, predicates, tests, and traceability is required engineering, not a reason to invent new product decisions.

Unperformed implementation work and unexecuted tests MUST be tracked as work, not mislabeled as unresolved product design. Conversely, missing consequential bindings MUST remain blockers until their specified authority and evidence establish a safe resolution.

The executor’s final obligation is:

> Implement the defined contract. Preserve the user’s intent and incumbent work. Admit only bounded current authority. Accept only independently verified coherent frozen bytes. Stop truthfully.