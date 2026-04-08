# Stage 14B — Implement Bulk Anki Resolution and Contract Consolidation

## Objective
Collapse the highest-cost localhost request chains into a small number of purpose-built, versioned add-on contracts while preserving all Stage 10-14A behavioural guarantees.

After this stage:
- parse-time Anki enrichment should no longer depend on composing many low-level AnkiConnect actions for every bulk resolution
- targeted refresh should have a cleaner path to authoritative bulk card-state revalidation
- the extension should spend less time orchestrating Anki internals and more time consuming already-resolved results
- fallback to the existing 14A path should still remain available during rollout

This stage is about changing the contract boundary, not just optimizing inside the old boundary.

## Why this stage exists
Stage 14A handles the low-risk performance wins that fit inside the current API surface:
- duplicated probe removal
- in-flight dedupe
- tighter cache invalidation
- better reuse of authoritative write payloads

Those wins are important, but they cannot fully solve the main structural bottleneck:
- parse-time resolution is still logically one operation implemented as many localhost actions
- targeted refresh is still forced to reconstruct state from multiple lower-level calls
- the extension still owns too much of the orchestration and joining logic for Anki read-side resolution

At this point, further major gains require moving more of the resolution work closer to the Anki collection itself.

This stage exists to design and implement that higher-leverage shift safely.

## Scope
Codex should:
- introduce a versioned bulk Anki read-side resolution contract for parse-time term enrichment
- consolidate high-value read/refresh flows behind fewer custom add-on actions
- move matching/filtering/state assembly closer to Anki collection runtime
- preserve the existing unified review metadata contract at the extension boundary
- preserve fallback to the Stage 14A pipeline during rollout and compatibility gaps

This stage should focus on contract consolidation for read-side and refresh-side operations.

## Problems this stage must solve
- how to collapse `findNotes` + `notesInfo` + `cardsInfo` + `getIntervals` into one logical read-side request
- how to preserve deterministic Stage 10 matching semantics when matching moves closer to the collection
- how to preserve Stage 11 blocked-state and ambiguity semantics when results come from a new endpoint
- how to preserve Stage 13 stale/refresh semantics while reducing targeted-refresh traffic
- how to roll out new endpoints without breaking users who do not yet have the updated add-on
- how to expose enough diagnostics and metadata for debugging without re-expanding request count

## Implementation-time choices eliminated
This stage does not leave bulk-endpoint architecture open to the implementation model.

The implementation must not choose:
- one endpoint vs two endpoints
- optimistic trial calls vs explicit capability detection
- whether refresh shares the parse endpoint
- whether the old path is removed immediately
- whether write mutation is folded into the new bulk resolver

## Fixed implementation directives
The implementation must follow these exact Stage 14B decisions:

1. Stage 14B must introduce two versioned read-side add-on endpoints:
   - `jitenResolveTermsV1`
   - `jitenRefreshTargetsV1`
2. `jitenResolveTermsV1` is the primary parse-time bulk resolution path.
3. `jitenRefreshTargetsV1` is the primary targeted-refresh bulk revalidation path.
4. Capability detection must use explicit action/capability discovery before routing traffic to either endpoint.
5. The Stage 14A path must remain implemented as the fallback path until parity is demonstrated.
6. Stage 14B must not merge Stage 12 write mutation flows into either bulk read-side endpoint.
7. The extension must keep its existing review-metadata semantics at the boundary; only the transport/contract boundary changes.

## Mandated policy
For this stage:
- introduce a purpose-built bulk term-resolution endpoint as the primary new contract
- introduce a paired bulk target-refresh endpoint as the primary targeted-refresh contract
- keep endpoints versioned and explicit
- preserve extension-side fallback to the Stage 14A pipeline whenever:
  - the add-on is unavailable
  - the action is unsupported
  - the version is incompatible
  - the endpoint returns an unrecoverable contract error
- keep extension-side metadata semantics unchanged even if backend internals move
- move work closer to the collection, but do not move product policy out of sight:
  - ambiguity handling must remain deterministic
  - blocked-state semantics must remain explicit
  - debug visibility must remain possible

## Cross-stage invariants
This stage changes the contract boundary, but it must not change the product truth established by earlier stages.

The implementation must preserve these invariants:
- Stage 10 still defines what counts as deterministic read-side identity
- Stage 11 still defines blocked-state UX and reviewability policy
- Stage 12 still defines exact-target write guarantees
- Stage 13 still defines stale/uncertain-state recovery semantics
- Stage 14A remains the compatible fallback path until parity is established

The new endpoint should return facts efficiently, not silently redefine policy.

## Endpoint family
This stage must implement:
- `jitenResolveTermsV1`
- `jitenRefreshTargetsV1`

## Primary endpoint — Bulk term resolution
The primary endpoint should resolve many parsed terms in one request and return enough data to build the existing `ReviewTermResolutionMap` directly.

