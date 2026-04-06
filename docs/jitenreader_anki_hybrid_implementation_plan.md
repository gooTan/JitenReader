# JitenReader × Anki Hybrid Review Integration Plan

## Goal

Add **Anki-preferred review syncing** to JitenReader while preserving the current Jiten review workflow as fallback.

Desired behavior:

- If **Anki is available**, the popup should use **Anki as the active review backend**.
- If **Anki is not available**, the popup should fall back to **Jiten’s existing SRS flow**.
- The user should experience **one coherent popup UX**, while the extension internally selects the active backend.
- In **Anki mode**, the popup should support **true encounter-driven reviewing of arbitrary matching cards**.
- In **Jiten mode**, the extension should behave exactly as it does now.

---

## Product Principles

### 1. One active backend per interaction
For any single popup interaction, only **one backend** should be the source of truth.

That means:
- If the popup is in **Anki mode**, due state, grading, and post-review refresh come from Anki.
- If the popup is in **Jiten mode**, due state, grading, and refresh come from Jiten.

Do **not** mix states across the two systems within one interaction.

### 2. Prefer Anki, do not replace Jiten
This is a **hybrid preference model**, not a full migration.

Jiten remains:
- a parser / reading assistant
- the fallback SRS backend
- the default system when Anki is unreachable

Anki becomes:
- the preferred review backend when available
- the authoritative scheduler in Anki mode

### 3. No fake sync claims
If a review was recorded to Jiten because Anki was unavailable, the extension must **not pretend** that review was recorded in Anki.

The systems should be treated as separate histories unless a future reconciliation feature is explicitly built.

### 4. Backend choice should be visible but lightweight
The user should always be able to tell whether the popup is using:
- **Anki**, or
- **Jiten fallback**

This should be visible through a small badge or status indicator, not a noisy workflow interruption.

---

## Current State of the Codebase

### What already exists
The current codebase already has:
- a Jiten-centered review flow
- popup controllers and background command routing
- a partial Anki configuration layer
- localhost request plumbing for Anki

### What is hard-wired today
The main review flow currently assumes:
- review actions are Jiten review actions
- card identity is based on Jiten entities such as `wordId` and `readingIndex`
- post-review refresh is Jiten-based

### What this means
The current architecture is **not yet backend-agnostic**.

So the implementation is not just “add an Anki API call.”

It requires a structural change:
- review state lookup must become backend-aware
- grade submission must become backend-aware
- popup card state refresh must become backend-aware
- the extension must be able to choose a backend per interaction

---

## Important Architectural Correction: Parse-Time Review Status

A key constraint is that **word status is determined when the page is parsed**, not when the popup opens.

This changes the cleanest design in an important way:

- backend selection should primarily happen at the **page parse / term enrichment stage**
- due-state and reviewability should be attached to parsed terms during enrichment
- the popup should mostly **consume precomputed review metadata** rather than computing due state from scratch
- popup-level logic should be limited to displaying enriched state, submitting reviews, and triggering targeted refreshes when needed

### Practical consequence
The system should not be designed as:
- hover word → popup opens → choose backend → compute due state

It should instead be designed as:
- page parse begins
- backend selector decides whether Anki or Jiten is active for that parse cycle
- parsed terms are enriched with review metadata
- popup opens and reads the already-enriched status
- if the user reviews a card, the affected term state is refreshed without making popup rendering the primary source of truth

### What the popup should receive from parse-time enrichment
Each parsed term should already carry enough review metadata for rendering, such as:
- active backend used during enrichment
- mapped / unmapped / ambiguous state
- due / not due / unavailable state
- selected review target metadata where applicable
- freshness state so the popup knows whether the data is still valid after a review action

## High-Level Architecture

## Core idea
Introduce a **Review Backend Abstraction Layer**, but place the main backend decision and due-state enrichment at the **page parsing / term enrichment stage**, not at popup render time.

Instead of the popup deciding review status from scratch, the reading pipeline should:
- parse the page
- identify terms
- select the active review backend for that parse cycle
- enrich each parsed term with backend-specific review metadata
- cache that enriched status for popup use

The popup should then mostly behave as a **consumer of precomputed review state**, with only lightweight refreshes or review submissions happening on demand.

The abstraction can be implemented by:
- `JitenReviewBackend`
- `AnkiReviewBackend`

This abstraction becomes the single entry point for:
- backend selection for the parse/enrichment cycle
- review lookup during parsing
- due-state determination
- grade submission
- post-review refresh
- review capability reporting

