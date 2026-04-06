# Implementation Working Log

## Current Snapshot
- Current stage: Stage 7 - Implement the Mapping Layer and Card Selection Policy
- Overall status: Stage 7 complete and manually validated (mapped/unmapped/ambiguous) with post-validation highlighting regression fix applied.
- Active backend behavior: Anki read-path resolves strict eligible candidates and deterministic target selection; foreground highlighter regression in chunked fragment split bookkeeping has been patched.
- Last updated: 2026-04-07 01:24:20 +10:00

## Architectural Decisions
### Decision: Keep Stage 0 output documentation-only
- Summary: Stage 0 was implemented as read-only reconnaissance with no source behavior changes.
- Rationale: Stage 0 scope and non-goals explicitly prohibit behavior/refactor changes.
- Consequences: Stage 1+ can proceed with lower risk using concrete file-level insertion points.

### Decision: Treat `docs/stages/stage_0_codebase_reconnaissance_and_architecture_map.md` as canonical stage file
- Summary: Used underscore-named stage file because requested hyphen path does not exist in repo.
- Rationale: Required to proceed without inventing alternate stage content.
- Consequences: Future runs should use the canonical underscore path to avoid preflight failures.

### Decision: Create missing master working log file
- Summary: Created `docs/implementation-working-log.md` because it was absent at run start.
- Rationale: Stage execution and persistent log protocols require a canonical on-disk log.
- Consequences: Subsequent stages now have required persistence/handoff baseline.

### Decision: Place Stage 1 review abstraction in background worker boundary
- Summary: Added a `ReviewBackend` interface in `src/background-worker/review-backend/` and kept direct Jiten review requests inside `JitenReviewBackend`.
- Rationale: Stage 1 requires a seam around current Jiten review flow without changing user-visible behaviour.
- Consequences: Background handlers are now backend-agnostic and ready for a second backend.

### Decision: Keep Stage 1 abstraction minimal and operation-focused
- Summary: The initial interface covers only current review operations: grade, refresh card state, forget card, deck action, and capability reporting.
- Rationale: Avoid premature generalization while meeting Stage 1 deliverables.
- Consequences: Future stages can extend interface scope incrementally.

### Decision: Centralize active-backend selection in a dedicated selector service
- Summary: Introduced `ReviewBackendSelector` plus an explicit backend status model (`preferredBackend`, `availability`, `activeBackend`) and routed both parse enrichment and review handlers through it.
- Rationale: Stage 3 requires a named selection point that is separate from backend implementations and reusable by multiple flows.
- Consequences: Stage 4 can add Anki availability probing and preference switching by extending selector probes/status logic without refactoring parser or handlers.

## Completed Work
### 2026-04-06 - Stage 0 Preflight
- Completed:
  - Read `AGENTS.md`.
  - Read `docs/stage_execution_protocol.md`.
  - Read `docs/stages/stage_0_codebase_reconnaissance_and_architecture_map.md`.
  - Verified the expected stage filename variant differs from the prompt path.
  - Identified missing master working log and created this file as canonical log.
- Files changed:
  - `docs/implementation-working-log.md`
- Notes:
  - Stage 0 is read-only for source implementation, but documentation deliverables are expected.

### 2026-04-06 - Stage 0 Reconnaissance and Architecture Map
- Completed:
  - Traced parse pipeline from foreground parser entry through background parse batching and sequence return.
  - Identified exact parse-time status ownership in `background-worker/parser/parser.ts` (`knownState` -> `card.cardState`).
  - Traced popup status flow from highlighted DOM nodes -> registry card cache -> popup render.
  - Traced grading chain from popup/keybind actions -> background command handler -> Jiten review endpoint.
  - Traced post-action status refresh chain via `UpdateCardStateCommand` and broadcast propagation.
  - Audited current Anki plumbing (config schema, request wrappers, settings UI fetch wiring).
  - Delivered architecture note with:
    - file/module map
    - parsing/enrichment/popup/grading/background/Jiten/Anki flow descriptions
    - recommended insertion points for later stages
    - risks/ambiguities list
    - direct answers to Stage 0 key questions
- Files changed:
  - `docs/stages/stage_0_architecture_note.md`
  - `docs/implementation-working-log.md`
- Notes:
  - No source/runtime behavior files in `src/` were modified.

## In Progress
- Task: None.
- Current status: Stage 7 closed.
- Next immediate step: Begin Stage 8 preflight when requested.

## Open Tasks
- [x] Trace page parsing and enrichment ownership in content scripts and background worker.
- [x] Trace popup status data path from parse output to UI render.
- [x] Trace grading command chain to final Jiten request.
- [x] Trace existing Anki configuration/request plumbing.
- [x] Produce Stage 0 architecture note deliverable.
- [x] Begin Stage 1 (`stage_1_extract_jiten_review_backend_abstraction.md`) with adapter boundary at background card-action handlers.
- [x] Add `ReviewBackend` and `JitenReviewBackend`.
- [x] Route review handlers through abstraction (grade, refresh, forget, deck action).
- [x] Verify lint/build in an environment with installed dependencies.

