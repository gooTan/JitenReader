# Stage 8B — Integrate JitenReader with the Anki Add-on

## Objective

Connect JitenReader’s Anki-mode popup review flow to the targeted review-write capability implemented in Stage 8A.

## Why this stage exists

Once the Anki add-on exists, the extension still needs to:

* call it correctly
* send the selected target card and rating
* handle success/failure
* update local state appropriately

This stage isolates the extension-side integration so it can be implemented without simultaneously designing the Anki-side write mechanism.

## Scope

This stage is **JitenReader-side integration only**.

Codex should:

* add the extension-side client/request path for the Anki add-on
* call that path when a popup review action is triggered in Anki mode
* send the selected target card information from Stage 7
* pass the user’s rating choice to the add-on
* handle structured success/failure responses
* mark affected enriched state stale or trigger targeted refresh preparation as needed

## What this stage must solve

The extension must answer the question:

> When the user clicks a review button in Anki mode, how does JitenReader send that result to the targeted Anki card and update its own local state safely?

## Preconditions

Before starting this stage, the following should already be true:

* Stage 7 is complete
* there is a deterministic selected Anki target card for the simple supported case
* Stage 8A is complete
* the Anki add-on contract is documented and stable enough to call

## Required responsibilities

The extension integration should be responsible for:

* constructing the request payload for the add-on
* submitting the request when the user triggers a review action in Anki mode
* handling loading/submission state
* consuming structured responses
* handling failures explicitly
* ensuring local enriched state is not trusted optimistically before backend confirmation

## Required behavior rules

* do not silently fall back to Jiten in the middle of a failed Anki review click
* do not assume success before the add-on confirms it
* do not blur the boundary between “selected target card” and “displayed popup word”
* do not begin full hybrid UX polish here unless required to make the flow function

## Deliverables

* extension-side request client for the add-on
* integration from popup review action into that request path
* response handling for success/failure
* local state update or stale marking after response
* verification notes for the single-target happy path and basic failure cases

## Suggested implementation focus

Keep this stage narrow.

The MVP for this stage is:

* one selected eligible Anki target card
* one review action submission path
* one authoritative response
* correct state handling afterward

## Non-goals

* no full targeted refresh system yet
* no complete hybrid UX polishing
* no advanced ambiguity resolution UI
* no review-all-matching-cards flow
* no history reconciliation with Jiten fallback reviews

## Acceptance criteria

* when the popup is in Anki mode and a valid single target exists, a review button click sends the selected target and rating to the add-on
* the extension receives authoritative success/failure information
* failures are surfaced explicitly and do not silently mutate local state as if the review succeeded
* the extension is ready for the next stage to implement targeted refresh and hybrid UX clarity

## Handoff to next stage

This stage should end with the core end-to-end path working for the simple case:

* parsed term is mapped
* popup has a selected target card
* user clicks a rating
* add-on records the review
* extension receives the result and marks local state for refresh/update

The next stage can then focus on:

* targeted refresh
* stale-state invalidation
* fallback clarity
* backend badge/status UX
* failure handling across the full hybrid flow
