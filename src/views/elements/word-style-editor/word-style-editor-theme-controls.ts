import { resolveThemeSync } from '@shared/word-style/resolve-theme';
import { SavedThemesList } from '@shared/word-style/saved-themes.types';
import { PRESET_THEMES } from '@shared/word-style/themes';
import { WordStyleConfig } from '@shared/word-style/types';
import { el } from './word-style-editor-dom';

export interface ThemeControlElements {
  copyButton: HTMLButtonElement;
  deleteButton: HTMLButtonElement;
  duplicateButton: HTMLButtonElement;
  importButton: HTMLButtonElement;
  newButton: HTMLButtonElement;
  renameButton: HTMLButtonElement;
  saveAsButton: HTMLButtonElement;
  themeBar: HTMLDivElement;
  themeSelect: HTMLSelectElement;
  unsavedWarning: HTMLDivElement;
}

export function buildThemeControls(): ThemeControlElements {
  const themeSelect = el('select', { class: 'theme-select' });
  const copyButton = button('Copy Theme');
  const importButton = button('Import Theme');
  const saveAsButton = button('Save As', 'btn btn-sm btn-save-as');
  const duplicateButton = button('Duplicate');
  const newButton = button('New');
  const renameButton = button('Rename', 'btn btn-sm btn-rename');
  const deleteButton = button('Delete', 'btn btn-sm btn-delete');
  const themeBar = el(
    'div',
    { class: 'theme-bar' },
    themeSelect,
    newButton,
    duplicateButton,
    saveAsButton,
    renameButton,
    deleteButton,
    copyButton,
    importButton,
  );
  const unsavedWarning = el('div', {
    class: 'unsaved-warning',
    textContent: 'This theme is unsaved. Use "Save As" to keep your changes.',
  });

  return {
    copyButton,
    deleteButton,
    duplicateButton,
    importButton,
    newButton,
    renameButton,
    saveAsButton,
    themeBar,
    themeSelect,
    unsavedWarning,
  };
}

export function populateThemeDropdown({
  config,
  savedThemes,
  select,
}: {
  config: WordStyleConfig;
  savedThemes: SavedThemesList;
  select: HTMLSelectElement;
}): void {
  select.innerHTML = '';

  const presetsGroup = document.createElement('optgroup');

  presetsGroup.label = 'Presets';

  for (const [key, { label }] of PRESET_THEMES) {
    presetsGroup.appendChild(el('option', { value: key, textContent: label }));
  }

  select.appendChild(presetsGroup);

  if (savedThemes.length > 0) {
    const savedGroup = document.createElement('optgroup');

    savedGroup.label = 'Saved';

    for (const savedTheme of savedThemes) {
      savedGroup.appendChild(el('option', { value: savedTheme.id, textContent: savedTheme.label }));
    }

    select.appendChild(savedGroup);
  }

  const resolved = resolveThemeSync(config.theme, savedThemes);

  if (resolved.type === 'custom') {
    select.appendChild(el('option', { value: 'custom', textContent: 'Custom' }));
  }
}

export function updateThemeActionVisibility({
  config,
  deleteButton,
  renameButton,
  savedThemes,
  unsavedWarning,
}: {
  config: WordStyleConfig;
  deleteButton: HTMLButtonElement;
  renameButton: HTMLButtonElement;
  savedThemes: SavedThemesList;
  unsavedWarning: HTMLDivElement;
}): void {
  const resolved = resolveThemeSync(config.theme, savedThemes);
  const isSaved = resolved.type === 'saved';
  const isCustom = resolved.type === 'custom';

  renameButton.style.display = isSaved ? '' : 'none';
  deleteButton.style.display = isSaved ? '' : 'none';
  unsavedWarning.style.display = isCustom ? '' : 'none';
}

function button(text: string, className = 'btn btn-sm'): HTMLButtonElement {
  return el('button', {
    class: className,
    type: 'button',
    textContent: text,
  });
}
