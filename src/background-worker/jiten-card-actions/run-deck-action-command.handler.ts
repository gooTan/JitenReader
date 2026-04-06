import { MessageSender } from '@shared/extension/types';
import { RunDeckActionCommand } from '@shared/messages/background/run-deck-action.command';
import { BackgroundCommandHandler } from '../lib/background-command-handler';
import {
  ReviewBackend,
  ReviewDeck,
  ReviewDeckAction,
} from '../review-backend/review-backend.types';

export class RunDeckActionCommandHandler extends BackgroundCommandHandler<RunDeckActionCommand> {
  public readonly command = RunDeckActionCommand;

  public constructor(private readonly _reviewBackend: ReviewBackend) {
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
    await this._reviewBackend.runDeckAction(wordId, readingIndex, deck, action, sentence);
  }
}
