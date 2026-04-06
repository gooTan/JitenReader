# Stage 9 — Add Targeted Refresh, Failure Handling, and Hybrid UX Clarity

## Objective
Make the hybrid system coherent, trustworthy, and usable after Anki-backed reviewing is introduced.

## Why this stage exists
Once Anki-backed review writes work, the next challenge is keeping the page-level enriched state, popup display, backend badges, and fallback behavior consistent. This stage turns the system from technically functional into operationally reliable.

## Scope
Codex should:
- implement targeted refresh of affected term/card state after review
- invalidate or refresh stale enriched review metadata appropriately
- surface clear backend status in the popup
- handle write failures and backend unavailability gracefully
- ensure fallback occurs at interaction boundaries, not silently mid-action

## Problems this stage must solve
- how the page-level enriched state is refreshed after a successful review
- how stale popup state is detected after a rating click
- how users can tell whether they are in Anki mode or Jiten mode
- how failures are communicated without misleading the user
- how the system behaves when Anki becomes unavailable after a page was already parsed

## Deliverables
- targeted refresh logic for affected parsed terms
- stale-state handling rules
- popup backend badge / status indicator
- user-visible failure / fallback states
- consistency rules for interaction-boundary fallback

## Recommended design rules
- do not silently switch backend halfway through a click
- do not pretend a Jiten fallback review reached Anki
- make backend status visible but lightweight
- prefer targeted refresh over full reparse when safe

## Non-goals
- no major visual redesign
- no advanced analytics/telemetry unless needed for debugging
- no automatic history reconciliation across backends

## Acceptance criteria
- after a review action, the affected term state is refreshed or invalidated correctly
- popup clearly indicates active backend
- failure states are explicit and non-misleading
- fallback behavior is predictable and happens at clean boundaries
- the hybrid system feels coherent to a user who does not know the internal architecture

## Handoff to next stage
This stage should leave the system in a viable MVP-ready state. Any later work can then focus on polish, broader schema support, advanced ambiguity handling, or migration/reconciliation features.
