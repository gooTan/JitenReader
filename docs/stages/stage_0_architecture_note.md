# Stage 0 Architecture Note

## Overview
This note captures the current (pre-refactor) ownership boundaries for parse-time status enrichment, popup rendering, grading, and background command execution.

The current implementation is Jiten-first end-to-end:
- parse-time review status is produced from Jiten parse payload `knownState`
- popup reads card status from foreground `Registry` cache keyed by `wordId/readingIndex`
- grading sends Jiten review ratings via background handler

## File / Module Map (Relevant to Review Status Flow)
- Foreground entry and orchestration
  - `src/apps/ajb.ts`
  - `src/apps/integration/registry.ts`
  - `src/apps/integration/word-event-delegator.ts`
  - `src/apps/sequence/sequence-manager.ts`
- Foreground parse pipeline
  - `src/apps/parser/base.parser.ts`
  - `src/apps/batches/batch-controller.ts`
  - `src/apps/batches/get-paragraphs.ts`
  - `src/apps/paragraph-reader/paragraph-reader.ts`
  - `src/apps/text-highlighter/text-highlighter.ts`
- Popup / action controllers
  - `src/apps/popup/popup-manager.ts`
  - `src/apps/popup/popup.ts`
  - `src/apps/popup/actions/base-controller.ts`
  - `src/apps/popup/actions/grading-controller.ts`
  - `src/apps/popup/actions/grading-actions.ts`
- Background parse / command handling
  - `src/background-worker/background-worker.ts`
  - `src/background-worker/lib/background-command-handler-collection.ts`
  - `src/background-worker/parser/parse-command.handler.ts`
  - `src/background-worker/parser/parse.controller.ts`
  - `src/background-worker/parser/parser.ts`
  - `src/background-worker/jiten-card-actions/grade-card-command.handler.ts`
  - `src/background-worker/jiten-card-actions/update-card-state-command.handler.ts`
- Shared API wrappers and message contracts
  - `src/shared/jiten/parse.ts`
  - `src/shared/jiten/review.ts`
  - `src/shared/jiten/get-card-state.ts`
  - `src/shared/jiten/request.ts`
  - `src/shared/jiten/request-by-url.ts`
  - `src/shared/jiten/types.ts`
  - `src/shared/messages/background/grade-card.command.ts`
  - `src/shared/messages/background/parse.command.ts`
  - `src/shared/messages/foreground/sequence-success.command.ts`
  - `src/shared/messages/broadcast/card-state-updated.command.ts`
- Anki plumbing currently present
  - `src/shared/anki/request.ts`
  - `src/shared/anki/get-api-version.ts`
  - `src/shared/anki/get-decks.ts`
  - `src/shared/anki/get-models.ts`
  - `src/shared/anki/get-fields.ts`
  - `src/shared/configuration/types.ts`
  - `src/shared/configuration/default-configuration.ts`
  - `src/views/elements/html-mining-input-element.ts`
  - `src/views/settings.html`

## Parsing Flow (Current State)
1. Parser entry (`BaseParser.parseNodes`) registers DOM nodes with `BatchController`.
2. `BatchController.registerNode` uses `getParagraphs` / `ParagraphReader` to produce paragraph fragments with offsets.
3. `BatchController.parseBatches` serializes each paragraph to `[sequenceId, text]` and sends `ParseCommand` to background.
4. `ParseCommandHandler` validates `jitenApiKey`, injects word styles, forwards work to `ParseController`.
5. `ParseController` batches queued paragraphs and runs `Parser(batch).parse()` through `WorkerQueue`.
6. Background `Parser.parse()` calls shared `parse()` (`reader/parse`) and gets `{ tokens, vocabulary }`.
7. `Parser.vocabToCard()` maps `knownState` numeric values into `card.cardState` string states.
8. `Parser.parseTokens()` attaches the resolved `card` to each token and enriches pitch/ruby/sentence fields.
9. `ParseController` returns enriched tokens to foreground via `SequenceSuccessCommand`.
10. Foreground `SequenceManager` resolves pending sequence promises used by `BatchController.prepareBatches`.
11. `BatchController` applies tokens via `TextHighlighter.apply()`.

