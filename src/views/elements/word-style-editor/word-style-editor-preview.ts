import { STYLEABLE_STATES } from '@shared/word-style/constants';
import { generateInlineStyles, generateWordStyleCSS } from '@shared/word-style/generate-css';
import { WordStyleConfig } from '@shared/word-style/types';
import { el } from './word-style-editor-dom';

const PREVIEW_WORDS: { state: string; text: string }[] = [
  { text: '事典', state: 'new' },
  { text: 'を', state: 'unparsed' },
  { text: '読む', state: 'mature' },
  { text: '時', state: 'young' },
  { text: '、', state: 'unparsed' },
  { text: '新しい', state: 'i-plus-one' },
  { text: '言葉', state: 'due' },
  { text: 'が', state: 'mastered' },
  { text: '出て', state: 'frequent' },
  { text: 'くる', state: 'blacklisted' },
  { text: '。', state: 'unparsed' },
];

export interface RenderPreviewArgs {
  config: WordStyleConfig;
  container: HTMLDivElement;
  previewStyle: HTMLStyleElement;
  previewDark: boolean;
  getPreviewDark: () => boolean;
  setPreviewDark: (previewDark: boolean) => void;
}

export function renderPreview({
  config,
  container,
  previewStyle,
  previewDark,
  getPreviewDark,
  setPreviewDark,
}: RenderPreviewArgs): void {
  container.innerHTML = '';
  previewStyle.textContent =
    '.jiten-word { margin-inline: 0.5px; }\n' + generateWordStyleCSS(config);

  const previewHorizontal = el('div', { class: 'preview-horizontal' });

  for (const word of PREVIEW_WORDS) {
    const span = el('span', { class: `jiten-word preview-word ${word.state}` });

    span.textContent = word.text;
    previewHorizontal.appendChild(span);
  }

  const previewVertical = el('div', { class: 'preview-vertical' });

  for (const word of PREVIEW_WORDS) {
    const span = el('span', { class: `jiten-word preview-word ${word.state}` });

    span.textContent = word.text;
    previewVertical.appendChild(span);
  }

  const legend = el('div', { class: 'preview-legend' });
  const usedStates = [...new Set(PREVIEW_WORDS.map((word) => word.state))];

  for (const state of usedStates) {
    const swatch = el('span', { class: 'legend-swatch' });
    const inlineStyle = generateInlineStyles(config.states[state]?.effects ?? []);

    swatch.setAttribute('style', inlineStyle);
    swatch.textContent = STYLEABLE_STATES[state] ?? state;
    legend.appendChild(swatch);
  }

  const toggleButton = el('button', {
    class: 'btn btn-sm preview-bg-toggle',
    type: 'button',
    textContent: previewDark ? '\u2600' : '\u263e',
  });

  toggleButton.addEventListener('click', () => {
    const nextPreviewDark = !getPreviewDark();

    setPreviewDark(nextPreviewDark);
    container.classList.toggle('light', !nextPreviewDark);
    toggleButton.textContent = nextPreviewDark ? '\u2600' : '\u263e';
  });

  const header = el('div', { class: 'preview-header' }, toggleButton);

  container.classList.toggle('light', !previewDark);
  container.append(header, previewHorizontal, previewVertical, legend);
}
