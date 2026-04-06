# Persistent Working Log Protocol

## Purpose
Ensure the implementation process can survive context-window resets without losing project state, decisions, completed tasks, or partial progress.

This protocol is mandatory for every implementation stage.

---

## Why this exists
The LLM context window will eventually reset, either naturally or because the user manually starts a fresh context before a new stage.

Without an on-disk project log, the model may:
- repeat work
- miss completed changes
- make conflicting architectural decisions
- forget unresolved issues
- lose the exact handoff state between stages

The solution is to maintain a **persistent working log on disk** that is updated throughout implementation and explicitly read before any new stage begins.

---

## Core Rule
Before starting any stage, the LLM must:
1. open and read the current working log
2. review the latest completed tasks, open tasks, blocked items, and architectural decisions
3. use that log as the starting state for the new stage

After completing meaningful work, the LLM must update the working log on disk.

This is not optional.

---

## Required Files

## 1. Master working log
Create and maintain a single persistent markdown file such as:

- `docs/implementation-working-log.md`

This is the canonical source of implementation history.

## 2. Optional stage-specific notes
If needed, each stage may also produce a narrower companion file such as:

- `docs/stages/stage-0-notes.md`
- `docs/stages/stage-1-notes.md`

However, these are optional.
The **master working log** remains the required source of truth.

---

## What the working log must contain
The working log should always include the following sections.

## A. Project status snapshot
A short current summary of:
- current stage
- current branch if relevant
- current implementation status
- what is working
- what is not yet implemented

## B. Completed work
A chronological or stage-grouped list of completed changes.

Each entry should include:
- date/time if useful
- stage number
- task completed
- affected modules/files
- short note on why it was changed

## C. In-progress work
Tasks currently underway but not fully completed.

This is important because resets often happen mid-stage.

## D. Open tasks / next actions
Clear next steps that another model instance can immediately continue.

These should be concrete and action-oriented.

## E. Architectural decisions
A running log of important decisions, such as:
- parse-time ownership of word status
- hybrid backend strategy
- one active backend per interaction
- Anki-preferred with Jiten fallback
- need for explicit mapping layer
- use of custom Anki-side write path instead of GUI-review hacks

Each decision should ideally include:
- decision summary
- rationale
- consequences

## F. Known issues / blockers
Anything unresolved that a future model must know before proceeding.

Examples:
- uncertain insertion point
- stale cache issue discovered
- ambiguous term mapping edge case
- unresolved note-model assumptions

## G. Files changed
A concise running list of files changed in the current stage or recent work.

This makes repo re-orientation much easier after reset.

## H. Verification status
What has been tested, verified manually, or still needs verification.

---

## Update Rules

## When to update the working log
The LLM should update the working log:
- before ending a work session
- after completing any meaningful task
- after architectural decisions are made
- after discovering blockers
- before handing off to the next stage

## What counts as meaningful work
Examples:
- creating or refactoring a module
- changing the review-state flow
- adding backend selector scaffolding
- implementing mapping logic
- discovering a critical repo constraint
- changing planned approach due to codebase realities

## What should not happen
The log should not be left stale for long stretches of work.

If the model makes real changes but does not update the log, the protocol has failed.

---

## Required Pre-Stage Workflow
Before starting any new stage, the LLM must perform this sequence:

1. Read the master working log.
2. Read the stage document for the target stage.
3. Compare the stage goals against the current project status in the working log.
4. Identify whether prerequisite tasks are already done, partially done, or blocked.
5. Only then begin implementation.

This should be treated as the mandatory preflight checklist for each stage.

---

## Suggested Working Log Structure

```markdown
# Implementation Working Log

## Current Snapshot
- Current stage:
- Overall status:
- Active backend behavior:
- Last updated:

## Architectural Decisions
### Decision: <title>
- Summary:
- Rationale:
- Consequences:

## Completed Work
### <date or stage>
- Completed:
- Files changed:
- Notes:

## In Progress
- Task:
- Current status:
- Next immediate step:

## Open Tasks
- [ ] ...
- [ ] ...

## Known Issues / Blockers
- ...

## Verification Status
- Verified:
- Not yet verified:

## Handoff Notes
- The next model instance should start by:
```

---

## Relationship to Stage Docs
The stage docs define **what should be built**.
The working log defines **what has actually happened so far**.

Both are required.

A future model instance should never rely on memory alone when transitioning stages.
It should always consult:
1. the persistent working log
2. the relevant stage document

---

## Implementation Recommendation
When Codex begins the actual coding workflow, the very first repo-level task should be:

1. create the master working log file
2. add an initial snapshot entry
3. record the current architectural decisions already agreed
4. update it continuously from that point forward

This should happen before substantive code changes begin.

---

## Acceptance Criteria
This protocol is successful if:
- a fresh model instance can resume work using only the repo files and stage docs
- completed tasks are not repeated unnecessarily
- architectural decisions remain consistent across context resets
- the next stage can begin by reading the working log instead of depending on prior chat memory

---

## Final Rule
The working log is part of the implementation, not optional documentation.

If the implementation changes but the log is not updated, the handoff is incomplete.
