import { MessageSender } from '@shared/extension/types';
import { createReviewMetadata } from '@shared/jiten/create-review-metadata';
import { JitenCardState, ReviewFreshnessState, ReviewMetadata } from '@shared/jiten/types';
import { UpdateCardStateCommand } from '@shared/messages/background/update-card-state.command';
import { CardStateUpdatedCommand } from '@shared/messages/broadcast/card-state-updated.command';
import { BackgroundCommandHandler } from '../lib/background-command-handler';
import { ReviewBackendSelector } from '../review-backend/review-backend-selector';

export class UpdateCardStateCommandHandler extends BackgroundCommandHandler<UpdateCardStateCommand> {
  public readonly command = UpdateCardStateCommand;

  public constructor(private readonly _reviewBackendSelector: ReviewBackendSelector) {
    super();
  }

  public async handle(
    _sender: MessageSender,
    wordId: number,
    readingIndex: number,
    targetCardId?: number,
    previousMetadata?: ReviewMetadata,
  ): Promise<void> {
    const selection = await this._reviewBackendSelector.getSelectionSnapshot();
    const backendStatus = selection.status;
    const reviewBackend = selection.backend;
    let newCardState: JitenCardState[] = [];
    let metadataOverrides: Partial<ReviewMetadata> | undefined;

    try {
      newCardState = await reviewBackend.getCardState(wordId, readingIndex, {
        targetCardId,
        previousMetadata,
      });
    } catch {
      metadataOverrides =
        backendStatus.activeBackend === 'anki'
          ? this.getUnavailableAnkiMetadataOverrides(
              wordId,
              readingIndex,
              previousMetadata,
              targetCardId,
            )
          : undefined;
    }

    if (!metadataOverrides && backendStatus.activeBackend === 'anki') {
      metadataOverrides = this.getAnkiMetadataOverrides(
        wordId,
        readingIndex,
        newCardState,
        previousMetadata,
        targetCardId,
      );
    }

    const freshness = this.getRefreshFreshness(
      backendStatus.activeBackend,
      newCardState,
      previousMetadata,
      targetCardId,
    );
    const reviewMetadata = createReviewMetadata({
      backend: backendStatus.activeBackend,
      wordId,
      readingIndex,
      stateTags: newCardState,
      freshness,
      actionsAvailable: reviewBackend.getCapabilities().supportsDeckActions,
      resolutionStatus: metadataOverrides?.resolutionStatus,
      mappingOutcome: metadataOverrides?.mappingOutcome,
      dueState: metadataOverrides?.dueState,
      target: metadataOverrides?.target,
      diagnostics: metadataOverrides?.diagnostics,
    });

    new CardStateUpdatedCommand(wordId, readingIndex, reviewMetadata).send();
  }

  private getAnkiMetadataOverrides(
    wordId: number,
    readingIndex: number,
    newCardState: JitenCardState[],
    previousMetadata?: ReviewMetadata,
    targetCardId?: number,
  ): Partial<ReviewMetadata> {
    const fallbackTarget =
      targetCardId && targetCardId > 0
        ? {
            key: `anki:${targetCardId}`,
            wordId,
            readingIndex,
            ankiCardId: targetCardId,
          }
        : undefined;
    const target = previousMetadata?.target ?? fallbackTarget;
    const resolutionStatus = previousMetadata?.resolutionStatus ?? 'resolved';
    const mappingOutcome =
      resolutionStatus === 'resolved'
        ? (previousMetadata?.mappingOutcome ?? (target ? 'selected' : 'none'))
        : undefined;
    const dueState = newCardState.includes(JitenCardState.DUE)
      ? 'due'
      : newCardState.length > 0
        ? 'notDue'
        : previousMetadata?.dueState === 'unavailable'
          ? 'unavailable'
          : 'unknown';

    return {
      resolutionStatus,
      mappingOutcome,
      dueState,
      target,
      diagnostics: previousMetadata?.diagnostics,
    };
  }

  private getUnavailableAnkiMetadataOverrides(
    wordId: number,
    readingIndex: number,
    previousMetadata?: ReviewMetadata,
    targetCardId?: number,
  ): Partial<ReviewMetadata> {
    const fallbackTarget =
      targetCardId && targetCardId > 0
        ? {
            key: `anki:${targetCardId}`,
            wordId,
            readingIndex,
            ankiCardId: targetCardId,
          }
        : undefined;

    return {
      resolutionStatus: 'backend-unavailable',
      dueState: 'unavailable',
      target: previousMetadata?.target ?? fallbackTarget,
      diagnostics: previousMetadata?.diagnostics,
    };
  }

  private getRefreshFreshness(
    backend: ReviewMetadata['backend'],
    newCardState: JitenCardState[],
    previousMetadata?: ReviewMetadata,
    targetCardId?: number,
  ): ReviewFreshnessState {
    if (backend !== 'anki') {
      return 'fresh';
    }

    if (newCardState.length > 0) {
      return 'fresh';
    }

    const resolvedTargetCardId = targetCardId ?? previousMetadata?.target?.ankiCardId;

    if (resolvedTargetCardId && resolvedTargetCardId > 0) {
      return 'stale';
    }

    return previousMetadata?.freshness ?? 'unknown';
  }
}
