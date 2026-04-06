type JitenMeaning = {
  glosses: string[];
  partsOfSpeech: string[];
};

export type JitenRuby = {
  text: string;
  start: number;
  end: number;
  length: number;
};

export type JitenParseResult = {
  tokens: JitenToken[][];
  vocabulary: JitenRawVocabulary[];
};

export type JitenRating = 'unknown' | 'again' | 'hard' | 'good' | 'easy';
export const JitenRatingMap: Record<JitenRating, number> = {
  unknown: 0,
  again: 1,
  hard: 2,
  good: 3,
  easy: 4,
};

export enum JitenCardState {
  NEW = 'new',
  YOUNG = 'young',
  MATURE = 'mature',
  MASTERED = 'mastered',
  BLACKLISTED = 'blacklisted',
  DUE = 'due',
}

export type JitenRawVocabulary = {
  wordId: number;
  readingIndex: number;
  spelling: string;
  reading: string;
  frequencyRank: number;
  partsOfSpeech: string[];
  meaningsChunks: string[][];
  meaningsPartOfSpeech: string[][];
  knownState: number[];
  pitchAccents: number[] | null;
};

export type JitenReviewBackend = 'jiten' | 'anki';

export type ReviewMappingState = 'mapped' | 'unmapped' | 'ambiguous';
export type ReviewDueState = 'due' | 'notDue' | 'unavailable' | 'unknown';
export type ReviewTargetState = 'selected' | 'none' | 'ambiguous';
export type ReviewFreshnessState = 'fresh' | 'stale' | 'unknown';

export type ReviewTargetMetadata = {
  key: string;
  wordId: number;
  readingIndex: number;
  ankiNoteId?: number;
  ankiCardId?: number;
  ankiDeck?: string;
  ankiModel?: string;
  ankiTemplateOrd?: number;
};

/**
 * Unified term-level review metadata contract.
 *
 * Ownership:
 * - parse/enrichment pipeline writes initial metadata (`freshness: 'stale'`)
 * - post-review refresh flow writes refreshed metadata (`freshness: 'fresh'`)
 * - popup and foreground consumers are read-only and render directly from this object
 */
export type ReviewMetadata = {
  backend: JitenReviewBackend;
  mappingState: ReviewMappingState;
  dueState: ReviewDueState;
  targetState: ReviewTargetState;
  target?: ReviewTargetMetadata;
  freshness: ReviewFreshnessState;
  actionsAvailable: boolean;
  stateTags: JitenCardState[];
};

export type JitenCard = {
  wordId: number;
  readingIndex: number;
  spelling: string;
  reading: string;
  frequencyRank: number;
  partsOfSpeech: string[];
  meanings: JitenMeaning[];
  cardState: JitenCardState[];
  reviewBackend: JitenReviewBackend;
  reviewMetadata: ReviewMetadata;
  pitchAccents: number[];
  wordWithReading: string | null;
};

export type JitenToken = {
  card: JitenCard;
  wordId: number;
  readingIndex: number;
  start: number;
  end: number;
  length: number;
  sentence?: string;
  pitchClass: string;
  rubies: JitenRuby[];
  conjugations: string[];
};

export type LabeledCardState = {
  id: JitenCardState;
  name: string;
  description: string;
};
