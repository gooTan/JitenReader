import { ReviewMetadata } from '@shared/jiten/types';
import { BackgroundCommand } from '../lib/background-command';

export class UpdateCardStateCommand extends BackgroundCommand<
  [wordId: number, readingIndex: number, targetCardId?: number, previousMetadata?: ReviewMetadata]
> {
  public readonly key = 'updateCardState';
}
