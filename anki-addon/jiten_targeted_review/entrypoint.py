from __future__ import annotations

from collections.abc import Callable, MutableMapping
from typing import Any

from .runtime import AnkiCollectionRuntime
from .service import handle_request

ACTION_NAME = 'jitenTargetedReviewWriteV1'


def handle_targeted_review_write(payload: dict[str, Any]) -> dict[str, Any]:
    # Runtime import is kept local so unit tests can run without Anki modules.
    from aqt import mw  # type: ignore

    runtime = AnkiCollectionRuntime(mw)
    return handle_request(payload, runtime)


def register_action(actions: MutableMapping[str, Callable[..., Any]]) -> None:
    actions[ACTION_NAME] = handle_targeted_review_write

