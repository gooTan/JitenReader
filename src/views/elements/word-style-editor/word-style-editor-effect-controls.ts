import {
  BOUNDS,
  BORDER_STYLES,
  FONT_STYLES,
  FONT_WEIGHTS,
  UNDERLINE_STYLES,
} from '@shared/word-style/constants';
import { Effect, EffectType, WordStyleConfig } from '@shared/word-style/types';
import { el } from './word-style-editor-dom';

export interface BuildEffectControlsArgs {
  config: WordStyleConfig;
  container: HTMLElement;
  effect: Effect;
  index: number;
  onUpdate: () => void;
  stateKey: string;
}

export function defaultEffectForType(type: EffectType): Effect {
  switch (type) {
    case 'text-colour':
      return { type: 'text-colour', colour: '#ffffff' };
    case 'background':
      return { type: 'background', colour: '#ffffff', opacity: 0.15 };
    case 'underline':
      return { type: 'underline', colour: '#ffffff', style: 'solid', thickness: 2 };
    case 'border':
      return { type: 'border', colour: '#ffffff', width: 1, style: 'solid', radius: 4 };
    case 'shadow':
      return { type: 'shadow', colour: '#ffffff', blur: 6, offsetX: 0, offsetY: 2 };
    case 'blur':
      return { type: 'blur', radius: 3, hoverOnly: true };
    case 'opacity':
      return { type: 'opacity', value: 0.5, hoverOnly: true };
    case 'font-weight':
      return { type: 'font-weight', value: 'bold' };
    case 'font-style':
      return { type: 'font-style', value: 'italic' };
  }
}

export function buildEffectControls({
  config,
  container,
  effect,
  index,
  onUpdate,
  stateKey,
}: BuildEffectControlsArgs): void {
  switch (effect.type) {
    case 'text-colour':
      container.appendChild(
        colourInput(effect.colour, (value) => {
          (config.states[stateKey].effects[index] as typeof effect).colour = value;
          onUpdate();
        }),
      );

      break;

    case 'background':
      container.appendChild(
        colourInput(effect.colour, (value) => {
          (config.states[stateKey].effects[index] as typeof effect).colour = value;
          onUpdate();
        }),
      );
      container.appendChild(
        rangeInput('Opacity', effect.opacity, BOUNDS.backgroundOpacity, (value) => {
          (config.states[stateKey].effects[index] as typeof effect).opacity = value;
          onUpdate();
        }),
      );

      break;

    case 'underline':
      container.appendChild(
        colourInput(effect.colour, (value) => {
          (config.states[stateKey].effects[index] as typeof effect).colour = value;
          onUpdate();
        }),
      );
      container.appendChild(
        selectInput('Style', effect.style, UNDERLINE_STYLES as unknown as string[], (value) => {
          (config.states[stateKey].effects[index] as typeof effect).style =
            value as typeof effect.style;
          onUpdate();
        }),
      );
      container.appendChild(
        rangeInput('Thickness', effect.thickness, BOUNDS.underlineThickness, (value) => {
          (config.states[stateKey].effects[index] as typeof effect).thickness = value;
          onUpdate();
        }),
      );

      break;

    case 'border':
      container.appendChild(
        colourInput(effect.colour, (value) => {
          (config.states[stateKey].effects[index] as typeof effect).colour = value;
          onUpdate();
        }),
      );
      container.appendChild(
        rangeInput('Width', effect.width, BOUNDS.borderWidth, (value) => {
          (config.states[stateKey].effects[index] as typeof effect).width = value;
          onUpdate();
        }),
      );
      container.appendChild(
        selectInput('Style', effect.style, BORDER_STYLES as unknown as string[], (value) => {
          (config.states[stateKey].effects[index] as typeof effect).style =
            value as typeof effect.style;
          onUpdate();
        }),
      );
      container.appendChild(
        rangeInput('Radius', effect.radius, BOUNDS.borderRadius, (value) => {
          (config.states[stateKey].effects[index] as typeof effect).radius = value;
          onUpdate();
        }),
      );

      break;

    case 'shadow':
      container.appendChild(
        colourInput(effect.colour, (value) => {
          (config.states[stateKey].effects[index] as typeof effect).colour = value;
          onUpdate();
        }),
      );
      container.appendChild(
        rangeInput('Blur', effect.blur, BOUNDS.shadowBlur, (value) => {
          (config.states[stateKey].effects[index] as typeof effect).blur = value;
          onUpdate();
        }),
      );
      container.appendChild(
        rangeInput('X Offset', effect.offsetX, BOUNDS.shadowOffset, (value) => {
          (config.states[stateKey].effects[index] as typeof effect).offsetX = value;
          onUpdate();
        }),
      );
      container.appendChild(
        rangeInput('Y Offset', effect.offsetY, BOUNDS.shadowOffset, (value) => {
          (config.states[stateKey].effects[index] as typeof effect).offsetY = value;
          onUpdate();
        }),
      );

      break;

    case 'blur':
      container.appendChild(
        rangeInput('Radius', effect.radius, BOUNDS.blurRadius, (value) => {
          (config.states[stateKey].effects[index] as typeof effect).radius = value;
          onUpdate();
        }),
      );
      container.appendChild(
        checkboxInput('Reveal on hover', effect.hoverOnly, (value) => {
          (config.states[stateKey].effects[index] as typeof effect).hoverOnly = value;
          onUpdate();
        }),
      );

      break;

    case 'opacity':
      container.appendChild(
        rangeInput('Value', effect.value, BOUNDS.opacity, (value) => {
          (config.states[stateKey].effects[index] as typeof effect).value = value;
          onUpdate();
        }),
      );
      container.appendChild(
        checkboxInput('Restore on hover', effect.hoverOnly, (value) => {
          (config.states[stateKey].effects[index] as typeof effect).hoverOnly = value;
          onUpdate();
        }),
      );

      break;

    case 'font-weight':
      container.appendChild(
        selectInput('Weight', effect.value, FONT_WEIGHTS as unknown as string[], (value) => {
          (config.states[stateKey].effects[index] as typeof effect).value =
            value as typeof effect.value;
          onUpdate();
        }),
      );

      break;

    case 'font-style':
      container.appendChild(
        selectInput('Style', effect.value, FONT_STYLES as unknown as string[], (value) => {
          (config.states[stateKey].effects[index] as typeof effect).value =
            value as typeof effect.value;
          onUpdate();
        }),
      );

      break;
  }
}

