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
        """
        Get the display name for the deck with the given ID.
        
        Returns:
            The deck's display name.
        """
        pass

    def get_model(self, model_name: str) -> Any | None:
        """
        Retrieve the model object for the given model name.
        
        Parameters:
            model_name (str): The name of the model to look up.
        
        Returns:
            The model object if found, or None if no model with that name exists.
        """
        pass

    def get_deck_id(self, deck_name: str) -> int | None:
        """
        Resolve a deck name to its internal numeric deck ID.
        
        Parameters:
            deck_name (str): The user-visible deck name to look up.
        
        Returns:
            int: The numeric deck ID if the deck exists.
            None: If no deck with the given name is found.
        """
        pass

    def create_note(self, model: Any, deck_id: int, note_fields: dict[str, str]) -> int:
        """
        Create a new note in the specified deck using the given model and field values.
        
        Parameters:
            model (Any): The Anki model object (note type) to use for the new note.
            deck_id (int): The integer ID of the deck where the note should be created.
            note_fields (dict[str, str]): Mapping of field names to their string values for the new note.
        
        Returns:
            int: The ID of the newly created note.
        """
        pass

    def get_created_card(self, note_id: int, template_ord: int) -> CardProtocol | None:
        """
        Finds the card created for a given note and template ordinal.
        
        Parameters:
            note_id (int): The note's database identifier.
            template_ord (int): Zero-based ordinal of the card template within the note's model.
        
        Returns:
            CardProtocol | None: The card matching the note and template ordinal, or `None` if no such card exists.
        """
        pass

    def describe_card(self, card_id: int) -> dict[str, Any] | None:
        """
        Fetch detailed scheduling and template metadata for a card by its internal card id.
        
        Parameters:
            card_id (int): The Anki internal card id to describe.
        
        Returns:
            dict[str, Any] | None: A dictionary with the card's scheduling and template metadata (for example: deck/model/template identifiers and names, `queue`, `type`, `due`, `interval`, `reps`, `lapses`, and related fields) if the card exists; `None` if the card cannot be found.
        """
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
    """
    Parse and apply a targeted-review request payload using the given runtime and return the resulting response.
    
    Parameters:
        payload (Any): The raw incoming request payload (typically a dict) to be parsed as a targeted-review request.
        runtime (AnkiRuntime): Runtime implementation used to fetch and modify Anki state required by the request.
    
    Returns:
        dict[str, Any]: A response dictionary that always includes `version` and may include `requestId`. On success the response contains a `result`. If the payload fails validation the response contains an `error` with `code`, `message`, and `details` derived from the validation error. On unexpected failures the response contains an `error` with code `INTERNAL_ERROR` and `details` including the exception text.
    """
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
    """
    Handle a targeted review commit request, applying the commit (which may create notes and answer cards) and returning a success or error response.
    
    When the incoming payload contains a non-empty string `requestId`, the handler will deduplicate concurrent identical commit requests and cache the resulting response keyed by that `requestId` so subsequent requests can reuse it. Validation errors produce an error response populated from the validation failure; unexpected exceptions produce an `INTERNAL_ERROR` response.
    
    Parameters:
        payload (Any): The raw request payload received from the client; typically a dict representing a TargetedReviewCommitRequest.
        runtime (AnkiRuntime): Runtime interface used to resolve models/decks, create notes, fetch and answer cards, and describe cards.
    
    Returns:
        dict[str, Any]: A response payload representing either a success_response with result data or an error_response containing `version`, optional `requestId`, and an `ErrorPayload`.
    """
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
    """
    Apply the requested rating to the targeted existing card and produce a protocol response.
    
    Attempts to locate the card, verify it is reviewable, apply the mapped ease value, reload the card,
    and return a success response containing the updated card snapshot. On failure returns an error
    response indicating the problem.
    
    Returns:
        dict[str, Any]: A protocol response dictionary. On success this is a `success_response` whose
        `result` contains the updated card snapshot. On failure this is an `error_response` with one
        of these error codes and associated details:
          - `CARD_NOT_FOUND`: the specified card id does not exist.
          - `CARD_NOT_REVIEWABLE`: the card is not reviewable (includes a `reason` detail).
          - `APPLY_FAILED`: applying the rating or reloading the card failed (includes error details).
    """
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
    """
    Apply a targeted review commit: if the request targets an existing card, answer that card; otherwise create the note/card and answer the created card.
    
    Returns:
        A response dictionary representing either a success_response with the commit result or an error_response. If the request targets an existing card that cannot be found, the response will be an error_response with code 'CARD_NOT_FOUND' and details containing the missing `cardId`.
    """
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
    """
    Create an Anki note from the given creation target, resolve the created card, answer that card with the requested rating, and return the resulting commit response.
    
    If the referenced model or deck cannot be resolved, or note creation or card resolution fails, returns an error_response with one of these codes: `MODEL_NOT_FOUND`, `DECK_NOT_FOUND`, `NOTE_CREATE_FAILED`, or `CREATED_CARD_NOT_FOUND`. On success, delegates to _answer_and_snapshot to produce the final success_response.
    
    Parameters:
        target (CreateAndReviewTarget): Creation details including `model`, `deck`, `note_fields`, `card_template_ord`, and `sentence_field_count`.
    
    Returns:
        dict[str, Any]: A response dictionary representing either an error_response (with error payload and details) or a success_response containing the created-and-reviewed result.
    """
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
    """
    Apply the given rating to the specified card and return a response containing the post-review snapshot or a structured error.
    
    Parameters:
        request (TargetedReviewCommitRequest): The commit request carrying version, request_id, and rating.
        runtime (AnkiRuntime): Runtime used to apply the answer and to describe the card after the review.
        card (CardProtocol): The target card to answer.
        transaction (str): An identifier describing the transaction type written into the result (`'reviewed-existing'` or `'created-and-reviewed'`).
        sentence_field_count (int): Number of sentence fields from the creation target to include in the result.
    
    Returns:
        dict[str, Any]: On success, a success response whose `result` contains:
            - `transaction`, `cardId`, `noteId`, `deckName`, `modelName`, `templateOrd`, optional `templateName`
            - `rating`, `ease`
            - scheduling fields: `reviewState`, `queue`, `type`, `due`, `interval`, `reps`, `lapses`
            - `sentenceFieldCount`
        On failure, an error response with one of:
            - `CARD_NOT_REVIEWABLE` when the card is not reviewable before answering or when the scheduler reports a non-reviewable reason after attempting to answer.
            - `APPLY_FAILED` when applying the rating fails for other reasons or when the post-answer card description cannot be loaded.
    """
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
    """
    Retrieve a cached commit response for the given request ID and mark it as most-recently-used.
    
    Parameters:
        request_id (str): The cache key identifying a commit request.
    
    Returns:
        dict[str, Any] | None: A deep copy of the cached response for request_id if present, otherwise `None`.
    """
    with _commit_cache_lock:
        cached = _commit_response_cache.get(request_id)
        if cached is None:
            return None

        _commit_response_cache.move_to_end(request_id)

        return deepcopy(cached)


