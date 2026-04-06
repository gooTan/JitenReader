import { JitenCardState } from './types';

const CARD_STATE_MAP: Record<number, JitenCardState> = {
  0: JitenCardState.NEW,
  1: JitenCardState.YOUNG,
  2: JitenCardState.MATURE,
  3: JitenCardState.BLACKLISTED,
  4: JitenCardState.DUE,
  5: JitenCardState.MASTERED,
};

export const mapReviewStates = (
  rawStates: number[],
  fallbackState: JitenCardState,
): JitenCardState[] => {
  const states = rawStates
    .map((state) => CARD_STATE_MAP[state])
    .filter((state): state is JitenCardState => state !== undefined);

  return states.length > 0 ? states : [fallbackState];
};
