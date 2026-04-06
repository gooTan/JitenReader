# Implementation Working Log

## Current Snapshot
- Current stage: Stage 3 - Add backend selection infrastructure
- Overall status: Stage 3 complete and verified.
- Active backend behavior: Review operations and parse-time enrichment resolve backend choice through `ReviewBackendSelector`, with Jiten selected as effective backend.
- Last updated: 2026-04-06 22:33:24 +10:00

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
- Current status: Stage 3 closed.
- Next immediate step: Begin Stage 4 preflight (`stage_4_implement_anki_availability_probe_and_preference_switching.md`) without expanding into mapping/write-path logic.

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
- No active blocker for current Stage 2 implementation.

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
- The next model instance should start by reading this log, then:
  - `docs/stage_execution_protocol.md`
  - next target stage document in `docs/stages/`
  - `docs/stages/stage_0_architecture_note.md`
- Resume at the next stage only; do not reopen Stage 3 unless regressions are found.

## Run History
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
