import { AnkiCardInfo, AnkiNoteInfo } from '@shared/anki/api.types';
import { cardsInfo } from '@shared/anki/cards-info';
import { findNotes } from '@shared/anki/find-notes';
import { findNotesMany } from '@shared/anki/find-notes-many';
import { getApiVersion } from '@shared/anki/get-api-version';
import { getCollectionCreationTime } from '@shared/anki/get-collection-creation-time';
import { getIntervals } from '@shared/anki/get-intervals';
import { notesInfo } from '@shared/anki/notes-info';
import { targetedReviewWrite } from '@shared/anki/targeted-review-write';
import { DiscoverWordConfiguration } from '@shared/anki/types';
import { getConfiguration } from '@shared/configuration/get-configuration';
import {
  JitenCardState,
  JitenRawVocabulary,
  JitenRating,
  ReviewTargetMetadata,
} from '@shared/jiten/types';
import { TargetedReviewWriteError, UnsupportedReviewOperationError } from './review-backend.errors';
import {
  ReviewBackend,
  ReviewBackendCapabilities,
  ReviewCardStateContext,
  ReviewGradeContext,
  ReviewBackendParseMetrics,
  ReviewDeck,
  ReviewDeckAction,
  ReviewTermResolution,
  ReviewTermResolutionMap,
} from './review-backend.types';

const ANKI_REVIEW_BACKEND_CAPABILITIES: ReviewBackendCapabilities = {
  supportsDeckActions: false,
  supportsSentenceAttach: false,
};
const READ_PROBE_CACHE_TTL_MS = 30_000;
const LOOKUP_CACHE_TTL_MS = 15_000;
const MAX_BATCH_IDS = 300;
const FIND_NOTES_MULTI_BATCH_SIZE = 50;
const FIND_NOTES_CONCURRENCY_LIMIT = 6;
const NOTES_INFO_CONCURRENCY_LIMIT = 4;
const CARDS_INFO_CONCURRENCY_LIMIT = 4;
const ANKI_QUEUE_LEARNING = 1;
const ANKI_QUEUE_REVIEW = 2;
const ANKI_QUEUE_RELEARNING = 3;
const ANKI_QUEUE_PREVIEW = 4;
const ANKI_QUEUE_NEW = 0;
const ANKI_FALLBACK_ROLLOVER_HOUR = 4;
const ANKI_MATURE_INTERVAL_DAYS = 21;
const ROLLOVER_CACHE_TTL_MS = 30_000;
const COLLECTION_CREATION_CACHE_TTL_MS = 300_000;
const ELIGIBLE_TEMPLATE_ORDS = new Set<number>([0]);

type AnkiTargetCandidate = {
  target: ReviewTargetMetadata;
  stateTags: JitenCardState[];
  dueState: 'due' | 'notDue';
};

type EligibleAnkiTargets = {
  decks: Set<string>;
  models: Set<string>;
  templates: Set<number>;
};

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

type TermContext = {
  normalisedSpelling: string;
  normalisedReading: string;
  termKey: string;
  vocabulary: JitenRawVocabulary;
};

type LookupConfig = {
  config: DiscoverWordConfiguration;
  id: string;
  model: string;
  wordField: string;
};

type LookupPlan = {
  configId: string;
  query: string;
  termKey: string;
};

type ResolvePlanNoteIdsResult = {
  issuedFindNotesRequests: number;
  noteIdsByPlanKey: Map<string, number[]>;
  uniqueQueries: number;
};

type ReadCardsResult = {
  issuedCardsInfoRequests: number;
  cardsById: Map<number, AnkiCardInfo>;
};

type ReadIntervalsResult = {
  intervalsByCardId: Map<number, number>;
  issuedIntervalRequests: number;
};

type ReadNotesResult = {
  issuedNotesInfoRequests: number;
  notesById: Map<number, AnkiNoteInfo>;
};

export type AnkiParseLookupMetrics = {
  cardsInfoRequests: number;
  findNotesRequests: number;
  intervalRequests: number;
  notesInfoRequests: number;
  totalTerms: number;
  uniqueCardIds: number;
  uniqueNoteIds: number;
  uniqueQueries: number;
};

