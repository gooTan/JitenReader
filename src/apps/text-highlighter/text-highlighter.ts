import { JitenToken } from '@shared/jiten/types';
import { Fragment } from '../batches/types';
import { Registry } from '../integration/registry';
import { BaseTextHighlighter } from './base.text-highlighter';
import {
  dismissElements,
  findParent,
  markElementAsMisparsed,
  markNodeAsMisparsed,
  patchElement,
  patchOrWrap,
  wrapElement,
} from './text-highlighter-dom-ops';
import { adjustUnmatchedFragments, cutoffTokenEnd } from './text-highlighter-fragment-rewriter';
import {
  areBoundariesExactMatch,
  buildTokenFragmentMaps,
  filterRelationMap,
  isFragmentWithinToken,
  rebuildTokenFragmentMaps,
} from './text-highlighter-maps';
import {
  patchContainedRubyElements,
  patchFragmentedRubyTokens,
  patchNonRubyTokens,
  patchRemainingMisparses,
  patchUnparsedFragments,
} from './text-highlighter-patch-strategies';
import {
  applyOnSharedParent,
  applyRubiesToFragment,
  fragmentsShareSingleRuby,
  getSharedRubyElement,
  isMisparsedRuby,
  splitSharedRubyElements,
} from './text-highlighter-ruby';
import { processInChunks, yieldToMainThread } from './text-highlighter-scheduler';
import { TextHighlighterState } from './text-highlighter.internal-types';

export class TextHighlighter extends BaseTextHighlighter {
  protected _state: TextHighlighterState = {
    fragmentToTokensMap: new Map<Fragment, JitenToken[]>(),
    fragments: new Set<Fragment>(this.fragments),
    tokenToFragmentsMap: new Map<JitenToken, Fragment[]>(),
    tokens: new Set<JitenToken>(this.tokens),
  };

  private static readonly CHUNK_SIZE = 40;

  public override apply(): Promise<void> {
    return this.applyAsync();
  }

  protected async preprocess(): Promise<void> {
    buildTokenFragmentMaps(this._state);
    await this.splitMultiTokenFragmentsChunked();
    await this.adjustUnmatchedFragmentsChunked();
    rebuildTokenFragmentMaps(this._state);
    await this.splitMultiTokenFragmentsChunked();
  }

  protected splitFragmentsNode(fragment: Fragment, start: number): Text {
    const node = fragment.node as Text;

    try {
      return node.splitText(start - fragment.start);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error splitting fragment node', {
        fragment,
        start,
        internalLength: node.data.length,
      });

