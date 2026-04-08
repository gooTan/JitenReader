# Stage 13 — Implement Failure Transparency, Stale-State Recovery, and Refresh Hardening

## Objective
Make Anki-backed review trustworthy even when the system cannot immediately prove what happened.

After this stage:
- the user should be able to tell whether a write definitely failed, definitely succeeded, or is currently uncertain
- the popup and page state should recover cleanly from stale or partially confirmed Anki state
- refresh behaviour should be deliberate, targeted, and anchored to Anki as the source of truth

This stage is about honesty and recovery, not about pretending the system is always perfectly synced.

## Why this stage exists
Stage 9 introduced the first version of targeted refresh, stale-state handling, backend badges, and clean fallback boundaries.

Stage 12 is intended to make first-review transactions Anki-native by supporting:
- direct rating of mapped Anki `new` cards
- add-then-rate for unmapped terms
- authoritative post-write state from Anki-backed backend results

Even with those pieces in place, real-world use will still produce difficult states:
- Anki may be reachable at parse time but unavailable at click time
- a write may reach Anki but the response may fail to return cleanly
- a write may succeed but follow-up refresh may fail
- the user may leave a tab open long enough that page state becomes stale
- due status may legitimately change later because time has passed or Anki rollover has occurred

Without an explicit recovery model, the extension risks doing the most dangerous thing: presenting uncertainty as certainty.

This stage exists to make uncertainty visible, recoverable, and user-safe.

## Scope
Codex should:
- define explicit failure classes for Anki-backed review interactions
- define stale-state categories and their UI/interaction consequences
- harden targeted refresh behaviour after writes
- define when automatic revalidation should happen after parse and after write
- make recovery actions explicit when state is stale or uncertain
- ensure the system continues to treat Anki as the source of truth even when extension-side caches are old or incomplete

This stage should focus on post-write truth, stale-state recovery, and targeted refresh policy.

## Problems this stage must solve
- how the extension distinguishes:
  - write definitely did not reach Anki
  - write may have reached Anki but confirmation is incomplete
  - write definitely reached Anki but refresh failed
  - page state is stale because time has passed
  - page state is stale because backend became unavailable
- how the user is informed when the extension is uncertain
- how a stale popup or page token is revalidated without unnecessary full reparse
- when automatic refresh should happen and when the user should explicitly trigger recovery
- how to prevent follow-up actions from compounding uncertainty
- how to invalidate or refresh the right caches after writes so state does not drift

## Implementation-time choices eliminated
This stage does not leave failure/recovery architecture open to the implementation model.

The implementation must not invent a second policy for:
- failure classification
- stale-state classification
- write availability while state is uncertain
- whether `ankiRolloverHour` remains a competing truth source
- when targeted refresh is automatic vs manual
- which layer owns freshness/state-quality truth

## Fixed implementation directives
The implementation must follow these exact Stage 13 decisions:

1. The normalized state-quality values are:
   - `fresh`
   - `pending-write`
   - `refreshing`
   - `stale-confirmed`
   - `stale-uncertain`
   - `unavailable`
2. The shared review metadata / registry layer is the single owner of those state-quality values.
3. Popup-local flags must not become a second freshness state machine.
4. `ankiRolloverHour` must not remain a user-facing or runtime scheduling truth source after this stage.
5. Stored `ankiRolloverHour` values may remain only for migration compatibility; runtime refresh logic must ignore them.
6. Refresh and recovery logic must use Anki/add-on-derived scheduling/rollover information as the authoritative source.
7. If a temporary internal fallback is still required during migration, it must remain internal and must not be exposed as a competing user-configurable truth source.
8. Further Anki review actions are disabled in every state-quality value except `fresh`.

## Mandated policy
For this stage:
- the extension must never collapse all failures into a generic "review failed" message
- the UI must distinguish between:
  - failed before write
  - uncertain write outcome
  - successful write but stale follow-up state
