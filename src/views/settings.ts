import { getApiVersion } from '@shared/anki/get-api-version';
import { normalizeAnkiConnectUrl } from '@shared/anki/normalize-anki-connect-url';
import { getReadonlyDiscoverWordConfigurationSummary } from '@shared/anki/readonly-config';
import { DeckConfiguration, DiscoverWordConfiguration } from '@shared/anki/types';
import { getConfiguration } from '@shared/configuration/get-configuration';
import { getActiveProfileId } from '@shared/configuration/profiles-state';
import { setConfiguration } from '@shared/configuration/set-configuration';
import { ConfigurationSchema } from '@shared/configuration/types';
import { createElement } from '@shared/dom/create-element';
import { displayToast } from '@shared/dom/display-toast';
import { findElement } from '@shared/dom/find-element';
import { withElement } from '@shared/dom/with-element';
import { withElements } from '@shared/dom/with-elements';
import { ping } from '@shared/jiten/ping';
import { ConfigurationUpdatedCommand } from '@shared/messages/broadcast/configuration-updated.command';
import { ProfileSwitchedCommand } from '@shared/messages/broadcast/profile-switched.command';
import { onBroadcastMessage } from '@shared/messages/receiving/on-broadcast-message';
import { getThemeCssVars } from '@shared/theme/get-theme-css-vars';
import { HTMLAnkiReadonlyConfigsElement } from './elements/html-anki-readonly-configs-element';
import { HTMLFeaturesInputElement } from './elements/html-features-input-element';
import { HTMLKeybindInputElement } from './elements/html-keybind-input-element';
import { HTMLMiningInputElement } from './elements/html-mining-input-element';
import { HTMLNewStateInputElement } from './elements/html-new-state-input-element';
import { HTMLParsersInputElement } from './elements/html-parsers-input-element';
import { HTMLProfileManagerElement } from './elements/html-profile-manager-element';
import { HTMLProfileSelectorElement } from './elements/html-profile-selector-element';
import { HTMLWordStyleEditorElement } from './elements/html-word-style-editor-element';

customElements.define('mining-input', HTMLMiningInputElement);
customElements.define('anki-readonly-configs', HTMLAnkiReadonlyConfigsElement);
customElements.define('profile-selector', HTMLProfileSelectorElement);
customElements.define('keybind-input', HTMLKeybindInputElement);
customElements.define('parsers-input', HTMLParsersInputElement);
customElements.define('features-input', HTMLFeaturesInputElement);
customElements.define('new-state-input', HTMLNewStateInputElement);
customElements.define('profile-manager', HTMLProfileManagerElement);
customElements.define('word-style-editor', HTMLWordStyleEditorElement);

withElement('#currentProfile', (selector: HTMLProfileSelectorElement) => {
  selector.addEventListener('profilechange', () => {
    window.location.reload();
  });
});

const localConfiguration = new Map<
  keyof ConfigurationSchema,
  ConfigurationSchema[keyof ConfigurationSchema]
>();
const bindings = new Map<string, Set<HTMLElement>>();
const validators: Partial<
  Record<keyof ConfigurationSchema, (value: unknown) => boolean | Promise<boolean>>
> = {
  jitenApiKey: validateJitenApiKey,
};

const configurationUpdatedCommand = new ConfigurationUpdatedCommand();
const fieldInitialisationTasks: Promise<void>[] = [];
let settingsInitialisationComplete = false;
let suppressNextAnkiUrlAutoRefresh = false;
const SETTINGS_FIELD_SELECTOR =
  'input, textarea, select, keybind-input, parsers-input, features-input, new-state-input, word-style-editor, mining-input, anki-readonly-configs';
const ANKI_MINING_INPUT_IDS = ['ankiMiningConfig', 'ankiNeverForgetConfig', 'ankiBlacklistConfig'];
const ANKI_READONLY_INPUT_ID = 'ankiReadonlyConfigs';

