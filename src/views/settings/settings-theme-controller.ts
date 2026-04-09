import { setConfiguration } from '@shared/configuration/set-configuration';
import { ConfigurationSchema } from '@shared/configuration/types';
import { ConfigurationUpdatedCommand } from '@shared/messages/broadcast/configuration-updated.command';
import { onBroadcastMessage } from '@shared/messages/receiving/on-broadcast-message';
import { getThemeCssVars } from '@shared/theme/get-theme-css-vars';

export function initSettingsTheme(): void {
  const configurationUpdatedCommand = new ConfigurationUpdatedCommand();

  const getThemeStyleEl = (): HTMLStyleElement => {
    let styleEl = document.getElementById('jiten-theme-vars') as HTMLStyleElement;

    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'jiten-theme-vars';
      document.head.appendChild(styleEl);
    }

    return styleEl;
  };

  const applyThemeVars = async (): Promise<void> => {
    getThemeStyleEl().textContent = await getThemeCssVars();
  };

  const applyThemeVarsFromInputs = (): void => {
    const bg = (document.getElementById('themeBgColour') as HTMLInputElement)?.value || '#181818';
    const accent =
      (document.getElementById('themeAccentColour') as HTMLInputElement)?.value || '#D8B9FA';

    getThemeStyleEl().textContent = `:root, :host { --jiten-bg: ${bg}; --jiten-accent: ${accent}; }`;
  };

  const setupColourPicker = (colourId: string, textId: string): void => {
    const colourInput = document.getElementById(colourId) as HTMLInputElement;
    const textInput = document.getElementById(textId) as HTMLInputElement;

    if (!colourInput || !textInput) {
      return;
    }

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const saveAndApply = (value: string): void => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      applyThemeVarsFromInputs();

      debounceTimer = setTimeout(() => {
        void setConfiguration(colourId as keyof ConfigurationSchema, value).then(() => {
          configurationUpdatedCommand.send();
        });
      }, 150);
    };

    const syncTextFromColour = (): void => {
      textInput.value = colourInput.value.toUpperCase();
    };

    setTimeout(syncTextFromColour, 50);

    textInput.addEventListener('input', () => {
      const value = textInput.value.trim();

      if (/^#[0-9A-Fa-f]{6}$/i.test(value)) {
        colourInput.value = value;
        saveAndApply(value);
      }
    });

    colourInput.addEventListener('input', () => {
      textInput.value = colourInput.value.toUpperCase();
      saveAndApply(colourInput.value);
    });
  };

  void applyThemeVars();
  onBroadcastMessage('configurationUpdated', () => void applyThemeVars());
  setupColourPicker('themeBgColour', 'themeBgColourText');
  setupColourPicker('themeAccentColour', 'themeAccentColourText');
}
