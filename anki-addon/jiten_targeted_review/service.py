from __future__ import annotations

from collections import OrderedDict
from copy import deepcopy
from dataclasses import dataclass
from threading import Event, Lock
from typing import Any, Protocol

from .contract import (
    CreateAndReviewTarget,
    ErrorPayload,
    ExistingCardTarget,
    RequestValidationError,
    SUPPORTED_VERSION,
    TargetedReviewCommitRequest,
    TargetedReviewRequest,
    error_response,
    parse_commit_request,
    parse_request,
    success_response,
)

RATING_TO_EASE = {
    'again': 1,
    'hard': 2,
    'good': 3,
    'easy': 4,
}
MAX_COMMIT_CACHE_SIZE = 256
_commit_cache_lock = Lock()
_commit_response_cache: OrderedDict[str, dict[str, Any]] = OrderedDict()
_commit_inflight_events: dict[str, Event] = {}


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

    def get_model(self, model_name: str) -> Any | None:
        pass

    def get_deck_id(self, deck_name: str) -> int | None:
        pass

    def create_note(self, model: Any, deck_id: int, note_fields: dict[str, str]) -> int:
        pass

    def get_created_card(self, note_id: int, template_ord: int) -> CardProtocol | None:
        pass

    def describe_card(self, card_id: int) -> dict[str, Any] | None:
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


def _scheduler_non_reviewable_reason(error_text: str) -> str | None:
    normalised = error_text.lower()

    if 'top of queue' in normalised:
        return 'not_at_top_of_queue'

    if 'not due' in normalised or 'due in' in normalised:
        return 'not_due'

    if 'suspend' in normalised:
        return 'suspended'

    if 'buried' in normalised or 'bury' in normalised:
        return 'buried'

    return None


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


def _extract_error_version(payload: Any) -> int:
    if not isinstance(payload, dict):
        return SUPPORTED_VERSION

    version = payload.get('version')
    if isinstance(version, bool) or not isinstance(version, int):
        return SUPPORTED_VERSION

    return version


def handle_request(payload: Any, runtime: AnkiRuntime) -> dict[str, Any]:
    request_id = payload.get('requestId') if isinstance(payload, dict) else None
    version = _extract_error_version(payload)

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


