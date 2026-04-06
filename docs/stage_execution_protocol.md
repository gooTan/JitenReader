# Stage Execution Protocol

## Purpose
Define the exact operating procedure the implementation agent must follow at the start, during, and end of every stage.

This protocol exists to ensure:
- persistent context survives resets
- stage scope stays controlled
- architectural decisions remain consistent
- handoff quality stays high between separate runs

This protocol should be followed together with:
- the relevant stage document
- the persistent working log protocol
- the master working log on disk

---

## Required Inputs Before Any Stage Starts
Before any stage begins, the implementation agent must read:

1. the master working log
2. the target stage document
3. any stage-specific notes if they exist

The agent must not begin implementation from memory alone.

---

## Pre-Stage Procedure

### Step 1 — Read the working log
Open the master working log and review:
- current stage status
- completed work
- in-progress work
- open tasks
- blockers
- architectural decisions
- recently changed files
- handoff notes

### Step 2 — Read the target stage document
Review:
- objective
- scope
- non-goals
- acceptance criteria
- handoff expectations

### Step 3 — Reconcile log vs stage
Determine:
- whether prerequisite work is already complete
- whether any part of the stage has already been partially implemented
- whether blockers from prior work affect this stage
- whether the stage should be narrowed further before coding begins

### Step 4 — Write a start-of-stage log entry
Before substantive implementation begins, update the working log with:
- the stage being started
- the current plan for this run
- any prerequisite observations
- any risks or assumptions being carried into the stage

Only after this entry is made should implementation begin.

---

## In-Stage Procedure

### Rule 1 — Stay inside the stage boundary
The implementation agent should work only on the current stage’s scope.

If future-stage issues are discovered:
- note them in the working log
- do not automatically expand scope unless required to unblock the current stage

### Rule 2 — Update the working log at meaningful milestones
The working log must be updated after:
- creating or refactoring an important module
- changing review-state ownership
- introducing a new interface or abstraction
- discovering a blocker
- changing implementation strategy
- completing a meaningful subtask

### Rule 3 — Keep architectural decisions explicit
If the implementation requires a non-trivial design choice, record it in the working log immediately.

### Rule 4 — Keep file-level traceability
Whenever meaningful changes are made, record the affected files in the working log.

---

## End-of-Stage Procedure

### Step 1 — Verify acceptance criteria
Review the stage document and explicitly check whether the acceptance criteria are met.

### Step 2 — Update the working log
Record:
- what was completed
- what was not completed
- files changed
- decisions made
- verification performed
- remaining issues
- recommended next action

### Step 3 — Add a handoff note
Write a short handoff note for the next run that says:
- whether this stage is complete or partial
- where the next model instance should resume
- what it must read first

### Step 4 — Stop cleanly
Do not silently drift into the next stage.
If the current stage is complete, that should be explicitly stated in the working log before moving on.

---

## Required Handoff Rule
At the end of every run, the working log must contain enough information that a fresh model instance can resume using only repo files.

If that is not true, the stage handoff is incomplete.

---

## Recommended Minimal Start Prompt for a New Stage
When launching a new implementation run, the operator should instruct the agent to:

- read `docs/implementation-working-log.md`
- read the relevant stage markdown file
- summarize current status
- update the working log with a start-of-stage entry
- then begin implementation

---

## Recommended Minimal End Prompt for a Stage
Before ending a run, the operator should instruct the agent to:

- update `docs/implementation-working-log.md`
- record files changed, completed work, open issues, and next step
- add a short handoff note for the next run

---

## Relationship to Other Documents

### Stage doc
Defines what should be built.

### Persistent working log protocol
Defines the required persistence and handoff rules.

### Master working log
Records what has actually happened.

### This stage execution protocol
Defines the exact operational sequence for every run.

---

## Acceptance Criteria
This protocol is successful if:
- every stage begins with the agent reading the working log and stage doc
- every run leaves an updated working log
- no stage transition depends on prior chat memory alone
- context resets do not cause major loss of implementation continuity

---

## Final Rule
A new stage should never begin until the agent has first read the master working log and the relevant stage document.
