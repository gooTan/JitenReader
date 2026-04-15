import { AnkiCardInfo, AnkiNoteInfo } from '@shared/anki/api.types';
import { cardsInfo } from '@shared/anki/cards-info';
import { findNotes } from '@shared/anki/find-notes';
import { findNotesMany } from '@shared/anki/find-notes-many';
import { getIntervals } from '@shared/anki/get-intervals';
import { AnkiModelTemplate, getModelTemplates } from '@shared/anki/get-model-templates';
import { notesInfo } from '@shared/anki/notes-info';
import { getPlanKey } from './anki-read-planner';
import {
  CARDS_INFO_CONCURRENCY_LIMIT,
  FIND_NOTES_CONCURRENCY_LIMIT,
  FIND_NOTES_MULTI_BATCH_SIZE,
  LOOKUP_CACHE_TTL_MS,
  MAX_BATCH_IDS,
  NOTES_INFO_CONCURRENCY_LIMIT,
} from './anki-review-backend.constants';
import {
  CacheEntry,
  LookupPlan,
  ReadCardsResult,
  ReadIntervalsResult,
  ReadNotesResult,
  ResolvePlanNoteIdsResult,
} from './anki-review-backend.internal-types';

export class AnkiReadRepository {
  private readonly _findNotesCache = new Map<string, CacheEntry<number[]>>();
  private readonly _notesInfoCache = new Map<number, CacheEntry<AnkiNoteInfo>>();
  private readonly _cardsInfoCache = new Map<number, CacheEntry<AnkiCardInfo>>();
  private readonly _intervalsCache = new Map<number, CacheEntry<number>>();
  private readonly _modelTemplatesCache = new Map<string, CacheEntry<AnkiModelTemplate[]>>();
  private readonly _inFlightModelTemplates = new Map<string, Promise<AnkiModelTemplate[]>>();

  public invalidateAll(): void {
    this._findNotesCache.clear();
    this._notesInfoCache.clear();
    this._cardsInfoCache.clear();
    this._intervalsCache.clear();
    this._modelTemplatesCache.clear();
    this._inFlightModelTemplates.clear();
  }

  public invalidateCard(cardId: number): void {
    this._cardsInfoCache.delete(cardId);
  }

  public async readCardFresh(cardId: number): Promise<AnkiCardInfo | undefined> {
    const [card] = await cardsInfo([cardId], { showToastOnError: false });

    if (card?.cardId !== cardId) {
      return;
    }

    this._cardsInfoCache.set(card.cardId, {
      expiresAt: Date.now() + LOOKUP_CACHE_TTL_MS,
      value: card,
    });

    return card;
  }

  public async resolvePlanNoteIds(plans: LookupPlan[]): Promise<ResolvePlanNoteIdsResult> {
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
      const planKey = getPlanKey(plan.termKey, plan.configId);

      noteIdsByPlanKey.set(planKey, queryResults.get(plan.query) ?? []);
    }

    return {
      issuedFindNotesRequests,
      noteIdsByPlanKey,
      uniqueQueries: uniqueQueries.length,
    };
  }

  public async readNotesIndexed(noteIds: number[]): Promise<ReadNotesResult> {
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

  public async readCardsIndexed(cardIds: number[]): Promise<ReadCardsResult> {
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

  public async readIntervalsIndexed(cardIds: number[]): Promise<ReadIntervalsResult> {
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

  public async primeModelTemplates(modelNames: string[]): Promise<void> {
    await Promise.all(modelNames.map((modelName) => this.ensureModelTemplates(modelName)));
  }

  public async getTemplateNameLoaded(modelName: string, ord: number): Promise<string | undefined> {
    const templates = await this.ensureModelTemplates(modelName);

    return templates.find((template) => template.ord === ord)?.name;
  }

  public getTemplateName(modelName: string, ord: number): string | undefined {
    const cached = this._modelTemplatesCache.get(modelName);
    const templates = cached?.value;

    return templates?.find((template) => template.ord === ord)?.name;
  }

  private async ensureModelTemplates(modelName: string): Promise<AnkiModelTemplate[]> {
    const now = Date.now();
    const cached = this._modelTemplatesCache.get(modelName);

    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    let inFlight = this._inFlightModelTemplates.get(modelName);

    if (!inFlight) {
      inFlight = (async (): Promise<AnkiModelTemplate[]> => {
        const templates = await getModelTemplates(modelName, { showToastOnError: false });

        this._modelTemplatesCache.set(modelName, {
          expiresAt: now + LOOKUP_CACHE_TTL_MS,
          value: templates,
        });

        return templates;
      })();

      this._inFlightModelTemplates.set(modelName, inFlight);
    }

    try {
      return await inFlight;
    } finally {
      this._inFlightModelTemplates.delete(modelName);
    }
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
}
