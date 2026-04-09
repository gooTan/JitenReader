import { getApiVersion } from '@shared/anki/get-api-version';
import { normalizeAnkiConnectUrl } from '@shared/anki/normalize-anki-connect-url';
import { getReadonlyDiscoverWordConfigurationSummary } from '@shared/anki/readonly-config';
import { DeckConfiguration, DiscoverWordConfiguration } from '@shared/anki/types';
import { ConfigurationSchema } from '@shared/configuration/types';
import { createElement } from '@shared/dom/create-element';
import { displayToast } from '@shared/dom/display-toast';
import { HTMLAnkiReadonlyConfigsElement } from '../elements/html-anki-readonly-configs-element';
import { HTMLMiningInputElement } from '../elements/html-mining-input-element';

const ANKI_MINING_INPUT_IDS = ['ankiMiningConfig', 'ankiNeverForgetConfig', 'ankiBlacklistConfig'];
const ANKI_READONLY_INPUT_ID = 'ankiReadonlyConfigs';

type SettingsAnkiControllerOptions = {
  localConfiguration: Map<
    keyof ConfigurationSchema,
    ConfigurationSchema[keyof ConfigurationSchema]
  >;
};

export class SettingsAnkiController {
  private _settingsInitialisationComplete = false;
  private _suppressNextAnkiUrlAutoRefresh = false;

  public constructor(private readonly _options: SettingsAnkiControllerOptions) {}

  public renderReadonlySummary(): void {
    const container = document.getElementById('anki-readonly-summary');

    if (!container) {
      return;
    }

    const summary = getReadonlyDiscoverWordConfigurationSummary({
      explicitConfigs: this.getLocalReadonlyConfigurations(),
      blacklistConfig: this.getLocalDeckConfiguration('ankiBlacklistConfig'),
      miningConfig: this.getLocalDeckConfiguration('ankiMiningConfig'),
      neverForgetConfig: this.getLocalDeckConfiguration('ankiNeverForgetConfig'),
    });
    const summaryItems =
      summary.derivedConfigs.length > 0
        ? summary.derivedConfigs.map(({ config, source }) => {
            const templateLabel =
              config.templateOrds.length > 0
                ? config.templateOrds.map((ord) => `ord ${ord}`).join(', ')
                : 'all templates';
            const deckLabel = config.deck.length > 0 ? config.deck : 'all decks';
            const readingLabel =
              config.readingField.length > 0 ? config.readingField : 'no reading field';

            return `${source}: ${config.model} / ${config.wordField} / ${readingLabel} / ${deckLabel} / ${templateLabel}`;
          })
        : ['No derived read-side configs are currently available.'];
    const issueItems =
      summary.issues.length > 0
        ? summary.issues.map((issue) => `${issue.source}: ${issue.code}`)
        : [];

    container.replaceChildren(
      createElement('div', {
        children: summaryItems.map((item) =>
          createElement('p', {
            style: { marginBottom: '0.4em', opacity: '0.8' },
            innerText: item,
          }),
        ),
      }),
      ...(issueItems.length > 0
        ? [
            createElement('div', {
              children: issueItems.map((item) =>
                createElement('p', {
                  style: { marginBottom: '0.4em', color: '#f0b070' },
                  innerText: `Issue: ${item}`,
                }),
              ),
            }),
          ]
        : []),
    );
  }

  public applyFetchUrl(ankiUrl: string): void {
    let normalized = '';

    try {
      normalized = normalizeAnkiConnectUrl(ankiUrl);
    } catch {
      // Keep invalid values editable in the text field but prevent dependent fetch calls.
    }

    for (const input of this.getAnkiMiningInputs()) {
      input.fetchUrl = normalized;
    }

    const readonlyInput = this.getAnkiReadonlyInput();

    if (readonlyInput) {
      readonlyInput.fetchUrl = normalized;
    }
  }

  public async syncInputsFromUrl(ankiUrl: string, showFailureToast: boolean): Promise<void> {
    let normalizedAnkiUrl: string;

    try {
      normalizedAnkiUrl = normalizeAnkiConnectUrl(ankiUrl);
    } catch (error) {
      if (showFailureToast) {
        displayToast('error', this.getErrorMessage(error));
      }

      return;
    }

    this.applyFetchUrl(normalizedAnkiUrl);

    try {
      await this.refreshMiningInputs(normalizedAnkiUrl);
      await this.getAnkiReadonlyInput()?.refreshFromUrl(normalizedAnkiUrl);
    } catch (error) {
      if (showFailureToast) {
        displayToast(
          'error',
          `Failed to refresh Anki deck selectors from endpoint: ${this.getErrorMessage(error)}`,
        );
      }
    }
  }

