# Stage 8A — Build the Anki Add-on

## Objective

Create the Anki-side component that supports **targeted review writes for arbitrary card IDs**.

## Why this stage exists

By the end of Stage 7, the extension should be able to identify the exact Anki card it intends to review. The missing piece is the Anki-side capability to accept a request for that exact card and record a review result correctly.

This stage isolates that problem so it can be solved and verified independently of the JitenReader integration code.

## Scope

This stage is **Anki-side only**.

Codex should:

* create the Anki add-on as a separate component/subproject
* define the request/response contract for targeted review writes
* implement the add-on entry point / request handler
* accept a request that identifies a specific target card and rating
* apply the review to that exact card using correct Anki-side semantics
* return authoritative post-review data needed by the extension

## What this stage must solve

The add-on must answer the question:

> Given a specific Anki card selected by JitenReader, how can Anki record an Again / Hard / Good / Easy style result for that exact card without relying on the current GUI reviewer state?

## Required responsibilities

The add-on should be responsible for:

* validating incoming request payloads
* validating that the target card exists and is reviewable
* applying the requested rating to that exact card
* handling invalid card IDs and invalid ratings safely
* returning explicit success/failure results
* returning enough post-review state for the extension to refresh its local enriched state

## Expected inputs

The exact final contract can be refined during implementation, but the request should conceptually include:

* target card identifier
* rating/ease choice
* optional metadata needed for validation or debugging

## Expected outputs

The response should conceptually include:

* success/failure
* error type/message when relevant
* target card identity confirmation
* updated review state or enough information for the extension to refresh accurately

## Design guidance

* keep the API surface narrow
* keep request/response shapes explicit and versionable
* prefer deterministic errors over silent fallback behavior
* do not depend on the extension popup state for correctness
* do not implement this through GUI-reviewer control hacks if a direct card-targeted path is possible

## Recommended repo structure

This add-on should live in the same repository but as a **separate subproject/component**, not mixed into the browser extension build pipeline.

Example:

```text
repo/
├─ src/                     # JitenReader extension
├─ docs/
├─ anki-addon/
│  ├─ README.md
│  ├─ AGENTS.md
│  ├─ ...
```

## Deliverables

* Anki add-on project/component skeleton
* add-on README or setup instructions
* targeted review-write endpoint/handler
* request/response contract documentation
* clear error model
* minimal verification notes or tests for core write behavior

## Non-goals

* no JitenReader-side integration yet
* no popup/UI changes in the extension
* no targeted refresh logic in the extension
* no hybrid fallback UX work
* no history reconciliation with Jiten fallback reviews

## Acceptance criteria

* the add-on can receive a request for a specific Anki card and rating
* it updates that exact card rather than relying on current reviewer state
* it returns authoritative success/failure information
* invalid input cases are handled explicitly
* the add-on can be verified independently of the extension integration

## Handoff to next stage

This stage should end with a stable, documented Anki-side contract.

The next stage should be able to assume:

* there is a working Anki add-on endpoint/handler
* it accepts a selected target card and rating
* it returns a structured response the extension can consume
