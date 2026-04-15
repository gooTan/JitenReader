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

    def scalar(self, _query: str, *_args: object) -> object:
        if self._should_raise:
            raise RuntimeError('db unavailable')
        return self._scalar_result


class _FakeCol:
    def __init__(
        self,
        db: _FakeDb,
        card: object | None = None,
        get_card_error: Exception | None = None,
        crt: object | None = None,
        created: object | None = None,
    ):
        self.db = db
        self._card = card
        self._get_card_error = get_card_error
        self.crt = crt
        self.created = created

    def get_card(self, _card_id: int) -> object | None:
        if self._get_card_error is not None:
            raise self._get_card_error
        return self._card

    def new_note(self, _model: object) -> object:
        class _FakeNote(dict):
            def __init__(self) -> None:
                super().__init__()
                self.id = 4321
                self.nid = 4321

        return _FakeNote()

    def add_note(self, _note: object, _deck_id: int) -> None:
        return None


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

    def test_get_collection_creation_time_prefers_db_value(self) -> None:
        mw = SimpleNamespace(col=_FakeCol(db=_FakeDb(scalar_result=1_708_637_439), crt=12345))
        runtime = AnkiCollectionRuntime(mw)

        self.assertEqual(runtime.get_collection_creation_time(), 1_708_637_439)

    def test_get_collection_creation_time_falls_back_to_epoch_day_cst(self) -> None:
        mw = SimpleNamespace(col=_FakeCol(db=_FakeDb(should_raise=True), crt=19_000))
        runtime = AnkiCollectionRuntime(mw)

        self.assertEqual(runtime.get_collection_creation_time(), 19_000 * 86_400)

    def test_get_collection_creation_time_raises_when_unavailable(self) -> None:
        mw = SimpleNamespace(col=_FakeCol(db=_FakeDb(should_raise=True), crt=None, created=None))
        runtime = AnkiCollectionRuntime(mw)

        with self.assertRaisesRegex(RuntimeError, 'Collection creation time is unavailable'):
            runtime.get_collection_creation_time()

    def test_get_model_returns_none_when_models_manager_missing(self) -> None:
        mw = SimpleNamespace(col=SimpleNamespace(db=_FakeDb(scalar_result=1)))
        runtime = AnkiCollectionRuntime(mw)

        self.assertIsNone(runtime.get_model('Mining Model'))

    def test_create_note_supports_item_assignment_and_returns_note_id(self) -> None:
        mw = SimpleNamespace(col=_FakeCol(db=_FakeDb()))
        runtime = AnkiCollectionRuntime(mw)

        self.assertEqual(runtime.create_note(SimpleNamespace(), 42, {'front': 'value'}), 4321)

    def test_get_deck_id_returns_none_when_deck_lacks_id(self) -> None:
        mw = SimpleNamespace(col=SimpleNamespace(decks=SimpleNamespace(by_name=lambda _name: {'name': 'Mining'})))
        runtime = AnkiCollectionRuntime(mw)

        self.assertIsNone(runtime.get_deck_id('Mining'))


if __name__ == '__main__':
    unittest.main()
