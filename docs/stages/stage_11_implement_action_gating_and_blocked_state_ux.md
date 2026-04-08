# Stage 11 — Implement Action Gating and Blocked-State UX

## Objective
Make Anki-backed review actions safe, predictable, and transparent by ensuring the popup only offers grading when the selected target is truly reviewable.

This stage should turn Stage 10's richer read-side identity into clear user-facing behaviour:
- users should immediately understand whether a term can be reviewed
- users should immediately understand why a term cannot be reviewed
- the UI should prevent invalid review attempts before the user clicks

## Why this stage exists
Stage 10 is intended to make Anki read-side identity trustworthy:
- whether a term maps to Anki
- which exact target it maps to
- whether the mapped target is normal, suspended, buried, or ambiguous

Once that information exists, the popup and grading layer should stop behaving like a best-effort shell around click-time failures.

At the moment, the system still has a UX gap:
- some blocked cases are only discovered after the user clicks a rating button
- ambiguous matches are surfaced, but the grading affordance is still too permissive
- suspended and buried cards are not yet treated as first-class blocked review states
- "no target", "ambiguous target", and "mapped but blocked" are not yet clearly separated in the interaction model

This stage addresses that gap without yet expanding into add-then-rate lifecycle work or live refresh scheduling.

## Scope
Codex should:
- define and implement popup action-gating rules for Anki-backed review
- make blocked review states explicit in the popup UX
- ensure ambiguity is treated as a clear error state, not a recoverable click path
- distinguish reviewable targets from blocked targets before rating buttons are used
- provide user guidance for what to do next when a target is blocked

This stage should consume the richer metadata from Stage 10 rather than redesign matching or scheduling itself.

This stage should also stay compatible with the later Stage 12 add-then-rate lifecycle:
- "not found in Anki" must not be treated as a permanently blocked condition
- instead, it should remain available for review when a valid Anki create-and-rate path exists
- it should only be blocked when no valid Anki write path can be determined

## Problems this stage must solve
- how the popup decides whether grading actions are available at all
- how the UI distinguishes:
  - unmapped term
  - ambiguous target
  - suspended target
  - buried target
  - backend unavailable
  - mapped and reviewable target
- how blocked states are explained without forcing the user to learn internal backend details
- how to prevent invalid rating writes from ever being attempted in obviously blocked cases
- how to preserve a lightweight popup while still making the failure mode unmistakable

## Implementation-time choices eliminated
This stage does not leave blocked-state UX direction open to the implementation model.

The implementation must not choose between competing interaction models for:
- whether blocked states hide, disable, or replace controls
- whether ambiguous targets still allow click-through
- how `none` behaves in Anki mode
- whether popup, controller, and backend use different reviewability rules
- whether stale/unavailable Anki state still permits writes

## Fixed implementation directives
The implementation must follow these exact gating/UI decisions:

1. In blocked Anki states, the grading-control area must be replaced by a non-interactive status block.
2. Rating buttons must not remain visible in blocked Anki states.
3. `ambiguous`, `suspended`, and `buried` are always blocked states in Anki mode.
4. `none` is reviewable only when the Anki create path is available through a valid `ankiMiningConfig`.
5. If `none` is reviewable, the popup must show:
   - the normal rating controls
   - a short message that reviewing will add the term to Anki first
6. If `none` is not reviewable, the popup must show the blocked status block instead of controls.
7. Ambiguous-state diagnostics must show a compact candidate summary when available:
   - deck
   - model
   - template
   - card id
8. The same reviewability decision must be reused by:
   - popup rendering
   - controller validation
   - backend-side safety checks
9. In Anki mode, the blocked-state panel replaces the entire grading-control area.
10. In Anki mode, scheduler grading controls are shown only when the resolver returns `allowed === true`.

## Mandated policy
For this stage:
- in Anki mode, grading must only be available when the target state is definitively reviewable
- in Anki mode, `none` is conditionally reviewable:
  - if Stage 12 add-then-rate support is available and exactly one valid write target exists, grading remains available
  - if no valid write target exists, it is shown as blocked with a clear configuration message
- ambiguous Anki targets are a hard blocked state:
  - no silent auto-pick
  - no click-through attempt
  - no hidden fallback
- suspended targets must be shown as blocked:
  - explain that the card must be unsuspended in Anki before review can continue
- buried targets must be shown as blocked:
  - explain that the card must be unburied in Anki before review can continue
- blocked states must be visible before the user interacts with rating controls
- blocked states must replace grading controls with a clear blocked-state message
- do not yet implement one-click unsuspend / unbury actions in this stage
- do not yet add target-selection UI for ambiguous matches in this stage

