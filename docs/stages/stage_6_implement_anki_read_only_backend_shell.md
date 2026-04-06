# Stage 6 — Implement the Anki Read-Only Backend Shell

## Objective
Add a minimal Anki read-only backend path without yet doing full card mapping or review writes.

## Why this stage exists
This stage proves that Anki can participate safely in the parse/enrichment pipeline before the most complex logic is introduced. It lowers integration risk by validating request flow, backend selection, error handling, and state population early.

## Scope
Codex should:
- add an `AnkiReviewBackend` skeleton
- expand the internal Anki request wrapper for safe read-only operations
- integrate Anki backend participation into parse/enrichment in a constrained way
- populate the unified review metadata model with limited or placeholder Anki-backed states where appropriate

## What this stage is trying to validate
- the extension can talk to Anki reliably when selected
- the parse pipeline can call into an Anki backend without destabilizing the app
- backend-specific read errors can be handled cleanly
- the unified review metadata model is sufficient for Anki-backed state

## Deliverables
- `AnkiReviewBackend` shell
- read-only request path integrated into backend abstraction
- constrained Anki-enrichment path
- fallback-safe error handling back to Jiten where appropriate

## Suggested implementation strategy
Keep this stage narrow. It is acceptable if Anki states are limited initially, as long as the read-only plumbing is clean and the app remains stable.

## Non-goals
- no real mapping layer yet
- no full due-state resolution yet
- no arbitrary card grading yet
- no custom Anki add-on yet

## Acceptance criteria
- Anki backend can be invoked safely in read-only mode
- errors do not break parsing or popup rendering
- unified review metadata can carry Anki-originated state without structural changes
- the system still falls back safely when Anki path is not usable

## Handoff to next stage
This stage should leave the system technically ready for the first difficult domain problem: mapping parsed Jiten terms to eligible Anki cards and choosing a target deterministically.
