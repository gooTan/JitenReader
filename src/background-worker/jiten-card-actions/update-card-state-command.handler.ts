import { MessageSender } from '@shared/extension/types';
import { UpdateCardStateCommand } from '@shared/messages/background/update-card-state.command';
import { CardStateUpdatedCommand } from '@shared/messages/broadcast/card-state-updated.command';
import { BackgroundCommandHandler } from '../lib/background-command-handler';
import { ReviewBackend } from '../review-backend/review-backend.types';

export class UpdateCardStateCommandHandler extends BackgroundCommandHandler<UpdateCardStateCommand> {
  public readonly command = UpdateCardStateCommand;

  public constructor(private readonly _reviewBackend: ReviewBackend) {
    super();
  }

  public async handle(_sender: MessageSender, wordId: number, readingIndex: number): Promise<void> {
    const newCardState = await this._reviewBackend.getCardState(wordId, readingIndex);

    new CardStateUpdatedCommand(wordId, readingIndex, newCardState).send();
  }
}