## Cross-stage invariants
This stage should consume Stage 10 identity rather than extending or re-deciding it.

The implementation must preserve these invariants:
- Stage 10 owns read-side target identity and blocked-state facts
- Stage 11 owns whether the popup exposes review actions for the current state
- Stage 11 must not implement the Stage 12 add-then-rate transaction itself
- Stage 11 must not permanently encode "not found in Anki" as conceptually non-reviewable
- UI gating, controller validation, and backend validation must agree on the same reviewability rules

## Required reviewability model
To keep the implementation stable across Stage 11 and Stage 12, reviewability should be decided through one central rule set.

Required inputs:
- Stage 10 `resolutionStatus`, mapping outcome, and target state
- backend availability / stale-status inputs already available from Stage 9
- a dedicated capability check for whether Anki create-and-rate is currently supported for this term

Required policy:
- if `resolutionStatus === 'config-insufficient'`, review is blocked with a configuration error reason
- if `resolutionStatus === 'backend-unavailable'`, review is blocked with an unavailable reason
- if mapped target is blocked (`ambiguous`, `suspended`, `buried`), review is blocked
- if mapped target is reviewable, review is allowed
- if `resolutionStatus === 'resolved'` and mapping outcome is `none`, reviewability depends on the create-and-rate capability check rather than on ad hoc popup logic

Important sequencing note:
- Stage 11 introduces the capability hook/interface before Stage 12 implements the lifecycle behind it
- until Stage 12 exists, that capability must resolve to false
- the architecture should still be shaped so Stage 12 can enable `none` without rewriting the gating model

## Required resolver output contract
The central reviewability resolver must return one normalized result object with these fields:
- `allowed: boolean`
- `reasonCode`
- `messageKey`
- `showAddToAnkiHint: boolean`
- `candidateSummary[]` for ambiguous results when available

Allowed `reasonCode` values for Anki mode:
- `reviewable-selected`
- `reviewable-create`
- `blocked-config-insufficient`
- `blocked-none-no-create-path`
- `blocked-ambiguous`
- `blocked-suspended`
- `blocked-buried`
- `blocked-unavailable`
- `blocked-stale`

Popup rendering, controller validation, and backend validation must all consume this same normalized reviewability result.

## Action gating matrix
The stage should leave behind explicit behaviour rules similar to the following.

| Backend / Target condition | Grading buttons | Popup treatment | User guidance |
| --- | --- | --- | --- |
| Anki + selected + reviewable | visible and enabled | normal Anki-backed popup | no special guidance |
| Anki + none + valid create path | visible and enabled | explicit add-to-Anki capable state | clarify that review will add the term to Anki first |
| Anki + config insufficient | not shown; blocked panel shown | explicit configuration error state | clarify that Anki read/write configuration is incomplete |
| Anki + none + no valid create path | not shown; blocked panel shown | explicit "not found in Anki" state | clarify that no matching target was found and no valid Anki write path is configured |
| Anki + ambiguous | not shown; blocked panel shown | explicit error state | explain that multiple Anki targets match and review is blocked |
| Anki + suspended | not shown; blocked panel shown | explicit blocked state | tell user to unsuspend in Anki first |
| Anki + buried | not shown; blocked panel shown | explicit blocked state | tell user to unbury in Anki first |
| Anki unavailable before interaction | not shown; blocked panel shown | backend unavailable state | clarify that Anki is not currently reachable |
| Anki stale after write but before refresh resolves | not shown; blocked panel shown | stale / refreshing state | clarify that state is being refreshed from Anki |
| Jiten backend | unchanged by this stage unless needed for consistency | existing Jiten UX | unchanged |

The implementation must follow this matrix semantically even if the final wording or component names differ.

## Deliverables
- popup gating rules that make blocked review states unclickable before rating is attempted
- explicit blocked-state rendering for:
  - no target with no valid create path
  - ambiguous target
  - suspended target
  - buried target
  - backend unavailable
- updated grading-controller behaviour so invalid Anki writes are blocked both:
  - in the UI
  - in backend-side safety checks
- clear user-facing copy for blocked review situations
- a stable interface contract between popup rendering and the richer Stage 10 metadata

## Implementation expectations
Codex should, at minimum:
- inspect current popup rendering and grading enablement rules
- inspect current use of backend badge / target-state metadata in the popup
- define a single source of truth for whether an action is reviewable
- ensure the popup can render a distinct blocked-state reason instead of overloading generic error text
- preserve existing backend-side validation so the system remains safe even if the UI somehow drifts
- update any style/status tag usage needed so blocked-state presentation remains visually coherent
- keep the solution compatible with later stages that will introduce:
  - add-then-rate lifecycle work
  - stronger stale/recovery flows
  - deeper Anki state refresh behaviour