## Known Issues / Blockers
- The path `docs/stages/stage-0-codebase-reconnaissance-and-architecture-map.md` is not present; canonical file is `docs/stages/stage_0_codebase_reconnaissance_and_architecture_map.md`.
- No active blocker for current Stage 7 implementation.

## Verification Status
- Verified:
  - Required preflight docs were read before implementation work.
  - Stage 0 architecture note created: `docs/stages/stage_0_architecture_note.md`.
  - Stage 0 acceptance targets satisfied by direct mapping of:
    - review-state computation owner
    - grade action command chain
    - future insertion points and risks
  - Stage 1 review handlers now call abstraction methods instead of direct Jiten helpers.
  - `JitenReviewBackend` preserves existing Jiten behavior for grade, refresh, forget, and deck actions.
  - Dependencies installed (`npm install`) and lockfile refreshed.
  - `npm run lint` passes.
  - `npm run build` passes.
  - Stage 2 centralization pass:
    - `Parser.vocabToCard()` now delegates review-state mapping to a dedicated enrichment helper.
    - `getCardState()` now reuses the same review-state mapper for post-action refresh updates.
  - Stage 2 popup-consumer pass:
    - popup `cardStateUpdated` handling now only updates when the broadcast matches the currently displayed card.
    - popup remains a consumer of already-enriched `card.cardState` metadata from registry/cache.
  - Post-change checks:
    - `npm run lint` passes.
    - `npm run build` passes.

## Handoff Notes
- Stage 0 and Stage 1 are complete.
- Stage 2 and Stage 3 are complete.
- Stage 4 is complete.
- Stage 5 is complete.
- Stage 6 is complete.
- The next model instance should start by reading this log, then:
  - `docs/stage_execution_protocol.md`
  - next target stage document in `docs/stages/`
  - `docs/stages/stage_6_implement_anki_read_only_backend_shell.md`
- Resume at the next stage only; do not reopen Stage 6 unless regressions are found.
- Stage 7 is now complete (including manual live-Anki validation and highlighting regression hardening).

## Run History
### 2026-04-07 - Stage 7 Follow-up Implementation (Highlighting Regression Fix)
- Completed:
  - Investigated reported symptom where a due-mapped token could coexist with an `unparsed` fragment and confuse visual state interpretation.
  - Identified regression in chunked split flow: when restoring token ownership in `splitMultiTokenFragmentsChunked`, fragment->token map was not restored alongside token->fragment map.
  - Patched `TextHighlighter` to restore both map directions in the `token.start < fragment.start` branch.
  - Applied second hardening patch in the same chunked split flow:
    - when start split is unsafe (`!canSplitFragmentAt`), token ownership is now restored and loop breaks instead of silently dropping the token.
  - Completed post-fix browser re-validation with user:
    - duplicate `unparsed` artifact for `一方` is resolved
    - both `一方` occurrences now render as mapped token elements with consistent due-related classes and IDs.
- Files changed:
  - `src/apps/text-highlighter/text-highlighter.ts`
  - `docs/implementation-working-log.md`
- Architectural decisions made:
  - Keep fix minimal and local to chunked fragment splitting map bookkeeping to avoid changing broader parse/highlight ownership behavior.
- Blockers / open issues:
  - No blocker.
  - Browser re-check remains recommended to confirm the specific duplicate `unparsed` artifact no longer appears on the reported page.
- Verification status:
  - `npm run lint` passes.
  - `npm run build` passes.
  - Stage 7 live manual validation confirmed mapped/unmapped/ambiguous backend resolution paths.
  - Stage 7 live manual verification after highlighter fixes confirms no conflicting `unparsed` wrapper for mapped `一方` terms on the fixture page.
- Next recommended step:
  - Re-parse the Stage 7 fixture page in browser and confirm `一方` occurrences no longer present conflicting `unparsed` wrappers where token mapping exists.
- Handoff:
  - Stage 7 is complete. Next run should begin with Stage 8 preflight unless additional Stage 7 regressions are observed.

### 2026-04-07 - Stage 7 Follow-up Start-of-Run (Highlighting Regression Fix)
- Stage:
  - Stage 7 follow-up hardening (post-implementation regression fix).
- Plan for this run:
  - Investigate reported mismatch where a mapped due term appears as an additional `unparsed` DOM token and does not consistently render expected due styling.
  - Patch highlighter fragment/token bookkeeping so token-owned fragments are not incorrectly left as unparsed leftovers.
  - Verify with lint/build and note browser verification expectations.
- Prerequisite observations:
  - Stage 7 mapping behavior has been manually validated in browser for mapped/unmapped/ambiguous term resolution.
  - The reported symptom appears in foreground rendering/highlighting, not backend Anki mapping selection.
