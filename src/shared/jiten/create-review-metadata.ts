import { JitenCardState, JitenReviewBackend, ReviewFreshnessState, ReviewMetadata } from './types';

type CreateReviewMetadataArgs = {
  backend: JitenReviewBackend;
  wordId: number;
  readingIndex: number;
  stateTags: JitenCardState[];
  freshness: ReviewFreshnessState;
  actionsAvailable: boolean;
};

export const createReviewMetadata = ({
  backend,
  wordId,
  readingIndex,
  stateTags,
  freshness,
  actionsAvailable,
}: CreateReviewMetadataArgs): ReviewMetadata => {
  const mappingState = stateTags.length > 0 ? 'mapped' : 'unmapped';
  const dueState = stateTags.includes(JitenCardState.DUE)
    ? 'due'
    : mappingState === 'mapped'
      ? 'notDue'
      : 'unknown';

  return {
    backend,
    mappingState,
    dueState,
    targetState: mappingState === 'mapped' ? 'selected' : 'none',
    target:
      mappingState === 'mapped'
        ? { key: `${wordId}/${readingIndex}`, wordId, readingIndex }
        : undefined,
    freshness,
    actionsAvailable: actionsAvailable && mappingState === 'mapped',
    stateTags,
  };
};
