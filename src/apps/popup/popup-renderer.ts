import { createElement } from '@shared/dom/create-element';
import { JitenCard, JitenCardState } from '@shared/jiten/types';
import { cleanReading, getPitchDiagramData } from '@shared/pitch-accent-utils';
import { PARTS_OF_SPEECH } from './part-of-speech';

export interface PopupRenderContextOptions {
  card: JitenCard;
  disableHeadWordLink: boolean;
  showPitchDiagrams: boolean;
}

export interface PopupRenderDetailsOptions {
  card: JitenCard;
  conjugations?: string[];
  showConjugations: boolean;
}

export function cardHasState(
  state: 'neverForget' | 'blacklist' | 'suspend',
  card: JitenCard,
): boolean {
  const stateMap: Record<'neverForget' | 'blacklist' | 'suspend', JitenCardState> = {
    neverForget: JitenCardState.MASTERED,
    blacklist: JitenCardState.BLACKLISTED,
    suspend: JitenCardState.BLACKLISTED,
  };

  return getReviewStateTags(card).includes(stateMap[state]);
}

export function getReviewStateTags(card: JitenCard): JitenCardState[] {
  return card.reviewMetadata?.stateTags ?? card.cardState;
}

export function renderPopupContext({
  card,
  disableHeadWordLink,
  showPitchDiagrams,
}: PopupRenderContextOptions): HTMLElement[] {
  return [
    createElement('div', {
      id: 'header',
      class: 'subsection',
      children: [getReadingBlock(card, disableHeadWordLink), getCardStateBlock(card)],
    }),
    createElement('div', {
      id: 'meta',
      class: 'subsection',
      children: [
        getPitchAccentBlock(card, showPitchDiagrams),
        getFrequencyBlock(card),
        getBackendStatusBlock(card),
      ],
    }),
  ];
}

export function renderPopupDetails({
  card,
  conjugations,
  showConjugations,
}: PopupRenderDetailsOptions): HTMLElement[] {
  const groupedMeanings = getGroupedMeanings(card);
  const conjugationsBlock =
    conjugations && showConjugations ? getConjugationsBlock(conjugations) : null;
  const children: HTMLElement[] = [];

  if (conjugationsBlock) {
    children.push(conjugationsBlock);
  }

  children.push(
    ...groupedMeanings.flatMap(({ partsOfSpeech, glosses, startIndex }) => [
      createElement('div', {
        class: 'pos',
        children: partsOfSpeech
          .map((pos) => PARTS_OF_SPEECH[pos] ?? 'Unknown')
          .filter(Boolean)
          .map((pos) => createElement('span', { innerText: pos })),
      }),
      createElement('ol', {
        attributes: {
          start: (startIndex + 1).toString(),
        },
        children: glosses.map((gloss) =>
          createElement('li', {
            innerText: gloss.join('; '),
          }),
        ),
      }),
    ]),
  );

  return children;
}

function getReadingBlock(card: JitenCard, disableHeadWordLink: boolean): HTMLElement {
  const { wordId, spelling, readingIndex, wordWithReading } = card;
  const nodes = convertToRubyNodes(wordWithReading ?? spelling);

  if (disableHeadWordLink) {
    const span = createElement('span', {
      id: 'link',
      attributes: { lang: 'ja' },
    });

    span.append(...nodes);

    return span;
  }

  const url = `https://jiten.moe/vocabulary/${wordId}/${readingIndex}`;
  const link = createElement('a', {
    id: 'link',
    attributes: { href: url, target: '_blank', lang: 'ja' },
  });

  link.append(...nodes);

  return link;
}

function convertToRubyNodes(wordWithReading: string): Node[] {
  if (!wordWithReading.includes('[')) {
    return [document.createTextNode(wordWithReading)];
  }

  const regex = /([^\u3040-\u309F\u30A0-\u30FF]+)\[(.+?)\]/g;
  const nodes: Node[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(wordWithReading)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(document.createTextNode(wordWithReading.slice(lastIndex, match.index)));
    }

    const ruby = document.createElement('ruby');
    const rubyText = document.createElement('rt');

    rubyText.textContent = match[2];
    ruby.append(document.createTextNode(match[1]));
    ruby.append(rubyText);
    nodes.push(ruby);

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < wordWithReading.length) {
    nodes.push(document.createTextNode(wordWithReading.slice(lastIndex)));
  }

  return nodes;
}

function getCardStateBlock(card: JitenCard): HTMLDivElement {
  return createElement('div', {
    id: 'state',
    children: getReviewStateTags(card).map((state) =>
      createElement('span', { class: [state], innerText: state }),
    ),
  });
}

function getPitchAccentBlock(card: JitenCard, showPitchDiagrams: boolean): HTMLDivElement {
  const container = createElement('div', { id: 'pitch-accent' });

  if (!showPitchDiagrams) {
    return container;
  }

  const kana = cleanReading(card.reading);

  for (const pitch of card.pitchAccents) {
    const svg = renderPitchDiagram(kana, pitch);

    if (svg) {
      container.appendChild(svg);
    }
  }

  return container;
}

