import {
  JitenCardState,
  JitenRating,
  JitenRawVocabulary,
  ReviewDueState,
  ReviewMappingState,
  ReviewTargetMetadata,
  ReviewTargetState,
} from '@shared/jiten/types';

export type ReviewDeck = 'mining' | 'blacklist' | 'neverForget' | 'suspend';
export type ReviewDeckAction = 'add' | 'remove';
export type ReviewTermResolution = {
  stateTags: JitenCardState[];
  mappingState: ReviewMappingState;
  dueState: ReviewDueState;
  targetState: ReviewTargetState;
  target?: ReviewTargetMetadata;
};
export type ReviewTermResolutionMap = Record<string, ReviewTermResolution>;

export type ReviewBackendCapabilities = {
  supportsDeckActions: boolean;
  supportsSentenceAttach: boolean;
};

export type ReviewBackendParseMetrics = Record<string, number | string | boolean>;
export type ReviewGradeContext = {
  requestId?: string;
  targetCardId?: number;
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
  getCardState(wordId: number, readingIndex: number): Promise<JitenCardState[]>;
  forgetCard(wordId: number, readingIndex: number): Promise<void>;
  runDeckAction(
    wordId: number,
    readingIndex: number,
    deck: ReviewDeck,
    action: ReviewDeckAction,
    sentence?: string,
  ): Promise<void>;
}
