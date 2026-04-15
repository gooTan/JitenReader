import { AnkiCardInfo, AnkiNoteInfo } from '@shared/anki/api.types';
import { DiscoverWordConfigurationEntry } from '@shared/anki/types';
import { JitenCardState, JitenRawVocabulary, ReviewTargetMetadata } from '@shared/jiten/types';

export type AnkiTargetCandidate = {
  target: ReviewTargetMetadata;
  stateTags: JitenCardState[];
  dueState: 'due' | 'notDue';
};

export type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

export type TermContext = {
  normalisedSpelling: string;
  normalisedReading: string;
  termKey: string;
  vocabulary: JitenRawVocabulary;
};

export type LookupConfig = {
  config: DiscoverWordConfigurationEntry['config'];
  id: string;
  deck: string;
  model: string;
  readingField: string;
  templateOrds: number[];
  wordField: string;
};

export type LookupPlan = {
  configId: string;
  query: string;
  termKey: string;
};

export type ResolvePlanNoteIdsResult = {
  issuedFindNotesRequests: number;
  noteIdsByPlanKey: Map<string, number[]>;
  uniqueQueries: number;
};

export type ReadCardsResult = {
  issuedCardsInfoRequests: number;
  cardsById: Map<number, AnkiCardInfo>;
};

export type ReadIntervalsResult = {
  intervalsByCardId: Map<number, number>;
  issuedIntervalRequests: number;
};

export type ReadNotesResult = {
  issuedNotesInfoRequests: number;
  notesById: Map<number, AnkiNoteInfo>;
};

export type AnkiParseLookupMetrics = {
  cardsInfoRequests: number;
  findNotesRequests: number;
  intervalRequests: number;
  notesInfoRequests: number;
  primeModelTemplatesMs?: number;
  readCardsIndexedMs?: number;
  readContextReadyMs?: number;
  readIntervalsIndexedMs?: number;
  readNotesIndexedMs?: number;
  readonlyConfigMs?: number;
  resolvePlanNoteIdsMs?: number;
  resolveTermsMs?: number;
  totalTerms: number;
  uniqueCardIds: number;
  uniqueNoteIds: number;
  uniqueQueries: number;
};