export class AnkiReviewBackend implements ReviewBackend {
  private _cachedCollectionCreatedAtExpiresAt = 0;
  private _cachedCollectionCreatedAtMs?: number;
  private _cachedReadProbeExpiresAt = 0;
  private _cachedRolloverHourExpiresAt = 0;
  private _cachedRolloverHour = ANKI_FALLBACK_ROLLOVER_HOUR;
  private _inFlightCollectionCreatedAtProbe?: Promise<number | undefined>;
  private _inFlightReadProbe?: Promise<void>;
  private _inFlightRolloverProbe?: Promise<number>;
  private _lastParseMetrics?: AnkiParseLookupMetrics;
  private readonly _findNotesCache = new Map<string, CacheEntry<number[]>>();
  private readonly _notesInfoCache = new Map<number, CacheEntry<AnkiNoteInfo>>();
  private readonly _cardsInfoCache = new Map<number, CacheEntry<AnkiCardInfo>>();
  private readonly _intervalsCache = new Map<number, CacheEntry<number>>();

  public getCapabilities(): ReviewBackendCapabilities {
    return ANKI_REVIEW_BACKEND_CAPABILITIES;
  }

  public invalidateCaches(): void {
    this._cachedReadProbeExpiresAt = 0;
    this._cachedRolloverHourExpiresAt = 0;
    this._cachedCollectionCreatedAtExpiresAt = 0;
    this._cachedCollectionCreatedAtMs = undefined;
    this._inFlightReadProbe = undefined;
    this._inFlightRolloverProbe = undefined;
    this._inFlightCollectionCreatedAtProbe = undefined;
    this._findNotesCache.clear();
    this._notesInfoCache.clear();
    this._cardsInfoCache.clear();
    this._intervalsCache.clear();
  }

  public async getParseReviewStates(
    vocabulary: JitenRawVocabulary[],
  ): Promise<ReviewTermResolutionMap> {
    await this.ensureReadOnlyPathReady();
    await this.ensureRolloverHourLoaded();
    await this.ensureCollectionCreatedAtLoaded();

    const readonlyConfigs = await getConfiguration('ankiReadonlyConfigs');
    const eligibleTargets = await this.getEligibleAnkiTargets(readonlyConfigs);
    const termContexts = this.getUniqueTermContexts(vocabulary);

    if (readonlyConfigs.length === 0) {
      return this.buildResolutionMapFromTerms(vocabulary, termContexts, () =>
        this.createUnavailableResolution(),
      );
    }

    if (eligibleTargets.models.size === 0 || eligibleTargets.decks.size === 0) {
      return this.buildResolutionMapFromTerms(vocabulary, termContexts, () =>
        this.createUnavailableResolution(),
      );
    }

    const lookupConfigs = this.getLookupConfigs(readonlyConfigs);
    const plans = this.createLookupPlans(termContexts, lookupConfigs);
    const planLookupResult = await this.resolvePlanNoteIds(plans);
    const notesLookupResult = await this.readNotesIndexed(
      this.getUniqueIds(planLookupResult.noteIdsByPlanKey.values()),
    );
    const notesById = notesLookupResult.notesById;
    const cardsLookupResult = await this.readCardsIndexed(
      this.getUniqueIds(Array.from(notesById.values(), (note) => note.cards)),
    );
    const cardsById = cardsLookupResult.cardsById;
    const intervalsLookupResult = await this.readIntervalsIndexed(Array.from(cardsById.keys()));
    const intervalsByCardId = intervalsLookupResult.intervalsByCardId;

    const resolutionsByTerm = new Map<string, ReviewTermResolution>();

    for (const termContext of termContexts.values()) {
      const resolution = this.resolveTermFromIndexes(
        termContext,
        lookupConfigs,
        planLookupResult.noteIdsByPlanKey,
        notesById,
        cardsById,
        intervalsByCardId,
        eligibleTargets,
      );

      resolutionsByTerm.set(termContext.termKey, resolution);
    }

    this._lastParseMetrics = {
      cardsInfoRequests: cardsLookupResult.issuedCardsInfoRequests,
      findNotesRequests: planLookupResult.issuedFindNotesRequests,
      intervalRequests: intervalsLookupResult.issuedIntervalRequests,
      notesInfoRequests: notesLookupResult.issuedNotesInfoRequests,
      totalTerms: termContexts.size,
      uniqueCardIds: cardsById.size,
      uniqueNoteIds: notesById.size,
      uniqueQueries: planLookupResult.uniqueQueries,
    };

    return this.buildResolutionMapFromTerms(vocabulary, termContexts, (termKey) => {
      return resolutionsByTerm.get(termKey) ?? this.createUnmappedResolution();
    });
  }

  public getParseMetrics(): ReviewBackendParseMetrics | undefined {
    return this._lastParseMetrics;
  }

