import { AnkiRequestOptions } from './api.types';
import { request } from './request';

export const getCollectionCreationTime = (options?: AnkiRequestOptions): Promise<number> =>
  request('getCollectionCreationTime', {}, options);
