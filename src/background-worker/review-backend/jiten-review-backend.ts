import { getConfiguration } from '@shared/configuration/get-configuration';
import { addVocabulary } from '@shared/jiten/add-vocabulary';
import { createReviewMetadata } from '@shared/jiten/create-review-metadata';
import { getCardState } from '@shared/jiten/get-card-state';
import { mapReviewStates } from '@shared/jiten/map-review-states';
import { removeVocabulary } from '@shared/jiten/remove-vocabulary';
import { request } from '@shared/jiten/request';
import { review } from '@shared/jiten/review';
import { ResolveReviewability } from '@shared/jiten/reviewability';
import { setCardSentence } from '@shared/jiten/set-card-sentence';
import { JitenCardState, JitenRawVocabulary, JitenRating } from '@shared/jiten/types';
import {
  ReviewBackend,
  ReviewBackendCapabilities,
  ReviewCardStateContext,
  ReviewGradeContext,
  ReviewDeck,
  ReviewDeckAction,
  ReviewTermResolutionMap,
} from './review-backend.types';

const JITEN_REVIEW_BACKEND_CAPABILITIES: ReviewBackendCapabilities = {
  supportsDeckActions: true,
  supportsSentenceAttach: true,
};

export class JitenReviewBackend implements ReviewBackend {
  public getCapabilities(): ReviewBackendCapabilities {
    return JITEN_REVIEW_BACKEND_CAPABILITIES;
  }

  public getParseReviewStates(vocabulary: JitenRawVocabulary[]): Promise<ReviewTermResolutionMap> {
    const states: ReviewTermResolutionMap = {};

    for (const { wordId, readingIndex, knownState } of vocabulary) {
      const stateTags = mapReviewStates(knownState, JitenCardState.MATURE);
      const dueState = stateTags.includes(JitenCardState.DUE) ? 'due' : 'notDue';
      const key = `${wordId}/${readingIndex}`;

      states[key] = {
        stateTags,
        resolutionStatus: 'resolved',
        mappingOutcome: 'selected',
        dueState,
        target: {
          key,
          wordId,
          readingIndex,
        },
      };
    }

    return Promise.resolve(states);
  }

  public getCardState(
    wordId: number,
    readingIndex: number,
    _context?: ReviewCardStateContext,
  ): ReturnType<typeof getCardState> {
    return getCardState(wordId, readingIndex);
  }

  public gradeCard(
    wordId: number,
    readingIndex: number,
    rating: JitenRating,
    _context?: ReviewGradeContext,
  ): Promise<void> {
    return review(rating, wordId, readingIndex);
  }

  public getGradeReviewability(
    wordId: number,
    readingIndex: number,
    _context?: ReviewGradeContext,
  ): Promise<ReturnType<typeof ResolveReviewability>> {
    return Promise.resolve(
      ResolveReviewability({
        createPathAvailable: false,
        reviewMetadata: createReviewMetadata({
          backend: 'jiten',
          wordId,
          readingIndex,
          stateTags: [],
          freshness: 'fresh',
          actionsAvailable: true,
          resolutionStatus: 'resolved',
          mappingOutcome: 'selected',
          dueState: 'unknown',
        }),
      }),
    );
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
