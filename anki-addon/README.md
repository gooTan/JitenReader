# JitenReader Anki Add-on (Stage 8A)

This component provides an Anki-side handler for **targeted review writes** against a specific card ID.

It is intentionally separate from the browser extension build.

## Stage scope

This add-on covers Stage 8A only:

- request/response contract for targeted review writes
- payload validation
- card existence/reviewability validation
- applying Again/Hard/Good/Easy to the exact target card
- deterministic success/failure responses with post-review state

It does not include extension-side wiring (Stage 8B).

## Request contract (`jitenTargetedReviewWriteV1`)

```json
{
  "version": 1,
  "requestId": "optional-string",
  "cardId": 1234567890,
  "rating": "again"
}
```

- `version`: required, currently `1`
- `requestId`: optional opaque correlation string (echoed back)
- `cardId`: required positive integer
- `rating`: required, one of `again`, `hard`, `good`, `easy`

## Response contract

Success:

```json
{
  "success": true,
  "version": 1,
  "requestId": "optional-string",
  "result": {
    "cardId": 1234567890,
    "noteId": 123456789,
    "deckName": "My Deck",
    "rating": "again",
    "ease": 1,
    "reviewState": "learning",
    "queue": 1,
    "type": 1,
    "due": 123,
    "interval": 0,
    "reps": 42,
    "lapses": 5
  }
}
```

Failure:

```json
{
  "success": false,
  "version": 1,
  "requestId": "optional-string",
  "error": {
    "code": "CARD_NOT_FOUND",
    "message": "Card 123 was not found.",
    "details": {
      "cardId": 123
    }
  }
}
```

## Error codes

- `INVALID_REQUEST`
- `UNSUPPORTED_VERSION`
- `INVALID_CARD_ID`
- `INVALID_RATING`
- `CARD_NOT_FOUND`
- `CARD_NOT_REVIEWABLE`
- `APPLY_FAILED`
- `INTERNAL_ERROR`

## Files

- `jiten_targeted_review/entrypoint.py`: add-on request handler entrypoint and action registration helper
- `jiten_targeted_review/service.py`: core targeted review logic
- `jiten_targeted_review/contract.py`: request validation and response helpers
- `jiten_targeted_review/runtime.py`: runtime adapter for Anki collection/scheduler
- `tests/test_service.py`: isolated unit tests for core behavior

## Integration note

This component exposes a pure Python handler:

- action name: `jitenTargetedReviewWriteV1`
- handler: `jiten_targeted_review.entrypoint.handle_targeted_review_write`

AnkiConnect (or another local bridge) should route the custom action payload to this handler.

## Minimal verification

Run:

```bash
python -m unittest anki-addon/tests/test_service.py
```