def handle_commit_request(payload: Any, runtime: AnkiRuntime) -> dict[str, Any]:
    request_id = payload.get('requestId') if isinstance(payload, dict) else None
    version = _extract_error_version(payload)
    cache_key = request_id if isinstance(request_id, str) and request_id else None

    if cache_key is not None:
        cached_response = _get_cached_commit_response(cache_key)
        if cached_response is not None:
            return cached_response

        should_execute, wait_event = _register_commit_request(cache_key)
        if not should_execute:
            wait_event.wait()
            cached_response = _get_cached_commit_response(cache_key)
            if cached_response is not None:
                return cached_response

            return error_response(
                version=version,
                request_id=cache_key,
                error=ErrorPayload(
                    code='INTERNAL_ERROR',
                    message='The previous Anki commit result was unavailable after waiting for completion.',
                ),
            )

    try:
        request = parse_commit_request(payload)
        response = _apply_targeted_review_commit(request, runtime)
        if cache_key is not None:
            _store_cached_commit_response(cache_key, response)
        return response
    except RequestValidationError as err:
        response = error_response(
            version=version,
            request_id=request_id if isinstance(request_id, str) else None,
            error=ErrorPayload(code=err.code, message=err.message, details=err.details),
        )
        if cache_key is not None:
            _store_cached_commit_response(cache_key, response)
        return response
    except Exception as err:  # pragma: no cover - defensive outer guard
        response = error_response(
            version=version,
            request_id=request_id if isinstance(request_id, str) else None,
            error=ErrorPayload(code='INTERNAL_ERROR', message='Unexpected internal error.', details={'error': str(err)}),
        )
        if cache_key is not None:
            _store_cached_commit_response(cache_key, response)
        return response
    finally:
        if cache_key is not None:
            _complete_commit_request(cache_key)


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
        non_reviewable_reason = _scheduler_non_reviewable_reason(err_text)

        if non_reviewable_reason is not None:
            return error_response(
                version=request.version,
                request_id=request.request_id,
                error=ErrorPayload(
                    code='CARD_NOT_REVIEWABLE',
                    message=f'Card {request.card_id} is not reviewable ({non_reviewable_reason}).',
                    details={'cardId': request.card_id, 'reason': non_reviewable_reason},
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


def _apply_targeted_review_commit(
    request: TargetedReviewCommitRequest,
    runtime: AnkiRuntime,
) -> dict[str, Any]:
    if isinstance(request.target, ExistingCardTarget):
        target_card = runtime.get_card(request.target.card_id)
        if target_card is None:
            return error_response(
                version=request.version,
                request_id=request.request_id,
                error=ErrorPayload(
                    code='CARD_NOT_FOUND',
                    message=f'Card {request.target.card_id} was not found.',
                    details={'cardId': request.target.card_id},
                ),
            )

        return _answer_and_snapshot(
            request,
            runtime,
            target_card,
            transaction='reviewed-existing',
            sentence_field_count=0,
        )

    return _create_answer_and_snapshot(request, runtime, request.target)


def _create_answer_and_snapshot(
    request: TargetedReviewCommitRequest,
    runtime: AnkiRuntime,
    target: CreateAndReviewTarget,
) -> dict[str, Any]:
    model = runtime.get_model(target.model)
    if model is None:
        return error_response(
            version=request.version,
            request_id=request.request_id,
            error=ErrorPayload(
                code='MODEL_NOT_FOUND',
                message=f'Anki model "{target.model}" was not found.',
                details={'modelName': target.model},
            ),
        )

    deck_id = runtime.get_deck_id(target.deck)
    if deck_id is None:
        return error_response(
            version=request.version,
            request_id=request.request_id,
            error=ErrorPayload(
                code='DECK_NOT_FOUND',
                message=f'Anki deck "{target.deck}" was not found.',
                details={'deckName': target.deck},
            ),
        )

    try:
        note_id = runtime.create_note(model, deck_id, target.note_fields)
    except Exception as err:
        return error_response(
            version=request.version,
            request_id=request.request_id,
            error=ErrorPayload(
                code='NOTE_CREATE_FAILED',
                message='Failed to create the Anki note.',
                details={'error': str(err)},
            ),
        )

    created_card = runtime.get_created_card(note_id, target.card_template_ord)
    if created_card is None:
        return error_response(
            version=request.version,
            request_id=request.request_id,
            error=ErrorPayload(
                code='CREATED_CARD_NOT_FOUND',
                message='The created Anki card could not be resolved.',
                details={'noteId': note_id, 'templateOrd': target.card_template_ord},
            ),
        )

    return _answer_and_snapshot(
        request,
        runtime,
        created_card,
        transaction='created-and-reviewed',
        sentence_field_count=target.sentence_field_count,
    )


def _answer_and_snapshot(
    request: TargetedReviewCommitRequest,
    runtime: AnkiRuntime,
    card: CardProtocol,
    transaction: str,
    sentence_field_count: int,
) -> dict[str, Any]:
    reviewability = _reviewability_for_queue(int(card.queue))
    if not reviewability.reviewable:
        return error_response(
            version=request.version,
            request_id=request.request_id,
            error=ErrorPayload(
                code='CARD_NOT_REVIEWABLE',
                message=f'Card {card.id} is not reviewable ({reviewability.reason}).',
                details={'cardId': card.id, 'reason': reviewability.reason},
            ),
        )

    ease = RATING_TO_EASE[request.rating]
    try:
        runtime.answer_card(card, ease)
    except Exception as err:
        err_text = str(err).strip()
        non_reviewable_reason = _scheduler_non_reviewable_reason(err_text)

        if non_reviewable_reason is not None:
            return error_response(
                version=request.version,
                request_id=request.request_id,
                error=ErrorPayload(
                    code='CARD_NOT_REVIEWABLE',
                    message=f'Card {card.id} is not reviewable ({non_reviewable_reason}).',
                    details={'cardId': card.id, 'reason': non_reviewable_reason},
                ),
            )

        return error_response(
            version=request.version,
            request_id=request.request_id,
            error=ErrorPayload(
                code='APPLY_FAILED',
                message=f'Failed to apply rating to card {card.id}.',
                details={'cardId': card.id, 'error': err_text},
            ),
        )

    description = runtime.describe_card(int(card.id))
    if description is None:
        return error_response(
            version=request.version,
            request_id=request.request_id,
            error=ErrorPayload(
                code='APPLY_FAILED',
                message='Review write succeeded but card could not be reloaded.',
                details={'cardId': int(card.id)},
            ),
        )

    return success_response(
        request,
        result={
            'transaction': transaction,
            'cardId': description['cardId'],
            'noteId': description['noteId'],
            'deckName': description['deckName'],
            'modelName': description['modelName'],
            'templateOrd': description['templateOrd'],
            'templateName': description.get('templateName'),
            'rating': request.rating,
            'ease': ease,
            'reviewState': description['reviewState'],
            'queue': description['queue'],
            'type': description['type'],
            'due': description['due'],
            'interval': description['interval'],
            'reps': description['reps'],
            'lapses': description['lapses'],
            'sentenceFieldCount': sentence_field_count,
        },
    )


def _get_cached_commit_response(request_id: str) -> dict[str, Any] | None:
    with _commit_cache_lock:
        cached = _commit_response_cache.get(request_id)
        if cached is None:
            return None

        _commit_response_cache.move_to_end(request_id)

        return deepcopy(cached)


def _register_commit_request(request_id: str) -> tuple[bool, Event]:
    with _commit_cache_lock:
        existing_event = _commit_inflight_events.get(request_id)
        if existing_event is not None:
            return False, existing_event

        event = Event()
        _commit_inflight_events[request_id] = event

        return True, event


def _store_cached_commit_response(request_id: str, response: dict[str, Any]) -> None:
    with _commit_cache_lock:
        _commit_response_cache[request_id] = deepcopy(response)
        _commit_response_cache.move_to_end(request_id)

        while len(_commit_response_cache) > MAX_COMMIT_CACHE_SIZE:
            _commit_response_cache.popitem(last=False)


def _complete_commit_request(request_id: str) -> None:
    with _commit_cache_lock:
        event = _commit_inflight_events.pop(request_id, None)

    if event is not None:
        event.set()
