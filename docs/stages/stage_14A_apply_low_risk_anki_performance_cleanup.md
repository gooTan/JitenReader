# Stage 14A — Apply Low-Risk Anki Performance Cleanup

## Objective
Reduce avoidable localhost traffic and repeated Anki work while preserving all Stage 10-13 behavioural guarantees.

After this stage:
- parse-time Anki enrichment should issue fewer redundant requests
- post-write refresh should reuse authoritative data more effectively
- caches and in-flight work should behave more intelligently under overlapping parses and refreshes
- the extension should remain just as correct, transparent, and Anki-truthful as before

This stage is about trimming waste from the current architecture, not redesigning the architecture.

## Why this stage exists
Stage 7B improved the original Anki parse-time mapping pipeline by introducing batching, short-lived caches, and indexed resolution.

Since then, later stages clarified or introduced more advanced Anki-backed behaviour:
- richer read-side identity
- blocked-state UX
- new-card lifecycle planning
- stale-state recovery and refresh hardening

Those later capabilities also made performance pressure more visible:
- parse-time enrichment still uses a multi-roundtrip localhost pipeline on cache miss
- some readiness/scheduling probes are duplicated
- in-flight duplicate work can occur before caches fill
- post-write refresh can fetch data that Anki/add-on already returned
- cache invalidation is not yet fully aligned with all state that can change after writes

This stage exists to clean up those inefficiencies without taking on the higher-risk work of new bulk endpoint design.

## Scope
Codex should:
- remove duplicated low-value localhost requests
- add in-flight deduplication where overlapping work currently duplicates requests
- tighten cache invalidation so stale scheduler data does not linger unnecessarily
- improve request grouping/reuse for existing AnkiConnect actions
- reuse authoritative post-write response data where possible before issuing extra refresh work
- preserve all existing matching, gating, transaction, refresh, and recovery semantics

This stage should focus on low-risk performance improvements within the current request/contract model.

## Problems this stage must solve
- why parse-time enrichment still produces many localhost calls on realistic full-page parses
- why overlapping parses or refreshes can duplicate work before caches are populated
- why some startup/probe calls are repeated even when recent state is already known
- why post-write refresh may still perform unnecessary follow-up requests
- why some caches are invalidated incompletely after writes, leaving avoidable stale scheduler lookups
- how to improve throughput without reintroducing stale or misleading state

## Implementation-time choices eliminated
This stage does not leave low-risk optimization direction open to the implementation model.

The implementation must not invent a different optimization order or substitute a new endpoint design for this stage.

## Fixed implementation directives
The implementation must follow this exact optimization order:

1. Centralize probe ownership for availability and scheduling context.
2. Add promise-aware in-flight dedupe for:
   - probe
   - `findNotes`
   - `notesInfo`
   - `cardsInfo`
   - `getIntervals`
   - targeted refresh
3. Invalidate card metadata cache and interval/maturity cache together after confirmed writes.
4. Reuse authoritative post-write payloads before issuing follow-up reads.
5. Group compatible existing AnkiConnect reads with the current API surface only.
6. Add request-count / cache-hit / dedupe instrumentation for before-vs-after verification.

## Mandated policy
For this stage:
- keep Stage 10-13 semantics unchanged
- optimize request shape and reuse, not behaviour
- reuse existing authoritative data over immediate re-fetch
- use in-memory in-flight dedupe rather than a broader persistent caching redesign
- keep optimizations bounded and additive rather than introducing new protocol/endpoint design
- preserve targeted refresh correctness even when reducing requests
- preserve failure transparency and stale-state honesty from Stage 13
- do not trade away debuggability for minor micro-optimizations

## Hard boundary with Stage 14B
This stage is intentionally constrained to the existing contract surface.

The implementation must preserve these boundaries:
- no new custom add-on endpoint
- no logical change to the extension-side read/write metadata contract beyond what is already required by Stages 10-13
- no optimization that only works by changing product semantics
- if a change requires a new purpose-built add-on action or a materially new request/response contract, defer it to Stage 14B

## Priority optimization targets
This stage should treat the following as the highest-value low-risk targets.

### 1. Duplicate probe removal
The backend should avoid redundant availability/scheduling probes when recent authoritative results already exist.

Examples include:
- duplicated `version` checks
- duplicated collection-context discovery
- redundant placeholder `findNotes` health checks when an equivalent recent read probe already succeeded

Required policy:
- centralize read-path readiness state
- centralize scheduling-context readiness state
- reuse successful probe results across nearby operations within bounded TTLs

### 2. In-flight dedupe for overlapping work
The backend should share pending work rather than issuing duplicate localhost requests when overlapping parses or refreshes request the same data.

Required targets:
- `findNotes` query results
- `notesInfo`
- `cardsInfo`
- `getIntervals`
- targeted refresh operations on the same card/term

Required policy:
- store pending promises alongside resolved cache entries
- join existing work rather than starting a second request for the same key
- keep dedupe keys deterministic and narrow
- include normalized config identity and operation mode in dedupe keys where that affects correctness

### 3. Post-write response reuse
If Anki/add-on already returned authoritative post-write data, the extension should use that data before issuing immediate follow-up reads.

Required policy:
- use confirmed write payload to seed immediate state transition where sufficient
- reserve targeted refresh for:
  - confirmation
  - enrichment not present in the write payload
  - later Stage 13 stale recovery boundaries
- if the payload is useful but not fully sufficient for a `fresh` result, mark the result with the appropriate Stage 13 state-quality classification rather than pretending refresh already happened

