import { MessageSender } from '@shared/extension/types';
import { JitenRating } from '@shared/jiten/types';
import { GradeCardCommand } from '@shared/messages/background/grade-card.command';
import { BackgroundCommandHandler } from '../lib/background-command-handler';
import { ReviewBackendSelector } from '../review-backend/review-backend-selector';

export class GradeCardCommandHandler extends BackgroundCommandHandler<GradeCardCommand> {
  public readonly command = GradeCardCommand;

  public constructor(private readonly _reviewBackendSelector: ReviewBackendSelector) {
    super();
  }

  public async handle(
    _sender: MessageSender,
    wordId: number,
    readingIndex: number,
    rating: JitenRating,
  ): Promise<void> {
    const reviewBackend = await this._reviewBackendSelector.getActiveBackend();

    await reviewBackend.gradeCard(wordId, readingIndex, rating);
  }
}