- when write outcome is uncertain, the UI must say so plainly and avoid claiming success or failure
- when refresh fails after a confirmed write, the UI must preserve a stale-but-likely-written state rather than pretending nothing happened
- recovery must prefer targeted refresh of the affected target/card over full page reparse when safe
- automatic refresh must happen at clear boundaries rather than as constant polling
- no silent fallback to Jiten may occur during recovery of an Anki-mode action

## Cross-stage invariants
This stage adds state-quality and recovery semantics on top of earlier stages; it does not replace their roles.

The implementation must preserve these invariants:
- Stage 10 still owns target identity and blocked-state facts
- Stage 11 still owns reviewability policy shown to the user
- Stage 12 still owns exact-target Anki write semantics and immediate write-result facts
- Stage 13 adds a state-quality/recovery dimension on top of those earlier facts
- stale/uncertain classification must not silently rewrite target identity, ambiguity, or blocked-state meaning

## Failure taxonomy
This stage defines the explicit failure taxonomy below.

### Class 1 — Preflight / availability failure
- Anki is unavailable before any write starts.
- No write is attempted.
- Result should be presented as a definite no-write failure.

### Class 2 — Configuration / target resolution failure
- The extension cannot determine a valid Anki write target.
- No write is attempted.
- Result should be presented as a definite no-write failure.

### Class 3 — Backend rejected write
- A write request reached Anki/add-on layer and was explicitly rejected before mutation completed.
- Result should be presented as a definite write failure.

### Class 4 — Uncertain write outcome
- The extension cannot prove whether the write reached Anki completely.
- Examples:
  - transport interruption after request dispatch
  - response parse failure after backend work may already have run
  - add succeeded but later transaction step could not be confirmed
- Result must be presented as uncertain, not as success and not as clean failure.

### Class 5 — Confirmed write, refresh failed
- The write result is known, but follow-up state refresh did not complete.
- Result should be presented as:
  - write likely/definitely applied
  - displayed card state currently stale

### Class 6 — Confirmed write, later state drift
- Initial write/refresh completed, but later time-based or collection-based changes may have invalidated what is shown.
- Result should be handled through revalidation, not treated as a write failure.

The implementation must preserve these exact distinctions even if internal helper names differ.

## Stale-state taxonomy
This stage defines the explicit state-quality levels for popup/registry data.

Exact model:
- `fresh`
  - state is known to match recent Anki-backed data
- `pending-write`
  - action in flight; do not allow duplicate actions
- `refreshing`
  - targeted refresh in progress
- `stale-confirmed`
  - last known state came from Anki, but it may no longer be current
- `stale-uncertain`
  - extension cannot currently prove what Anki state is because a write or refresh outcome is uncertain
- `unavailable`
  - Anki cannot be reached right now

## State-quality ownership pattern
This stage defines one canonical owner for state-quality classification so the popup, registry, and backend metadata do not drift.

Required ownership model:
- backend/write result contract supplies facts about what is confirmed, uncertain, or unavailable
- shared review metadata / registry layer owns the normalized state-quality value that the UI consumes
- shared review metadata / registry layer also owns per-target `nextRefreshAt` when a future refresh boundary is known
- popup-local state is limited to short-lived interaction concerns such as control disablement while a request is in flight

Required policy:
- do not keep separate competing freshness truth tables in popup code and registry code
- the existing freshness representation must be expanded or replaced so it can represent the exact Stage 13 state-quality model above
- do not overload old `fresh` / `stale` / `unknown` style flags with new meanings hidden in unrelated booleans or status tags

## Targeted refresh identity rules
Refresh and recovery must use the most precise identity already known.

Required priority:
1. exact `cardId`
2. exact `noteId` plus template identity when card id is not yet available
3. stable term/target key only when stronger identity is unavailable

Required policy:
- do not fall back to broad fuzzy re-lookup if an exact target identity is already known
- treat disappearance or mismatch of a previously known target as a meaningful recovery result, not as a silent remap

## Interaction policy by state quality
The implementation should encode explicit action rules similar to the following.

