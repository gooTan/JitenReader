from __future__ import annotations

import unittest
from pathlib import Path
from types import SimpleNamespace
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from jiten_targeted_review.runtime import AnkiCollectionRuntime


class _FakeDb:
    def __init__(self, scalar_result: object = 0, should_raise: bool = False):
        self._scalar_result = scalar_result
        self._should_raise = should_raise

    def scalar(self, _query: str, _card_id: int) -> object:
        if self._should_raise:
            raise RuntimeError('db unavailable')
        return self._scalar_result


class _FakeCol:
    def __init__(self, db: _FakeDb, card: object | None = None, get_card_error: Exception | None = None):
        self.db = db
        self._card = card
        self._get_card_error = get_card_error

    def get_card(self, _card_id: int) -> object | None:
        if self._get_card_error is not None:
            raise self._get_card_error
        return self._card


class RuntimeTests(unittest.TestCase):
    def test_get_card_returns_none_when_db_says_missing(self) -> None:
        mw = SimpleNamespace(col=_FakeCol(db=_FakeDb(scalar_result=0), get_card_error=RuntimeError('unexpected')))
        runtime = AnkiCollectionRuntime(mw)

        self.assertIsNone(runtime.get_card(999))

    def test_get_card_returns_none_when_db_probe_unavailable_but_error_is_missing_card(self) -> None:
        mw = SimpleNamespace(
            col=_FakeCol(
                db=_FakeDb(should_raise=True),
                get_card_error=RuntimeError('Card not found: 999'),
            )
        )
        runtime = AnkiCollectionRuntime(mw)

        self.assertIsNone(runtime.get_card(999))

    def test_get_card_raises_when_db_says_exists_but_get_card_fails(self) -> None:
        mw = SimpleNamespace(col=_FakeCol(db=_FakeDb(scalar_result=1), get_card_error=RuntimeError('storage failure')))
        runtime = AnkiCollectionRuntime(mw)

        with self.assertRaisesRegex(RuntimeError, 'storage failure'):
            runtime.get_card(1001)


if __name__ == '__main__':
    unittest.main()