  public async getCardState(
    _wordId: number,
    _readingIndex: number,
    context?: ReviewCardStateContext,
  ): Promise<JitenCardState[]> {
    await this.ensureReadOnlyPathReady();
    await this.ensureRolloverHourLoaded();
    await this.ensureCollectionCreatedAtLoaded();

    const targetCardId = context?.targetCardId;

    if (!targetCardId || targetCardId <= 0) {
      return [];
    }

    const [targetCard] = await cardsInfo([targetCardId], { showToastOnError: false });

    if (targetCard?.cardId !== targetCardId) {
      return [];
    }

    return this.getStateTagsForCard(targetCard);
  }

  public async gradeCard(
    _wordId: number,
    _readingIndex: number,
    rating: JitenRating,
    context?: ReviewGradeContext,
  ): Promise<void> {
    if (rating === 'unknown') {
      throw new TargetedReviewWriteError(
        'INVALID_RATING',
        'Cannot submit an unknown rating to Anki.',
      );
    }

    const targetCardId = context?.targetCardId;

    if (!targetCardId || targetCardId <= 0) {
      throw new TargetedReviewWriteError(
        'MISSING_TARGET_CARD',
        'Missing selected Anki target card for review submission.',
      );
    }

    const response = await targetedReviewWrite(
      {
        version: 1,
        requestId: context?.requestId,
        cardId: targetCardId,
        rating,
      },
      { showToastOnError: false },
    );

    if (!response.success) {
      throw new TargetedReviewWriteError(
        response.error.code,
        response.error.message,
        response.error.details,
      );
    }

    this.invalidateCardStateCache(targetCardId);
  }

  public forgetCard(_wordId: number, _readingIndex: number): Promise<void> {
    throw new UnsupportedReviewOperationError('forgetCard', 'anki');
  }

  public runDeckAction(
    _wordId: number,
    _readingIndex: number,
    _deck: ReviewDeck,
    _action: ReviewDeckAction,
    _sentence?: string,
  ): Promise<void> {
    throw new UnsupportedReviewOperationError('runDeckAction', 'anki');
  }

  private async ensureReadOnlyPathReady(): Promise<void> {
    const now = Date.now();

    if (this._cachedReadProbeExpiresAt > now) {
      return;
    }

    if (!this._inFlightReadProbe) {
      this._inFlightReadProbe = (async (): Promise<void> => {
        await getApiVersion({ showToastOnError: false });
        await findNotes('nid:0', { showToastOnError: false });
        this._cachedReadProbeExpiresAt = Date.now() + READ_PROBE_CACHE_TTL_MS;
      })();
    }

    try {
      await this._inFlightReadProbe;
    } finally {
      this._inFlightReadProbe = undefined;
    }
  }

  private async ensureRolloverHourLoaded(): Promise<void> {
    const now = Date.now();

    if (this._cachedRolloverHourExpiresAt > now) {
      return;
    }

    if (!this._inFlightRolloverProbe) {
      this._inFlightRolloverProbe = (async (): Promise<number> => {
        const configuredRolloverHour = await getConfiguration('ankiRolloverHour');

        if (
          typeof configuredRolloverHour !== 'number' ||
          !Number.isFinite(configuredRolloverHour)
        ) {
          return ANKI_FALLBACK_ROLLOVER_HOUR;
        }

        return Math.min(23, Math.max(0, Math.floor(configuredRolloverHour)));
      })();
    }

    try {
      this._cachedRolloverHour = await this._inFlightRolloverProbe;
      this._cachedRolloverHourExpiresAt = now + ROLLOVER_CACHE_TTL_MS;
    } finally {
      this._inFlightRolloverProbe = undefined;
    }
  }

  private async ensureCollectionCreatedAtLoaded(): Promise<void> {
    const now = Date.now();

    if (this._cachedCollectionCreatedAtExpiresAt > now) {
      return;
    }

    if (!this._inFlightCollectionCreatedAtProbe) {
      this._inFlightCollectionCreatedAtProbe = (async (): Promise<number | undefined> => {
        const rawCreationTime = await getCollectionCreationTime({
          showToastOnError: false,
        });

        return this.normaliseCollectionCreationTime(rawCreationTime);
      })();
    }

    try {
      const resolvedCreationTime = await this._inFlightCollectionCreatedAtProbe;

      if (resolvedCreationTime === undefined) {
        throw new Error(
          'Anki scheduling context is unavailable (invalid collection creation time).',
        );
      }

      this._cachedCollectionCreatedAtMs = resolvedCreationTime;
      this._cachedCollectionCreatedAtExpiresAt = now + COLLECTION_CREATION_CACHE_TTL_MS;
    } finally {
      this._inFlightCollectionCreatedAtProbe = undefined;
    }
  }

