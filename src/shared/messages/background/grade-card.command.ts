import { JitenRating } from '../../jiten/types';
import { BackgroundCommand } from '../lib/background-command';
import { GradeCardCommandResult } from './grade-card.command.types';

export class GradeCardCommand extends BackgroundCommand<
  [wordId: number, readingIndex: number, rating: JitenRating, targetCardId?: number],
  GradeCardCommandResult
> {
  public readonly key = 'gradeCard';
}
