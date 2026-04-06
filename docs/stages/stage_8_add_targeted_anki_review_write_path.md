# Stage 8 — Add the Targeted Anki Review Write Path

## Objective
Support arbitrary card-targeted review submission from the popup into Anki.

## Why this stage exists
Read-only integration is not enough for the desired feature. The core requirement is that a user can encounter a matching due term in the reading popup and have their chosen rating recorded against the intended Anki card.

## Scope
Codex should:
- add the extension-side review submission path for Anki mode
- integrate with a custom Anki-side endpoint or add-on capable of card-targeted review writes
- submit ratings against the selected target card from Stage 7
- return authoritative post-review state into the extension

## Important architectural constraint
Do not implement this by trying to force arbitrary popup reviews through Anki’s current GUI reviewer state. The write path should target the intended card directly.

## What this stage must solve
- how the extension identifies the exact selected Anki card
- how the rating is transmitted
- how post-review state is returned
- how write failures are handled without corrupting local state

## Deliverables
- extension-side Anki review submission path
- integration contract for custom Anki-side targeted review writes
- post-review result handling in the extension
- failure states for unsuccessful writes

## Non-goals
- no advanced popup UX polish yet
- no review-all-matches behavior
- no history reconciliation with Jiten fallback reviews

## Acceptance criteria
- given a selected eligible Anki target, the popup can submit a rating and update that exact Anki card
- the extension receives authoritative success/failure information
- local enriched state is not optimistically trusted before backend confirmation
- failures do not silently fall back mid-click

## Handoff to next stage
This stage should end with end-to-end Anki-backed popup reviewing working for the simple case where a single safe target exists. The next stage can then focus on refresh behavior, UI clarity, and failure handling across the hybrid system.
