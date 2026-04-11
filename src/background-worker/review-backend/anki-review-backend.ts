import { GetAnkiCreatePathCapability } from '@shared/anki/create-path-capability';
import {
  getMaterializedSentenceFieldCount,
  materializeAnkiNoteFields,
} from '@shared/anki/materialize-note-fields';
import { getReadonlyDiscoverWordConfigurationSummary } from '@shared/anki/readonly-config';
import { targetedReviewCommit } from '@shared/anki/targeted-review-commit';
import { AnkiWriteTargetIssueCode, ResolveAnkiWriteTarget } from '@shared/anki/write-target';
import { getConfiguration } from '@shared/configuration/get-configuration';
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
  ReviewGradeResult,
  ReviewTermResolution,
  ReviewTermResolutionMap,
} from './review-backend.types';

export class AnkiReviewBackend implements ReviewBackend {
  private _lastParseMetrics?: AnkiParseLookupMetrics;
  private readonly _pendingGradeRequests = new Set<string>();
  private readonly _readContext = new AnkiReadContext();
  private readonly _repository = new AnkiReadRepository();

  public getCapabilities(): ReviewBackendCapabilities {
    return ANKI_REVIEW_BACKEND_CAPABILITIES;
  }

  public invalidateCaches(): void {
    this._readContext.invalidate();
    this._repository.invalidateAll();
  }

