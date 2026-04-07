import { JitenRating } from '@shared/jiten/types';
import { AnkiRequestOptions, TargetedReviewWriteResponse } from './api.types';
import { request } from './request';

export type TargetedReviewWriteRating = Exclude<JitenRating, 'unknown'>;

export type TargetedReviewWriteRequestPayload = {
  version: 1;
  cardId: number;
  rating: TargetedReviewWriteRating;
  requestId?: string;
};

export const targetedReviewWrite = (
  payload: TargetedReviewWriteRequestPayload,
  options?: AnkiRequestOptions,
): Promise<TargetedReviewWriteResponse> => {
  return request('jitenTargetedReviewWriteV1', payload, options);
};
