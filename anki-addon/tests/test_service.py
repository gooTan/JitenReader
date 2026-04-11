from __future__ import annotations

import unittest
from dataclasses import dataclass
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from jiten_targeted_review.service import handle_commit_request, handle_request


@dataclass
class FakeCard:
    id: int
    nid: int
    did: int
    queue: int
    type: int
    due: int
    ivl: int
    reps: int
    lapses: int
    model_name: str = 'Mining Model'
    template_ord: int = 0
    template_name: str = 'Card 1'


class FakeRuntime:
    def __init__(
        self,
        cards: dict[int, FakeCard],
        fail_apply: bool = False,
        fail_apply_message: str = 'scheduler error',
    ):
        self._cards = cards
        self._fail_apply = fail_apply
        self._fail_apply_message = fail_apply_message
        self.create_note_calls = 0

    def get_card(self, card_id: int) -> FakeCard | None:
        return self._cards.get(card_id)

    def answer_card(self, card: FakeCard, ease: int) -> None:
        if self._fail_apply:
            raise RuntimeError(self._fail_apply_message)
        card.reps += 1
        if ease == 1:
            card.lapses += 1
            card.queue = 1
            card.type = 1
            card.ivl = 0
        elif ease == 2:
            card.queue = 2
            card.type = 2
            card.ivl = max(card.ivl, 1)
        elif ease == 3:
            card.queue = 2
            card.type = 2
            card.ivl = max(card.ivl, 2)
        else:
            card.queue = 2
            card.type = 2
            card.ivl = max(card.ivl, 4)

    def get_deck_name(self, deck_id: int) -> str:
        return f'Deck {deck_id}'

    def get_model(self, model_name: str) -> str | None:
        return model_name if model_name == 'Mining Model' else None

    def get_deck_id(self, deck_name: str) -> int | None:
        if deck_name == 'Deck 3001':
            return 3001
        return None

    def create_note(self, model: str, deck_id: int, note_fields: dict[str, str]) -> int:
        self.create_note_calls += 1
        note_id = max([*self._cards.keys(), 1000]) + 100
        created_card = FakeCard(
            id=note_id + 1,
            nid=note_id,
            did=deck_id,
            model_name=model,
            template_ord=0,
            template_name='Card 1',
            queue=0,
            type=0,
            due=0,
            ivl=0,
            reps=0,
            lapses=0,
        )
        self._cards[created_card.id] = created_card

        return note_id

    def get_created_card(self, note_id: int, template_ord: int) -> FakeCard | None:
        for card in self._cards.values():
            if card.nid == note_id and card.template_ord == template_ord:
                return card
        return None

    def describe_card(self, card_id: int) -> dict[str, object] | None:
        card = self._cards.get(card_id)
        if card is None:
            return None

        review_state = 'new'
        if card.queue in (1, 3, 4):
            review_state = 'learning'
        elif card.queue == 2:
            review_state = 'review'
        elif card.queue == -1:
            review_state = 'suspended'
        elif card.queue in (-2, -3):
            review_state = 'buried'

        return {
            'cardId': card.id,
            'noteId': card.nid,
            'deckName': self.get_deck_name(card.did),
            'modelName': card.model_name,
            'templateOrd': card.template_ord,
            'templateName': card.template_name,
            'reviewState': review_state,
            'queue': card.queue,
            'type': card.type,
            'due': card.due,
            'interval': card.ivl,
            'reps': card.reps,
            'lapses': card.lapses,
        }


