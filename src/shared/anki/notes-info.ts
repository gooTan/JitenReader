import { AnkiRequestOptions } from './api.types';
import { request } from './request';

export const notesInfo = (
  notes: number[],
  options?: AnkiRequestOptions,
): ReturnType<typeof request<'notesInfo'>> => request('notesInfo', { notes }, options);
