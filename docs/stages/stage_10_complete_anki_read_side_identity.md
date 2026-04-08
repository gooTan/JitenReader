# Stage 10 — Complete Anki Read-Side Identity

## Objective
Make Anki-backed read-side matching deterministic, configurable, and transparent so the extension can reliably answer three questions for every parsed term:
- does this term map to Anki at all?
- which exact Anki card target does it map to?
- what authoritative Anki-backed state should the UI show for that target?

## Why this stage exists
Stage 9 hardened targeted refresh, failure handling, and hybrid UX, but it also clarified that Anki read-side identity is still incomplete.

This stage assumes Stage 9A has already made the Anki settings/configuration surface reachable and trustworthy enough to support normal configuration and verification.

At the moment:
- parse-time matching depends on hidden `ankiReadonlyConfigs`
- card template matching is effectively hardcoded to template ord `0` ("Card 1")
- `suspended` and `buried` are not fully surfaced as first-class Anki-backed UI states
- some popup/action behavior is forced to infer too much from incomplete identity data

This stage fixes the foundation before later stages extend write-path behavior, refresh cadence, or larger performance improvements.

## Scope
Codex should:
- make read-side Anki lookup configuration explicit and usable
- remove the hardcoded "Card 1 only" template assumption
- surface `suspended` and `buried` as authoritative Anki-derived states
- ensure read-side metadata remains deterministic when multiple configs, decks, models, and templates are present
- preserve Stage 9 targeted refresh and backend-status semantics while improving the quality of the matched target data they operate on

## Problems this stage must solve
- how the extension knows which note types / fields / decks are valid for Anki read-side matching
- how the extension chooses which card template(s) are valid for a matched note
- how the system represents matched Anki cards that are suspended or buried
- how the popup and grading layer distinguish "unmapped", "mapped but blocked", and "ambiguous"
- how users configure read-side matching without relying on undocumented or hidden configuration fields

## Implementation-time choices eliminated
This stage does not leave read-side identity architecture open to the implementation model.

The implementation must not invent a different policy for:
- how readonly lookup config is sourced
- how derived and explicit readonly configs interact
- how template/card-template identity is stored
- whether `suspended` and `buried` are first-class surfaced states
- how insufficient Anki config is classified
- how ambiguity is handled

## Fixed implementation directives
The implementation must follow these exact read-side architecture decisions:

1. Read-only lookup config is built in two layers:
   - base layer: auto-derived from `ankiMiningConfig`, `ankiBlacklistConfig`, and `ankiNeverForgetConfig`
   - override layer: explicit `ankiReadonlyConfigs`
2. The backend must use the merged normalized config set:
   - derived entries first
   - explicit overrides on top
   - explicit overrides replace a derived entry with the same normalized identity
3. A normalized readonly-config identity is the tuple:
   - model
   - word field
   - reading field or empty string
   - deck constraint or empty string
   - ordered template-ord set
4. Derived readonly configs must be produced from eligible write-config entries using these exact source mappings:
   - model -> model
   - word field -> word field
   - reading field -> reading field when configured, otherwise empty
   - deck -> deck constraint when configured, otherwise empty
   - configured template/card-template constraint -> ordered template-ord set
5. Template matching must use `templateOrd` as the canonical stored/matching value.
6. Template name is display/diagnostic metadata only and must not be the matching key.
7. Stage 10 must extend the relevant Anki config structures so read-side matching can store template/card-template constraints explicitly.
8. The settings surface for Stage 10 must include one advanced read-side matching section:
   - a read-only summary of derived configs
   - an explicit override editor for advanced entries
9. `suspended` and `buried` must both be first-class surfaced states in:
   - unified review metadata
   - popup rendering
   - word-style/editor configuration
   - built-in word-style presets
10. Target-state precedence must be:
   - `suspended` when Anki reports suspension
   - `buried` when Anki reports burial and the card is not suspended
   - otherwise normal scheduler-derived state