## Required implementation pattern
The implementation must follow this layering:

### Central reviewability resolver
- consumes Stage 10 identity metadata plus backend availability/staleness inputs
- exposes:
  - whether grading is allowed
  - why grading is blocked when disallowed
  - whether the blocked reason is recoverable by the user

### Popup renderer
- renders buttons/messages from the resolver output
- does not make its own second reviewability decision

### Controller / backend safety checks
- re-validate the same reviewability rules before dispatching an Anki write
- do not trust the popup alone for safety

This pattern is important because a weaker implementation model may otherwise split the rules across popup markup, controller click handlers, and backend rejection logic until they drift.

## Required UX behaviour
The popup should communicate blocked states in a way that feels deliberate rather than broken.

Required UX principles:
- blocked state should be immediately visible near the review controls
- the explanation must use plain language
- the explanation should name Anki when Anki is the reason
- do not force the user to infer blocked state from a toast alone
- if diagnostics are shown for ambiguity, keep them compact and useful:
  - duplicate count
  - model/deck hints if available
  - no overwhelming raw payload dump

Required wording direction:
- ambiguous:
  - "Cannot review: multiple Anki targets match this term."
- suspended:
  - "Cannot review: this Anki card is suspended."
- buried:
  - "Cannot review: this Anki card is buried."
- none with valid create path:
  - "This term is not in Anki yet. Reviewing it will add it to Anki first."
- config insufficient:
  - "Cannot review in Anki: the Anki configuration for this term is incomplete."
- none with no valid create path:
  - "No matching Anki target found, and no valid Anki write target is configured."

The final wording may differ slightly, but the meaning must remain direct and unambiguous.

## Safety expectations
This stage must preserve safety even if the UI is stale or partially out of sync.

That means:
- popup-level gating is required
- grading-controller validation is still required
- backend write paths must still reject invalid blocked-state actions when appropriate
- the system must never silently fall back to Jiten during an Anki-blocked action
- ambiguous targets must never be auto-resolved purely to make the click succeed

## Non-goals
- no implementation of add-then-rate flow for terms not yet in Anki in this stage
- no unsuspend / unbury mutation actions
- no target-selection workflow for ambiguous matches
- no scheduler redesign
- no refresh scheduler or live due-timer work
- no parse-time performance redesign
- no broad visual redesign beyond what is needed to clearly communicate blocked states

## Acceptance criteria
- when Anki target state is ambiguous, grading controls are not available and the popup clearly explains why
- when Anki target state is none and no valid add-then-rate path exists, grading controls are not available and the popup clearly explains why
- when Anki target state is none and a valid add-then-rate path exists, the UI contract remains compatible with keeping grading available for the later Stage 12 lifecycle
- when a matched Anki card is suspended, grading controls are not available and the popup tells the user to unsuspend in Anki first
- when a matched Anki card is buried, grading controls are not available and the popup tells the user to unbury in Anki first
- when the target is valid and reviewable, grading controls remain available
- blocked-state handling occurs before the user attempts a rating, not only after a failed click
- backend-side validation still prevents invalid writes if UI gating is bypassed
- popup behaviour remains consistent with Stage 9 backend status and stale-state semantics
- if Stage 12 is not yet implemented, `none` is only blocked because create-and-rate capability is absent, not because the architecture assumes `none` can never be reviewable

## Verification expectations
Verification should include:
- popup checks for each blocked-state case:
  - none with no valid create path
  - ambiguous
  - suspended
  - buried
  - unavailable
- confirmation that `none` does not become a permanently blocked design assumption when a later add-then-rate path is available
- confirmation that rating controls are unavailable in all blocked Anki states
- confirmation that rating controls remain available for normal reviewable Anki states
- confirmation that click-time toasts are no longer the primary UX for predictable blocked cases
- confirmation that backend-side protection still rejects invalid writes when directly invoked or when UI state is stale
- confirmation that Jiten-backed interactions are not accidentally regressed by the new gating rules

## Handoff to next stage
This stage should leave the popup and grading layer honest about when Anki review is possible.

Once that is complete, later stages can safely focus on:
- add-then-rate lifecycle support for new or not-yet-mapped terms
- stronger failure transparency and recovery after writes
- smarter refresh behaviour and stale-state recovery
- deeper parse-time and localhost-call performance optimisation