  private normaliseCollectionCreationTime(rawCreationTime: number): number | undefined {
    if (!Number.isFinite(rawCreationTime) || rawCreationTime <= 0) {
      return;
    }

    if (rawCreationTime >= 1_000_000_000_000) {
      return Math.floor(rawCreationTime);
    }

    return Math.floor(rawCreationTime * 1000);
  }

  private invalidateCardStateCache(cardId: number): void {
    this._cardsInfoCache.delete(cardId);
  }

  private getUniqueTermContexts(vocabulary: JitenRawVocabulary[]): Map<string, TermContext> {
    const contexts = new Map<string, TermContext>();

    for (const vocab of vocabulary) {
      const normalisedSpelling = this.normaliseTextValue(vocab.spelling);
      const normalisedReading = this.normaliseReadingValue(vocab.reading);
      const termKey = `${normalisedSpelling}\u0000${normalisedReading}`;

      if (contexts.has(termKey)) {
        continue;
      }

      contexts.set(termKey, {
        normalisedSpelling,
        normalisedReading,
        termKey,
        vocabulary: vocab,
      });
    }

    return contexts;
  }

  private getLookupConfigs(configs: DiscoverWordConfiguration[]): LookupConfig[] {
    return configs
      .map((config, index) => {
        const model = config.model?.trim();
        const wordField = config.wordField?.trim();

        if (!model?.length || !wordField?.length) {
          return null;
        }

        return {
          config,
          id: `${index}:${model}:${wordField}`,
          model,
          wordField,
        };
      })
      .filter((config): config is LookupConfig => Boolean(config));
  }

  private createLookupPlans(
    termContexts: Map<string, TermContext>,
    lookupConfigs: LookupConfig[],
  ): LookupPlan[] {
    const plans: LookupPlan[] = [];

    for (const termContext of termContexts.values()) {
      for (const lookupConfig of lookupConfigs) {
        const queryParts = [
          this.createAnkiQuerySegment('note', lookupConfig.model),
          this.createAnkiQuerySegment(lookupConfig.wordField, termContext.vocabulary.spelling),
        ];

        const deck = lookupConfig.config.deck?.trim();

        if (deck?.length) {
          queryParts.push(this.createAnkiQuerySegment('deck', deck));
        }

        plans.push({
          configId: lookupConfig.id,
          query: queryParts.join(' '),
          termKey: termContext.termKey,
        });
      }
    }

    return plans;
  }

  private async resolvePlanNoteIds(plans: LookupPlan[]): Promise<ResolvePlanNoteIdsResult> {
    const now = Date.now();
    const uniqueQueries = Array.from(new Set(plans.map((plan) => plan.query)));
    const queryResults = new Map<string, number[]>();
    const pendingQueries: string[] = [];

    for (const query of uniqueQueries) {
      const cached = this._findNotesCache.get(query);

      if (cached && cached.expiresAt > now) {
        queryResults.set(query, cached.value);
      } else {
        pendingQueries.push(query);
      }
    }

    let issuedFindNotesRequests = 0;

    if (pendingQueries.length > 0) {
      try {
        issuedFindNotesRequests = await this.resolvePendingQueriesWithMulti(
          pendingQueries,
          queryResults,
          now,
        );
      } catch {
        issuedFindNotesRequests = await this.resolvePendingQueriesWithSingles(
          pendingQueries,
          queryResults,
          now,
        );
      }
    }

    const noteIdsByPlanKey = new Map<string, number[]>();

    for (const plan of plans) {
      const planKey = this.getPlanKey(plan.termKey, plan.configId);

      noteIdsByPlanKey.set(planKey, queryResults.get(plan.query) ?? []);
    }

    return {
      issuedFindNotesRequests,
      noteIdsByPlanKey,
      uniqueQueries: uniqueQueries.length,
    };
  }

