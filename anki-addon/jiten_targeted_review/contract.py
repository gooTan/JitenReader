from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping

SUPPORTED_VERSION = 1
VALID_RATINGS = {'again', 'hard', 'good', 'easy'}


@dataclass(frozen=True)
class TargetedReviewRequest:
    version: int
    card_id: int
    rating: str
    request_id: str | None = None


@dataclass(frozen=True)
class ReviewTerm:
    key: str
    word_id: int
    reading_index: int
    spelling: str
    reading: str


@dataclass(frozen=True)
class ExistingCardTarget:
    kind: str
    card_id: int


@dataclass(frozen=True)
class CreateAndReviewTarget:
    kind: str
    deck: str
    model: str
    word_field: str
    reading_field: str
    card_template_ord: int
    note_fields: dict[str, str]
    sentence_field_count: int


@dataclass(frozen=True)
class TargetedReviewCommitRequest:
    version: int
    request_id: str | None
    term: ReviewTerm
    rating: str
    target: ExistingCardTarget | CreateAndReviewTarget


@dataclass(frozen=True)
class ErrorPayload:
    code: str
    message: str
    details: Mapping[str, Any] | None = None


class RequestValidationError(ValueError):
    def __init__(self, code: str, message: str, details: Mapping[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details


def _is_strict_int(value: Any) -> bool:
    """
    Check whether a value is an integer excluding booleans.
    
    Returns:
        True if `value` is an `int` but not a `bool`, False otherwise.
    """
    return isinstance(value, int) and not isinstance(value, bool)


def _require_string_mapping(
    payload: Mapping[str, Any],
    field_name: str,
) -> Mapping[str, Any]:
    """
    Retrieve the value for `field_name` from `payload` and require that it is a mapping.
    
    Parameters:
        payload (Mapping[str, Any]): Source mapping to read from.
        field_name (str): Key to look up in `payload`.
    
    Returns:
        Mapping[str, Any]: The mapping stored at `payload[field_name]`.
    
    Raises:
        RequestValidationError: If the field is missing or its value is not a mapping. The error uses code `'INVALID_REQUEST'` and message `Field "<field_name>" must be an object.`.
    """
    value = payload.get(field_name)

    if not isinstance(value, Mapping):
        raise RequestValidationError(
            'INVALID_REQUEST',
            f'Field "{field_name}" must be an object.',
        )

    return value


def _require_string(value: Any, field_name: str) -> str:
    """
    Validate that a value is a string and return it.
    
    Parameters:
        value: The value to validate.
        field_name (str): Field name used in the error message if validation fails.
    
    Returns:
        str: The validated string value.
    
    Raises:
        RequestValidationError: With code "INVALID_REQUEST" and message `Field "<field_name>" must be a string.` when `value` is not a `str`.
    """
    if not isinstance(value, str):
        raise RequestValidationError(
            'INVALID_REQUEST',
            f'Field "{field_name}" must be a string.',
        )

    return value


def parse_request(payload: Any) -> TargetedReviewRequest:
    """
    Validate and parse a mapping payload into a TargetedReviewRequest.
    
    Parameters:
        payload (Any): The incoming request payload expected to be a mapping (object) containing keys:
            - "version": integer equal to SUPPORTED_VERSION
            - "cardId": positive integer
            - "rating": string (will be trimmed and lowercased; must be one of VALID_RATINGS)
            - optional "requestId": string
    
    Returns:
        TargetedReviewRequest: A dataclass containing the validated and normalized request fields
            (version, card_id, rating, request_id).
    
    Raises:
        RequestValidationError: If the payload is not a mapping, if required fields are missing or of the wrong type,
            if the version is unsupported, if cardId is not a positive integer, if rating is invalid, or if requestId
            is present but not a string.
    """
    if not isinstance(payload, Mapping):
        raise RequestValidationError('INVALID_REQUEST', 'Payload must be an object.')

    version = payload.get('version')
    if not _is_strict_int(version):
        raise RequestValidationError('INVALID_REQUEST', 'Field "version" must be an integer.')

    if version != SUPPORTED_VERSION:
        raise RequestValidationError(
            'UNSUPPORTED_VERSION',
            f'Unsupported version {version}. Supported version is {SUPPORTED_VERSION}.',
            {'version': version, 'supportedVersion': SUPPORTED_VERSION},
        )

    card_id = payload.get('cardId')
    if not _is_strict_int(card_id) or card_id <= 0:
        raise RequestValidationError('INVALID_CARD_ID', 'Field "cardId" must be a positive integer.', {'cardId': card_id})

    rating = payload.get('rating')
    if not isinstance(rating, str):
        raise RequestValidationError('INVALID_RATING', 'Field "rating" must be a string.', {'rating': rating})

    normalized_rating = rating.strip().lower()
    if normalized_rating not in VALID_RATINGS:
        raise RequestValidationError(
            'INVALID_RATING',
            f'Invalid rating "{rating}". Expected one of again/hard/good/easy.',
            {'rating': rating, 'validRatings': sorted(VALID_RATINGS)},
        )

    request_id = payload.get('requestId')
    if request_id is not None and not isinstance(request_id, str):
        raise RequestValidationError('INVALID_REQUEST', 'Field "requestId" must be a string when present.')

    return TargetedReviewRequest(
        version=version,
        card_id=card_id,
        rating=normalized_rating,
        request_id=request_id,
    )


def parse_commit_request(payload: Any) -> TargetedReviewCommitRequest:
    """
    Parse a raw commit request payload into a validated TargetedReviewCommitRequest.
    
    Parameters:
        payload (Any): The incoming request payload expected to be a mapping with keys like
            "version", optional "requestId", "rating", "term", and "target".
    
    Returns:
        TargetedReviewCommitRequest: Object containing the validated version, optional request_id,
        parsed ReviewTerm, normalized rating (lowercased and trimmed), and a parsed target
        (ExistingCardTarget or CreateAndReviewTarget).
    
    Raises:
        RequestValidationError: If the payload is not an object, the version is unsupported or not
        an integer, required fields are missing or of the wrong type, ratings are invalid, term
        fields are invalid, or the target is malformed or has invalid values.
    """
    if not isinstance(payload, Mapping):
        raise RequestValidationError('INVALID_REQUEST', 'Payload must be an object.')

    version = payload.get('version')
    if not _is_strict_int(version):
        raise RequestValidationError('INVALID_REQUEST', 'Field "version" must be an integer.')

    if version != SUPPORTED_VERSION:
        raise RequestValidationError(
            'UNSUPPORTED_VERSION',
            f'Unsupported version {version}. Supported version is {SUPPORTED_VERSION}.',
            {'version': version, 'supportedVersion': SUPPORTED_VERSION},
        )

    request_id = payload.get('requestId')
    if request_id is not None and not isinstance(request_id, str):
        raise RequestValidationError('INVALID_REQUEST', 'Field "requestId" must be a string when present.')

    rating = payload.get('rating')
    if not isinstance(rating, str):
        raise RequestValidationError('INVALID_RATING', 'Field "rating" must be a string.', {'rating': rating})

    normalized_rating = rating.strip().lower()
    if normalized_rating not in VALID_RATINGS:
        raise RequestValidationError(
            'INVALID_RATING',
            f'Invalid rating "{rating}". Expected one of again/hard/good/easy.',
            {'rating': rating, 'validRatings': sorted(VALID_RATINGS)},
        )

    raw_term = _require_string_mapping(payload, 'term')
    term = ReviewTerm(
        key=_require_string(raw_term.get('key'), 'term.key'),
        word_id=_parse_positive_or_zero_int(raw_term.get('wordId'), 'term.wordId'),
        reading_index=_parse_positive_or_zero_int(raw_term.get('readingIndex'), 'term.readingIndex'),
        spelling=_require_string(raw_term.get('spelling'), 'term.spelling'),
        reading=_require_string(raw_term.get('reading'), 'term.reading'),
    )

    raw_target = _require_string_mapping(payload, 'target')
    kind = _require_string(raw_target.get('kind'), 'target.kind').strip()

    if kind == 'existing-card':
        card_id = raw_target.get('cardId')
        if not _is_strict_int(card_id) or card_id <= 0:
            raise RequestValidationError(
                'INVALID_CARD_ID',
                'Field "target.cardId" must be a positive integer.',
                {'cardId': card_id},
            )

        parsed_target: ExistingCardTarget | CreateAndReviewTarget = ExistingCardTarget(
            kind=kind,
            card_id=card_id,
        )
    elif kind == 'create-and-review':
        raw_write_target = _require_string_mapping(raw_target, 'writeTarget')
        raw_note_fields = _require_string_mapping(raw_target, 'noteFields')
        sentence_field_count = raw_target.get('sentenceFieldCount', 0)

        if not _is_strict_int(sentence_field_count) or sentence_field_count < 0:
            raise RequestValidationError(
                'INVALID_REQUEST',
                'Field "target.sentenceFieldCount" must be a non-negative integer.',
            )

        note_fields: dict[str, str] = {}
        for field_name, field_value in raw_note_fields.items():
            if not isinstance(field_name, str) or not isinstance(field_value, str):
                raise RequestValidationError(
                    'INVALID_REQUEST',
                    'Field "target.noteFields" must be a string-to-string map.',
                )
            note_fields[field_name] = field_value

        card_template_ord = raw_write_target.get('cardTemplateOrd')
        if not _is_strict_int(card_template_ord) or card_template_ord < 0:
            raise RequestValidationError(
                'INVALID_TARGET',
                'Field "target.writeTarget.cardTemplateOrd" must be a non-negative integer.',
            )

        parsed_target = CreateAndReviewTarget(
            kind=kind,
            deck=_require_string(raw_write_target.get('deck'), 'target.writeTarget.deck'),
            model=_require_string(raw_write_target.get('model'), 'target.writeTarget.model'),
            word_field=_require_string(raw_write_target.get('wordField'), 'target.writeTarget.wordField'),
            reading_field=_require_string(raw_write_target.get('readingField'), 'target.writeTarget.readingField'),
            card_template_ord=card_template_ord,
            note_fields=note_fields,
            sentence_field_count=sentence_field_count,
        )
    else:
        raise RequestValidationError(
            'INVALID_TARGET',
            f'Unsupported target kind "{kind}".',
        )

    return TargetedReviewCommitRequest(
        version=version,
        request_id=request_id,
        term=term,
        rating=normalized_rating,
        target=parsed_target,
    )


def _parse_positive_or_zero_int(value: Any, field_name: str) -> int:
    """
    Validate that `value` is a strict integer greater than or equal to zero and return it.
    
    Parameters:
        value (Any): The value to validate as a non-negative integer.
        field_name (str): The field name used in the error message when validation fails.
    
    Returns:
        int: The validated non-negative integer.
    
    Raises:
        RequestValidationError: With code 'INVALID_REQUEST' if `value` is not a strict int or is negative.
    """
    if not _is_strict_int(value) or value < 0:
        raise RequestValidationError(
            'INVALID_REQUEST',
            f'Field "{field_name}" must be a non-negative integer.',
        )

    return value


def success_response(
    request: TargetedReviewRequest,
    result: Mapping[str, Any],
) -> dict[str, Any]:
    """
    Builds a standardized success response payload for a targeted review request.
    
    Parameters:
        request (TargetedReviewRequest): The original validated request; its `version` is included and `request_id` is added as `requestId` when present.
        result (Mapping[str, Any]): Result data to include in the response; converted to a plain dict.
    
    Returns:
        dict[str, Any]: Response object with keys:
            - `success`: True
            - `version`: the request version
            - `result`: the provided result as a dict
            - `requestId` (optional): included when `request.request_id` is not None
    """
    response: dict[str, Any] = {
        'success': True,
        'version': request.version,
        'result': dict(result),
    }
    if request.request_id is not None:
        response['requestId'] = request.request_id
    return response


def error_response(
    version: int,
    request_id: str | None,
    error: ErrorPayload,
) -> dict[str, Any]:
    response: dict[str, Any] = {
        'success': False,
        'version': version,
        'error': {
            'code': error.code,
            'message': error.message,
        },
    }
    if request_id is not None:
        response['requestId'] = request_id
    if error.details is not None:
        response['error']['details'] = dict(error.details)
    return response
