# Stage 7B — Optimize Anki Mapping Parse Performance

## Objective
Substantially reduce parse-time latency for Anki-backed mapping while preserving all Stage 7 mapping and selection semantics.

## Why this stage exists
Stage 7 delivered correct deterministic mapping, but parse throughput regressed because mapping currently performs many serial AnkiConnect calls per term. This stage focuses on performance engineering of that same logic.

## Scope
Codex should:
- batch and deduplicate parse-time Anki lookups
- resolve candidate matching from indexed in-memory data instead of repeated per-term scans
- add short-lived in-memory caches for repeated parse bursts
- preserve existing mapped/unmapped/ambiguous behavior and metadata contract

## Required decisions to encode
The implementation must make explicit choices for:
- batching strategy for `findNotes`, `notesInfo`, and `cardsInfo`
- deduplication keys for term/config query reuse
- cache keys, TTL, and invalidation triggers
- concurrency limits for AnkiConnect requests
- fallback behavior when batched requests partially fail

## Recommended policy
For this stage:
- keep all Stage 7 matching/filter/selection logic unchanged
- optimize only request shape and resolver structure
- use conservative in-memory TTL caches (short-lived)
- avoid persistent storage cache in this stage

## Deliverables
- batched parse lookup pipeline in Anki backend
- indexed resolver path for candidate resolution
- bounded in-memory caching for parse lookups
- instrumentation or verification evidence showing reduced request count and parse latency
- no contract changes to unified review metadata

## Non-goals
- no review-write path changes
- no UI changes for ambiguity handling
- no new backend-selection policy
- no persistent/offline caching layer

## Acceptance criteria
- Stage 7 mapping outcomes remain behaviorally identical
- Anki-enabled parse performs significantly fewer network round trips
- parse latency is substantially reduced on representative full-page parses
- fallback safety and popup integrity remain intact under failures

## Handoff to next stage
This stage should leave Anki mapping both correct and fast enough for practical use, so subsequent stages can focus on write-path and UX behavior without revisiting parse performance fundamentals.