type ConfigurationFieldElement = HTMLElement & {
  checked?: boolean;
  name: string;
  onchange: ((this: GlobalEventHandlers, ev: Event) => unknown) | null;
  type?: string;
  value: ConfigurationSchema[keyof ConfigurationSchema];
};

const getAnkiMiningInputs = (): HTMLMiningInputElement[] =>
  ANKI_MINING_INPUT_IDS.map((id) => document.getElementById(id)).filter(
    (element): element is HTMLMiningInputElement => element instanceof HTMLMiningInputElement,
  );

const getAnkiReadonlyInput = (): HTMLAnkiReadonlyConfigsElement | null => {
  const element = document.getElementById(ANKI_READONLY_INPUT_ID);

  return element instanceof HTMLAnkiReadonlyConfigsElement ? element : null;
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unknown error';

const getLocalDeckConfiguration = (
  key: keyof Pick<
    ConfigurationSchema,
    'ankiMiningConfig' | 'ankiBlacklistConfig' | 'ankiNeverForgetConfig'
  >,
): DeckConfiguration => {
  return (
    (localConfiguration.get(key) as DeckConfiguration | undefined) ?? {
      deck: '',
      model: '',
      proxy: false,
      wordField: '',
      readingField: '',
      cardTemplateOrds: [],
      templateTargets: [],
    }
  );
};

const getLocalReadonlyConfigurations = (): DiscoverWordConfiguration[] => {
  return (
    (localConfiguration.get('ankiReadonlyConfigs') as DiscoverWordConfiguration[] | undefined) ?? []
  );
};

const renderAnkiReadonlySummary = (): void => {
  const container = document.getElementById('anki-readonly-summary');

  if (!container) {
    return;
  }

  const summary = getReadonlyDiscoverWordConfigurationSummary({
    explicitConfigs: getLocalReadonlyConfigurations(),
    blacklistConfig: getLocalDeckConfiguration('ankiBlacklistConfig'),
    miningConfig: getLocalDeckConfiguration('ankiMiningConfig'),
    neverForgetConfig: getLocalDeckConfiguration('ankiNeverForgetConfig'),
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
};

const applyAnkiFetchUrl = (ankiUrl: string): void => {
  let normalized = '';

  try {
    normalized = normalizeAnkiConnectUrl(ankiUrl);
  } catch {
    // Keep invalid values editable in the text field but prevent dependent fetch calls.
  }

  for (const input of getAnkiMiningInputs()) {
    input.fetchUrl = normalized;
  }

  const readonlyInput = getAnkiReadonlyInput();

  if (readonlyInput) {
    readonlyInput.fetchUrl = normalized;
  }
};

const refreshAnkiMiningInputs = async (ankiUrl: string): Promise<void> => {
  const normalized = normalizeAnkiConnectUrl(ankiUrl);

  await Promise.all(getAnkiMiningInputs().map((input) => input.refreshFromUrl(normalized)));
};

const syncAnkiInputsFromUrl = async (ankiUrl: string, showFailureToast: boolean): Promise<void> => {
  let normalizedAnkiUrl: string;

  try {
    normalizedAnkiUrl = normalizeAnkiConnectUrl(ankiUrl);
  } catch (error) {
    if (showFailureToast) {
      displayToast('error', getErrorMessage(error));
    }

    return;
  }

  applyAnkiFetchUrl(normalizedAnkiUrl);

  try {
    await refreshAnkiMiningInputs(normalizedAnkiUrl);
    await getAnkiReadonlyInput()?.refreshFromUrl(normalizedAnkiUrl);
  } catch (error) {
    if (showFailureToast) {
      displayToast(
        'error',
        `Failed to refresh Anki deck selectors from endpoint: ${getErrorMessage(error)}`,
      );
    }
  }
};

//#region Theme Variables

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

void applyThemeVars();
onBroadcastMessage('configurationUpdated', () => void applyThemeVars());

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

    // Apply theme vars immediately from current input values for instant visual feedback
    applyThemeVarsFromInputs();

    // Debounce the save to avoid spamming storage
    debounceTimer = setTimeout(() => {
      void setConfiguration(colourId as keyof ConfigurationSchema, value).then(() => {
        configurationUpdatedCommand.send();
      });
    }, 150);
  };

  // Initial load: sync text input from colour input (which is loaded by withElements)
  const syncTextFromColour = (): void => {
    textInput.value = colourInput.value.toUpperCase();
  };

  // Wait for colour input to be loaded by withElements, then sync text
  setTimeout(syncTextFromColour, 50);

  // When user types in text input, update colour picker and save
  textInput.addEventListener('input', () => {
    const value = textInput.value.trim();

    if (/^#[0-9A-Fa-f]{6}$/i.test(value)) {
      colourInput.value = value;
      saveAndApply(value);
    }
  });

  // When user picks colour, update text input and save
  colourInput.addEventListener('input', () => {
    textInput.value = colourInput.value.toUpperCase();
    saveAndApply(colourInput.value);
  });
};

setupColourPicker('themeBgColour', 'themeBgColourText');
setupColourPicker('themeAccentColour', 'themeAccentColourText');

//#endregion

//#region Init Interactions

withElements(SETTINGS_FIELD_SELECTOR, (field: ConfigurationFieldElement) => {
  const internal = field.hasAttribute('internal');
  const ignored = ['hidden', 'submit', 'button'];
  const checkbox = field.type === 'checkbox';

  if (internal || (!!field.type && ignored.includes(field.type))) {
    return;
  }

  const initialisationTask = getConfiguration(field.name as keyof ConfigurationSchema)
    // Load current or default configuration
    .then((value) => {
      if (checkbox) {
        field.checked = value as boolean;
      } else {
        field.value = value;
      }

      return validateAndSet(field.name as keyof ConfigurationSchema, value);
    })
    // Apply change listeners
    .then(() => {
      field.onchange = (): void => {
        const value = checkbox ? field.checked : field.value;

        void validateAndSet(field.name as keyof ConfigurationSchema, value, async () => {
          await setConfiguration(field.name as keyof ConfigurationSchema, value);
          configurationUpdatedCommand.send();

          displayToast('success', 'Settings saved successfully', undefined, true);
        });
      };
    });

  fieldInitialisationTasks.push(initialisationTask);
});

void Promise.allSettled(fieldInitialisationTasks).then(() => {
  settingsInitialisationComplete = true;
  renderAnkiReadonlySummary();

  const ankiEnabled = localConfiguration.get('enableAnkiIntegration') === true;
  const ankiUrl = localConfiguration.get('ankiUrl');

  if (!ankiEnabled || typeof ankiUrl !== 'string' || !ankiUrl.length) {
    return;
  }

  void syncAnkiInputsFromUrl(ankiUrl, false);
});

withElement('#apiKeyRevealButton', (button: HTMLInputElement) => {
  button.onclick = (): void => {
    withElement('#jitenApiKey', (input: HTMLInputElement) => {
      const revealed = input.type === 'text';

      input.type = revealed ? 'password' : 'text';
      button.style.textDecoration = revealed ? '' : 'line-through';
    });
  };
});

withElement('#apiTokenButton', (button) => {
  button.onclick = (): void => {
    withElement('#jitenApiKey', (i: HTMLInputElement) => {
      void validateJitenApiKey(i.value);
    });
  };
});

withElement('#ankiUrlButton', (button: HTMLInputElement) => {
  button.onclick = (): void => {
    withElement('#ankiUrl', (ankiUrlInput: HTMLInputElement) => {
      void (async (): Promise<void> => {
        let normalizedAnkiUrl: string;

        try {
          normalizedAnkiUrl = normalizeAnkiConnectUrl(ankiUrlInput.value);
        } catch (error) {
          displayToast('error', getErrorMessage(error));

          return;
        }

        ankiUrlInput.value = normalizedAnkiUrl;

        try {
          suppressNextAnkiUrlAutoRefresh = true;

          await validateAndSet('ankiUrl', normalizedAnkiUrl, async () => {
            await setConfiguration('ankiUrl', normalizedAnkiUrl);
            configurationUpdatedCommand.send();
          });
        } catch (error) {
          displayToast('error', `Failed to save Anki endpoint: ${getErrorMessage(error)}`);

          return;
        } finally {
          suppressNextAnkiUrlAutoRefresh = false;
        }

        try {
          await getApiVersion({ ankiConnectUrl: normalizedAnkiUrl, showToastOnError: false });
          applyAnkiFetchUrl(normalizedAnkiUrl);
          await syncAnkiInputsFromUrl(normalizedAnkiUrl, true);
          displayToast(
            'success',
            'Anki endpoint is reachable and deck/model/template selectors were refreshed',
          );
        } catch (error) {
          displayToast('error', `Failed to reach Anki endpoint: ${getErrorMessage(error)}`);
        }
      })();
    });
  };
});

withElement('#export-settings', (button) => {
  button.onclick = (event: Event): void => {
    event.stopPropagation();
    event.preventDefault();

    const downloadTitleWithDate = `configuration-${new Date().toISOString().slice(0, 10)}.json`;

    void chrome.storage.local.get().then((configuration) => {
      const includeApiKey = (document.getElementById('exportApiKey') as HTMLInputElement)?.checked;

      if (!includeApiKey) {
        Object.keys(configuration).forEach((key) => {
          if (key.includes('jitenApiKey')) {
            delete configuration[key];
          }
        });
      }

      const blob = new Blob([JSON.stringify(configuration, null, 2)], {
        type: 'application/json',
      });

      const url = URL.createObjectURL(blob);
      const a = createElement('a', {
        attributes: { href: url, download: downloadTitleWithDate },
      });

      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      URL.revokeObjectURL(url);
    });
  };
});

withElement('#import-settings', (button) => {
  button.onclick = (event: Event): void => {
    event.stopPropagation();
    event.preventDefault();

    const fileInput = createElement('input', {
      attributes: { type: 'file', accept: '.json' },
    });

    fileInput.onchange = async (): Promise<void> => {
      if (!fileInput.files?.length) {
        return;
      }

      const file = fileInput.files[0];
      const text = await file.text();

      let data: Record<string, unknown> | undefined;

      try {
        data = JSON.parse(text) as Record<string, unknown>;
      } catch {
        alert('Failed to import settings: invalid JSON file');

        return;
      }

      await chrome.storage.local.clear();
      await chrome.storage.local.set(data);

      const activeProfileId = await getActiveProfileId();

      new ProfileSwitchedCommand(activeProfileId).send();
      configurationUpdatedCommand.send();

      window.location.reload();
    };

    fileInput.click();
  };
});

withElement('#exportApiKey', (checkbox: HTMLInputElement) => {
  checkbox.addEventListener('change', () => {
    const warning = document.getElementById('exportApiKeyWarning');

    if (warning) {
      warning.style.display = checkbox.checked ? 'block' : 'none';
    }
  });
});

//#endregion
//#region Field Updates

function afterValueUpdated(
  key: keyof ConfigurationSchema,
  value: ConfigurationSchema[keyof ConfigurationSchema],
): void {
  localConfiguration.set(key, value);

  if (key === 'ankiUrl') {
    applyAnkiFetchUrl(value as string);

    if (settingsInitialisationComplete && !suppressNextAnkiUrlAutoRefresh) {
      void syncAnkiInputsFromUrl(value as string, true);
    }
  }

  if (key === 'enableAnkiIntegration' && value === true && settingsInitialisationComplete) {
    const currentAnkiUrl = localConfiguration.get('ankiUrl');

    if (typeof currentAnkiUrl === 'string' && currentAnkiUrl.length) {
      void syncAnkiInputsFromUrl(currentAnkiUrl, true);
    }
  }

  if (
    key === 'ankiMiningConfig' ||
    key === 'ankiBlacklistConfig' ||
    key === 'ankiNeverForgetConfig' ||
    key === 'ankiReadonlyConfigs'
  ) {
    renderAnkiReadonlySummary();
  }

  updateBindings(key);
}

async function validateAndSet(
  key: keyof ConfigurationSchema,
  value: ConfigurationSchema[keyof ConfigurationSchema],
  afterValidate?: () => void | Promise<void>,
): Promise<void> {
  if (validators[key]) {
    const isValid = await validators[key](value);

    if (!isValid) {
      updateBindings(key);

      return;
    }
  }

  afterValueUpdated(key, value);

  await afterValidate?.();
}

//#endregion
//#region Field Bindings

withElements('[data-show]', (element) => {
  const attributeValue = element.getAttribute('data-show');

  /**
   * The property resembles a javascript condition - the following are valid
   *
   * - myProperty
   * - !myProperty
   * - myProperty && !myOtherProperty
   * - myProperty || myOtherProperty
   * - (myProperty && myOtherProperty) || !myThirdProperty
   */

  const fields =
    attributeValue
      ?.match(/(\w+)/g)
      ?.map((field) => field.trim())
      .filter(Boolean) ?? [];

  for (const f of fields) {
    if (!bindings.has(f)) {
      bindings.set(f, new Set());
    }

    bindings.get(f)!.add(element);
  }
});

const afterBindingsCallbacks: (() => void)[] = [];

function updateBindings(key: keyof ConfigurationSchema): void {
  const affected = bindings.get(key);

  if (!affected?.size) {
    return;
  }

  for (const current of affected) {
    const attributeValue = current.getAttribute('data-show');

    if (!attributeValue) {
      continue;
    }

    current.style.display = parseCondition(attributeValue) ? '' : 'none';
  }

  for (const cb of afterBindingsCallbacks) {
    cb();
  }
}

function parseCondition(expr: string): boolean {
  // Tokenize
  const tokens = expr
    .replace(/([()!])/g, ' $1 ')
    .replace(/&&/g, ' && ')
    .replace(/\|\|/g, ' || ')
    .split(/\s+/)
    .filter(Boolean);

  let pos = 0;

  function peek(): string {
    return tokens[pos];
  }

  function next(): string {
    return tokens[pos++];
  }

  function parsePrimary(): boolean {
    const token = peek();

    if (token === '(') {
      next(); // consume '('
      const value = parseOr();

      if (next() !== ')') {
        throw new Error('Expected )');
      }

      return value;
    }

    if (token === '!') {
      next();

      return !parsePrimary();
    }

    // Property name
    next();

    const value = localConfiguration.get(token as keyof ConfigurationSchema);

    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      return value?.length > 0;
    }

    return !!value;
  }

  function parseAnd(): boolean {
    let value = parsePrimary();

    while (peek() === '&&') {
      next();

      value = value && parsePrimary();
    }

    return value;
  }

  function parseOr(): boolean {
    let value = parseAnd();

    while (peek() === '||') {
      next();

      value = value || parseAnd();
    }

    return value;
  }

  if (!tokens.length) {
    return false;
  }

  try {
    const result = parseOr();

    if (pos !== tokens.length) {
      throw new Error('Unexpected token');
    }

    return result;
  } catch {
    return false;
  }
}

