import { Empty } from '../types';

type ModelFieldNamesRequest = { modelName: string };
type FindNotesRequest = { query: string };
type NotesInfoRequest = { notes: number[] };
type CardsInfoRequest = { cards: number[] };
type MultiRequest = {
  actions: {
    action: string;
    params?: Record<string, unknown>;
  }[];
};
type TargetedReviewWriteRating = 'again' | 'hard' | 'good' | 'easy';
type TargetedReviewWriteRequest = {
  version: 1;
  requestId?: string;
  cardId: number;
  rating: TargetedReviewWriteRating;
};

type TargetedReviewWriteSuccess = {
  success: true;
  version: 1;
  requestId?: string;
  result: {
    cardId: number;
    noteId: number;
    deckName: string;
    rating: TargetedReviewWriteRating;
    ease: 1 | 2 | 3 | 4;
    reviewState: 'new' | 'learning' | 'review' | 'suspended' | 'buried' | 'unknown';
    queue: number;
    type: number;
    due: number;
    interval: number;
    reps: number;
    lapses: number;
  };
};

type TargetedReviewWriteError = {
  success: false;
  version: 1;
  requestId?: string;
  error: {
    code:
      | 'INVALID_REQUEST'
      | 'UNSUPPORTED_VERSION'
      | 'INVALID_CARD_ID'
      | 'INVALID_RATING'
      | 'CARD_NOT_FOUND'
      | 'CARD_NOT_REVIEWABLE'
      | 'APPLY_FAILED'
      | 'INTERNAL_ERROR';
    message: string;
    details?: Record<string, unknown>;
  };
};

export type TargetedReviewWriteResponse = TargetedReviewWriteSuccess | TargetedReviewWriteError;

export type AnkiNoteInfo = {
  noteId: number;
  modelName: string;
  fields: Record<
    string,
    {
      value: string;
      order: number;
    }
  >;
  cards: number[];
};

export type AnkiCardInfo = {
  cardId: number;
  note: number;
  modelName: string;
  deckName: string;
  ord: number;
  queue: number;
  due: number;
  fields: Record<
    string,
    {
      value: string;
      order: number;
    }
  >;
};

export type AnkiRequestOptions = {
  ankiConnectUrl?: string;
  showToastOnError?: boolean;
};

export type AnkiEndpoints = {
  version: [Empty, number];
  getCollectionCreationTime: [Empty, number];
  deckNames: [Empty, string[]];
  modelNames: [Empty, string[]];
  modelFieldNames: [ModelFieldNamesRequest, string[]];
  findNotes: [FindNotesRequest, number[]];
  notesInfo: [NotesInfoRequest, AnkiNoteInfo[]];
  cardsInfo: [CardsInfoRequest, AnkiCardInfo[]];
  multi: [MultiRequest, unknown[]];
  jitenTargetedReviewWriteV1: [TargetedReviewWriteRequest, TargetedReviewWriteResponse];
};