  public async getParseReviewStates(
    vocabulary: JitenRawVocabulary[],
  ): Promise<ReviewTermResolutionMap> {
    await this._readContext.ensureReady();
    const termContexts = getUniqueTermContexts(vocabulary);
    const readonlyConfigSummary = await this.getReadonlyConfigSummary();

    if (readonlyConfigSummary.status !== 'ready') {
      return buildResolutionMapFromTerms(vocabulary, termContexts, () =>
        createConfigInsufficientResolution(),
      );
    }

    const lookupConfigs = getLookupConfigs(readonlyConfigSummary.mergedConfigs);
    const plans = createLookupPlans(termContexts, lookupConfigs);
    const planLookupResult = await this._repository.resolvePlanNoteIds(plans);
    const notesLookupResult = await this._repository.readNotesIndexed(
      getUniqueIds(planLookupResult.noteIdsByPlanKey.values()),
    );
    const notesById = notesLookupResult.notesById;

    await this._repository.primeModelTemplates(
      Array.from(new Set(Array.from(notesById.values(), (note) => note.modelName))),
    );

    const cardsLookupResult = await this._repository.readCardsIndexed(
      getUniqueIds(Array.from(notesById.values(), (note) => note.cards)),
    );
    const cardsById = cardsLookupResult.cardsById;
    const intervalsLookupResult = await this._repository.readIntervalsIndexed(
      Array.from(cardsById.keys()),
    );
    const intervalsByCardId = intervalsLookupResult.intervalsByCardId;
    const resolutionsByTerm = new Map<string, ReviewTermResolution>();

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
  ): Promise<ReviewGradeResult> {
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

    const requestKey = `${wordId}/${readingIndex}`;

    if (this._pendingGradeRequests.has(requestKey)) {
      throw new TargetedReviewWriteError(
        'REQUEST_IN_FLIGHT',
        'This Anki review action is already in progress.',
      );
    }

    const reviewMetadata = await this.buildGradeReviewMetadata(wordId, readingIndex, context);
    const isSelectedTarget =
      reviewMetadata.resolutionStatus === 'resolved' &&
      reviewMetadata.mappingOutcome === 'selected' &&
      !!reviewMetadata.target?.ankiCardId;

    this._pendingGradeRequests.add(requestKey);

    try {
      if (isSelectedTarget) {
        return await this.commitToExistingCard(
          wordId,
          readingIndex,
          rating,
          reviewMetadata,
          context,
        );
      }

      return await this.commitByCreatingCard(wordId, readingIndex, rating, reviewMetadata, context);
    } finally {
      this._pendingGradeRequests.delete(requestKey);
    }
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
      ankiTemplateName: this._repository.getTemplateName(targetCard.modelName, targetCard.ord),
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

  private async commitToExistingCard(
    wordId: number,
    readingIndex: number,
    rating: Exclude<JitenRating, 'unknown'>,
    reviewMetadata: ReviewMetadata,
    context?: ReviewGradeContext,
  ): Promise<ReviewGradeResult> {
    const targetCardId = context?.targetCardId ?? reviewMetadata.target?.ankiCardId;

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

    const response = await targetedReviewCommit(
      {
        version: 1,
        requestId: context?.requestId,
        term: {
          key: `${wordId}/${readingIndex}`,
          wordId,
          readingIndex,
          spelling: context?.termSnapshot?.spelling ?? '',
          reading: context?.termSnapshot?.reading ?? '',
        },
        rating,
        target: {
          kind: 'existing-card',
          cardId: targetCardId,
        },
      },
      { showToastOnError: false },
    );

    return this.buildCommitResult(wordId, readingIndex, response);
  }

  private async commitByCreatingCard(
    wordId: number,
    readingIndex: number,
    rating: Exclude<JitenRating, 'unknown'>,
    reviewMetadata: ReviewMetadata,
    context?: ReviewGradeContext,
  ): Promise<ReviewGradeResult> {
    if (
      reviewMetadata.resolutionStatus !== 'resolved' ||
      reviewMetadata.mappingOutcome !== 'none'
    ) {
      throw new TargetedReviewWriteError(
        'WRITE_TARGET_INVALID',
        'Cannot create a new Anki card for the current review state.',
      );
    }

    const termSnapshot = context?.termSnapshot;

    if (!termSnapshot) {
      throw new TargetedReviewWriteError(
        'INVALID_REQUEST',
        'Missing term details required for Anki note creation.',
      );
    }

    const miningConfig = await getConfiguration('ankiMiningConfig');
    const includeSentenceFields = await getConfiguration('setSentences');
    const writeTarget = ResolveAnkiWriteTarget(miningConfig);

    if (!writeTarget.available) {
      throw this.createWriteTargetError(writeTarget.reason);
    }

    const response = await targetedReviewCommit(
      {
        version: 1,
        requestId: context?.requestId,
        term: {
          key: `${wordId}/${readingIndex}`,
          wordId,
          readingIndex,
          spelling: termSnapshot.spelling,
          reading: termSnapshot.reading,
        },
        rating,
        target: {
          kind: 'create-and-review',
          writeTarget: {
            deck: writeTarget.target.deck,
            model: writeTarget.target.model,
            wordField: writeTarget.target.wordField,
            readingField: writeTarget.target.readingField,
            cardTemplateOrd: writeTarget.target.cardTemplateOrd,
          },
          noteFields: materializeAnkiNoteFields(
            writeTarget.target,
            termSnapshot,
            includeSentenceFields,
          ),
          sentenceFieldCount: getMaterializedSentenceFieldCount(
            writeTarget.target,
            termSnapshot,
            includeSentenceFields,
          ),
        },
      },
      { showToastOnError: false },
    );

    return this.buildCommitResult(wordId, readingIndex, response);
  }

  private async buildCommitResult(
    wordId: number,
    readingIndex: number,
    response: Awaited<ReturnType<typeof targetedReviewCommit>>,
  ): Promise<ReviewGradeResult> {
    if (!response.success) {
      throw new TargetedReviewWriteError(
        response.error.code,
        response.error.message,
        response.error.details,
      );
    }

    this._repository.invalidateAll();

    let dueState: ReviewMetadata['dueState'] = 'unknown';
    let stateTags: JitenCardState[];

    try {
      await this._readContext.ensureReady();

      const due = this._readContext.isCardDue({
        queue: response.result.queue,
        due: response.result.due,
      });

      dueState = due ? 'due' : 'notDue';
      stateTags = getStateTagsForCard(
        { queue: response.result.queue },
        response.result.interval,
        due,
      );
    } catch {
      stateTags = this.getStateTagsFromCommitSnapshot(response.result.reviewState);
    }

    const reviewMetadata = createReviewMetadata({
      backend: 'anki',
      wordId,
      readingIndex,
      stateTags,
      freshness: 'fresh',
      actionsAvailable: true,
      resolutionStatus: 'resolved',
      mappingOutcome: 'selected',
      dueState,
      target: {
        key: `anki:${response.result.cardId}`,
        wordId,
        readingIndex,
        ankiNoteId: response.result.noteId,
        ankiCardId: response.result.cardId,
        ankiDeck: response.result.deckName,
        ankiModel: response.result.modelName,
        ankiTemplateOrd: response.result.templateOrd,
        ankiTemplateName: response.result.templateName,
      },
    });

    return {
      backend: 'anki',
      reviewMetadata,
      targetCardId: response.result.cardId,
      transaction: response.result.transaction,
      sentenceFieldCount: response.result.sentenceFieldCount,
    };
  }

  private getStateTagsFromCommitSnapshot(reviewState: string): JitenCardState[] {
    switch (reviewState) {
      case 'new':
        return [JitenCardState.NEW];
      case 'learning':
        return [JitenCardState.YOUNG];
      case 'review':
        return [JitenCardState.YOUNG];
      case 'suspended':
        return [JitenCardState.SUSPENDED];
      case 'buried':
        return [JitenCardState.BURIED];
      default:
        return [];
    }
  }

  private createWriteTargetError(reason: AnkiWriteTargetIssueCode): TargetedReviewWriteError {
    switch (reason) {
      case 'ambiguous-card-template-ord':
        return new TargetedReviewWriteError(
          'WRITE_TARGET_AMBIGUOUS',
          'Cannot review in Anki: multiple write targets match this term.',
        );
      case 'missing-card-template-ord':
      case 'missing-deck':
      case 'missing-model':
      case 'missing-word-field':
      case 'missing-template-targets':
      default:
        return new TargetedReviewWriteError(
          'WRITE_TARGET_INVALID',
          'Cannot review in Anki: no valid write target is configured.',
        );
    }
  }
}
