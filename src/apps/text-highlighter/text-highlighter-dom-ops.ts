import { createElement } from '@shared/dom/create-element';
import { JitenToken } from '@shared/jiten/types';
import { Fragment } from '../batches/types';
import { Registry } from '../integration/registry';
import { TextHighlighterState } from './text-highlighter.internal-types';

export function markNodeAsMisparsed(node: Text): void {
  const parent = node.parentElement;

  if (!parent) {
    return;
  }

  const wrapper = createElement('span', {
    class: ['jiten-word', 'misparsed'],
    attributes: { ajb: 'true' },
  });

  parent.replaceChild(wrapper, node);
  wrapper.appendChild(node);
}

export function patchOrWrap(
  state: TextHighlighterState,
  fragment: Fragment | Text,
  token?: JitenToken,
): HTMLElement | null {
  const isFragment = isFragmentRecord(fragment);
  const node = isFragment ? fragment.node : fragment;
  const fragmentsParent = node.parentElement;

  if (!fragmentsParent) {
    return null;
  }

  if (isFragment) {
    dismissElements(state, fragment, token);
  }

  const rubyParent = findParent(node, 'RUBY');

  if (rubyParent && !rubyParent.hasAttribute('ajb')) {
    patchElement(rubyParent, token);

    if (!Registry.textHighlighterOptions.skipFurigana) {
      rubyParent.querySelectorAll('rt').forEach((rt) => rt.classList.add('jiten-furi'));
    }

    return rubyParent;
  }

  if (fragmentsParent.childNodes.length > 1) {
    const element = wrapElement(node, token);

    if (!Registry.textHighlighterOptions.skipFurigana) {
      element.querySelectorAll('rt').forEach((rt) => rt.classList.add('jiten-furi'));
    }

    return element;
  }

  patchElement(fragmentsParent, token);

  return fragmentsParent;
}

export function dismissElements(
  state: TextHighlighterState,
  fragment?: Fragment,
  token?: JitenToken,
): void {
  if (fragment) {
    state.fragments.delete(fragment);
    state.fragmentToTokensMap.delete(fragment);
  }

  if (token) {
    state.tokens.delete(token);
    state.tokenToFragmentsMap.delete(token);
  }
}

export function wrapElement(node: Text, token?: JitenToken): HTMLElement {
  const element = document.createElement('span');

  patchElement(element, token);

  node.parentElement?.replaceChild(element, node);
  element.appendChild(node);

  return element;
}

export function patchElement(element: HTMLElement, token?: JitenToken): void {
  const { skipFurigana, markFrequency, markAll, generatePitch, markIPlus1, newStates } =
    Registry.textHighlighterOptions;
  const { card, pitchClass, sentence, conjugations } = token ?? {};

  if (element.hasAttribute('ajb')) {
    return;
  }

  element.setAttribute('ajb', 'true');

  if (markIPlus1) {
    Registry.sentenceManager.addElement(element, token);
  }

  if (!skipFurigana) {
    element.querySelectorAll('rt').forEach((rt) => rt.classList.add('jiten-furi'));
  }

  if (card) {
    Registry.addCard(card, element, conjugations);

    element.classList.add('jiten-word', ...card.cardState);

    if (markFrequency && card.frequencyRank <= markFrequency) {
      const states = card.cardState;
      const isNew = states.some((state) => newStates.includes(state));

      if (markAll || isNew) {
        element.classList.add('frequent');
      }
    }

    if (pitchClass && generatePitch) {
      element.classList.add(pitchClass);
    }

    element.setAttribute('wordId', card.wordId.toString());
    element.setAttribute('readingIndex', card.readingIndex.toString());

    Registry.wordEventDelegator.setSentence(element, sentence);

    return;
  }

  element.classList.add('jiten-word', 'unparsed');
}

export function findParent(node: Node, tag: Uppercase<string>): HTMLElement | null {
  let parent = node.parentElement;

  while (parent && parent.tagName !== tag) {
    parent = parent.parentElement;
  }

  return parent;
}

export function markElementAsMisparsed(element: HTMLElement): void {
  if (element.hasAttribute('ajb')) {
    return;
  }

  element.classList.add('jiten-word', 'misparsed');
  element.setAttribute('ajb', 'true');
}

function isFragmentRecord(element: Fragment | Text): element is Fragment {
  return 'node' in element;
}
