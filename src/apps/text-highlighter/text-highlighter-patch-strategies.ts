import { JitenToken } from '@shared/jiten/types';
import { Fragment } from '../batches/types';
import {
  HighlighterDomOps,
  HighlighterMapOps,
  HighlighterRubyOps,
  TextHighlighterState,
} from './text-highlighter.internal-types';

export function patchUnparsedFragments(
  state: TextHighlighterState,
  mapOps: Pick<HighlighterMapOps, 'filterMap'>,
  domOps: Pick<HighlighterDomOps, 'patchOrWrap'>,
): void {
  mapOps
    .filterMap(state.fragmentToTokensMap, (tokens) => !tokens.length)
    .forEach((_, fragment) => domOps.patchOrWrap(fragment));
}

export function patchNonRubyTokens(
  state: TextHighlighterState,
  mapOps: Pick<HighlighterMapOps, 'areBoundariesExactMatch' | 'filterMap'>,
  domOps: Pick<HighlighterDomOps, 'patchOrWrap'>,
): void {
  mapOps
    .filterMap(
      state.tokenToFragmentsMap,
      (fragments, token) =>
        !token.rubies.length && mapOps.areBoundariesExactMatch(token, fragments),
    )
    .forEach((fragments, token) =>
      fragments.forEach((fragment) => domOps.patchOrWrap(fragment, token)),
    );
}

export function patchContainedRubyElements(
  state: TextHighlighterState,
  mapOps: Pick<HighlighterMapOps, 'areBoundariesExactMatch' | 'filterMap'>,
  domOps: Pick<HighlighterDomOps, 'dismissElements' | 'markElementAsMisparsed' | 'patchElement'>,
  rubyOps: Pick<
    HighlighterRubyOps,
    | 'applyRubiesToFragment'
    | 'fragmentsShareSingleRuby'
    | 'getSharedRubyElement'
    | 'isMisparsedRuby'
  >,
): void {
  mapOps
    .filterMap(
      state.tokenToFragmentsMap,
      (fragments, token) =>
        !!token.rubies.length &&
        mapOps.areBoundariesExactMatch(token, fragments) &&
        rubyOps.fragmentsShareSingleRuby(fragments),
    )
    .forEach((fragments, token) => {
      const rubyElement = rubyOps.getSharedRubyElement(fragments);

      fragments.forEach((fragment) => domOps.dismissElements(fragment, token));

      if (!rubyElement) {
        return rubyOps.applyRubiesToFragment(fragments[0], token);
      }

      if (rubyOps.isMisparsedRuby(rubyElement, token)) {
        return domOps.markElementAsMisparsed(rubyElement);
      }

      domOps.patchElement(rubyElement, token);
    });
}

export function patchFragmentedRubyTokens(
  state: TextHighlighterState,
  mapOps: Pick<HighlighterMapOps, 'areBoundariesExactMatch' | 'filterMap'>,
  domOps: Pick<
    HighlighterDomOps,
    'dismissElements' | 'findParent' | 'patchElement' | 'patchOrWrap'
  >,
  rubyOps: Pick<HighlighterRubyOps, 'applyOnSharedParent' | 'applyRubiesToFragment'>,
): void {
  mapOps
    .filterMap(state.tokenToFragmentsMap, (fragments, token) =>
      mapOps.areBoundariesExactMatch(token, fragments),
    )
    .forEach((fragments, token) => {
      if (rubyOps.applyOnSharedParent(fragments, token)) {
        return;
      }

      fragments.forEach((fragment) => {
        const fragmentsRuby = domOps.findParent(fragment.node, 'RUBY');

        if (fragmentsRuby) {
          domOps.patchElement(fragmentsRuby, token);
          domOps.dismissElements(fragment, token);

          return;
        }

        const fragmentRubies = token.rubies.filter(
          (ruby) => ruby.start >= fragment.start && ruby.end <= fragment.end,
        );

        if (fragmentRubies.length) {
          return rubyOps.applyRubiesToFragment(fragment, token, fragmentRubies);
        }

        domOps.patchOrWrap(fragment, token);
      });
    });
}

export function patchRemainingMisparses(
  state: TextHighlighterState,
  domOps: Pick<
    HighlighterDomOps,
    'dismissElements' | 'findParent' | 'markElementAsMisparsed' | 'markNodeAsMisparsed'
  >,
  rubyOps: Pick<HighlighterRubyOps, 'isMisparsedRuby'>,
): void {
  state.tokenToFragmentsMap.forEach((fragments, token) => {
    if (checkUnmatchedFragmentMisparse(token, fragments, domOps, rubyOps)) {
      fragments.forEach((fragment) => domOps.dismissElements(fragment, token));
    }
  });
}

function checkUnmatchedFragmentMisparse(
  token: JitenToken,
  fragments: Fragment[],
  domOps: Pick<HighlighterDomOps, 'findParent' | 'markElementAsMisparsed' | 'markNodeAsMisparsed'>,
  rubyOps: Pick<HighlighterRubyOps, 'isMisparsedRuby'>,
): boolean {
  let isMisparse = false;

  if (token.rubies.length && fragments.some((fragment) => fragment.hasRuby)) {
    fragments.forEach((fragment) => {
      if (!fragment.hasRuby) {
        return;
      }

      const parentRuby = domOps.findParent(fragment.node, 'RUBY');

      isMisparse = isMisparse || (parentRuby ? rubyOps.isMisparsedRuby(parentRuby, token) : false);
    });

    if (isMisparse) {
      fragments.forEach((fragment) => {
        const rubyParent = domOps.findParent(fragment.node, 'RUBY');

        if (rubyParent) {
          domOps.markElementAsMisparsed(rubyParent);
        }

        domOps.markNodeAsMisparsed(fragment.node);
      });
    }
  }

  return isMisparse;
}
