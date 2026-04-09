import { displayToast } from '@shared/dom/display-toast';
import { getStyleUrl } from '@shared/extension/get-style-url';
import { STYLEABLE_STATE_KEYS } from '@shared/word-style/constants';
import { resolveThemeSync } from '@shared/word-style/resolve-theme';
import {
  createSavedTheme,
  deleteSavedTheme,
  getSavedThemes,
  updateSavedTheme,
} from '@shared/word-style/saved-themes-state';
import { SavedThemesList } from '@shared/word-style/saved-themes.types';
import { decodeThemeCode, encodeThemeCode } from '@shared/word-style/theme-code';
import { PRESET_THEMES } from '@shared/word-style/themes';
import { Effect, WordStyleConfig } from '@shared/word-style/types';
import { el } from './word-style-editor/word-style-editor-dom';
import { renderPreview } from './word-style-editor/word-style-editor-preview';
import { renderStateSections } from './word-style-editor/word-style-editor-state-sections';
import {
  buildThemeControls,
  populateThemeDropdown,
  updateThemeActionVisibility,
} from './word-style-editor/word-style-editor-theme-controls';

export class HTMLWordStyleEditorElement extends HTMLElement {
  public static observedAttributes = ['value', 'name'];

  private _shadow!: ShadowRoot;
  private _input!: HTMLInputElement;
  private _config!: WordStyleConfig;
  private _themeSelect!: HTMLSelectElement;
  private _previewContainer!: HTMLDivElement;
  private _statesContainer!: HTMLDivElement;
  private _importRow!: HTMLDivElement;
  private _emitTimer: ReturnType<typeof setTimeout> | null = null;
  private _autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private _previewDark = true;
  private _previewStyle!: HTMLStyleElement;
  private _savedThemes: SavedThemesList = [];
  private _themeBar!: HTMLDivElement;
  private _saveAsBtn!: HTMLButtonElement;
  private _renameBtn!: HTMLButtonElement;
  private _deleteBtn!: HTMLButtonElement;
  private _unsavedWarning!: HTMLDivElement;

  public get value(): string {
    return JSON.stringify(this._config);
  }

  public set value(val: string | WordStyleConfig) {
    try {
      this._config = typeof val === 'object' ? val : (JSON.parse(val) as WordStyleConfig);
    } catch {
      return;
    }

    this._syncFromConfig();
  }

  public get name(): string {
    return this.getAttribute('name') ?? '';
  }

  public set name(val: string) {
    this.setAttribute('name', val);
  }

  public connectedCallback(): void {
    this._shadow = this.attachShadow({ mode: 'open' });

    this._shadow.appendChild(
      el('link', { rel: 'stylesheet', href: getStyleUrl('html-word-style-editor') }),
    );

    this._input = el('input', { type: 'hidden', name: this.name });
    this.appendChild(this._input);

    this._config = structuredClone(PRESET_THEMES.get('default')!.config);

    void getSavedThemes().then((themes) => {
      this._savedThemes = themes;
      this._buildDOM();
      this._syncFromConfig();
    });
  }

  public attributeChangedCallback(name: string, _old: string, val: string): void {
    if (name === 'value' && this._config) {
      try {
        const parsed = JSON.parse(val) as WordStyleConfig;

        if (JSON.stringify(parsed) !== JSON.stringify(this._config)) {
          this._config = parsed;
          this._syncFromConfig();
        }
      } catch {
        /* nop */
      }
    }

    if (name === 'name' && this._input) {
      this._input.name = val;
    }
  }