## Enrichment Flow (Current State)
1. Enrichment ownership is concentrated in `src/background-worker/parser/parser.ts`:
  - `knownState` -> `card.cardState` mapping in `vocabToCard()`
  - token-card join in `parseTokens()`
  - token sentence assignment in `addSentenceInfo()`
2. `TextHighlighter.patchElement()` consumes enriched token/card data and mutates DOM:
  - adds `jiten-word` and card-state classes
  - writes `wordId` / `readingIndex` attributes
  - stores card in `Registry.addCard(card, element, conjugations)`
  - stores sentence via `Registry.wordEventDelegator.setSentence()`
3. Popup does not consume parse result directly; it consumes registry/DOM identifiers produced by the highlighter.

## Popup Flow (Current State)
1. Hover/click/touch events are delegated in `WordEventDelegator`.
2. `WordEventDelegator` identifies `.jiten-word[wordId]` nodes and forwards to `PopupManager.enter/touch/longPress`.
3. `Popup.show(context)` resolves card via `Registry.getCardFromElement(context)` and conjugations via `Registry.getConjugations(context)`.
4. Popup UI renders from `JitenCard`:
  - header/state badges from `card.cardState`
  - frequency/pitch/meanings from card fields
5. On `cardStateUpdated` broadcast, popup re-reads card from registry and rerenders.

## Grading Flow (Current State)
1. User triggers grade from popup buttons (`Popup.updateGradingButtons`) or keybinds (`GradingActions`).
2. `GradingController.gradeCard(card, rating)` sends `GradeCardCommand(wordId, readingIndex, rating)`.
3. Background `GradeCardCommandHandler` calls shared `review(rating, wordId, readingIndex)`.
4. `review()` calls Jiten endpoint `srs/review`.
5. After grading command callback in foreground, `BaseController.updateCardState()` sends `UpdateCardStateCommand`.
6. Background `UpdateCardStateCommandHandler` calls `getCardState()` (`reader/lookup-vocabulary`) and broadcasts `CardStateUpdatedCommand`.
7. Foreground `AJB` handler updates registry card + DOM classes via `Registry.updateCard`.

## Background Command Flow (Current State)
1. `BackgroundCommand.send/call` posts message with `command` name.
2. `BackgroundCommandHandlerCollection.listen()` resolves handler by command name and executes.
3. Relevant review-state commands:
  - `parse` -> `ParseCommandHandler`
  - `gradeCard` -> `GradeCardCommandHandler`
  - `updateCardState` -> `UpdateCardStateCommandHandler`
  - `runDeckAction` -> `RunDeckActionCommandHandler`
  - `forgetCard` -> `ForgetCardCommandHandler`

## Jiten API Flow (Current State)
- Parse-time:
  - `Parser.parse()` -> `shared/jiten/parse.ts` -> `request('reader/parse', ...)`
- Grade-time:
  - `GradeCardCommandHandler` -> `shared/jiten/review.ts` -> `request('srs/review', ...)`
- Refresh status:
  - `UpdateCardStateCommandHandler` -> `shared/jiten/get-card-state.ts` -> `request('reader/lookup-vocabulary', ...)`
- Jiten request transport:
  - `shared/jiten/request.ts` resolves `jitenApiEndpoint`
  - `shared/jiten/request-by-url.ts` resolves API token and performs POST

## Current Anki Plumbing
1. Config schema already defines Anki integration fields (`enableAnkiIntegration`, `ankiUrl`, deck configs, readonly configs).
2. Anki request client exists (`shared/anki/request.ts`) with wrappers for version/decks/models/fields.
3. Settings UI wiring exists for Anki deck/model/field selection (`html-mining-input-element.ts`, `settings.html`).
4. No active parse-time or grading-time backend switch currently uses Anki; runtime review/status flows remain Jiten-owned.