def _register_commit_request(request_id: str) -> tuple[bool, Event]:
    """
    Register an inflight commit request for the given request_id, creating and storing a new Event if one does not already exist.
    
    Parameters:
        request_id (str): Identifier for the commit request used to deduplicate concurrent work.
    
    Returns:
        tuple[bool, Event]: A pair where the boolean is `True` when a new Event was created and the caller is responsible for performing the work; `False` when an existing Event was found. The returned Event may be waited on by callers that did not create it.
    """
    with _commit_cache_lock:
        existing_event = _commit_inflight_events.get(request_id)
        if existing_event is not None:
            return False, existing_event

        event = Event()
        _commit_inflight_events[request_id] = event

        return True, event


def _store_cached_commit_response(request_id: str, response: dict[str, Any]) -> None:
    """
    Store a deep-copied commit response in the LRU commit-response cache and evict oldest entries when the cache exceeds its maximum size.
    
    Parameters:
        request_id (str): The requestId key under which to store the response.
        response (dict[str, Any]): The commit response payload to cache (a deep copy will be stored).
    """
    with _commit_cache_lock:
        _commit_response_cache[request_id] = deepcopy(response)
        _commit_response_cache.move_to_end(request_id)

        while len(_commit_response_cache) > MAX_COMMIT_CACHE_SIZE:
            _commit_response_cache.popitem(last=False)


def _complete_commit_request(request_id: str) -> None:
    """
    Mark a commit request as complete and notify any waiters.
    
    Parameters:
        request_id (str): Identifier of the commit request whose inflight event should be completed.
            If no inflight event exists for the given id, the function does nothing.
    """
    with _commit_cache_lock:
        event = _commit_inflight_events.pop(request_id, None)

    if event is not None:
        event.set()
