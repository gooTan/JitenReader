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
import { HTMLAnkiReadonlyConfigsElement } from './elements/html-anki-readonly-configs-element';
import { HTMLFeaturesInputElement } from './elements/html-features-input-element';
import { HTMLKeybindInputElement } from './elements/html-keybind-input-element';
import { HTMLMiningInputElement } from './elements/html-mining-input-element';
import { HTMLNewStateInputElement } from './elements/html-new-state-input-element';
import { HTMLParsersInputElement } from './elements/html-parsers-input-element';
import { HTMLProfileManagerElement } from './elements/html-profile-manager-element';
import { HTMLProfileSelectorElement } from './elements/html-profile-selector-element';
import { HTMLWordStyleEditorElement } from './elements/html-word-style-editor-element';
import { SettingsAnkiController } from './settings/settings-anki-controller';
import {
  initSettingsNavigation,
  initSettingsSearch,
} from './settings/settings-navigation-controller';
import { initSettingsTheme } from './settings/settings-theme-controller';

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
const SETTINGS_FIELD_SELECTOR =
  'input, textarea, select, keybind-input, parsers-input, features-input, new-state-input, word-style-editor, mining-input, anki-readonly-configs';

type ConfigurationFieldElement = HTMLElement & {
  checked?: boolean;
  name: string;
  onchange: ((this: GlobalEventHandlers, ev: Event) => unknown) | null;
  type?: string;
  value: ConfigurationSchema[keyof ConfigurationSchema];
};

const ankiController = new SettingsAnkiController({ localConfiguration });

initSettingsTheme();

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
  ankiController.syncAfterInitialisation();
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
        await ankiController.saveAndRefreshEndpoint(
          ankiUrlInput.value,
          async (normalizedAnkiUrl) => {
            ankiUrlInput.value = normalizedAnkiUrl;

            await validateAndSet('ankiUrl', normalizedAnkiUrl, async () => {
              await setConfiguration('ankiUrl', normalizedAnkiUrl);
              configurationUpdatedCommand.send();
            });
          },
        );
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
  ankiController.afterConfigurationValueUpdated(key, value);
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
initSettingsNavigation((callback) => {
  afterBindingsCallbacks.push(callback);
});
initSettingsSearch((callback) => {
  afterBindingsCallbacks.push(callback);
});
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
