import { JitenRequestOptions } from './api.types';
import { mapReviewStates } from './map-review-states';
import { request } from './request';
import { JitenCardState } from './types';

export const getCardState = async (
  wordId: number,
  readingIndex: number,
  options?: JitenRequestOptions,
): Promise<JitenCardState[]> => {
  const result = await request(
    'reader/lookup-vocabulary',
    {
      words: [[wordId, readingIndex]],
    },
    options,
  );
  const [firstWord] = result.result;

  if (!Array.isArray(firstWord) || firstWord.length === 0) {
    return [JitenCardState.NEW];
  }

  return mapReviewStates(firstWord, JitenCardState.NEW);
};