| State quality | Review actions | Recovery action | UI expectation |
| --- | --- | --- | --- |
| `fresh` | enabled when target is reviewable | optional manual refresh | normal popup |
| `pending-write` | disabled | none until request settles | pending/pessimistic lock state |
| `refreshing` | disabled | automatic in progress | visible syncing state |
| `stale-confirmed` | disabled until refresh completes | retry refresh / revalidate target | stale but understandable |
| `stale-uncertain` | disabled | explicit "Check Anki state" / retry refresh | uncertainty must be obvious |
| `unavailable` | disabled for Anki actions | retry when backend reachable | unavailable state |

The implementation must follow this table semantically. In particular, further writes are disabled in every state except `fresh`.

## Refresh model
Refresh becomes targeted and boundary-driven rather than purely reactive.

This stage defines at least the following refresh boundaries.

### 1. Immediate post-write refresh
- If the write contract does not already include enough authoritative state, run targeted refresh immediately.
- If the write contract does include enough authoritative state, use it first and treat refresh as confirmation / enrichment.

### 2. Retry refresh after known refresh failure
- A failed refresh should leave the target visibly stale.
- The user should have a direct way to retry refresh without reparsing the entire page.

### 3. Visibility / focus refresh
- On page visibility return, tab focus return, or popup open, the extension must revalidate visible Anki-backed targets that are:
  - not `fresh`
  - or whose scheduled `nextRefreshAt` is now due
- This must be targeted and bounded, not a blind full reparse.

### 4. Time-boundary refresh
- The registry/shared metadata layer must maintain one `nextRefreshAt` timestamp per visible Anki-backed target when a refresh boundary is known.
- The extension must maintain one shared timer keyed to the earliest due `nextRefreshAt` among visible Anki-backed targets.
- When that timer fires, the extension must run targeted refresh for the due targets and then reschedule the next timer from the remaining visible targets.
- Examples of valid `nextRefreshAt` boundaries:
  - exact next-due time becomes reachable
  - Anki collection rollover boundary passes

### 5. Backend reconnection refresh
- If Anki was unavailable and becomes reachable again, stale/unavailable targets should become eligible for revalidation.

Required policy:
- prefer targeted card/term refresh
- avoid full-page reparse unless targeted recovery is impossible
- avoid constant polling loops

## Cache invalidation expectations
This stage defines explicit cache invalidation rules so stale state does not persist accidentally.

The implementation must invalidate or quarantine the following cache/state categories according to the Stage 13 policy below:
- matched card metadata caches
- interval / maturity caches
- due-state caches
- popup-local stale state
- registry-level enriched token state

Required policy:
- confirmed writes should invalidate all caches that can affect the same target's displayed state
- uncertain writes should invalidate or quarantine any cached state that would falsely imply certainty
- backend reconnection should allow stale/unavailable targets to be refreshed without requiring a cold restart

## Recovery UX expectations
The user should never have to guess what the extension believes happened.

Required UX principles:
- show whether the issue is:
  - definite failure
  - uncertain result
  - stale state awaiting refresh
- provide a clear next step
- keep wording plain and direct
- keep backend identity visible so the user knows this concerns Anki specifically
- avoid generic toasts as the only source of recovery guidance

Required wording direction:
- definite no-write failure:
  - "Could not send this review to Anki."
- uncertain outcome:
  - "Anki may have received this review, but the result could not be confirmed."
- confirmed write, refresh failed:
  - "Review was sent to Anki, but the latest card state could not be refreshed."
- stale after time/backend drift:
  - "This Anki state may be out of date. Refresh to confirm the latest status."

Required recovery-action labels:
- `stale-confirmed` -> `Refresh from Anki`
- `stale-uncertain` -> `Check Anki state`
- `unavailable` -> `Retry Anki connection`

The final wording may differ slightly, but the difference between failure, uncertainty, and stale state must remain unmistakable.

## User-involved recovery expectations
When the extension cannot safely infer the final truth, the user should be brought into the loop rather than misled.

