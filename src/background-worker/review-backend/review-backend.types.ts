import { ReviewabilityResult } from '@shared/jiten/reviewability';
import {
  JitenCardState,
  JitenRating,
  JitenRawVocabulary,
  ReviewMetadata,
  ReviewDueState,
  ReviewMappingOutcome,
  ReviewResolutionDiagnostics,
  ReviewResolutionStatus,
  ReviewTermSnapshot,
  ReviewTargetMetadata,
} from '@shared/jiten/types';
import { ReviewBackendId } from './review-backend-selector.types';

export type ReviewDeck = 'mining' | 'blacklist' | 'neverForget' | 'suspend';
export type ReviewDeckAction = 'add' | 'remove';
export type ReviewTermResolution = {
  stateTags: JitenCardState[];
  resolutionStatus: ReviewResolutionStatus;
  mappingOutcome?: ReviewMappingOutcome;
  dueState: ReviewDueState;
  target?: ReviewTargetMetadata;
  diagnostics?: ReviewResolutionDiagnostics;
};
export type ReviewTermResolutionMap = Record<string, ReviewTermResolution>;

export type ReviewBackendCapabilities = {
  supportsDeckActions: boolean;
  supportsSentenceAttach: boolean;
};

export type ReviewBackendParseMetrics = Record<string, number | string | boolean>;
export type ReviewGradeContext = {
  requestId?: string;
  requestedBackend?: ReviewBackendId;
  targetCardId?: number;
  reviewMetadata?: ReviewMetadata;
  termSnapshot?: ReviewTermSnapshot;
};
export type ReviewCardStateContext = {
  targetCardId?: number;
  previousMetadata?: ReviewMetadata;
};

export interface ReviewBackend {
  getCapabilities(): ReviewBackendCapabilities;
  getParseReviewStates(vocabulary: JitenRawVocabulary[]): Promise<ReviewTermResolutionMap>;
  getParseMetrics?(): ReviewBackendParseMetrics | undefined;
  gradeCard(
    wordId: number,
    readingIndex: number,
    rating: JitenRating,
    context?: ReviewGradeContext,
  ): Promise<void>;
  getGradeReviewability(
    wordId: number,
    readingIndex: number,
    context?: ReviewGradeContext,
  ): Promise<ReviewabilityResult>;
  getCardState(
    wordId: number,
    readingIndex: number,
    context?: ReviewCardStateContext,
  ): Promise<JitenCardState[]>;
  forgetCard(wordId: number, readingIndex: number): Promise<void>;
  runDeckAction(
    wordId: number,
    readingIndex: number,
    deck: ReviewDeck,
    action: ReviewDeckAction,
    sentence?: string,
  ): Promise<void>;
}