11. If read-side config is insufficient, the implementation must not silently treat that as a trustworthy "not in Anki" result.
12. Stage 10 output must include `resolutionStatus` with exactly these values:
   - `resolved`
   - `config-insufficient`
   - `backend-unavailable`
13. `mappingOutcome` values `selected`, `none`, and `ambiguous` are valid only when `resolutionStatus === 'resolved'`.
14. Insufficient or invalid read-side config must surface as `resolutionStatus === 'config-insufficient'`, not as `none`.
15. Backend unavailability during read-side identity must surface as `resolutionStatus === 'backend-unavailable'`, not as `none`.

## Mandated policy
For this stage:
- auto-derive read-only configs from existing Anki write-deck configs by default when enough information is present
- support explicit advanced read-only config overrides for users with more complex collections
- make template/card-type selection explicit instead of silently assuming template ord `0`
- treat `suspended` and `buried` as authoritative Anki states when confirmed by Anki
- do not yet implement unsuspend / unbury actions in this stage
- keep matching conservative:
  - classify multiple valid matches as `ambiguous` rather than silently auto-selecting
  - classify config-insufficient or backend-unavailable reads through `resolutionStatus`, not guessed `none` fallback
- make precedence explicit:
  - explicit read-only override config wins when present
  - auto-derived config fills gaps when no explicit override exists
- treat template ord as the canonical machine identifier for matching/filtering
- treat template name as optional display/diagnostic metadata rather than the only selector

## Cross-stage invariants
This stage is the read-side identity foundation for every later Anki stage.

The implementation must preserve these invariants:
- read-side identity and write-path eligibility are separate concerns
- this stage answers:
  - whether a term maps to Anki
  - which exact target it maps to
  - what Anki-derived read-side state that target is in
- this stage does not decide whether an unmapped (`none`) term can later be created-and-reviewed in Anki
- later stages must consume the identity emitted here rather than re-deriving it from raw queue/ord data in multiple places
- no silent fallback to Jiten should occur while the system is still trying to determine Anki read-side identity

## Deliverables
- configuration policy for read-side Anki matching that no longer depends on hidden setup alone
- settings UI support for the chosen read-side config strategy
- backend matching logic that can filter by configured card template(s) instead of fixed ord `0`
- unified review metadata support for `suspended` and `buried`
- word-style/editor support for any newly surfaced Anki states that users should be able to distinguish visually, especially `buried`
- popup/frontend rendering support for those states
- deterministic mapping rules when multiple configs and multiple templates can match the same term
- migration or compatibility behavior for existing users with only mining / blacklist / never-forget configs

## Required output contract for later stages
This stage should leave behind one stable read-side contract that later stages can consume directly.

At minimum, later stages should be able to obtain per parsed term:
- mapping outcome:
  - `selected`
  - `none`
  - `ambiguous`
  - only when `resolutionStatus === 'resolved'`
- resolution status:
  - `resolved`
  - `config-insufficient`
  - `backend-unavailable`
- selected-target identity when present:
  - `noteId`
  - `cardId`
  - deck identity
  - model identity
  - template identity:
    - canonical ord
    - optional template name for diagnostics
- authoritative Anki-derived target state when selected:
  - reviewable normal state
  - `suspended`
  - `buried`
- state tags / due-state information needed by the popup/highlighter
- enough provenance/debug information to explain why a target was selected or why the result is ambiguous
- ambiguity diagnostics when `mappingOutcome === 'ambiguous'`:
  - candidate count
  - `candidateSummary[]` entries with:
    - deck
    - model
    - template
    - card id

Later stages should not need to:
- rediscover the selected template from raw note/card lists
- guess whether a blocked state came from Anki
- infer ambiguity by recomputing the same candidate filtering logic independently
- guess whether a `none` result was actually configuration insufficiency or backend unavailability