### Resulting architecture

```text
Page Parse / Term Extraction
  ↓
Review Backend Selector
  ↓
+-----------------------+
| Active Review Backend |
+-----------------------+
   ├── JitenReviewBackend
   └── AnkiReviewBackend
  ↓
Term Review Enrichment Cache
  ↓
Popup UI / Popup Controllers
```

### Architectural consequence
The popup should not be the primary place where "is this due?" is computed.
Instead, the popup should read:
- active backend
- mapped/unmapped state
- due/not-due state
- review target metadata

from the parse-time enrichment layer.

That means the popup becomes thinner, while the parser/enrichment pipeline becomes the main place where backend-aware review status is attached to words on the page.

## Main Implementation Components

## 1. Backend Selection Layer

### Purpose
Determine which backend should power the **page parse / review enrichment cycle**.

### Rule
- Prefer **Anki** if healthy and usable.
- Otherwise use **Jiten**.

### Responsibilities
- perform Anki availability checks
- cache backend health briefly
- expose the active backend for the current parse cycle
- prevent repeated expensive checks on every hover or popup open
- handle fallback on backend failure

### Recommended behavior
Use a **short-lived health cache** tied to the parse/enrichment pipeline.

Suggested logic:
- when a page is parsed or reparsed, check whether Anki is reachable
- choose the active backend for that parse cycle
- enrich parsed terms using that backend
- store the backend choice alongside the enriched term state
- reuse that result for popups until the page is reparsed or a targeted refresh occurs

### Important constraint
Do **not** let popup rendering trigger full backend selection repeatedly.
The popup should read the backend already chosen during parsing.

### Another important constraint
Do **not** switch backend halfway through a single review action.

If a review action began in Anki mode and Anki fails during submission:
- treat that action as failed
- show a clear error / unavailable state
- mark Anki unhealthy for the next refresh / parse cycle
- allow the next interaction boundary to fall back to Jiten

## 2. Review Backend Interface

### Purpose
Create one uniform internal contract for all review operations.

### Responsibilities of the interface
The backend abstraction should answer questions like:
- Is this word/card reviewable in this backend?
- Is it due?
- What card(s) correspond to this popup item?
- What grade buttons are available?
- What happens when the user presses Again / Hard / Good / Easy?
- How should the popup state be refreshed after grading?

### Minimum capability areas
The abstraction should support at least:

#### A. Lookup
Given a popup item or hovered word:
- resolve candidate review targets
- determine whether anything is due
- prepare popup-ready card data

#### B. Review submission
Given a chosen target and rating:
- submit the review
- return updated state
- indicate success / failure

#### C. Capability reporting
The backend should declare what it can support, for example:
- arbitrary card review
- due-state lookup
- multiple target resolution
- answer button count / labels

This prevents UI assumptions from leaking into backend logic.

## 3. Jiten Review Backend

### Purpose
Wrap the existing Jiten behavior behind the new abstraction.

### Goal
Preserve all current behavior without changing the user-facing fallback experience.

### Responsibilities
- continue using current Jiten review endpoints
- continue using Jiten-based state lookup and refresh
- continue using Jiten card identity (`wordId`, `readingIndex`)
- implement the abstraction without changing the external behavior

### Why this matters
This gives you a safe baseline.

Once the Jiten backend is working behind the abstraction, you can build the Anki backend without breaking the existing product.

## 4. Anki Review Backend

### Purpose
Provide Anki-powered due lookup and grade submission for arbitrary popup-matched cards.

### Core challenge
JitenReader identifies words; Anki schedules cards.

So this backend must solve two separate problems:

1. **mapping** popup items to Anki cards
2. **writing reviews back** to a specific arbitrary matched card

### Why this cannot be a thin wrapper
A naive design would try to use Anki only for due lookup while keeping the rest of the flow Jiten-shaped.
That will get messy quickly.

Instead, the Anki backend should be treated as a full review engine for Anki mode.

## 5. Mapping Layer

### Purpose
Map the popup’s Jiten-native identity to one or more Anki cards.

### Current mismatch
JitenReader popup items are word-oriented.
Anki is card-oriented.

That means you need a durable mapping from:
- `(wordId, readingIndex)`

To:
- one or more Anki note/card identities

### Cleanest mapping design
Use a **canonical mapping key** stored on the Anki side.

Recommended design:
- each eligible Anki note stores a Jiten-derived identifier
- that identifier maps deterministically back to the popup item
- the extension queries Anki using that identifier

