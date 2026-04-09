import { JitenToken, JitenRuby } from '@shared/jiten/types';
import { Fragment } from '../batches/types';

export interface TextHighlighterState {
  fragmentToTokensMap: Map<Fragment, JitenToken[]>;
  fragments: Set<Fragment>;
  tokenToFragmentsMap: Map<JitenToken, Fragment[]>;
  tokens: Set<JitenToken>;
}

export interface HighlighterDomOps {
  dismissElements: (fragment?: Fragment, token?: JitenToken) => void;
  findParent: (node: Node, tag: Uppercase<string>) => HTMLElement | null;
  markElementAsMisparsed: (element: HTMLElement) => void;
  markNodeAsMisparsed: (node: Text) => void;
  patchElement: (element: HTMLElement, token?: JitenToken) => void;
  patchOrWrap: (fragment: Fragment | Text, token?: JitenToken) => HTMLElement | null;
  wrapElement: (node: Text, token?: JitenToken) => HTMLElement;
}

export interface HighlighterFragmentOps {
  canSplitFragmentAt: (fragment: Fragment, splitStart: number) => boolean;
  fixFragmentParameters: (fragment: Fragment) => void;
  insertNewFragment: (node: Text, start: number, rubyElement?: Element) => Fragment;
  splitFragmentsNode: (fragment: Fragment, start: number) => Text;
}

export interface HighlighterMapOps {
  areBoundariesExactMatch: (
    reference: { end: number; start: number },
    targets: { end: number; start: number }[],
  ) => boolean;
  filterMap: <TKey, TValue>(
    map: Map<TKey, TValue[]>,
    filter: (values: TValue[], key: TKey) => boolean,
  ) => Map<TKey, TValue[]>;
  isFragmentWithinToken: (fragment: Fragment, token: JitenToken) => boolean;
}

export interface HighlighterRubyOps {
  applyOnSharedParent: (fragments: Fragment[], token: JitenToken) => boolean;
  applyRubiesToFragment: (fragment: Fragment, token: JitenToken, rubies?: JitenRuby[]) => void;
  fragmentsShareSingleRuby: (fragments: Fragment[]) => boolean;
  getSharedRubyElement: (fragments: Fragment[]) => HTMLElement | null;
  isMisparsedRuby: (rubyElement: HTMLElement, token: JitenToken) => boolean;
}
