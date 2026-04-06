import { JitenCardState, JitenRating } from '@shared/jiten/types';

export type ReviewDeck = 'mining' | 'blacklist' | 'neverForget' | 'suspend';
export type ReviewDeckAction = 'add' | 'remove';

export type ReviewBackendCapabilities = {
  supportsDeckActions: boolean;
  supportsSentenceAttach: boolean;
};

export interface ReviewBackend {
  getCapabilities(): ReviewBackendCapabilities;
  gradeCard(wordId: number, readingIndex: number, rating: JitenRating): Promise<void>;
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