- Risks/assumptions carried in:
  - Risk: touching split/map bookkeeping could regress previous split-boundary hardening behavior.
  - Mitigation: apply targeted fix only to token-fragment map restoration path and verify with lint/build.

### 2026-04-07 - Stage 7 Implementation (Mapping Layer + Card Selection Policy)
- Completed:
  - Extended backend parse-state abstraction to return explicit per-term resolution metadata (state tags + mapping/due/target states + optional target payload) instead of state tags alone.
  - Updated parse enrichment to consume backend-provided mapping resolution and preserve explicit ambiguous/unavailable metadata through `createReviewMetadata`.
  - Implemented first deterministic Anki mapping path in `AnkiReviewBackend`:
    - normalised term keying by spelling + reading
    - note discovery via configured readonly mappings
    - note/card hydration through AnkiConnect `notesInfo` and `cardsInfo`
    - strict eligibility filtering by configured decks/models and template policy
    - deterministic selection policy: auto-select only when exactly one eligible candidate remains
    - explicit ambiguous representation when multiple eligible candidates remain.
  - Added AnkiConnect API typing/endpoints and wrappers for `notesInfo` and `cardsInfo`.
  - Extended unified target metadata to carry Anki target identifiers (`ankiNoteId`, `ankiCardId`, deck/model/template metadata) for later review-write stages.
- Files changed:
  - `src/background-worker/review-backend/review-backend.types.ts`
  - `src/background-worker/review-backend/jiten-review-backend.ts`
  - `src/background-worker/review-backend/anki-review-backend.ts`
  - `src/background-worker/parser/parser.ts`
  - `src/shared/jiten/create-review-metadata.ts`
  - `src/shared/jiten/types.ts`
  - `src/shared/anki/api.types.ts`
  - `src/shared/anki/notes-info.ts`
  - `src/shared/anki/cards-info.ts`
  - `docs/implementation-working-log.md`
- Architectural decisions made:
  - Stage 7 mapping key policy: normalize and map by `(spelling, reading)` term identity, with duplicate term reuse inside a parse batch.
  - Stage 7 eligibility policy: allow only cards whose deck/model is present in configured readonly/mining/blacklist/never-forget config sets.
  - Stage 7 template policy (MVP strict): only template ordinal `0` is eligible for deterministic auto-selection.
  - Stage 7 selection policy: select target only when exactly one eligible candidate exists; otherwise mark term as `ambiguous`.
- Blockers / open issues:
  - No compile/lint blocker.
  - Live-behavior verification against real Anki datasets is still required to validate query strictness and template ordinal assumptions.
  - Automated test harness for backend mapping policy is not yet present in this repository; current verification is lint/build only.
- Verification status:
  - `npm run lint` passes.
  - `npm run build` passes.
- Next recommended step:
  - Execute targeted live Anki verification cases for:
    - missing mapping (0 candidates)
    - deterministic single candidate
    - duplicate/ambiguous candidates.
  - Add regression tests once a test harness for background mapping logic is available.
- Handoff:
  - Stage 7 core mapping/selection implementation is in place. Next run should start by validating real-world mapping correctness and deciding whether template eligibility remains fixed at ordinal `0` or becomes configurable.

### 2026-04-07 - Stage 7 Start-of-Run
- Stage:
  - Stage 7 - Implement the Mapping Layer and Card Selection Policy.
- Plan for this run:
  - Define a strict mapping key policy from parsed Jiten terms to Anki candidate cards.
  - Add eligibility filtering constrained to configured decks / note models / templates.
  - Resolve candidate sets deterministically and derive selected target only when exactly one safe match exists.
  - Populate unified `reviewMetadata` with explicit mapping/selection states that distinguish unmapped, due, not_due, and ambiguous outcomes.
  - Add focused verification coverage for missing mapping, duplicates, and ambiguity cases.
- Prerequisite observations:
  - Stage 6 is complete and already routes parse-time state lookup through backend abstraction with safe fallback to Jiten.
  - Current Anki read-only backend intentionally returns conservative empty review state and does not yet perform deterministic term-to-card mapping.
  - Stage 5 `ReviewMetadata` contract is stable and must remain backward-compatible.
- Risks/assumptions carried in:
  - Risk: incorrect mapping key strategy may produce false-positive card matches; mitigation is strict, explicit key normalization and conservative ambiguity handling.
  - Risk: eligibility filtering drift versus user configuration; mitigation is single filtering path driven by configured decks/models/templates.
  - Assumption: Stage 7 remains read-only for Anki and does not enable review-write operations.

