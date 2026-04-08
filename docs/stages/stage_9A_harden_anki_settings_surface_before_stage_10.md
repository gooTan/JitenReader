# Stage 9A — Harden Anki Settings Surface Before Stage 10

## Objective
Make the Anki settings surface reachable, honest, and technically reliable so later Anki stages can be configured and exercised through the product instead of through hidden or partially wired settings.

After this stage:
- a user can actually enable and configure Anki from the settings page
- the Anki deck/model/field editor behaves like a real settings control rather than a partially connected custom element
- dead or misleading Anki settings are made truthful by implementation or removed/deferred from the UI
- Stage 10 and later stages can assume the Anki configuration surface is real

This stage is about settings-surface integrity, not about new read-side matching policy or new write-path behaviour.

## Why this stage exists
The settings-page audit identified several prerequisite problems that sit before Stage 10 and Stage 12:
- the Anki enable toggle is still hidden behind a debug-only section
- the Anki section is gated behind that same hidden toggle
- the Anki deck configuration editor is not treated as a first-class settings control in the main settings binding flow
- endpoint-related buttons and helper copy are not fully aligned with real runtime behaviour
- some Anki-related controls exist in schema/UI without clear runtime semantics

Without a dedicated bridge stage, later Anki implementation would be forced to build on a settings surface that is not trustworthy enough for normal users or for repeatable verification.

This stage exists to fix that foundation before Stage 10 begins the real Anki read-side identity work.

## Scope
Codex should:
- make Anki enablement and core configuration reachable through the normal settings page
- harden the settings-page wiring for Anki-specific custom controls
- ensure endpoint-related Anki controls are honest, validated, and usable
- apply the already chosen policy for Anki settings that currently exist but do not yet have trustworthy semantics
- keep the resulting settings surface compatible with Stage 10 read-side identity work and Stage 12 write-target usage

This stage should focus on settings-page and configuration-surface hardening only.

## Problems this stage must solve
- how a user actually turns Anki mode on without hidden/debug-only controls
- how Anki settings become visible and editable in a clean profile
- how custom Anki deck editors load/save through the same settings lifecycle as other settings controls
- how custom Anki deck-editor interactions stay correct and isolated:
  - copy/paste
  - clear/reset
  - template-target editing
- how Anki endpoint changes are propagated into deck/model/field selection controls
- how endpoint validation is exposed to the user so invalid Anki configuration is caught early
- how to handle Anki-related settings that are currently misleading because their runtime semantics are incomplete or absent

## Implementation-time choices eliminated
This stage does not leave settings-surface architecture open to the implementation model.

The implementation must not invent a new settings direction for:
- how `enableAnkiIntegration` is exposed
- whether Anki enablement is a backend selector or a dedicated integration toggle
- how `mining-input` participates in settings load/save
- what endpoint validation buttons do
- whether proxy controls stay visible without real runtime support
- whether Stage 9A absorbs Stage 10 or Stage 13 responsibilities

## Fixed implementation directives
The implementation must follow these exact settings-surface decisions:

1. `enableAnkiIntegration` remains the existing dedicated integration toggle.
2. That toggle must be visible in the normal settings UI and must no longer live behind hidden debug-only markup.
3. The Anki section remains hidden until `enableAnkiIntegration === true`, then becomes visible.
4. `ankiUrlButton` must act as the Anki endpoint test-and-refresh control:
   - normalize the current endpoint input into the canonical request URL
   - persist the normalized `ankiUrl`
   - perform one lightweight Anki reachability check
   - on success, refresh every Anki deck/model/field editor from that endpoint
   - on failure, show an explicit error and do not silently refresh dependent controls
5. `ankiProxyUrl` and per-deck `proxy` controls are not part of the supported settings surface for this stage:
   - remove or hide them from the main UI
   - do not require later stages to use them
   - persisted schema fields may remain temporarily for compatibility, but they are not user-facing contract in this stage
6. `ankiRolloverHour` is not exposed in the settings UI in this stage.
7. `ankiReadonlyConfigs` is not fully exposed in this stage beyond any scaffolding Stage 10 explicitly requires.
8. `mining-input` style Anki editors must be treated as first-class settings controls:
   - they must load persisted values on page open
   - they must save through the same configuration pipeline as other settings
   - they must receive the current normalized `ankiUrl` as their fetch source
9. Custom Anki deck-editor interactions must be isolated:
   - copy/paste must deep-clone data
   - clear/reset must only affect the edited config
   - editing one deck config must not mutate another through shared references
10. Stage 9A must not expose `ankiReadonlyConfigs` editing UI beyond a minimal placeholder or summary needed by Stage 10.
11. Stage 9A must not expose `ankiRolloverHour` in visible settings UI.
12. The visible Anki settings surface after Stage 9A must consist only of controls whose semantics are real in runtime:
   - `enableAnkiIntegration`
   - canonical Anki endpoint input
   - endpoint test/refresh control
   - supported Anki deck/model/field/template editor controls

## Mandated policy
For this stage:
- expose Anki enablement through the normal settings page rather than through hidden debug-only markup
- only expose Anki controls whose current semantics are real and explainable
- treat the Anki deck/model/field editor as a first-class settings component:
  - it should load persisted values
  - it should emit normal change events
  - it should save through the same configuration pipeline as the rest of the page
- propagate normalized endpoint changes into all Anki deck editors so deck/model/field selectors refresh correctly
- provide a clear endpoint validation path so the user can tell whether the configured Anki endpoint is reachable
- proxy-related controls remain hidden/deferred from the supported UI until a later stage gives them real runtime semantics
- keep Stage 10 policy questions deferred where appropriate:
  - do not fully implement read-only lookup strategy here
  - do not fully implement card-template matching policy here
  - do not implement add-then-rate or other write-path lifecycle logic here