## Caching / State Reuse Relevant to Word Status
- Foreground card cache:
  - `Registry.cards: Map<string, JitenCard>` keyed by `wordId/readingIndex`
- DOM as status mirror:
  - card states also represented as CSS classes on `.jiten-word`
- Sentence-level derived state:
  - `SentenceManager` maps cards/elements/sentences and recomputes i+1 markers on state changes
- Parse request tracking:
  - `SequenceManager._requests` and `ParseController._pendingParagraphs` store in-flight sequence state
- Configuration cache:
  - `getConfiguration` caches active profile id (not card status, but affects backend/config reads)

## Recommended Seams for Later Stages
1. Backend abstraction seam (review actions):
  - Primary insertion: background `jiten-card-actions` handlers (`grade-card`, `run-deck-action`, `forget-card`, `update-card-state`)
  - Replace direct `shared/jiten/*` calls with provider interface adapter.
2. Parse-time enrichment seam:
  - Primary insertion: `src/background-worker/parser/parser.ts` between raw parse response and final `JitenToken` assembly.
  - Extract status enrichment from `knownState` mapping into backend-neutral enrichment service.
3. Shared metadata seam for popup:
  - Primary insertion: `src/shared/jiten/types.ts` (or successor review metadata types), then propagate through:
    - `Parser.parseTokens()`
    - `TextHighlighter.patchElement()`
    - `Registry.addCard/getCardFromElement`
    - `Popup` render path
4. Backend selection seam at parse-time:
  - Candidate decision point: `ParseCommandHandler.handle()` or `ParseController.parseSequences()` where per-request configuration can be loaded once and applied to batch parse/enrichment pipeline.
5. Card state refresh seam:
  - `UpdateCardStateCommandHandler` should become backend-aware and emit normalized status updates through existing `CardStateUpdatedCommand`.

## Risks / Ambiguities
1. Review ownership is split across:
  - parse-time initial state (`Parser.vocabToCard`)
  - post-action refresh (`UpdateCardStateCommandHandler`)
  This can drift without a unified metadata model.
2. DOM classes and registry cache are both status sources; divergence is possible if one path updates without the other.
3. `JitenCard` naming is backend-specific but used deeply by popup/highlighter/status-bar; replacing it requires a staged compatibility layer.
4. `RotationController.getCurrentCardState()` currently returns `undefined` (stub-like behavior), indicating possible incomplete state logic that may complicate backend-neutral rotation semantics.
5. Parse batching and enrichment are tightly coupled in `background-worker/parser/parser.ts`; large refactors here risk throughput regressions if not split carefully.

## Answers to Stage 0 Key Questions
1. Where is word review status determined during page parsing?
  - In `src/background-worker/parser/parser.ts` (`vocabToCard` mapping `knownState` -> `card.cardState`).
2. What data structure carries parsed term status into the popup?
  - `JitenToken.card` / `JitenCard.cardState`, then foreground `Registry.cards` keyed by `wordId/readingIndex`, referenced from DOM attributes on `.jiten-word`.
3. Which controller/action chain grades a card today?
  - `Popup/GradingActions` -> `GradingController.gradeCard()` -> `GradeCardCommand` -> `GradeCardCommandHandler` -> `shared/jiten/review.ts`.
4. Which background handler sends the Jiten review request?
  - `src/background-worker/jiten-card-actions/grade-card-command.handler.ts`.
5. Cleanest insertion point for backend abstraction?
  - Background card-action handlers (`grade`, `update-card-state`, deck actions, forget) as first adapter boundary.
6. Cleanest insertion point for parse-time backend selection?
  - Parse pipeline entry around `ParseCommandHandler`/`ParseController`, with enrichment delegation in `background-worker/parser/parser.ts`.
7. What must change for popup to consume backend-neutral enriched metadata?
  - Introduce backend-neutral review metadata types, update parser enrichment output, update registry storage contract, and decouple popup rendering from Jiten-specific card semantics.
