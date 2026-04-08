import { getDecks } from '@shared/anki/get-decks';
import { getFields } from '@shared/anki/get-fields';
import { AnkiModelTemplate, getModelTemplates } from '@shared/anki/get-model-templates';
import { getModels } from '@shared/anki/get-models';
import { DiscoverWordConfiguration } from '@shared/anki/types';
import { createElement } from '@shared/dom/create-element';
import { getStyleUrl } from '@shared/extension/get-style-url';

type ReadonlyConfigRow = {
  deck: string;
  model: string;
  readingField: string;
  templateOrds: number[];
  wordField: string;
};

const observedAttributes = ['value', 'name', 'fetch-url'] as const;

export class HTMLAnkiReadonlyConfigsElement extends HTMLElement {
  public static observedAttributes = observedAttributes;

  private _rows: ReadonlyConfigRow[] = [];
  private _decks: string[] = [];
  private _models: string[] = [];
  private _fetchUrl = '';
  private _fieldsByModel = new Map<string, string[]>();
  private _templatesByModel = new Map<string, AnkiModelTemplate[]>();
  private _input!: HTMLInputElement;
  private _list!: HTMLDivElement;
  private _shadow!: ShadowRoot;
  private _suppressChangeEvent = false;

  public get value(): DiscoverWordConfiguration[] {
    return JSON.parse(this.getAttribute('value') ?? '[]') as DiscoverWordConfiguration[];
  }

  public set value(value: DiscoverWordConfiguration[]) {
    this.setAttribute('value', JSON.stringify(value));
  }

  public get name(): string {
    return this.getAttribute('name') ?? '';
  }

  public set name(value: string) {
    this.setAttribute('name', value);
  }

  public set fetchUrl(value: string) {
    this.setAttribute('fetch-url', value);
  }

  public connectedCallback(): void {
    this._shadow = this.attachShadow({ mode: 'open' });
    this._shadow.appendChild(
      createElement('link', {
        attributes: {
          rel: 'stylesheet',
          href: getStyleUrl('html-mining-input'),
        },
      }),
    );

    this._input = createElement('input', {
      attributes: {
        type: 'hidden',
        name: this.name,
      },
    });
    this._list = createElement('div');

    const container = createElement('div', {
      class: ['mining-input'],
      children: [
        createElement('div', {
          children: [
            createElement('p', {
              style: { opacity: '0.8' },
              innerText:
                'Advanced overrides replace or extend the derived read-side matching rules.',
            }),
            this._list,
            createElement('div', {
              class: ['controls-list'],
              children: [
                createElement('input', {
                  class: 'outline',
                  attributes: { type: 'button', value: 'Add Override' },
                  handler: () => this.addRow(),
                }),
                createElement('input', {
                  class: ['outline', 'v1'],
                  attributes: { type: 'button', value: 'Clear' },
                  handler: () => this.clearRows(),
                }),
              ],
            }),
          ],
        }),
      ],
    });

    this._shadow.append(this._input, container);
    this.unpackValue();

    if (this._fetchUrl.length) {
      void this.refreshFromUrl(this._fetchUrl);
    }
  }

  public attributeChangedCallback(name: string, _oldValue: string, newValue: string): void {
    if (name === 'name' && this._input) {
      this._input.name = newValue ?? '';
    }

    if (name === 'fetch-url') {
      this._fetchUrl = newValue?.trim() ?? '';

      if (this._fetchUrl.length && this.isConnected) {
        void this.refreshFromUrl(this._fetchUrl);
      }
    }

    if (name === 'value' && this._input && this._input.value !== newValue) {
      this._input.value = newValue ?? '[]';
      this.unpackValue();
    }
  }

  public async refreshFromUrl(ankiConnectUrl: string): Promise<void> {
    if (!ankiConnectUrl.length) {
      return;
    }

    this._decks = [''].concat(await getDecks({ ankiConnectUrl }));
    this._models = await getModels({ ankiConnectUrl });

    await Promise.all(
      this._rows.map((row) => this.ensureModelDataLoaded(row.model, ankiConnectUrl)),
    );
    this.renderRows();
    this.packRows(false);
  }

  private addRow(): void {
    this._rows.push({
      deck: '',
      model: '',
      readingField: '',
      templateOrds: [],
      wordField: '',
    });
    this.renderRows();
    this.packRows();
  }

  private clearRows(): void {
    this._rows = [];
    this.renderRows();
    this.packRows();
  }

  private unpackValue(): void {
    this._rows = this.value.map((config) => ({
      deck: config.deck?.trim() ?? '',
      model: config.model?.trim() ?? '',
      readingField: config.readingField?.trim() ?? '',
      templateOrds: Array.isArray(config.templateOrds) ? config.templateOrds : [],
      wordField: config.wordField?.trim() ?? '',
    }));

    if (!this._list) {
      return;
    }

    this.renderRows();
  }

