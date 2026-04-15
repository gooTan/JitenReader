# Implementation Working Log Archive

Older completed run history entries were moved out of the active log on 2026-04-15 21:32:30 +10:00.

## Archived Run History
### 2026-04-15 - Start-of-Run (Runtime Contract And Test Coverage Verification)
- Stage:
  - Stage 12 - Implement Anki New-Card Lifecycle.
- Run intent:
  - Verify the current review comments against the checked-out branch, harden the runtime created-note failure contract, and strengthen regression coverage for note materialization and deck targeting.
- Current implementation state:
  - The branch still contains the Stage 12 create-and-review flow and the recent PR cleanup fixes.
  - `AnkiCollectionRuntime.create_note()` still converts the created note id with a bare `int(...)`, so invalid ids can currently escape as low-level conversion errors.
  - The `create_note()` runtime test only asserts the returned id and does not currently prove the `front` field or requested deck id were passed through.
  - The parser-lifecycle log-trim request does not match the current branch scope, so it is being treated as stale rather than forced into this branch.
- Exact goal of this run:
  - Re-raise invalid created-note ids as a `RuntimeError` with a clear failure message.
  - Extend the runtime test so it asserts field materialization and the add-note deck id.
  - Leave the log archival request alone unless later verification proves that this branch really does need it.
- Blockers or prerequisites already recorded:
  - No active blocker is recorded.
  - The parser-lifecycle archive/trim request appears stale against the current checkout.
- Risks/assumptions carried in:
  - Assumption: the current branch is still Stage 12 focused, so the parser-lifecycle documentation change should not be forced in here.
  - Risk: if the runtime continues to surface raw conversion errors, callers get an inconsistent failure contract.

### 2026-04-15 - Completed (Runtime Contract And Test Coverage Verification)
- Completed work:
  - Hardened `AnkiCollectionRuntime.create_note()` so invalid created-note ids now re-raise as a clear `RuntimeError` instead of leaking raw conversion errors.
  - Expanded the `test_create_note_supports_item_assignment_and_returns_note_id` regression so it now verifies both note-field materialization and the requested deck id path.
  - Verified that the parser-lifecycle log-trim request does not apply to this branch as checked out, so no archive split was introduced here.
- Files changed:
  - `anki-addon/jiten_targeted_review/runtime.py`
  - `anki-addon/tests/test_runtime.py`
  - `docs/implementation-working-log.md`
- Architectural decisions made:
  - Kept the runtime failure contract explicit at the boundary by converting malformed note ids into a single `RuntimeError` with a stable message.
  - Strengthened the unit test to cover both field assignment and deck targeting so the regression will fail if either behaviour drifts later.
- Blockers / open issues:
  - No blocker remains for the runtime contract/test portion of this review pass.
  - The parser-lifecycle archive/trim request was treated as stale against the current branch and was intentionally not applied.
- Verification status:
  - `py -3 -m unittest tests.test_runtime tests.test_service` passes in `anki-addon/`.
  - `npm run lint` passes.
  - `npm run build` passes.
- Next recommended step:
  - If the parser-lifecycle documentation trim is still desired, it should be raised against the branch that actually contains those parser changes rather than the current Stage 12 checkout.
- Handoff:
  - Runtime note creation is now fail-closed with a consistent error type, and the test coverage now checks the materialized note fields plus deck targeting path.

### 2026-04-15 - Start-of-Run (PR Branch Cleanup: Resolve Remaining Review Findings)
- Stage:
  - Stage 12 - Implement Anki New-Card Lifecycle.
- Run intent:
  - Patch the submitted PR branch so the remaining live review findings are fixed on the branch tip without merging into `main`.
- Current implementation state:
  - The PR branch still contains the older branch-specific teardown and runtime/test helper issues that were already resolved in `main`.
  - The branch also still carries the older template-validation, popup-copy, settings copy, and review-state fallback-comment wording from the original PR snapshot.
- Exact goal of this run:
  - Update only the branch code paths that still exhibit the reported defects.
  - Keep the branch review contract aligned with the addon/runtime behavior that the PR actually submits.
- Blockers or prerequisites already recorded:
  - No blocker is recorded.
