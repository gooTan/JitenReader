import { MessageSender } from '@shared/extension/types';
import { ForgetCardCommand } from '@shared/messages/background/forget-card.command';
import { BackgroundCommandHandler } from '../lib/background-command-handler';
import { ReviewBackend } from '../review-backend/review-backend.types';

export class ForgetCardCommandHandler extends BackgroundCommandHandler<ForgetCardCommand> {
  public readonly command = ForgetCardCommand;

  public constructor(private readonly _reviewBackend: ReviewBackend) {
    super();
  }

  public async handle(_sender: MessageSender, wordId: number, readingIndex: number): Promise<void> {
    await this._reviewBackend.forgetCard(wordId, readingIndex);
  }
}
