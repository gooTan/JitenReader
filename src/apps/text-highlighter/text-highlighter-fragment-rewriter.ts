import { JitenToken } from '@shared/jiten/types';
import { Fragment } from '../batches/types';
import {
  HighlighterDomOps,
  HighlighterFragmentOps,
  HighlighterMapOps,
  TextHighlighterState,
} from './text-highlighter.internal-types';

export function splitMultiTokenFragments(
  state: TextHighlighterState,
  mapOps: HighlighterMapOps,
  fragmentOps: HighlighterFragmentOps,
  domOps: Pick<HighlighterDomOps, 'dismissElements' | 'patchOrWrap'>,
): void {
  mapOps
    .filterMap(state.fragmentToTokensMap, (tokens) => tokens.length > 1)
    .forEach((tokens, fragment) => {
      let token: JitenToken | undefined;

      while ((token = tokens.pop())) {
        cutoffTokenEnd(fragment, token, fragmentOps, domOps);

        if (token.start < fragment.start) {
          state.fragmentToTokensMap.get(fragment)?.push(token);
          state.tokenToFragmentsMap.get(token)?.push(fragment);

          break;
        }

        const newFragmentNode = fragmentOps.splitFragmentsNode(fragment, token.start);
        const newFragment = fragmentOps.insertNewFragment(
          newFragmentNode,
          token.start,
          fragment.rubyElement,
        );

        state.fragmentToTokensMap.set(newFragment, [token]);
        state.tokenToFragmentsMap.set(token, [newFragment]);

        fragmentOps.fixFragmentParameters(fragment);
      }

      if (fragment.length && !state.fragmentToTokensMap.get(fragment)?.length) {
        domOps.patchOrWrap(fragment);
      }

      domOps.dismissElements(fragment);
    });
}

export function adjustUnmatchedFragments(
  state: TextHighlighterState,
  mapOps: HighlighterMapOps,
  fragmentOps: HighlighterFragmentOps,
): void {
  mapOps
    .filterMap(
      state.tokenToFragmentsMap,
      (fragments, token) => !mapOps.areBoundariesExactMatch(token, fragments),
    )
    .forEach((fragments, token) => {
      adjustFragmentEnds(fragments, token, mapOps, fragmentOps);
      adjustFragmentStarts(fragments, token, mapOps, fragmentOps);
    });
}

export function cutoffTokenEnd(
  fragment: Fragment,
  token: JitenToken,
  fragmentOps: HighlighterFragmentOps,
  domOps: Pick<HighlighterDomOps, 'patchOrWrap'>,
): void {
  if (token.end < fragment.end) {
    if (!fragmentOps.canSplitFragmentAt(fragment, token.end)) {
      fragmentOps.fixFragmentParameters(fragment);

      return;
    }

    domOps.patchOrWrap(fragmentOps.splitFragmentsNode(fragment, token.end));
    fragmentOps.fixFragmentParameters(fragment);
  }
}

function adjustFragmentEnds(
  fragments: Fragment[],
  token: JitenToken,
  mapOps: Pick<HighlighterMapOps, 'isFragmentWithinToken'>,
  fragmentOps: HighlighterFragmentOps,
): void {
  fragments
    .filter((fragment) => mapOps.isFragmentWithinToken(fragment, token))
    .forEach((fragment) => {
      if (fragment.end > token.end) {
        if (!fragmentOps.canSplitFragmentAt(fragment, token.end)) {
          fragmentOps.fixFragmentParameters(fragment);

          return;
        }

        const overlap = fragmentOps.splitFragmentsNode(fragment, token.end);

        fragmentOps.fixFragmentParameters(fragment);
        fragmentOps.insertNewFragment(overlap, token.end, fragment.rubyElement);
      }
    });
}

function adjustFragmentStarts(
  fragments: Fragment[],
  token: JitenToken,
  mapOps: Pick<HighlighterMapOps, 'isFragmentWithinToken'>,
  fragmentOps: HighlighterFragmentOps,
): void {
  fragments
    .filter((fragment) => mapOps.isFragmentWithinToken(fragment, token))
    .forEach((fragment) => {
      if (fragment.start < token.start) {
        if (!fragmentOps.canSplitFragmentAt(fragment, token.start)) {
          fragmentOps.fixFragmentParameters(fragment);

          return;
        }

        const correctedFragmentTextNode = fragmentOps.splitFragmentsNode(fragment, token.start);

        fragment.node = correctedFragmentTextNode;
        fragment.start = token.start;

        fragmentOps.fixFragmentParameters(fragment);
      }
    });
}
