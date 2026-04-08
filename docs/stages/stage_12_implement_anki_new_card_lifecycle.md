# Stage 12 — Implement Anki New-Card Lifecycle

## Objective
Make Anki mode fully usable for `new` and not-yet-mapped terms by ensuring that:
- mapped Anki `new` cards can be rated directly in Anki
- unmapped terms can be added to Anki and immediately rated in one coherent action
- when a new Anki card is created, sentence/context from the parsed target can be recorded into the created note when configured
- the resulting state shown in the extension comes back from Anki as the authoritative source of truth

From the user's perspective, reviewing a term in Anki mode should feel like one action, not a fragile chain of loosely connected steps.

## Why this stage exists
After Stage 9A, Stage 10, and Stage 11, the system should be able to:
- expose trustworthy Anki write-target configuration through the settings surface
- identify Anki targets more reliably
- distinguish blocked states such as `ambiguous`, `suspended`, and `buried`
- gate invalid actions before the user clicks

That still leaves a major product gap:
- if a term is already in Anki and is `new`, the user should be able to rate it immediately
- if a term is not yet in Anki, the user should still be able to review it in Anki mode by creating the card and recording the chosen rating there

Without this stage, the system remains awkward at the exact point where Anki-backed vocabulary acquisition starts.

This stage exists to make the first review lifecycle Anki-native rather than Jiten-derived.

## Scope
Codex should:
- support direct Anki review writes for mapped `new` cards
- support add-then-rate behaviour for unmapped terms when Anki is the selected backend
- ensure the add/rate flow targets the exact card that was created
- ensure the extension receives authoritative post-write state from Anki
- make the transaction safe against duplicate clicks, stale popup state, and ambiguous write targets

This stage should focus on the transaction model for new-card review actions.

## Problems this stage must solve
- how the system decides whether a review click should:
  - rate an existing Anki card
  - or create a new Anki note/card and then rate it
- how the system chooses the correct Anki write target:
  - deck
  - model
  - fields
  - card template
- how sentence/context from the parsed target is carried into note creation when available
- how the system guarantees that the chosen rating is applied to the exact created card rather than a guessed follow-up match
- how the system prevents duplicate note creation or duplicate rating application when the user double-clicks or retries
- how the system behaves when write configuration is missing, invalid, or ambiguous
- how the system handles popup actions that do not have a valid Anki scheduling equivalent
- how the extension shows immediate post-write state without inventing its own scheduling result

## Implementation-time choices eliminated
This stage does not leave the Anki first-review transaction model open to the implementation model.

The implementation must not choose between competing designs for:
- multiple frontend-coordinated requests vs one backend commit
- mining config vs blacklist/never-forget config for scheduler review creation
- which popup actions participate in Anki scheduler review
- how sentence-derived fields are sanitized
- how created-card identity is discovered
- whether the extension guesses post-create card identity by fuzzy rematch

## Fixed implementation directives
The implementation must follow these exact Stage 12 decisions:

1. The Anki review commit flow must be owned by one dedicated backend/add-on transaction contract.
2. Stage 12 must not assemble create-and-rate from multiple frontend-controlled requests.
3. The Anki scheduler review lifecycle for unmapped terms must use `ankiMiningConfig` only.
4. `ankiBlacklistConfig` and `ankiNeverForgetConfig` are not write targets for Stage 12 scheduler rating flows.
5. If `ankiMiningConfig` is missing or invalid, unmapped-term review is blocked.
6. Stage 12 must introduce one new versioned add-on transaction endpoint named `jitenTargetedReviewCommitV1`.
7. The extension must route all Anki scheduler review actions for this lifecycle through `jitenTargetedReviewCommitV1`.
8. Existing selected-card scheduler review and create-and-rate must both flow through the same logical review-commit entry point.
9. The commit response must return exact created/reviewed target identity and scheduler snapshot in the same response.
10. `sentenceSanitized` must be materialized deterministically as:
   - the sentence string with leading/trailing whitespace trimmed
   - all internal whitespace collapsed to single spaces
   - empty string when no sentence is available
11. In Anki mode, the only scheduler actions available to this Stage 12 lifecycle are:
   - `again`
   - `hard`
   - `good`
   - `easy`
12. Unsupported Jiten-only actions must be hidden in Anki mode for this stage:
   - `Never forget`
   - `Blacklist`
   - `Forget`
13. The backend must return the exact `cardId` that received the final rating; the extension must not rediscover it by later term lookup.

## Mandated policy
For this stage:
- if a term already maps to a reviewable Anki card in `new` state, the selected rating must be applied directly to that existing card
- if a term does not map to Anki, the selected rating must trigger a single logical transaction that:
  - creates the Anki note/card
  - populates configured note fields, including sentence/context-derived fields when available
  - identifies the exact target card
  - applies the chosen rating to that card
  - returns authoritative post-write scheduling data from Anki
