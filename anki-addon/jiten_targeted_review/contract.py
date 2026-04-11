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
    return isinstance(value, int) and not isinstance(value, bool)


def _require_string_mapping(
    payload: Mapping[str, Any],
    field_name: str,
) -> Mapping[str, Any]:
    value = payload.get(field_name)

    if not isinstance(value, Mapping):
        raise RequestValidationError(
            'INVALID_REQUEST',
            f'Field "{field_name}" must be an object.',
        )

    return value


def _require_string(value: Any, field_name: str) -> str:
    if not isinstance(value, str):
        raise RequestValidationError(
            'INVALID_REQUEST',
            f'Field "{field_name}" must be a string.',
        )

    return value


def parse_request(payload: Any) -> TargetedReviewRequest:
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
