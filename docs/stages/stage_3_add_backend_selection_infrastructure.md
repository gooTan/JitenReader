# Stage 3 — Add Backend Selection Infrastructure

## Objective
Introduce the concept of an active review backend, while preserving current Jiten behavior.

## Why this stage exists
Before adding real Anki behavior, the system needs a structural way to choose a backend. This stage adds the selection skeleton without yet introducing the difficult parts like mapping or targeted Anki review writes.

## Scope
Codex should:
- implement backend selector infrastructure
- define an internal backend status model
- allow the parse/enrichment pipeline to ask for the active backend
- keep Jiten as the effective backend for now unless a later stage activates Anki selection logic

## What this stage should establish
- a named place where backend selection happens
- a representation of backend availability / preference / active choice
- a flow where parse-time enrichment can depend on the chosen backend

## Deliverables
- backend selector service or module
- backend status model
- integration point from parse/enrichment into backend selection
- scaffolding for health checks or optional backends

## Design guidance
- keep backend selection separate from backend implementation details
- avoid mixing backend selection code into popup UI
- make this stage structurally useful even before Anki logic exists

## Non-goals
- no real Anki lookup
- no Anki write path
- no mapping layer
- no availability probe yet unless needed as a stub only
- no UI behavior changes beyond internal readiness

## Acceptance criteria
- parse/enrichment can ask “which backend is active?”
- Jiten remains the effective backend and behavior remains stable
- there is a clean place for later Anki availability logic to plug in

## Handoff to next stage
This stage should leave the system ready for a narrow next step: detecting Anki availability and allowing backend preference switching without yet requiring any card-level Anki logic.
