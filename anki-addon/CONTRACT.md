# Targeted Review Contract v1

## Action name

`jitenTargetedReviewWriteV1`

## Request

```ts
type TargetedReviewWriteRequestV1 = {
  version: 1;
  requestId?: string;
  cardId: number; // positive integer
  rating: 'again' | 'hard' | 'good' | 'easy';
};
```

## Success response

```ts
type TargetedReviewWriteSuccessV1 = {
  success: true;
  version: 1;
  requestId?: string;
  result: {
    cardId: number;
    noteId: number;
    deckName: string;
    rating: 'again' | 'hard' | 'good' | 'easy';
    ease: 1 | 2 | 3 | 4;
    reviewState: 'new' | 'learning' | 'review' | 'suspended' | 'buried' | 'unknown';
    queue: number;
    type: number;
    due: number;
    interval: number;
    reps: number;
    lapses: number;
  };
};
```

## Error response

```ts
type TargetedReviewWriteErrorV1 = {
  success: false;
  version: 1;
  requestId?: string;
  error: {
    code:
      | 'INVALID_REQUEST'
      | 'UNSUPPORTED_VERSION'
      | 'INVALID_CARD_ID'
      | 'INVALID_RATING'
      | 'CARD_NOT_FOUND'
      | 'CARD_NOT_REVIEWABLE'
      | 'APPLY_FAILED'
      | 'INTERNAL_ERROR';
    message: string;
    details?: Record<string, unknown>;
  };
};
```

## Notes

- The operation targets the exact `cardId`.
- It does not require or depend on Anki GUI reviewer selection state.
- `CARD_NOT_REVIEWABLE` is currently returned for suspended/buried queues and scheduler rejection cases such as `not_at_top_of_queue`.
