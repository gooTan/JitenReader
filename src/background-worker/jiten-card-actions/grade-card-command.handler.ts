import { MessageSender } from '@shared/extension/types';
import { JitenRating } from '@shared/jiten/types';
import { GradeCardCommand } from '@shared/messages/background/grade-card.command';
import { BackgroundCommandHandler } from '../lib/background-command-handler';
import { ReviewBackendSelector } from '../review-backend/review-backend-selector';
import { UnsupportedReviewOperationError } from '../review-backend/review-backend.errors';

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
    const jitenBackend = this._reviewBackendSelector.getBackend('jiten');

    try {
      await reviewBackend.gradeCard(wordId, readingIndex, rating);
    } catch (error) {
      if (!(error instanceof UnsupportedReviewOperationError) || !jitenBackend) {
        throw error;
      }

      await jitenBackend.gradeCard(wordId, readingIndex, rating);
    }
  }
}