## Cross-stage invariants
This stage is a prerequisite bridge, not a replacement for later Anki stages.

The implementation must preserve these invariants:
- Stage 9A owns settings-surface truthfulness and wiring for Anki configuration
- Stage 10 still owns Anki read-side identity policy and matching behaviour
- Stage 11 still owns popup reviewability gating
- Stage 12 still owns create-and-rate transaction logic and write-path semantics
- Stage 13 still owns stale-state/recovery semantics and any final decision about advanced rollover-truth policy
- no hidden debug-only setting should remain required for ordinary Anki usage after this stage

## Required implementation pattern
To keep later stages simple, the implementation must leave behind a clear separation of responsibilities:

### Settings page controller
- owns loading/saving of Anki settings values
- owns endpoint validation button behaviour and user-facing feedback
- owns propagation of normalized endpoint changes into Anki-specific custom elements

### Custom Anki settings elements
- own their internal UI rendering
- expose one reliable change contract to the settings page
- do not become ad hoc side channels that bypass the main settings save flow

### Backend/runtime consumers
- continue to read normalized configuration from storage
- do not need to know whether a value came from a simple input or a custom settings element

This pattern matters because Stage 10 and Stage 12 should be able to trust configuration state without also compensating for settings-page binding bugs.

## Required concrete directions
This stage must follow the following concrete directions:

### Direction 1 — Remove the hidden debug gate
- make `enableAnkiIntegration` part of the visible UI
- remove or retire copy that still says Anki is not implemented if that is no longer true for the roadmap

### Direction 2 — Make `mining-input` a first-class settings control
- include it in settings initialization and save flow
- ensure persisted deck/model/field/template-target values load correctly on page open
- ensure the control can refresh its deck/model/field choices when endpoint configuration changes
- ensure editor interactions such as copy/paste and template editing do not cause cross-config mutation or other hidden state coupling

### Direction 3 — Normalize endpoint input before dependent fetches
- accept user-friendly input forms only if they are normalized into a reliable request URL
- keep validation feedback explicit
- avoid letting dependent controls silently fail because the endpoint was never normalized

### Direction 4 — Make dead controls honest
- wire buttons that exist for endpoint validation/refresh if they are meant to be used
- remove `ankiProxyUrl` / per-deck proxy controls from the main UI until a later stage gives them real runtime semantics

### Direction 5 — Leave scaffolding for later stages without pre-implementing them
- this stage may prepare the settings surface for later read-only config work
- this stage must not quietly absorb Stage 10 read-side identity policy or Stage 12 write-path logic

## Deliverables
- visible, non-debug Anki enablement in the settings page
- a usable Anki section that appears when Anki is enabled
- hardened settings-page wiring for Anki deck/model/field/template editors
- endpoint validation/refresh behaviour that is implemented and explained
- normalization rules for Anki endpoint input that keep dependent controls reliable
- a resolved policy for misleading Anki proxy controls:
  - hidden/deferred until a later stage gives them real runtime semantics
- a settings/config surface that Stage 10 and Stage 12 can safely build on

## Implementation expectations
Codex should, at minimum:
- inspect the current settings-page binding model for normal inputs and custom elements
- inspect the Anki deck editor custom element lifecycle
- inspect where runtime/backend consumers currently read Anki configuration
- implement endpoint validation through the visible `ankiUrlButton` test-and-refresh flow and its user-facing success/failure feedback
- ensure Anki configuration survives page reloads/profile switching like other settings
- update neighbouring docs or handoffs only as needed to make this prerequisite relationship explicit

## Non-goals
- no implementation of Anki read-side identity policy itself
- no implementation of `suspended` / `buried` state mapping itself
- no create-and-rate transaction logic
- no popup action gating redesign
- no targeted refresh or stale-state redesign
- no bulk endpoint or parse-time performance redesign
- no full readonly-config policy design beyond what is strictly needed to keep the settings surface honest

## Acceptance criteria
- a user can enable Anki from the visible settings page without hidden debug-only controls
- the Anki settings section becomes reachable in a clean profile through normal UI interaction
- Anki deck/model/field/template configuration loads and saves through the real settings lifecycle
- custom Anki deck-editor interactions remain local to the edited config and do not create hidden cross-config mutation
- changing or validating the Anki endpoint updates dependent Anki configuration controls correctly
- endpoint-related Anki buttons are implemented only when their semantics are real; otherwise they are removed/deferred from the primary UI
- misleading proxy-related controls are no longer presented as live features unless their semantics are real
- Stage 10 and Stage 12 can assume the settings/config surface is trustworthy without inheriting the current wiring debt

## Verification expectations
Verification should include:
- clean-profile enablement of Anki through the visible settings page
- reload/profile-switch confirmation that Anki enablement and Anki deck config persist correctly
- endpoint validation success and invalid-endpoint failure messaging
- dependent refresh of deck/model/field selectors after endpoint changes
- save/reload verification for template-target configuration in the Anki deck editor
- confirmation that deferred/unimplemented proxy controls are no longer misleading

## Handoff to next stage
This stage should leave the product with a trustworthy Anki settings/configuration surface.

Once that is complete, Stage 10 can safely focus on:
- read-side lookup config strategy
- template/card-type matching policy
- surfaced `suspended` / `buried` identity states

And Stage 12 can later rely on:
- real write-target configuration
- stable deck/model/field/template configuration
- a settings surface that does not require hidden/manual workarounds just to exercise the feature
