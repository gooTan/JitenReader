# Stage 5 — Design the Unified Review Metadata Model

## Objective
Create the internal term-level review metadata structure that can represent both Jiten and Anki states cleanly.

## Why this stage exists
Before real Anki lookup is added, the system needs a backend-neutral review state model that the parse/enrichment pipeline can attach and the popup can render. This avoids hard-coding future logic into Jiten-shaped data.

## Scope
Codex should:
- define a backend-agnostic review metadata shape
- include backend source, mapping state, due state, target state, and freshness state
- adapt the current Jiten-enriched state into this model
- update popup consumers to render from this model

## Core state dimensions to represent
At minimum, the unified model should be able to encode:
- active backend used during enrichment
- mapped / unmapped / ambiguous state
- due / not due / unavailable / unknown state
- selected or primary review target metadata when relevant
- freshness state, especially for post-review refresh handling
- whether review actions are currently available

## Deliverables
- unified review metadata type/model
- adapter logic from current Jiten status into that model
- popup consumption of that model
- documentation on what each field means and who owns it

## Design guidance
- keep the model small but expressive
- prefer explicit state flags over inferred meaning
- separate backend identity from reviewability state
- make it easy for later stages to plug Anki data into the same structure

## Non-goals
- no real Anki mapping yet
- no Anki due lookup yet
- no review write path yet
- no advanced ambiguity UI yet

## Acceptance criteria
- popup renders from a backend-neutral review metadata object
- Jiten-based enriched state is fully expressible through the new model
- future Anki states can be added without redesigning the popup again

## Handoff to next stage
This stage should end with a stable internal state contract. The next stage can then build a minimal read-only Anki backend path that populates this same model.
