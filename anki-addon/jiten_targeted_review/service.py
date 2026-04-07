from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from .contract import (
    ErrorPayload,
    RequestValidationError,
    TargetedReviewRequest,
    error_response,
    parse_request,
    success_response,
)

RATING_TO_EASE = {
    'again': 1,
    'hard': 2,
    'good': 3,
    'easy': 4,
}


class CardProtocol(Protocol):
    id: int
    nid: int
    did: int
    queue: int
    type: int
    due: int
    ivl: int
    reps: int
    lapses: int


class AnkiRuntime(Protocol):
    def get_card(self, card_id: int) -> CardProtocol | None:
        pass

    def answer_card(self, card: CardProtocol, ease: int) -> None:
        pass

    def get_deck_name(self, deck_id: int) -> str:
        pass


@dataclass(frozen=True)
class Reviewability:
    reviewable: bool
    reason: str | None = None


def _queue_to_review_state(queue: int) -> str:
    if queue in (1, 3, 4):
        return 'learning'
    if queue == 2:
        return 'review'
    if queue == 0:
        return 'new'
    if queue == -1:
        return 'suspended'
    if queue in (-2, -3):
        return 'buried'
    return 'unknown'


def _reviewability_for_queue(queue: int) -> Reviewability:
    if queue == -1:
        return Reviewability(False, 'suspended')
    if queue in (-2, -3):
        return Reviewability(False, 'buried')
    return Reviewability(True)


def _snapshot(card: CardProtocol, rating: str, ease: int, deck_name: str) -> dict[str, Any]:
    return {
        'cardId': int(card.id),
        'noteId': int(card.nid),
        'deckName': deck_name,
        'rating': rating,
        'ease': ease,
        'reviewState': _queue_to_review_state(int(card.queue)),
        'queue': int(card.queue),
        'type': int(card.type),
        'due': int(card.due),
        'interval': int(card.ivl),
        'reps': int(card.reps),
        'lapses': int(card.lapses),
    }


def handle_request(payload: Any, runtime: AnkiRuntime) -> dict[str, Any]:
    request_id = payload.get('requestId') if isinstance(payload, dict) else None
    version = payload.get('version') if isinstance(payload, dict) and isinstance(payload.get('version'), int) else 1

    try:
        request = parse_request(payload)
        return _apply_targeted_review(request, runtime)
    except RequestValidationError as err:
        return error_response(
            version=version,
            request_id=request_id if isinstance(request_id, str) else None,
            error=ErrorPayload(code=err.code, message=err.message, details=err.details),
        )
    except Exception as err:  # pragma: no cover - defensive outer guard
        return error_response(
            version=version,
            request_id=request_id if isinstance(request_id, str) else None,
            error=ErrorPayload(code='INTERNAL_ERROR', message='Unexpected internal error.', details={'error': str(err)}),
        )


def _apply_targeted_review(request: TargetedReviewRequest, runtime: AnkiRuntime) -> dict[str, Any]:
    target_card = runtime.get_card(request.card_id)
    if target_card is None:
        return error_response(
            version=request.version,
            request_id=request.request_id,
            error=ErrorPayload(
                code='CARD_NOT_FOUND',
                message=f'Card {request.card_id} was not found.',
                details={'cardId': request.card_id},
            ),
        )

    reviewability = _reviewability_for_queue(int(target_card.queue))
    if not reviewability.reviewable:
        return error_response(
            version=request.version,
            request_id=request.request_id,
            error=ErrorPayload(
                code='CARD_NOT_REVIEWABLE',
                message=f'Card {request.card_id} is not reviewable ({reviewability.reason}).',
                details={'cardId': request.card_id, 'reason': reviewability.reason},
            ),
        )

    ease = RATING_TO_EASE[request.rating]
    try:
        runtime.answer_card(target_card, ease)
    except Exception as err:
        err_text = str(err).strip()
        if 'not at top of queue' in err_text.lower():
            return error_response(
                version=request.version,
                request_id=request.request_id,
                error=ErrorPayload(
                    code='CARD_NOT_REVIEWABLE',
                    message=f'Card {request.card_id} is not reviewable (not_at_top_of_queue).',
                    details={'cardId': request.card_id, 'reason': 'not_at_top_of_queue'},
                ),
            )

        return error_response(
            version=request.version,
            request_id=request.request_id,
            error=ErrorPayload(
                code='APPLY_FAILED',
                message=f'Failed to apply rating to card {request.card_id}.',
                details={'cardId': request.card_id, 'error': err_text},
            ),
        )

    updated_card = runtime.get_card(request.card_id)
    if updated_card is None:
        return error_response(
            version=request.version,
            request_id=request.request_id,
            error=ErrorPayload(
                code='APPLY_FAILED',
                message='Review write succeeded but card could not be reloaded.',
                details={'cardId': request.card_id},
            ),
        )

    deck_name = runtime.get_deck_name(int(updated_card.did))
    result = _snapshot(updated_card, request.rating, ease, deck_name)
    return success_response(request, result=result)
