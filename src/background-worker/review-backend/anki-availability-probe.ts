import { getApiVersion } from '@shared/anki/get-api-version';
import { getCollectionCreationTime } from '@shared/anki/get-collection-creation-time';
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

    if (apiVersion < MINIMUM_ANKI_CONNECT_API_VERSION) {
      return 'unavailable';
    }

    const collectionCreationTime = await getCollectionCreationTime({
      ankiConnectUrl: ankiUrl,
      showToastOnError: false,
    });

    if (!Number.isFinite(collectionCreationTime) || collectionCreationTime <= 0) {
      return 'unavailable';
    }

    return 'available';
  } catch {
    return 'unavailable';
  }
};
