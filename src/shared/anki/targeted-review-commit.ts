import { JitenRating } from '@shared/jiten/types';
import { AnkiRequestOptions, TargetedReviewCommitResponse } from './api.types';
import { request } from './request';

export type TargetedReviewCommitRating = Exclude<JitenRating, 'unknown'>;

export type TargetedReviewCommitRequestPayload = {
  version: 1;
  requestId?: string;
  term: {
    key: string;
    wordId: number;
    readingIndex: number;
    spelling: string;
    reading: string;
  };
  rating: TargetedReviewCommitRating;
  target:
    | {
        kind: 'existing-card';
        cardId: number;
      }
    | {
        kind: 'create-and-review';
        writeTarget: {
          deck: string;
          model: string;
          wordField: string;
          readingField: string;
          cardTemplateOrd: number;
        };
        noteFields: Record<string, string>;
        sentenceFieldCount: number;
      };
};

export const targetedReviewCommit = (
  payload: TargetedReviewCommitRequestPayload,
  options?: AnkiRequestOptions,
): Promise<TargetedReviewCommitResponse> => {
  return request('jitenTargetedReviewCommitV1', payload, options);
};
