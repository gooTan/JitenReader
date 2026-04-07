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
    let backendStatus = selection.status;
    let reviewBackend = selection.backend;
    let newCardState: JitenCardState[];

    try {
      newCardState = await reviewBackend.getCardState(wordId, readingIndex, {
        targetCardId,
        previousMetadata,
      });
    } catch {
      const jitenBackend = this._reviewBackendSelector.getBackend('jiten');

      if (!jitenBackend) {
        throw new Error('Jiten backend is not configured.');
      }

      reviewBackend = jitenBackend;
      newCardState = await reviewBackend.getCardState(wordId, readingIndex, {
        targetCardId,
        previousMetadata,
      });
      backendStatus = {
        ...backendStatus,
        activeBackend: 'jiten',
        availability: {
          ...backendStatus.availability,
          anki: 'unavailable',
        },
      };
    }

    const metadataOverrides =
      backendStatus.activeBackend === 'anki'
        ? this.getAnkiMetadataOverrides(
            wordId,
            readingIndex,
            newCardState,
            previousMetadata,
            targetCardId,
          )
        : undefined;
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
      mappingState: metadataOverrides?.mappingState,
      dueState: metadataOverrides?.dueState,
      targetState: metadataOverrides?.targetState,
      target: metadataOverrides?.target,
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
    const mappingState =
      previousMetadata?.mappingState ??
      (target ? 'mapped' : newCardState.length > 0 ? 'mapped' : 'unmapped');
    const targetState = previousMetadata?.targetState ?? (target ? 'selected' : 'none');
    const dueState = newCardState.includes(JitenCardState.DUE)
      ? 'due'
      : newCardState.length > 0
        ? 'notDue'
        : previousMetadata?.dueState === 'unavailable'
          ? 'unavailable'
          : 'unknown';

    return {
      mappingState,
      dueState,
      targetState,
      target,
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
