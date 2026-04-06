import { MessageSender } from '@shared/extension/types';
import { createReviewMetadata } from '@shared/jiten/create-review-metadata';
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
    const backendStatus = await this._reviewBackendSelector.getStatus();
    const reviewBackend = await this._reviewBackendSelector.getActiveBackend();
    const newCardState = await reviewBackend.getCardState(wordId, readingIndex);
    const reviewMetadata = createReviewMetadata({
      backend: backendStatus.activeBackend,
      wordId,
      readingIndex,
      stateTags: newCardState,
      freshness: 'fresh',
      actionsAvailable: true,
    });

    new CardStateUpdatedCommand(wordId, readingIndex, reviewMetadata).send();
  }
}