//#endregion
//#region TOC Navigation

const toc = document.getElementById('settings-toc');

if (toc) {
  const tocLinks = Array.from(toc.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'));
  const getSectionByLink = (link: HTMLAnchorElement): HTMLElement | null => {
    const id = link.getAttribute('href')!.slice(1);

    return document.getElementById(id);
  };

  const getSectionActivationTarget = (section: HTMLElement): HTMLElement =>
    section.querySelector<HTMLElement>(':scope > h6, :scope > summary') ?? section;

  const scrollTocToLink = (link: HTMLAnchorElement): void => {
    const tocRect = toc.getBoundingClientRect();
    const linkRect = link.getBoundingClientRect();
    const offset = linkRect.left - tocRect.left + linkRect.width / 2 - tocRect.width / 2;

    toc.scrollBy({ left: offset, behavior: 'smooth' });
  };

  const setActiveLink = (link: HTMLAnchorElement | null, syncToc = false): void => {
    if (!link || link.style.display === 'none' || link.classList.contains('search-hidden')) {
      return;
    }

    if (activeLink === link) {
      return;
    }

    activeLink?.classList.remove('active');
    link.classList.add('active');
    activeLink = link;

    if (syncToc) {
      scrollTocToLink(link);
    }
  };

  const clearStaleFocusedTocLink = (): void => {
    const focusedLink = document.activeElement;

    if (
      focusedLink instanceof HTMLAnchorElement &&
      toc.contains(focusedLink) &&
      focusedLink !== activeLink
    ) {
      focusedLink.blur();
    }
  };

  const getActivationOffsetForScroll = (scrollTop: number): number => {
    const stickyHeaderBottom =
      document.querySelector<HTMLElement>('.settings-search')?.getBoundingClientRect().bottom ?? 0;
    const baseOffset = Math.max(stickyHeaderBottom + 24, Math.round(window.innerHeight * 0.32));
    const lowerOffset = Math.max(stickyHeaderBottom + 24, Math.round(window.innerHeight * 0.9));
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;

    if (maxScroll <= 0) {
      return baseOffset;
    }

    const scrollProgress = scrollTop / maxScroll;

    if (scrollProgress <= 0.66) {
      return baseOffset;
    }

    const bottomThirdProgress = Math.min(1, (scrollProgress - 0.66) / 0.34);

    // Shift the activation line downward through the last third so short trailing
    // sections can still become active without changing the normal mid-page feel.
    return Math.round(baseOffset + (lowerOffset - baseOffset) * bottomThirdProgress);
  };

  const getActivationOffset = (): number => getActivationOffsetForScroll(window.scrollY);

  const getClickOffset = (): number => {
    const stickyHeaderBottom =
      document.querySelector<HTMLElement>('.settings-search')?.getBoundingClientRect().bottom ?? 0;

    return Math.max(stickyHeaderBottom + 24, Math.round(window.innerHeight * 0.28));
  };

  const getVisibleSectionLink = (): HTMLAnchorElement | null => {
    const visibleLinks = tocLinks.filter(
      (link) => link.style.display !== 'none' && !link.classList.contains('search-hidden'),
    );

    if (!visibleLinks.length) {
      return null;
    }

    const activationOffset = getActivationOffset();
    let activeCandidate: HTMLAnchorElement | null = null;
    let firstUpcoming: HTMLAnchorElement | null = null;

    for (const link of visibleLinks) {
      const section = getSectionByLink(link);

      if (
        !section ||
        section.style.display === 'none' ||
        section.classList.contains('search-hidden')
      ) {
        continue;
      }

      const activationTarget = getSectionActivationTarget(section);
      const sectionTop = activationTarget.getBoundingClientRect().top;

      if (sectionTop <= activationOffset) {
        activeCandidate = link;

        continue;
      }

      firstUpcoming ??= link;

      break;
    }

    return activeCandidate ?? firstUpcoming ?? visibleLinks[0];
  };

  const getNextVisibleSection = (section: HTMLElement): HTMLElement | null => {
    const visibleLinks = tocLinks.filter(
      (link) => link.style.display !== 'none' && !link.classList.contains('search-hidden'),
    );
    const currentIndex = visibleLinks.findIndex((link) => getSectionByLink(link) === section);

    if (currentIndex < 0) {
      return null;
    }

    for (const link of visibleLinks.slice(currentIndex + 1)) {
      const nextSection = getSectionByLink(link);

      if (
        nextSection &&
        nextSection.style.display !== 'none' &&
        !nextSection.classList.contains('search-hidden')
      ) {
        return nextSection;
      }
    }

    return null;
  };

  const scrollToSection = (section: HTMLElement): void => {
    const activationTarget = getSectionActivationTarget(section);
    const nextSection = getNextVisibleSection(section);
    const nextActivationTarget = nextSection ? getSectionActivationTarget(nextSection) : null;
    const clickOffset = getClickOffset();
    const clickBuffer = 28;
    const nextHeadingBuffer = 24;
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const desiredTop =
      window.scrollY +
      activationTarget.getBoundingClientRect().top -
      Math.max(0, clickOffset - clickBuffer);
    const nextHeadingDocTop = nextActivationTarget
      ? window.scrollY + nextActivationTarget.getBoundingClientRect().top
      : null;
    let maxAllowedTop = maxScroll;

    if (nextHeadingDocTop !== null) {
      maxAllowedTop = Math.min(
        maxScroll,
        Math.max(
          0,
          Math.round(
            nextHeadingDocTop - getActivationOffsetForScroll(maxScroll) - nextHeadingBuffer,
          ),
        ),
      );

      // Refine against the hybrid activation line at the candidate scroll position so the next
      // heading remains below the actual purple active-line geometry after the click scroll ends.
      for (let i = 0; i < 6; i += 1) {
        const refinedTop =
          nextHeadingDocTop - getActivationOffsetForScroll(maxAllowedTop) - nextHeadingBuffer;
        const boundedTop = Math.min(maxScroll, Math.max(0, refinedTop));

        if (Math.abs(boundedTop - maxAllowedTop) < 1) {
          maxAllowedTop = boundedTop;

          break;
        }

        maxAllowedTop = boundedTop;
      }
    }

    const scrollTop = Math.min(
      maxScroll,
      Math.max(0, Math.round(Math.min(desiredTop, maxAllowedTop))),
    );

    window.scrollTo({ top: scrollTop, behavior: 'smooth' });
  };

  let activeSyncQueued = false;
  const queueActiveLinkSync = (): void => {
    if (activeSyncQueued) {
      return;
    }

    activeSyncQueued = true;

    window.requestAnimationFrame(() => {
      activeSyncQueued = false;
      setActiveLink(getVisibleSectionLink());
      clearStaleFocusedTocLink();
    });
  };

  toc.addEventListener('click', (e: Event) => {
    const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');

    if (!link) {
      return;
    }

    e.preventDefault();

    const target = getSectionByLink(link);

    if (target) {
      if (target instanceof HTMLDetailsElement && !target.open) {
        target.open = true;
      }

      setActiveLink(link, true);
      scrollToSection(target);
      queueActiveLinkSync();
    }
  });

  let activeLink: HTMLAnchorElement | null = null;

  window.addEventListener('scroll', queueActiveLinkSync, { passive: true });
  window.addEventListener('resize', queueActiveLinkSync);

  queueActiveLinkSync();

  afterBindingsCallbacks.push(() => {
    queueActiveLinkSync();
  });
}

//#endregion
//#region Settings Search

const searchInput = document.getElementById('settings-search') as HTMLInputElement | null;

if (searchInput) {
  const searchSections: {
    el: HTMLElement;
    heading: string;
    tocLink: HTMLAnchorElement | null;
    items: { el: HTMLElement; text: string; container: HTMLElement | null }[];
    containers: Set<HTMLElement>;
  }[] = [];
  const searchOpenedDetails = new Set<HTMLDetailsElement>();

  const sectionSelector = 'form > .section[id], form > details.section-collapsible[id]';

  for (const sectionEl of document.querySelectorAll<HTMLElement>(sectionSelector)) {
    const heading = sectionEl.querySelector(':scope > h6, :scope > summary');
    const tocLink = toc?.querySelector<HTMLAnchorElement>(`a[href="#${sectionEl.id}"]`) ?? null;
    const items: { el: HTMLElement; text: string; container: HTMLElement | null }[] = [];
    const containers = new Set<HTMLElement>();

    for (const fbp of sectionEl.querySelectorAll<HTMLElement>('.form-box-parent')) {
      containers.add(fbp);

      for (const fb of fbp.querySelectorAll<HTMLElement>(':scope > .form-box')) {
        for (const child of Array.from(fb.children) as HTMLElement[]) {
          if (child.tagName !== 'DIV') {
            continue;
          }

          items.push({ el: child, text: gatherText(child), container: fbp });
        }
      }
    }

    for (const acc of sectionEl.querySelectorAll<HTMLDetailsElement>('details.accordion')) {
      if (acc.closest('.form-box-parent')) {
        continue;
      }

      items.push({ el: acc, text: gatherText(acc), container: null });
    }

    searchSections.push({
      el: sectionEl,
      heading: heading?.textContent?.toLowerCase().trim() ?? '',
      tocLink,
      items,
      containers,
    });
  }

  function gatherText(el: HTMLElement): string {
    const parts: string[] = [];

    for (const node of el.querySelectorAll('label, p, summary')) {
      if (node.textContent) {
        parts.push(node.textContent);
      }
    }

    return parts.join(' ').toLowerCase();
  }

  function isHiddenByShow(el: HTMLElement, root: HTMLElement): boolean {
    if (root.style.display === 'none') {
      return true;
    }

    let cur: HTMLElement | null = el;

    while (cur && cur !== root) {
      if (cur.style.display === 'none') {
        return true;
      }

      cur = cur.parentElement;
    }

    return false;
  }

  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  searchInput.addEventListener('input', () => {
    if (searchTimer) {
      clearTimeout(searchTimer);
    }

    searchTimer = setTimeout(runSearch, 150);
  });

  searchInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      clearSearch();
    }
  });

  searchInput.addEventListener('search', () => {
    if (!searchInput.value) {
      clearSearch();
    }
  });

  function runSearch(): void {
    const query = searchInput!.value.trim().toLowerCase();

    if (!query) {
      clearSearch();

      return;
    }

    for (const section of searchSections) {
      let sectionHasMatch = false;
      const headingMatches = section.heading.includes(query);
      const containerHits = new Map<HTMLElement, number>();

      for (const c of section.containers) {
        containerHits.set(c, 0);
      }

      for (const item of section.items) {
        if (isHiddenByShow(item.el, section.el)) {
          continue;
        }

        const matches = headingMatches || item.text.includes(query);

        item.el.classList.toggle('search-hidden', !matches);
        item.el.classList.toggle('search-match', matches);

        if (matches) {
          sectionHasMatch = true;

          if (item.container) {
            containerHits.set(item.container, (containerHits.get(item.container) ?? 0) + 1);
          }

          if (item.el instanceof HTMLDetailsElement && !item.el.open) {
            item.el.open = true;
            searchOpenedDetails.add(item.el);
          }
        }
      }

      for (const [c, hits] of containerHits) {
        c.classList.toggle('search-hidden', hits === 0);
      }

      section.el.classList.toggle('search-hidden', !sectionHasMatch);
      section.tocLink?.classList.toggle('search-hidden', !sectionHasMatch);

      if (sectionHasMatch && section.el instanceof HTMLDetailsElement && !section.el.open) {
        section.el.open = true;
        searchOpenedDetails.add(section.el);
      }
    }
  }

  function clearSearch(): void {
    searchInput!.value = '';

    for (const section of searchSections) {
      section.el.classList.remove('search-hidden');
      section.tocLink?.classList.remove('search-hidden');

      for (const c of section.containers) {
        c.classList.remove('search-hidden');
      }

      for (const item of section.items) {
        item.el.classList.remove('search-hidden', 'search-match');
      }
    }

    for (const d of searchOpenedDetails) {
      d.open = false;
    }

    searchOpenedDetails.clear();
  }

  afterBindingsCallbacks.push(() => {
    if (searchInput.value.trim()) {
      runSearch();
    }
  });
}

//#endregion
//#region Validators

async function validateJitenApiKey(value: string): Promise<boolean> {
  let isValid = false;

  if (value?.length) {
    try {
      await ping({ apiToken: value });

      isValid = true;
    } catch (_e) {
      /* NOP */
    }
  }

  const button = findElement('#apiTokenButton');
  const input = findElement('#jitenApiKey');

  button.classList.toggle('v1', !isValid);
  input.classList.toggle('v1', !isValid);

  return isValid;
}

//#endregion
