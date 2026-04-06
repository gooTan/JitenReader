# Stage 7 — Implement the Mapping Layer and Card Selection Policy

## Objective
Map parsed Jiten terms to eligible Anki cards and choose a deterministic primary target for popup review.

## Why this stage exists
This is the core domain problem of the hybrid design. JitenReader is word-oriented, while Anki is card-oriented. Without a strong mapping layer and explicit selection policy, Anki-backed popup reviewing will be unreliable.

## Scope
Codex should:
- implement the first real mapping layer from parsed Jiten term identity to candidate Anki cards
- restrict matching to configured eligible decks / note models / templates
- filter ineligible cards
- resolve due-state and target selection deterministically
- populate unified review metadata with mapping and target information

## Required decisions to encode
The implementation must make explicit choices for:
- what constitutes a valid mapping key
- which note models are eligible
- which card templates are eligible
- which decks are eligible
- how duplicates are handled
- how ambiguity is represented when no safe single target exists

## Recommended initial policy
For the MVP, keep the rules strict:
- require explicit mapping support
- support only configured decks/models/templates
- auto-select only when exactly one safe target exists after filtering
- mark state as ambiguous otherwise

## Deliverables
- mapping resolution path
- eligibility filters
- target selection policy
- enriched metadata carrying mapping result and selected target state
- tests or verification cases for duplicates, missing mapping, and ambiguity

## Non-goals
- no review-write path yet
- no advanced multi-match UI yet
- no fuzzy matching if avoidable
- no reconciliation across Anki and Jiten histories

## Acceptance criteria
- parsed terms can resolve to zero, one, or many candidate Anki cards deterministically
- only eligible cards participate
- the system can represent unmapped, not due, due, and ambiguous states correctly
- popup has enough target metadata to support later review submission

## Handoff to next stage
This stage should end with one crucial capability: for a parsed due term, the system can identify the exact Anki card it would review if review-write support existed.
