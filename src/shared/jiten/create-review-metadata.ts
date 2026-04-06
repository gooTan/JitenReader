import {
  JitenCardState,
  JitenReviewBackend,
  ReviewDueState,
  ReviewFreshnessState,
  ReviewMappingState,
  ReviewMetadata,
  ReviewTargetMetadata,
  ReviewTargetState,
} from './types';

type CreateReviewMetadataArgs = {
  backend: JitenReviewBackend;
  wordId: number;
  readingIndex: number;
  stateTags: JitenCardState[];
  freshness: ReviewFreshnessState;
  actionsAvailable: boolean;
  mappingState?: ReviewMappingState;
  dueState?: ReviewDueState;
  targetState?: ReviewTargetState;
  target?: ReviewTargetMetadata;
};

export const createReviewMetadata = ({
  backend,
  wordId,
  readingIndex,
  stateTags,
  freshness,
  actionsAvailable,
  mappingState: providedMappingState,
  dueState: providedDueState,
  targetState: providedTargetState,
  target: providedTarget,
}: CreateReviewMetadataArgs): ReviewMetadata => {
  const mappingState = providedMappingState ?? (stateTags.length > 0 ? 'mapped' : 'unmapped');
  const dueState =
    providedDueState ??
    (stateTags.includes(JitenCardState.DUE)
      ? 'due'
      : mappingState === 'mapped'
        ? 'notDue'
        : 'unknown');
  const targetState = providedTargetState ?? (mappingState === 'mapped' ? 'selected' : 'none');
  const target =
    providedTarget ??
    (mappingState === 'mapped'
      ? { key: `${wordId}/${readingIndex}`, wordId, readingIndex }
      : undefined);

  return {
    backend,
    mappingState,
    dueState,
    targetState,
    target,
    freshness,
    actionsAvailable: actionsAvailable && targetState === 'selected',
    stateTags,
  };
};
