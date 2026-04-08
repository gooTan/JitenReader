import { getConfiguration } from '../configuration/get-configuration';
import { displayToast } from '../dom/display-toast';
import { AnkiEndpoints, AnkiRequestOptions } from './api.types';
import { normalizeAnkiConnectUrl } from './normalize-anki-connect-url';

export const request = async <Key extends keyof AnkiEndpoints>(
  action: Key,
  params: AnkiEndpoints[Key][0] | undefined,
  options?: AnkiRequestOptions,
): Promise<AnkiEndpoints[Key][1]> => {
  const showToastOnError = options?.showToastOnError ?? true;
  const ankiUrl = options?.ankiConnectUrl || (await getConfiguration('ankiUrl'));

  if (!ankiUrl?.length) {
    if (showToastOnError) {
      displayToast('error', 'Anki URL is not set');
    }

    throw new Error('Anki URL is not set');
  }

  let usedUrl: URL;

  try {
    usedUrl = new URL(normalizeAnkiConnectUrl(ankiUrl));
  } catch (error) {
    if (showToastOnError) {
      displayToast('error', error instanceof Error ? error.message : 'Anki URL is invalid');
    }

    throw error;
  }

  const response = await fetch(usedUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action,
      version: 6,
      params,
    }),
  });

  if (!response.ok) {
    throw new Error(`Anki request failed with status ${response.status}`);
  }

  const responseObject = (await response.json()) as
    | {
        error: string;
      }
    | {
        error: null;
        result: AnkiEndpoints[Key][1];
      };

  if ('error' in responseObject && responseObject.error !== null) {
    throw new Error(responseObject.error);
  }

  return responseObject.result;
};