  private _buildDOM(): void {
    const themeControls = buildThemeControls();

    this._themeSelect = themeControls.themeSelect;
    this._saveAsBtn = themeControls.saveAsButton;
    this._renameBtn = themeControls.renameButton;
    this._deleteBtn = themeControls.deleteButton;
    this._themeBar = themeControls.themeBar;
    this._unsavedWarning = themeControls.unsavedWarning;

    this._populateThemeDropdown();

    this._themeSelect.addEventListener('change', () => {
      const theme = this._themeSelect.value;

      if (this._config.theme === 'custom' && theme !== 'custom') {
        if (!confirm('Your unsaved custom theme will be lost. Continue?')) {
          this._themeSelect.value = 'custom';

          return;
        }
      }

      this._syncThemeSelection(theme);
    });

    themeControls.copyButton.addEventListener('click', () => {
      const resolved = resolveThemeSync(this._config.theme, this._savedThemes);
      let name: string | undefined;

      if (resolved.type === 'preset') {
        name = resolved.preset.label;
      } else if (resolved.type === 'saved') {
        name = resolved.saved.label;
      }

      const code = encodeThemeCode(this._config, name);

      void navigator.clipboard.writeText(code).then(() => {
        displayToast('success', 'Theme code copied to clipboard');
      });
    });

    themeControls.importButton.addEventListener('click', () => {
      this._importRow.style.display = this._importRow.style.display === 'none' ? 'flex' : 'none';
    });

    this._saveAsBtn.addEventListener('click', () => {
      const name = prompt('Theme name:');

      if (!name?.trim()) {
        return;
      }

      void createSavedTheme(name.trim(), this._config).then((entry) => {
        this._savedThemes.push(entry);
        this._config.theme = entry.id;
        this._populateThemeDropdown();
        this._themeSelect.value = entry.id;
        this._updateThemeActions();
        this._emitChange();
        displayToast('success', 'Theme saved');
      });
    });

    themeControls.duplicateButton.addEventListener('click', () => {
      const resolved = resolveThemeSync(this._config.theme, this._savedThemes);
      let baseName = 'Custom';

      if (resolved.type === 'preset') {
        baseName = resolved.preset.label;
      } else if (resolved.type === 'saved') {
        baseName = resolved.saved.label;
      }

      const label = `Copy of ${baseName}`;

      void createSavedTheme(label, this._config).then((entry) => {
        this._savedThemes.push(entry);
        this._config = structuredClone(entry.config);
        this._config.theme = entry.id;
        this._syncFromConfig();
        this._emitChange();
        displayToast('success', `Theme duplicated as "${label}"`);
      });
    });

    themeControls.newButton.addEventListener('click', () => {
      this._config = this._getNewThemeConfig();
      this._syncFromConfig();
      this._emitChange();
    });

    this._renameBtn.addEventListener('click', () => {
      const saved = this._savedThemes.find((t) => t.id === this._config.theme);

      if (!saved) {
        return;
      }

      const name = prompt('New name:', saved.label);

      if (!name?.trim() || name.trim() === saved.label) {
        return;
      }

      saved.label = name.trim();
      void updateSavedTheme(saved.id, { label: saved.label }).then(() => {
        this._populateThemeDropdown();
        this._themeSelect.value = saved.id;
        displayToast('success', 'Theme renamed');
      });
    });

    this._deleteBtn.addEventListener('click', () => {
      const saved = this._savedThemes.find((t) => t.id === this._config.theme);

      if (!saved) {
        return;
      }

      if (!confirm(`Delete theme "${saved.label}"?`)) {
        return;
      }

      const id = saved.id;

      this._savedThemes = this._savedThemes.filter((t) => t.id !== id);
      void deleteSavedTheme(id);

      this._config.theme = 'custom';
      this._populateThemeDropdown();
      this._themeSelect.value = 'custom';
      this._updateThemeActions();
      this._emitChange();
      displayToast('success', 'Theme deleted');
    });

    this._importRow = this._buildImportRow();

    this._previewContainer = el('div', { class: 'preview-panel' });
    this._statesContainer = el('div', { class: 'state-sections' });

    this._previewStyle = document.createElement('style');
    this._shadow.append(
      this._previewStyle,
      this._themeBar,
      this._unsavedWarning,
      this._importRow,
      this._previewContainer,
      this._statesContainer,
    );
  }

  private _populateThemeDropdown(): void {
    populateThemeDropdown({
      config: this._config,
      savedThemes: this._savedThemes,
      select: this._themeSelect,
    });
  }

  private _updateThemeActions(): void {
    updateThemeActionVisibility({
      config: this._config,
      deleteButton: this._deleteBtn,
      renameButton: this._renameBtn,
      savedThemes: this._savedThemes,
      unsavedWarning: this._unsavedWarning,
    });
  }