### 2026-04-06 - Stage 6 Implementation (Anki Read-Only Backend Shell)
- Completed:
  - Added `AnkiReviewBackend` shell implementing `ReviewBackend` with:
    - read-only probe path (AnkiConnect `version` + `findNotes`) and short-lived probe cache
    - conservative parse/refresh state output (`[]`) until deterministic mapping is implemented
    - explicit unsupported-operation errors for write paths.
  - Extended backend abstraction with parse-time state provider method (`getParseReviewStates`) and implemented it in `JitenReviewBackend`.
  - Integrated Anki backend registration into service worker backend selector wiring.
  - Updated parse pipeline to:
    - resolve parse-time review states through active backend abstraction
    - fallback safely to Jiten parse states and metadata backend when active backend parse read fails
    - keep `ReviewMetadata` structure unchanged.
  - Added action-handler safety for unsupported Anki writes:
    - grade/forget/deck-action handlers now catch unsupported backend operations and fall back to Jiten.
  - Updated card-state refresh flow to:
    - fallback to Jiten on active-backend refresh failure
    - set `actionsAvailable` from backend capabilities rather than assuming write support.
  - Expanded Anki request wrapper and API typing for safe read-only operations:
    - added `findNotes` endpoint support
    - added optional toast suppression
    - added non-OK response guard.
- Files changed:
  - `src/background-worker/review-backend/anki-review-backend.ts`
  - `src/background-worker/review-backend/review-backend.errors.ts`
  - `src/background-worker/review-backend/review-backend.types.ts`
  - `src/background-worker/review-backend/jiten-review-backend.ts`
  - `src/background-worker/review-backend/review-backend-selector.ts`
  - `src/background-worker/background-worker.ts`
  - `src/background-worker/parser/parser.ts`
  - `src/background-worker/jiten-card-actions/grade-card-command.handler.ts`
  - `src/background-worker/jiten-card-actions/forget-card-command.handler.ts`
  - `src/background-worker/jiten-card-actions/run-deck-action-command.handler.ts`
  - `src/background-worker/jiten-card-actions/update-card-state-command.handler.ts`
  - `src/shared/anki/api.types.ts`
  - `src/shared/anki/request.ts`
  - `src/shared/anki/find-notes.ts`
  - `docs/implementation-working-log.md`
- Architectural decisions made:
  - Keep Stage 6 Anki integration strictly read-only by design; unsupported write operations are explicit and recoverable.
  - Move parse-time review-state sourcing behind backend abstraction (`getParseReviewStates`) to validate multi-backend participation without introducing mapping complexity.
  - Preserve Stage 5 metadata contract; use conservative empty Anki state payloads to represent unmapped/unknown state safely.
  - Prefer runtime fallback to Jiten for operation continuity when Anki read/write paths are not usable.
- Blockers / open issues:
  - No active blocker for Stage 6 closure.
  - Deterministic Jiten-term -> Anki-card mapping remains intentionally deferred to next stage.
- Verification status:
  - `npm run lint` passes.
  - `npm run build` passes.
- Next recommended step:
  - Start Stage 7 and implement deterministic mapping/target selection from parsed terms to eligible Anki cards.
- Handoff:
  - Stage 6 is complete. Next run should begin Stage 7 preflight and treat Stage 6 backend shell + fallback behavior as baseline.

### 2026-04-06 - Stage 6 Start-of-Run
- Stage:
  - Stage 6 - Implement the Anki read-only backend shell.
- Plan for this run:
  - Add an `AnkiReviewBackend` shell that satisfies the existing backend abstraction while keeping write operations safely unsupported.
  - Extend internal Anki request plumbing only as needed for read-only backend participation in parse/enrichment.
  - Integrate constrained Anki enrichment path so unified `reviewMetadata` can be populated from Anki-originated context without changing the Stage 5 contract.
  - Ensure robust fallback/error handling so Anki read failures do not break parse flow or popup rendering.
  - Verify with `npm run lint` and `npm run build`.
- Prerequisite observations:
  - Stage 5 is complete and `ReviewMetadata` is now the stable internal contract across parse/refresh/popup flows.
  - Stage 4 already provides selector-based backend preference with cached Anki availability probing and deterministic fallback behavior.
  - Current review action handlers are selector-routed and backend-agnostic, enabling insertion of an Anki backend implementation.
- Risks/assumptions carried in:
  - Risk: introducing an Anki backend object with unsupported write paths may accidentally alter review action behavior; mitigation is explicit safe guards and unchanged fallback semantics.
  - Risk: partial Anki state hydration could produce inconsistent UI state; mitigation is to emit structurally valid `ReviewMetadata` with conservative defaults.
  - Assumption: this stage remains read-only for Anki integration and defers deterministic term-to-card mapping complexity to the next stage.

### 2026-04-06 - Post-Stage 5 Regression Fix (TextHighlighter Split Guard)
- Completed:
  - Investigated browser-reported runtime error:
    - `IndexSizeError: Failed to execute 'splitText' on 'Text'` in `TextHighlighter.splitFragmentsNode`.
  - Added defensive split-boundary guards to avoid invalid split offsets after fragment mutation/rebuild drift.
  - Applied guards in:
    - `cutoffTokenEnd`
    - `adjustFragmentEnds`
    - `adjustFragmentStarts`
    - `splitMultiTokenFragmentsChunked`
  - Added helper `canSplitFragmentAt` and fallback `fixFragmentParameters` path when a split is not safe.