  public async saveAndRefreshEndpoint(
    ankiUrl: string,
    save: (normalizedAnkiUrl: string) => Promise<void>,
  ): Promise<void> {
    let normalizedAnkiUrl: string;

    try {
      normalizedAnkiUrl = normalizeAnkiConnectUrl(ankiUrl);
    } catch (error) {
      displayToast('error', this.getErrorMessage(error));

      return;
    }

    try {
      this._suppressNextAnkiUrlAutoRefresh = true;
      await save(normalizedAnkiUrl);
    } catch (error) {
      displayToast('error', `Failed to save Anki endpoint: ${this.getErrorMessage(error)}`);

      return;
    } finally {
      this._suppressNextAnkiUrlAutoRefresh = false;
    }

    try {
      await getApiVersion({ ankiConnectUrl: normalizedAnkiUrl, showToastOnError: false });
      this.applyFetchUrl(normalizedAnkiUrl);
      await this.syncInputsFromUrl(normalizedAnkiUrl, true);
      displayToast(
        'success',
        'Anki endpoint is reachable and deck/model/template selectors were refreshed',
      );
    } catch (error) {
      displayToast('error', `Failed to reach Anki endpoint: ${this.getErrorMessage(error)}`);
    }
  }

  public afterConfigurationValueUpdated(
    key: keyof ConfigurationSchema,
    value: ConfigurationSchema[keyof ConfigurationSchema],
  ): void {
    if (key === 'ankiUrl') {
      this.applyFetchUrl(value as string);

      if (this._settingsInitialisationComplete && !this._suppressNextAnkiUrlAutoRefresh) {
        void this.syncInputsFromUrl(value as string, true);
      }
    }

    if (key === 'enableAnkiIntegration' && value === true && this._settingsInitialisationComplete) {
      const currentAnkiUrl = this._options.localConfiguration.get('ankiUrl');

      if (typeof currentAnkiUrl === 'string' && currentAnkiUrl.length) {
        void this.syncInputsFromUrl(currentAnkiUrl, true);
      }
    }

    if (
      key === 'ankiMiningConfig' ||
      key === 'ankiBlacklistConfig' ||
      key === 'ankiNeverForgetConfig' ||
      key === 'ankiReadonlyConfigs'
    ) {
      this.renderReadonlySummary();
    }
  }

  public syncAfterInitialisation(): void {
    this._settingsInitialisationComplete = true;
    this.renderReadonlySummary();

    const ankiEnabled = this._options.localConfiguration.get('enableAnkiIntegration') === true;
    const ankiUrl = this._options.localConfiguration.get('ankiUrl');

    if (!ankiEnabled || typeof ankiUrl !== 'string' || !ankiUrl.length) {
      return;
    }

    void this.syncInputsFromUrl(ankiUrl, false);
  }

  private getAnkiMiningInputs(): HTMLMiningInputElement[] {
    return ANKI_MINING_INPUT_IDS.map((id) => document.getElementById(id)).filter(
      (element): element is HTMLMiningInputElement => element instanceof HTMLMiningInputElement,
    );
  }

  private getAnkiReadonlyInput(): HTMLAnkiReadonlyConfigsElement | null {
    const element = document.getElementById(ANKI_READONLY_INPUT_ID);

    return element instanceof HTMLAnkiReadonlyConfigsElement ? element : null;
  }

  private async refreshMiningInputs(ankiUrl: string): Promise<void> {
    const normalized = normalizeAnkiConnectUrl(ankiUrl);

    await Promise.all(this.getAnkiMiningInputs().map((input) => input.refreshFromUrl(normalized)));
  }

  private getLocalDeckConfiguration(
    key: keyof Pick<
      ConfigurationSchema,
      'ankiMiningConfig' | 'ankiBlacklistConfig' | 'ankiNeverForgetConfig'
    >,
  ): DeckConfiguration {
    return (
      (this._options.localConfiguration.get(key) as DeckConfiguration | undefined) ?? {
        deck: '',
        model: '',
        proxy: false,
        wordField: '',
        readingField: '',
        cardTemplateOrds: [],
        templateTargets: [],
      }
    );
  }

  private getLocalReadonlyConfigurations(): DiscoverWordConfiguration[] {
    return (
      (this._options.localConfiguration.get('ankiReadonlyConfigs') as
        | DiscoverWordConfiguration[]
        | undefined) ?? []
    );
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
  }
}