- the create-and-rate transaction should be owned by the backend/add-on layer rather than assembled from fragile frontend steps
- the extension must never create a note and then "guess" which card to rate using a follow-up fuzzy lookup
- note creation must use shared field-materialization logic so configured templates such as `spelling`, `reading`, `meaning`, `sentence`, and `sentenceSanitized` are resolved consistently
- the implementation must reuse as much of the existing Jiten-side mining pipeline as architecture permits:
  - reuse existing popup/context sentence plumbing
  - reuse existing backend-selection and command-routing layers where possible
  - reuse consistent sentence-attachment semantics rather than inventing Anki-only behaviour without reason
- backend-specific code must be limited to the final persistence/transaction boundary:
  - Jiten-specific API calls stay Jiten-specific
  - Anki-specific note creation and review submission stay Anki-specific
  - upstream orchestration and field-materialization logic should not fork unnecessarily
- sentence/context capture for newly created Anki cards must honour the same user-level preference model as Jiten-side sentence attachment
- if write-target configuration is missing or ambiguous, the action must be blocked with a clear configuration error
- if a popup action has no valid Anki meaning, it must be hidden in Anki mode rather than silently reinterpreted
- no silent fallback to Jiten should occur once the user initiated an Anki-mode review action

## Cross-stage invariants
This stage extends Stage 11 reviewability and Stage 10 identity; it does not replace them.

The implementation must preserve these invariants:
- Stage 10 still owns read-side identity and selected-target facts
- Stage 11 still owns whether the action should be offered to the user
- Stage 12 owns what happens once a valid Anki-mode review action is executed
- newly created Anki targets must become first-class exact targets, not fuzzy follow-up matches
- the extension must never create a note and then guess which card to rate using a second term search
- Anki remains the source of truth for the resulting scheduler state

## Required architecture pattern
To minimize duplication and keep the flow deterministic, this stage must follow one orchestration pattern rather than multiple parallel implementations.

### 1. One review-action orchestration entry
- the popup/controller must dispatch one logical Anki review action
- that action may:
  - rate an existing selected card
  - or create-and-rate a new target
- the popup must not maintain separate hidden workflows that build fields or resolve created cards on its own

### 2. One shared field-materialization helper
- all Anki note creation in this stage must use one shared helper for building field values
- that helper must be reused anywhere the extension creates Anki notes for this lifecycle
- sentence/context-derived targets such as `sentence` and `sentenceSanitized` should be resolved there, not inline in multiple callers

### 3. Thin backend-specific persistence adapters
- Jiten-specific code remains responsible for Jiten API mutations only
- Anki-specific code remains responsible for:
  - note creation
  - exact created-card resolution
  - first-review submission
  - scheduler snapshot return
- shared orchestration must sit above those adapters

### 4. Exact created-card identification
- if note creation produces or could produce multiple cards, the implementation must resolve the intended created card from deterministic identity data:
  - created note id
  - configured template/card-template constraint
  - exact resulting card id
- do not use fuzzy lookup by spelling/reading after creation

## Transaction model
The stage should leave behind an explicit Anki-first lifecycle similar to the following.

### Case 1 — Mapped existing Anki `new` card
1. User clicks a valid rating in the popup.
2. Popup enters pending state and prevents duplicate input.
3. Backend submits the rating to the exact selected Anki card.
4. Backend receives authoritative scheduler result from Anki or the add-on.
5. Popup/registry refreshes from that Anki-backed result and leaves the term in a non-stale state.

### Case 2 — Unmapped term in Anki mode
1. User clicks a valid rating in the popup.
2. Popup enters pending state and prevents duplicate input.
3. Backend uses `ankiMiningConfig` as the write target configuration.
4. Backend/add-on materializes the note fields, including sentence/context-derived fields when configured and available.
5. Backend/add-on creates the note/card in Anki.
6. Backend/add-on applies the chosen rating to the exact created card.
7. Backend returns authoritative identifiers and post-write scheduler data.
8. Popup/registry updates the term from Anki-backed result instead of from frontend guesswork.

### Case 3 — Unmapped term but write target not resolvable
1. User clicks a rating.
2. Backend refuses the action before creation.
3. Popup shows a clear configuration error state.
4. No note/card is created.

### Case 4 — Blocked target states from Stage 11
- `ambiguous`, `suspended`, `buried`, and other blocked states remain blocked.
- Stage 12 should not weaken Stage 11 gating just to make add-then-rate possible.

## Action-validity expectations
This stage must use the following exact Anki-mode action policy:

- valid scheduler actions:
  - `again`
  - `hard`
  - `good`
  - `easy`
