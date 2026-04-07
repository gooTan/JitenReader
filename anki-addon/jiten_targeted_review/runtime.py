from __future__ import annotations

from typing import Any


class AnkiCollectionRuntime:
    def __init__(self, mw_obj: Any):
        self._mw = mw_obj

    def get_card(self, card_id: int) -> Any | None:
        try:
            return self._mw.col.get_card(card_id)
        except Exception as err:
            # Anki raises when the card ID does not exist; normalize this to
            # a None return so the service emits CARD_NOT_FOUND deterministically.
            if 'No such card' in str(err):
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
