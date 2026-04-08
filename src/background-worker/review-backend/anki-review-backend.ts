import { getReadonlyDiscoverWordConfigurationSummary } from '@shared/anki/readonly-config';
import { targetedReviewWrite } from '@shared/anki/targeted-review-write';
import { getConfiguration } from '@shared/configuration/get-configuration';
import { JitenCardState, JitenRawVocabulary, JitenRating } from '@shared/jiten/types';
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
  ReviewTermResolution,
  ReviewTermResolutionMap,
} from './review-backend.types';

export class AnkiReviewBackend implements ReviewBackend {
  private _lastParseMetrics?: AnkiParseLookupMetrics;
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

    this._repository.invalidateCard(targetCardId);
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
}
