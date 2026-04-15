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
        """
        Get the name of the deck identified by deck_id.
        
        Returns:
            '' if no deck exists for the provided id, otherwise the deck's name as a string.
        """
        deck = self._mw.col.decks.get(deck_id)
        if not deck:
            return ''
        return str(deck.get('name', ''))

    def get_deck_id(self, deck_name: str) -> int | None:
        """
        Resolve a deck name to its numeric identifier.
        
        Parameters:
            deck_name (str): The deck name to look up.
        
        Returns:
            int: The deck id if a matching deck is found and its id can be converted to an integer, `None` otherwise.
        """
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
        """
        Obtain the collection's creation timestamp from the database or collection metadata.
        
        Checks multiple sources (database `crt`, `col.crt`, `col.created`) and returns the first available normalized timestamp.
        
        Returns:
            int: The collection creation timestamp as an integer. May be one of:
                - milliseconds since the Unix epoch,
                - seconds since the Unix epoch,
                - or an epoch-day value converted to seconds.
        
        Raises:
            RuntimeError: If no creation time is available from any source.
        """
        for candidate in (
            self._get_collection_creation_from_db(),
            self._normalise_collection_creation_time(getattr(self._mw.col, 'crt', None)),
            self._normalise_collection_creation_time(getattr(self._mw.col, 'created', None)),
        ):
            if candidate is not None:
                return candidate

        raise RuntimeError('Collection creation time is unavailable.')

    def get_model(self, model_name: str) -> Any | None:
        """
        Look up and return a model by its name from the collection's model manager.
        
        Parameters:
            model_name (str): The name of the model to locate.
        
        Returns:
            The model object if found, `None` otherwise.
        """
        model_manager = getattr(self._mw.col, 'models', None)

        if model_manager is None:
            return None

        for method_name in ('by_name', 'byName'):
            method = getattr(model_manager, method_name, None)
            if callable(method):
                return method(model_name)

        return None

    def create_note(self, model: Any, deck_id: int, note_fields: dict[str, str]) -> int:
        """
        Create a note from the given model, set its fields, add it to the specified deck, and return the created note's identifier.
        
        Parameters:
            model (Any): An Anki note model object used to instantiate the new note.
            deck_id (int): Identifier of the deck to which the note will be added.
            note_fields (dict[str, str]): Mapping of field names to their string values to populate on the note.
        
        Returns:
            int: The identifier of the created note.
        
        Raises:
            RuntimeError: If the created note's identifier is unavailable after adding the note.
        """
        note = self._mw.col.new_note(model)

        for field_name, field_value in note_fields.items():
            note[field_name] = field_value

        self._mw.col.add_note(note, deck_id)

        note_id = getattr(note, 'id', None) or getattr(note, 'nid', None)
        if not note_id:
            raise RuntimeError('Created note id was unavailable after add_note().')

        return int(note_id)

    def get_created_card(self, note_id: int, template_ord: int) -> Any | None:
        """
        Retrieve the card associated with a specific note and template ordinal.
        
        Parameters:
            note_id (int): The note's database id (nid) to search for.
            template_ord (int): The template ordinal (ord) within the note for the desired card.
        
        Returns:
            Any | None: The card object for the given note and template ordinal, or `None` if no matching card is found or a database error occurs.
        """
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
        """
        Return a normalized dictionary describing a card for inspection.
        
        @returns A dictionary containing card metadata:
        - 'cardId' (int): card identifier
        - 'noteId' (int): associated note identifier
        - 'deckName' (str): name of the deck containing the card
        - 'modelName' (str): name of the note type/model
        - 'templateOrd' (int): template ordinal for the card
        - 'templateName' (str): template name
        - 'reviewState' (str): human-readable review state derived from the queue
        - 'queue' (int): raw queue value
        - 'type' (int): card type value
        - 'due' (int): due value
        - 'interval' (int): interval in days
        - 'reps' (int): review count
        - 'lapses' (int): lapse count
        
        Returns `None` if the specified card does not exist.
        """
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
        """
        Fetch the collection's raw creation value from the database and return it normalized.
        
        Returns:
            int: Normalized collection creation time — either a millisecond epoch, a second epoch, or an epoch-day value converted to seconds — or `None` if the value is unavailable or cannot be read.
        """
        try:
            raw = self._mw.col.db.scalar('select crt from col')
        except Exception:
            return None

        return self._normalise_collection_creation_time(raw)

    @staticmethod
    def _normalise_collection_creation_time(raw: Any) -> int | None:
        """
        Normalize various collection creation time representations into a canonical epoch time.
        
        Accepts numeric values or numeric strings (whitespace trimmed). Ignores None and boolean inputs. Interprets the numeric value as one of:
        - millisecond epoch when value >= 1_000_000_000_000 (returned as-is),
        - second epoch when value >= 1_000_000_000 (returned as-is),
        - epoch-day number when value >= 10_000 (converted to seconds by multiplying by 86,400).
        
        Parameters:
            raw (Any): The raw creation time value to normalize; may be a number or string.
        
        Returns:
            int | None: An integer epoch time (milliseconds or seconds as described) when normalization succeeds, or `None` when the input is not a valid positive finite time representation.
        """
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
        """
        Map an Anki numeric queue value to a human-readable review state.
        
        Parameters:
            queue (int): Anki queue numeric code.
        
        Returns:
            review_state (str): One of 'learning', 'review', 'new', 'suspended', 'buried', or 'unknown'.
        """
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
