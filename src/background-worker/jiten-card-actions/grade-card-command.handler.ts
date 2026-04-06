import { MessageSender } from '@shared/extension/types';
import { JitenRating } from '@shared/jiten/types';
import { GradeCardCommand } from '@shared/messages/background/grade-card.command';
import { BackgroundCommandHandler } from '../lib/background-command-handler';
import { ReviewBackend } from '../review-backend/review-backend.types';

export class GradeCardCommandHandler extends BackgroundCommandHandler<GradeCardCommand> {
  public readonly command = GradeCardCommand;

  public constructor(private readonly _reviewBackend: ReviewBackend) {
    super();
  }

  public async handle(
    _sender: MessageSender,
    wordId: number,
    readingIndex: number,
    rating: JitenRating,
  ): Promise<void> {
    await this._reviewBackend.gradeCard(wordId, readingIndex, rating);
  }
}
