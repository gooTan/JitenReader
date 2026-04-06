# Stage 2 — Move Review-Status Ownership to the Parse / Enrichment Pipeline

## Objective
Ensure that word review status is attached during page parsing / term enrichment rather than being popup-owned.

## Why this stage exists
The architecture must match how JitenReader actually works. Since word status is determined when the page is parsed, the popup should not be the primary owner of due-state computation. This stage corrects that ownership boundary.

## Scope
Codex should:
- identify the exact parse/enrichment point where word review status is attached
- centralize review-state attachment there
- ensure the popup reads precomputed enriched review status instead of recomputing primary due state itself
- preserve current Jiten behavior while moving state ownership upstream

## Desired end state
After this stage:
- page parsing / enrichment owns review-status attachment
- popup consumes enriched review metadata
- popup no longer acts like the main owner of due-state determination

## Deliverables
- parse-time review enrichment path clearly defined in code
- enriched term-level review metadata available to popup consumers
- popup/controller code updated to consume enriched review state
- verification that current Jiten-driven behavior still works

## Suggested implementation focus
- keep the data flow explicit
- avoid introducing Anki-specific metadata yet if not necessary
- prioritize clarity of ownership over new functionality

## Non-goals
- no backend selection yet
- no Anki integration yet
- no mapping layer
- no custom add-on work
- no major UI redesign

## Acceptance criteria
- review status used by the popup originates from the parse/enrichment stage
- popup rendering does not independently own first-pass due-state computation
- existing Jiten functionality still works from user perspective
- later stages can attach backend-specific review metadata at parse time

## Handoff to next stage
This stage should end with a clear, stable data path from:
- page parse
- term enrichment
- enriched review metadata
- popup display

That path becomes the foundation for backend selection and hybrid review state in later stages.