### Why explicit mapping is better than text matching
Do not rely on:
- surface text only
- dictionary form only
- reading only
- fuzzy string inference

Those approaches will break on:
- duplicates
- homographs
- alternate readings
- multiple note models
- multiple decks
- inflected forms

### Mapping policy decisions
You should define these early:

#### Allowed note models
Which Anki note types can participate in popup review?

#### Allowed card templates
If one note generates multiple cards, which cards are popup-reviewable?

#### Allowed decks
Should all decks be eligible, or only configured decks?

#### Duplicate resolution
What if multiple cards map to the same Jiten key?

#### Missing mapping behavior
What should happen if a popup word has no corresponding Anki card?

### Recommended rule
Be strict by default.

Only review cards that satisfy all of the following:
- approved deck
- approved model
- approved card template
- valid mapping key
- not suspended / not otherwise ineligible

This will make the system far more predictable.

## 6. Due-State Resolution in Anki Mode

### Purpose
Determine Anki reviewability **during term enrichment**, so the popup can read precomputed review state.

### Flow
Once a parsed term is mapped to candidate Anki cards during page parsing:
- filter to eligible cards
- determine which are due
- choose a primary actionable target
- attach the result to the parsed term's stored review metadata
- expose that enriched state to the popup UI

### Possible outcomes
For any parsed word, Anki mode may yield:
- no mapping
- mapping exists but no due cards
- exactly one due card
- multiple due cards
- ambiguous mapping
- backend unavailable

### UI should reflect these states explicitly
Do not collapse all failures into “not due.”

The user should be able to distinguish between:
- not due
- no Anki mapping
- ambiguous Anki match
- Anki unavailable

### Important architectural note
Because due status is attached during parsing, popup rendering should normally be read-only with respect to due-state determination.
The popup may still request a targeted refresh after a review action, but it should not be the normal place where due-state is first computed.

## 7. Card Selection Policy in Anki Mode

### Purpose
Choose which exact Anki card the popup should review when more than one candidate exists.

### This needs to be deterministic
A word-first popup will often encounter these situations:
- one word maps to multiple notes
- one note generates multiple cards
- multiple decks contain the same vocab
- multiple cards are simultaneously due

### Recommended priority order
1. restrict to configured popup-review-enabled decks/models/templates
2. remove non-reviewable cards
3. prefer due cards over non-due cards
4. if multiple due cards remain, apply explicit priority rules:
   - preferred deck
   - preferred model
   - preferred template
   - oldest due or most overdue
5. if ambiguity still remains, show a small chooser or disable direct grading

### Why this must be explicit
If this logic is left implicit, the popup will appear random and users will lose trust.

## 8. Anki Write Path

### Purpose
Record the result of a popup review back into Anki for a specific arbitrary matched card.

### Key design decision
Do **not** depend on Anki’s current GUI reviewer state for this feature.

The popup should be able to say:
- “this is the exact card the user encountered”
- “record this grade on that exact card”

### Cleanest implementation
Use a **small custom Anki add-on** that exposes a targeted review endpoint for arbitrary `cardId` review submission.

### Why this is cleaner than stock AnkiConnect GUI actions
The GUI-based AnkiConnect review flow is tied to:
- current reviewer card
- current answer state
- current timer state

That is suitable for remote-controlling Anki’s built-in reviewer.
It is not the right abstraction for encounter-driven popup review.

### Responsibilities of the custom Anki add-on
The add-on should:
- accept a specific card target
- accept a rating button choice
- apply the review to that exact card
- update Anki scheduling state correctly
- return post-review state to the extension

### Extension-side expectations
The extension should treat the add-on’s response as authoritative for:
- success/failure
- updated due state
- next available review buttons if relevant

## 9. Popup State Model

### Purpose
Represent the popup’s review state in a backend-agnostic way while acknowledging that most review status is precomputed upstream during parsing.

### Why this matters
Right now the popup is implicitly shaped around Jiten review concepts.
To support hybrid mode cleanly, the popup needs a neutral state model.

### The popup should know
- which backend was active when the term was enriched
- whether the item is reviewable
- whether a due target exists
- whether selection is ambiguous
- what target is currently selected
- what review actions are available
- whether the displayed state is fresh or needs targeted refresh after grading
- what happened after the last grading action

### Suggested state dimensions

#### Backend state
- `anki`
- `jiten`
- `unavailable`

#### Mapping state
- mapped uniquely
- mapped ambiguously
- unmapped

