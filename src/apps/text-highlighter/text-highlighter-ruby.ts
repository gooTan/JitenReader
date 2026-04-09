import { JitenRuby, JitenToken } from '@shared/jiten/types';
import { Fragment } from '../batches/types';
import { Registry } from '../integration/registry';
import { HighlighterDomOps, TextHighlighterState } from './text-highlighter.internal-types';

export function applyRubiesToFragment(
  domOps: Pick<HighlighterDomOps, 'wrapElement'>,
  fragment: Fragment,
  token: JitenToken,
  rubies: JitenRuby[] = token.rubies,
): void {
  const newRuby = domOps.wrapElement(fragment.node, token);

  if (Registry.textHighlighterOptions.skipFurigana) {
    return;
  }

  const documentFragment = createRubyNodesForFragment(fragment, rubies);

  newRuby.textContent = '';
  newRuby.append(documentFragment);
}

export function createRubyNodesForFragment(
  fragment: Fragment,
  rubies: JitenRuby[],
): DocumentFragment {
  const nodeText = fragment.node.textContent ?? '';
  let lastIndex = 0;
  const documentFragment = document.createDocumentFragment();
  const sortedRubies = [...rubies].sort((a, b) => a.start - b.start);

  for (const ruby of sortedRubies) {
    const rubyStart = ruby.start - fragment.start;
    const rubyEnd = ruby.end - fragment.start;

    if (rubyStart > lastIndex) {
      documentFragment.append(document.createTextNode(nodeText.slice(lastIndex, rubyStart)));
    }

    const rubyElement = document.createElement('ruby');
    const rubyText = document.createElement('rt');

    rubyElement.append(document.createTextNode(nodeText.slice(rubyStart, rubyEnd)));
    rubyText.className = 'jiten-furi';
    rubyText.textContent = ruby.text;

    rubyElement.append(rubyText);
    documentFragment.append(rubyElement);

    lastIndex = rubyEnd;
  }

  if (lastIndex < nodeText.length) {
    documentFragment.append(document.createTextNode(nodeText.slice(lastIndex)));
  }

  return documentFragment;
}

export function applyOnSharedParent(
  domOps: Pick<HighlighterDomOps, 'dismissElements' | 'findParent' | 'patchElement'>,
  fragments: Fragment[],
  token: JitenToken,
): boolean {
  const anyHasRuby = fragments.some((fragment) => domOps.findParent(fragment.node, 'RUBY'));
  const sharedParentNode = findSharedParent(
    fragments[0].node,
    fragments[fragments.length - 1].node,
  );

  if (sharedParentNode && anyHasRuby) {
    const clone = sharedParentNode.cloneNode(true) as HTMLElement;

    if (!Registry.textHighlighterOptions.skipFurigana) {
      clone.querySelectorAll('rt').forEach((rt) => rt.remove());
    }

    const cloneText = clone.textContent;
    const fragmentText = fragments.map((fragment) => fragment.node.textContent).join('');

    if (cloneText === fragmentText) {
      domOps.patchElement(sharedParentNode, token);

      fragments.forEach((fragment) => {
        domOps.dismissElements(fragment, token);
      });

      return true;
    }
  }

  return false;
}

export function findSharedParent(nodeA: Node, nodeB: Node): HTMLElement | null {
  let parent = nodeA.parentElement;

  while (parent) {
    if (parent.contains(nodeB)) {
      return parent;
    }

    parent = parent.parentElement;
  }

  return null;
}

export function fragmentsShareSingleRuby(
  domOps: Pick<HighlighterDomOps, 'findParent'>,
  fragments: Fragment[],
): boolean {
  if (fragments.length === 0) {
    return false;
  }

  const rubyElements = fragments
    .map((fragment) => fragment.rubyElement ?? domOps.findParent(fragment.node, 'RUBY'))
    .filter((element): element is Element => element !== null);

  if (rubyElements.length !== fragments.length) {
    return false;
  }

  const firstRuby = rubyElements[0];

  return rubyElements.every((rubyElement) => rubyElement === firstRuby);
}

export function getSharedRubyElement(
  domOps: Pick<HighlighterDomOps, 'findParent'>,
  fragments: Fragment[],
): HTMLElement | null {
  if (fragments.length === 0) {
    return null;
  }

  const first = fragments[0];

  return (first.rubyElement as HTMLElement) ?? domOps.findParent(first.node, 'RUBY');
}

export function isMisparsedRuby(_rubyElement: HTMLElement, _token: JitenToken): boolean {
  return false;
}

export function splitSharedRubyElements(
  state: TextHighlighterState,
  domOps: Pick<HighlighterDomOps, 'findParent'>,
): void {
  const rubyToTokens = new Map<Element, Set<JitenToken>>();

  for (const [token, fragments] of state.tokenToFragmentsMap) {
    for (const fragment of fragments) {
      if (!fragment.hasRuby) {
        continue;
      }

      const rubyElement = fragment.rubyElement ?? domOps.findParent(fragment.node, 'RUBY');

      if (!rubyElement) {
        continue;
      }

      let tokenSet = rubyToTokens.get(rubyElement);

      if (!tokenSet) {
        tokenSet = new Set();
        rubyToTokens.set(rubyElement, tokenSet);
      }

      tokenSet.add(token);
    }
  }

  for (const [rubyElement, tokens] of rubyToTokens) {
    if (tokens.size <= 1) {
      continue;
    }

    splitRubyForTokens(state, domOps, rubyElement, tokens);
  }
}

function splitRubyForTokens(
  state: TextHighlighterState,
  domOps: Pick<HighlighterDomOps, 'findParent'>,
  rubyElement: Element,
  tokens: Set<JitenToken>,
): void {
  const parent = rubyElement.parentNode;

  if (!parent) {
    return;
  }

  const nodeToToken = new Map<Node, JitenToken>();

  for (const token of tokens) {
    const fragments = state.tokenToFragmentsMap.get(token) ?? [];

    for (const fragment of fragments) {
      const fragmentRuby = fragment.rubyElement ?? domOps.findParent(fragment.node, 'RUBY');

      if (fragmentRuby === rubyElement) {
        nodeToToken.set(fragment.node, token);
      }
    }
  }

  type NodeGroup = { nodes: Node[]; token: JitenToken | null };

  const groups: NodeGroup[] = [];
  let current: NodeGroup | null = null;

  for (const child of Array.from(rubyElement.childNodes)) {
    if (child instanceof Text || child instanceof CDATASection) {
      const token = nodeToToken.get(child) ?? null;

      if (current?.token !== token) {
        current = { token, nodes: [] };
        groups.push(current);
      }

      current.nodes.push(child);
    } else if (child instanceof Element && (child.tagName === 'RT' || child.tagName === 'RP')) {
      current?.nodes.push(child);
    } else {
      current?.nodes.push(child);
    }
  }

  if (groups.length <= 1) {
    return;
  }

  for (const group of groups) {
    const newRuby = document.createElement('ruby');

    for (const node of group.nodes) {
      newRuby.appendChild(node);
    }

    parent.insertBefore(newRuby, rubyElement);
  }

  rubyElement.remove();

  for (const fragment of state.fragments) {
    if (fragment.rubyElement !== rubyElement) {
      continue;
    }

    fragment.rubyElement = domOps.findParent(fragment.node, 'RUBY') ?? undefined;
  }
}