- Risks/assumptions carried in:
  - Assumption: the PR branch should be made mergeable by fixing the live branch tip, not by merging `main` into it.
  - Risk: the branch may still have additional stale review comments after this fix pass, so validation should include lint/build/tests before pushing.

### 2026-04-15 - Completed (PR Branch Cleanup: Resolve Remaining Review Findings)
- Completed work:
  - Hardened `ManatanMangaParser.destroy()` so it aborts owned parse work before teardown and ignores late reparse callbacks while destruction is in progress.
  - Fixed `AnkiCollectionRuntime.get_deck_id()` to skip truthy decks without an id and avoid `int(None)`.
  - Replaced the test helper note stub with a real item-assignable fake note and added regression coverage for `create_note()` and `get_deck_id()`.
  - Validated Anki template targets before write-target normalization and logged unknown template strings instead of silently forwarding them.
  - Tightened the katakana-to-hiragana conversion helper so prolonged sound marks and only the directly mappable block are handled correctly.
  - Swapped the popup pending copy to the canonical `showAddToAnkiHint` flag.
  - Added the requested fallback comment in `getStateTagsFromCommitSnapshot()` and softened the settings copy to user-facing wording.
- Files changed:
  - `anki-addon/jiten_targeted_review/runtime.py`
  - `anki-addon/tests/test_runtime.py`
  - `src/apps/parser/custom-parsers/manatan-manga.parser.ts`
  - `src/apps/popup/popup.ts`
  - `src/background-worker/review-backend/anki-review-backend.ts`
  - `src/shared/anki/create-path-capability.ts`
  - `src/shared/anki/materialize-note-fields.ts`
  - `src/shared/anki/write-target.ts`
  - `src/views/settings.html`
  - `docs/implementation-working-log.md`
- Architectural decisions made:
  - Kept the branch fix narrow and branch-specific, rather than importing unrelated newer `main` lifecycle changes into the PR tip.
  - Used a real fake note object in tests so the regression covers the runtime's item-assignment contract instead of relying on instance-level special methods.
- Blockers / open issues:
  - No blocking issues remain from the reviewed branch findings.
  - The additive `api.types.ts` review comment was not changed because the branch's addon service still emits the existing codes the type currently models.
- Verification status:
  - `npm run lint` passes.
  - `npm run build` passes.
  - `py -3 -m unittest tests.test_runtime tests.test_service` passes in `anki-addon/`.
- Next recommended step:
  - Push the updated `codex-stage11-stage12` branch so the PR can be re-reviewed against the cleaned tip.
- Handoff:
  - The PR branch now has the real remaining issues fixed and is ready for another review pass without merging `main`.

### 2026-04-10 - Start-of-Run (Stage 12 Follow-up: Expose Sentence Attachment Preference)
- Stage:
  - Stage 12 - Implement Anki New-Card Lifecycle.
- Run intent:
  - Fix the Stage 12 usability gap where sentence-derived Anki note fields are gated by the shared `setSentences` preference, but that preference is not exposed in the normal settings UI.
- Current implementation state:
  - Stage 12 create-and-review already carries sentence/context through the popup, background, and note-field materialization layers.
  - The shared `setSentences` preference exists in configuration and is honoured by both Jiten-side sentence attachment and Anki create-and-review, but it currently defaults to `false` and has no visible settings control.
- Exact goal of this run:
  - Expose the shared sentence-attachment preference in the settings UI using the existing configuration binding flow.
  - Keep the preference shared across Jiten and Anki so Stage 12 continues to honour one user-level sentence-attachment model rather than inventing a backend-specific toggle.
  - Verify that the settings-page wiring persists the value cleanly and that lint/build still pass.
- Blockers or prerequisites already recorded:
  - No active blocker is recorded.
  - Stage 12 already depends on `setSentences` in code, so this run should stay narrow and avoid changing note-field materialization semantics again.
- Risks/assumptions carried in:
  - Assumption: the safest fix is to expose the existing shared preference rather than altering the Stage 12 write path to ignore it.
  - Risk: placing the checkbox in a confusing part of the settings page could make the shared Jiten/Anki scope unclear; mitigation is to use wording that explicitly mentions both mining and Anki note creation.

