import { getConfiguration } from '@shared/configuration/get-configuration';
import { displayToast } from '@shared/dom/display-toast';
import { JitenCard, JitenRating } from '@shared/jiten/types';
import { GradeCardCommand } from '@shared/messages/background/grade-card.command';
import { GradeCardCommandResult } from '@shared/messages/background/grade-card.command.types';
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

    const { wordId, readingIndex } = card;
    const targetCardId = card.reviewMetadata.target?.ankiCardId;

    void new GradeCardCommand(wordId, readingIndex, rating, targetCardId)
      .call()
      .then((result) => this.handleGradeResult(card, result))
      .catch((error: Error) => {
        displayToast('error', 'Failed to submit review action.', error.message);
      });
  }

  protected async applyConfiguration(): Promise<void> {
    this._useTwoPointGrading = await getConfiguration('jitenUseTwoGrades');
    this._disableReviews = await getConfiguration('jitenDisableReviews');
    this._showActions = await getConfiguration('showGradingActions');
  }

  private handleGradeResult(card: JitenCard, result: GradeCardCommandResult): void {
    if (!result.success) {
      displayToast('error', result.error.message, result.error.code);

      return;
    }

    if (result.backend === 'anki') {
      const { wordId, readingIndex } = card;

      Registry.updateCard(wordId, readingIndex, {
        ...card.reviewMetadata,
        dueState: 'unknown',
        freshness: 'stale',
      });

      return;
    }

    this.updateCardState(card);
  }
}
