import { getConfiguration } from '@shared/configuration/get-configuration';
import { addVocabulary } from '@shared/jiten/add-vocabulary';
import { getCardState } from '@shared/jiten/get-card-state';
import { removeVocabulary } from '@shared/jiten/remove-vocabulary';
import { request } from '@shared/jiten/request';
import { review } from '@shared/jiten/review';
import { setCardSentence } from '@shared/jiten/set-card-sentence';
import { JitenRating } from '@shared/jiten/types';
import {
  ReviewBackend,
  ReviewBackendCapabilities,
  ReviewDeck,
  ReviewDeckAction,
} from './review-backend.types';

const JITEN_REVIEW_BACKEND_CAPABILITIES: ReviewBackendCapabilities = {
  supportsDeckActions: true,
  supportsSentenceAttach: true,
};

export class JitenReviewBackend implements ReviewBackend {
  public getCapabilities(): ReviewBackendCapabilities {
    return JITEN_REVIEW_BACKEND_CAPABILITIES;
  }

  public getCardState(wordId: number, readingIndex: number): ReturnType<typeof getCardState> {
    return getCardState(wordId, readingIndex);
  }

  public gradeCard(wordId: number, readingIndex: number, rating: JitenRating): Promise<void> {
    return review(rating, wordId, readingIndex);
  }

  public forgetCard(wordId: number, readingIndex: number): Promise<void> {
    return request('srs/set-vocabulary-state', {
      wordId,
      readingIndex,
      state: 'forget-add',
    });
  }

  public async runDeckAction(
    wordId: number,
    readingIndex: number,
    deck: ReviewDeck,
    action: ReviewDeckAction,
    sentence?: string,
  ): Promise<void> {
    const fn = action === 'add' ? addVocabulary : removeVocabulary;

    await fn(deck, wordId, readingIndex);

    if (action !== 'add' || deck !== 'mining' || !sentence?.length) {
      return;
    }

    const addSentence = await getConfiguration('setSentences');

    if (!addSentence) {
      return;
    }

    await setCardSentence(wordId, readingIndex, sentence);
  }
}
