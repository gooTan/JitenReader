import { getApiVersion } from '@shared/anki/get-api-version';
import { getConfiguration } from '@shared/configuration/get-configuration';
import { ReviewBackendAvailability } from './review-backend-selector.types';

const MINIMUM_ANKI_CONNECT_API_VERSION = 6;

export const probeAnkiAvailability = async (): Promise<ReviewBackendAvailability> => {
  const ankiUrl = await getConfiguration('ankiUrl');

  if (!ankiUrl?.length) {
    return 'unavailable';
  }

  try {
    const apiVersion = await getApiVersion({ ankiConnectUrl: ankiUrl });

    return apiVersion >= MINIMUM_ANKI_CONNECT_API_VERSION ? 'available' : 'unavailable';
  } catch {
    return 'unavailable';
  }
};
