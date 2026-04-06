import { Empty } from '../types';

type ModelFieldNamesRequest = { modelName: string };
type FindNotesRequest = { query: string };
type NotesInfoRequest = { notes: number[] };
type CardsInfoRequest = { cards: number[] };

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
  deckNames: [Empty, string[]];
  modelNames: [Empty, string[]];
  modelFieldNames: [ModelFieldNamesRequest, string[]];
  findNotes: [FindNotesRequest, number[]];
  notesInfo: [NotesInfoRequest, AnkiNoteInfo[]];
  cardsInfo: [CardsInfoRequest, AnkiCardInfo[]];
};
