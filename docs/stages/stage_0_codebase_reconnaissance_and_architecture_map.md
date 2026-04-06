# Stage 0 — Codebase Reconnaissance and Architecture Map

## Objective
Create a precise implementation map of the current review flow before changing behavior.

## Why this stage exists
Even with a high-level integration plan, the first safe step is to anchor the work in the real repo structure. This stage reduces the risk of later refactors by identifying the actual files, modules, and state ownership boundaries involved in parsing, enrichment, popup rendering, grading, and background command execution.

## Scope
This is a **read-only investigation stage**.

Codex should inspect and document:
- page parsing pipeline
- term enrichment pipeline
- how word status is attached during parsing
- popup state flow
- grading flow
- background command flow
- Jiten review request flow
- current Anki-related config and request code
- any existing caching or state reuse mechanisms relevant to word status

## Key questions to answer
1. Where exactly is word review status determined during page parsing?
2. What data structure carries parsed term status into the popup?
3. Which controller/action chain is responsible for grading a card today?
4. Which background handler ultimately sends the Jiten review request?
5. Where is the cleanest insertion point for a backend abstraction?
6. Where is the cleanest insertion point for parse-time backend selection?
7. What would have to change for the popup to consume backend-neutral enriched review metadata?

## Deliverables
- a short architecture note in markdown
- a file/module map of all relevant components
- a step-by-step current-state review flow description
- a step-by-step current-state parse/enrichment flow description
- a proposed list of insertion points for later stages
- a risk list of places where review ownership may be duplicated or unclear

## Suggested output structure
- Overview
- Parsing flow
- Enrichment flow
- Popup flow
- Grading flow
- Background command flow
- Jiten API flow
- Current Anki plumbing
- Recommended seams for refactor
- Risks / ambiguities

## Non-goals
- no behavior changes
- no refactor
- no new interface design yet
- no implementation of Anki logic

## Acceptance criteria
- there is a concrete file-level map of where review state is computed and where grade actions are sent
- there is a named list of future insertion points
- the team can point to the exact architectural owner of parse-time word status
- later stages can be planned against real file boundaries instead of assumptions

## Handoff to next stage
This stage should end with a clear answer to:
- where the review backend abstraction should be inserted
- where parse-time review enrichment should be owned
- which call sites will need refactoring first
