import { MessageSender } from '@shared/extension/types';
import { ForgetCardCommand } from '@shared/messages/background/forget-card.command';
import { BackgroundCommandHandler } from '../lib/background-command-handler';
import { ReviewBackendSelector } from '../review-backend/review-backend-selector';
import { UnsupportedReviewOperationError } from '../review-backend/review-backend.errors';

export class ForgetCardCommandHandler extends BackgroundCommandHandler<ForgetCardCommand> {
  public readonly command = ForgetCardCommand;

  public constructor(private readonly _reviewBackendSelector: ReviewBackendSelector) {
    super();
  }

  public async handle(_sender: MessageSender, wordId: number, readingIndex: number): Promise<void> {
    const reviewBackend = await this._reviewBackendSelector.getActiveBackend();
    const jitenBackend = this._reviewBackendSelector.getBackend('jiten');

    try {
      await reviewBackend.forgetCard(wordId, readingIndex);
    } catch (error) {
      if (!(error instanceof UnsupportedReviewOperationError) || !jitenBackend) {
        throw error;
      }

      await jitenBackend.forgetCard(wordId, readingIndex);
    }
  }
}