### Intended responsibilities
- accept many normalized term contexts in one call
- apply read-side config/model/deck/template filtering
- resolve matching notes/cards within the collection
- derive mapping outcome:
  - selected
  - none
  - ambiguous
- derive scheduling-related state needed for current UI:
  - `new`
  - `young`
  - `mature`
  - `due`
  - `suspended`
  - `buried`
- return deterministic target metadata for selected matches
- return lightweight diagnostics/metrics for debugging

### Required request shape
The request must include, at minimum:
- `version`
- `requestId`
- normalized term entries:
  - spelling
  - reading
  - stable term key
  - optional vocabulary identity fields useful for mapping back to extension cards
- normalized lookup configuration entries:
  - model
  - word field
  - optional reading field
  - optional deck constraint
  - explicit template/card-template constraints

Required policy:
- send normalized, explicit inputs
- do not require the add-on to guess frontend config semantics
- keep payload self-sufficient for deterministic matching

### Required response shape
The response must include, at minimum, per term:
- stable term key
- `mappingState`
- `targetState`
- `dueState`
- `stateTags`
- selected target metadata when present:
  - note id
  - card id
  - deck
  - model
  - template ord/name if useful
- ambiguity diagnostics when `mappingState === 'ambiguous'`, including:
  - candidate count
  - `candidateSummary[]` entries with:
    - deck
    - model
    - template
    - card id

The response should also include aggregate metrics such as:
- matched terms count
- ambiguous terms count
- query/runtime stats

The extension must be able to transform this response into current parse enrichment metadata without needing the old multi-step join path.

## Bulk target refresh endpoint
This stage includes a refresh-focused endpoint rather than leaving that choice open.

### Intended responsibilities
- accept known target/card identities in bulk
- return authoritative current state for those targets
- support Stage 13 stale recovery and targeted refresh revalidation

### Required responsibilities
- bulk state revalidation for known card ids
- queue/due/interval-style scheduler snapshot
- blocked-state derivation for suspended/buried
- target-not-found signalling when cards disappeared or changed incompatibly

### Required request shape
`jitenRefreshTargetsV1` must include, at minimum:
- `version`
- `requestId`
- target entries containing:
  - `cardId`
  - stable term key
  - previous selected target metadata for diagnostics
  - optional `noteId`
  - optional template ord

### Required response shape
`jitenRefreshTargetsV1` must include, at minimum, per target:
- stable term key
- `cardId`
- refresh outcome:
  - refreshed
  - target-not-found
  - unavailable
- current `targetState`
- current `dueState`
- current `stateTags`
- scheduler snapshot:
  - queue
  - due
  - interval
- blocked-state metadata when suspended/buried

Required policy:
- keep this endpoint tightly scoped to known-target refresh
- do not combine it with write mutation
- use it as the primary Stage 13 targeted-refresh transport once capability support is confirmed

## Contract boundary principles
This stage should explicitly move the following work into the add-on/collection-side boundary:
- note/card lookup joining
- config-constrained candidate filtering
- template/card-template selection filtering
- scheduler-state assembly for read-side state tags

This stage should keep the following responsibilities on the extension side:
- user-facing rendering and wording
- blocked-state UX policy already defined in Stage 11
- stale/uncertain-state UX policy already defined in Stage 13
- backend selection and fallback strategy
- configuration storage/editing

The goal is not to hide behaviour in the add-on; it is to stop paying localhost round-trip cost for work the collection can already do locally.

## Capability detection and rollout pattern
Because earlier debugging already showed that unsupported custom actions can fail in ways that look like backend absence, capability detection must be explicit.

Required policy:
- detect support for the new endpoints through `apiReflect` action discovery
- require both `jitenResolveTermsV1` and `jitenRefreshTargetsV1` to appear in discovered actions before routing primary traffic to them
- route to the bulk endpoints only after support is positively confirmed
- keep fallback to the Stage 14A path deliberate and observable in logs/diagnostics
- do not remove the old path in the same pass that introduces the new one

Required rollout pattern:
1. land add-on endpoint support
2. add extension-side capability detection
3. add translation from bulk endpoint response to existing metadata structures
4. run compare-and-log or shadow verification modes during development
5. make the new path primary only after parity is demonstrated

## Rollout and compatibility strategy
This stage should be implemented with an explicit compatibility plan.

Required rollout:
1. add the new versioned endpoint(s) to the add-on
2. add capability/version detection in the extension
3. keep the Stage 14A request-composition path as fallback
4. route traffic to the new endpoint when supported
5. preserve debug/verification hooks to compare old vs new resolution outcomes
6. only remove or de-emphasize old paths after parity is established

Required fallback triggers:
- unsupported action
- unsupported version
- malformed response
- endpoint-level internal error where fallback is still safe

