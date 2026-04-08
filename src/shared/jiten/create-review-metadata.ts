import {
  JitenCardState,
  JitenReviewBackend,
  ReviewDueState,
  ReviewFreshnessState,
  ReviewMappingOutcome,
  ReviewMetadata,
  ReviewResolutionDiagnostics,
  ReviewResolutionStatus,
  ReviewTargetMetadata,
} from './types';

type CreateReviewMetadataArgs = {
  backend: JitenReviewBackend;
  wordId: number;
  readingIndex: number;
  stateTags: JitenCardState[];
  freshness: ReviewFreshnessState;
  actionsAvailable: boolean;
  resolutionStatus?: ReviewResolutionStatus;
  mappingOutcome?: ReviewMappingOutcome;
  dueState?: ReviewDueState;
  target?: ReviewTargetMetadata;
  diagnostics?: ReviewResolutionDiagnostics;
};

export const createReviewMetadata = ({
  backend,
  wordId,
  readingIndex,
  stateTags,
  freshness,
  actionsAvailable,
  resolutionStatus: providedResolutionStatus,
  mappingOutcome: providedMappingOutcome,
  dueState: providedDueState,
  target: providedTarget,
  diagnostics,
}: CreateReviewMetadataArgs): ReviewMetadata => {
  const resolutionStatus = providedResolutionStatus ?? 'resolved';
  const dueState =
    providedDueState ??
    (stateTags.includes(JitenCardState.DUE)
      ? 'due'
      : resolutionStatus !== 'resolved'
        ? resolutionStatus === 'backend-unavailable'
          ? 'unavailable'
          : 'unknown'
        : providedTarget
          ? 'notDue'
          : 'unknown');
  const mappingOutcome =
    resolutionStatus === 'resolved'
      ? (providedMappingOutcome ?? (providedTarget ? 'selected' : 'none'))
      : undefined;
  const target =
    providedTarget ??
    (mappingOutcome === 'selected'
      ? { key: `${wordId}/${readingIndex}`, wordId, readingIndex }
      : undefined);

  return {
    backend,
    resolutionStatus,
    mappingOutcome,
    dueState,
    target,
    diagnostics,
    freshness,
    actionsAvailable:
      actionsAvailable && resolutionStatus === 'resolved' && mappingOutcome === 'selected',
    stateTags,
  };
};