function colourInput(value: string, onChange: (value: string) => void): HTMLDivElement {
  const wrapper = el('div', { class: 'control-group' });
  const colourPicker = el('input', { type: 'color', value: value.substring(0, 7) });
  const textInput = el('input', { type: 'text', class: 'colour-text', value });

  colourPicker.addEventListener('input', () => {
    textInput.value = colourPicker.value;
    onChange(colourPicker.value);
  });

  textInput.addEventListener('change', () => {
    const nextValue = textInput.value.trim();

    if (/^#[0-9a-fA-F]{3,8}$/.test(nextValue)) {
      colourPicker.value = nextValue.substring(0, 7);
      onChange(nextValue);
    }
  });

  wrapper.append(colourPicker, textInput);

  return wrapper;
}

function rangeInput(
  label: string,
  value: number,
  bounds: { max: number; min: number; step?: number },
  onChange: (value: number) => void,
): HTMLDivElement {
  const wrapper = el('div', { class: 'control-group' });
  const labelElement = el('span', { class: 'control-label', textContent: label });
  const step = bounds.step ?? 1;
  const range = el('input', {
    type: 'range',
    min: String(bounds.min),
    max: String(bounds.max),
    step: String(step),
    value: String(value),
  });
  const display = el('span', { class: 'range-value', textContent: String(value) });

  range.addEventListener('input', () => {
    const nextValue = parseFloat(range.value);

    display.textContent = String(nextValue);
    onChange(nextValue);
  });

  wrapper.append(labelElement, range, display);

  return wrapper;
}

function selectInput(
  label: string,
  value: string,
  options: string[],
  onChange: (value: string) => void,
): HTMLDivElement {
  const wrapper = el('div', { class: 'control-group' });
  const labelElement = el('span', { class: 'control-label', textContent: label });
  const select = el('select', { class: 'effect-select' });

  for (const optionValue of options) {
    const option = el('option', { value: optionValue, textContent: optionValue });

    if (optionValue === value) {
      option.selected = true;
    }

    select.appendChild(option);
  }

  select.addEventListener('change', () => onChange(select.value));
  wrapper.append(labelElement, select);

  return wrapper;
}

function checkboxInput(
  label: string,
  checked: boolean,
  onChange: (value: boolean) => void,
): HTMLDivElement {
  const wrapper = el('div', { class: 'control-group control-checkbox' });
  const checkbox = el('input', { type: 'checkbox' });

  checkbox.checked = checked;

  const labelElement = el('label', { textContent: label });

  checkbox.addEventListener('change', () => onChange(checkbox.checked));
  wrapper.append(checkbox, labelElement);

  return wrapper;
}
