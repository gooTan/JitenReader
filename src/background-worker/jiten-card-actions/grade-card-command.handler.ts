import { MessageSender } from '@shared/extension/types';
import { GetBlockedReviewabilityError } from '@shared/jiten/reviewability';
import {
  JitenRating,
  JitenReviewBackend,
  ReviewMetadata,
  ReviewTermSnapshot,
} from '@shared/jiten/types';
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
    reviewMetadata?: ReviewMetadata,
    termSnapshot?: ReviewTermSnapshot,
    requestedBackend?: JitenReviewBackend,
  ): Promise<GradeCardCommandResult> {
    const resolvedRequestedBackend = this.getRequestedBackend(requestedBackend, reviewMetadata);
    const { status: backendStatus, backend: reviewBackend } =
      await this._reviewBackendSelector.getSelectionSnapshot({
        requestedBackend: resolvedRequestedBackend,
      });
    const reviewability = await reviewBackend.getGradeReviewability(wordId, readingIndex, {
      requestedBackend: resolvedRequestedBackend,
      targetCardId,
      reviewMetadata,
      termSnapshot,
    });
    const blockedError = GetBlockedReviewabilityError(reviewability);

    if (blockedError) {
      return {
        success: false,
        backend: backendStatus.activeBackend,
        error: {
          code: blockedError.code,
          message: blockedError.message,
        },
      };
    }

    try {
      const result = await reviewBackend.gradeCard(wordId, readingIndex, rating, {
        requestId: `${wordId}/${readingIndex}:${Date.now()}`,
        requestedBackend: resolvedRequestedBackend,
        targetCardId,
        reviewMetadata,
        termSnapshot,
      });

      return {
        success: true,
        backend: result.backend ?? backendStatus.activeBackend,
        reviewMetadata: result.reviewMetadata,
        targetCardId: result.targetCardId,
        transaction: result.transaction,
        sentenceFieldCount: result.sentenceFieldCount,
      };
    } catch (error) {
      if (error instanceof TargetedReviewWriteError) {
        return {
          success: false,
          backend: backendStatus.activeBackend,
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

  private getRequestedBackend(
    requestedBackend: JitenReviewBackend | undefined,
    reviewMetadata?: ReviewMetadata,
  ): JitenReviewBackend | undefined {
    if (requestedBackend) {
      return requestedBackend;
    }

    if (reviewMetadata?.backend === 'anki') {
      return 'anki';
    }

    if (reviewMetadata?.backend === 'jiten') {
      return 'jiten';
    }
  }
}
