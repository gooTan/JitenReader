import { AnkiRequestOptions } from './api.types';
import { cardsInfo } from './cards-info';
import { findNotes } from './find-notes';
import { notesInfo } from './notes-info';
import { request } from './request';

export type AnkiModelTemplate = {
  name: string;
  ord: number;
};

const escapeAnkiQueryValue = (value: string): string =>
  value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');

const getDerivedTemplateOrds = async (
  modelName: string,
  options?: AnkiRequestOptions,
): Promise<number[] | undefined> => {
  const noteIds = await findNotes(`note:"${escapeAnkiQueryValue(modelName)}"`, {
    ...options,
    showToastOnError: false,
  });
  const firstNoteId = noteIds[0];

  if (!firstNoteId) {
    return;
  }

  const [note] = await notesInfo([firstNoteId], {
    ...options,
    showToastOnError: false,
  });

  if (!note?.cards?.length) {
    return;
  }

  const cards = await cardsInfo(note.cards, {
    ...options,
    showToastOnError: false,
  });
  const ords = Array.from(
    new Set(cards.map((card) => card.ord).filter((ord) => Number.isInteger(ord) && ord >= 0)),
  ).sort((left, right) => left - right);

  return ords.length > 0 ? ords : undefined;
};

export const getModelTemplates = async (
  modelName: string,
  options?: AnkiRequestOptions,
): Promise<AnkiModelTemplate[]> => {
  const templates = await request('modelTemplates', { modelName }, options);
  const templateNames = Object.keys(templates);
  let templateOrds = await getDerivedTemplateOrds(modelName, options).catch(() => undefined);

  if (templateOrds?.length !== templateNames.length) {
    templateOrds = Array.from({ length: templateNames.length }, (_, index) => index);
  }

  return templateNames.map((name, index) => ({
    name,
    ord: templateOrds[index],
  }));
};