#### Due state
- due
- not due
- unavailable
- unknown

#### Enrichment freshness
- parse-time fresh
- stale-after-review
- refresh-in-progress

#### Review submission state
- idle
- submitting
- success
- failed

This avoids backend-specific logic leaking into rendering code and keeps the popup aligned with parse-time enrichment.

## 10. Caching Strategy

### Purpose
Keep parsing and popup interactions responsive without sacrificing correctness.

### Recommended split

#### A. Health cache
Short TTL for Anki availability.
Used by the parse/enrichment pipeline to avoid repeated localhost checks.

#### B. Mapping cache
Cache mapping from Jiten identity to candidate Anki cards.
This data changes infrequently and is a good cache target.

#### C. Parse-time review enrichment cache
Store the backend-selected, due-enriched status attached to parsed terms on the page.
This is the main source of truth for popup display.

#### D. Targeted refresh cache
After a review action, allow refresh of only the affected term/card state rather than forcing a full page reparse when possible.

#### E. No optimistic write cache
When a user grades a card, do not assume success locally before the active backend confirms it.

### Post-review rule
After a review submission:
- invalidate the affected enriched term state
- invalidate affected mapping/due cache entries as needed
- re-read authoritative state from the active backend
- update the page-level enriched term state so later popups stay consistent

## 11. Failure and Fallback Handling

### Purpose
Prevent silent errors and misleading state.

### Failure classes to support

#### Anki unavailable at popup start
Use Jiten mode immediately.

#### Anki becomes unavailable during lookup
Mark Anki unhealthy, fail that lookup, and allow the next interaction to use Jiten.

#### Anki review submission fails
Do not silently fall back mid-click.
Treat that action as failed and let the next interaction choose Jiten.

#### Missing Anki mapping
Show that Anki mode is active but this item has no Anki review target.
Depending on product choice, either:
- show no review buttons, or
- allow explicit manual fallback to Jiten for this item

#### Ambiguous mapping
Show a small selection UI or disable direct grading.

#### Stale card reference
If the selected Anki card no longer exists or changed state, invalidate cache and refresh.

### Important design principle
Fallback should happen at **interaction boundaries**, not halfway through an action.

## 12. UX Recommendations

### Minimal backend indicator
Every popup review state should indicate one of:
- **Anki**
- **Jiten**
- **Anki unavailable → Jiten fallback**

### Review buttons should reflect the active backend
Do not render buttons that imply Anki if Jiten is active.

### Ambiguity should be honest
If multiple Anki cards match, do not silently choose unless a deterministic policy clearly applies.

### Optional advanced UX later
Possible later improvements:
- tiny chooser for multiple due cards
- deck/model badge
- “review next matching Anki card”
- “open in Anki” shortcut
- user preference for backend priority
- per-deck enable/disable

## 13. Configuration Design

### Purpose
Let users control Anki-mode behavior without exposing too much complexity.

### Recommended configuration areas

#### Backend preference
- prefer Anki when available
- always use Jiten
- always use Anki if available, otherwise disable review

#### Eligible Anki decks
Restrict popup-reviewable cards to selected decks.

#### Eligible note models
Restrict popup review to supported models.

#### Eligible templates
Control which card templates are popup-reviewable.

#### Mapping strategy
How Jiten identity is stored on the Anki side.

#### Ambiguity handling
- auto-pick by priority
- ask user
- disable grading if ambiguous

## 14. Recommended Development Phases

## Phase 1 — Introduce backend abstraction

### Goal
Decouple review logic from hard-coded Jiten operations.

### Deliverables
- review backend interface
- Jiten backend implementation using current behavior
- controllers and background flow refactored to call the abstraction instead of Jiten directly

### Success criterion
The app behaves exactly like today, but through the new abstraction.

---

## Phase 2 — Move backend selection into parse/enrichment pipeline

### Goal
Make backend choice and due-state attachment happen during page parsing, not popup rendering.

### Deliverables
- parse-time backend selector
- Anki health probe with short TTL
- term review enrichment cache
- popup reads precomputed review status instead of deciding backend itself

### Success criterion
A parsed page carries backend-aware review metadata that popups can read directly.

---

## Phase 3 — Mapping layer and Anki read-only enrichment

### Goal
Support Anki-mode resolution of parsed words to candidate cards during enrichment.

### Deliverables
- canonical mapping design
- lookup logic from parsed term to candidate Anki cards
- filtering to eligible decks/models/templates
- due-state enrichment during parsing
- ambiguity detection