- Files changed:
  - `src/apps/text-highlighter/text-highlighter.ts`
  - `docs/implementation-working-log.md`
- Architectural decisions made:
  - Prefer graceful no-op on invalid fragment split boundaries over throwing and aborting parse/highlight pipeline.
  - Keep correction local to TextHighlighter split operations without changing Stage 5 review-metadata contract.
- Blockers / open issues:
  - No active blocker.
  - Requires browser re-check on the previously failing page to confirm runtime stack trace is resolved.
- Verification status:
  - `npm run lint` passes.
  - `npm run build` passes.
- Next recommended step:
  - Re-test the exact page/action sequence that triggered `splitText` offset error and confirm no console exception.
- Handoff:
  - Stage 5 remains complete; this run adds a targeted post-stage runtime hardening fix in highlighter splitting.

### 2026-04-06 - Stage 5 Implementation (Unified Review Metadata Model)
- Completed:
  - Added a backend-neutral `ReviewMetadata` contract to `JitenCard` with explicit backend, mapping, due, target, freshness, action-availability, and normalized state tags.
  - Added shared adapter `createReviewMetadata` and applied it in:
    - parse/enrichment path (`freshness: 'stale'`)
    - post-review refresh broadcast path (`freshness: 'fresh'`).
  - Updated broadcast payload shape for `cardStateUpdated` from raw `JitenCardState[]` to `ReviewMetadata`.
  - Updated foreground registry update path to store both `reviewMetadata` and legacy `cardState` tags for existing class-based consumers.
  - Updated popup rendering/state checks to consume `reviewMetadata.stateTags` as primary source.
  - Updated optimistic mining-cycle foreground updates to preserve/advance review metadata state.
  - Added Stage 5 contract note documenting field meanings and ownership.
- Files changed:
  - `src/shared/jiten/types.ts`
  - `src/shared/jiten/create-review-metadata.ts`
  - `src/background-worker/parser/parser.ts`
  - `src/background-worker/jiten-card-actions/update-card-state-command.handler.ts`
  - `src/shared/messages/broadcast/card-state-updated.command.ts`
  - `src/shared/messages/types/broadcast.ts`
  - `src/apps/integration/registry.ts`
  - `src/apps/ajb.ts`
  - `src/apps/popup/popup.ts`
  - `src/apps/popup/actions/mining-actions.ts`
  - `docs/stages/stage_5_review_metadata_contract.md`
  - `docs/implementation-working-log.md`
- Architectural decisions made:
  - Keep `cardState` on `JitenCard` as compatibility tags while introducing `reviewMetadata` as the canonical cross-backend contract.
  - Make parse and refresh paths explicit metadata owners via `freshness` transitions (`stale` -> `fresh`).
  - Keep popup consumers backend-neutral by reading only normalized metadata tags for rendering.
- Blockers / open issues:
  - No blocker for Stage 5 closure.
  - Some non-popup consumers (e.g. status/highlighter internals) still read compatibility `cardState`, intentionally deferred beyond Stage 5 scope.
- Verification status:
  - `npm run lint` passes.
  - `npm run build` passes.
- Next recommended step:
  - Start Stage 6 and populate this same metadata model from a minimal Anki read path without changing popup contract again.
- Handoff:
  - Stage 5 complete. Next run should treat `ReviewMetadata` as the stable internal contract and avoid redesigning popup state shape.

### 2026-04-06 - Stage 5 Start-of-Run
- Stage:
  - Stage 5 - Design unified review metadata model.
- Plan for this run:
  - Define a backend-neutral term-level review metadata type that encodes backend source, mapping state, due state, target metadata, freshness, and action availability.
  - Adapt current Jiten-enriched parse output to populate this model without changing user-visible review behavior.
  - Update popup consumers to render from unified metadata rather than backend-specific assumptions.
  - Add concise in-repo documentation for field ownership and meaning.
  - Verify with `npm run lint` and `npm run build`.
- Prerequisite observations:
  - Stage 4 is complete with selector-owned backend preference and Anki availability probing/caching.
  - Parse-enriched cards already include backend identity (`reviewBackend`) and current `cardState` metadata from Jiten paths.
  - Stage 5 non-goals explicitly exclude Anki due lookup and write-path implementation.
- Risks/assumptions carried in:
  - Risk: model churn can break popup assumptions if migration is partial; mitigation is single-contract shared type plus end-to-end wiring in one pass.
  - Risk: overfitting model to Jiten semantics; mitigation is explicit mapping/due/freshness enums that remain backend-neutral.
  - Assumption: existing Stage 4 selector status and parse ownership remain unchanged and should only feed the new model.