- hidden unsupported actions:
  - `Never forget`
  - `Blacklist`
  - `Forget`
- unsupported actions must not be silently mapped to arbitrary Anki behaviour

## Write-target resolution expectations
The lifecycle is only trustworthy if the write target is deterministic.

This stage fixes the following write-target resolution rules:
- the write config is always `ankiMiningConfig`
- no other scheduler-review write-config selection algorithm exists in Stage 12
- if `ankiMiningConfig` is invalid or incomplete, the action is blocked before any write
- card-template selection during creation must use the same canonical template-ord representation established by Stage 10
- sentence/context-aware template targets must be populated during creation using the shared field-materialization helper

Required policy:
- `ankiMiningConfig` is the sole write target for Stage 12 scheduler review
- if `ankiMiningConfig` is invalid or incomplete, add-then-rate is blocked with a configuration error
- write-side template/card-template identity must reuse the same canonical representation established by Stage 10 so read-side and create-side target selection cannot drift
- if sentence context is available, configured `sentence` / `sentenceSanitized` template targets must be populated during note creation
- if sentence context is unavailable, sentence-derived targets resolve deterministically to empty string

## Note field materialization expectations
This stage should explicitly define how note field values are built for Anki card creation.

That includes:
- required identity fields such as spelling and reading
- derived content such as meaning or hiragana if configured
- sentence/context-derived fields such as:
  - `sentence`
  - `sentenceSanitized`

Required policy:
- field materialization must be implemented through one shared helper rather than inline one-off mapping logic
- the helper must consume:
  - target card/vocabulary data
  - chosen deck/model/template configuration
  - optional sentence/context from the parsed target
- the helper must return the final Anki note field map used for creation

This is important because the settings UI already exposes `templateTargets`, including sentence-related templates, and Stage 12 is the first stage where Anki-side note creation becomes real.

## Reuse-first implementation strategy
This stage should explicitly prefer reuse over parallel reimplementation.

The expected layering is:

### Reuse directly
- parsed sentence/context plumbing from popup to background
- existing mining/action orchestration concepts
- existing configuration surfaces for deck/model/field/template mapping
- existing sentence-attachment user preference semantics where still applicable

### Extract into shared logic
- write-target resolution for Anki note creation
- note-field materialization from:
  - card/vocabulary data
  - optional sentence/context
  - configured `templateTargets`
- deterministic fallback behaviour when optional inputs such as sentence are missing

### Keep backend-specific
- Jiten mutation calls such as vocabulary add/remove and `set-card-sentence`
- Anki note creation, exact created-card discovery, and first-review application
- Anki add-on contract details and scheduler-specific response handling

The implementation should not try to reuse Jiten's API calls themselves, because those are backend-specific. The reusable part is the logic around what should be created, which fields should be filled, and which context should be carried through.

## Required implementation touchpoints
To keep the implementation blueprint concrete, Codex must extend existing plumbing rather than introducing a second creation stack.

Required touchpoints:
- existing popup sentence/context plumbing
- existing deck-action / mining command-routing surfaces
- existing backend selection and review backend abstraction
- existing deck configuration / template-target data structures

Required anti-patterns to avoid:
- a popup-only Anki create path that bypasses the current command architecture
- a second inline field-builder just for Anki first-review flows
- a follow-up term search to discover the created card after note creation
- duplicating sentence-attachment semantics in one-off helper code

## Backend contract expectations
This stage must use a backend contract that returns authoritative post-write data from the same write transaction.

Stage 12 must implement `jitenTargetedReviewCommitV1` as the dedicated Anki review-commit contract for this lifecycle.

The required request shape for `jitenTargetedReviewCommitV1` must include, at minimum:
- `requestId`
- stable parsed term identity / target key
- selected scheduler rating
- existing selected `cardId` when reviewing an existing target
- normalized `ankiMiningConfig`-derived write target when creating a new note
- deterministic template/card-template constraint
- fully materialized note fields for create-and-rate when creation is required

The returned result should include, at minimum:
- whether the flow:
  - reviewed an existing card
  - or created and reviewed a new card
- exact `cardId`
- exact `noteId`
- deck/model/template identity needed for later diagnostics
- resulting scheduler state needed by the extension:
  - queue
  - due
  - interval
  - review count / lapse-style counters if available
- enough metadata to update popup and registry state without a speculative local reconstruction
- confirmation of whether sentence-derived fields were written during create-and-rate

This stage does not need to eliminate all follow-up refresh behaviour, but it should ensure the first post-write state comes from authoritative backend data whenever possible.

## Safety expectations
The new-card lifecycle must remain safe under realistic user behaviour and transient state mismatch.