function renderPitchDiagram(reading: string, pitchNum: number): SVGSVGElement | null {
  const data = getPitchDiagramData(reading, pitchNum);

  if (!data) {
    return null;
  }

  const { morae, pattern, color } = data;
  const ns = 'http://www.w3.org/2000/svg';
  const pointCount = pattern.length;
  const stepX = 18;
  const padX = 9;
  const width = pointCount * stepX;
  const height = 38;
  const highY = 5;
  const lowY = 17;
  const radius = 3;
  const textOffset = 8;
  const svg = document.createElementNS(ns, 'svg');

  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

  const points = pattern.map((value, index) => ({
    x: padX + index * stepX,
    y: value === 1 ? highY : lowY,
  }));
  const polyline = document.createElementNS(ns, 'polyline');

  polyline.setAttribute('points', points.map((point) => `${point.x},${point.y}`).join(' '));
  polyline.setAttribute('fill', 'none');
  polyline.setAttribute('stroke', color);
  polyline.setAttribute('stroke-width', '1.5');
  svg.appendChild(polyline);

  for (let index = 0; index < pointCount; index++) {
    const isParticle = index === pointCount - 1;
    const circle = document.createElementNS(ns, 'circle');

    circle.setAttribute('cx', String(points[index].x));
    circle.setAttribute('cy', String(points[index].y));
    circle.setAttribute('r', String(radius));
    circle.setAttribute('fill', isParticle ? '#fff' : color);
    circle.setAttribute('stroke', color);
    circle.setAttribute('stroke-width', '1.5');
    svg.appendChild(circle);

    if (!isParticle && morae[index]) {
      const text = document.createElementNS(ns, 'text');

      text.setAttribute('x', String(points[index].x));
      text.setAttribute('y', String(points[index].y + textOffset));
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'hanging');
      text.setAttribute('fill', color);
      text.setAttribute('font-size', '9');
      text.setAttribute('font-weight', 'bold');
      text.setAttribute('font-family', "'Noto Sans JP', sans-serif");
      text.textContent = morae[index];
      svg.appendChild(text);
    }
  }

  return svg;
}

function getFrequencyBlock(card: JitenCard): HTMLDivElement {
  return createElement('div', {
    id: 'frequency',
    innerText: `#${card.frequencyRank}`,
  });
}

function getBackendStatusBlock(card: JitenCard): HTMLDivElement {
  const { backend, freshness, dueState, resolutionStatus, mappingOutcome, stateTags } =
    card.reviewMetadata;
  const backendLabel = backend === 'anki' ? 'Anki' : 'Jiten';
  let statusLabel = freshness === 'stale' ? 'refreshing' : 'synced';

  if (resolutionStatus === 'backend-unavailable') {
    statusLabel = 'backend unavailable';
  } else if (resolutionStatus === 'config-insufficient') {
    statusLabel = 'config insufficient';
  } else if (mappingOutcome === 'ambiguous') {
    statusLabel = 'ambiguous target';
  } else if (mappingOutcome === 'none' && backend === 'anki') {
    statusLabel = 'no target';
  } else if (stateTags.includes(JitenCardState.SUSPENDED)) {
    statusLabel = 'suspended';
  } else if (stateTags.includes(JitenCardState.BURIED)) {
    statusLabel = 'buried';
  } else if (dueState === 'unavailable') {
    statusLabel = 'backend unavailable';
  }

  return createElement('div', {
    id: 'backend-status',
    children: [
      createElement('span', {
        class: ['backend', backend],
        innerText: backendLabel,
      }),
      createElement('span', {
        class: ['review-status', freshness === 'fresh' ? 'fresh' : 'stale'],
        innerText: statusLabel,
      }),
    ],
  });
}

function getConjugationsBlock(conjugations: string[]): HTMLDivElement | null {
  if (!conjugations.length) {
    return null;
  }

  return createElement('div', {
    id: 'conjugations',
    children: [
      createElement('span', {
        class: 'label',
        innerText: 'Conjugations: ',
      }),
      createElement('span', {
        innerText: conjugations.join(' ; '),
      }),
    ],
  });
}

function getGroupedMeanings(card: JitenCard): {
  glosses: string[][];
  partsOfSpeech: string[];
  startIndex: number;
}[] {
  const groupedMeanings: {
    glosses: string[][];
    partsOfSpeech: string[];
    startIndex: number;
  }[] = [];
  let lastPartsOfSpeech: string[] = [];

  for (const [index, meaning] of card.meanings.entries()) {
    const currentPartsOfSpeech = Array.isArray(meaning.partsOfSpeech)
      ? meaning.partsOfSpeech
      : [meaning.partsOfSpeech];

    if (
      currentPartsOfSpeech.length === lastPartsOfSpeech.length &&
      currentPartsOfSpeech.every((part, partIndex) => part === lastPartsOfSpeech[partIndex])
    ) {
      groupedMeanings[groupedMeanings.length - 1].glosses.push(meaning.glosses);

      continue;
    }

    groupedMeanings.push({
      partsOfSpeech: currentPartsOfSpeech,
      glosses: [meaning.glosses],
      startIndex: index,
    });
    lastPartsOfSpeech = meaning.partsOfSpeech;
  }

  return groupedMeanings;
}
