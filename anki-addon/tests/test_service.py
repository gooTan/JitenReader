from __future__ import annotations

import unittest
from dataclasses import dataclass
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from jiten_targeted_review.service import handle_request


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


if __name__ == '__main__':
    unittest.main()
