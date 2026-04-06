import { getProfileKey } from './configuration/profile.constants';
import { getActiveProfileId } from './configuration/profiles-state';

let debugEnabled: boolean | undefined = undefined;
const bufferedDebugMessages: [string, ...unknown[]][] = [];
let activeProfileDebugKey = 'enableDebugMode';

const toBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return undefined;
};

const refreshDebugEnabled = async (): Promise<void> => {
  const activeProfileId = await getActiveProfileId();

  activeProfileDebugKey = getProfileKey(activeProfileId, 'enableDebugMode');

  chrome.storage.local.get(
    [activeProfileDebugKey, 'enableDebugMode'],
    (result: Record<string, unknown>): void => {
      const profileValue = toBoolean(result[activeProfileDebugKey]);
      const legacyValue = toBoolean(result.enableDebugMode);

      debugEnabled = profileValue ?? legacyValue ?? false;
      drainBufferedDebugMessages();
    },
  );
};

chrome.storage.local.onChanged.addListener(
  (changes: Record<string, chrome.storage.StorageChange>): void => {
    if (
      changes.enableDebugMode ||
      changes.__profiles__ ||
      changes[activeProfileDebugKey] ||
      Object.keys(changes).some((key) => key.endsWith(':enableDebugMode'))
    ) {
      void refreshDebugEnabled();
    }
  },
);
void refreshDebugEnabled();

export const debug = (message: string, ...optionalParams: unknown[]): void => {
  if (debugEnabled === undefined) {
    // Buffer messages until we know the debug state
    bufferedDebugMessages.push([message, ...optionalParams]);

    return;
  }

  if (!debugEnabled) {
    return;
  }

  // eslint-disable-next-line no-console
  console.log(`[DEBUG] ${message}`, ...optionalParams);
};

const drainBufferedDebugMessages = (): void => {
  if (debugEnabled === undefined || debugEnabled === false) {
    return;
  }

  for (const [message, ...optionalParams] of bufferedDebugMessages) {
    // eslint-disable-next-line no-console
    console.log(`[DEBUG] ${message}`, ...optionalParams);
  }

  bufferedDebugMessages.length = 0; // Clear the buffer
};