  private async resolvePendingQueriesWithMulti(
    pendingQueries: string[],
    queryResults: Map<string, number[]>,
    now: number,
  ): Promise<number> {
    const queryBatches = this.chunkQueryBatch(pendingQueries, FIND_NOTES_MULTI_BATCH_SIZE);
    const batchResults = await this.runTasksWithConcurrency(
      queryBatches.map(
        (
          queries,
        ): (() => Promise<{ noteIdsByQuery: Map<string, number[]>; requestCount: number }>) =>
          async () => {
            const results = await findNotesMany(queries, { showToastOnError: false });
            const noteIdsByQuery = new Map<string, number[]>();

            for (const [index, query] of queries.entries()) {
              noteIdsByQuery.set(query, results[index] ?? []);
            }

            return {
              noteIdsByQuery,
              requestCount: 1,
            };
          },
      ),
      FIND_NOTES_CONCURRENCY_LIMIT,
    );

    let requestCount = 0;

    for (const batchResult of batchResults) {
      if (!batchResult) {
        continue;
      }

      requestCount += batchResult.requestCount;

      for (const [query, noteIds] of batchResult.noteIdsByQuery.entries()) {
        queryResults.set(query, noteIds);
        this._findNotesCache.set(query, {
          expiresAt: now + LOOKUP_CACHE_TTL_MS,
          value: noteIds,
        });
      }
    }

    return requestCount;
  }

  private async resolvePendingQueriesWithSingles(
    pendingQueries: string[],
    queryResults: Map<string, number[]>,
    now: number,
  ): Promise<number> {
    const taskResults = await this.runTasksWithConcurrency(
      pendingQueries.map(
        (query): (() => Promise<{ query: string; noteIds: number[] }>) =>
          async () => {
            const noteIds = await findNotes(query, { showToastOnError: false });

            return { query, noteIds };
          },
      ),
      FIND_NOTES_CONCURRENCY_LIMIT,
    );

    let requestCount = 0;

    for (const taskResult of taskResults) {
      if (!taskResult) {
        continue;
      }

      requestCount += 1;
      queryResults.set(taskResult.query, taskResult.noteIds);
      this._findNotesCache.set(taskResult.query, {
        expiresAt: now + LOOKUP_CACHE_TTL_MS,
        value: taskResult.noteIds,
      });
    }

    return requestCount;
  }

  private async readNotesIndexed(noteIds: number[]): Promise<ReadNotesResult> {
    const now = Date.now();
    const indexed = new Map<number, AnkiNoteInfo>();
    const missing = [];

    for (const noteId of noteIds) {
      const cached = this._notesInfoCache.get(noteId);

      if (cached && cached.expiresAt > now) {
        indexed.set(noteId, cached.value);
      } else {
        missing.push(noteId);
      }
    }

    if (missing.length === 0) {
      return {
        issuedNotesInfoRequests: 0,
        notesById: indexed,
      };
    }

    const chunks = this.chunkIds(missing);
    const chunkResults = await this.runTasksWithConcurrency(
      chunks.map(
        (chunk): (() => Promise<AnkiNoteInfo[]>) =>
          () =>
            notesInfo(chunk, { showToastOnError: false }),
      ),
      NOTES_INFO_CONCURRENCY_LIMIT,
    );

    for (const chunk of chunkResults) {
      if (!chunk) {
        continue;
      }

      for (const note of chunk) {
        indexed.set(note.noteId, note);
        this._notesInfoCache.set(note.noteId, {
          expiresAt: now + LOOKUP_CACHE_TTL_MS,
          value: note,
        });
      }
    }

    return {
      issuedNotesInfoRequests: chunks.length,
      notesById: indexed,
    };
  }

  private async readCardsIndexed(cardIds: number[]): Promise<ReadCardsResult> {
    const now = Date.now();
    const indexed = new Map<number, AnkiCardInfo>();
    const missing = [];

    for (const cardId of cardIds) {
      const cached = this._cardsInfoCache.get(cardId);

      if (cached && cached.expiresAt > now) {
        indexed.set(cardId, cached.value);
      } else {
        missing.push(cardId);
      }
    }

    if (missing.length === 0) {
      return {
        issuedCardsInfoRequests: 0,
        cardsById: indexed,
      };
    }

    const chunks = this.chunkIds(missing);
    const chunkResults = await this.runTasksWithConcurrency(
      chunks.map(
        (chunk): (() => Promise<AnkiCardInfo[]>) =>
          () =>
            cardsInfo(chunk, { showToastOnError: false }),
      ),
      CARDS_INFO_CONCURRENCY_LIMIT,
    );

    for (const chunk of chunkResults) {
      if (!chunk) {
        continue;
      }

      for (const card of chunk) {
        indexed.set(card.cardId, card);
        this._cardsInfoCache.set(card.cardId, {
          expiresAt: now + LOOKUP_CACHE_TTL_MS,
          value: card,
        });
      }
    }

    return {
      issuedCardsInfoRequests: chunks.length,
      cardsById: indexed,
    };
  }