class TargetedReviewServiceTests(unittest.TestCase):
    def test_successful_review_write(self) -> None:
        runtime = FakeRuntime(
            {
                1001: FakeCard(
                    id=1001,
                    nid=2001,
                    did=3001,
                    queue=2,
                    type=2,
                    due=42,
                    ivl=10,
                    reps=4,
                    lapses=1,
                )
            }
        )

        response = handle_request(
            {
                'version': 1,
                'requestId': 'req-1',
                'cardId': 1001,
                'rating': 'good',
            },
            runtime,
        )

        self.assertTrue(response['success'])
        self.assertEqual(response['requestId'], 'req-1')
        self.assertEqual(response['result']['cardId'], 1001)
        self.assertEqual(response['result']['rating'], 'good')
        self.assertEqual(response['result']['ease'], 3)
        self.assertEqual(response['result']['reps'], 5)

    def test_invalid_rating(self) -> None:
        runtime = FakeRuntime({})
        response = handle_request(
            {
                'version': 1,
                'cardId': 1001,
                'rating': 'meh',
            },
            runtime,
        )
        self.assertFalse(response['success'])
        self.assertEqual(response['error']['code'], 'INVALID_RATING')

    def test_bool_values_are_rejected_for_integer_fields(self) -> None:
        runtime = FakeRuntime({})

        response_with_bool_version = handle_request(
            {
                'version': True,
                'cardId': 1001,
                'rating': 'good',
            },
            runtime,
        )
        self.assertFalse(response_with_bool_version['success'])
        self.assertEqual(response_with_bool_version['error']['code'], 'INVALID_REQUEST')
        self.assertEqual(response_with_bool_version['version'], 1)
        self.assertIsInstance(response_with_bool_version['version'], int)

        response_with_bool_card_id = handle_request(
            {
                'version': 1,
                'cardId': True,
                'rating': 'good',
            },
            runtime,
        )
        self.assertFalse(response_with_bool_card_id['success'])
        self.assertEqual(response_with_bool_card_id['error']['code'], 'INVALID_CARD_ID')

    def test_card_not_found(self) -> None:
        runtime = FakeRuntime({})
        response = handle_request(
            {
                'version': 1,
                'cardId': 9999,
                'rating': 'again',
            },
            runtime,
        )
        self.assertFalse(response['success'])
        self.assertEqual(response['error']['code'], 'CARD_NOT_FOUND')

    def test_card_not_reviewable_when_suspended(self) -> None:
        runtime = FakeRuntime(
            {
                5001: FakeCard(
                    id=5001,
                    nid=6001,
                    did=7001,
                    queue=-1,
                    type=2,
                    due=42,
                    ivl=10,
                    reps=4,
                    lapses=1,
                )
            }
        )
        response = handle_request(
            {
                'version': 1,
                'cardId': 5001,
                'rating': 'hard',
            },
            runtime,
        )
        self.assertFalse(response['success'])
        self.assertEqual(response['error']['code'], 'CARD_NOT_REVIEWABLE')

    def test_apply_failed(self) -> None:
        runtime = FakeRuntime(
            {
                1010: FakeCard(
                    id=1010,
                    nid=2010,
                    did=3010,
                    queue=2,
                    type=2,
                    due=42,
                    ivl=10,
                    reps=4,
                    lapses=1,
                )
            },
            fail_apply=True,
        )
        response = handle_request(
            {
                'version': 1,
                'cardId': 1010,
                'rating': 'easy',
            },
            runtime,
        )
        self.assertFalse(response['success'])
        self.assertEqual(response['error']['code'], 'APPLY_FAILED')

    def test_not_due_scheduler_rejection_maps_to_card_not_reviewable(self) -> None:
        runtime = FakeRuntime(
            {
                2020: FakeCard(
                    id=2020,
                    nid=3020,
                    did=4020,
                    queue=2,
                    type=2,
                    due=42,
                    ivl=10,
                    reps=4,
                    lapses=1,
                )
            },
            fail_apply=True,
            fail_apply_message='Card is not due yet.',
        )

        response = handle_request(
            {
                'version': 1,
                'cardId': 2020,
                'rating': 'good',
            },
            runtime,
        )

        self.assertFalse(response['success'])
        self.assertEqual(response['error']['code'], 'CARD_NOT_REVIEWABLE')
        self.assertEqual(response['error']['details']['reason'], 'not_due')

    def test_commit_reviews_existing_card(self) -> None:
        runtime = FakeRuntime(
            {
                1001: FakeCard(
                    id=1001,
                    nid=2001,
                    did=3001,
                    queue=0,
                    type=0,
                    due=0,
                    ivl=0,
                    reps=0,
                    lapses=0,
                )
            }
        )

        response = handle_commit_request(
            {
                'version': 1,
                'requestId': 'commit-existing',
                'term': {
                    'key': '1/0',
                    'wordId': 1,
                    'readingIndex': 0,
                    'spelling': '猫',
                    'reading': 'ねこ',
                },
                'rating': 'good',
                'target': {
                    'kind': 'existing-card',
                    'cardId': 1001,
                },
            },
            runtime,
        )

        self.assertTrue(response['success'])
        self.assertEqual(response['result']['transaction'], 'reviewed-existing')
        self.assertEqual(response['result']['cardId'], 1001)

    def test_commit_creates_then_reviews_exact_template_card(self) -> None:
        runtime = FakeRuntime({})

        response = handle_commit_request(
            {
                'version': 1,
                'requestId': 'commit-create',
                'term': {
                    'key': '1/0',
                    'wordId': 1,
                    'readingIndex': 0,
                    'spelling': '猫',
                    'reading': 'ねこ',
                },
                'rating': 'again',
                'target': {
                    'kind': 'create-and-review',
                    'writeTarget': {
                        'deck': 'Deck 3001',
                        'model': 'Mining Model',
                        'wordField': 'Expression',
                        'readingField': 'Reading',
                        'cardTemplateOrd': 0,
                    },
                    'noteFields': {
                        'Expression': '猫',
                        'Reading': 'ねこ',
                        'Sentence': '猫が好きです。',
                    },
                    'sentenceFieldCount': 1,
                },
            },
            runtime,
        )

        self.assertTrue(response['success'])
        self.assertEqual(response['result']['transaction'], 'created-and-reviewed')
        self.assertEqual(response['result']['sentenceFieldCount'], 1)
        self.assertEqual(response['result']['templateOrd'], 0)

    def test_commit_returns_model_not_found(self) -> None:
        runtime = FakeRuntime({})

        response = handle_commit_request(
            {
                'version': 1,
                'term': {
                    'key': '1/0',
                    'wordId': 1,
                    'readingIndex': 0,
                    'spelling': '猫',
                    'reading': 'ねこ',
                },
                'rating': 'good',
                'target': {
                    'kind': 'create-and-review',
                    'writeTarget': {
                        'deck': 'Deck 3001',
                        'model': 'Missing Model',
                        'wordField': 'Expression',
                        'readingField': 'Reading',
                        'cardTemplateOrd': 0,
                    },
                    'noteFields': {
                        'Expression': '猫',
                    },
                    'sentenceFieldCount': 0,
                },
            },
            runtime,
        )

        self.assertFalse(response['success'])
        self.assertEqual(response['error']['code'], 'MODEL_NOT_FOUND')

    def test_commit_request_id_is_idempotent_for_create_and_review(self) -> None:
        runtime = FakeRuntime({})
        payload = {
            'version': 1,
            'requestId': 'commit-idempotent',
            'term': {
                'key': '1/0',
                'wordId': 1,
                'readingIndex': 0,
                'spelling': '猫',
                'reading': 'ねこ',
            },
            'rating': 'again',
            'target': {
                'kind': 'create-and-review',
                'writeTarget': {
                    'deck': 'Deck 3001',
                    'model': 'Mining Model',
                    'wordField': 'Expression',
                    'readingField': 'Reading',
                    'cardTemplateOrd': 0,
                },
                'noteFields': {
                    'Expression': '猫',
                    'Reading': 'ねこ',
                },
                'sentenceFieldCount': 0,
            },
        }

        first_response = handle_commit_request(payload, runtime)
        second_response = handle_commit_request(payload, runtime)

        self.assertTrue(first_response['success'])
        self.assertEqual(first_response, second_response)
        self.assertEqual(runtime.create_note_calls, 1)


if __name__ == '__main__':
    unittest.main()
