import { ReviewMetadata } from '../../jiten/types';
import { BroadcastCommand } from '../lib/broadcast-command';

export class CardStateUpdatedCommand extends BroadcastCommand<
  [wordId: number, readingIndex: number, reviewMetadata: ReviewMetadata]
> {
  public readonly key = 'cardStateUpdated';
}