  private async readIntervalsIndexed(cardIds: number[]): Promise<ReadIntervalsResult> {
    const now = Date.now();
    const indexed = new Map<number, number>();
    const missing = [];

    for (const cardId of cardIds) {
      const cached = this._intervalsCache.get(cardId);

      if (cached && cached.expiresAt > now) {
        indexed.set(cardId, cached.value);
      } else {
        missing.push(cardId);
      }
    }

    if (missing.length === 0) {
      return {
        intervalsByCardId: indexed,
        issuedIntervalRequests: 0,
      };
    }

    const chunks = this.chunkIds(missing);
    const chunkResults = await this.runTasksWithConcurrency(
      chunks.map(
        (chunk): (() => Promise<number[]>) =>
          () =>
            getIntervals(chunk, { showToastOnError: false }),
      ),
      CARDS_INFO_CONCURRENCY_LIMIT,
    );

    for (const [chunkIndex, intervals] of chunkResults.entries()) {
      if (!intervals) {
        continue;
      }

      const requestedCards = chunks[chunkIndex];

      for (const [intervalIndex, rawInterval] of intervals.entries()) {
        const cardId = requestedCards[intervalIndex];

        if (typeof cardId !== 'number' || !Number.isFinite(rawInterval)) {
          continue;
        }

        indexed.set(cardId, rawInterval);
        this._intervalsCache.set(cardId, {
          expiresAt: now + LOOKUP_CACHE_TTL_MS,
          value: rawInterval,
        });
      }
    }

    return {
      intervalsByCardId: indexed,
      issuedIntervalRequests: chunks.length,
    };
  }

  private resolveTermFromIndexes(
    termContext: TermContext,
    lookupConfigs: LookupConfig[],
    noteIdsByPlanKey: Map<string, number[]>,
    notesById: Map<number, AnkiNoteInfo>,
    cardsById: Map<number, AnkiCardInfo>,
    intervalsByCardId: Map<number, number>,
    eligibleTargets: EligibleAnkiTargets,
  ): ReviewTermResolution {
    const candidates: AnkiTargetCandidate[] = [];
    const seenTargets = new Set<string>();

    for (const lookupConfig of lookupConfigs) {
      const planKey = this.getPlanKey(termContext.termKey, lookupConfig.id);
      const noteIds = noteIdsByPlanKey.get(planKey) ?? [];

      for (const noteId of noteIds) {
        const note = notesById.get(noteId);

        if (!note || !eligibleTargets.models.has(note.modelName)) {
          continue;
        }

        const wordValue = this.normaliseTextValue(note.fields[lookupConfig.wordField]?.value ?? '');

        if (wordValue !== termContext.normalisedSpelling) {
          continue;
        }

        const readingField = lookupConfig.config.readingField?.trim();

        if (readingField?.length) {
          const noteReading = this.normaliseReadingValue(note.fields[readingField]?.value ?? '');

          if (noteReading !== termContext.normalisedReading) {
            continue;
          }
        }

        for (const cardId of note.cards) {
          const card = cardsById.get(cardId);

          if (!card) {
            continue;
          }

          if (!eligibleTargets.decks.has(card.deckName)) {
            continue;
          }

          if (!eligibleTargets.models.has(card.modelName)) {
            continue;
          }

          if (!eligibleTargets.templates.has(card.ord)) {
            continue;
          }

          const due = this.isCardDue(card);
          const stateTags = this.getStateTags(card.queue, due, intervalsByCardId.get(card.cardId));
          const candidate: AnkiTargetCandidate = {
            target: {
              key: `anki:${card.cardId}`,
              wordId: termContext.vocabulary.wordId,
              readingIndex: termContext.vocabulary.readingIndex,
              ankiNoteId: card.note,
              ankiCardId: card.cardId,
              ankiDeck: card.deckName,
              ankiModel: card.modelName,
              ankiTemplateOrd: card.ord,
            },
            stateTags,
            dueState: due ? 'due' : 'notDue',
          };

          if (seenTargets.has(candidate.target.key)) {
            continue;
          }

          candidates.push(candidate);
          seenTargets.add(candidate.target.key);
        }
      }
    }

    if (candidates.length === 0) {
      return this.createUnmappedResolution();
    }

    if (candidates.length > 1) {
      const hasDueCandidate = candidates.some((candidate) => candidate.dueState === 'due');
      const mergedStateTags = this.mergeAmbiguousStateTags(candidates);

      if (hasDueCandidate && !mergedStateTags.includes(JitenCardState.DUE)) {
        mergedStateTags.unshift(JitenCardState.DUE);
      }

      return {
        stateTags: mergedStateTags,
        mappingState: 'ambiguous',
        dueState: hasDueCandidate ? 'due' : 'notDue',
        targetState: 'ambiguous',
      };
    }

    const [candidate] = candidates;

    return {
      stateTags: candidate.stateTags,
      mappingState: 'mapped',
      dueState: candidate.dueState,
      targetState: 'selected',
      target: candidate.target,
    };
  }