  private _buildImportRow(): HTMLDivElement {
    const input = el('input', {
      type: 'text',
      class: 'import-input',
      placeholder: 'Paste theme code...',
    });
    const applyBtn = el('button', { class: 'btn btn-sm', type: 'button', textContent: 'Apply' });

    applyBtn.addEventListener('click', () => {
      const decoded = decodeThemeCode(input.value.trim());

      if (!decoded) {
        displayToast('error', 'Invalid theme code');

        return;
      }

      this._importRow.style.display = 'none';
      input.value = '';

      if (decoded.name) {
        void createSavedTheme(decoded.name, decoded.config).then((entry) => {
          this._savedThemes.push(entry);
          this._config = structuredClone(entry.config);
          this._config.theme = entry.id;
          this._syncFromConfig();
          this._emitChange();
          displayToast('success', `Theme "${entry.label}" imported and saved`);
        });
      } else {
        this._config = decoded.config;
        this._syncFromConfig();
        this._emitChange();
        displayToast('success', 'Theme imported');
      }
    });

    const row = el('div', { class: 'import-row', style: 'display:none' }, input, applyBtn);

    return row;
  }

  private _buildPreview(): void {
    renderPreview({
      config: this._config,
      container: this._previewContainer,
      previewStyle: this._previewStyle,
      previewDark: this._previewDark,
      getPreviewDark: () => this._previewDark,
      setPreviewDark: (previewDark) => {
        this._previewDark = previewDark;
      },
    });
  }

  private _buildStateSections(): void {
    renderStateSections({
      callbacks: {
        emitChange: () => this._emitChange(),
        handleUserEdit: () => this._handleUserEdit(),
        updatePreviews: () => this._updatePreviews(),
      },
      config: this._config,
      container: this._statesContainer,
    });
  }

  private _getNewThemeConfig(): WordStyleConfig {
    const states: Record<string, { effects: Effect[] }> = {};

    for (const key of STYLEABLE_STATE_KEYS) {
      states[key] = { effects: [] };
    }

    return { v: 1, theme: 'custom', states };
  }

  private _syncThemeSelection(theme: string): void {
    const preset = PRESET_THEMES.get(theme);

    if (preset) {
      this._config = structuredClone(preset.config);
      this._syncFromConfig();
      this._emitChange();

      return;
    }

    const saved = this._savedThemes.find((entry) => entry.id === theme);

    if (saved) {
      this._config = structuredClone(saved.config);
      this._config.theme = saved.id;
      this._syncFromConfig();
      this._emitChange();
    }
  }

  private _syncFromConfig(): void {
    if (!this._themeSelect || !this._config) {
      return;
    }

    this._populateThemeDropdown();
    this._themeSelect.value = this._config.theme;
    this._updateThemeActions();
    this._buildPreview();
    this._buildStateSections();
    this._syncHiddenInput();
  }

  private _updatePreviews(): void {
    this._buildPreview();
  }

  private _handleUserEdit(): void {
    const resolved = resolveThemeSync(this._config.theme, this._savedThemes);

    if (resolved.type === 'saved') {
      this._scheduleAutoSave(resolved.saved.id);

      return;
    }

    if (resolved.type === 'preset') {
      this._config.theme = 'custom';
      this._populateThemeDropdown();
      this._themeSelect.value = 'custom';
      this._updateThemeActions();
    }
  }

  private _scheduleAutoSave(id: string): void {
    if (this._autoSaveTimer) {
      clearTimeout(this._autoSaveTimer);
    }

    this._autoSaveTimer = setTimeout(() => {
      this._autoSaveTimer = null;

      const saved = this._savedThemes.find((t) => t.id === id);

      if (saved) {
        saved.config = structuredClone(this._config);
        saved.config.theme = id;
        void updateSavedTheme(id, { config: saved.config });
      }
    }, 250);
  }

  private _syncHiddenInput(): void {
    if (this._input) {
      this._input.value = JSON.stringify(this._config);
    }
  }

  private _emitChange(): void {
    this._syncHiddenInput();

    if (this._emitTimer) {
      clearTimeout(this._emitTimer);
    }

    this._emitTimer = setTimeout(() => {
      this._emitTimer = null;
      this._input.dispatchEvent(new Event('change', { bubbles: true }));
    }, 250);
  }
}
