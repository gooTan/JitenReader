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