  private async getEligibleAnkiTargets(
    readonlyConfigs: DiscoverWordConfiguration[],
  ): Promise<EligibleAnkiTargets> {
    const [mining, blacklist, neverForget] = await Promise.all([
      getConfiguration('ankiMiningConfig'),
      getConfiguration('ankiBlacklistConfig'),
      getConfiguration('ankiNeverForgetConfig'),
    ]);
    const decks = new Set<string>();
    const models = new Set<string>();

    for (const config of readonlyConfigs) {
      if (config.deck?.trim().length) {
        decks.add(config.deck.trim());
      }

      if (config.model?.trim().length) {
        models.add(config.model.trim());
      }
    }

    for (const config of [mining, blacklist, neverForget]) {
      if (config.deck?.trim().length) {
        decks.add(config.deck.trim());
      }

      if (config.model?.trim().length) {
        models.add(config.model.trim());
      }
    }

    return {
      decks,
      models,
      templates: new Set(ELIGIBLE_TEMPLATE_ORDS),
    };
  }

  private buildResolutionMapFromTerms(
    vocabulary: JitenRawVocabulary[],
    termContexts: Map<string, TermContext>,
    getResolutionForTerm: (termKey: string) => ReviewTermResolution,
  ): ReviewTermResolutionMap {
    const states: ReviewTermResolutionMap = {};

    for (const vocab of vocabulary) {
      const termKey = this.getTermKey(vocab);
      const context = termContexts.get(termKey);
      const key = `${vocab.wordId}/${vocab.readingIndex}`;

      states[key] = context
        ? getResolutionForTerm(context.termKey)
        : this.createUnmappedResolution();
    }

    return states;
  }

  private getTermKey(vocab: JitenRawVocabulary): string {
    const spelling = this.normaliseTextValue(vocab.spelling);
    const reading = this.normaliseReadingValue(vocab.reading);

    return `${spelling}\u0000${reading}`;
  }

  private getPlanKey(termKey: string, configId: string): string {
    return `${termKey}\u0000${configId}`;
  }

  private getUniqueIds(idGroups: Iterable<number[]>): number[] {
    const ids = new Set<number>();

    for (const group of idGroups) {
      for (const id of group) {
        ids.add(id);
      }
    }

    return Array.from(ids);
  }

  private createAnkiQuerySegment(field: string, value: string): string {
    const escaped = value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');

    return `${field}:"${escaped}"`;
  }

  private normaliseTextValue(value: string): string {
    return value.normalize('NFKC').replace(/\s+/g, '').trim();
  }

  private normaliseReadingValue(value: string): string {
    const flattened = value
      .replace(/[\u4e00-\u9faf\u3005-\u3007]+\[([^\]]+)\]/g, '$1')
      .replace(/[\[\]]/g, '');

