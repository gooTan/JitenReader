from __future__ import annotations

import math
from typing import Any


class AnkiCollectionRuntime:
    def __init__(self, mw_obj: Any):
        self._mw = mw_obj

    def _card_exists(self, card_id: int) -> bool | None:
        try:
            row = self._mw.col.db.scalar('select 1 from cards where id = ?', card_id)
        except Exception:
            return None

        return bool(row)

    @staticmethod
    def _looks_like_missing_card_error(error_text: str) -> bool:
        normalised = error_text.lower()

        if 'no such card' in normalised:
            return True

        if 'card' in normalised and 'not found' in normalised:
            return True

        return False

    def get_card(self, card_id: int) -> Any | None:
        exists = self._card_exists(card_id)
        if exists is False:
            return None

        try:
            return self._mw.col.get_card(card_id)
        except Exception as err:
            # Prefer DB-backed existence checks for deterministic not-found
            # normalization. Fallback to message pattern only when DB probe
            # is unavailable in this runtime context.
            if exists is None and self._looks_like_missing_card_error(str(err)):
                return None
            raise

    def answer_card(self, card: Any, ease: int) -> None:
        # Use scheduler APIs directly on the target card ID. This does not rely
        # on the current GUI reviewer selection.
        # Reviewer flow starts a per-card timer before answering; when called
        # outside reviewer context we need to initialise that timer explicitly.
        if hasattr(card, 'start_timer'):
            card.start_timer()
        self._mw.col.sched.answerCard(card, ease)

    def get_deck_name(self, deck_id: int) -> str:
        deck = self._mw.col.decks.get(deck_id)
        if not deck:
            return ''
        return str(deck.get('name', ''))

    def get_deck_id(self, deck_name: str) -> int | None:
        deck_manager = getattr(self._mw.col, 'decks', None)

        if deck_manager is None:
            return None

        for method_name in ('by_name', 'byName'):
            method = getattr(deck_manager, method_name, None)
            if not callable(method):
                continue

            deck = method(deck_name)
            if not deck:
                continue

            if not hasattr(deck, 'get'):
                continue

            id_val = deck.get('id')
            if id_val is None:
                continue

            try:
                return int(id_val)
            except (TypeError, ValueError):
                continue

        return None

    def get_collection_creation_time(self) -> int:
        for candidate in (
            self._get_collection_creation_from_db(),
            self._normalise_collection_creation_time(getattr(self._mw.col, 'crt', None)),
            self._normalise_collection_creation_time(getattr(self._mw.col, 'created', None)),
        ):
            if candidate is not None:
                return candidate

        raise RuntimeError('Collection creation time is unavailable.')

    def get_model(self, model_name: str) -> Any | None:
        model_manager = getattr(self._mw.col, 'models', None)

        if model_manager is None:
            return None

        for method_name in ('by_name', 'byName'):
            method = getattr(model_manager, method_name, None)
            if callable(method):
                return method(model_name)

        return None

    def create_note(self, model: Any, deck_id: int, note_fields: dict[str, str]) -> int:
        note = self._mw.col.new_note(model)

        for field_name, field_value in note_fields.items():
            note[field_name] = field_value

        self._mw.col.add_note(note, deck_id)

        note_id = getattr(note, 'id', None) or getattr(note, 'nid', None)
        if not note_id:
            raise RuntimeError('Created note id was unavailable after add_note().')

        return int(note_id)

    def get_created_card(self, note_id: int, template_ord: int) -> Any | None:
        try:
            card_id = self._mw.col.db.scalar(
                'select id from cards where nid = ? and ord = ?',
                note_id,
                template_ord,
            )
        except Exception:
            return None

        if not card_id:
            return None

        return self.get_card(int(card_id))

    def describe_card(self, card_id: int) -> dict[str, Any] | None:
        card = self.get_card(card_id)
        if card is None:
            return None

        note = card.note()
        template = card.template()
        note_type = note.note_type() if hasattr(note, 'note_type') else note.model()

        return {
            'cardId': int(card.id),
            'noteId': int(card.nid),
            'deckName': self.get_deck_name(int(card.did)),
            'modelName': str(note_type.get('name', '')),
            'templateOrd': int(template.get('ord', getattr(card, 'ord', 0))),
            'templateName': str(template.get('name', '')),
            'reviewState': self._queue_to_review_state(int(card.queue)),
            'queue': int(card.queue),
            'type': int(card.type),
            'due': int(card.due),
            'interval': int(card.ivl),
            'reps': int(card.reps),
            'lapses': int(card.lapses),
        }

    def _get_collection_creation_from_db(self) -> int | None:
        try:
            raw = self._mw.col.db.scalar('select crt from col')
        except Exception:
            return None

        return self._normalise_collection_creation_time(raw)

    @staticmethod
    def _normalise_collection_creation_time(raw: Any) -> int | None:
        if raw is None:
            return None

        if isinstance(raw, bool):
            return None

        if isinstance(raw, str):
            raw = raw.strip()
            if not raw:
                return None

        try:
            numeric = float(raw)
        except (TypeError, ValueError):
            return None

        if not math.isfinite(numeric) or numeric <= 0:
            return None

        value = int(numeric)

        # Millisecond epoch.
        if value >= 1_000_000_000_000:
            return value

        # Second epoch.
        if value >= 1_000_000_000:
            return value

        # Epoch day number.
        if value >= 10_000:
            return value * 86_400

        return None

    @staticmethod
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