Required policy:
- fallback must be deliberate and visible in debug logs
- fallback must not silently change semantics
- endpoint rollout should be reversible

## Verification/parity strategy
Because this stage changes the contract boundary, parity validation is essential.

Required validation approach:
- compare old and new resolution outputs on representative full-page parses
- compare:
  - mapping state
  - target state
  - selected target identity
  - state tags
  - due state
- compare targeted refresh results through `jitenRefreshTargetsV1`
- verify ambiguous and blocked-state cases explicitly

If the new endpoint and old path disagree, the difference must be explainable before the new path becomes primary.

## Deliverables
- versioned bulk Anki term-resolution endpoint contract
- extension-side integration for using that contract
- paired bulk target-refresh endpoint
- capability/version negotiation and safe fallback to Stage 14A path
- parity verification evidence between old and new resolution paths
- materially lower localhost request counts for parse-time enrichment and targeted refresh

## Implementation expectations
Codex should, at minimum:
- inspect the current Anki review backend request-composition path
- inspect the current add-on contract and registration pattern
- define the new versioned request/response schemas explicitly
- implement extension-side transformation from new endpoint result into existing review metadata structures
- preserve Stage 10-13 semantics at the extension/UI boundary
- keep fallback to the Stage 14A path operational during rollout
- add enough instrumentation/debug visibility to compare old vs new outcomes

## Required concrete directions
This stage must follow the following concrete directions:

### Direction 1 — Make `jitenResolveTermsV1` the primary win
- solve parse-time bulk term enrichment first
- this is where request collapse pays off most clearly

### Direction 2 — Keep response close to existing metadata
- return data shaped so the extension can build current resolution objects with minimal translation
- avoid over-generalized payloads that save backend work but complicate frontend consumers

### Direction 3 — Consolidate scheduler context internally
- the add-on should resolve collection/rollover/scheduling context inside the contract
- the extension should not need separate preparatory calls to reconstruct that same context

### Direction 4 — Preserve determinism in ambiguity handling
- if multiple valid matches exist, return explicit ambiguity
- do not silently auto-select in the new endpoint just to reduce payload size

### Direction 5 — Stage refresh consolidation carefully
- `jitenRefreshTargetsV1` must remain simple and narrow
- do not turn Stage 14B into a combined read/write super-endpoint

### Direction 6 — Keep write flows out of the new bulk contract
- Stage 14B is about read-side and refresh-side consolidation
- do not mix Stage 12 write mutation flows into the new bulk resolver just because the add-on contract is being extended
- keep read-side bulk endpoints fact-oriented and easy to validate against the Stage 14A fallback path

### Direction 7 — Prefer explicit capability discovery over trial requests
- detect support through reflected actions/capabilities via `apiReflect`
- do not rely on optimistic invocation of the new endpoint as the primary discovery method
- treat unsupported-action responses as a compatibility signal to log and fall back from, not as proof that Anki itself is unavailable

## Safety expectations
This stage must not sacrifice correctness or transparency for speed.

That means:
- no contract consolidation may silently change target-selection semantics
- no contract consolidation may erase blocked-state detail
- no contract consolidation may weaken Stage 12 exact-target guarantees
- no contract consolidation may weaken Stage 13 uncertainty/stale recovery semantics
- fallback to the older path must remain possible until parity is established

## Non-goals
- no UI redesign
- no scheduler-semantics redesign
- no mutation/write endpoint redesign unless strictly required for compatibility scaffolding
- no removal of the Stage 14A path during the initial rollout
- no persistent/offline caching layer
- no broad architectural rewrite outside the Anki contract boundary

## Acceptance criteria
- parse-time Anki enrichment can run primarily through a purpose-built bulk endpoint rather than many low-level localhost calls
- request count is materially lower than the Stage 14A path on representative workloads
- new endpoint results preserve current mapping, target, due, and blocked-state semantics
- safe fallback to the Stage 14A path remains available when the new endpoint is unavailable or incompatible
- parity verification demonstrates that old and new resolution outputs agree for representative success, blocked, and ambiguous cases
- targeted refresh traffic is materially reduced through `jitenRefreshTargetsV1` without weakening Stage 13 recovery behaviour

## Verification expectations
Verification should include:
- full-page parse comparison between Stage 14A path and new bulk endpoint path
- ambiguous target cases
- suspended/buried target cases
- unmapped/none cases
- target refresh parity if a refresh endpoint is added
- unsupported-action / unsupported-version fallback
- malformed-response fallback
- request-count and latency comparison before and after

## Handoff to next stage
This stage should leave the system with a much more efficient contract boundary for Anki-backed read-side work.

Once that is complete, later work can focus on:
- trimming or retiring legacy fallback paths after confidence is high
- narrower performance follow-ups if any remain
- polish and operational hardening rather than core localhost traffic collapse
