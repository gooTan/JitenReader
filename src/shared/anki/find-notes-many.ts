import { AnkiRequestOptions } from './api.types';
import { request } from './request';

export const findNotesMany = async (
  queries: string[],
  options?: AnkiRequestOptions,
): Promise<number[][]> => {
  if (queries.length === 0) {
    return [];
  }

  const result = await request(
    'multi',
    {
      actions: queries.map((query) => ({
        action: 'findNotes',
        params: { query },
      })),
    },
    options,
  );

  return result.map((entry) => {
    if (Array.isArray(entry)) {
      return entry.filter((id): id is number => typeof id === 'number');
    }

    if (
      typeof entry === 'object' &&
      entry !== null &&
      'result' in entry &&
      Array.isArray((entry as { result: unknown }).result)
    ) {
      return (entry as { result: unknown[] }).result.filter(
        (id): id is number => typeof id === 'number',
      );
    }

    if (
      typeof entry === 'object' &&
      entry !== null &&
      'error' in entry &&
      (entry as { error: unknown }).error !== null
    ) {
      return [];
    }

    return [];
  });
};