### 2026-04-06 - Stage 4 Implementation (Anki Availability Probe + Preference Switching)
- Completed:
  - Added concrete Anki reachability probe (`probeAnkiAvailability`) using AnkiConnect API version checks with graceful failure-to-unavailable behavior.
  - Extended `ReviewBackendSelector` with short-lived availability cache (TTL), in-flight probe deduplication, and explicit cache invalidation API.
  - Updated selector resolution so parse-cycle backend status prefers Anki when configured and available, otherwise falls back to Jiten.
  - Wired probe and cache invalidation into service worker composition:
    - probe injected at selector construction
    - cache invalidated on `profileSwitched` and `configurationUpdated`.
  - Extended parse-enriched card metadata to record selected backend via `JitenCard.reviewBackend`.
- Files changed:
  - `src/background-worker/review-backend/anki-availability-probe.ts`
  - `src/background-worker/review-backend/review-backend-selector.ts`
  - `src/background-worker/background-worker.ts`
  - `src/background-worker/parser/parser.ts`
  - `src/shared/jiten/types.ts`
  - `docs/implementation-working-log.md`
- Architectural decisions made:
  - Availability probing is selector-owned and cached in the background layer to avoid repeated checks outside parse cycles.
  - Selector backend preference remains configuration-driven (`enableAnkiIntegration`) with deterministic Jiten fallback.
  - Parse enrichment is the source of truth for "which backend enriched this card" via explicit card metadata.
- Blockers / open issues:
  - No blocker for Stage 4 closure.
  - Anki card-state mapping and review submission remain intentionally out of scope for this stage.
- Verification status:
  - `npm run lint` passes.
  - `npm run build` passes.
- Next recommended step:
  - Start Stage 5 and introduce a backend-agnostic review metadata model consumed by popup/actions.
- Handoff:
  - Stage 4 is complete. Next run should begin with Stage 5 preflight and keep Stage 4 selector/probe behavior intact.

### 2026-04-06 - Stage 4 Start-of-Run
- Stage:
  - Stage 4 - Implement Anki availability probe and preference switching.
- Plan for this run:
  - Implement a concrete Anki availability probe in backend-selection logic.
  - Add short-lived caching/invalidation so availability checks are reused during parse windows.
  - Update selector preference resolution to choose Anki when healthy and safely fall back to Jiten.
  - Ensure parse/enrichment metadata records the active backend selected for the cycle.
  - Verify with lint/build after implementation.
- Prerequisite observations:
  - Stage 3 is complete and already introduced `ReviewBackendSelector` plus backend status model and parse integration seam.
  - Current effective behavior remains Jiten fallback/default until real Anki probe logic is added.
  - Stage 4 non-goals exclude Anki card mapping, due-state lookup, and review submission.
- Risks/assumptions carried in:
  - Risk: over-probing Anki could impact parse responsiveness; mitigation is short-lived availability caching.
  - Risk: leaking preference checks into popup/consumer paths; mitigation is parse-cycle selector ownership only.
  - Assumption: existing Anki request plumbing can be reused to establish reachability without adding new review-path behavior.

### 2026-04-06 - Stage 3 Implementation (Backend Selection Infrastructure + Closure)
- Completed:
  - Added backend selection status model in `review-backend-selector.types.ts` with explicit preferred/availability/active fields.
  - Added `ReviewBackendSelector` service to resolve preferred backend, backend availability (with probe scaffolding), active backend selection, and active backend implementation.
  - Wired `ReviewBackendSelector` into parse-time enrichment path:
    - `ParseController` now receives selector dependency.
    - `Parser` now requests selector status per parse batch and enriches card review state based on active backend context.
  - Routed background review action handlers through selector-resolved active backend:
    - grade card
    - refresh card state
    - forget card
    - deck action
  - Updated service-worker composition (`background-worker.ts`) to instantiate one selector with Jiten backend registered as current implementation.
- Files changed:
  - `src/background-worker/review-backend/review-backend-selector.types.ts`
  - `src/background-worker/review-backend/review-backend-selector.ts`
  - `src/background-worker/background-worker.ts`
  - `src/background-worker/parser/parse.controller.ts`
  - `src/background-worker/parser/parser.ts`
  - `src/background-worker/jiten-card-actions/grade-card-command.handler.ts`
  - `src/background-worker/jiten-card-actions/update-card-state-command.handler.ts`
  - `src/background-worker/jiten-card-actions/forget-card-command.handler.ts`
  - `src/background-worker/jiten-card-actions/run-deck-action-command.handler.ts`
  - `docs/implementation-working-log.md`
- Architectural decisions made:
  - Keep selector-level backend choice resolution independent from concrete backend classes.
  - Preserve Jiten as deterministic fallback active backend when preferred backend is unavailable or unimplemented.
  - Expose probe hooks in selector for later availability checks without enabling Anki behavior in Stage 3.
