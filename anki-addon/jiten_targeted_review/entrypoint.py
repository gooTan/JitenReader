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
    """
    Handle a targeted review write request and apply it to the Anki collection runtime.
    
    Parameters:
        payload (dict[str, Any]): The request payload describing the targeted review write operation.
    
    Returns:
        dict[str, Any]: Response payload with the outcome of processing the write request.
    """
    from aqt import mw  # type: ignore

    runtime = AnkiCollectionRuntime(mw)
    return handle_request(payload, runtime)


def handle_targeted_review_commit(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Handle a targeted review commit request using the current Anki collection runtime.
    
    Parameters:
        payload (dict[str, Any]): Request payload for the commit operation; contains the data required by the commit handler.
    
    Returns:
        dict[str, Any]: Response object describing the result of the commit operation.
    """
    from aqt import mw  # type: ignore

    runtime = AnkiCollectionRuntime(mw)
    return handle_commit_request(payload, runtime)


def handle_get_collection_creation_time() -> int:
    """
    Get the current Anki collection's creation time as a Unix timestamp.
    
    Returns:
        creation_time (int): Seconds since the Unix epoch when the collection was created.
    """
    from aqt import mw  # type: ignore

    runtime = AnkiCollectionRuntime(mw)
    return runtime.get_collection_creation_time()


def register_action(actions: MutableMapping[str, Callable[..., Any]]) -> None:
    """
    Register entrypoint handlers into the provided actions mapping.
    
    This function mutates the given mapping by adding three action handlers keyed by their action names:
    - jitenTargetedReviewWriteV1 -> handle_targeted_review_write
    - jitenTargetedReviewCommitV1 -> handle_targeted_review_commit
    - getCollectionCreationTime -> handle_get_collection_creation_time
    
    Parameters:
        actions (MutableMapping[str, Callable[..., Any]]): Mapping to populate with action name -> handler callables.
    """
    actions[ACTION_NAME] = handle_targeted_review_write
    actions[COMMIT_ACTION_NAME] = handle_targeted_review_commit
    actions[COLLECTION_CREATION_TIME_ACTION_NAME] = handle_get_collection_creation_time