    return this.katakanaToHiragana(this.normaliseTextValue(flattened));
  }

  private async getStateTagsForCard(
    card: Pick<AnkiCardInfo, 'cardId' | 'queue' | 'due'>,
  ): Promise<JitenCardState[]> {
    const due = this.isCardDue(card);
    const intervalsLookup = await this.readIntervalsIndexed([card.cardId]);

    return this.getStateTags(card.queue, due, intervalsLookup.intervalsByCardId.get(card.cardId));
  }

  private getStateTags(queue: number, due: boolean, intervalDays?: number): JitenCardState[] {
    const stateTags: JitenCardState[] = [];
    const schedulingState = this.getSchedulingState(queue, intervalDays);

    if (due) {
      stateTags.push(JitenCardState.DUE);
    }

    if (schedulingState) {
      stateTags.push(schedulingState);
    }

    return stateTags;
  }

  private getSchedulingState(queue: number, intervalDays?: number): JitenCardState | undefined {
    if (queue === ANKI_QUEUE_NEW) {
      return JitenCardState.NEW;
    }

    if (typeof intervalDays !== 'number' || !Number.isFinite(intervalDays)) {
      return;
    }

    return intervalDays >= ANKI_MATURE_INTERVAL_DAYS ? JitenCardState.MATURE : JitenCardState.YOUNG;
  }

  private mergeAmbiguousStateTags(candidates: AnkiTargetCandidate[]): JitenCardState[] {
    const hasDueCandidate = candidates.some((candidate) => candidate.dueState === 'due');
    const maturityStates = new Set<JitenCardState>();

    for (const candidate of candidates) {
      if (candidate.stateTags.includes(JitenCardState.NEW)) {
        maturityStates.add(JitenCardState.NEW);
      }

      if (candidate.stateTags.includes(JitenCardState.MATURE)) {
        maturityStates.add(JitenCardState.MATURE);
      }

      if (candidate.stateTags.includes(JitenCardState.YOUNG)) {
        maturityStates.add(JitenCardState.YOUNG);
      }
    }

    const stateTags: JitenCardState[] = [];

    if (hasDueCandidate) {
      stateTags.push(JitenCardState.DUE);
    }

    if (maturityStates.size === 1) {
      const [maturityState] = Array.from(maturityStates);

      stateTags.push(maturityState);
    }

    return stateTags;
  }

  private katakanaToHiragana(value: string): string {
    return value.replace(/[\u30a1-\u30f6]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0x60),
    );
  }

  private isCardDue(card: Pick<AnkiCardInfo, 'queue' | 'due'>): boolean {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const ankiCollectionDayNumber = this.getAnkiCurrentCollectionDayNumber();

    if (card.queue === ANKI_QUEUE_REVIEW || card.queue === ANKI_QUEUE_RELEARNING) {
      if (ankiCollectionDayNumber === undefined) {
        throw new Error('Anki scheduling context is unavailable (missing collection day).');
      }

      return card.due <= ankiCollectionDayNumber;
    }

    if (card.queue === ANKI_QUEUE_LEARNING || card.queue === ANKI_QUEUE_PREVIEW) {
      return card.due <= nowSeconds;
    }

    return false;
  }

  private getAnkiCurrentCollectionDayNumber(): number | undefined {
    if (this._cachedCollectionCreatedAtMs === undefined) {
      return;
    }

    const nowAnchor = this.getAnkiDayAnchor(new Date());
    const collectionAnchor = this.getAnkiDayAnchor(new Date(this._cachedCollectionCreatedAtMs));
    const nowEpochDay = this.getEpochDayNumber(nowAnchor);
    const collectionEpochDay = this.getEpochDayNumber(collectionAnchor);

    return Math.max(0, nowEpochDay - collectionEpochDay);
  }

  private getAnkiDayAnchor(date: Date): Date {
    const ankiDayAnchor = new Date(date);

    if (date.getHours() < this._cachedRolloverHour) {
      ankiDayAnchor.setDate(ankiDayAnchor.getDate() - 1);
    }

    ankiDayAnchor.setHours(0, 0, 0, 0);

    return ankiDayAnchor;
  }

  private getEpochDayNumber(anchor: Date): number {
    return Math.floor(
      Date.UTC(anchor.getFullYear(), anchor.getMonth(), anchor.getDate()) / 86_400_000,
    );
  }

  private chunkIds(ids: number[]): number[][] {
    const chunks = [];

    for (let i = 0; i < ids.length; i += MAX_BATCH_IDS) {
      chunks.push(ids.slice(i, i + MAX_BATCH_IDS));
    }

    return chunks;
  }

  private chunkQueryBatch(queries: string[], chunkSize: number): string[][] {
    const chunks = [];

    for (let i = 0; i < queries.length; i += chunkSize) {
      chunks.push(queries.slice(i, i + chunkSize));
    }

    return chunks;
  }

  private async runTasksWithConcurrency<T>(
    tasks: (() => Promise<T>)[],
    concurrencyLimit: number,
  ): Promise<(T | undefined)[]> {
    const results = Array.from({ length: tasks.length }, (): T | undefined => undefined);

    let cursor = 0;
    const workerCount = Math.max(1, Math.min(concurrencyLimit, tasks.length));

    const workers = Array.from({ length: workerCount }, async () => {
      while (cursor < tasks.length) {
        const index = cursor;

        cursor += 1;

        try {
          results[index] = await tasks[index]();
        } catch {
          results[index] = undefined;
        }
      }
    });

    await Promise.all(workers);

    return results;
  }

  private createUnavailableResolution(): ReviewTermResolution {
    return {
      stateTags: [],
      mappingState: 'unmapped',
      dueState: 'unavailable',
      targetState: 'none',
    };
  }

  private createUnmappedResolution(): ReviewTermResolution {
    return {
      stateTags: [JitenCardState.NEW],
      mappingState: 'unmapped',
      dueState: 'unknown',
      targetState: 'none',
    };
  }
}
