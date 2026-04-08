import { AnkiRequestOptions } from './api.types';
import { request } from './request';

export const getIntervals = (
  cards: number[],
  options?: AnkiRequestOptions,
): ReturnType<typeof request<'getIntervals'>> => request('getIntervals', { cards }, options);