### 4. Cache invalidation tightening
When card state changes after a write, every cache that can influence the displayed state should be invalidated together.

Required targets:
- card metadata cache
- interval/maturity cache
- due-state or related derived state caches
- popup/registry stale flags tied to the same target

Required policy:
- do not invalidate only a subset of scheduler-relevant caches
- do not keep stale-but-fast caches if they make the UI look confidently wrong

### 5. Existing-request grouping improvements
Within the current API surface, the extension should reduce request overhead by grouping compatible reads more effectively.

Examples:
- co-scheduling `cardsInfo` and `getIntervals` chunk work
- grouping related reads with existing `multi` support where safe
- reducing repeated config reads within a single operation scope

Required policy:
- keep grouping additive and low risk
- do not redesign contract payloads in this stage

## Optimization hierarchy
To keep risk low, implementation should prioritize changes in this order:

1. Remove duplicated probes and repeated config reads.
2. Add in-flight dedupe for existing request keys.
3. Tighten cache invalidation after writes and refresh disruption.
4. Reuse authoritative post-write payloads before issuing extra refresh reads.
5. Improve grouping/co-scheduling of existing read actions.

If a performance improvement would require a new custom add-on endpoint, it belongs to Stage 14B instead.

## Deliverables
- consolidated low-risk Anki readiness/probe behaviour
- in-flight dedupe for key read and refresh operations
- tighter post-write cache invalidation
- better use of authoritative post-write response data
- request-count and/or parse-latency verification evidence
- no regressions to unified review metadata, gating, recovery, or source-of-truth rules

## Implementation expectations
Codex should, at minimum:
- inspect current probe/readiness flow in the Anki backend
- inspect parse-time lookup metrics and request issuance sites
- inspect post-write refresh flow and determine where authoritative payload reuse is possible
- inspect all scheduler-relevant caches and document which writes should invalidate which caches
- add in-flight dedupe to the layers that currently only cache resolved results
- improve grouping of current AnkiConnect actions without inventing new endpoint contracts
- preserve Stage 13 stale/uncertain-state semantics even while reducing follow-up reads

## Required concrete directions
This stage must follow the following concrete directions:

### Direction 1 — Centralize probe ownership
- expose one clear read-readiness path for Anki availability
- expose one clear scheduling-context readiness path for rollover/collection-time context
- avoid mixing multiple overlapping probe strategies in different methods

### Direction 2 — Add promise-aware caches
- extend existing cache layers so they can hold:
  - resolved values
  - or pending promises
- clear pending entries safely on failure
- avoid duplicated work during burst parses or rapid popup interactions

### Direction 3 — Treat write response as first-class data
- if a write response already includes queue/due/interval/reps/lapses-style scheduler data, use it
- avoid immediately discarding that data and fetching the same facts again
- keep Stage 13 refresh semantics intact by marking what is confirmed vs what still needs revalidation

### Direction 4 — Invalidate interval cache with card cache
- if a confirmed write changes scheduler state, interval-derived maturity can also change
- invalidating only card metadata is not sufficient

### Direction 5 — Add lightweight instrumentation
- keep or extend metrics for:
  - request counts
  - cache hits/misses
  - dedupe joins
  - parse-time latency
- the stage must leave behind enough evidence to prove the cleanup helped

### Direction 6 — Compare like-for-like workloads
- before/after verification should use the same representative page/profile/config workload
- request-count reduction claims should not rely on comparing different parse contexts
- regression checks should run against the same semantics, not a simplified scenario that avoids blocked/stale cases

## Safety expectations
This stage must not compromise the correctness and honesty work from earlier stages.

That means:
- no optimization may silently change mapping outcomes
- no optimization may hide uncertain state behind stale cached values
- no optimization may reintroduce silent backend fallback
- no optimization may weaken Stage 11 blocked-state guarantees
- no optimization may weaken Stage 12 exact-target transaction guarantees
- no optimization may weaken Stage 13 stale/failure transparency

## Non-goals
- no new bulk add-on endpoint
- no redesign of the Anki add-on contract
- no major parse pipeline rewrite
- no changes to target-selection semantics
- no scheduler-state taxonomy changes
- no UI redesign
- no persistent/offline caching layer
- no broad performance work that belongs to Stage 14B endpoint consolidation

## Acceptance criteria
- Anki-enabled parse issues materially fewer localhost round trips under representative workloads
- overlapping parse or refresh bursts no longer duplicate the same localhost work unnecessarily
- post-write flows reuse authoritative returned data where sufficient instead of always re-fetching immediately
- cache invalidation no longer leaves obvious interval/maturity drift after writes
- all Stage 10-13 behavioural guarantees remain intact
- any added instrumentation or verification shows the request-count and/or latency improvement clearly

## Verification expectations
Verification should include:
- request-count comparison before and after on representative parse workloads
- overlapping parse or refresh scenario to confirm in-flight dedupe works
- confirmed write path to confirm cache invalidation includes interval/maturity-sensitive state
- confirmed write path to confirm authoritative response reuse avoids at least some follow-up reads
- regression checks for:
  - mapping correctness
  - blocked-state behaviour
  - stale/failure transparency
  - targeted refresh integrity

## Handoff to next stage
This stage should leave the current architecture noticeably leaner without changing its external behaviour.

Once that is complete, Stage 14B can focus on the higher-impact and higher-risk work:
- bulk Anki resolution endpoint design
- larger request-contract consolidation
- deeper localhost traffic collapse beyond what the current API surface can provide
