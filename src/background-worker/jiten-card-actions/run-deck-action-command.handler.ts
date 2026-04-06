import { MessageSender } from '@shared/extension/types';
import { RunDeckActionCommand } from '@shared/messages/background/run-deck-action.command';
import { BackgroundCommandHandler } from '../lib/background-command-handler';
import { ReviewBackendSelector } from '../review-backend/review-backend-selector';
import { UnsupportedReviewOperationError } from '../review-backend/review-backend.errors';
import { ReviewDeck, ReviewDeckAction } from '../review-backend/review-backend.types';

export class RunDeckActionCommandHandler extends BackgroundCommandHandler<RunDeckActionCommand> {
  public readonly command = RunDeckActionCommand;

  public constructor(private readonly _reviewBackendSelector: ReviewBackendSelector) {
    super();
  }

  public async handle(
    _sender: MessageSender,
    wordId: number,
    readingIndex: number,
    deck: ReviewDeck,
    action: ReviewDeckAction,
    sentence?: string,
  ): Promise<void> {
    const reviewBackend = await this._reviewBackendSelector.getActiveBackend();
    const jitenBackend = this._reviewBackendSelector.getBackend('jiten');

    try {
      await reviewBackend.runDeckAction(wordId, readingIndex, deck, action, sentence);
    } catch (error) {
      if (!(error instanceof UnsupportedReviewOperationError) || !jitenBackend) {
        throw error;
      }

      await jitenBackend.runDeckAction(wordId, readingIndex, deck, action, sentence);
    }
  }
}