      throw error;
    }
  }

  protected fixFragmentParameters(fragment: Fragment): void {
    fragment.length = fragment.node.data.length;
    fragment.end = fragment.start + fragment.length;
  }

  protected canSplitFragmentAt(fragment: Fragment, splitStart: number): boolean {
    const node = fragment.node as Text;
    const offset = splitStart - fragment.start;
    const length = node.data.length;

    return offset > 0 && offset < length;
  }

  protected insertNewFragment(node: Text, start: number, rubyElement?: Element): Fragment {
    const length = node.data.length;
    const newFragment: Fragment = {
      node,
      start,
      end: start + length,
      length,
      hasRuby: !!rubyElement,
      rubyElement,
    };

    this._state.fragments.add(newFragment);

    return newFragment;
  }

  private async applyAsync(): Promise<void> {
    await this.preprocess();

    splitSharedRubyElements(this._state, {
      findParent,
    });

    patchUnparsedFragments(
      this._state,
      { filterMap: filterRelationMap },
      { patchOrWrap: this.patchOrWrap },
    );

    await yieldToMainThread();

    await this.patchNonRubyTokensChunked();
    await this.patchContainedRubyElementsChunked();
    await this.patchFragmentedRubyTokensChunked();

    patchRemainingMisparses(
      this._state,
      {
        dismissElements: this.dismissElements,
        findParent,
        markElementAsMisparsed,
        markNodeAsMisparsed,
      },
      { isMisparsedRuby },
    );

    if (Registry.textHighlighterOptions.markIPlus1) {
      Registry.sentenceManager.calculateTargetSentences();
    }
  }

  private dismissElements = (fragment?: Fragment, token?: JitenToken): void => {
    dismissElements(this._state, fragment, token);
  };

  private patchOrWrap = (fragment: Fragment | Text, token?: JitenToken): HTMLElement | null =>
    patchOrWrap(this._state, fragment, token);

  private async splitMultiTokenFragmentsChunked(): Promise<void> {
    const filtered: Map<Fragment, JitenToken[]> = filterRelationMap(
      this._state.fragmentToTokensMap,
      (tokens) => tokens.length > 1,
    );
    const entries = [...filtered.entries()];
    let processed = 0;

    for (const [fragment, tokens] of entries) {
      let token: JitenToken | undefined;

      while ((token = tokens.pop())) {
        cutoffTokenEnd(
          fragment,
          token,
          {
            canSplitFragmentAt: (currentFragment, splitStart): boolean =>
              this.canSplitFragmentAt(currentFragment, splitStart),
            fixFragmentParameters: (currentFragment): void =>
              this.fixFragmentParameters(currentFragment),
            insertNewFragment: (node, start, rubyElement): Fragment =>
              this.insertNewFragment(node, start, rubyElement),
            splitFragmentsNode: (currentFragment, splitStart): Text =>
              this.splitFragmentsNode(currentFragment, splitStart),
          },
          { patchOrWrap: this.patchOrWrap },
        );

        if (token.start < fragment.start) {
          tokens.push(token);
          this._state.fragmentToTokensMap.get(fragment)?.push(token);
          this._state.tokenToFragmentsMap.get(token)?.push(fragment);

          break;
        }

        if (!this.canSplitFragmentAt(fragment, token.start)) {
          this.fixFragmentParameters(fragment);
          tokens.push(token);
          this._state.fragmentToTokensMap.get(fragment)?.push(token);
          this._state.tokenToFragmentsMap.get(token)?.push(fragment);

          break;
        }

        const newFragmentNode = this.splitFragmentsNode(fragment, token.start);
        const newFragment = this.insertNewFragment(
          newFragmentNode,
          token.start,
          fragment.rubyElement,
        );

        this._state.fragmentToTokensMap.set(newFragment, [token]);
        this._state.tokenToFragmentsMap.set(token, [newFragment]);

        this.fixFragmentParameters(fragment);
      }

      if (fragment.length && !this._state.fragmentToTokensMap.get(fragment)?.length) {
        this.patchOrWrap(fragment);
        this.dismissElements(fragment);
      }

      processed++;

      if (processed % TextHighlighter.CHUNK_SIZE === 0 && processed < entries.length) {
        await yieldToMainThread();
      }
    }
  }

  private async adjustUnmatchedFragmentsChunked(): Promise<void> {
    const filtered: Map<JitenToken, Fragment[]> = filterRelationMap(
      this._state.tokenToFragmentsMap,
      (fragments, token) => !areBoundariesExactMatch(token, fragments),
    );
    const entries = [...filtered.entries()];
    let processed = 0;

    for (const [token, fragments] of entries) {
      adjustUnmatchedFragments(
        {
          fragmentToTokensMap: new Map<Fragment, JitenToken[]>(),
          fragments: new Set<Fragment>(),
          tokenToFragmentsMap: new Map<JitenToken, Fragment[]>([[token, fragments]]),
          tokens: new Set<JitenToken>([token]),
        },
        {
          areBoundariesExactMatch,
          filterMap: filterRelationMap,
          isFragmentWithinToken,
        },
        {
          canSplitFragmentAt: (fragment, splitStart): boolean =>
            this.canSplitFragmentAt(fragment, splitStart),
          fixFragmentParameters: (fragment): void => this.fixFragmentParameters(fragment),
          insertNewFragment: (node, start, rubyElement): Fragment =>
            this.insertNewFragment(node, start, rubyElement),
          splitFragmentsNode: (fragment, splitStart): Text =>
            this.splitFragmentsNode(fragment, splitStart),
        },
      );

      processed++;

      if (processed % TextHighlighter.CHUNK_SIZE === 0 && processed < entries.length) {
        await yieldToMainThread();
      }
    }
  }

  private async patchNonRubyTokensChunked(): Promise<void> {
    const filtered: Map<JitenToken, Fragment[]> = filterRelationMap(
      this._state.tokenToFragmentsMap,
      (fragments, token) => !token.rubies.length && areBoundariesExactMatch(token, fragments),
    );

    await processInChunks(TextHighlighter.CHUNK_SIZE, filtered, (token, fragments) => {
      patchNonRubyTokens(
        {
          fragmentToTokensMap: new Map<Fragment, JitenToken[]>(),
          fragments: new Set<Fragment>(),
          tokenToFragmentsMap: new Map<JitenToken, Fragment[]>([[token, fragments]]),
          tokens: new Set<JitenToken>([token]),
        },
        { areBoundariesExactMatch, filterMap: filterRelationMap },
        { patchOrWrap: this.patchOrWrap },
      );
    });
  }

  private async patchContainedRubyElementsChunked(): Promise<void> {
    const filtered: Map<JitenToken, Fragment[]> = filterRelationMap(
      this._state.tokenToFragmentsMap,
      (fragments, token) =>
        !!token.rubies.length &&
        areBoundariesExactMatch(token, fragments) &&
        fragmentsShareSingleRuby({ findParent }, fragments),
    );

    await processInChunks(TextHighlighter.CHUNK_SIZE, filtered, (token, fragments) => {
      patchContainedRubyElements(
        {
          fragmentToTokensMap: new Map<Fragment, JitenToken[]>(),
          fragments: new Set<Fragment>(),
          tokenToFragmentsMap: new Map<JitenToken, Fragment[]>([[token, fragments]]),
          tokens: new Set<JitenToken>([token]),
        },
        { areBoundariesExactMatch, filterMap: filterRelationMap },
        {
          dismissElements: this.dismissElements,
          markElementAsMisparsed,
          patchElement,
        },
        {
          applyRubiesToFragment: (fragment, rubyToken, rubies) =>
            applyRubiesToFragment({ wrapElement }, fragment, rubyToken, rubies),
          fragmentsShareSingleRuby: (targetFragments) =>
            fragmentsShareSingleRuby({ findParent }, targetFragments),
          getSharedRubyElement: (targetFragments) =>
            getSharedRubyElement({ findParent }, targetFragments),
          isMisparsedRuby,
        },
      );
    });
  }

  private async patchFragmentedRubyTokensChunked(): Promise<void> {
    const filtered: Map<JitenToken, Fragment[]> = filterRelationMap(
      this._state.tokenToFragmentsMap,
      (fragments, token) => areBoundariesExactMatch(token, fragments),
    );

    await processInChunks(TextHighlighter.CHUNK_SIZE, filtered, (token, fragments) => {
      if (!areBoundariesExactMatch(token, fragments)) {
        return;
      }

      patchFragmentedRubyTokens(
        {
          fragmentToTokensMap: new Map<Fragment, JitenToken[]>(),
          fragments: new Set<Fragment>(),
          tokenToFragmentsMap: new Map<JitenToken, Fragment[]>([[token, fragments]]),
          tokens: new Set<JitenToken>([token]),
        },
        { areBoundariesExactMatch, filterMap: filterRelationMap },
        {
          dismissElements: this.dismissElements,
          findParent,
          patchElement,
          patchOrWrap: this.patchOrWrap,
        },
        {
          applyOnSharedParent: (targetFragments, targetToken) =>
            applyOnSharedParent(
              {
                dismissElements: this.dismissElements,
                findParent,
                patchElement,
              },
              targetFragments,
              targetToken,
            ),
          applyRubiesToFragment: (fragment, rubyToken, rubies) =>
            applyRubiesToFragment({ wrapElement }, fragment, rubyToken, rubies),
        },
      );
    });
  }
}