- Blockers / open issues:
  - No blocker for Stage 3 completion.
  - Follow-up intentionally deferred to Stage 4: implement concrete Anki availability probe and preference-driven activation path.
- Verification status:
  - `npm run lint` passes.
  - `npm run build` passes.
- Next recommended step:
  - Start Stage 4 and implement concrete availability probing plus preference switching using existing selector model and probe scaffold.
- Handoff:
  - Stage 3 is complete. Next run should perform Stage 4 preflight and continue from selector availability logic only.

### 2026-04-06 - Stage 3 Start-of-Run
- Stage:
  - Stage 3 - Add backend selection infrastructure.
- Plan for this run:
  - Introduce an internal backend status model that represents active backend and optional backend availability/preference metadata.
  - Add a dedicated backend selector module/service in the background worker layer, separate from concrete backend implementation details.
  - Integrate parse/enrichment flow with the selector so parse-time logic can ask which backend is active.
  - Keep Jiten as the effective backend for behavior parity and leave explicit scaffolding points for later Anki availability logic.
  - Verify with lint/build after implementation changes.
- Prerequisite observations:
  - Stage 2 is complete and verified; parse/enrichment ownership of review state is already centralized as baseline.
  - Existing review backend abstraction (`ReviewBackend` + `JitenReviewBackend`) provides a stable implementation seam for selector introduction.
  - Stage 3 scope explicitly excludes Anki lookup/write/mapping logic and UI behavior changes.
- Risks/assumptions carried in:
  - Risk: coupling selector logic too tightly to parser internals; mitigation is a dedicated selector module with narrow interface.
  - Risk: unintended behavior drift if active backend default is not explicit; mitigation is deterministic Jiten-first fallback.
  - Assumption: parse/enrichment currently depends on Jiten-shaped review metadata and must remain stable in this stage.

### 2026-04-06 - Stage 2 Implementation (Popup Consumer Guard + Stage Closure)
- Completed:
  - Audited popup/controller status ownership paths after centralization pass.
  - Updated `src/apps/popup/popup.ts` `cardStateUpdated` listener so popup only reacts when the update targets the currently displayed card.
  - Confirmed popup continues to render directly from registry-enriched `card.cardState`, with no first-pass due-state recomputation in popup rendering.
  - Completed Stage 2 acceptance verification and closed stage.
- Files changed:
  - `src/apps/popup/popup.ts`
  - `docs/implementation-working-log.md`
- Architectural decisions made:
  - Keep broadcast-driven refresh behavior but scope popup updates to current card identity to preserve consumer-only ownership boundaries.
- Blockers / open issues:
  - None identified for Stage 2 closure.
- Verification status:
  - `npm run lint` passes.
  - `npm run build` passes.
- Next recommended step:
  - Start Stage 3 with required preflight and keep Stage 2 data-path as baseline.
- Handoff:
  - Stage 2 closed. Next run should begin at Stage 3 preflight.

### 2026-04-06 - Stage 2 Implementation (Review-State Enrichment Centralization Pass)
- Completed:
  - Added `src/shared/jiten/map-review-states.ts` as a single mapper from raw Jiten numeric state arrays to `JitenCardState[]`.
  - Refactored parse-time enrichment in `src/background-worker/parser/parser.ts`:
    - extracted `enrichCardReviewState()` to make parse ownership explicit
    - replaced inline `knownState` mapping with shared mapper usage.
  - Refactored `src/shared/jiten/get-card-state.ts` to use the same shared mapper, removing duplicated state-map logic.
  - Verified no behavior regression in build/lint checks.
- Files changed:
  - `src/shared/jiten/map-review-states.ts`
  - `src/background-worker/parser/parser.ts`
  - `src/shared/jiten/get-card-state.ts`
  - `docs/implementation-working-log.md`
- Architectural decisions made:
  - Centralize Jiten raw-state -> `JitenCardState[]` mapping in one shared helper to keep parse enrichment and refresh paths aligned.
  - Keep parse-time fallback semantics unchanged (`mature` for parse-enriched cards) while preserving refresh fallback semantics (`new` for lookup refresh).
- Blockers / open issues:
  - No technical blocker found in this pass.
  - Stage-level follow-up remains: confirm all popup/controller paths are strictly consumers of enriched state and do not reintroduce ownership logic.
- Verification status:
  - `npm run lint` passes.
  - `npm run build` passes.
- Next recommended step:
  - Audit popup/controller state derivation paths for final Stage 2 acceptance and then close the stage.
- Handoff:
  - Continue Stage 2 from popup/controller ownership validation; mapping centralization is complete.

### 2026-04-06 - Stage 2 Start-of-Run
- Stage:
  - Stage 2 - Move review-status ownership to the parse / enrichment pipeline.