That means:
- uncertain write outcomes should surface a safe recovery path
- the user must be able to trigger targeted revalidation
- the system must avoid stacking more Anki writes on top of unresolved uncertainty
- if a target remains `stale-uncertain` after retry, the UI must direct the user to verify in Anki before continuing

This stage does not require a full diagnostic console, but it should leave the user with an honest, actionable path.

## Deliverables
- explicit failure taxonomy for Anki-backed interactions
- explicit stale-state taxonomy for popup/registry state quality
- targeted refresh rules for:
  - immediate post-write confirmation
  - refresh retry
  - focus/visibility revalidation
  - time-boundary revalidation
  - backend reconnection
- recovery UX for uncertain and stale states
- cache invalidation rules aligned with Anki-backed source-of-truth behaviour
- action rules for when further writes are blocked because state is uncertain or stale

## Implementation expectations
Codex should, at minimum:
- inspect current post-write refresh flow and stale-state flags
- inspect popup/backend status handling from Stage 9 foundations
- inspect how Stage 12 write results are or will be represented
- define where state-quality ownership lives:
  - popup-local
  - registry-level
  - backend metadata contract
- ensure targeted refresh can be invoked for:
  - single affected card
  - single affected parsed term
  - limited visible stale targets when focus/visibility changes
- preserve Stage 11 blocked-state guarantees and Stage 12 transaction guarantees
- avoid broad polling or parse-time performance redesign in this stage

## Required implementation pattern
To keep recovery logic coherent, the implementation must follow this flow:

1. write path returns the strongest truth it can prove immediately
2. shared metadata layer normalizes that truth into one state-quality value
3. popup renders from that normalized value
4. targeted refresh updates the same normalized value rather than maintaining a second recovery state machine

This pattern matters because weaker implementations often spread stale/uncertain handling across multiple booleans until the UI and backend begin contradicting each other.

## Safety expectations
This stage must preserve safety under uncertainty.

That means:
- unresolved uncertain outcomes should block further conflicting Anki writes on the same target until state is revalidated
- refresh failure must not silently erase evidence that a write likely happened
- backend unavailability must not silently trigger Jiten fallback in the middle of recovery
- stale state must not be labelled as fresh merely because the extension still has cached data
- the system must prefer "I don't know yet" over a wrong claim

## Non-goals
- no bulk parse-time Anki resolution endpoint redesign
- no general localhost traffic/performance optimisation beyond what is directly needed for targeted refresh correctness
- no major visual redesign
- no migration or reconciliation of historical Jiten state into Anki
- no advanced analytics platform
- no expansion of scheduler taxonomy beyond what is required to communicate truth, staleness, and recovery

## Acceptance criteria
- the extension distinguishes definite failure, uncertain outcome, and confirmed-write-but-stale-refresh states
- uncertain outcomes are presented honestly and do not masquerade as success or clean failure
- confirmed writes followed by refresh failure remain visibly stale and recoverable
- users can trigger targeted recovery for stale/uncertain Anki-backed state without needing a full page reparse in the common case
- state can be revalidated after focus/visibility return, backend reconnection, or relevant time boundaries
- further Anki actions are appropriately blocked when state is too uncertain to proceed safely
- cache invalidation no longer leaves obviously wrong fresh-looking state after write or refresh disruption
- Stage 11 gating and Stage 12 Anki-first transaction guarantees remain intact

## Verification expectations
Verification should include:
- backend unavailable before write
- explicit write rejection
- simulated uncertain write outcome
- confirmed write plus refresh failure
- manual refresh retry flow
- focus/visibility-based revalidation
- backend reconnection recovery
- time-boundary revalidation for terms whose visible state can legitimately change later
- confirmation that stale/uncertain states block inappropriate follow-up writes
- confirmation that a targeted refresh can recover a stale term without full page reparse in the common case

## Handoff to next stage
This stage should leave the system honest and recoverable when Anki-backed state is uncertain or stale.

Once that is complete, later stages can safely focus on:
- low-risk localhost-call and parse-time optimisation
- deeper Anki resolution batching
- performance-driven endpoint consolidation
