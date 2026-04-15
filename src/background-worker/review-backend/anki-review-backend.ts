import { GetAnkiCreatePathCapability } from '@shared/anki/create-path-capability';
import { getReadonlyDiscoverWordConfigurationSummary } from '@shared/anki/readonly-config';
import { targetedReviewWrite } from '@shared/anki/targeted-review-write';
import { getConfiguration } from '@shared/configuration/get-configuration';
import { debug } from '@shared/debug';
import { createReviewMetadata } from '@shared/jiten/create-review-metadata';
import {
  GetBlockedReviewabilityError,
  ResolveReviewability,
  ReviewabilityOptions,
  ReviewabilityResult,
} from '@shared/jiten/reviewability';
import {
  JitenCardState,
  JitenRawVocabulary,
  JitenRating,
  ReviewMetadata,
  ReviewTermSnapshot,
} from '@shared/jiten/types';
import { AnkiReadContext } from './anki-read-context';
import {
  buildResolutionMapFromTerms,
  createLookupPlans,
  getLookupConfigs,
  getUniqueIds,
  getUniqueTermContexts,
} from './anki-read-planner';
import { AnkiReadRepository } from './anki-read-repository';
import { AnkiReadinessService } from './anki-readiness-service';
import { ANKI_REVIEW_BACKEND_CAPABILITIES } from './anki-review-backend.constants';
import { AnkiParseLookupMetrics } from './anki-review-backend.internal-types';
import {
  createConfigInsufficientResolution,
  createUnmappedResolution,
  getStateTagsForCard,
  resolveTermFromIndexes,
} from './anki-term-resolver';
import { TargetedReviewWriteError, UnsupportedReviewOperationError } from './review-backend.errors';
import {
  ReviewBackend,
  ReviewBackendCapabilities,
  ReviewBackendParseMetrics,
  ReviewCardStateContext,
  ReviewDeck,
  ReviewDeckAction,
  ReviewGradeContext,
  ReviewTermResolution,
  ReviewTermResolutionMap,
} from './review-backend.types';

export class AnkiReviewBackend implements ReviewBackend {
  private _lastParseMetrics?: AnkiParseLookupMetrics;
  private readonly _readContext: AnkiReadContext;
  private readonly _repository = new AnkiReadRepository();

  public constructor(private readonly _readinessService: AnkiReadinessService) {
    this._readContext = new AnkiReadContext(_readinessService);
  }

  public getCapabilities(): ReviewBackendCapabilities {
    return ANKI_REVIEW_BACKEND_CAPABILITIES;
  }

  public invalidateCaches(): void {
    this._readinessService.invalidate();
    this._readContext.invalidate();
    this._repository.invalidateAll();
  }

