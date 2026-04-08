from __future__ import annotations

import inspect
import sys
from types import ModuleType
from typing import Any, Callable

try:
    from aqt import gui_hooks
    from aqt.qt import QTimer
except ModuleNotFoundError:  # pragma: no cover - unit tests run without Anki runtime
    gui_hooks = None
    QTimer = None

from .entrypoint import (
    ACTION_NAME,
    COLLECTION_CREATION_TIME_ACTION_NAME,
    handle_get_collection_creation_time,
    handle_targeted_review_write,
    register_action,
)

REQUEST_HANDLER_PATCH_FLAG = '_jiten_targeted_review_handler_patched'


def _find_anki_connect_module() -> ModuleType | None:
    for module in tuple(sys.modules.values()):
        if module is None:
            continue

        anki_connect = getattr(module, 'AnkiConnect', None)
        util = getattr(module, 'util', None)

        if not inspect.isclass(anki_connect):
            continue

        if util is None or not hasattr(util, 'api'):
            continue

        return module

    return None


def _register_action_with_anki_connect() -> bool:
    module = _find_anki_connect_module()

    if module is None:
        return False

    anki_connect_cls = getattr(module, 'AnkiConnect')
    util = getattr(module, 'util')

    if not hasattr(anki_connect_cls, ACTION_NAME):
        def targeted_review_write_v1(
            self: Any,
            version: int = 1,
            cardId: int | None = None,
            rating: str | None = None,
            requestId: str | None = None,
            **_kwargs: Any,
        ) -> dict[str, Any]:
            payload: dict[str, Any] = {
                'version': version,
                'cardId': cardId,
                'rating': rating,
            }

            if requestId is not None:
                payload['requestId'] = requestId

            return handle_targeted_review_write(payload)

        targeted_review_write_v1.__name__ = ACTION_NAME
        setattr(anki_connect_cls, ACTION_NAME, util.api()(targeted_review_write_v1))

    if not hasattr(anki_connect_cls, COLLECTION_CREATION_TIME_ACTION_NAME):
        def get_collection_creation_time_v1(
            self: Any,
            **_kwargs: Any,
        ) -> int:
            return handle_get_collection_creation_time()

        get_collection_creation_time_v1.__name__ = COLLECTION_CREATION_TIME_ACTION_NAME
        setattr(anki_connect_cls, COLLECTION_CREATION_TIME_ACTION_NAME, util.api()(get_collection_creation_time_v1))

    return True


def _patch_anki_connect_handler() -> bool:
    module = _find_anki_connect_module()

    if module is None:
        return False

    anki_connect_instance = getattr(module, 'ac', None)

    if anki_connect_instance is None:
        return False

    if getattr(anki_connect_instance, REQUEST_HANDLER_PATCH_FLAG, False):
        return True

    original_handler: Callable[[dict[str, Any]], dict[str, Any]] = anki_connect_instance.handler
    web = getattr(module, 'web', None)

    if web is None:
        return False

    def patched_handler(request: dict[str, Any]) -> dict[str, Any]:
        action = request.get('action', '')

        if action != ACTION_NAME:
            return original_handler(request)

        version = request.get('version', 4)
        params = request.get('params', {}) or {}

        try:
            key = request.get('key')
            expected_key = module.util.setting('apiKey')
            if key != expected_key:
                raise Exception('valid api key must be provided')

            if not isinstance(params, dict):
                raise Exception('params must be an object')

            result = handle_targeted_review_write(params)
            return web.format_success_reply(version, result)
        except Exception as err:
            return web.format_exception_reply(version, err)

    anki_connect_instance.handler = patched_handler

    if getattr(anki_connect_instance, 'server', None) is not None:
        anki_connect_instance.server.handler = patched_handler

    setattr(anki_connect_instance, REQUEST_HANDLER_PATCH_FLAG, True)

    return True


def _bootstrap_registration(attempt: int = 0) -> None:
    if QTimer is None:
        return

    action_registered = _register_action_with_anki_connect()
    handler_patched = _patch_anki_connect_handler()

    if action_registered and handler_patched:
        return

    if attempt >= 240:
        # If one integration path is still unavailable after bounded retries,
        # keep whichever successful path we have and stop retrying.
        return

    QTimer.singleShot(250, lambda: _bootstrap_registration(attempt + 1))


if QTimer is not None:
    _bootstrap_registration()

if gui_hooks is not None:
    gui_hooks.profile_did_open.append(lambda: _bootstrap_registration())

__all__ = ['ACTION_NAME', 'handle_targeted_review_write', 'register_action']
