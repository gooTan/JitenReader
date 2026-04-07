import { MessageSender } from '@shared/extension/types';
import { JitenRating } from '@shared/jiten/types';
import { GradeCardCommand } from '@shared/messages/background/grade-card.command';
import { GradeCardCommandResult } from '@shared/messages/background/grade-card.command.types';
import { BackgroundCommandHandler } from '../lib/background-command-handler';
import { ReviewBackendSelector } from '../review-backend/review-backend-selector';
import { TargetedReviewWriteError } from '../review-backend/review-backend.errors';

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
    targetCardId?: number,
  ): Promise<GradeCardCommandResult> {
    const { status: backendStatus, backend: reviewBackend } =
      await this._reviewBackendSelector.getSelectionSnapshot();

    try {
      await reviewBackend.gradeCard(wordId, readingIndex, rating, {
        requestId: `${wordId}/${readingIndex}:${Date.now()}`,
        targetCardId,
      });

      return {
        success: true,
        backend: backendStatus.activeBackend,
      };
    } catch (error) {
      if (backendStatus.activeBackend === 'anki' && error instanceof TargetedReviewWriteError) {
        return {
          success: false,
          backend: 'anki',
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
        };
      }

      throw error;
    }
  }
}