  public async getParseReviewStates(
    vocabulary: JitenRawVocabulary[],
  ): Promise<ReviewTermResolutionMap> {
    const readContextReadyStartedAt = performance.now();

    await this._readContext.ensureReady();
    const readContextReadyMs = performance.now() - readContextReadyStartedAt;

    const termContexts = getUniqueTermContexts(vocabulary);
    const readonlyConfigStartedAt = performance.now();
    const readonlyConfigSummary = await this.getReadonlyConfigSummary();
    const readonlyConfigMs = performance.now() - readonlyConfigStartedAt;

    if (readonlyConfigSummary.status !== 'ready') {
      debug('AnkiParseReviewProfile', {
        readonlyConfigMs,
        readContextReadyMs,
        readonlyConfigStatus: readonlyConfigSummary.status,
        totalTerms: termContexts.size,
      });

      return buildResolutionMapFromTerms(vocabulary, termContexts, () =>
        createConfigInsufficientResolution(),
      );
    }

    const lookupConfigs = getLookupConfigs(readonlyConfigSummary.mergedConfigs);
    const plans = createLookupPlans(termContexts, lookupConfigs);
    const resolvePlanNoteIdsStartedAt = performance.now();
    const planLookupResult = await this._repository.resolvePlanNoteIds(plans);
    const resolvePlanNoteIdsMs = performance.now() - resolvePlanNoteIdsStartedAt;
    const readNotesIndexedStartedAt = performance.now();
    const notesLookupResult = await this._repository.readNotesIndexed(
      getUniqueIds(planLookupResult.noteIdsByPlanKey.values()),
    );
    const readNotesIndexedMs = performance.now() - readNotesIndexedStartedAt;
    const notesById = notesLookupResult.notesById;
    const primeModelTemplatesMs = 0;

    const readCardsIndexedStartedAt = performance.now();
    const cardsLookupResult = await this._repository.readCardsIndexed(
      getUniqueIds(Array.from(notesById.values(), (note) => note.cards)),
    );
    const readCardsIndexedMs = performance.now() - readCardsIndexedStartedAt;
    const cardsById = cardsLookupResult.cardsById;
    const readIntervalsIndexedStartedAt = performance.now();
    const intervalsLookupResult = await this._repository.readIntervalsIndexed(
      Array.from(cardsById.keys()),
    );
    const readIntervalsIndexedMs = performance.now() - readIntervalsIndexedStartedAt;
    const intervalsByCardId = intervalsLookupResult.intervalsByCardId;
    const resolutionsByTerm = new Map<string, ReviewTermResolution>();
    const resolveTermsStartedAt = performance.now();

    for (const termContext of termContexts.values()) {
      const resolution = resolveTermFromIndexes({
        termContext,
        lookupConfigs,
        noteIdsByPlanKey: planLookupResult.noteIdsByPlanKey,
        notesById,
        cardsById,
        intervalsByCardId,
        getTemplateName: (modelName, ord) => this._repository.getTemplateName(modelName, ord),
        isCardDue: (card) => this._readContext.isCardDue(card),
      });

      resolutionsByTerm.set(termContext.termKey, resolution);
    }

    const resolveTermsMs = performance.now() - resolveTermsStartedAt;

    this._lastParseMetrics = {
      cardsInfoRequests: cardsLookupResult.issuedCardsInfoRequests,
      findNotesRequests: planLookupResult.issuedFindNotesRequests,
      intervalRequests: intervalsLookupResult.issuedIntervalRequests,
      notesInfoRequests: notesLookupResult.issuedNotesInfoRequests,
      primeModelTemplatesMs,
      readCardsIndexedMs,
      readContextReadyMs,
      readIntervalsIndexedMs,
      readNotesIndexedMs,
      readonlyConfigMs,
      resolvePlanNoteIdsMs,
      resolveTermsMs,
      totalTerms: termContexts.size,
      uniqueCardIds: cardsById.size,
      uniqueNoteIds: notesById.size,
      uniqueQueries: planLookupResult.uniqueQueries,
    };

    debug('AnkiParseReviewProfile', this._lastParseMetrics);

    return buildResolutionMapFromTerms(vocabulary, termContexts, (termKey) => {
      return resolutionsByTerm.get(termKey) ?? createUnmappedResolution();
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
    await this._readContext.ensureReady();
    const targetCardId = context?.targetCardId;

    if (!targetCardId || targetCardId <= 0) {
      return [];
    }

    const targetCard = await this._repository.readCardFresh(targetCardId);

    if (targetCard?.cardId !== targetCardId) {
      return [];
    }

    const intervalsLookup = await this._repository.readIntervalsIndexed([targetCard.cardId]);

    return getStateTagsForCard(
      targetCard,
      intervalsLookup.intervalsByCardId.get(targetCard.cardId),
      this._readContext.isCardDue(targetCard),
    );
  }

  public async gradeCard(
    wordId: number,
    readingIndex: number,
    rating: JitenRating,
    context?: ReviewGradeContext,
  ): Promise<void> {
    const reviewability = await this.getGradeReviewability(wordId, readingIndex, context);
    const blockedError = GetBlockedReviewabilityError(reviewability);

    if (blockedError) {
      throw new TargetedReviewWriteError(blockedError.code, blockedError.message);
    }

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

    const targetCard = await this._repository.readCardFresh(targetCardId);

    if (targetCard?.cardId !== targetCardId) {
      throw new TargetedReviewWriteError(
        'MISSING_TARGET_CARD',
        'The selected Anki target card could not be found.',
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

    this._repository.invalidateCard(targetCardId);
  }

  public async getGradeReviewability(
    wordId: number,
    readingIndex: number,
    context?: ReviewGradeContext,
  ): Promise<ReviewabilityResult> {
    return ResolveReviewability(
      await this.buildGradeReviewabilityOptions(wordId, readingIndex, context),
    );
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

  private async getReadonlyConfigSummary(): Promise<
    ReturnType<typeof getReadonlyDiscoverWordConfigurationSummary>
  > {
    const [miningConfig, blacklistConfig, neverForgetConfig, explicitConfigs] = await Promise.all([
      getConfiguration('ankiMiningConfig'),
      getConfiguration('ankiBlacklistConfig'),
      getConfiguration('ankiNeverForgetConfig'),
      getConfiguration('ankiReadonlyConfigs'),
    ]);

    return getReadonlyDiscoverWordConfigurationSummary({
      explicitConfigs,
      blacklistConfig,
      miningConfig,
      neverForgetConfig,
    });
  }

  private async buildGradeReviewabilityOptions(
    wordId: number,
    readingIndex: number,
    context?: ReviewGradeContext,
  ): Promise<ReviewabilityOptions> {
    return {
      createPathAvailable: await this.getCreatePathAvailability(),
      reviewMetadata: await this.buildGradeReviewMetadata(wordId, readingIndex, context),
    };
  }

  private async getCreatePathAvailability(): Promise<boolean> {
    const miningConfig = await getConfiguration('ankiMiningConfig');

    return GetAnkiCreatePathCapability(miningConfig).available;
  }

  private async buildGradeReviewMetadata(
    wordId: number,
    readingIndex: number,
    context?: ReviewGradeContext,
  ): Promise<ReviewMetadata> {
    const hintedMetadata = context?.reviewMetadata;
    const termSnapshot = context?.termSnapshot;

    if (hintedMetadata && this.shouldPreserveHintedGradeMetadata(hintedMetadata)) {
      return hintedMetadata;
    }

    try {
      await this._readContext.ensureReady();
    } catch {
      return this.createUnavailableGradeMetadata(wordId, readingIndex, hintedMetadata);
    }

    let currentTermMetadata: ReviewMetadata | undefined;

    if (termSnapshot) {
      try {
        currentTermMetadata = await this.resolveCurrentGradeTermMetadata(
          wordId,
          readingIndex,
          termSnapshot,
        );
      } catch {
        currentTermMetadata = this.createUnavailableGradeMetadata(
          wordId,
          readingIndex,
          hintedMetadata,
        );
      }
    }

    if (
      currentTermMetadata &&
      this.shouldReturnResolvedGradeMetadataDirectly(currentTermMetadata)
    ) {
      return currentTermMetadata;
    }

    const targetCardId =
      context?.targetCardId ??
      hintedMetadata?.target?.ankiCardId ??
      currentTermMetadata?.target?.ankiCardId;

    if (!targetCardId || targetCardId <= 0) {
      return this.createFallbackGradeMetadata(
        wordId,
        readingIndex,
        hintedMetadata,
        currentTermMetadata,
      );
    }

    if (
      currentTermMetadata?.mappingOutcome === 'selected' &&
      currentTermMetadata.target?.ankiCardId !== targetCardId
    ) {
      return this.createStaleSelectedGradeMetadata(
        wordId,
        readingIndex,
        currentTermMetadata.stateTags,
        currentTermMetadata.target,
        currentTermMetadata.diagnostics,
      );
    }

    const targetCard = await this._repository.readCardFresh(targetCardId);

    if (targetCard?.cardId !== targetCardId) {
      return this.createFallbackGradeMetadata(
        wordId,
        readingIndex,
        hintedMetadata,
        currentTermMetadata,
      );
    }

    const intervalsLookup = await this._repository.readIntervalsIndexed([targetCard.cardId]);
    const stateTags = getStateTagsForCard(
      targetCard,
      intervalsLookup.intervalsByCardId.get(targetCard.cardId),
      this._readContext.isCardDue(targetCard),
    );
    const target = {
      key: `anki:${targetCardId}`,
      wordId,
      readingIndex,
      ankiNoteId: targetCard.note,
      ankiCardId: targetCard.cardId,
      ankiDeck: targetCard.deckName,
      ankiModel: targetCard.modelName,
      ankiTemplateOrd: targetCard.ord,
      ankiTemplateName: await this._repository.getTemplateNameLoaded(
        targetCard.modelName,
        targetCard.ord,
      ),
    };

    if (!this.canRebuildSelectedGradeMetadata(currentTermMetadata, targetCardId)) {
      return this.createStaleSelectedGradeMetadata(
        wordId,
        readingIndex,
        stateTags,
        target,
        currentTermMetadata?.diagnostics ?? hintedMetadata?.diagnostics,
      );
    }

    return createReviewMetadata({
      backend: 'anki',
      wordId,
      readingIndex,
      stateTags,
      freshness: 'fresh',
      actionsAvailable: true,
      resolutionStatus: 'resolved',
      mappingOutcome: 'selected',
      dueState: stateTags.includes(JitenCardState.DUE) ? 'due' : 'notDue',
      target,
      diagnostics: currentTermMetadata?.diagnostics ?? hintedMetadata?.diagnostics,
    });
  }

  private async resolveCurrentGradeTermMetadata(
    wordId: number,
    readingIndex: number,
    termSnapshot: ReviewTermSnapshot,
  ): Promise<ReviewMetadata> {
    this._repository.invalidateAll();

    const vocabulary: JitenRawVocabulary[] = [
      {
        wordId,
        readingIndex,
        spelling: termSnapshot.spelling,
        reading: termSnapshot.reading,
        frequencyRank: 0,
        partsOfSpeech: [],
        meaningsChunks: [],
        meaningsPartOfSpeech: [],
        knownState: [],
        pitchAccents: null,
      },
    ];
    const currentResolution =
      (await this.getParseReviewStates(vocabulary))[`${wordId}/${readingIndex}`] ??
      createUnmappedResolution();

    return createReviewMetadata({
      backend: 'anki',
      wordId,
      readingIndex,
      stateTags: currentResolution.stateTags,
      freshness: 'fresh',
      actionsAvailable: true,
      resolutionStatus: currentResolution.resolutionStatus,
      mappingOutcome: currentResolution.mappingOutcome,
      dueState: currentResolution.dueState,
      target: currentResolution.target,
      diagnostics: currentResolution.diagnostics,
    });
  }

  private shouldReturnResolvedGradeMetadataDirectly(reviewMetadata: ReviewMetadata): boolean {
    const isBlockedOrNonSelected =
      reviewMetadata.resolutionStatus !== 'resolved' ||
      reviewMetadata.mappingOutcome !== 'selected';

    return isBlockedOrNonSelected;
  }

  private canRebuildSelectedGradeMetadata(
    currentTermMetadata: ReviewMetadata | undefined,
    targetCardId: number,
  ): boolean {
    return (
      currentTermMetadata?.backend === 'anki' &&
      currentTermMetadata.resolutionStatus === 'resolved' &&
      currentTermMetadata.mappingOutcome === 'selected' &&
      currentTermMetadata.target?.ankiCardId === targetCardId
    );
  }

  private shouldPreserveHintedGradeMetadata(reviewMetadata: ReviewMetadata): boolean {
    return (
      reviewMetadata.backend === 'anki' &&
      (reviewMetadata.resolutionStatus !== 'resolved' ||
        reviewMetadata.mappingOutcome !== 'selected' ||
        (reviewMetadata.freshness === 'stale' &&
          reviewMetadata.mappingOutcome === 'selected' &&
          reviewMetadata.dueState === 'unknown'))
    );
  }

  private createFallbackGradeMetadata(
    wordId: number,
    readingIndex: number,
    hintedMetadata?: ReviewMetadata,
    currentTermMetadata?: ReviewMetadata,
  ): ReviewMetadata {
    if (currentTermMetadata) {
      if (currentTermMetadata.mappingOutcome === 'selected' && currentTermMetadata.target) {
        return this.createStaleSelectedGradeMetadata(
          wordId,
          readingIndex,
          currentTermMetadata.stateTags,
          currentTermMetadata.target,
          currentTermMetadata.diagnostics,
        );
      }

      return currentTermMetadata;
    }

    if (hintedMetadata) {
      if (
        hintedMetadata.backend === 'anki' &&
        hintedMetadata.resolutionStatus === 'resolved' &&
        hintedMetadata.mappingOutcome === 'selected' &&
        hintedMetadata.target
      ) {
        return this.createStaleSelectedGradeMetadata(
          wordId,
          readingIndex,
          hintedMetadata.stateTags,
          hintedMetadata.target,
          hintedMetadata.diagnostics,
        );
      }

      return hintedMetadata;
    }

    return createReviewMetadata({
      backend: 'anki',
      wordId,
      readingIndex,
      stateTags: [JitenCardState.NEW],
      freshness: 'unknown',
      actionsAvailable: true,
      resolutionStatus: 'resolved',
      mappingOutcome: 'none',
      dueState: 'unknown',
    });
  }

  private createStaleSelectedGradeMetadata(
    wordId: number,
    readingIndex: number,
    stateTags: JitenCardState[],
    target: NonNullable<ReviewMetadata['target']>,
    diagnostics?: ReviewMetadata['diagnostics'],
  ): ReviewMetadata {
    return createReviewMetadata({
      backend: 'anki',
      wordId,
      readingIndex,
      stateTags,
      freshness: 'stale',
      actionsAvailable: true,
      resolutionStatus: 'resolved',
      mappingOutcome: 'selected',
      dueState: 'unknown',
      target,
      diagnostics,
    });
  }

  private createUnavailableGradeMetadata(
    wordId: number,
    readingIndex: number,
    hintedMetadata?: ReviewMetadata,
  ): ReviewMetadata {
    return createReviewMetadata({
      backend: 'anki',
      wordId,
      readingIndex,
      stateTags: hintedMetadata?.stateTags ?? [],
      freshness: hintedMetadata?.freshness ?? 'unknown',
      actionsAvailable: true,
      resolutionStatus: 'backend-unavailable',
      dueState: 'unavailable',
      target: hintedMetadata?.target,
      diagnostics: hintedMetadata?.diagnostics,
    });
  }
}
