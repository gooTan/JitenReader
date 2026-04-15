import { Empty } from '../types';

type ModelFieldNamesRequest = { modelName: string };
type ModelTemplatesRequest = { modelName: string };
type FindNotesRequest = { query: string };
type NotesInfoRequest = { notes: number[] };
type CardsInfoRequest = { cards: number[] };
type GetIntervalsRequest = { cards: number[] };
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
type TargetedReviewCommitRequest = {
  version: 1;
  requestId?: string;
  term: {
    key: string;
    wordId: number;
    readingIndex: number;
    spelling: string;
    reading: string;
  };
  rating: TargetedReviewWriteRating;
  target:
    | {
        kind: 'existing-card';
        cardId: number;
      }
    | {
        kind: 'create-and-review';
        writeTarget: {
          deck: string;
          model: string;
          wordField: string;
          readingField: string;
          cardTemplateOrd: number;
        };
        noteFields: Record<string, string>;
        sentenceFieldCount: number;
      };
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
export type TargetedReviewCommitResponse =
  | {
      success: true;
      version: 1;
      requestId?: string;
      result: {
        transaction: 'reviewed-existing' | 'created-and-reviewed';
        cardId: number;
        noteId: number;
        deckName: string;
        modelName: string;
        templateOrd: number;
        templateName?: string;
        rating: TargetedReviewWriteRating;
        ease: 1 | 2 | 3 | 4;
        reviewState: 'new' | 'learning' | 'review' | 'suspended' | 'buried' | 'unknown';
        queue: number;
        type: number;
        due: number;
        interval: number;
        reps: number;
        lapses: number;
        sentenceFieldCount: number;
      };
    }
  | {
      success: false;
      version: 1;
      requestId?: string;
      error: {
        code:
          | 'INVALID_REQUEST'
          | 'UNSUPPORTED_VERSION'
          | 'INVALID_TARGET'
          | 'INVALID_CARD_ID'
          | 'INVALID_RATING'
          | 'CARD_NOT_FOUND'
          | 'CARD_NOT_REVIEWABLE'
          | 'WRITE_MODEL_CREATION_FAILED'
          | 'TARGET_AMBIGUITY'
          | 'CARD_DESCRIPTION_FAILED'
          | 'MODEL_NOT_FOUND'
          | 'DECK_NOT_FOUND'
          | 'NOTE_CREATE_FAILED'
          | 'CREATED_CARD_NOT_FOUND'
          | 'APPLY_FAILED'
          | 'INTERNAL_ERROR';
        message: string;
        details?: Record<string, unknown>;
      };
    };

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
  modelTemplates: [ModelTemplatesRequest, Record<string, { Front: string; Back: string }>];
  findNotes: [FindNotesRequest, number[]];
  notesInfo: [NotesInfoRequest, AnkiNoteInfo[]];
  cardsInfo: [CardsInfoRequest, AnkiCardInfo[]];
  getIntervals: [GetIntervalsRequest, number[]];
  multi: [MultiRequest, unknown[]];
  jitenTargetedReviewWriteV1: [TargetedReviewWriteRequest, TargetedReviewWriteResponse];
  jitenTargetedReviewCommitV1: [TargetedReviewCommitRequest, TargetedReviewCommitResponse];
};