That means:
- duplicate clicks must not create duplicate notes or duplicate first reviews
- stale popup state must not redirect the rating onto the wrong card
- blocked targets must remain blocked
- failed config resolution must stop before any write
- the backend must remain the final authority even if the popup attempted an invalid action

Required robustness requirements:
- use a per-click request or idempotency token
- disable controls while the transaction is in flight
- return exact created card identity from the backend transaction
- preserve backend-side validation even when popup gating exists

## Deliverables
- a defined lifecycle for reviewing mapped Anki `new` cards
- a defined lifecycle for add-then-rate behaviour on unmapped terms
- deterministic write-target resolution rules
- action-validity rules for which popup ratings are supported in Anki mode
- a backend transaction contract that returns exact created/reviewed card identity
- note-field materialization rules for configured template targets, including sentence/context-derived fields
- a shared note-creation/materialization abstraction that can be reused by Anki-backed create flows instead of duplicating field-building logic across multiple entry points
- popup/registry expectations for consuming authoritative post-write state
- clear user-visible error handling for missing or ambiguous write configuration

## Implementation expectations
Codex should, at minimum:
- inspect the current Anki write path and add-on contract
- inspect existing write-target configuration used for mining / card creation
- inspect the existing Jiten-side sentence-attach behaviour so sentence/context expectations remain coherent across backends
- inspect the current Jiten-side mining pipeline and reuse its upstream plumbing where possible instead of building a parallel Anki-only creation flow from scratch
- define a shared note-field materialization helper for Anki creation so template-target handling is not duplicated
- keep backend-specific code as thin as practical by pushing shared logic above the final persistence adapter
- ensure the extension no longer depends on fuzzy rematching after creation
- update popup action handling so pending state and duplicate-click protection exist for this flow
- preserve compatibility with the Stage 11 blocked-state UX
- keep the resulting data contract compatible with later Stage 13 refresh/recovery hardening

## Required UX behaviour
The user should feel like they are still doing one review action, even when the system needs to create a card first.

Required UX principles:
- the popup should show a clear pending state while add/review is in flight
- success should transition back into normal Anki-backed state, not a guessed frontend approximation
- configuration problems should be explained plainly:
  - no valid Anki write target configured
  - multiple possible write targets configured
  - selected action not supported in Anki mode
- the user should not need to understand note creation internals to understand what happened

Required wording direction:
- add/rate pending:
  - "Adding to Anki and applying rating..."
- config missing:
  - "Cannot review in Anki: no valid write target is configured."
- config ambiguous:
  - "Cannot review in Anki: multiple write targets match this term."
- unsupported action:
  - "This action is not available for Anki-backed review."

The final wording may differ slightly, but the meaning must remain explicit.

## Non-goals
- no auto-unsuspend / auto-unbury workflow
- no target-selection UI for ambiguous read-side matches
- no broad refresh scheduler
- no full failure-recovery redesign beyond what is necessary to keep the add/rate transaction honest
- no parse-time performance redesign
- no migration of old Jiten scheduling history into Anki

## Acceptance criteria
- when a mapped Anki card is in `new` state and reviewable, the user can rate it directly in Anki mode
- when a term is not yet in Anki and `ankiMiningConfig` is valid, the user can review it in Anki mode via add-then-rate
- add-then-rate applies the chosen rating to the exact created card, not to a guessed rematch
- when sentence/context is available and the chosen Anki config maps sentence-derived template targets, the created note receives that sentence/context data
- the implementation does not duplicate note-field materialization logic across separate Anki creation paths when a shared helper can be used
- the resulting state shown in the extension comes from authoritative Anki-backed data
- the implementation reuses the existing upstream mining/action plumbing instead of creating a parallel popup-only Anki creation stack
- duplicate clicks do not create duplicate notes or duplicate first-review writes
- unsupported popup actions are not silently guessed or reinterpreted for Anki mode
- missing or ambiguous write-target configuration produces a clear user-visible error and no partial silent fallback
- Stage 11 blocked-state guarantees remain intact

## Verification expectations
Verification should include:
- mapped Anki `new` card review flow
- unmapped term add-then-rate success flow
- unmapped term add-then-rate success flow with configured sentence field population
- repeated click / retry behaviour for idempotency
- missing write config
- ambiguous write config
- unsupported action in Anki mode
- confirmation that the created card identity returned by the backend matches the card later shown in popup metadata
- confirmation that blocked read-side states from Stage 11 remain blocked

## Handoff to next stage
This stage should leave the system with an Anki-first transaction model for first-review interactions.

Once that is complete, later stages can safely focus on:
- stronger failure transparency and recovery for partial or uncertain write outcomes
- more advanced stale-state handling and refresh scheduling
- deeper localhost-call and parse-time performance optimisations
