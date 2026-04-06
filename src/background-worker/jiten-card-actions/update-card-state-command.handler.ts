import { MessageSender } from '@shared/extension/types';
import { createReviewMetadata } from '@shared/jiten/create-review-metadata';
import { JitenCardState } from '@shared/jiten/types';
import { UpdateCardStateCommand } from '@shared/messages/background/update-card-state.command';
import { CardStateUpdatedCommand } from '@shared/messages/broadcast/card-state-updated.command';
import { BackgroundCommandHandler } from '../lib/background-command-handler';
import { ReviewBackendSelector } from '../review-backend/review-backend-selector';

export class UpdateCardStateCommandHandler extends BackgroundCommandHandler<UpdateCardStateCommand> {
  public readonly command = UpdateCardStateCommand;

  public constructor(private readonly _reviewBackendSelector: ReviewBackendSelector) {
    super();
  }

  public async handle(_sender: MessageSender, wordId: number, readingIndex: number): Promise<void> {
    let backendStatus = await this._reviewBackendSelector.getStatus();
    let reviewBackend = await this._reviewBackendSelector.getActiveBackend();
    let newCardState: JitenCardState[];

    try {
      newCardState = await reviewBackend.getCardState(wordId, readingIndex);
    } catch {
      const jitenBackend = this._reviewBackendSelector.getBackend('jiten');

      if (!jitenBackend) {
        throw new Error('Jiten backend is not configured.');
      }

      reviewBackend = jitenBackend;
      newCardState = await reviewBackend.getCardState(wordId, readingIndex);
      backendStatus = {
        ...backendStatus,
        activeBackend: 'jiten',
        availability: {
          ...backendStatus.availability,
          anki: 'unavailable',
        },
      };
    }

    const reviewMetadata = createReviewMetadata({
      backend: backendStatus.activeBackend,
      wordId,
      readingIndex,
      stateTags: newCardState,
      freshness: 'fresh',
      actionsAvailable: reviewBackend.getCapabilities().supportsDeckActions,
    });

    new CardStateUpdatedCommand(wordId, readingIndex, reviewMetadata).send();
  }
}
