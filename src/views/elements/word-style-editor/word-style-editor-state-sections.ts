import {
  EFFECT_LABELS,
  EFFECT_TYPES,
  STYLEABLE_STATES,
  STYLEABLE_STATE_KEYS,
} from '@shared/word-style/constants';
import { generateInlineStyles } from '@shared/word-style/generate-css';
import { Effect, EffectType, WordStyleConfig } from '@shared/word-style/types';
import { el } from './word-style-editor-dom';
import { buildEffectControls, defaultEffectForType } from './word-style-editor-effect-controls';

export interface StateSectionsCallbacks {
  emitChange: () => void;
  handleUserEdit: () => void;
  updatePreviews: () => void;
}

export interface RenderStateSectionsArgs {
  callbacks: StateSectionsCallbacks;
  config: WordStyleConfig;
  container: HTMLDivElement;
}

export function renderStateSections({
  callbacks,
  config,
  container,
}: RenderStateSectionsArgs): void {
  container.innerHTML = '';

  for (const stateKey of STYLEABLE_STATE_KEYS) {
    const stateStyle = config.states[stateKey] ?? { effects: [] };
    const section = buildStateSection({
      callbacks,
      config,
      container,
      effects: stateStyle.effects,
      stateKey,
    });

    container.appendChild(section);
  }
}

export function rebuildStateSection({
  callbacks,
  config,
  container,
  stateKey,
}: RenderStateSectionsArgs & { stateKey: string }): void {
  const sections = container.querySelectorAll('.state-section');
  const index = STYLEABLE_STATE_KEYS.indexOf(stateKey);

  if (index >= 0 && sections[index]) {
    const details = sections[index] as HTMLDetailsElement;

    refreshStateSection({
      callbacks,
      config,
      container,
      details,
      stateKey,
    });
  }
}

export function updateStatePreview({
  config,
  container,
  stateKey,
}: {
  config: WordStyleConfig;
  container: HTMLDivElement;
  stateKey: string;
}): void {
  const sections = container.querySelectorAll('.state-section');
  const index = STYLEABLE_STATE_KEYS.indexOf(stateKey);

  if (index >= 0 && sections[index]) {
    const previewWord = sections[index].querySelector('.state-preview-word');

    if (previewWord) {
      const inlineStyle = generateInlineStyles(config.states[stateKey]?.effects ?? []);

      previewWord.setAttribute('style', inlineStyle);
    }
  }
}

function refreshStateSection({
  callbacks,
  config,
  container,
  details,
  forceOpen,
  stateKey,
}: {
  callbacks: StateSectionsCallbacks;
  config: WordStyleConfig;
  container: HTMLDivElement;
  details: HTMLDetailsElement;
  forceOpen?: boolean;
  stateKey: string;
}): void {
  const effects = config.states[stateKey]?.effects ?? [];
  const newSection = buildStateSection({
    callbacks,
    config,
    container,
    effects,
    stateKey,
  });

  newSection.open = forceOpen ?? details.open;
  details.replaceWith(newSection);
}

function buildStateSection({
  callbacks,
  config,
  container,
  effects,
  stateKey,
}: {
  callbacks: StateSectionsCallbacks;
  config: WordStyleConfig;
  container: HTMLDivElement;
  effects: Effect[];
  stateKey: string;
}): HTMLDetailsElement {
  const details = document.createElement('details');

  details.className = 'state-section';

  const summary = document.createElement('summary');
  const chevron = el('span', { class: 'state-chevron', textContent: '\u25b6' });
  const label = el('span', { class: 'state-label', textContent: STYLEABLE_STATES[stateKey] });
  const previewWord = el('span', { class: 'state-preview-word' });
  const inlineStyle = generateInlineStyles(effects);

  previewWord.setAttribute('style', inlineStyle);
  previewWord.textContent = '例';

  const spacer = el('span', { class: 'summary-spacer' });
  const addSelect = el('select', { class: 'add-effect-select' });

  addSelect.appendChild(el('option', { value: '', textContent: '+ Add Effect' }));

  for (const effectType of EFFECT_TYPES) {
    addSelect.appendChild(
      el('option', { value: effectType, textContent: EFFECT_LABELS[effectType] }),
    );
  }

  addSelect.addEventListener('click', (event) => event.stopPropagation());
  addSelect.addEventListener('change', () => {
    if (!addSelect.value) {
      return;
    }

    const newEffect = defaultEffectForType(addSelect.value as EffectType);

    (config.states[stateKey] ??= { effects: [] }).effects.push(newEffect);
    callbacks.handleUserEdit();
    refreshStateSection({
      callbacks,
      config,
      container,
      details,
      forceOpen: true,
      stateKey,
    });
    callbacks.updatePreviews();
    callbacks.emitChange();
    addSelect.value = '';
  });

  summary.append(chevron, label, previewWord, spacer, addSelect);
  details.appendChild(summary);

  const effectList = el('div', { class: 'effect-list' });

  for (let index = 0; index < effects.length; index++) {
    effectList.appendChild(buildEffectRow({ callbacks, config, container, index, stateKey }));
  }

  details.appendChild(effectList);

  return details;
}

function buildEffectRow({
  callbacks,
  config,
  container,
  index,
  stateKey,
}: {
  callbacks: StateSectionsCallbacks;
  config: WordStyleConfig;
  container: HTMLDivElement;
  index: number;
  stateKey: string;
}): HTMLDivElement {
  const effect = config.states[stateKey].effects[index];
  const row = el('div', { class: 'effect-row' });
  const labelElement = el('span', {
    class: 'effect-label',
    textContent: EFFECT_LABELS[effect.type],
  });

  row.appendChild(labelElement);

  const controls = el('div', { class: 'effect-controls' });

  buildEffectControls({
    config,
    container: controls,
    effect,
    index,
    onUpdate: () => {
      callbacks.handleUserEdit();
      callbacks.updatePreviews();
      updateStatePreview({ config, container, stateKey });
      callbacks.emitChange();
    },
    stateKey,
  });
  row.appendChild(controls);

  const removeButton = el('button', {
    class: 'btn btn-remove',
    type: 'button',
    textContent: '\u00d7',
  });

  removeButton.addEventListener('click', () => {
    config.states[stateKey].effects.splice(index, 1);
    callbacks.handleUserEdit();
    rebuildStateSection({
      callbacks,
      config,
      container,
      stateKey,
    });
    callbacks.updatePreviews();
    callbacks.emitChange();
  });

  row.appendChild(removeButton);

  return row;
}
