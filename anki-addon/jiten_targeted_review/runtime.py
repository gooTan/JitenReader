from __future__ import annotations

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
