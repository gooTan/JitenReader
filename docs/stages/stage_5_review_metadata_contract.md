# Stage 5 Review Metadata Contract

## Owner and lifecycle
- Parse/enrichment (background parser) creates initial `reviewMetadata` on each `JitenCard` with `freshness: 'stale'`.
- Post-review refresh (`updateCardState` flow) replaces `reviewMetadata` with `freshness: 'fresh'`.
- Foreground popup and related UI consumers read this metadata and do not infer backend-specific state.

## Model
`ReviewMetadata` fields:
- `backend`: backend identity used for enrichment (`'jiten' | 'anki'`).
- `mappingState`: whether the term is mapped (`mapped | unmapped | ambiguous`).
- `dueState`: due signal independent of backend internals (`due | notDue | unavailable | unknown`).
- `targetState`: status of selected review target (`selected | none | ambiguous`).
- `target`: selected target metadata when available (`key`, `wordId`, `readingIndex`).
- `freshness`: recency marker for parse snapshot vs refreshed state (`stale | fresh | unknown`).
- `actionsAvailable`: whether review actions are currently available for the mapped term.
- `stateTags`: normalized tag list used by existing UI class-based rendering.

## Jiten adapter rules (Stage 5)
- `stateTags` comes from existing Jiten `cardState` mapping.
- `mappingState` is `mapped` when `stateTags` is non-empty; otherwise `unmapped`.
- `dueState` is `due` when `stateTags` contains `due`, else `notDue` for mapped cards.
- `target` points to the current word/reading identity.
- Parse path sets `freshness: 'stale'`; refresh path sets `freshness: 'fresh'`.