  private packRows(dispatchChange = true): void {
    this._suppressChangeEvent = !dispatchChange;

    this.value = this._rows.map((row) => ({
      deck: row.deck,
      model: row.model,
      readingField: row.readingField,
      templateOrds: [...row.templateOrds].sort((left, right) => left - right),
      wordField: row.wordField,
    }));

    this._suppressChangeEvent = false;

    if (dispatchChange) {
      this.dispatchEvent(new Event('change'));
    }
  }

  private renderRows(): void {
    const rows = this._rows.map((row, index) => this.renderRow(row, index));

    this._list.replaceChildren(...rows);
  }

  private renderRow(row: ReadonlyConfigRow, index: number): HTMLDivElement {
    const fields = this.getFieldsForModel(row.model);
    const templates = this.getTemplatesForModel(row.model);
    const wordOptions = [...new Set([row.wordField, ...fields].filter(Boolean))];
    const readingOptions = [''].concat([
      ...new Set([row.readingField, ...fields].filter((field) => field.length > 0)),
    ]);
    const deckOptions = [...new Set(['', row.deck, ...this._decks])];
    const modelOptions = [...new Set([row.model, ...this._models].filter(Boolean))];
    const templateOptions = [
      ...new Set([...templates.map((template) => template.ord), ...row.templateOrds]),
    ]
      .sort((left, right) => left - right)
      .map((ord) => {
        const template = templates.find((entry) => entry.ord === ord);

        return {
          label: template ? `${template.ord}: ${template.name}` : `${ord}`,
          ord,
        };
      });

    const deckSelect = this.createSelect(deckOptions, row.deck, (value) => {
      row.deck = value;
      this.packRows();
    });
    const modelSelect = this.createSelect(modelOptions, row.model, (value) => {
      row.model = value;
      row.wordField = '';
      row.readingField = '';
      row.templateOrds = [];

      if (!this._fetchUrl.length || !value.length) {
        this.renderRows();
        this.packRows();

        return;
      }

      void this.ensureModelDataLoaded(value, this._fetchUrl).then(() => {
        this.renderRows();
        this.packRows();
      });
    });
    const wordFieldSelect = this.createSelect(wordOptions, row.wordField, (value) => {
      row.wordField = value;
      this.packRows();
    });
    const readingFieldSelect = this.createSelect(readingOptions, row.readingField, (value) => {
      row.readingField = value;
      this.packRows();
    });
    const templateSelect = createElement('select');

    templateSelect.replaceChildren(
      createElement('option', {
        attributes: { value: '' },
        innerText: 'All templates',
      }),
      ...templateOptions.map((template) =>
        createElement('option', {
          attributes: { value: String(template.ord) },
          innerText: template.label,
        }),
      ),
    );
    templateSelect.value = row.templateOrds.length > 0 ? String(row.templateOrds[0]) : '';

    templateSelect.addEventListener('change', () => {
      const ord = Number(templateSelect.value);

      row.templateOrds = Number.isInteger(ord) && ord >= 0 ? [ord] : [];
      this.packRows();
    });

    return createElement('div', {
      class: ['form-box-parent'],
      children: [
        createElement('div', {
          class: ['form-box'],
          children: [
            this.createLabeledBlock('Deck Constraint', deckSelect),
            this.createLabeledBlock('Model', modelSelect),
            this.createLabeledBlock('Word Field', wordFieldSelect),
            this.createLabeledBlock('Reading Field', readingFieldSelect),
            this.createLabeledBlock('Card Templates', templateSelect),
            createElement('input', {
              class: ['outline', 'v1'],
              attributes: { type: 'button', value: 'Remove' },
              handler: () => {
                this._rows.splice(index, 1);
                this.renderRows();
                this.packRows();
              },
            }),
          ],
        }),
      ],
    });
  }

  private createSelect(
    options: string[],
    selected: string,
    onChange: (value: string) => void,
  ): HTMLSelectElement {
    const select = createElement('select');

    select.replaceChildren(
      ...options.map((option) =>
        createElement('option', {
          attributes: { value: option },
          innerText: option,
        }),
      ),
    );
    select.value = selected;
    select.addEventListener('change', () => onChange(select.value));

    return select;
  }

  private createLabeledBlock(label: string, input: HTMLElement): HTMLDivElement {
    return createElement('div', {
      children: [
        createElement('label', { innerText: label }),
        createElement('div', { class: ['select'], children: [input] }),
      ],
    });
  }

  private async ensureModelDataLoaded(model: string, ankiConnectUrl: string): Promise<void> {
    if (!model.length) {
      return;
    }

    if (!this._fieldsByModel.has(model)) {
      this._fieldsByModel.set(model, await getFields(model, { ankiConnectUrl }));
    }

    if (!this._templatesByModel.has(model)) {
      this._templatesByModel.set(model, await getModelTemplates(model, { ankiConnectUrl }));
    }
  }

  private getFieldsForModel(model: string): string[] {
    return this._fieldsByModel.get(model) ?? [];
  }

  private getTemplatesForModel(model: string): AnkiModelTemplate[] {
    return this._templatesByModel.get(model) ?? [];
  }
}
