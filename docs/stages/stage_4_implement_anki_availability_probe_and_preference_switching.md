# Stage 4 — Implement Anki Availability Probe and Preference Switching

## Objective
Make the system prefer Anki when reachable, otherwise fall back to Jiten at the parse/enrichment level.

## Why this stage exists
This is the smallest meaningful step toward hybrid behavior. It introduces real backend preference switching without yet requiring card mapping or review submission.

## Scope
Codex should:
- implement an Anki availability probe
- add short-lived availability caching
- allow backend selector to choose Anki when healthy
- expose the selected backend into parse-time enriched review metadata

## What this stage should solve
- whether Anki is reachable at parse time
- how long that result should be reused
- how the system prefers Anki but still safely falls back to Jiten

## Deliverables
- Anki health probe
- cache/invalidation rules for availability checks
- backend preference logic
- parse-cycle backend selection behavior
- enriched state includes which backend was used

## Design guidance
- availability checks should not happen on every hover repaint
- backend choice should be made at the parse/enrichment cycle, not repeatedly in the popup
- do not switch backend halfway through a review action

## Non-goals
- no card mapping yet
- no Anki due-state lookup yet
- no Anki review submission yet
- no custom add-on work yet

## Acceptance criteria
- system can detect whether Anki is reachable
- parse/enrichment chooses Anki or Jiten appropriately
- enriched term state records the active backend
- the rest of the app remains stable even if Anki is unavailable

## Handoff to next stage
This stage should end with a working infrastructure answer to: “Which backend should enrich this page right now?”
The next stage can then define a unified review metadata model that works for both backends.