## Implementation expectations
Codex should, at minimum:
- inspect current use of:
  - `ankiReadonlyConfigs`
  - mining / blacklist / never-forget deck configs
  - candidate filtering by `ord`
- update configuration schema and defaults as needed
- update settings UI so the read-side matching strategy is visible and controllable
- update Anki backend matching so template selection is data-driven
- update state-tag generation and popup rendering so suspended / buried cards are shown clearly
- update any state-style/editor/preset plumbing needed so `buried` is not surfaced as an unstyleable second-class state
- preserve existing Stage 9 backend badge, stale-state, and ambiguity foundations unless a change is required to support the new states cleanly

## Required concrete directions
This stage must follow the following concrete directions:

### Direction 1 — Keep read-only config normalization centralized
- normalize explicit overrides and auto-derived configs into one backend-facing structure
- avoid having popup/settings/backend each invent their own partial config interpretation

### Direction 2 — Source template choices from Anki data
- when the settings UI exposes template/card-type selection, it must use Anki-discovered template metadata rather than free-text guessing
- keep ord as the canonical stored selector even if template names are shown in the UI

### Direction 3 — Make the chosen strategy visible without forcing full manual duplication
- users should be able to tell whether read-side matching is derived, explicitly overridden, or incomplete
- the UI does not need to force users to manually duplicate every derived config entry just to get safe defaults

## Required implementation pattern
To keep later stages simple, this stage must leave behind a clear separation of responsibilities:

### Settings / config layer
- owns explicit read-only overrides
- owns any auto-derived read-only config generation
- exposes one normalized config set to the backend

### Anki read backend
- performs all config-constrained candidate lookup/filtering
- applies template filtering using explicit configured template constraints
- classifies the result as `selected`, `none`, or `ambiguous`
- derives blocked read-side states such as `suspended` and `buried`

### Frontend / popup consumers
- render the already-classified result
- do not reproduce backend matching logic locally

This pattern matters because Stage 11, 12, and 13 should be able to trust one backend-owned identity result instead of each re-implementing lookup rules in slightly different ways.

## Non-goals
- no add-then-rate flow for terms not yet in Anki
- no new targeted write contract changes
- no live timer-based refresh scheduler
- no parse-time bulk Anki add-on endpoint redesign
- no advanced scheduler-state taxonomy beyond what is required for:
  - `new`
  - `young`
  - `mature`
  - `due`
  - `suspended`
  - `buried`
- no automatic unsuspend / unbury action workflow yet

## Acceptance criteria
- a user can configure Anki read-side matching without relying on undocumented hidden config alone
- Anki read-side matching no longer silently assumes "Card 1 only"
- matched suspended cards are surfaced distinctly from normal mapped cards
- matched buried cards are surfaced distinctly from normal mapped cards
- popup / metadata can distinguish:
  - unmapped
  - mapped and reviewable
  - mapped but suspended
  - mapped but buried
  - ambiguous
- users can style any newly surfaced blocked Anki state, especially `buried`, through the normal word-style surface
- later stages receive enough stable target identity metadata that they do not need to guess template/card identity again
- existing Stage 9 targeted refresh / stale handling still works with the richer read-side identity data
- ambiguity handling remains deterministic and does not silently auto-pick between multiple valid Anki targets

## Verification expectations
Verification should include:
- config-path validation for:
  - derived read-side config
  - explicit advanced read-side config
  - incomplete / invalid config
- live or simulated matching against note types with multiple card templates
- confirmation that a card on non-zero template ord can be matched when configured
- confirmation that suspended and buried cards appear with correct frontend state tags
- confirmation that review buttons / action eligibility receive enough metadata for later UX stages without regressing current behavior

## Handoff to next stage
This stage should leave the system with trustworthy Anki read-side identity. Once that is complete, later stages can safely focus on:
- action gating and blocked-state UX
- add-then-rate behavior for not-yet-mapped terms
- stronger refresh / recovery behavior
- deeper parse-time performance reductions
