import { AnkiRequestOptions } from './api.types';
import { request } from './request';

export const cardsInfo = (
  cards: number[],
  options?: AnkiRequestOptions,
): ReturnType<typeof request<'cardsInfo'>> => request('cardsInfo', { cards }, options);