### Success criterion
The page parser can attach truthful Anki review states such as:
- due
- not due
- unmapped
- ambiguous

Still no review submission yet.

---

## Phase 4 — Custom Anki add-on for targeted review writes

### Goal
Support arbitrary card grading from the popup.

### Deliverables
- Anki-side targeted card review endpoint
- extension request path for review submission
- post-review targeted refresh of affected term/card state
- failure handling for write errors

### Success criterion
A user can encounter a word in reading mode and submit a review that updates the intended Anki card.

---

## Phase 5 — Full hybrid popup UX

### Goal
Integrate Anki write path with fallback behavior and clear UI states.

### Deliverables
- backend badges
- clearer status messaging
- ambiguity handling UI
- stale-cache recovery
- fallback behavior at interaction boundaries

### Success criterion
The system feels coherent and understandable in both Anki and Jiten modes.

---

## Phase 6 — Advanced polish

### Optional improvements
- multi-match chooser
- “review all matching due cards” flow
- user override to force Jiten for a given popup
- telemetry/debug logging for mapping failures
- migration tools to help users annotate Anki notes with Jiten mapping keys
- selective re-enrichment of only visible text regions when appropriate

---

## 15. Risks and Complexity

## Major risk 1 — Mapping quality
This is the highest-risk part of the project.

If mapping is weak, the rest of the system will be unreliable even if the Anki write path is technically perfect.

### Mitigation
- use explicit mapping keys
- restrict eligible decks/models/templates
- start with a narrow supported card schema

## Major risk 2 — Review semantics inside Anki
Applying a review to an arbitrary card must preserve correct Anki scheduling semantics.

### Mitigation
- implement review writes in a small Anki-side add-on
- avoid GUI-review hacks
- test thoroughly with all supported card states

## Major risk 3 — User confusion about which backend is active
If users do not understand whether a review went to Anki or Jiten, trust will collapse.

### Mitigation
- always show active backend
- never silently cross-write
- never imply that fallback reviews reached Anki

## Major risk 4 — Ambiguity and duplicates
Multiple matching cards will occur in real decks.

### Mitigation
- adopt strict filtering
- define deterministic priority rules
- disable grading when ambiguity is unresolved

---

## 16. Recommended MVP Scope

The MVP should be intentionally narrow.

### MVP behavior
- Prefer Anki if available
- Fall back to Jiten otherwise
- Support only configured Anki decks/models/templates
- Require explicit mapping key on Anki notes
- Support direct popup grading only when exactly one eligible due Anki card matches
- Use Jiten normally when Anki is unavailable

### What to postpone
- full duplicate resolution UI
- fuzzy mapping
- background reconciliation between Jiten and Anki histories
- review-all-matches flows
- support for many unrelated Anki note schemas

This will keep the first version stable and predictable.

---

## 17. Final Recommendation

The cleanest implementation is:

1. **Refactor JitenReader around a backend abstraction**
2. **Keep Jiten as the fallback backend**
3. **Prefer Anki through a cached health check**
4. **Add a strict mapping layer from Jiten popup identity to Anki cards**
5. **Use a custom Anki add-on for arbitrary card-targeted review writes**
6. **Show the active backend clearly in the popup**
7. **Treat Anki and Jiten as separate histories unless future reconciliation is explicitly built**

This gives you a system that is:
- technically coherent
- predictable for users
- compatible with the current JitenReader architecture
- realistic to build incrementally

---

## 18. Decision Summary

### Clean architectural decisions
- hybrid backend model: **yes**
- prefer Anki when reachable: **yes**
- preserve Jiten fallback: **yes**
- one active backend per interaction: **yes**
- arbitrary Anki popup review using stock GUI reviewer calls only: **no**
- custom Anki add-on for card-targeted writes: **yes**
- explicit mapping layer: **mandatory**
- silent dual-sync between Anki and Jiten: **no**

---

## 19. Short Version

If you want this feature to be clean:

- do **not** bolt Anki calls directly onto the current Jiten grading flow
- do **not** put primary due-state determination inside the popup if page parsing already owns word status
- do move backend selection and review enrichment into the parse pipeline
- do **not** try to abuse Anki’s current-reviewer GUI methods for arbitrary popup cards
- do build a backend abstraction
- do keep Jiten as fallback
- do create an explicit mapping layer
- do use a small custom Anki add-on for exact card-targeted review writes
- do let the popup mostly consume precomputed status and only trigger targeted refresh after grading

That is the clean path.
