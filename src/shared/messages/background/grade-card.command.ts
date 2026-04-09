import {
  JitenRating,
  JitenReviewBackend,
  ReviewMetadata,
  ReviewTermSnapshot,
} from '../../jiten/types';
import { BackgroundCommand } from '../lib/background-command';
import { GradeCardCommandResult } from './grade-card.command.types';

export class GradeCardCommand extends BackgroundCommand<
  [
    wordId: number,
    readingIndex: number,
    rating: JitenRating,
    targetCardId?: number,
    reviewMetadata?: ReviewMetadata,
    termSnapshot?: ReviewTermSnapshot,
    requestedBackend?: JitenReviewBackend,
  ],
  GradeCardCommandResult
> {
  public readonly key = 'gradeCard';
}