- Plan for this run:
  - Reconfirm the exact parse/enrichment attachment point where term-level `cardState` is set.
  - Identify popup/controller code paths that still perform first-pass due-state ownership logic.
  - Refactor data flow so popup reads enriched review metadata as primary source and no longer owns first-pass due-state computation.
  - Preserve user-visible Jiten behavior and verify via lint/build and targeted flow checks.
- Prerequisite observations:
  - Stage 0 architecture map identified parse-time status attachment in background parser flow.
  - Stage 1 review backend abstraction is complete and verified, providing a stable seam for unchanged review actions.
  - No active blocker is recorded for Stage 2 start.
- Risks/assumptions carried in:
  - Risk: accidental behavior drift in popup rendering if fallback logic is removed too aggressively.
  - Risk: hidden status dependencies outside popup rendering path.
  - Assumption: parse-enriched `JitenCard.cardState` remains authoritative for first-pass status display.

### 2026-04-06 - Stage 1 Start-of-Run
- Stage:
  - Stage 1 - Extract current Jiten review flow behind an internal abstraction.
- Plan for this run:
  - Identify all current review-state lookup, grade submission, and post-review refresh call sites.
  - Introduce a minimal internal review backend interface in background-layer integration code.
  - Implement `JitenReviewBackend` by moving existing Jiten-backed behaviour behind the interface.
  - Refactor high-level handlers/controllers to use the abstraction and remove direct Jiten review calls at those levels.
  - Verify behaviour parity via targeted code-path checks and available lint/tests.
- Prerequisite observations:
  - Stage 0 is complete and provides insertion points for background card-action handlers and review-state flow.
  - No unresolved technical blocker from Stage 0 remains.
- Risks/assumptions carried in:
  - Risk: accidentally broadening abstraction scope beyond Stage 1; mitigation is strict boundary to existing review operations only.
  - Assumption: current review behaviour must remain byte-for-byte equivalent from a user perspective, including popup-visible card-state updates.

### 2026-04-06 - Stage 1 Implementation (Backend Abstraction Pass)
- Completed:
  - Added a new review backend interface and stage-local types.
  - Implemented `JitenReviewBackend` to encapsulate current Jiten review operations.
  - Refactored all background review handlers to depend on `ReviewBackend`:
    - grade
    - update card state
    - forget card
    - run deck action
  - Injected one `JitenReviewBackend` instance from `background-worker.ts` into all review handlers.
- Files changed:
  - `src/background-worker/review-backend/review-backend.types.ts`
  - `src/background-worker/review-backend/jiten-review-backend.ts`
  - `src/background-worker/jiten-card-actions/grade-card-command.handler.ts`
  - `src/background-worker/jiten-card-actions/update-card-state-command.handler.ts`
  - `src/background-worker/jiten-card-actions/forget-card-command.handler.ts`
  - `src/background-worker/jiten-card-actions/run-deck-action-command.handler.ts`
  - `src/background-worker/background-worker.ts`
  - `docs/implementation-working-log.md`
- Architectural decisions made:
  - Keep the abstraction boundary in background handlers for Stage 1.
  - Keep interface surface minimal and mapped to existing responsibilities.
- Blockers / open issues:
  - Automated lint verification is blocked in this environment because `eslint` is not installed.
- Verification status:
  - Static parity review completed on modified command paths.
  - `npm run lint` attempted and failed due to missing dependency tooling.
- Next recommended step:
  - Install dependencies and run `npm run lint`, then run a build to confirm Stage 1 closes cleanly.
- Handoff:
  - Resume at verification and acceptance check for Stage 1; no further scope expansion should occur until Stage 1 is confirmed.

### 2026-04-06 - Stage 1 Verification and Closure
- Completed:
  - Installed project dependencies with network-enabled `npm install`.
  - Ran `npm run lint:fix` to resolve formatting/import-order issues.
  - Re-ran verification commands and confirmed:
    - `npm run lint` passes.
    - `npm run build` passes.
- Files changed:
  - `package-lock.json`
  - `src/apps/parser/custom-parsers/ttsu.parser.ts`
  - `src/background-worker/background-worker.ts`
  - `src/background-worker/jiten-card-actions/forget-card-command.handler.ts`
  - `src/background-worker/jiten-card-actions/grade-card-command.handler.ts`
  - `src/background-worker/jiten-card-actions/run-deck-action-command.handler.ts`
  - `src/background-worker/jiten-card-actions/update-card-state-command.handler.ts`
  - `src/background-worker/review-backend/review-backend.types.ts`
  - `src/background-worker/review-backend/jiten-review-backend.ts`
  - `docs/implementation-working-log.md`
- Architectural decisions made:
  - No additional architectural change; verification-only closure.
- Blockers / open issues:
  - None for Stage 1.
- Verification status:
  - Stage 1 acceptance checks satisfied in current environment.
- Next recommended step:
  - Start Stage 2 preflight and maintain Stage 1 abstraction seam as baseline.
- Handoff:
  - Stage 1 is closed. Next run should treat this stage as complete and avoid reopening unless regressions are found.
