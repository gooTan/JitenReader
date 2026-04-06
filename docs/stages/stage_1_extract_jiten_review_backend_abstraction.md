# Stage 1 — Extract Current Jiten Review Flow Behind an Internal Abstraction

## Objective
Refactor the current Jiten-only review behavior behind a backend interface, without changing user-visible behavior.

## Why this stage exists
The safest foundation for hybrid support is to create a seam around the existing review behavior first. This stage should preserve the current product exactly while making future backend substitution possible.

## Scope
Codex should:
- introduce an internal review backend interface or service boundary
- implement a `JitenReviewBackend`
- route current Jiten lookup / grading / refresh behavior through that abstraction
- keep the current user-visible behavior unchanged

## What must remain true after this stage
- Jiten review still works exactly as it does now
- the popup still behaves the same
- the current Jiten request flow still functions
- no Anki functionality is introduced yet

## Functional responsibilities to move behind the abstraction
The abstraction should cover at least:
- review-state lookup
- due-state lookup if currently exposed in review flow
- grade submission
- post-review refresh
- capability reporting if needed later

## Deliverables
- a review backend interface
- a `JitenReviewBackend` implementation
- refactored call sites using the abstraction
- tests or verification notes showing behavior remains unchanged

## Suggested constraints
- prefer minimal surface area for the first abstraction
- avoid premature generalization
- do not design for every future edge case yet; just create the seam cleanly

## Non-goals
- no Anki backend
- no backend selection logic
- no parse-time ownership changes yet
- no mapping layer
- no popup UI changes

## Acceptance criteria
- all review operations go through the new abstraction
- there are no direct Jiten review calls remaining in higher-level popup/controller code where the abstraction should now be used
- user-visible behavior is unchanged
- the code is ready for a second backend to be added later

## Handoff to next stage
This stage should leave the codebase with a stable internal seam so later stages can move review-status ownership and backend selection without fighting hard-coded Jiten assumptions at every call site.
