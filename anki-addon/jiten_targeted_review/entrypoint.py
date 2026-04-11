from __future__ import annotations

from collections.abc import Callable, MutableMapping
from typing import Any

from .runtime import AnkiCollectionRuntime
from .service import handle_commit_request, handle_request

ACTION_NAME = 'jitenTargetedReviewWriteV1'
COMMIT_ACTION_NAME = 'jitenTargetedReviewCommitV1'
COLLECTION_CREATION_TIME_ACTION_NAME = 'getCollectionCreationTime'


def handle_targeted_review_write(payload: dict[str, Any]) -> dict[str, Any]:
    # Runtime import is kept local so unit tests can run without Anki modules.
    from aqt import mw  # type: ignore

    runtime = AnkiCollectionRuntime(mw)
    return handle_request(payload, runtime)


def handle_targeted_review_commit(payload: dict[str, Any]) -> dict[str, Any]:
    from aqt import mw  # type: ignore

    runtime = AnkiCollectionRuntime(mw)
    return handle_commit_request(payload, runtime)


def handle_get_collection_creation_time() -> int:
    from aqt import mw  # type: ignore

    runtime = AnkiCollectionRuntime(mw)
    return runtime.get_collection_creation_time()


def register_action(actions: MutableMapping[str, Callable[..., Any]]) -> None:
    actions[ACTION_NAME] = handle_targeted_review_write
    actions[COMMIT_ACTION_NAME] = handle_targeted_review_commit
    actions[COLLECTION_CREATION_TIME_ACTION_NAME] = handle_get_collection_creation_time
