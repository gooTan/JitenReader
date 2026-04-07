import { getConfiguration } from '@shared/configuration/get-configuration';
import { displayToast } from '@shared/dom/display-toast';
import { JitenCard, JitenRating, ReviewMetadata } from '@shared/jiten/types';
import { GradeCardCommand } from '@shared/messages/background/grade-card.command';
import { GradeCardCommandResult } from '@shared/messages/background/grade-card.command.types';
import { UpdateCardStateCommand } from '@shared/messages/background/update-card-state.command';
import { Registry } from '../../integration/registry';
import { BaseController } from './base-controller';

export class GradingController extends BaseController {
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

    void new GradeCardCommand(wordId, readingIndex, rating, targetCardId)
      .call()
      .then((result) => this.handleGradeResult(card, result, targetCardId))
      .catch((error: Error) => {
        displayToast('error', 'Failed to submit review action.', error.message);
      });
  }

  protected async applyConfiguration(): Promise<void> {
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
        'success',
        `Anki is unavailable right now. Review was submitted to ${result.backend} instead.`,
      );
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
    const { backend, targetState } = card.reviewMetadata;

    if (backend !== 'anki') {
      return true;
    }

    if (targetState === 'selected' && card.reviewMetadata.target?.ankiCardId) {
      return true;
    }

    if (targetState === 'ambiguous') {
      displayToast('error', 'Cannot review: multiple Anki targets found for this term.');

      return false;
    }

    displayToast('error', 'Cannot review: no selected Anki target for this term.');

    return false;
  }
}
