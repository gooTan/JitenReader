import { Empty } from '../types';

type ModelFieldNamesRequest = { modelName: string };
type FindNotesRequest = { query: string };

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
};
