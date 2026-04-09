import { GetAnkiCreatePathCapability } from '@shared/anki/create-path-capability';
import { getConfiguration } from '@shared/configuration/get-configuration';
import { debug } from '@shared/debug';
import { displayToast } from '@shared/dom/display-toast';
import { GetBlockedReviewabilityError, ResolveReviewability } from '@shared/jiten/reviewability';
import { JitenCard, JitenRating, ReviewMetadata } from '@shared/jiten/types';
import { GradeCardCommand } from '@shared/messages/background/grade-card.command';
import { GradeCardCommandResult } from '@shared/messages/background/grade-card.command.types';
import { UpdateCardStateCommand } from '@shared/messages/background/update-card-state.command';
import { Registry } from '../../integration/registry';
import { BaseController } from './base-controller';

export class GradingController extends BaseController {
  private _ankiCreatePathAvailable: boolean;
  private _disableReviews: boolean;
  private _showActions: boolean;
  private _useTwoPointGrading: boolean;

  public get gradingEnabled(): boolean {
    return !this._disableReviews;
  }

  public get showActions(): boolean {
    return this._showActions && this.gradingEnabled;
  }

  public getGradingActions(): JitenRating[] {
    return this._useTwoPointGrading ? ['again', 'good'] : ['again', 'hard', 'good', 'easy'];
  }

  public gradeCard(card: JitenCard, rating: JitenRating): void {
    if (!this.gradingEnabled || !this.getGradingActions().includes(rating)) {
      return;
    }

    if (!this.canSubmitGrade(card)) {
      return;
    }

    const { wordId, readingIndex } = card;
    const targetCardId = card.reviewMetadata.target?.ankiCardId;
    const termSnapshot = {
      spelling: card.spelling,
      reading: card.reading,
    };
    const requestedBackend = card.reviewMetadata.backend;

    void new GradeCardCommand(
      wordId,
      readingIndex,
      rating,
      targetCardId,
      card.reviewMetadata,
      termSnapshot,
      requestedBackend,
    )
      .call()
      .then((result) => this.handleGradeResult(card, result, targetCardId))
      .catch((error: Error) => {
        displayToast('error', 'Failed to submit review action.', error.message);
      });
  }

  protected async applyConfiguration(): Promise<void> {
    this._ankiCreatePathAvailable = GetAnkiCreatePathCapability(
      await getConfiguration('ankiMiningConfig'),
    ).available;
    this._useTwoPointGrading = await getConfiguration('jitenUseTwoGrades');
    this._disableReviews = await getConfiguration('jitenDisableReviews');
    this._showActions = await getConfiguration('showGradingActions');
  }

  private async handleGradeResult(
    card: JitenCard,
    result: GradeCardCommandResult,
    targetCardId?: number,
  ): Promise<void> {
    if (!result.success) {
      displayToast('error', result.error.message, result.error.code);

      return;
    }

    if (card.reviewMetadata.backend !== result.backend) {
      displayToast(
        'error',
        `Review could not stay on ${card.reviewMetadata.backend}. Backend returned ${result.backend}.`,
      );

      return;
    }

    if (result.backend === 'anki') {
      const staleMetadata = this.createStaleMetadata(card.reviewMetadata);
      const { wordId, readingIndex } = card;

      Registry.updateCard(wordId, readingIndex, staleMetadata);
      displayToast('success', 'Review submitted to Anki. Refreshing state...');

      try {
        await new UpdateCardStateCommand(wordId, readingIndex, targetCardId, staleMetadata).call();
      } catch (error) {
        displayToast('error', 'Could not refresh updated Anki state.', (error as Error).message);
      }

      return;
    }

    this.updateCardState(card);
  }

  private createStaleMetadata(reviewMetadata: ReviewMetadata): ReviewMetadata {
    return {
      ...reviewMetadata,
      freshness: 'stale',
      dueState: 'unknown',
    };
  }

  private canSubmitGrade(card: JitenCard): boolean {
    const reviewability = ResolveReviewability({
      createPathAvailable: this._ankiCreatePathAvailable,
      reviewMetadata: card.reviewMetadata,
    });

    debug('ReviewDebug GradingController.canSubmitGrade', {
      allowed: reviewability.allowed,
      dueState: card.reviewMetadata.dueState,
      freshness: card.reviewMetadata.freshness,
      mappingOutcome: card.reviewMetadata.mappingOutcome,
      reasonCode: reviewability.reasonCode,
      resolutionStatus: card.reviewMetadata.resolutionStatus,
      stateTags: card.reviewMetadata.stateTags,
      targetCardId: card.reviewMetadata.target?.ankiCardId,
      wordId: card.wordId,
      readingIndex: card.readingIndex,
    });

    if (reviewability.allowed) {
      return true;
    }

    const blockedError = GetBlockedReviewabilityError(reviewability);

    if (blockedError) {
      displayToast('error', blockedError.message, blockedError.code);
    }

    return false;
  }
}
