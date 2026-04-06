import { AnkiRequestOptions } from './api.types';
import { request } from './request';

export const findNotes = (query: string, options?: AnkiRequestOptions): Promise<number[]> =>
  request('findNotes', { query }, options);
