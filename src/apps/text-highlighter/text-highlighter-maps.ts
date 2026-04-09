import { JitenToken } from '@shared/jiten/types';
import { Fragment } from '../batches/types';
import { TextHighlighterState } from './text-highlighter.internal-types';

export function rebuildTokenFragmentMaps(state: TextHighlighterState): void {
  state.fragments = new Set([...state.fragments].sort((a, b) => a.start - b.start));
  state.tokens = new Set([...state.tokens].sort((a, b) => a.start - b.start));

  state.fragmentToTokensMap.clear();
  state.tokenToFragmentsMap.clear();

  buildTokenFragmentMaps(state);
}

export function buildTokenFragmentMaps(state: TextHighlighterState): void {
  const sortedTokens = [...state.tokens].sort((a, b) => a.start - b.start);
  const sortedFragments = [...state.fragments].sort((a, b) => a.start - b.start);

  for (const fragment of sortedFragments) {
    state.fragmentToTokensMap.set(fragment, []);
  }

  let fragmentIndex = 0;

  for (const token of sortedTokens) {
    const matchingFragments: Fragment[] = [];

    while (
      fragmentIndex < sortedFragments.length &&
      sortedFragments[fragmentIndex].end <= token.start
    ) {
      fragmentIndex++;
    }

    let scanIndex = fragmentIndex;

    while (scanIndex < sortedFragments.length && sortedFragments[scanIndex].start < token.end) {
      const fragment = sortedFragments[scanIndex];

      if (isFragmentWithinToken(fragment, token)) {
        matchingFragments.push(fragment);
        state.fragmentToTokensMap.get(fragment)!.push(token);
      }

      scanIndex++;
    }

    state.tokenToFragmentsMap.set(token, matchingFragments);
  }
}

export function isFragmentWithinToken(fragment: Fragment, token: JitenToken): boolean {
  return fragment.end > token.start && fragment.start < token.end;
}

export function areBoundariesExactMatch(
  reference: { end: number; start: number },
  targets: { end: number; start: number }[],
): boolean {
  if (!targets.length) {
    return false;
  }

  return reference.start === targets[0].start && reference.end === targets[targets.length - 1].end;
}

export function filterRelationMap<TKey, TValue>(
  map: Map<TKey, TValue[]>,
  filter: (values: TValue[], key: TKey) => boolean,
): Map<TKey, TValue[]> {
  const result = new Map<TKey, TValue[]>();

  map.forEach((values, key) => {
    if (filter(values, key)) {
      result.set(key, values);
    }
  });

  return result;
}
